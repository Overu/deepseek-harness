"""Nonblocking pre-render design triage and bounded SOL-authored refinement.

Signals select work, never grade beauty or prescribe an image/layout quota.
One durable opportunity per planning scope; no automatic retry or local design.
"""
import copy
import json
import math
import os
import re
from collections import defaultdict
from pathlib import Path
from brief_contract import digest
from stage_runtime import atomic_write_json
from workflow_runtime import model_request
from work_budget import WorkBudget,WorkStopped

DESIGN_REVIEW_REVISION='copy-and-image-guards-v1'

_COPY_KEYS={'text','title','subtitle','label','labels','caption','content','value','values',
            'cells','rows','headers','series','data','name'}
_STYLE_KEYS={'color','fill','font','fontFamily','fontSize','font_size','width','height',
             'style','id','src','type','area','design_note','design_notes','visual_intent'}


def layout_copy_values(layout):
    """Common visible props only; this is not an arbitrary-schema semantic proof."""
    def walk(value,visible=False):
        if isinstance(value,dict):
            for k,v in value.items():
                if k not in _STYLE_KEYS:yield from walk(v,visible or k in _COPY_KEYS)
        elif isinstance(value,list):
            for v in value:yield from walk(v,visible)
        elif visible and isinstance(value,(str,int,float)) and not isinstance(value,bool):
            yield str(value)
    for block in layout.get('blocks',[]):yield from walk(block.get('props',{}))


def check_design_copy(original,layout):
    # Only this optional rearrangement lane is copy-frozen. Normal planning and
    # rendering still own fluent copy; failure here just keeps the valid original.
    corpus=[original.get('title',''),original.get('takeaway',''),*original.get('content',[]),
            *layout_copy_values(original.get('layout',{}))]
    compact=lambda text:re.sub(r'\s+','',str(text))
    corpus=[compact(s) for s in corpus]
    for value in layout_copy_values(layout):
        value=compact(value)
        if re.fullmatch(r'[-+]?\d+(?:\.\d+)?[%％]?',value):
            tokens={v.rstrip('%％') for s in corpus for v in re.findall(r'[-+]?\d+(?:\.\d+)?[%％]?',s)}
            if value.rstrip('%％') not in tokens:
                raise ValueError('design-only layout introduces a new numeric value')
        if value and not any(value in s for s in corpus):
            raise ValueError('design-only layout introduces new visible copy')


def design_targets(signals):
    """Sample work, not design values: bound output even for a 200-page deck."""
    numbers=sorted({n for s in signals for n in s['pages']})
    if len(numbers)<=6:return numbers
    return [numbers[round(i*(len(numbers)-1)/5)] for i in range(6)]


def design_sequence(blueprint):
    return [{'no':p['no'],'role':p.get('role'),
             'layout_id':(p.get('layout') or {}).get('layout_id'),
             'block_types':[b.get('type') for b in (p.get('layout') or {}).get('blocks',[])],
             'image_roles':[im.get('role') for im in p.get('images',[])]}
            for p in blueprint.get('pages',[])]


def _text_structure(blocks):
    """Read-only geometry signature; list order is not spatial structure."""
    result = []
    for block in blocks:
        area = block.get('area')
        if (not isinstance(area, list) or len(area) != 4
                or any(type(v) not in {int, float} or not math.isfinite(v) for v in area)):
            return None
        kind = str(block.get('type', '')).lower().replace('_', '-')
        result.append((kind, tuple(area)))
    return result


def _similar_structure(left, right):
    if left is None or right is None or len(left) != len(right):
        return False
    unmatched = list(right)
    for kind, area in left:
        candidates = [(max(abs(a-b) for a, b in zip(area, other)), i)
                      for i, (other_kind, other) in enumerate(unmatched) if kind == other_kind]
        if not candidates:
            return False
        distance, index = min(candidates)
        if distance > .01:
            return False
        unmatched.pop(index)
    return True


def design_signals(blueprint,brief):
    signals=[];run=[];previous=None
    def flush():
        if len(run)>=4:
            signals.append({'code':'uniform_text_run','pages':list(run),
                'evidence':'连续多页使用近似多块文字/卡片几何（忽略对象顺序和小幅坐标噪声）；可能是合理系列，也可能是未做信息设计。'})
    for p in blueprint.get('pages',[]):
        blocks=[b for b in (p.get('layout') or {}).get('blocks',[])
                if str(b.get('type','')).lower() not in {'line','divider','background','decoration','decorative','logo'}]
        multi_text=len(blocks)>=2 and all(str(b.get('type','')).lower() in {'text','card','text-card','text_card'} for b in blocks)
        main_images=[im for im in p.get('images',[]) if im.get('role') not in {'background','decorative'}]
        signature=_text_structure(blocks) if multi_text and not main_images else None
        if signature is None or not _similar_structure(signature,previous):
            flush();run=[]
            # Anchor to the first page, not the previous one: gradual layout
            # drift must not join substantially different layouts indefinitely.
            previous=signature
        if signature is not None:run.append(p['no'])
    flush()
    assets={a.get('asset_id'):a for a in brief.get('available_assets',[])}
    uses=defaultdict(set)
    for p in blueprint.get('pages',[]):
        for im in p.get('images',[]):
            if im.get('role') not in {'hero','detail'}:continue
            a=assets.get(im.get('asset_id'),{})
            identity=a.get('sha256') or im.get('asset_id') or im.get('src')
            if identity:uses[str(identity)].add(p['no'])
    for identity,numbers in uses.items():
        if len(numbers)>=4:
            signals.append({'code':'repeated_main_visual','pages':sorted(numbers),'asset_identity':identity,
                'evidence':'同一主视觉用于多页。判断品牌母题/产品证据复用，还是用不适配图片填充不同情境。'})
    return signals


def refinement_prompt(blueprint,brief,signals):
    from plan_repair import page_contract_prompt
    targets=set(design_targets(signals))
    # Pages already contain accepted copy. Do not resend raw source-page units.
    context={k:v for k,v in brief.items() if k in {
        'current_request','objective','audience','visual_dna','constraints',
        'decisions','decision_ledger','available_assets','asset_recommendations'}}
    return ('DESIGN_REFINEMENT\n你是演示设计总监。这是生图/渲染前的有界设计改善，不是截图验收。'
        '信号只提示查看，不代表不合格，不按数量配额改稿。先判断是否有真实的信息表达或视觉节奏问题；'
        '有意系列对照、优秀文字主导页、品牌母题可保留；不为凑变化改动。'
        '用户要精美时不能仅因结构合法或已有资产多就降低设计目标。'
        '数据/比较/流程用准确图表或关系图。本次有界改善只用原生图形、已规划图像或可用原图，不新增或改写付费生图任务；必要新场景图属于正常首轮规划的职责。'
        'KV/标志/相似视频帧不等于可覆盖所有场景的照片。生成图不得冒充真实产品证据或数据。'
        '只返回JSON {"verdict":"keep|improve","reason":"具体判断",'
        '"pages":[{"no":页号,"set":{"layout":完整布局,"images":完整图片列表,"complexity":"normal"}}]}。'
        'keep时pages=[]。只修改本次pages列出的最多六页，set只含需要修改的layout/images/complexity；'
        '未涉及页、标题、正文、结论、事实数字和来源不动。布局内可见文案只能从本页原文取连续片段（可排版换行），不改数字、不造标签、不加制作说明。'
        '已有证据图片不得删除或替换来源；沿用既有页面合同字段，不虚构asset_id。生图提示合同只适用于沿用已规划的任务，不授予本次新增任务的权限。'
        '一次给出可执行的合理改善；不要输出“还需再审”的循环待办。\n'
        +page_contract_prompt(brief)+'\n'
        +json.dumps({'current_request':brief.get('current_request',''),'brief':context,
                    'render_contract':(blueprint.get('theme') or {}).get('render_contract'),
                    'design_sequence':design_sequence(blueprint),'signals':signals,
                    'planned_images':[im for p in blueprint['pages'] for im in p.get('images',[])],
                    'pages':[p for p in blueprint['pages'] if p['no'] in targets]},ensure_ascii=False,separators=(',',':')))


def refine_design(root,blueprint,brief,scope,model_fn):
    """Return original or validated model changes plus newly admitted call count."""
    root=Path(root);reports=root/'reports';before=digest(blueprint)
    directory=reports/'design_reviews'/scope;receipt=directory/'receipt.json';raw_path=directory/'response.json'
    signals=design_signals(blueprint,brief);targets=set(design_targets(signals));calls=0
    def finish(status,result=None,*,persist=True,**extra):
        result=blueprint if result is None else result
        record={'revision':DESIGN_REVIEW_REVISION,'status':status,'scope':scope,'input_sha256':before,'result_sha256':digest(result),
                'signals':signals,'selected_pages':sorted(targets),
                'visual_review_status':'not_performed',**extra}
        atomic_write_json(reports/'design_review.json',record)
        if persist:atomic_write_json(receipt,dict(record,result=result))
        return result,calls
    if receipt.exists():
        try:
            prior=json.loads(receipt.read_text(encoding='utf-8'))
            if not isinstance(prior,dict) or prior.get('revision')!=DESIGN_REVIEW_REVISION:
                raise ValueError('old design receipt requires current guards; retain current plan without rebuying')
            if not isinstance(prior,dict) or before not in {prior.get('input_sha256'),prior.get('result_sha256')} or digest(prior.get('result'))!=prior.get('result_sha256'):
                raise ValueError('receipt hash mismatch')
            from sol_plan import _validate_blueprint
            candidate=copy.deepcopy(prior['result'])
            _validate_blueprint(candidate,len(blueprint['pages']),brief)
            atomic_write_json(reports/'design_review.json',{k:v for k,v in prior.items() if k!='result'})
            return candidate,0
        except (ValueError,TypeError,KeyError,AttributeError) as exc:
            return finish('deferred',persist=False,reason='unusable design receipt: '+str(exc))
    if not signals:return finish('no_signals')
    if (reports/'build_state.json').exists() or any((root/'authoring').glob('slide-*.xml')):
        return finish('deferred',reason='already_rendered: no automatic redesign of existing deliverables')
    run_id=os.environ.get('PPT_BUILD_RUN_ID')
    if run_id and (reports/'cancel'/f'{run_id}.json').exists():
        return finish('deferred',reason='cancelled')
    budget=WorkBudget(root,scope,'design_refinement')
    if raw_path.exists():
        try:
            saved=json.loads(raw_path.read_text(encoding='utf-8'))
            if saved.get('input_sha256')!=before:raise ValueError('stale saved response')
            response=saved['response']
        except (ValueError,TypeError,KeyError,AttributeError) as exc:
            return finish('deferred',reason=str(exc))
    else:
        from request_journal import admit, settle_error
        prompt=refinement_prompt(blueprint,brief,signals)
        request_kwargs={'max_tokens':min(32000,max(5000,1500+len(targets)*1000)), 'timeout':900}
        try:token=admit(budget,'design-pass',prompt,request_kwargs=request_kwargs,automatic_limit=1)
        except WorkStopped as exc:return finish('deferred',reason=str(exc))
        from request_journal import response_ready
        calls=int(not response_ready(budget,token))
        try:
            response=model_request(root,'design_refinement',prompt,model_fn,
                scope=scope,budget=budget,token=token,**request_kwargs)
            atomic_write_json(raw_path,{'input_sha256':before,'response':response})
        except Exception as exc:
            settle_error(budget,token,exc)
            return finish('deferred',reason=type(exc).__name__)
        budget.finish(token,remaining=0,detail='one-shot design opportunity persisted; no repeat on resume')
    from brief_capacity import parse_brief_object
    from sol_plan import _validate_blueprint
    try:
        proposal=parse_brief_object(response.get('content','') if isinstance(response,dict) else response)
        if proposal.get('verdict') not in {'keep','improve'} or not isinstance(proposal.get('pages'),list):
            raise ValueError('invalid design review envelope')
        if not isinstance(proposal.get('reason'),str) or not proposal['reason'].strip():
            raise ValueError('design decision requires a reason')
        if proposal['verdict']=='keep':
            if proposal['pages']:raise ValueError('keep cannot contain changes')
            return finish('kept',reason=proposal['reason'])
    except (ValueError,TypeError,AttributeError) as exc:
        return finish('deferred',reason=str(exc))
    candidate=copy.deepcopy(blueprint);changed=[];rejected=[];seen=set()
    generated={im['src']:im for p in blueprint['pages'] for im in p.get('images',[]) if not im.get('asset_id')}
    for item in proposal['pages']:
        try:
            n=item.get('no');updates=item.get('set')
            if type(n) is not int or n not in targets or n in seen:raise ValueError('unexpected/duplicate design target')
            seen.add(n)
            if not isinstance(updates,dict) or not updates or set(updates)-{'layout','images','complexity'}:
                raise ValueError('design patch attempts locked business fields')
            trial=copy.deepcopy(candidate);page=trial['pages'][n-1]
            old_evidence=[i for i in page.get('images',[]) if i.get('role')=='evidence']
            if 'layout' in updates:check_design_copy(page,updates['layout'])
            page.update(copy.deepcopy(updates))
            for im in page.get('images',[]):
                if not im.get('asset_id'):
                    prior=generated.get(im.get('src'))
                    if not prior or any(im.get(k)!=prior.get(k) for k in ('desc','requirement','aspect')):
                        raise ValueError('design opportunity cannot add or change paid image demand')
            for old in old_evidence:
                if not any(i.get('src')==old.get('src') and i.get('asset_id')==old.get('asset_id')
                           and i.get('role')=='evidence' for i in page.get('images',[])):
                    raise ValueError('design patch removes evidence asset')
            _validate_blueprint(trial,len(blueprint['pages']),brief)
            candidate=trial;changed.append(n)
        except (ValueError,TypeError,KeyError,IndexError,AttributeError) as exc:
            rejected.append({'page':item.get('no') if isinstance(item,dict) else None,'reason':str(exc)})
    return finish('improved' if changed else 'deferred',candidate,changed_pages=changed,
                  rejected=rejected,reason=proposal['reason'])
