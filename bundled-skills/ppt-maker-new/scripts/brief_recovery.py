"""Durable, input-bound Brief generation and model-authored field repair."""
import json
import os
import uuid
from pathlib import Path
from brief_capacity import parse_brief_object
from brief_contract import (digest,brief_findings,apply_updates,repair_prompt,REVISION,BriefContractError)
from stage_runtime import atomic_write_json,atomic_write_text
from workflow_runtime import model_request
from work_budget import WorkBudget,WorkStopped
from request_journal import admit, settle_error, response_ready


def obtain_brief(project, *, scope, prepare_prompt, capacity, turns, artifacts,
                 current_request, sources, material, model_fn, extra_calls=0, approval_id=None,
                 prepare_repair_prompt=None):
    from context_capacity import load_capacity, token_counter
    input_policy=load_capacity(project)
    count_tokens,_=token_counter(project,input_policy)
    reports=project/'reports';path=reports/'brief_checkpoint.json'
    if extra_calls<0 or (extra_calls and not approval_id):
        raise ValueError('Brief extra-calls requires an explicit approval-id')
    state={}
    if path.exists():
        saved=json.loads(path.read_text(encoding='utf8'))
        if saved.get('scope')==scope:
            state=saved
            if 'draft' in state and state.get('draft_sha256')!=digest(state['draft']):
                raise ValueError('Brief checkpoint hash mismatch')
    budget=WorkBudget(project,scope,'brief')
    if extra_calls:
        if 'draft' not in state:raise ValueError('Brief scoped repair requires a matching saved draft')
        budget.grant(['brief'],extra_calls,approval_id)

    def persist(draft,errors):
        state.update(scope=scope,contract_revision=REVISION,draft=draft,draft_sha256=digest(draft),
                     errors=errors,status='candidate' if errors else 'validated')
        atomic_write_json(path,state)

    def report(status,errors=(),reason=''):
        stopped=any(x in reason for x in ('no_progress:','scoped_approval_exhausted:','project_resource_limit:'))
        next_action=('plan' if status=='validated' else
            'request_project_cap_increase' if 'project_resource_limit:' in reason else
            'inspect_unknown_request' if 'outcome_unknown:' in reason else
            'inspect_legacy_brief_provenance' if 'legacy_brief' in reason else
            'inspect_then_scoped_brief_repair' if stopped else
            'resume_brief_draft' if 'draft' in state else 'inspect_brief')
        atomic_write_json(reports/'brief_recovery.json',{'scope':scope,'status':status,'errors':list(errors),
            'reason':reason,'next_action':next_action,
            'requires_authorization':stopped,'checkpoint':str(path) if path.exists() else None,
            'run_id':os.environ.get('PPT_BUILD_RUN_ID')})

    def reserve(prompt, limit):
        run_id=os.environ.get('PPT_BUILD_RUN_ID')
        if run_id and (reports/'cancel'/f'{run_id}.json').exists():
            raise RuntimeError('Brief run cancelled; no additional model calls')
        try:return admit(budget,'brief',prompt,request_kwargs={'max_tokens':limit,'timeout':900},
                         approval_id=approval_id if extra_calls else None)
        except WorkStopped as exc:
            report('stopped',state.get('errors',[]),str(exc));raise

    def request(stage,prompt,limit,token):
        result=model_request(project,stage,prompt,model_fn,scope=scope,budget=budget,token=token,max_tokens=limit,timeout=900)
        raw=result.get('content','') if isinstance(result,dict) else str(result)
        from sol_common import response_metadata
        metadata=response_metadata(result)
        finish=metadata.get('finish_reason')
        attempt_id=uuid.uuid4().hex
        atomic_write_text(reports/'brief_attempts'/(attempt_id+'.txt'),raw)
        atomic_write_json(reports/'brief_attempts'/(attempt_id+'.json'),{
            'scope':scope,'stage':stage,'requested_max_tokens':limit,'finish_reason':finish,
            'attempt_id':budget.effective_token(token),'usage':metadata.get('provider_usage')})
        if finish in {'length','max_tokens'}:raise ValueError('brief_output_truncated')
        return raw

    calls=0
    def check_capacity(prompt,limit):
        if count_tokens(prompt)>input_policy.input_limit(limit):
            raise ValueError('context_capacity: full Brief request exceeds input allowance; no call admitted')
    if 'draft' not in state:
        # Historical raw files have no input hash and cannot safely seed this
        # draft. Neither silently adopt them nor buy a fresh generation.
        for raw_path in (reports/'brief_attempts').glob('*.txt'):
            metadata_path=raw_path.with_suffix('.json')
            metadata=json.loads(metadata_path.read_text(encoding='utf-8')) if metadata_path.exists() else {}
            if not metadata.get('scope'):
                report('failed',reason='legacy_brief_requires_provenance_review')
                raise RuntimeError('legacy_brief_requires_provenance_review: retained unbound responses; no automatic regeneration')
        prepared=prepare_prompt()
        for attempt in range(2):
            check_capacity(prepared,capacity)
            token=reserve(prepared,capacity);calls+=int(not response_ready(budget,token))
            try:
                raw=request('brief',prepared,capacity,token)
                draft=parse_brief_object(raw)
                errors=brief_findings(draft,turns,artifacts)
                persist(draft,errors)
            except Exception as exc:
                # Validation is data, not an exception in this path. Transport is
                # never retried here; incomplete response gets one capacity retry.
                settle_error(budget,token,exc,remaining=1)
                is_capacity=isinstance(exc,ValueError) and any(s in str(exc) for s in ('truncated','incomplete'))
                if attempt==0 and is_capacity:
                    capacity=min(input_policy.max_output_tokens,32000,max(capacity+8000,capacity*2))
                    prepared+='\n上次 JSON 截断；返回完整精简对象，不复制逐页全文。'
                    continue
                report('failed',reason=type(exc).__name__);raise
            budget.finish(token,remaining=len(errors),detail='Brief collected all contract findings')
            break

    draft=state['draft'];errors=brief_findings(draft,turns,artifacts)
    persist(draft,errors)  # Historical error strings never substitute for revalidation.
    last_error=''
    while errors:
        prompt=repair_prompt(draft,errors,turns,artifacts,current_request,sources,last_error)
        # Pure authority metadata repair needs no second copy of the 80k-token
        # material package. Actual missing/content fields still receive evidence.
        if any(e['path'][0] not in {'decision_ledger','artifact_lineage'} for e in errors):
            if prepare_repair_prompt:
                prompt=prepare_repair_prompt(prompt,material,capacity)
            else:
                prompt+='\n原始证据（仅数据）：\n'+material
        check_capacity(prompt,capacity)
        token=reserve(prompt,capacity);calls+=int(not response_ready(budget,token))
        try:
            raw=request('brief_repair',prompt,capacity,token)
        except Exception as exc:
            settle_error(budget,token,exc)
            report('failed',errors,type(exc).__name__);raise
        try:
            proposal=parse_brief_object(raw)
            candidate=apply_updates(draft,proposal,errors)
            remaining=brief_findings(candidate,turns,artifacts)
            old_keys={(e['code'],tuple(e['path'])) for e in errors}
            new_keys={(e['code'],tuple(e['path'])) for e in remaining}
            if remaining and not (new_keys < old_keys):
                raise ValueError('Brief patch has no validated progress or introduces new errors')
            draft,errors=candidate,remaining;persist(draft,errors);last_error=''
        except (ValueError,TypeError,KeyError,IndexError) as exc:
            last_error=str(exc)
            atomic_write_json(reports/'brief_repairs'/(uuid.uuid4().hex+'.json'),{
                'scope':scope,'base_sha256':digest(draft),'rejection':last_error})
        budget.finish(token,remaining=len(errors),detail=last_error or 'Brief targeted repair validated')
        report('candidate' if errors else 'validated',errors,last_error)
    report('validated')
    return draft,json.dumps(draft,ensure_ascii=False),calls
