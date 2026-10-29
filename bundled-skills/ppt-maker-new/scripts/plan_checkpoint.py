"""Durable accepted pages and progress-bounded, model-authored planning repair."""
import copy
import json
import uuid
from pathlib import Path
from stage_runtime import atomic_write_json
from plan_repair import page_hash, apply_page_patch
from ppt_contract import planning_ranges
from work_budget import WorkBudget, WorkStopped
from audience_copy import validation_scope
from quality_policy import progress_score


def save_checkpoint(root, scope, outline, accepted, drafts, errors):
    path = Path(root) / 'reports/plan_checkpoint.json'
    previous = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    state = {'scope': scope, 'outline': outline, 'accepted': accepted,
             'drafts': drafts, 'errors': errors}
    if previous.get('scope') == scope:
        state['repair_units'] = previous.get('repair_units', {})
        state['repair_stages'] = previous.get('repair_stages', {})
    atomic_write_json(path, state)
    return state


def load_checkpoint(root, scope):
    path = Path(root) / 'reports/plan_checkpoint.json'
    if not path.exists():
        return None
    state = json.loads(path.read_text(encoding='utf-8'))
    if state.get('scope') != scope:
        return None
    for field in ('accepted', 'drafts', 'errors'):
        state[field] = {int(n): p for n, p in state[field].items()}
    return state


def repair_checkpoint(root, state, topic, brief, style, model, *, max_tokens,
                      targets=None, extra_calls=0, approval_id=None):
    from sol_plan import (build_targeted_plan_repair_prompt, _normalize_model_result,
                          parse_complete_jsonl_records, _validated_partial_pages, static_findings)
    from workflow_runtime import model_request
    outline, accepted, drafts, errors = (state[k] for k in ('outline', 'accepted', 'drafts', 'errors'))
    missing = {int(p['no']) for p in outline['pages']} - set(accepted)
    selected = sorted(missing if targets is None else set(targets))
    if not set(selected) <= missing:
        raise ValueError('repair targets must be unresolved pages; accepted pages are locked')
    if extra_calls < 0 or (extra_calls and (not targets or not approval_id)):
        raise ValueError('extra calls require explicit targets and approval-id')
    # Batch only unresolved pages; use the same output capacity model as detail planning.
    capacity = max(1, int((max_tokens * .75 - 1600) / (1100 if any(n not in drafts for n in selected) else 700)))
    groups = [selected[i:i + capacity] for i in range(0, len(selected), capacity)]
    # Keep the original work identity when seven failed pages shrink to just page 42.
    # A new run or narrower target selection must not reset no-progress history.
    unit_map = state.setdefault('repair_units', {})
    grouped = {}
    for group in groups:
        default_unit = 'pages:' + ','.join(map(str, group))
        for n in group:
            unit = unit_map.setdefault(str(n), default_unit)
            grouped.setdefault(unit, []).append(n)
    atomic_write_json(Path(root) / 'reports/plan_checkpoint.json', state)
    groups = [members[i:i+capacity] for members in grouped.values() for i in range(0,len(members),capacity)]
    if extra_calls and len(grouped) != 1:
        raise ValueError('one scoped approval must target one persistent repair unit')
    calls = 0
    stops = []
    for group in groups:
        unit = unit_map[str(group[0])]
        stage = state.setdefault('repair_stages', {}).setdefault(unit,
            'plan_detail_resume' if all(n not in drafts for n in group) else 'plan_repair')
        atomic_write_json(Path(root) / 'reports/plan_checkpoint.json', state)
        budget = WorkBudget(root, validation_scope(root, state['scope'], stage, unit), stage)
        if extra_calls:
            budget.grant([unit], extra_calls, approval_id)
        pending = list(group)
        while pending:
            request_id = uuid.uuid4().hex
            bases = {n: copy.deepcopy(drafts[n]) for n in pending if n in drafts}
            request_path = Path(root) / 'reports/plan_repairs' / (request_id + '.json')
            prompt = build_targeted_plan_repair_prompt(topic, pending, brief, outline, style,
                                                       drafts=bases, rejected=errors)
            if stage == 'plan_detail_resume':
                prompt = ('RESUME_MISSING_DETAILS\n这些页面尚无完整详情，按锁定骨架完成正常详情；不要重写已完成页面。\n' + prompt)
            from request_journal import admit, settle_error
            try:
                token = admit(budget, unit, prompt, request_kwargs={'max_tokens':max_tokens,'timeout':1200},
                              approval_id=approval_id if extra_calls else None)
            except WorkStopped as exc:
                stops.append({'stage':stage,'scope':state['scope'],'targets':pending[:],'reason':str(exc)})
                atomic_write_json(Path(root) / 'reports/budget_stop.json', dict(stops[-1],
                    stopped_groups=stops, next_action='inspect_then_scoped_authorization'))
                if str(exc).startswith(('project_resource_limit:', 'outcome_unknown:')):
                    raise
                break
            atomic_write_json(request_path, {'targets': pending, 'base_hashes': {n: page_hash(p) for n, p in bases.items()},
                                             'scope': state['scope'], 'attempt': token})
            from request_journal import response_ready
            calls += int(not response_ready(budget,token))
            try:
                response = model_request(root, stage, prompt, model, scope=state['scope'],
                                         budget=budget, token=token, max_tokens=max_tokens, timeout=1200)
                raw = _normalize_model_result(response)['content']
                records = parse_complete_jsonl_records(raw)
                # Older SOL responses may use a pages envelope; values remain model-authored.
                if len(records) == 1 and isinstance(records[0].get('pages'), list):
                    records = [{'type': 'page_blueprint', 'page': p} for p in records[0]['pages']]
                proposed, patch_errors, seen = {}, {}, set()
                for record in records:
                    candidate = record.get('page') or record
                    n = candidate.get('no')
                    if n not in pending:
                        continue
                    if n in seen:
                        proposed.pop(n, None); patch_errors[n] = 'duplicate repair record'; continue
                    seen.add(n)
                    try:
                        if record.get('type') == 'page_patch':
                            if n not in bases or page_hash(drafts[n]) != page_hash(bases[n]):
                                raise ValueError('stale repair base; transaction rejected')
                            # Runtime binds the immutable request. Wrong legacy echoes are rejected, never corrected.
                            envelope = dict(record)
                            envelope.setdefault('base_sha256', page_hash(bases[n]))
                            authority = next(p for p in outline['pages'] if p['no'] == n)
                            candidate = apply_page_patch(bases[n], envelope, authority=authority)
                        elif record.get('type') != 'page_blueprint':
                            raise ValueError('repair requires page_patch or page_blueprint')
                        proposed[n] = candidate
                    except ValueError as exc:
                        patch_errors[n] = str(exc)
                valid, rejected = _validated_partial_pages({'pages': list(proposed.values())}, outline, set(pending))
                merged = dict(drafts); merged.update(accepted); merged.update(valid)
                findings = static_findings({'pages': [merged[n] for n in sorted(merged)],
                                            'page_count': outline['page_count']}, brief,
                                           complete=len(merged) == outline['page_count'])
                for finding in findings:
                    n = finding.get('page')
                    if n in pending:
                        valid.pop(n, None)
                        rejected[n] = rejected.get(n, '') + '; ' + finding['code'] + ': ' + finding['message']
                    elif n in accepted:
                        # A patch must not invalidate already accepted pages through a cross-page constraint.
                        for target in list(valid):
                            valid.pop(target)
                            rejected[target] = 'cross-page regression: ' + finding['message']
                for n in pending:
                    if n in valid:
                        accepted[n] = valid[n]; drafts[n] = valid[n]; errors.pop(n, None)
                        for skeleton in outline['pages']:
                            if int(skeleton['no']) == n:
                                skeleton['layout_id'] = valid[n]['layout']['layout_id']
                                skeleton['complexity'] = valid[n]['complexity']
                    else:
                        # Keep a validly bound working draft for the next model repair, never as accepted output.
                        if n in proposed:
                            drafts[n] = proposed[n]
                        errors[n] = patch_errors.get(n) or rejected.get(n) or 'missing complete repair record'
                pending = [n for n in pending if n not in accepted]
                measured = [f for f in findings if f.get('page') in pending]
                measured.extend({'code':'planning_contract_error','page':n,'message':errors[n]}
                                for n in pending if not any(f.get('page') == n for f in measured))
                remaining = progress_score(measured)
                # Successful transport chunks do not complete their larger work unit.
                remaining += sum(1 for key, owner in unit_map.items()
                                 if owner == unit and int(key) not in accepted and int(key) not in pending)
                save_checkpoint(root, state['scope'], outline, accepted, drafts, errors)
                budget.finish(token, remaining=remaining, detail=json.dumps({'pending': pending}))
            except Exception as exc:
                # Keep all completed pages even on transport failure. Unknown/interrupted attempts stay charged.
                save_checkpoint(root, state['scope'], outline, accepted, drafts, errors)
                settle_error(budget, token, exc)
                raise
    if stops:
        raise WorkStopped('; '.join(row['reason'] for row in stops))
    return accepted, calls
