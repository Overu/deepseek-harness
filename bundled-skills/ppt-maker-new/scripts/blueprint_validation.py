"""Pure static checks shared by planning, pre-build and release QA.

No content or design is repaired here. Return every finding before asking SOL once.
"""
import json
from audience_copy import page_copy_findings
import re
import math
from collections import Counter

from ppt_contract import (GHOST_NUMBER_MAX_AREA_RATIO, asset_reuse_findings,
                          validate_generated_extension)
from sol_common import is_safe_asset_src, portable_asset_key
from quality_policy import blocking, classify
from brief_contract import ELIGIBLE_DECISION_STATUSES,ELIGIBLE_ARTIFACT_STATUSES


def layout_capacity_findings(page):
    """Advisory estimates only for explicitly sized text, never copy allocation.

    Uses the same font/wrap estimator as page lint; no additional character
    budget, paid review, geometry edit, or claim of pixel-level proof.
    """
    findings = []
    for block in (page.get('layout') or {}).get('blocks', []):
        if str(block.get('type', '')).lower() not in {'text', 'text-card', 'text_card', 'card', 'callout'}:
            continue
        props, area = block.get('props') or {}, block.get('area')
        if not isinstance(props, dict) or not isinstance(props.get('text'), str) or not props['text'].strip():
            continue
        if (not isinstance(area, list) or len(area) != 4
                or any(type(v) not in {int, float} or not math.isfinite(v) for v in area)
                or min(area[2:]) <= 0):
            continue
        try:
            size = float(props.get('font_size', props.get('fontSize', 0)))
        except (ValueError, TypeError):
            continue
        if not math.isfinite(size) or size <= 0:
            continue
        import sys
        from pathlib import Path
        backend = str(Path(__file__).resolve().parents[1] / 'lark/scripts')
        if backend not in sys.path:
            sys.path.insert(0, backend)
        from xml_lint import estimate_text_line_count_for_text, estimate_text_width, estimate_text_line_height
        width, height = area[2] * 960, area[3] * 540
        element = {'fontSize': size, 'fontFamily': str(props.get('fontFamily') or ''),
                   'width': width, 'textType': 'body', 'bold': str(props.get('bold')).lower() == 'true',
                   'wrap': str(props.get('wrap', True)).lower()}
        lines = estimate_text_line_count_for_text(element, props['text'])
        spacing = props.get('lineSpacing')
        leading = estimate_text_line_height(element, spacing if isinstance(spacing, str) else None)
        if leading is None:
            continue
        estimated_height = size + max(0, lines - 1) * leading
        nowrap_width = (max(estimate_text_width(line, size, 0, element['bold'], element['fontFamily'])
                            for line in props['text'].split('\n')) if element['wrap'] in {'false', '0'} else 0)
        if estimated_height > height * 1.25 or nowrap_width > width * 1.25:
            findings.append(classify(dict(code='plan_text_capacity_risk', page=page.get('no'),
                block_id=block.get('id'), message='显式文字/字号与预留区域可能不相容；请在本次渲染中调整构图并留余量。',
                measurement={'available_width': round(width, 2), 'available_height': round(height, 2),
                             'estimated_height': round(estimated_height, 2), 'font_size': size,
                             'estimated_lines': lines, 'nowrap_width': round(nowrap_width, 2)},
                hint='layout_advice 是非阻断估算，不上屏；优先扩大正文区或重组版面，保留事实、数字及限定，不机械删字或缩成小字。')))
    return findings


def reference_contract(brief):
    return {
        'decision_ids': [d['id'] for d in brief.get('decision_ledger', [])
                         if d.get('id') and d.get('status') in ELIGIBLE_DECISION_STATUSES],
        'artifact_ids': [a['artifact_id'] for a in brief.get('artifact_lineage', [])
                         if a.get('artifact_id') and a.get('status') in ELIGIBLE_ARTIFACT_STATUSES],
        'images.asset_id': [a['asset_id'] for a in brief.get('available_assets', []) if a.get('asset_id')],
        'rule': 'These namespaces are distinct. Empty allowed list means use []. Never put image asset IDs into artifact_ids.',
    }


def static_findings(blueprint, brief, *, complete=True, include_advisory=False):
    errors = []
    def add(code, message, page=None, **extra):
        errors.append(dict(code=code, message=message, page=page, **extra))
    # Inspect, never normalize, model-owned data. Invalid types must produce
    # actionable repair findings rather than crashing before the repair stage.
    def structure(field, expected, page=None):
        add('invalid_blueprint_structure', f'{field} must be {expected}', page, field=field)
    if not isinstance(blueprint, dict):
        structure('blueprint', 'an object')
        return errors
    if not isinstance(blueprint.get('pages'), list):
        structure('pages', 'an array')
        return errors
    for index, p in enumerate(blueprint['pages']):
        path = f'pages[{index}]'
        if not isinstance(p, dict):
            structure(path, 'an object', index + 1)
            continue
        n = p.get('no', index + 1)
        if type(n) is not int or n < 1:
            structure(path + '.no', 'a positive integer', index + 1)
            n = index + 1  # Error location only; no modification to the page.
        for field in ('source_ids', 'decision_ids', 'artifact_ids', 'must_keep_ids'):
            value = p.get(field, [])
            if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
                structure(path + '.' + field, 'an array of strings', n)
        notes = p.get('internal_notes', [])
        if not isinstance(notes, list) or any(not isinstance(v, str) for v in notes):
            structure(path + '.internal_notes', 'an array of internal-only strings', n)
        images = p.get('images', [])
        if not isinstance(images, list) or any(not isinstance(v, dict) for v in images):
            structure(path + '.images', 'an array of objects', n)
        layout = p.get('layout', {})
        if not isinstance(layout, dict):
            structure(path + '.layout', 'an object', n)
        else:
            blocks = layout.get('blocks', [])
            if not isinstance(blocks, list) or any(not isinstance(v, dict) for v in blocks):
                structure(path + '.layout.blocks', 'an array of objects', n)
    if errors:
        return errors
    pages = blueprint.get('pages') or []
    preservation = brief.get('source_page_contract') or {}
    if complete and preservation and len(pages) != len(preservation['source_pages']):
        add('source_page_count_mismatch', 'preserve-pages must keep original page count')
    if complete and preservation and [p['no'] for p in pages] != list(range(1, len(preservation['source_pages']) + 1)):
        add('source_page_order_mismatch', 'preserve-pages must keep original page order')
    if complete and len(pages) != blueprint.get('page_count', len(pages)):
        add('blueprint_page_count_mismatch', 'page count does not match')
    decisions = {str(d['id']): d.get('status') for d in brief.get('decision_ledger', []) if d.get('id')}
    artifacts = {str(a['artifact_id']): a.get('status') for a in brief.get('artifact_lineage', []) if a.get('artifact_id')}
    assets = {str(a['asset_id']): a for a in brief.get('available_assets', []) if a.get('asset_id')}
    uses = []
    numbers = set()
    asset_spellings = {}
    previous = None
    for index, p in enumerate(pages, 1):
        n = p.get('no', index)
        if preservation:
            expected_ref = {'source_id': preservation['preserve_source_id'], 'page_no': n}
            if p.get('source_page_ref') != expected_ref or n > len(preservation['source_pages']):
                add('source_page_mapping_mismatch', 'SOL must provide the matching original source_page_ref', n)
        if n in numbers:
            add('duplicate_page', 'duplicate page number', n)
        numbers.add(n)
        if complete and n != index:
            add('page_number_mismatch', f'expected page {index}', n)
        errors.extend(page_copy_findings(p))
        for field, registry, allowed, unknown, forbidden in (
            ('decision_ids', decisions, ELIGIBLE_DECISION_STATUSES, 'unknown_decision_reference', 'forbidden_historical_decision'),
            ('artifact_ids', artifacts, ELIGIBLE_ARTIFACT_STATUSES, 'unknown_artifact_reference', 'forbidden_artifact_reference')):
            for ref in p.get(field, []):
                status = registry.get(str(ref))
                if str(ref) not in registry:
                    add(unknown, f'unknown {field} reference {ref}', n)
                elif status not in allowed:
                    kind = 'decision' if field == 'decision_ids' else 'artifact'
                    add(forbidden, f'forbidden {kind} {ref} ({status})', n)
        layout = p.get('layout') or {}
        if not isinstance(layout, dict) or not layout.get('layout_id'):
            add('missing_layout', 'layout requires layout_id', n)
            layout = {}
        for im in p.get('images', []):
            src = str(im.get('src') or '')
            if not src:
                add('missing_image_src', f'page {n} image is missing src', n)
            elif not is_safe_asset_src(src):
                add('unsafe_asset_path', f'unsafe image src {src!r}', n)
            else:
                uses.append(dict(im, page=n))
                key = portable_asset_key(src)
                if key in asset_spellings and asset_spellings[key] != src:
                    add('unsafe_asset_path', f'cross-platform image path collision: {asset_spellings[key]!r} / {src!r}', n)
                asset_spellings[key] = src
            try:
                validate_generated_extension(im, n)
            except ValueError as exc:
                add('invalid_image_extension', str(exc), n)
            aid = str(im.get('asset_id') or '')
            if aid and aid not in assets:
                add('unknown_asset_reference', f'unknown asset_id {aid}', n)
            a = assets.get(aid, {})
            if a.get('source_class') == 'artifact':
                rid = a.get('artifact_id')
                if artifacts.get(rid) not in ELIGIBLE_ARTIFACT_STATUSES:
                    add('forbidden_artifact_reference', f'asset {aid} comes from forbidden artifact {rid}', n)
                elif rid not in p.get('artifact_ids', []):
                    add('missing_artifact_reference', f'asset {aid} requires artifact {rid}', n)
        for block in layout.get('blocks', []):
            props = block.get('props') or {}
            area = block.get('area')
            if not isinstance(props, dict):
                add('invalid_blueprint_structure', 'block props must be an object', n)
                continue
            if area is not None and (not isinstance(area, list) or len(area) != 4 or
                    any(type(v) not in {int, float} for v in area)):
                add('invalid_blueprint_structure', 'block area must be [x,y,w,h] numbers', n)
                continue
            if area is None:
                continue
            if (any(not math.isfinite(v) for v in area) or min(area[:2]) < 0 or min(area[2:]) <= 0
                    or area[0]+area[2] > 1.000001 or area[1]+area[3] > 1.000001):
                add('plan_geometry_invalid','block area must be finite, positive-size and inside normalized canvas',n,
                    block_id=block.get('id'))
                continue
            try:
                size = float(props.get('font_size', props.get('fontSize', 0)))
            except (TypeError, ValueError):
                add('invalid_blueprint_structure', 'font size must be numeric', n)
                continue
            if size >= 64 and re.fullmatch(r'\d{1,3}', str(props.get('text', '')).strip()):
                if area[2] * area[3] > GHOST_NUMBER_MAX_AREA_RATIO:
                    add('plan_ghost_number_too_large',
                        f'block {block.get("id")} numeric display occupies {area[2]*area[3]:.1%}; maximum is {GHOST_NUMBER_MAX_AREA_RATIO:.0%}. SOL must redesign this block before render.', n)
        sig = (layout.get('layout_id'), layout.get('density'),
               tuple(b.get('type') for b in layout.get('blocks', [])),
               tuple(i.get('role') for i in p.get('images', [])))
        if previous and sig == previous[1] and n == previous[0] + 1:
            add('adjacent_layout_repetition', f'adjacent layout repetition between pages {previous[0]} and {n}', n)
        previous = (n, sig)
        if include_advisory:
            errors.extend(layout_capacity_findings(p))
    for (src, n), count in Counter((u['src'], u['page']) for u in uses).items():
        if count > 1:
            ids = [u.get('id') for u in uses if u['src'] == src and u['page'] == n]
            if not all(ids) or len(set(ids)) != count:
                add('duplicate_image_src', f'repeated src needs distinct model-authored instance ids: {src}', n)
    hashes = {u['src']: assets.get(u.get('asset_id'), {}).get('sha256') for u in uses}
    for finding in asset_reuse_findings(uses, hashes):
        for n in finding['pages']:
            add('excessive_asset_reuse', 'excessive asset_id reuse: ' + json.dumps(finding, ensure_ascii=False), n)
    if complete:
        covered = {str(i) for p in pages for i in p.get('must_keep_ids', [])}
        for fact in brief.get('must_keep', []):
            if fact.get('id') and str(fact['id']) not in covered:
                add('uncovered_must_keep', f'uncovered must_keep ids: {fact["id"]}')
    return [classify(e) for e in errors] if include_advisory else blocking(errors)


def require_static_blueprint(blueprint, brief):
    errors = static_findings(blueprint, brief)
    if errors:
        raise ValueError(json.dumps(errors, ensure_ascii=False))
