"""Local single-page export preflight, without screenshots or model calls."""
import io
from xml.etree import ElementTree as ET


def conversion_findings(xml, assets, *, renderer=None):
    try:
        from pptx import Presentation
        from sml_to_pptx import render_slide, px
        from iconpark_render import icon_renderer
    except ImportError as exc:
        return [{'code': 'validator_internal_error', 'message': f'PPTX dependency unavailable: {exc}'}]
    findings = []
    try:
        prs = Presentation()
        prs.slide_width, prs.slide_height = px(960), px(540)
        if renderer is None:
            render_slide(prs, ET.fromstring(xml), {}, assets, None, icon_renderer, findings)
        else:
            findings.extend(renderer(prs, xml, assets))
        buf = io.BytesIO(); prs.save(buf); buf.seek(0)
        Presentation(buf)
    except Exception as exc:
        findings.append({'code': 'page_conversion_failed', 'message': str(exc), 'backend': 'local-pptx'})
    return findings
