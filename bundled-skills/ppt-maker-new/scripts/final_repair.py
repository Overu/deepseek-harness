"""A durable progress-based closing stage after full-count export.

Ordinary generation/retry policy is untouched. Responses remain isolated from
authoring; only revalidated exact SML eligible for working delivery may replace
a selection. One conditional follow-up is not an unlimited recovery loop.
"""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import time

from call_budget import BudgetExhausted
from delivery import read, export_best_effort, verify_working_delivery, usable_imperfect
from quality_policy import blocking, candidate_improves
from recovery_feedback import select_base
from sol_common import render_sol as sol
from stage_runtime import atomic_write_json, sha256_file, sha256_text
from work_budget import WorkBudget


def reconcile_saved_responses(project):
    """Confirm only hash-bound final responses that actually returned.

    Called under the managed project lock before its unknown-request guard.
    No response/no matching hash means the request remains unresolved.
    """
    project = Path(project)
    if not (project/'reports/execution_budget.sqlite').is_file(): return
    for path in (project/'reports/final_repair_candidates').rglob('*.json'):
        row = read(path)
        if row.get('response') is None and type(row.get('attempt_id')) is int:
            lineage=WorkBudget(project,row.get('prompt_sha256'),'final_repair')
            row['attempt_id']=lineage.latest_token(row['attempt_id'])
            receipt=read(project/'reports/request_journal'/f"{row['attempt_id']}.json")
            if (receipt.get('attempt_id'),receipt.get('scope'),receipt.get('stage'),receipt.get('unit')) == (
                    row['attempt_id'],row.get('prompt_sha256'),'final_repair','page') and receipt.get('status')=='response_saved':
                from request_journal import saved_result
                saved_result(receipt)
                row.update(response=receipt['response'],response_sha256=receipt['response_sha256'],status='response_saved')
                atomic_write_json(path,row)
        raw, scope = row.get('response'), row.get('prompt_sha256')
        if (type(row.get('attempt_id')) is not int or row['attempt_id'] <= 0
                or not isinstance(raw, str) or not (scope == path.stem or
                    path.name == 'followup.json' and scope == path.parent.name)
                or row.get('response_sha256') != sha256_text(raw)):
            continue
        budget = WorkBudget(project, scope, 'final_repair')
        with budget.connect() as db:
            pending = db.execute('SELECT status FROM attempts WHERE id=? AND scope=? AND stage=? AND unit=?',
                (row.get('attempt_id'),scope,'final_repair','page')).fetchone()
        if pending == ('in_flight',):
            budget.finish(row['attempt_id'], detail='recovered hash-bound persisted final response')


def recover_pending_transaction(project, output):
    """Restore an interrupted delivery replacement before any new export.

    Managed build/deliver already owns the project lock. A persisted, hash-checked
    backup survives process death; rollback is idempotent if interrupted again.
    """
    project, output = Path(project).resolve(), Path(output).resolve()
    index = project/'reports/final_repair_transaction.json'
    transaction = read(index)
    if transaction.get('status') != 'prepared': return
    run_id = transaction['run_id']
    import re
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,96}', run_id) or run_id in {'.','..'}:
        raise RuntimeError('invalid final transaction run')
    run = project/'reports/runs'/run_id
    allowed = {output, project/'reports/delivery_manifest.json', project/'reports/release_manifest.json',
               project/'reports/build_state.json', project/'reports/delivery_issues.md',
               run/'delivery_manifest.json', run/'release_manifest.json', run/'delivery_integrity.json', run/'build_state.json'}
    allowed.update((run/'delivery_slides').glob('slide-*.xml'))
    if transaction.get('output_path') != str(output):
        raise RuntimeError('pending final transaction belongs to another output')
    rows = transaction['files']
    for row in rows:
        path, backup = Path(row['path']), Path(row['backup'])
        if path.resolve() not in allowed or path.is_symlink() or backup.is_symlink() or not backup.resolve().is_relative_to((run/'final_repair_backup').resolve()):
            raise RuntimeError('unsafe final transaction path')
        if row['existed'] and (not backup.is_file() or sha256_file(backup) != row['sha256']):
            raise RuntimeError('final rollback evidence changed')
    for row in rows:
        path, backup = Path(row['path']), Path(row['backup'])
        if row['existed']:
            restored = path.with_name('.'+path.name+'.final-restore')
            shutil.copy2(backup, restored); os.replace(restored, path)
        elif path.exists(): path.unlink()
    transaction['status'] = 'rolled_back'
    atomic_write_json(index, transaction)


def repair_before_delivery(project, output, *, run_id, initial, model_fn=None, workers=4,
                           extra_findings=None):
    from sol_render import _prepare_render_state, _validate_batch_candidate, _extract_slide, _repair_prompt
    from render_checkpoint import LOCAL_FAILURE_CODES
    project, output = Path(project).resolve(), Path(output).resolve()
    model_fn = model_fn or sol
    run = project/'reports/runs'/run_id
    contract = read(run/'workflow_contract.json')
    if contract.get('offline_delivery_only') or contract.get('delivery_policy') != 'best-effort':
        return initial
    recover_pending_transaction(project, output)
    reconcile_saved_responses(project)
    if verify_working_delivery(project, output):
        raise RuntimeError('final repair requires a current verified full-count working deck')
    blueprint = read(project/'reports/blueprint.json')
    bp_hash = sha256_file(project/'reports/blueprint.json')
    pages = {p['no']: p for p in blueprint['pages']}
    # Advisory-only pages are already usable, not automatic aesthetic rework.
    targets = [r for r in initial['pages'] if r['status'] != 'validated' and blocking(r.get('errors', []))]
    started = time.time()
    atomic_write_json(run/'final_repair.json', {'run_id':run_id, 'status':'running',
        'selected_pages':[r['page_no'] for r in targets], 'initial_output_sha256':initial['output_sha256']})

    def repair_one(row):
        number = row['page_no']
        outcome = {'page_no': number, 'status': 'deferred', 'calls': 0}
        try:
            if (project/'reports/cancel'/f'{run_id}.json').exists():
                raise RuntimeError('cancelled run')
            codes = {e.get('code') for e in row.get('errors', [])}
            non_model = LOCAL_FAILURE_CODES | {'font_not_installed', 'model_call_failed', 'source_receipt_invalid'}
            if codes & non_model:
                outcome['reason'] = 'dependency_or_transport_failure'; return outcome, None
            style = ''
            if not (blueprint.get('theme') or {}).get('render_contract'):
                cache = read(project/'reports/render_attempts'/f'slide-{number:02d}-cache.json')
                matching = [read(p) for p in (project/'reports/render_checkpoints').glob('*.json')]
                style = cache.get('legacy_style_text', next((r.get('legacy_style_text','') for r in matching
                             if r.get('page_no') == number and r.get('prompt_hash') == row.get('prompt_sha256')), ''))
            state = _prepare_render_state(project, blueprint, pages[number], style, False)
            if state['prompt_hash'] != row['prompt_sha256']:
                outcome['reason'] = 'page_identity_changed'; return outcome, None
            best, history = select_base(state)
            from recovery_feedback import repair_feedback, record_attempt
            if not best:
                outcome['reason'] = 'no_model_draft; inspect initial request outcome'; return outcome, None
            # Fresh local validation is authoritative; prior QA evidence is also
            # supplied, but never paired with a different draft as if measured there.
            previous = dict(delivery_selection_sha256=row['sml_sha256'], errors=row.get('errors', []),
                            source='prior_delivery_diagnostics_not_measurements_of_placeholder')
            budget = WorkBudget(project, state['prompt_hash'], 'final_repair')
            paths = [project/'reports/final_repair_candidates'/(state['prompt_hash']+'.json'),
                     project/'reports/final_repair_candidates'/state['prompt_hash']/'followup.json']
            checked_findings = list(best[1])
            from render_checkpoint import save_draft
            for index, path in enumerate(paths):
                saved = read(path)
                if saved and (saved.get('prompt_sha256') != state['prompt_hash'] or saved.get('page_no') != number):
                    outcome['reason'] = 'candidate_identity_invalid'; return outcome, None
                raw = saved.get('response')
                if saved and raw is None and type(saved.get('attempt_id')) is int:
                    old=budget.latest_token(saved['attempt_id'])
                    with budget.connect() as db:
                        old_status=db.execute('SELECT status FROM attempts WHERE id=? AND scope=? AND stage=?',
                                             (old,state['prompt_hash'],'final_repair')).fetchone()
                    if old_status == ('outcome_unknown',):
                        # Resume the same bounded transport chain, not a new
                        # quality opportunity; reserve enforces its durable cap.
                        saved={}
                if raw is not None:
                    if type(saved.get('attempt_id')) is not int or saved['attempt_id'] <= 0:
                        outcome['reason'] = 'candidate_identity_invalid'; return outcome, None
                    if not isinstance(raw, str) or saved.get('response_sha256') != sha256_text(raw):
                        outcome['reason'] = 'candidate_hash_invalid'; return outcome, None
                    outcome['replayed'] = True
                    with budget.connect() as db:
                        pending = db.execute('SELECT status FROM attempts WHERE id=? AND scope=? AND stage=? AND unit=?',
                            (saved['attempt_id'],state['prompt_hash'],'final_repair','page')).fetchone()
                    if pending == ('in_flight',):
                        budget.finish(saved['attempt_id'], detail='recovered persisted response')
                elif saved:
                    outcome['reason'] = saved.get('reason') or 'outcome_unknown'; return outcome, None
                else:
                    with budget.connect() as db:
                        pending = db.execute("SELECT 1 FROM attempts WHERE (scope=? OR scope LIKE ?) AND stage != 'final_repair' AND status='in_flight' LIMIT 1",(state['prompt_hash'],state['prompt_hash']+':%')).fetchone()
                    if pending:
                        outcome['reason'] = 'outcome_unknown'; return outcome, None
                    if any(e.get('code') in non_model for e in best[1]):
                        outcome['reason'] = 'dependency_or_transport_failure'; return outcome, None
                    token = budget.reserve('page', automatic_limit=index+1)
                    saved = {'page_no': number, 'prompt_sha256': state['prompt_hash'],
                             'base_sml_sha256': sha256_text(best[0]), 'attempt_id': token,
                             'base_findings': best[1], 'status': 'in_flight', 'origin_run_id': run_id}
                    saved['repair_strategy'] = repair_feedback(best[0], best[1], history + [previous], final=True)['strategy']
                    atomic_write_json(path, saved)
                    prompt = _repair_prompt(state['original_prompt'], best[0], best[1],
                                            history + [previous], final=True)
                    if index:
                        prompt += '\nThis is the last targeted follow-up: resolve the remaining findings while preserving achieved readability. If constraints conflict, change this page composition rather than repeating micro-adjustments. No further automatic call follows.'
                    try:
                        from workflow_runtime import model_request
                        raw = str(model_request(project,'final_repair',prompt,model_fn,scope=state['prompt_hash'],
                                                budget=budget,token=token,max_tokens=10000,timeout=900))
                    except Exception as exc:
                        saved.update(status='failed', reason='model_transport_error: '+str(exc))
                        atomic_write_json(path, saved)
                        from request_journal import settle_error
                        settle_error(budget,token,exc)
                        outcome['reason'] = saved['reason']; return outcome, None
                    finally:
                        outcome['calls'] += budget.submission_count(token)
                    saved.update(attempt_id=budget.effective_token(token),response=raw, response_sha256=sha256_text(raw), status='response_saved')
                    atomic_write_json(path, saved)
                    budget.finish(token, detail='response persisted; validate before delivery')
                try:
                    candidate, errors, _ = _validate_batch_candidate(state, _extract_slide(raw))
                except (ValueError, RuntimeError) as exc:
                    candidate, errors = raw, [{'code': 'invalid_model_xml', 'message': str(exc)}]
                checked_findings.extend(saved.get('base_findings',[]))
                history = record_attempt(state, best[0], saved.get('base_findings',best[1]), candidate, errors,
                    strategy=saved.get('repair_strategy', 'schema_repair'),
                    attempt_id='final_repair:' + str(saved['attempt_id']),
                    base_sha256=saved.get('base_sml_sha256'))
                save_draft(state, candidate, errors)  # Never promote imperfect work to success.
                if not errors or usable_imperfect(candidate, errors):
                    outcome.update(status='accepted_candidate', candidate_sha256=sha256_text(candidate),
                        candidate_findings=errors,
                        revalidated_codes=sorted({e['code'] for e in checked_findings if e.get('code')}))
                    return outcome, candidate
                outcome.update(status='retained', reason='candidate_not_safe', remaining_findings=errors)
                # Local edits require same-object progress; recomposition compares
                # defect-class burden independently of object indices. Base evidence
                # keeps this decision stable when resume selects the improved draft.
                progress = candidate_improves(saved.get('base_findings',best[1]), errors,
                                              strategy=saved.get('repair_strategy','schema_repair'))
                if index or not progress or any(e.get('code') in non_model for e in errors):
                    return outcome, None
                best = (candidate,errors)
                checked_findings.extend(errors)
            return outcome, None
        except BudgetExhausted as exc:
            outcome['reason'] = str(exc); return outcome, None
        except Exception as exc:
            outcome['reason'] = 'final_repair_error: '+str(exc); return outcome, None

    results = []
    if targets:
        with ThreadPoolExecutor(max_workers=max(1, min(int(workers), len(targets)))) as pool:
            results = list(pool.map(repair_one, targets))
    overrides = {r['page_no']: xml for r, xml in results if xml is not None}
    report = {'version': 1, 'run_id': run_id, 'stage': 'final_repair',
              'initial_output_sha256': initial['output_sha256'], 'blueprint_sha256': bp_hash,
              'pages': [r for r, _ in results], 'calls': sum(r['calls'] for r, _ in results),
              'status': 'no_eligible_pages' if not targets else 'retained', 'applied_pages': []}
    result = initial
    if overrides:
        # Snapshot the existing publication evidence. No accepted authoring is
        # mutated by this stage, and a failed replacement restores the initial deck.
        paths = [output, project/'reports/delivery_manifest.json', project/'reports/release_manifest.json',
                 project/'reports/build_state.json', project/'reports/delivery_issues.md',
                 run/'delivery_manifest.json', run/'release_manifest.json', run/'delivery_integrity.json', run/'build_state.json',
                 *list((run/'delivery_slides').glob('*.xml'))]
        backup_dir = run/'final_repair_backup'
        backup_dir.mkdir(parents=True, exist_ok=True)
        transaction = {'status':'prepared', 'run_id':run_id, 'output_path':str(output), 'files':[]}
        for i, path in enumerate(paths):
            backup = backup_dir/str(i)
            if path.is_file(): shutil.copy2(path, backup)
            transaction['files'].append({'path':str(path), 'backup':str(backup),
                'existed':path.is_file(), 'sha256':sha256_file(backup) if path.is_file() else None})
        atomic_write_json(project/'reports/final_repair_transaction.json', transaction)
        # Keep the backup and durable index when BaseException/process death
        # bypasses this normal exception handler.
        try:
            if sha256_file(project/'reports/blueprint.json') != bp_hash:
                raise RuntimeError('blueprint changed during final repair')
            if (project/'reports/cancel'/f'{run_id}.json').exists():
                raise RuntimeError('cancelled run')
            # Old external findings on changed pages need fresh evidence.
            # Unknown/unreproducible findings remain, so they cannot be waived.
            checked = {r['page_no']:set(r.get('revalidated_codes',[])) for r,_ in results}
            retained_findings = [e for e in (extra_findings or []) if not (
                (e.get('page') or e.get('page_no')) in overrides
                and e.get('code') in checked.get(e.get('page') or e.get('page_no'),set()))]
            result = export_best_effort(project, output, run_id=run_id,
                extra_findings=retained_findings, candidate_overrides=overrides,
                promote_candidates=False, recover_pending=False)
            applied = [r['page_no'] for r in result['pages'] if r['page_no'] in overrides
                       and r['status'] in {'validated','imperfect'} and r['sml_sha256'] == sha256_text(overrides[r['page_no']])]
            if not applied or verify_working_delivery(project, output):
                raise RuntimeError('replacement did not pass full delivery validation')
            old_pages = {r['page_no']:r for r in initial['pages']}
            if any(r['page_no'] not in applied and (r['sml_sha256'],r['status']) !=
                   (old_pages[r['page_no']]['sml_sha256'],old_pages[r['page_no']]['status']) for r in result['pages']):
                raise RuntimeError('unselected page changed during final assembly')
            report.update(status='improved', applied_pages=applied)
            transaction['status'] = 'committed'
            atomic_write_json(project/'reports/final_repair_transaction.json', transaction)
        except Exception as exc:
            recover_pending_transaction(project, output)
            result = initial
            report.update(status='retained', assembly_error=str(exc))
    report.update(duration_s=round(time.time()-started, 3),
                  output_sha256=result['output_sha256'], remaining_pages=result['attention_pages'])
    for row in report['pages']:
        if row['status'] == 'accepted_candidate':
            row['status'] = 'applied' if row['page_no'] in report['applied_pages'] else 'retained'
    atomic_write_json(run/'final_repair.json', report)
    atomic_write_json(project/'reports/final_repair.json', report)
    return result
