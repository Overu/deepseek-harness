"""Executable local-PPTX subset of the broader SML interchange schema.

No pptx import: lint, prompts and converter all consume the same declarations.
Unsupported semantic objects are diagnosed before model output is accepted;
named cosmetic fallbacks are disclosed, not turned into repair loops.
"""
SHAPE_ENUM_NAMES = {
    'rect': 'RECTANGLE', 'round-rect': 'ROUNDED_RECTANGLE',
    'slides-full-round-rect': 'ROUNDED_RECTANGLE', 'ellipse': 'OVAL', 'oval': 'OVAL',
    'triangle': 'ISOSCELES_TRIANGLE', 'diamond': 'DIAMOND',
    'right-arrow': 'RIGHT_ARROW', 'left-arrow': 'LEFT_ARROW',
    'up-arrow': 'UP_ARROW', 'down-arrow': 'DOWN_ARROW',
    'left-right-arrow': 'LEFT_RIGHT_ARROW', 'up-down-arrow': 'UP_DOWN_ARROW',
    'hexagon': 'HEXAGON', 'chevron': 'CHEVRON', 'star5': 'STAR_5_POINT',
}
CHART_ENUM_NAMES = {
    'column': 'COLUMN_CLUSTERED', 'bar': 'BAR_CLUSTERED', 'line': 'LINE_MARKERS',
    'area': 'AREA', 'pie': 'PIE', 'radar': 'RADAR',
}
POLYLINE_ENUM_NAMES = {'bent-connector2': 'ELBOW', 'curved-connector2': 'CURVE'}
POLYLINE_PRESETS = {'bent-connector2': 'bentConnector2', 'curved-connector2': 'curvedConnector2'}
AUTO_FIT_ENUM_NAMES = {
    'no-auto-fit': 'NONE', 'normal-auto-fit': 'TEXT_TO_FIT_SHAPE',
    'shape-auto-fit': 'SHAPE_TO_FIT_TEXT',
}
# Generation uses the native backend intersection, not every interchange field.
# id/desc are validation metadata. Unsupported image effects must not be invited.
GENERATION_ATTRIBUTES = {
    'shape': {'id','type','topLeftX','topLeftY','width','height','rotation','alpha','presetHandlers'},
    'content': {'textType','fontSize','fontFamily','color','bold','italic','underline',
                'strikethrough','letterSpacing','wrap','autoFit','verticalAlign','textAlign','lineSpacing'},
    'img': {'id','desc','src','topLeftX','topLeftY','width','height','rotation'},
    'crop': {'type','anchor','presetHandlers','roundedCorners'},
    'border': {'color','width','dashArray'},
}

IMAGE_CROP_TYPES = frozenset({'rect', 'round-rect', 'ellipse'})
IMAGE_ROUNDED_CORNERS = frozenset({'all', 'top', 'bottom', 'left', 'right'})


def image_frame_spec(crop, width, height):
    """One image-geometry contract for generation, validation and conversion."""
    import math
    mode = crop.get('type', 'rect') if crop is not None else 'rect'
    corners = crop.get('roundedCorners', 'all') if crop is not None else 'all'
    raw_radius = crop.get('presetHandlers') if crop is not None else None
    if mode not in IMAGE_CROP_TYPES or corners not in IMAGE_ROUNDED_CORNERS:
        raise ValueError('Unsupported image crop shape or roundedCorners')
    if crop is not None:
        if crop.get('anchor') not in {None, 'top', 'bottom', 'left', 'right'}:
            raise ValueError('Unsupported image crop anchor')
        if any(key in crop.attrib for key in ('path','leftOffset','rightOffset','topOffset','bottomOffset')):
            raise ValueError('Local image crop uses anchor, not custom paths/offsets')
    width, height = float(width), float(height)
    if not all(math.isfinite(v) and v > 0 for v in (width, height)):
        raise ValueError('Image dimensions must be finite and positive')
    radius = float(raw_radius) if raw_radius is not None else (min(width, height) / 6 if mode == 'round-rect' else 0)
    if not math.isfinite(radius) or radius < 0:
        raise ValueError('Image corner radius must be finite and nonnegative pixels')
    if mode == 'ellipse' and (raw_radius is not None or corners != 'all'):
        raise ValueError('Ellipse crop does not accept corner radius or partial corners')
    if corners != 'all' and mode == 'rect' and raw_radius is None:
        raise ValueError('Partial corners require round-rect or explicit radius')
    if mode == 'rect' and radius > 0:
        mode = 'round-rect'  # Compatibility with the original SML radius spelling.
    return mode, min(radius, min(width, height) / 2), corners

BLEED_ID_PREFIX = 'decor-bleed-'
BLEED_CONTRACT = '''Intentional canvas bleed is allowed only for empty background
rect/round-rect/ellipse/oval shapes explicitly identified with id="decor-bleed-NAME",
behind all meaningful content, with positive finite dimensions and a visible
intersection with the canvas. Keep text, data, images, connectors and semantic shapes
inside the canvas. Low opacity alone never grants bleed. Preserve clipping intent
in native export; no local resizing. This is decoration, never a text container.'''


def is_background_bleed(element, elements):
    """Explicit author intent plus structural evidence, not an opacity guess."""
    if (element.get('kind') != 'shape' or element.get('type') not in {'rect','round-rect','ellipse','oval'}
            or not str(element.get('id','')).startswith(BLEED_ID_PREFIX)
            or str(element.get('text','')).strip() or element.get('_prior_connector')):
        return False
    meaningful=[e for e in elements if str(e.get('text','')).strip()
                or e.get('kind') in {'img','table','chart','line','polyline'}
                or e.get('type') not in {'rect','round-rect','ellipse','oval','text'}]
    return bool(meaningful) and all(element.get('order',0) < e.get('order',0) for e in meaningful)


def capability_findings(root):
    """Find backend-only restrictions; schema remains responsible for syntax."""
    findings = []
    counts = {}
    for node in root.iter():
        tag = node.tag.split('}')[-1]
        counts[tag] = counts.get(tag, 0) + 1
        code = message = None
        value = node.get('type', {'shape': 'rect', 'polyline': 'bent-connector2', 'chartPlot': 'column'}.get(tag, ''))
        if tag == 'img':
            crop = next((c for c in node if c.tag.split('}')[-1] == 'crop'), None)
            try:
                image_frame_spec(crop, node.get('width'), node.get('height'))
            except (TypeError, ValueError) as exc:
                code, message = 'image_crop_unsupported', str(exc)
        elif tag == 'shape' and value not in {*SHAPE_ENUM_NAMES, 'text'}:
            code, message = 'shape_type_approximated', f"Local PPTX cannot preserve shape type {value!r}; use a supported native shape or model-authored composition."
        elif tag == 'polyline' and value not in POLYLINE_ENUM_NAMES:
            code, message = 'polyline_approximated', f"Local PPTX cannot preserve {value!r}; use supported connectors or explicit model-authored line segments."
        elif tag == 'chartPlot' and value not in CHART_ENUM_NAMES:
            code, message = 'chart_approximated', f"Local PPTX cannot preserve chart type {value!r}; choose a supported chart without changing the data."
        elif tag in {'embed', 'whiteboard', 'undefined'}:
            code, message = 'element_skipped', f"<{tag}> is not supported by the local PPTX backend."
        elif tag == 'fillColor' and node.get('color', '').strip().lower().startswith('radial-gradient('):
            code, message = 'fill_approximated', 'Local PPTX exports radial fill as its first color stop; use a solid or linear fill for faithful output.'
        if code:
            findings.append({'code': code, 'message': message,
                'level': 'warning' if code == 'fill_approximated' else 'error',
                'elements': [f'{tag}[{counts[tag]}]'], 'backend': 'local-pptx'})
    return findings


def generation_contract():
    return {
        'backend': 'local-pptx', 'shape_types': sorted({*SHAPE_ENUM_NAMES, 'text'} - {'oval'}),
        'chart_types': sorted(CHART_ENUM_NAMES), 'polyline_types': sorted(POLYLINE_ENUM_NAMES),
        'autoFit': AUTO_FIT_ENUM_NAMES,
        'generation_attributes': GENERATION_ATTRIBUTES,
        'image_crop_types': sorted(IMAGE_CROP_TYPES),
        'fills': 'Solid and linear fills; radial fills are disclosed cosmetic approximations.',
    }
