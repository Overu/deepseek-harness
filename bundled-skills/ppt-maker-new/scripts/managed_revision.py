"""User-authorized page revision: exact SOL blueprint + SML, transactional commit.

This is not defect repair and does not mint retry approvals. Call under the managed
project lock. Raw responses and billed attempts survive rollback and resume.
"""
import copy
import json
import os
from pathlib import Path
import re
import shutil

from delivery import read, export_best_effort
from stage_runtime import atomic_write_json, atomic_write_text, sha256_file, sha256_text
from work_budget import WorkBudget


def targets(value):
    parts = value.split(',') if isinstance(value, str) else value
    numbers = [int(n) for n in parts]
    if not numbers or any(n < 1 for n in numbers) or len(set(numbers)) != len(numbers):
        raise ValueError('revision requires distinct positive page numbers')
    return sorted(numbers)


def _allowed(rel):
    p = Path(rel)
    return (not p.is_absolute() and '..' not in p.parts and
            (rel == 'out.pptx' or p.parent == Path('authoring') and p.suffix == '.xml' or
             p.parent in {Path('reports'), Path('reports/render_attempts')} and
             p.suffix in {'.json', '.md'} and p.name not in {'dsh_status.json','revision_transaction.json'}))


def recover_transaction(project):
    project = Path(project).resolve()
    index = project/'reports/revision_transaction.json'
    record = read(index)
    if record.get('status') != 'prepared': return
    backup_root = project/'reports/revisions/transactions'
    for row in record['files']:
        path, backup = project/row['path'], project/row['backup']
        if (not _allowed(row['path']) or not path.resolve().is_relative_to(project) or path.is_symlink()
                or backup.is_symlink() or not backup.resolve().is_relative_to(backup_root.resolve())
                or not backup.is_file() or sha256_file(backup) != row['sha256']):
            raise RuntimeError('invalid revision rollback evidence')
    # Files newly created by this transaction are listed before any mutation.
    for rel in record.get('new_files', []):
        if not _allowed(rel) or not (project/rel).resolve().is_relative_to(project):
            raise RuntimeError('unsafe revision rollback target')
    for row in record['files']:
        atomic = (project/row['path']).with_suffix('.revision-restore')
        shutil.copy2(project/row['backup'], atomic)
        os.replace(atomic, project/row['path'])
    for rel in record.get('new_files', []): (project/rel).unlink(missing_ok=True)
    atomic_write_json(index, dict(record, status='rolled_back'))


def _begin(project, run_id, numbers):
    paths = {project/'out.pptx'}
    for folder, pattern in [('authoring','*.xml'),('reports','*.json'),('reports','*.md'),('reports/render_attempts','*.json')]:
        paths.update(p for p in (project/folder).glob(pattern) if _allowed(str(p.relative_to(project))))
    expected = ['reports/plan_acceptance.json','reports/delivery_manifest.json','reports/release_manifest.json',
                'reports/build_state.json','reports/delivery_issues.md']
    expected += [f'{folder}/slide-{n:02d}{suffix}' for n in numbers
                 for folder,suffix in [('authoring','.xml'),('reports/render_attempts','-cache.json')]]
    files=[]
    for i,path in enumerate(sorted(paths)):
        if not path.is_file(): continue
        if path.is_symlink(): raise ValueError('revision cannot mutate symlinked project evidence')
        backup=project/'reports/revisions/transactions'/run_id/f'{i}.bak'
        backup.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(path,backup)
        files.append({'path':str(path.relative_to(project)), 'backup':str(backup.relative_to(project)), 'sha256':sha256_file(backup)})
    record={'status':'prepared','run_id':run_id,'files':files,
            'new_files':[p for p in expected if not (project/p).exists()]}
    atomic_write_json(project/'reports/revision_transaction.json',record)
    return record


def reconcile_responses(project):
    if not (project/'reports/execution_budget.sqlite').exists(): return
    for path in (project/'reports/revisions').glob('*/page-*.json'):
        row=read(path)
        if not isinstance(row.get('response'),str) or row.get('sha256') != sha256_text(row['response']): continue
        if row.get('scope') != path.parent.name or type(row.get('attempt_id')) is not int: continue
        budget=WorkBudget(project,row['scope'],'user_revision')
        with budget.connect() as db:
            pending=db.execute('SELECT status FROM attempts WHERE id=? AND scope=? AND stage=? AND unit=?',
                (row['attempt_id'],row['scope'],'user_revision',path.stem)).fetchone()
        if pending == ('in_flight',): budget.finish(row['attempt_id'],detail='replayed saved revision response')


def revise(project, numbers, instruction, *, run_id, model_fn=None):
    from sol_common import render_sol as sol
    from sol_render import _prepare_render_state, _validate_batch_candidate, _write_render_success, SML_RULES
    from blueprint_validation import static_findings
    from quality_policy import blocking
    from plan_request import verify_plan_request, accept_request
    project=Path(project).resolve(); numbers=targets(numbers)
    if not instruction.strip(): raise ValueError('revision instruction is empty')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,96}',run_id): raise ValueError('invalid revision run')
    recover_transaction(project); reconcile_responses(project)
    prior=read(project/'reports/build_state.json')
    if prior.get('delivery_policy') == 'strict':
        raise ValueError('revision currently supports structural best-effort projects only; retain the existing strict workflow')
    verify_plan_request(project)
    if (project/'reports/handoff_receipt.json').exists():
        from import_handoff import verify_receipt
        verify_receipt(project)
    bp_path=project/'reports/blueprint.json'; bp=read(bp_path)
    brief=read(project/'reports/brief.json')
    original_hash=sha256_file(bp_path)
    pages={p['no']:p for p in bp['pages']}
    if not set(numbers) <= set(pages): raise ValueError('revision page outside blueprint')
    if blocking(static_findings(bp,brief)): raise ValueError('repair invalid blueprint before user revision')
    from sol_common import resolve_asset_target
    guarded={project/'reports/brief.json', project/'reports/handoff_receipt.json', project/'reports/asset_preflight.json',
             project/'reports/plan_request.json', project/'reports/plan_acceptance.json',
             project/'out.pptx', *list((project/'authoring').glob('slide-*.xml'))}
    guarded.update(resolve_asset_target(project/'assets',i['src']) for p in bp['pages'] for i in p.get('images',[]))
    input_hashes={p:sha256_file(p) if p.exists() else None for p in guarded}
    plan_requirements=read(project/'reports/plan_request.json')
    request_key=sha256_text(json.dumps({'pages':numbers,'instruction':instruction,
        'plan_request_sha256':plan_requirements.get('sha256'),
        'brief_sha256':input_hashes[project/'reports/brief.json']},ensure_ascii=False,sort_keys=True))
    index=project/'reports/revisions'/f'{request_key}.json'
    previous=read(index)
    scope=(previous.get('scope') if original_hash in {previous.get('base_sha256'),previous.get('accepted_sha256')}
           else sha256_text(request_key+original_hash))
    directory=project/'reports/revisions'/scope
    request={'scope':scope,'base_sha256':previous.get('base_sha256',original_hash) if scope==previous.get('scope') else original_hash,
             'instruction':instruction,'pages':numbers}
    if scope==previous.get('scope') and previous.get('accepted_sha256'): request['accepted_sha256']=previous['accepted_sha256']
    atomic_write_json(index,request)
    budget=WorkBudget(project,scope,'user_revision')
    merged=copy.deepcopy(bp); candidates={}; states={}
    model_fn=model_fn or sol
    for n in numbers:
        path=directory/f'page-{n}.json'; saved=read(path)
        if saved:
            if saved.get('scope')!=scope or not isinstance(saved.get('response'),str) or saved.get('sha256')!=sha256_text(saved['response']):
                raise ValueError('revision candidate response evidence changed')
            if type(saved.get('attempt_id')) is not int or saved['attempt_id'] < 1:
                raise ValueError('revision candidate missing ledger identity')
            with budget.connect() as db:
                admitted=db.execute('SELECT status FROM attempts WHERE id=? AND scope=? AND stage=? AND unit=?',
                    (saved['attempt_id'],scope,'user_revision',path.stem)).fetchone()
            if admitted is None or admitted[0] in {'in_flight','outcome_unknown'}:
                raise ValueError('revision candidate ledger mismatch or unresolved request')
            raw=saved['response']
        else:
            prompt=('用户明确要求定向改稿，不是缺陷修复。仅修改本页，保留来源、事实、限定条件和所有必保内容；'
                    '不修改图片需求/页号/角色/来源ID。同步输出完整蓝图 page 与完整 SML，避免下次复用旧文案。'
                    '原 layout 几何不可行时可重新构图，先保证正文可读。检查正文只包含给受众的业务内容，不加入作者备注。'
                    '继承仍适用的原规划要求；当前用户改稿请求在冲突时优先，不能借此改写未授权的事实。\n'
                    '返回一个 JSON 对象，且只有 page 和 sml 两个字段；sml 为 XML 字符串，不要 Markdown。\n'
                    +json.dumps({'user_instruction':instruction,'original_planning_requirements':plan_requirements.get('extra',''),
                                 'page':pages[n], 'theme':bp.get('theme'),
                                 'brief_must_keep':brief.get('must_keep',[]),
                                 'current_sml':(project/f'authoring/slide-{n:02d}.xml').read_text(encoding='utf-8')
                                    if (project/f'authoring/slide-{n:02d}.xml').exists() else None},ensure_ascii=False)
                    +'\n'+SML_RULES)
            from request_journal import admit, settle_error
            token=admit(budget,path.stem,prompt,request_kwargs={'max_tokens':16000,'timeout':900},automatic_limit=1)
            try:
                from workflow_runtime import model_request
                raw=model_request(project,'user_revision',prompt,model_fn,scope=scope,budget=budget,token=token,max_tokens=16000,timeout=900)
                token=budget.effective_token(token)
                if not isinstance(raw,str): raise ValueError('revision response must be text')
                atomic_write_json(path,{'scope':scope,'attempt_id':token,'response':raw,'sha256':sha256_text(raw)})
                budget.finish(token,detail='revision response persisted; validation follows')
            except Exception as exc:
                settle_error(budget,token,exc); raise
        response=json.loads(raw)
        if not isinstance(response,dict) or set(response)!={'page','sml'}: raise ValueError('invalid revision candidate envelope')
        page=response['page']
        if not isinstance(page,dict) or not isinstance(response['sml'],str): raise ValueError('invalid revision candidate types')
        for field in ('no','role','images','must_keep_ids','source_ids','decision_ids','artifact_ids','verbatim_fields'):
            if page.get(field)!=pages[n].get(field): raise ValueError('revision candidate changed protected '+field)
        merged['pages'][n-1]=page
        state=_prepare_render_state(project,merged,page,'',False)
        xml,errors,_=_validate_batch_candidate(state,response['sml'])
        if errors: raise ValueError('revision candidate rejected: '+json.dumps(errors,ensure_ascii=False))
        candidates[n]=xml; states[n]=state
    findings=blocking(static_findings(merged,brief))
    if findings: raise ValueError('revision candidate blueprint rejected: '+json.dumps(findings,ensure_ascii=False))
    # No mutation of accepted content occurred before all selected candidates passed.
    if sha256_file(bp_path)!=original_hash: raise ValueError('revision base changed during request')
    if any((sha256_file(p) if p.exists() else None)!=digest for p,digest in input_hashes.items()):
        raise ValueError('revision inputs changed during request')
    if (project/'reports/handoff_receipt.json').exists(): verify_receipt(project)
    record=_begin(project,run_id,numbers)
    try:
        atomic_write_json(bp_path,merged)
        for n in numbers: _write_render_success(states[n],candidates[n])
        checkpoint_path=project/'reports/plan_checkpoint.json'
        checkpoint=read(checkpoint_path)
        if checkpoint:
            for n in numbers:
                for field in ('accepted','drafts'): checkpoint.setdefault(field,{})[str(n)]=merged['pages'][n-1]
                checkpoint.setdefault('errors',{}).pop(str(n),None)
                for skeleton in checkpoint.get('outline',{}).get('pages',[]):
                    if skeleton.get('no')==n:
                        skeleton.update({k:v for k,v in merged['pages'][n-1].items() if k in skeleton})
            atomic_write_json(checkpoint_path,checkpoint)
        (project/'reports/blueprint-cache.json').unlink(missing_ok=True)
        plan_request=read(project/'reports/plan_request.json')
        if plan_request: accept_request(project,plan_request,origin='user_revision')
        atomic_write_json(project/'reports/runs'/run_id/'workflow_contract.json',
                          {'delivery_policy':'best-effort','visual_mode':'off','user_revision':scope})
        report=export_best_effort(project,project/'out.pptx',run_id=run_id)
        # A revision must not introduce a placeholder or downgrade another page.
        old_manifest=next((read(project/r['backup']) for r in record['files'] if r['path']=='reports/delivery_manifest.json'),{})
        old_ranks={r['page_no']:r['status'] for r in old_manifest.get('pages',[])}
        rank={'validated':0,'imperfect':1,'placeholder':2}
        if any(r['page_no'] in numbers and r['status']!='validated' or
               rank[r['status']]>rank.get(old_ranks.get(r['page_no']),2) for r in report['pages']):
            raise ValueError('revision candidate regressed delivered pages')
        # Existing unrelated limitations may remain, new whole-deck blockers may not.
        old_errors={(e.get('code'),e.get('page') or e.get('page_no')) for e in old_manifest.get('quality',{}).get('errors',[])}
        if any((e.get('code'),e.get('page') or e.get('page_no')) not in old_errors for e in report['quality']['errors']):
            raise ValueError('revision candidate introduced whole-deck findings')
        atomic_write_json(index,dict(request,accepted_sha256=sha256_file(bp_path)))
        atomic_write_json(project/'reports/revision_transaction.json',dict(record,status='committed'))
        return report
    except BaseException:
        recover_transaction(project)
        raise


def main():
    import argparse
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--project',required=True); p.add_argument('--pages',required=True)
    p.add_argument('--instruction-file',required=True); p.add_argument('--run-id',required=True)
    a=p.parse_args()
    print(json.dumps(revise(Path(a.project),targets(a.pages),Path(a.instruction_file).read_text(encoding='utf-8'),run_id=a.run_id),ensure_ascii=False))


if __name__=='__main__': main()
