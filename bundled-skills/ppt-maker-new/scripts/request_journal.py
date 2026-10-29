"""Durable model responses. Callers hold the project execution lock when reconciling."""
import json
import os
import time
from stage_runtime import atomic_write_json, atomic_write_text, sha256_text


def request_key(prompt, kwargs):
    return sha256_text(prompt + json.dumps(kwargs, sort_keys=True, ensure_ascii=False))


def response_ready(budget, token):
    token=budget.effective_token(token)
    path=budget.path.parent/'request_journal'/f'{token}.json'
    return path.exists() and json.loads(path.read_text(encoding='utf-8')).get('status')=='response_saved'


def saved_result(record):
    from sol_common import ModelText
    raw = record.get('response')
    if not isinstance(raw, str) or record.get('response_sha256') != sha256_text(raw):
        raise ValueError('saved response hash mismatch')
    if record.get('result_kind') == 'dict':
        result = record['result']
        if record.get('result_sha256') != sha256_text(json.dumps(result, sort_keys=True, ensure_ascii=False)):
            raise ValueError('saved result metadata hash mismatch')
        return result
    return ModelText(dict(content=raw, usage=record.get('provider_usage'),
                         **{k: record.get(k) for k in ('model','response_id','finish_reason','requested_max_tokens')}))


def admit(budget, unit, prompt, *, request_kwargs, **admission):
    """Replay only an unconsumed, exact-input response; never replenish an allowance."""
    key = request_key(prompt, request_kwargs)
    with budget.connect() as db:
        rows = db.execute('SELECT id,status FROM attempts WHERE scope=? AND stage=? AND unit=? ORDER BY id DESC',
                          (budget.scope, budget.stage, unit)).fetchall()
    for token, status in rows:
        path = budget.path.parent/'request_journal'/f'{token}.json'
        if not path.exists():
            continue
        record = json.loads(path.read_text(encoding='utf-8'))
        if (record.get('attempt_id'), record.get('scope'), record.get('stage'), record.get('unit')) != (
                token, budget.scope, budget.stage, unit):
            raise ValueError('request receipt identity mismatch')
        if record.get('consumed') or record.get('request_key') != key or record.get('status') != 'response_saved':
            continue
        saved_result(record)
        if status not in {'in_flight','outcome_unknown','completed'}:
            continue
        with budget.connect() as db:
            db.execute("UPDATE attempts SET status='in_flight' WHERE id=?", (token,))
        return token
    return budget.reserve(unit, **admission)


def settle_error(budget, token, exc, *, remaining=None):
    """A parser error has a known response; a transport exception does not."""
    token=budget.effective_token(token)
    path = budget.path.parent/'request_journal'/f'{token}.json'
    record = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    with budget.connect() as db:
        row = db.execute('SELECT status FROM attempts WHERE id=?', (token,)).fetchone()
    if row != ('in_flight',):
        return
    if record.get('status') == 'response_saved':
        budget.finish(token, remaining=remaining, detail=type(exc).__name__)
    else:
        with budget.connect() as db:
            db.execute("UPDATE attempts SET status='outcome_unknown',detail=? WHERE id=?", (type(exc).__name__, token))


def set_context(model, state, kind, **extra):
    from work_budget import ValidationBudgetModel
    if isinstance(model,ValidationBudgetModel):
        model.request_context=dict(kind=kind,page_no=state['page_no'],prompt_hash=state['prompt_hash'],
                                   style_text=state.get('legacy_style_text',''),**extra)


def retryable_transport(exc):
    from http.client import RemoteDisconnected, IncompleteRead
    from urllib.error import URLError, HTTPError
    if isinstance(exc, HTTPError):
        return exc.code in {408,429,500,502,503,504}
    return isinstance(exc, (RemoteDisconnected, IncompleteRead, ConnectionError, TimeoutError)) or (
        isinstance(exc, URLError) and isinstance(exc.reason, (ConnectionError,TimeoutError,OSError)))


def invoke(budget, token, prompt, model, *, context=None, preserve_result=False, **kwargs):
    """Bounded text transport recovery; each submission keeps its own receipt/cost.

    Two replacement requests per persistent work unit, not per process/run. Layout
    failures never enter this loop; cancellation and configuration failures escape.
    """
    original=token
    while True:
        try:
            result=_invoke_once(budget,token,prompt,model,context=context,
                                preserve_result=preserve_result,**kwargs)
            budget.result_tokens[original]=token
            return result
        except Exception as exc:
            if budget.stage == 'design_refinement' or not retryable_transport(exc):
                raise
            token=budget.replace_unknown(token)
            time.sleep(1)


def _invoke_once(budget, token, prompt, model, *, context=None, preserve_result=False, **kwargs):
    with budget.connect() as db:
        row=db.execute('SELECT scope,stage,unit,status FROM attempts WHERE id=?',(token,)).fetchone()
    if not row or row[:2] != (budget.scope,budget.stage) or row[3] != 'in_flight':
        raise ValueError('request receipt has no matching admitted attempt')
    path=budget.path.parent/'request_journal'/f'{token}.json'
    if path.exists():
        previous=json.loads(path.read_text(encoding='utf-8'))
        if previous.get('status') == 'response_saved':
            if (previous.get('attempt_id'),previous.get('scope'),previous.get('stage'),previous.get('unit'),previous.get('request_key')) != (
                    token,row[0],row[1],row[2],request_key(prompt,kwargs)):
                raise ValueError('saved request binding mismatch')
            result=saved_result(previous)
            return result if preserve_result else previous['response']
        raise ValueError('existing request outcome is unknown; reconcile before retry')
    record={'attempt_id':token,'scope':row[0],'stage':row[1],'unit':row[2],
            'run_id':os.environ.get('PPT_BUILD_RUN_ID'),'prompt_sha256':sha256_text(prompt),
            'request_key':request_key(prompt,kwargs),
            'context':context or {},'status':'submitted','started':time.time()}
    atomic_write_json(path,record)
    try:
        from sol_common import response_metadata
        result = model(prompt, **kwargs)
        metadata = response_metadata(result)
    except BaseException as exc:
        from sol_common import RequestNotSubmitted
        from urllib.error import HTTPError
        status=('not_submitted' if isinstance(exc,RequestNotSubmitted) else
                'request_rejected' if isinstance(exc,(HTTPError,ValueError,TypeError)) and not retryable_transport(exc)
                else 'outcome_unknown')
        atomic_write_json(path,dict(record,status=status,reason=type(exc).__name__))
        with budget.connect() as db:
            db.execute("UPDATE attempts SET status=?,detail=? WHERE id=? AND status='in_flight'",
                       (status,type(exc).__name__,token))
        raise
    response = result.get('content') if isinstance(result,dict) else str(result)
    if not isinstance(response,str):
        # A returned malformed envelope is known data, not an uncertain transport.
        response=json.dumps(result,ensure_ascii=False,sort_keys=True)
    # Persist exact response BEFORE parsing, validation, checkpoints or ledger finish.
    original = ({'result_kind':'dict','result':result,
                 'result_sha256':sha256_text(json.dumps(result,sort_keys=True,ensure_ascii=False))}
                if isinstance(result,dict) else {'result_kind':'text'})
    with budget.connect() as db:
        current=db.execute('SELECT status FROM attempts WHERE id=?',(token,)).fetchone()
    if current != ('in_flight',):
        atomic_write_json(path.with_suffix('.late.json'),dict(record,**metadata,**original,
                          status='late_response',response=response,response_sha256=sha256_text(response)))
        raise ValueError('stale response: retired request cannot publish a candidate')
    atomic_write_json(path,dict(record,**metadata,**original,status='response_saved',response=response,
                               response_sha256=sha256_text(response),finished=time.time()))
    return result if preserve_result else response


def _restore(project, record):
    from quality_policy import progress_score
    context=record.get('context',{});raw=record['response'];kind=context.get('kind')
    if kind=='workflow':
        saved_result(record)
        # Parsing and applying still belong to the caller with its CURRENT inputs.
        # The exact request can be replayed without a new admission or provider call.
        return None
    if kind=='context_reading':
        from sol_context import restore_reading
        return restore_reading(project,record)
    if kind=='batch':
        key=record['prompt_sha256']
        if record['stage']!='render' or record['unit']!='batch:'+key:
            raise ValueError('batch request binding mismatch')
        path=project/'reports/render_responses'/(key+'.json')
        if path.exists() and json.loads(path.read_text(encoding='utf-8')).get('response') != raw:
            raise ValueError('batch cache conflicts with saved response; preserve both for inspection')
        atomic_write_json(path,{'response':raw})
        return 0
    if kind not in {'full','patch'}:
        raise ValueError('response has no supported render context')
    from sol_render import _prepare_render_state,_extract_slide,_validate_batch_candidate
    from render_checkpoint import save_draft
    blueprint=json.loads((project/'reports/blueprint.json').read_text(encoding='utf-8'))
    page=next(p for p in blueprint['pages'] if p['no']==context['page_no'])
    state=_prepare_render_state(project,blueprint,page,context.get('style_text',''),False)
    if state['prompt_hash']!=context['prompt_hash']:
        raise ValueError('response belongs to a different page input; inspect retained response')
    if kind=='full':
        try:
            candidate,errors,_=_validate_batch_candidate(state,_extract_slide(raw))
        except ValueError as exc:
            candidate,errors=raw,[{'code':'invalid_model_xml','message':str(exc)}]
    else:
        from sol_common import extract_json
        from sml_patch import bind_patch_response,apply_patch_transaction
        base=context['base_xml']
        candidate,errors,_=_validate_batch_candidate(state,base)
        try:
            response=extract_json(raw)
            if not isinstance(response,dict):
                raise ValueError('saved patch response is not an object')
            if response.get('action')!='full_rerender':
                response=bind_patch_response(response,base,page,run_id=context['run_id'],
                    round_number=context['round_number'],defect_ids=context['defect_ids'])
                working=project/'reports/reconciled_patches'/f"{record['attempt_id']}.xml"
                atomic_write_text(working,base)
                result=apply_patch_transaction(working,response,page,
                    validate_fn=lambda xml:_validate_batch_candidate(state,xml)[1],
                    expected_run_id=context['run_id'],expected_defect_ids=context['defect_ids'])
                if result.committed:
                    candidate,errors=working.read_text(encoding='utf-8'),[]
                elif result.candidate_xml:
                    candidate,errors=result.candidate_xml,result.errors
        except (ValueError,TypeError) as exc:
            errors=errors+[{'code':'invalid_model_patch','message':str(exc)}]
    save_draft(state,candidate,errors)
    return progress_score(errors)


def reconcile(project):
    """Recover only verifiable saved responses; never infer provider cancellation."""
    from work_budget import WorkBudget
    result={'recovered':[],'unresolved':[]}
    if not (project/'reports/execution_budget.sqlite').exists():
        return result
    budget=WorkBudget(project,'reconcile','inspection')
    with budget.connect() as db:
        rows=db.execute("SELECT id,scope,stage,unit,status FROM attempts WHERE status IN ('in_flight','outcome_unknown','completed') ORDER BY id").fetchall()
    for token,scope,stage,unit,status in rows:
        reason='no verifiable saved response; provider outcome remains unknown'
        path=project/'reports/request_journal'/f'{token}.json'
        if status=='completed' and not path.exists():
            continue
        try:
            if path.exists():
                record=json.loads(path.read_text(encoding='utf-8'))
                if status=='completed' and record.get('materialized'):
                    continue
                if (record['attempt_id'],record['scope'],record['stage'],record['unit'])!=(token,scope,stage,unit):
                    raise ValueError('request receipt identity mismatch')
                raw=record.get('response')
                if not isinstance(raw,str) or record.get('response_sha256')!=sha256_text(raw):
                    raise ValueError('response missing or hash mismatch')
                remaining=_restore(project,record)
            elif stage=='render' and unit.startswith('batch:'):
                # Legacy render batches already persist response under the exact
                # prompt hash recorded in their admitted unit. No guessed page IDs.
                key=unit.removeprefix('batch:')
                import re
                if not re.fullmatch('[a-f0-9]{64}',key):raise ValueError('legacy batch identity invalid')
                saved=json.loads((project/'reports/render_responses'/(key+'.json')).read_text(encoding='utf-8'))
                if not isinstance(saved.get('response'),str):raise ValueError('legacy response missing')
                remaining=0
            else:
                raise ValueError(reason)
            with budget.connect() as db:
                db.execute("UPDATE attempts SET status='completed',remaining=?,detail=? WHERE id=? AND status IN ('in_flight','outcome_unknown')",
                           (remaining,'reconciled saved response; no new call',token))
            result['recovered'].append(token)
            if path.exists():
                atomic_write_json(path,dict(record,materialized=True))
        except (OSError,ValueError,KeyError,TypeError,StopIteration,RuntimeError) as exc:
            # Completed historical responses may refer to intentionally revised input.
            # They do not reopen a settled request or alter current page identity.
            if status!='completed':
                # Coordinator holds the project lock and has checked no live
                # owner. Local execution ended; remote billing remains unknown.
                companion = (project/'reports/final_repair_candidates'/f'{scope}.json')
                has_candidate_response = (stage == 'final_repair' and companion.exists()
                                          and json.loads(companion.read_text(encoding='utf-8')).get('response') is not None)
                if not (path.exists() and json.loads(path.read_text(encoding='utf-8')).get('response') is not None) and not has_candidate_response:
                    with budget.connect() as db:
                        db.execute("UPDATE attempts SET status='outcome_unknown' WHERE id=? AND status='in_flight'",(token,))
                result['unresolved'].append({'attempt_id':token,'scope':scope,'stage':stage,'unit':unit,'reason':str(exc)})
    atomic_write_json(project/'reports/request_reconciliation.json',result)
    return result


def acknowledge_unknown(project, token, approval_id):
    """Explicit risk acceptance, NOT proof of cancellation or a retry grant."""
    if not approval_id or not str(approval_id).strip():
        raise ValueError('explicit approval identity required for unknown-outcome risk')
    result=reconcile_all(project)
    if token not in [row['attempt_id'] for row in result['unresolved']]:
        raise ValueError('attempt is not unresolved; do not acknowledge a recovered response')
    from work_budget import WorkBudget
    budget=WorkBudget(project,'reconcile','inspection')
    with budget.connect() as db:
        db.execute("UPDATE attempts SET status='abandoned_unknown',detail=? WHERE id=? AND status IN ('in_flight','outcome_unknown')",
                   ('user acknowledged possible duplicate billing; approval='+approval_id,token))
    return {'attempt_id':token,'status':'abandoned_unknown','approval_id':approval_id,
            'usage_preserved':True,'retry_allowance_added':False}


def reconcile_all(project):
    """Offline coordinator; no provider calls or automatic restart. Caller owns lock."""
    if (project/'reports/revisions').exists():
        from managed_revision import recover_transaction,reconcile_responses
        recover_transaction(project)
        reconcile_responses(project)
    if (project/'reports/final_repair_candidates').is_dir():
        from final_repair import reconcile_saved_responses
        reconcile_saved_responses(project)
    result=reconcile(project)
    from image_lineage import unresolved_images
    result['images']=unresolved_images(project)
    atomic_write_json(project/'reports/request_reconciliation.json',result)
    return result
