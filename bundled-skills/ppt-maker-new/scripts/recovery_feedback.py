"""Evidence for SOL decisions; never authors replacement copy or coordinates."""
import json
from quality_policy import blocking, progress_score, candidate_improves, bounded_height_residual
from stage_runtime import sha256_text, atomic_write_json


def recovery_history(state):
    """Page/prompt-scoped strategy evidence, never an execution allowance."""
    path = state['project'] / 'reports/render_strategy' / (state['prompt_hash'] + '.json')
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding='utf-8'))
    if data.get('prompt_hash') != state['prompt_hash'] or data.get('page_no') != state['page_no']:
        raise ValueError('recovery strategy identity mismatch')
    return list(data.get('history', []))


def record_attempt(state, base, before, candidate, after, *, strategy, attempt_id=None,
                   intent=False, detail=None, base_sha256=None):
    """Retain chronological feedback without promoting a failed candidate.

    One managed worker owns a page. Replayed final-repair responses use stable IDs
    so revalidation does not masquerade as another model attempt.
    """
    history = recovery_history(state)
    if attempt_id and any(row.get('attempt_id') == attempt_id for row in history):
        return history
    base_hash = base_sha256 or sha256_text(base)
    if intent and any(row.get('intent') and row.get('strategy') == strategy
                      and row.get('base_sml_sha256') == base_hash for row in history):
        # Routing can happen before admission; denied resumes are not attempts
        # and must never crowd real failures out of the bounded journal.
        return history
    history.append({'base_sml_sha256':base_hash, 'sml_sha256':sha256_text(candidate),
                    'errors':blocking(after)[:80], 'strategy':strategy, 'intent':intent,
                    'improved':not blocking(after) or candidate_improves(before, after, strategy=strategy), 'attempt_id':attempt_id,
                    'detail':detail,
                    'source':'repair_attempt'})
    history = history[-12:]
    atomic_write_json(state['project'] / 'reports/render_strategy' / (state['prompt_hash'] + '.json'),
                      {'version':1, 'page_no':state['page_no'], 'prompt_hash':state['prompt_hash'], 'history':history})
    return history


GEOMETRY = {'text_may_overflow_shape', 'text_overflows_container', 'bbox_overlap',
            'text_overlap', 'text_box_overlap', 'image_covers_text', 'table_covers_text',
            'chart_covers_text', 'font_too_small', 'missing_font_family',
            'invalid_font_family', 'font_missing_cjk_coverage'}


def recovery_rank(findings):
    """Prefer intact content, then valid syntax; compare measured burden last.

    This is a recovery starting-point heuristic, never permission to publish.
    Unknown errors remain riskier than known page-local presentation defects.
    """
    errors = blocking(findings)
    schema = lambda c: c.startswith('sxsd_') or c in {'invalid_model_xml', 'xml_parse_error'}
    codes = [str(e.get('code', 'unknown')) for e in errors]
    unknown = sum(not schema(c) and c not in GEOMETRY
                  and not c.endswith('_out_of_canvas') for c in codes)
    return (unknown, sum(schema(c) for c in codes), len(errors), progress_score(errors))


def repair_feedback(xml, findings, history=None, *, final=False):
    errors = blocking(findings)
    history = list(history or [])[-12:]
    codes = {e.get('code', 'unknown') for e in errors}
    capacity = False
    for e in errors:
        m = dict(e.get('measurement') or {}); m.update(e)
        try:
            # Routing heuristic, not an additional quality gate. Small estimated
            # overflows stay local; substantial multiline/width conflicts reflow.
            if e.get('code') == 'text_may_overflow_shape':
                for axis in ('height', 'width'):
                    estimated = float(m.get('estimated_' + axis, 0))
                    available = float(m.get('available_' + axis, 0))
                    capacity |= (available > 0 and estimated > available * 1.35
                                 and (axis == 'width' or estimated > 48))
        except (KeyError, TypeError, ValueError):
            pass
    attempts = [h for h in history if h.get('source') in (None, 'repair_attempt') and not h.get('intent')]
    past = {e.get('code') for h in attempts for e in h.get('errors', [])}
    oscillation = ('text_may_overflow_shape' in past | codes
                   and bool((past | codes) & {'bbox_overlap', 'text_overlap', 'text_box_overlap', 'text_overflows_container'})
                   and len(attempts) >= 2
                   and not attempts[-1].get('improved', False))
    stalled_patch = any(h.get('strategy') == 'local_repair' and not h.get('improved')
                        and not h.get('intent') for h in attempts)
    recomposing = any(h.get('strategy') == 'recompose' for h in history)
    # Only the current, actually improved candidate can exit recomposition.
    # Older successes, inventory rows and failed local follow-ups cannot reset
    # escalation. This changes the instruction, never the persistent call cap.
    residual_local = bool(errors and attempts and attempts[-1].get('improved')
                          and attempts[-1].get('strategy') == 'recompose'
                          and attempts[-1].get('sml_sha256') == sha256_text(xml)
                          and all(bounded_height_residual(e) for e in errors))
    schema = any(c.startswith('sxsd_') or c == 'invalid_model_xml' for c in codes)
    strategy = ('schema_repair' if schema else 'local_repair' if residual_local else
                'recompose' if capacity or oscillation or stalled_patch or recomposing else 'local_repair')
    action = {
        'schema_repair': 'Correct reported tags/attributes/structure while keeping usable content and design. Recheck capacity after syntax is legal.',
        'local_repair': 'Address the identified objects and their neighbours; preserve unaffected design. If local repair cannot fit, redesign this page within the same response.',
        'recompose': 'Replace the failing composition, not another coordinate nudge. The original card grid, layout family and image/text ratio are not mandatory. Arrange complete readable text with slack before decoration; move labels inward or use leader lines if needed. Preserve required copy and assets, not the failed narrow containers. Do not shrink text or remove qualifiers to pass. Do not repeat a previously failed arrangement.',
    }[strategy]
    # Current evidence is complete; previous attempts need only compact identity,
    # cause and measurement summaries, not repeated full geometry inventories.
    concise_history = []
    keys = {'code','message','elements','element_ids','measurement','overflow',
            'estimated_height','available_height','estimated_width','available_width','width_ratio'}
    for row in history:
        item = {k:v for k,v in row.items() if k != 'errors'}
        item['errors'] = [{k:v for k,v in e.items() if k in keys} for e in row.get('errors',[])[:8]]
        item['finding_count'] = len(row.get('errors',[]))
        concise_history.append(item)
    return {
        'base_sml_sha256': sha256_text(xml), 'strategy': strategy,
        'evidence': [dict(e) for e in findings[:80]],
        'diagnosis': {'capacity_conflict_observed': capacity, 'geometry_tradeoff_signal': oscillation,
                      'non_improving_patch':stalled_patch, 'persisted_recomposition':recomposing,
                      'improved_candidate_needs_local_finish':residual_local,
                      'qualification': 'Text extents are validator estimates, not a character-count rule or proof the entire page is infeasible.'},
        'preserve': ['claims, numbers, qualifiers and locked copy', 'required asset identities and instances', 'page identity and other pages'],
        'adjustable': ['page-local arrangement and region proportions', 'text wrapping and readable typography', 'image size/crop within source intent', 'nonessential decoration'],
        'history': concise_history, 'next_action': action,
        'acceptance': ['current schema/content/asset checks pass', 'substantive overflow and occlusion resolved', 'no new blocking regression'],
        'round': 'pre-delivery repair; runtime alone may admit one progress-based follow-up, never recursive rounds' if final else 'existing page repair allowance; no extra calls',
    }


def select_base(state, initial=None):
    """Revalidate exact saved candidates so XML and feedback have one identity."""
    from render_checkpoint import load_candidates
    from sol_render import _validate_batch_candidate
    candidates = ([initial] if initial else []) + load_candidates(state)
    selected = None
    selected_warnings = []
    history = []
    for xml in dict.fromkeys(candidates):
        candidate, errors, _ = _validate_batch_candidate(state, xml)
        row = {'sml_sha256': sha256_text(candidate), 'errors': errors, 'source':'candidate_inventory'}
        history.append(row)
        if selected is None or recovery_rank(errors) < recovery_rank(selected[1]):
            selected = (candidate, errors)
            selected_warnings = list(state.get('quality_warnings') or [])
    state['quality_warnings'] = selected_warnings
    return selected, history + recovery_history(state)
