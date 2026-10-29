"""Shared deterministic typography gate. No design values are rewritten."""
import math
from xml.etree import ElementTree as ET
from font_policy import available_font_families, font_is_available, font_covers_text
from ppt_contract import MIN_BODY_FONT, MIN_CAPTION_FONT
from quality_policy import classify, blocking


def typography_errors(root, contract, page_no=0, require_fonts=True,
                      min_body=MIN_BODY_FONT, min_caption=MIN_CAPTION_FONT, installed=None, include_advisory=False):
    if isinstance(root, str):
        root = ET.fromstring(root)
    allowed = {str(v).strip() for v in (contract.get('fonts') or {}).values()}
    errors = []
    def add(code, message):
        errors.append({'code': code, 'message': message, 'page': page_no})
    for node in root.iter():
        if node.tag.split('}')[-1] != 'content':
            continue
        family = node.get('fontFamily', '').strip()
        if require_fonts:
            if not family:
                add('missing_font_family', 'content has no explicit fontFamily')
            elif ',' in family:
                add('invalid_font_family', 'fontFamily must be one exact family')
            elif font_is_available(family, installed) is False:
                add('font_not_installed', f'fontFamily {family!r} is not installed')
            elif font_is_available(family, installed) is None:
                add('font_coverage_unverified', f'fontFamily {family!r} cannot be inspected on this host')
            elif allowed and family not in allowed:
                add('font_contract_mismatch', f'fontFamily {family!r} is outside render contract')
            if family and any('\u3400' <= c <= '\u9fff' for c in ''.join(node.itertext())):
                required = ''.join(c for c in ''.join(node.itertext()) if '\u3400' <= c <= '\u9fff')
                coverage = font_covers_text(family, required)
                if coverage is False:
                    add('font_missing_cjk_coverage', f'fontFamily {family!r} is not approved for CJK')
                elif coverage is None:
                    add('font_coverage_unverified', f'fontFamily {family!r} could not be inspected; CJK coverage is unverified')
        try:
            size = float(node.get('fontSize', 'nan'))
            if not math.isfinite(size):
                raise ValueError()
        except (ValueError, TypeError):
            add('invalid_font_size', 'content requires a finite explicit fontSize')
            continue
        minimum = min_caption if node.get('textType') == 'caption' else min_body
        if size < minimum:
            add('font_too_small', f'{node.get("textType", "body")} {size:g}pt is below {minimum:g}pt')
            errors[-1].update(font_size=size, text_type=node.get('textType', 'body'))
    return [classify(e) for e in errors] if include_advisory else blocking(errors)
