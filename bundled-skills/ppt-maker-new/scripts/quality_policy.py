"""One conservative finding policy for plan, lint, render, QA and delivery.

Only named rules or measured near-fit estimates become advisory. Unknown codes
cannot grant themselves a warning by setting severity in model-owned data.
"""
import math

REVISION = 'graded-quality-v3'
ADVISORY = frozenset({
    'adjacent_layout_repetition', 'excessive_asset_reuse', 'excessive_asset_id_reuse',
    'plan_ghost_number_too_large', 'ghost_number_too_large', 'mixed_script_glue',
    'title_orphan_line', 'footer_zone_intrusion', 'asset_role_geometry_mismatch',
    'font_contract_mismatch', 'font_coverage_unverified', 'possible_production_note',
    'sparse_slide_content', 'sparse_container_content',
    'img_round_corner_skipped', 'planning_metadata_advisory',
    'fill_approximated', 'decorative_canvas_bleed',
    'plan_text_capacity_risk',
})


def _number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def height_estimate_risk(finding):
    """0=unassessed/substantial, 1=near fit, 2=working-deck-only risk.

    Fractions express uncertainty relative to this text, not a universal pixel
    waiver. Clearance is measured by the linter, never inferred from severity.
    """
    m = dict(finding.get('measurement') or {}); m.update(finding)
    if m.get('code') != 'text_may_overflow_shape' or m.get('overflow_axis') != 'height':
        return 0
    excess, available, line, clearance = (_number(m.get(k)) for k in
        ('overflow','available_height','line_height','clearance_px'))
    if any(v is None for v in (excess,available,line,clearance)):
        return 0
    ratio = _number(m.get('width_ratio'))
    if min(excess, available, line) <= 0 or clearance < excess or ratio is not None and ratio > 1:
        return 0
    if excess <= line*.25 and excess <= available*.10:
        return 1
    if excess <= line*.50 and excess <= available*.20:
        return 2
    return 0


def classify(finding):
    item = dict(finding)
    code = str(item.get('code', 'unknown'))
    evidence = dict(item.get('measurement') or {})
    evidence.update({k: v for k, v in item.items() if k in {
        'width_ratio', 'overflow', 'available_height', 'line_height', 'font_size', 'text_type',
        'overflow_axis', 'clearance_px'}})
    advisory = code in ADVISORY
    if code == 'text_may_overflow_shape':
        ratio = _number(evidence.get('width_ratio'))
        excess = _number(evidence.get('overflow'))
        available = _number(evidence.get('available_height'))
        # These are estimator uncertainty bands, not general overlap exemptions.
        near = (ratio is not None and 0 < ratio <= 1) or (excess is not None and available is not None and available > 0 and 0 < excess <= 2)
        serious = (ratio is not None and ratio > 1) or (excess is not None and excess > 2)
        advisory = near and not serious or height_estimate_risk(item) == 1
    if code == 'font_too_small':
        size = _number(evidence.get('font_size'))
        floor = 10 if evidence.get('text_type') == 'caption' else 13
        advisory |= size is not None and size >= floor
    scope = 'page' if item.get('page_no') or item.get('page') else 'project'
    action = 'report_only' if advisory else 'repair_or_isolate'
    if not advisory and code in {'asset_consumer_error', 'asset_dependency_failed', 'validator_internal_error', 'font_not_installed', 'source_receipt_invalid'}:
        action = 'repair_dependency'
    item.update(severity='warning' if advisory else 'blocking', scope=scope,
                confidence='advisory' if advisory else 'conservative',
                repair_action=action,
                evidence=evidence, policy_revision=REVISION)
    item['working_deck_eligible'] = advisory or height_estimate_risk(item) == 2
    if 'level' in item:
        item['level'] = 'warning' if advisory else 'error'
    return item


def partition(findings):
    errors, warnings = [], []
    for raw in findings:
        item = classify(raw)
        (warnings if item['severity'] == 'warning' else errors).append(item)
    return errors, warnings


def blocking(findings):
    return partition(findings)[0]


def _magnitude(item):
    m = dict(item.get('measurement') or {}); m.update(item)
    excess = m.get('overflow')
    if isinstance(excess, dict):
        excess = sum(max(0, _number(v) or 0) for v in excess.values())
    magnitude = _number(excess)
    if magnitude is None and _number(m.get('width_ratio')) is not None:
        magnitude = max(0, float(m['width_ratio']) - 1) * 100
    if magnitude is None:
        magnitude = _number(m.get('overlap_area'))
    if magnitude is None:
        magnitude = _number(m.get('intersection_area'))
    return max(0, magnitude or 0)


def progress_score(findings):
    """Comparable measured burden; warnings cost zero. Never grants extra calls."""
    total = sum(1 + min(999, _magnitude(item)) / 1000 for item in blocking(findings))
    return round(total, 6)


def bounded_height_residual(finding):
    """Small, measured repair scope, NOT a release waiver or allowance.

    Clearance is deliberately not a prerequisite: a too-tight neighbour is
    precisely why SOL must still repair the text/region before publication.
    Compare dimensionless fractions, never pixels against overlap area.
    """
    m = dict(finding.get('measurement') or {}); m.update(finding)
    if m.get('code') != 'text_may_overflow_shape' or m.get('overflow_axis') != 'height':
        return False
    excess, available, estimated, line = (_number(m.get(k)) for k in
        ('overflow', 'available_height', 'estimated_height', 'line_height'))
    if any(v is None or v <= 0 for v in (excess, available, estimated, line)):
        return False
    if abs(estimated - available - excess) > .01:
        return False
    if 'width_ratio' in m:
        ratio = _number(m['width_ratio'])
        if ratio is None or not 0 < ratio <= 1:
            return False
    return excess <= line * .5 and excess <= available * .2


def candidate_improves(previous, current, *, strategy='local_repair'):
    """Local edits preserve object identity; recomposition compares defect classes.

    Recomposition may clear structural collisions leaving only bounded height
    estimates. Other changes cannot introduce classes or worsen measured damage.
    This admits a recovery starting point, never waives publication validation.
    """
    from collections import defaultdict
    eligible = {'text_may_overflow_shape', 'text_overflows_container', 'bbox_overlap',
                'text_overlap', 'text_box_overlap', 'image_covers_text', 'table_covers_text',
                'chart_covers_text', 'font_too_small', 'missing_font_family',
                'invalid_font_family', 'font_missing_cjk_coverage'}
    before, after = blocking(previous), blocking(current)
    if not after or any(e['code'] not in eligible and not e['code'].endswith('_out_of_canvas') for e in after):
        return False
    if strategy == 'recompose':
        structural = {'text_overflows_container', 'bbox_overlap', 'text_overlap',
                      'text_box_overlap', 'image_covers_text', 'table_covers_text',
                      'chart_covers_text'}
        if (before and all(e['code'] in structural for e in before)
                and not any(e.get('code') == 'text_may_overflow_shape' for e in previous)
                and len(after) <= len(before)
                and all(bounded_height_residual(e) for e in after)):
            return True
        def profile(rows):
            groups = defaultdict(list)
            for e in rows:
                groups[e['code']].append(e)
            return {code: (len(items),
                           sum(_magnitude(e) for e in items),
                           max(_magnitude(e) for e in items))
                    for code, items in groups.items()}
        old, new = profile(before), profile(after)
        return (all(k in old and all(a <= b + 1e-6 for a,b in zip(v,old[k]))
                    for k,v in new.items()) and progress_score(after) < progress_score(before))
    def burdens(rows):
        groups = defaultdict(list)
        for e in rows:
            refs = e.get('elements') or [r.get('xml_path') for r in e.get('related_objects', []) if r.get('xml_path')]
            key = (e['code'], tuple(sorted(str(r) for r in refs)))
            groups[key].append(e)
        return {k: progress_score(v) for k,v in groups.items()}
    old, new = burdens(before), burdens(after)
    return all(k in old and v <= old[k] for k,v in new.items()) and progress_score(after) < progress_score(before)


def recovery_advice(stop_reasons):
    """Immediate delivery is separate from later, explicitly authorized refinement."""
    if not stop_reasons:
        return {'next_action':'continue_build', 'optional_refinement':None}
    reasons = [str(v) for v in stop_reasons.values()]
    dependency = any('local_dependency_failure' in r or 'asset_' in r for r in reasons)
    stopped = any(any(k in r for k in ('limit:', 'no_progress:', 'exhausted', 'work_already_complete:')) for r in reasons)
    return {'next_action': 'deliver_unaffected_pages_and_repair_dependencies' if dependency else 'deliver_best_available',
            'optional_refinement': {'pages': sorted(int(n) for n in stop_reasons),
                'requires_authorization': stopped,
                'action': 'inspect_dependencies' if dependency else 'scoped_refinement',
                'note': 'Delivery still requires valid source/blueprint and file integrity; this is not a budget grant.'}}
