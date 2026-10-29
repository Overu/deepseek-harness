#!/usr/bin/env python3
"""Render a blueprint directly to strictly validated page-scoped SML."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import re
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable
from xml.etree import ElementTree as ET
from PIL import Image

from sol_common import extract_json, render_sol as sol
from render_checkpoint import save_draft, load_draft, distribute_grant, LOCAL_FAILURE_CODES
from call_budget import BudgetExhausted
from work_budget import ValidationBudgetModel, WorkBudget, feedback
from font_policy import resolve_font_contract
from page_validation import typography_errors
from sol_plan import select_style_reference
from qa_gate import rendered_image_quality_errors, rendered_text_quality_errors
from quality_policy import blocking, partition, progress_score, candidate_improves, recovery_advice
from audience_copy import audience_page, xml_copy_findings, COPY_CONTRACT, validation_scope
from ppt_contract import GHOST_NUMBER_MAX_AREA_RATIO, PATCH_LIMITS, PATCH_PROTOCOL_MAX_OPERATIONS, PATCH_OPERATION_FIELDS, render_batch_size, TEXT_LENGTH_POLICY, WRAP_CONTRACT
from ppt_contract import DECORATION_CONTRACT, STYLE_POLICY, render_scheduling_complexity, MIN_BODY_FONT, MIN_CAPTION_FONT
from defect_map import classify_action, load_open_defects, merge_defects, resolve_defects
from sml_patch import (
    PatchRejected, apply_patch_transaction, blueprint_sha256, build_element_inventory, bind_patch_response,
    prompt_element_inventory,
    preserve_assets_sha256, preserve_text_sha256, sml_sha256, generation_schema_excerpt,
)
from stage_runtime import (
    atomic_write_json, atomic_write_text, render_contract_sha256, skill_sha256, write_stage_metric,
)


LARK_SCRIPTS = Path(__file__).resolve().parents[1] / "lark" / "scripts"
if str(LARK_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(LARK_SCRIPTS))
from xml_lint import lint_xml  # noqa: E402
from backend_capabilities import BLEED_CONTRACT


SML_RULES = """## SML contract
- Alpha is [0,1], never a percentage. Use the executable type enums below.
- Render every planned image instance once; preserve per-src counts. Target body/headline/sub-headline >=@BODY_FONT@pt, caption >=@CAPTION_FONT@pt.
- Canvas is 960×540. Convert normalized [x,y,w,h] to integer pixels.
- Use exactly this page skeleton: `<slide xmlns="https://www.larkoffice.com/sml/2.0"><style><fill><fillColor color="rgb(...)"/></fill></style><data>...</data></slide>`.
- Text is `<shape type="text" topLeftX="..." topLeftY="..." width="..." height="..."><content textType="..." fontSize="..." fontFamily="one exact family" color="..." bold="true|false" wrap="true|false" textAlign="..." verticalAlign="..." lineSpacing="multiple:1.2" letterSpacing="..."><p>...</p></content></shape>`.
- Shape transparency is the `alpha` attribute. Shape fill is a `<fill><fillColor color="rgba(...)"/></fill>` child. Shape outline is a `<border color="rgb(...)" width="1"/>` child.
- Images: `<img src="..." topLeftX="..." topLeftY="..." width="..." height="..."><crop type="round-rect" presetHandlers="16" roundedCorners="top" anchor="top"/></img>`. Radius in px, roundedCorners defaults all. Optional border belongs to this frame. Omit crop/anchor for centered cover; round-rect/ellipse use native picture-fill.
- Respect the blueprint crop intent: `cover` may crop to fill the target frame; `contain` must preserve the declared source aspect inside the intended region and leave whitespace. Never express either mode with a `fit` attribute.
- Lines use `<line startX="..." startY="..." endX="..." endY="..."><border color="..." width="..."/></line>`.
- Use exact images[].src, never guessed paths/substitutes.
- Icons: choose offline_icon_types with opaque fill. No guessed paths/network fallback; otherwise use another meaningful composition.
- Evidence uses native charts/tables; table cells follow the same font targets. Preserve facts/qualifiers.
- Inline: `<strong>`, `<em>`, `<span bold="true">` inside `<p>`, not HTML/CSS. Border width: nonnegative integer. Text/border: solid rgb()/rgba(); gradients only in fills. No image filters.
- Content stays inside 960×540; only explicit background bleed is exempt. Recompose with clearance, not 1–2px tolerance.
- Preserve claims; no invented facts, authoring notes, source instructions, opaque provenance IDs (D001), production credits (SOL规划), empty rows or missing-content ellipses.
- Multiline body text needs full line height; single-line titles/labels need full width.
- No canvas/fontWeight/stroke/fit/shape opacity; use the structures above.
- Ellipses: `<shape type="ellipse">`, not `<ellipse>`. verticalAlign="middle", not "center".
- Use one exact theme.render_contract.fonts fontFamily per content element, never CSS stacks.
- 仅用预检常见系统字体（微软雅黑/苹方、Arial 等），以字号字重分层，不引入装饰字体。
- 先按可读字号/换行/行距为正文留足空间，再摆图框装饰。蓝图比例是起点，放不下就重新构图，不缩框降字或删除事实；无字数/对象配额。同轮自查容量及作者备注，保留真实业务限定与建议。
- 连线从节点边缘的留白处出发，到目标节点边缘停止；连接关系的标签放在线旁独立留白处。分隔线位于上下文字实际行高范围之外。先完成文字占位，再选择连线端点；不要连接文本框中心。
- 多行标题的正文起点随实际标题底边下移；章节导航和页码不抢占主标题轴线，同一结论只呈现一次。
- 含中文的整段（包括中英混排、表格、标签）使用字体合同的 zh_display/zh_body 字族；只有纯拉丁文本用 latin_display/latin_body，避免中文对象落到 Arial。
"""

SML_RULES = SML_RULES.replace('@BODY_FONT@',str(MIN_BODY_FONT)).replace('@CAPTION_FONT@',str(MIN_CAPTION_FONT))
SML_RULES += '\n' + TEXT_LENGTH_POLICY + '\n' + STYLE_POLICY + '\n' + WRAP_CONTRACT + '\n' + DECORATION_CONTRACT + '\n' + COPY_CONTRACT + '\n' + generation_schema_excerpt()
SML_RULES += '\n' + BLEED_CONTRACT + '\nText-box intersection alone is not ink collision. Use reported glyph geometry/measurements; when collision is real, leave readable clearance rather than moving by exactly the estimated overlap or shrinking the box.'

SML_NS = "https://www.larkoffice.com/sml/2.0"
ET.register_namespace("", SML_NS)


def build_page_prompt(blueprint: dict, page: dict, style_reference: str) -> str:
    from blueprint_validation import layout_capacity_findings
    theme = dict(blueprint.get("theme") or {})
    render_contract = theme.pop("render_contract", None)
    context = {
        "topic": blueprint.get("topic"),
        "audience": blueprint.get("audience"),
        "theme": theme,
        "page_count": blueprint.get("page_count", len(blueprint.get("pages", []))),
        "page": audience_page(page),
        "layout_advice": layout_capacity_findings(page),
    }
    if isinstance(render_contract, dict) and render_contract:
        style_excerpt = json.dumps(render_contract, ensure_ascii=False, indent=2)
        style_label = "规划阶段压缩的渲染合同"
    else:
        # Backward compatibility for old blueprints. New blueprints always
        # provide render_contract, avoiding full-style repetition per page.
        style_excerpt = style_reference
        style_label = "设计系统摘录"
    return f"""你是本地 PPTX 的 SML 设计与渲染专家。只渲染下面这一页；不要推测或生成其他页面。

{SML_RULES}

## 单页蓝图
{json.dumps(context, ensure_ascii=False, indent=2)}

## {style_label}
{style_excerpt}

只输出一个 <slide ...>...</slide> XML，不要解释、不要 Markdown 围栏。
"""


def build_render_batches(pages: list[dict]) -> list[list[dict]]:
    """Group pages using declared complexity plus read-only geometry-risk checks."""
    batches: list[list[dict]] = []
    current: list[dict] = []
    current_limit: int | None = None
    for page in pages:
        # Old blueprints predate the scheduling field. Treating them as normal
        # changes call grouping only; it does not invent or alter slide design.
        page_limit = render_batch_size(render_scheduling_complexity(page))
        candidate_limit = page_limit if current_limit is None else min(current_limit, page_limit)
        if current and len(current) + 1 > candidate_limit:
            batches.append(current)
            current = []
            current_limit = None
            candidate_limit = page_limit
        current.append(page)
        current_limit = candidate_limit
    if current:
        batches.append(current)
    return batches


def build_batch_prompt(blueprint: dict, pages: list[dict], style_reference: str) -> str:
    """Build a batch prompt whose pages remain independently recoverable."""
    if not pages:
        raise ValueError("render batch must contain at least one page")
    theme = dict(blueprint.get("theme") or {})
    render_contract = theme.pop("render_contract", None)
    style_excerpt = (
        json.dumps(render_contract, ensure_ascii=False, indent=2)
        if isinstance(render_contract, dict) and render_contract else style_reference
    )
    from blueprint_validation import layout_capacity_findings
    context = {
        "topic": blueprint.get("topic"), "audience": blueprint.get("audience"),
        "theme": theme, "page_count": blueprint.get("page_count", len(blueprint.get("pages", []))),
        "pages": [{"blueprint_hash": blueprint_sha256(page), "page": audience_page(page)} for page in pages],
        "layout_advice": [finding for page in pages for finding in layout_capacity_findings(page)],
    }
    from design_refinement import design_sequence
    numbers={p['no'] for p in pages}
    # Local sequence context, not a second copy of the whole deck's business text.
    context['design_sequence']=[p for p in design_sequence(blueprint)
        if any(abs(p['no']-n)<=2 for n in numbers)]
    return f"""ADAPTIVE_BATCH_RENDER
你是本地 PPTX 的 SML 设计与渲染专家。一次渲染下面选中的页面；每页必须独立完整，禁止跨页共享标签。
按页面visual_intent和邻页design_sequence落实信息关系、视觉层级及节奏。只有选中页需要渲染；设计意图/合同/邻页摘要不是正文，不印在页面上。无图页仍用有效图形或有意的字体构图，不把所有内容套进同构卡片。

{SML_RULES}

## 批量蓝图
{json.dumps(context, ensure_ascii=False, indent=2)}

## 锁定渲染合同
{style_excerpt}

严格按以下格式输出每一页，不要解释或 Markdown：
<<<SLIDE page="页码" blueprint_hash="对应页面蓝图哈希">>>
<slide ...>...</slide>
<<<END_SLIDE page="同一页码">>>
每个页面片段都必须可独立解析。即使输出容量紧张，也要先闭合当前页再开始下一页。
"""


_SLIDE_FRAGMENT_RE = re.compile(
    r'<<<SLIDE\s+page="(?P<start>\d+)"(?:\s+blueprint_hash="(?P<blueprint_hash>[^"]*)")?\s*>>>'
    r'(?P<body>.*?)'
    r'<<<END_SLIDE\s+page="(?P<end>\d+)"(?:\s+sml_hash="[^"]*")?\s*>>>',
    re.DOTALL,
)


def extract_complete_slide_fragments(
    raw: str, expected_hashes: dict[int, str] | None = None,
) -> dict[int, str]:
    """Salvage independently closed slide fragments from a partial batch response."""
    fragments: dict[int, str] = {}
    for match in _SLIDE_FRAGMENT_RE.finditer(raw):
        start = int(match.group("start"))
        end = int(match.group("end"))
        if start != end or start in fragments:
            continue
        if expected_hashes is not None and match.group("blueprint_hash") != expected_hashes.get(start):
            continue
        try:
            fragments[start] = _extract_slide(match.group("body"))
        except (ET.ParseError, ValueError):
            continue
    return fragments


def _extract_slide(text: str) -> str:
    start = text.find("<slide")
    end = text.rfind("</slide>")
    if start < 0 or end < 0:
        raise ValueError("model response does not contain a complete <slide> element")
    xml = text[start:end + len("</slide>")].strip() + "\n"
    root = ET.fromstring(xml)
    if root.tag.split("}")[-1] != "slide":
        raise ValueError("SML root is not slide")
    if not any(child.tag.split("}")[-1] == "data" for child in root):
        raise ValueError("SML slide is missing data")
    return xml


def lint_slide_xml(xml: str, *, warnings_out: list | None = None) -> list[dict]:
    """Return blocking issues from the exact linter shipped with this skill."""
    result = lint_xml(xml, backend='local-pptx')
    errors = list((result.get("document") or {}).get("errors", []))
    if warnings_out is not None:
        warnings_out.extend((result.get("document") or {}).get("warnings", []))
    for slide in result.get("slides", []):
        errors.extend(slide.get("errors", []))
        if warnings_out is not None:
            warnings_out.extend(slide.get("warnings", []))
    return blocking(errors)


def _qualified(local_name: str) -> str:
    return f"{{{SML_NS}}}{local_name}"


def _sml_color(value: str) -> str:
    value = str(value or "").strip()
    match = None
    if value.startswith("#"):
        digits = value[1:]
        if len(digits) == 3:
            digits = "".join(character * 2 for character in digits)
        if len(digits) == 6:
            try:
                match = tuple(int(digits[index:index + 2], 16) for index in (0, 2, 4))
            except ValueError:
                match = None
    return f"rgb({match[0]},{match[1]},{match[2]})" if match else value


def _normalize_script_spacing(value: str | None) -> str | None:
    if value is None:
        return None
    value = re.sub(r"(?<=[A-Za-z0-9])(?=[\u3400-\u9fff])", " ", value)
    value = re.sub(r"(?<=[\u3400-\u9fff])(?=[A-Za-z0-9])", " ", value)
    return re.sub(r"(?<=[a-z])\.(?=[A-Z])", ". ", value)


def _append_text(element: ET.Element, value: str) -> None:
    descendants = list(element.iter())
    target = descendants[-1]
    if target is element and not list(element):
        element.text = (element.text or "") + value
    else:
        target.tail = (target.tail or "") + value


def _normalize_content_copy(content: ET.Element) -> None:
    paragraphs = [child for child in list(content) if child.tag.split("}")[-1] == "p"]
    if content.attrib.get("textType") in {
        "title", "headline", "sub-headline", "subtitle", "section-title",
    } and len(paragraphs) > 1:
        orphan = "".join(paragraphs[-1].itertext()).strip()
        if len(orphan) == 1 and re.fullmatch(r"[A-Za-z0-9\u3400-\u9fff]", orphan):
            _append_text(paragraphs[-2], orphan)
            content.remove(paragraphs[-1])
    for node in content.iter():
        node.text = _normalize_script_spacing(node.text)
        node.tail = _normalize_script_spacing(node.tail)


def normalize_sml_aliases(
    xml: str, render_contract: dict | None = None, *,
    installed_fonts: set[str] | frozenset[str] | None = None,
    return_repairs: bool = False,
) -> str | tuple[str, list[str]]:
    """Convert common renderer aliases to the exact bundled SML dialect.

    This intentionally handles only mechanical, semantics-preserving cases;
    geometry, missing assets, and content defects still go back to the model.
    """
    root = ET.fromstring(xml)
    repair_codes: list[str] = []

    def repaired(code: str) -> None:
        if code not in repair_codes:
            repair_codes.append(code)

    parents = {child: parent for parent in root.iter() for child in parent}
    fonts = (render_contract or {}).get("fonts") or {}
    font_defaults, _ = resolve_font_contract(fonts, installed=installed_fonts)
    for style in (node for node in root.iter() if node.tag.split("}")[-1] == "style"):
        canvases = [child for child in list(style) if child.tag.split("}")[-1] == "canvas"]
        for canvas in canvases:
            background = canvas.attrib.get("backgroundColor") or canvas.attrib.get("color")
            if background and not any(child.tag.split("}")[-1] == "fill" for child in style):
                fill = ET.Element(_qualified("fill"))
                ET.SubElement(fill, _qualified("fillColor"), {"color": _sml_color(background)})
                style.insert(list(style).index(canvas), fill)
            style.remove(canvas)
            repaired("canvas_to_fill")

    for node in root.iter():
        local = node.tag.split("}")[-1]
        if local == "ellipse":
            node.tag = _qualified("shape")
            node.set("type", "ellipse")
            local = "shape"
            repaired("ellipse_to_shape")
        if local == "b":
            node.tag = _qualified("strong")
            local = "strong"
            repaired("bold_tag_alias")
        if local == "shape":
            shape_type = str(node.attrib.get("type") or "").strip().lower()
            if shape_type == "rectangle":
                node.set("type", "rect")
                repaired("shape_type_alias")
            opacity = node.attrib.pop("opacity", None)
            if opacity is not None and "alpha" not in node.attrib:
                node.set("alpha", opacity)
                repaired("opacity_to_alpha")
            alpha = node.attrib.get("alpha")
            if alpha is not None:
                try:
                    alpha_value = float(str(alpha).rstrip("%"))
                except ValueError:
                    pass
                else:
                    if str(alpha).endswith("%") or 1 < alpha_value <= 100:
                        normalized_alpha = max(0.0, min(1.0, alpha_value / 100.0))
                        node.set("alpha", f"{normalized_alpha:.4f}".rstrip("0").rstrip("."))
                        repaired("alpha_percent_to_fraction")
            stroke = node.attrib.pop("stroke", None)
            stroke_width = node.attrib.pop("strokeWidth", None)
            if stroke is not None:
                repaired("stroke_to_border")
            if stroke and stroke.lower() not in {"none", "transparent"}:
                has_border = any(child.tag.split("}")[-1] == "border" for child in node)
                if not has_border:
                    ET.SubElement(node, _qualified("border"), {
                        "color": _sml_color(stroke), "width": str(stroke_width or "1"),
                    })
        elif local == "content":
            text_type = str(node.attrib.get("textType") or "").strip().lower()
            text_type_aliases = {
                "plain": "body", "paragraph": "body", "text": "body", "normal": "body",
                "body_text": "body", "subtitle": "sub-headline", "h1": "title",
                "h2": "headline", "h3": "sub-headline", "label": "caption",
            }
            if text_type in text_type_aliases:
                node.set("textType", text_type_aliases[text_type])
                repaired("text_type_alias")
            parent = parents.get(node)
            if parent is not None and parent.tag.split("}")[-1] == "shape":
                try:
                    bottom_y = float(parent.attrib.get("topLeftY", "0"))
                    box_height = float(parent.attrib.get("height", "0"))
                    font_size = float(node.attrib.get("fontSize", "0"))
                except ValueError:
                    bottom_y = box_height = font_size = 0
                content_text = "".join(node.itertext()).strip()
                current_type = str(node.attrib.get("textType") or "body")
                furniture_types = {"caption", "source", "footer", "page-number"}
                if (
                    current_type not in furniture_types
                    and bottom_y >= 500
                    and box_height <= 24
                    and font_size <= 12
                    and len(content_text) <= 60
                ):
                    if re.fullmatch(r"\s*\d{1,3}\s*", content_text):
                        node.set("textType", "page-number")
                    elif re.search(r"(?:^|\b)(?:source|来源|数据源)[:：]?", content_text, re.IGNORECASE):
                        node.set("textType", "source")
                    else:
                        node.set("textType", "footer")
                    repaired("footer_role_inferred")
            weight = node.attrib.pop("fontWeight", None)
            if weight is not None and "bold" not in node.attrib:
                normalized = str(weight).strip().lower()
                try:
                    is_bold = float(normalized) >= 600
                except ValueError:
                    is_bold = normalized in {"bold", "bolder", "semibold", "semi-bold"}
                node.set("bold", "true" if is_bold else "false")
                repaired("font_weight_to_bold")
            if node.attrib.get("verticalAlign") == "center":
                node.set("verticalAlign", "middle")
                repaired("vertical_align_center_to_middle")
            family = str(node.attrib.get("fontFamily") or "").split(",", 1)[0].strip()
            if render_contract is not None:
                text = "".join(node.itertext())
                has_cjk = any("\u3400" <= character <= "\u9fff" for character in text)
                display = node.attrib.get("textType", "body") in {
                    "title", "headline", "sub-headline", "subtitle", "section-title",
                }
                family = family or font_defaults[
                    ("zh_" if has_cjk else "latin_") + ("display" if display else "body")
                ]
            if family:
                if node.attrib.get("fontFamily") != family:
                    repaired("font_family_resolved")
                node.set("fontFamily", family)
            before_copy = ET.tostring(node, encoding="unicode")
            _normalize_content_copy(node)
            if ET.tostring(node, encoding="unicode") != before_copy:
                repaired("content_copy_normalized")
        elif local == "img":
            if node.attrib.pop("fit", None) is not None:
                repaired("fit_removed")
        elif local == "border" and "width" in node.attrib:
            try:
                width = float(node.attrib["width"])
            except ValueError:
                pass
            else:
                normalized_width = str(max(1, int(round(width))))
                if node.attrib.get("width") != normalized_width:
                    node.set("width", normalized_width)
                    repaired("border_width_rounded")
    normalized_xml = ET.tostring(root, encoding="unicode") + "\n"
    if return_repairs:
        return normalized_xml, repair_codes
    return normalized_xml


def _node_for_lint_path(root: ET.Element, path: str) -> ET.Element | None:
    """Resolve the linter's slide[1]/data/shape[n] locator."""
    current = root
    segments = [segment for segment in str(path).split("/") if segment]
    if segments and segments[0].startswith("slide["):
        segments = segments[1:]
    for segment in segments:
        match = re.fullmatch(r"([^\[]+)(?:\[(\d+)\])?", segment)
        if not match:
            return None
        name, index_text = match.groups()
        candidates = [child for child in current if child.tag.split("}")[-1] == name]
        index = int(index_text or "1") - 1
        if index < 0 or index >= len(candidates):
            return None
        current = candidates[index]
    return current


def repair_minor_geometry(xml: str, errors: list[dict]) -> tuple[str, list[str]]:
    """Apply bounded, semantics-preserving geometry repairs before an LLM retry."""
    root = ET.fromstring(xml)
    codes: list[str] = []

    def add(code: str) -> None:
        if code not in codes:
            codes.append(code)

    for issue in errors:
        elements = issue.get("elements") or []
        if issue.get("code") == "text_may_overflow_shape" and elements:
            shape = _node_for_lint_path(root, elements[0])
            if shape is None or shape.attrib.get("type") != "text":
                continue
            content = next((child for child in shape if child.tag.split("}")[-1] == "content"), None)
            if content is None:
                continue
            if issue.get("overflow_axis") == "height":
                overflow = float(issue.get("overflow") or 0)
                if 0 < overflow <= 24 and content.attrib.get("autoFit") != "normal-auto-fit":
                    content.set("autoFit", "normal-auto-fit")
                    add("text_height_autofit")
            elif issue.get("overflow_axis") == "width":
                needed = float(issue.get("estimated_width") or 0) - float(issue.get("available_width") or 0)
                try:
                    x = float(shape.attrib.get("topLeftX", "0"))
                    width = float(shape.attrib.get("width", "0"))
                except ValueError:
                    continue
                delta = max(0.0, needed + 4)
                if 0 < delta <= 24 and x + width + delta <= 960:
                    shape.set("width", f"{width + delta:.3f}".rstrip("0").rstrip("."))
                    add("text_width_expanded")
        elif issue.get("code") == "text_overflows_container" and len(elements) >= 2:
            owner = _node_for_lint_path(root, elements[1])
            overflow = issue.get("overflow") or {}
            try:
                left, top = float(overflow.get("left", 0)), float(overflow.get("top", 0))
                right, bottom = float(overflow.get("right", 0)), float(overflow.get("bottom", 0))
                x = float(owner.attrib.get("topLeftX", "0")) if owner is not None else 0
                y = float(owner.attrib.get("topLeftY", "0")) if owner is not None else 0
                width = float(owner.attrib.get("width", "0")) if owner is not None else 0
                height = float(owner.attrib.get("height", "0")) if owner is not None else 0
            except (TypeError, ValueError):
                continue
            if owner is None or max(left, top, right, bottom) > 12:
                continue
            new_x, new_y = max(0.0, x - left), max(0.0, y - top)
            new_width = min(960 - new_x, width + left + right)
            new_height = min(540 - new_y, height + top + bottom)
            owner.set("topLeftX", f"{new_x:.3f}".rstrip("0").rstrip("."))
            owner.set("topLeftY", f"{new_y:.3f}".rstrip("0").rstrip("."))
            owner.set("width", f"{new_width:.3f}".rstrip("0").rstrip("."))
            owner.set("height", f"{new_height:.3f}".rstrip("0").rstrip("."))
            add("container_expanded")
    return ET.tostring(root, encoding="unicode") + "\n", codes


def page_asset_contract_errors(xml: str, page: dict) -> list[dict]:
    """Require rendered image sources to match the page blueprint exactly."""
    root = ET.fromstring(xml)
    expected = Counter(str(item.get("src") or "") for item in page.get("images", []))
    actual = Counter(
        str(node.attrib.get("src") or "")
        for node in root.iter()
        if node.tag.split("}")[-1] == "img"
    )
    if actual == expected:
        return []
    return [{
        "code": "rendered_asset_mismatch",
        "message": f"rendered img src values {dict(actual)} do not match blueprint {dict(expected)}",
        "hint": "Use every page images[].src exactly once as specified; do not add, omit, or substitute assets.",
        "path": "slide/data/img",
    }]


def page_font_contract_errors(xml: str, render_contract: dict, *, include_advisory=False) -> list[dict]:
    """Require exact model-authored font families when a contract is present."""
    fonts = (render_contract or {}).get("fonts") or {}
    allowed = {str(value).strip() for value in fonts.values() if str(value).strip()}
    if not allowed:
        return typography_errors(xml, render_contract, require_fonts=False, include_advisory=include_advisory)
    errors: list[dict] = typography_errors(xml, render_contract, include_advisory=True)
    root = ET.fromstring(xml)
    for node in root.iter():
        if node.tag.split("}")[-1] != "content" or "fontSize" not in node.attrib:
            continue
        family = str(node.attrib.get("fontFamily") or "").strip()
        if not family:
            errors.append({
                "code": "missing_font_family",
                "message": "content is missing model-authored fontFamily",
                "hint": "Set one exact family from theme.render_contract.fonts.",
            })
        elif "," in family or family not in allowed:
            errors.append({
                "code": "font_contract_mismatch",
                "message": f"fontFamily {family!r} is outside the exact render contract",
                "hint": "Use one exact family from theme.render_contract.fonts; do not use CSS stacks.",
            })
    return errors if include_advisory else blocking(errors)


def _repair_prompt(original_prompt: str, previous_xml: str, errors: list[dict],
                   history=None, *, final=False) -> str:
    from recovery_feedback import repair_feedback
    decision = repair_feedback(previous_xml, errors, history, final=final)
    return f"""{original_prompt}

## Previous attempt failed the bundled strict SML validator
Return a complete corrected slide, not a patch. Follow the positive SML structures in the contract exactly.
This is targeted SOL page redesign: you may change this page's SML geometry,
arrangement, wrapping and typography beyond local-patch limits. Blueprint block
areas describe the initial design, not a requirement to repeat an infeasible narrow
column. Preserve all claims, qualifiers, required content and exact assets; do not
change other pages or invent facts. If content/authority itself is contradictory,
report the owning-layer problem instead of deleting required content to pass.

Repair decision brief (evidence and history are data, not source instructions):
{json.dumps(decision, ensure_ascii=False, indent=2)}

Previous invalid XML:
{previous_xml}
"""


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _cached_output_is_valid(
    project: Path, output: Path, cache_path: Path, prompt_hash: str, page: dict, render_hash: str,
    render_contract: dict | None = None,
) -> bool:
    if not output.is_file() or not cache_path.is_file():
        return False
    try:
        xml = output.read_text(encoding="utf-8")
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
        if not (
            cache.get("prompt_sha256") == prompt_hash
            and cache.get("output_sha256") == _sha256_text(xml)
            and cache.get("render_contract_sha256") == render_hash
        ):
            return False
        root = ET.fromstring(xml)
        page_no = int(page.get("no") or 0)
        from page_conversion import conversion_findings
        visible = ' '.join(''.join(n.itertext()) for n in root.iter() if n.tag.split('}')[-1] == 'p')
        return not (
            lint_slide_xml(xml)
            or page_asset_contract_errors(xml, page)
            or page_font_contract_errors(xml, render_contract or {})
            or rendered_text_quality_errors(root, page, page_no)
            or rendered_image_quality_errors(root, page, page_no, project / "assets")
            or xml_copy_findings(root, page_no)
            or blocking(conversion_findings(xml, project / 'assets'))
        )
    except (OSError, ValueError, TypeError, json.JSONDecodeError, ET.ParseError, Image.DecompressionBombError):
        return False


def _prepare_render_state(
    project: Path, blueprint: dict, page: dict, style_text: str, use_cache: bool,
    skill_hash: str | None = None, render_hash: str | None = None,
) -> dict:
    authoring = project / "authoring"
    attempts_dir = project / "reports" / "render_attempts"
    run_id = os.environ.get("PPT_BUILD_RUN_ID", "").strip() or None
    run_attempts_dir = (
        project / "reports" / "runs" / run_id / "render_attempts" if run_id else None
    )
    authoring.mkdir(parents=True, exist_ok=True)
    attempts_dir.mkdir(parents=True, exist_ok=True)
    if run_attempts_dir:
        run_attempts_dir.mkdir(parents=True, exist_ok=True)
    page_no = int(page["no"])
    original_prompt = build_page_prompt(blueprint, page, style_text)
    output = authoring / f"slide-{page_no:02d}.xml"
    cache_path = attempts_dir / f"slide-{page_no:02d}-cache.json"
    # Fingerprint requirements, not protocol wording or exception-handling code.
    prompt_hash = _sha256_text(json.dumps({
        "page": page, "theme": blueprint.get("theme"),
        "topic": blueprint.get("topic"), "audience": blueprint.get("audience"),
        "style": style_text if not (blueprint.get("theme") or {}).get("render_contract") else None,
        "generation_version": 1,
    }, ensure_ascii=False, sort_keys=True))
    skill_hash = skill_hash or skill_sha256(Path(__file__).resolve().parents[1])
    render_hash = render_hash or render_contract_sha256(Path(__file__).resolve().parents[1])
    render_contract = (blueprint.get("theme") or {}).get("render_contract") or {}
    state = {
        "project": project, "page": page, "page_no": page_no, "blueprint": blueprint,
        "attempts_dir": attempts_dir, "run_attempts_dir": run_attempts_dir, "run_id": run_id,
        "original_prompt": original_prompt,
        "prompt": original_prompt, "prompt_hash": prompt_hash,
        "output": output, "cache_path": cache_path,
        "skill_hash": skill_hash,
        "render_hash": render_hash,
        "cached": use_cache and _cached_output_is_valid(
            project, output, cache_path, prompt_hash, page, render_hash, render_contract,
        ),
        "render_contract": render_contract,
        "legacy_style_text": style_text if not render_contract else '',
        "last_errors": [],
    }
    from image_lineage import lineage_findings
    asset_lineage_errors=lineage_findings(project,blueprint,[page])
    if asset_lineage_errors:
        state['cached']=False
    if use_cache and not state['cached'] and not asset_lineage_errors:
        history = project / 'artifacts/pages' / f'page-{page_no:02d}'
        for record in sorted(history.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True):
            try:
                metadata = json.loads(record.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                continue
            if not isinstance(metadata, dict):
                continue
            digest = str(metadata.get('output_sha256', ''))
            if not re.fullmatch(r'[a-f0-9]{64}', digest):
                continue
            artifact = project / 'artifacts/sml' / f'{digest}.xml'
            if _cached_output_is_valid(project, artifact, record, prompt_hash, page,
                                       render_hash, render_contract):
                atomic_write_text(output, artifact.read_text(encoding='utf-8'))
                atomic_write_json(cache_path, metadata)
                state['cached'] = True
                break
    if state["cached"] and run_attempts_dir:
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
        cache.update({
            "origin_run_id": cache.get("origin_run_id", cache.get("run_id")),
            "run_id": run_id, "cache_hit": True, "validated": True,
            "skill_sha256": skill_hash, "render_contract_sha256": render_hash,
        })
        atomic_write_json(run_attempts_dir / cache_path.name, cache)
        atomic_write_json(cache_path, cache)
    if state['cached']:
        from call_budget import record_progress
        record_progress(page_no)
    return state


def _write_render_success(state: dict, xml: str) -> Path:
    output = state["output"]
    # Immutable versions survive later rerenders and interrupted publications.
    version_dir = state["project"] / "artifacts" / "sml"
    version_dir.mkdir(parents=True, exist_ok=True)
    if output.is_file():
        previous = output.read_text(encoding="utf-8")
        atomic_write_text(version_dir / f"{_sha256_text(previous)}.xml", previous)
    atomic_write_text(version_dir / f"{_sha256_text(xml)}.xml", xml)
    atomic_write_text(output, xml)
    payload = {
        "run_id": state.get("run_id"),
        "origin_run_id": state.get("run_id"),
        "skill_sha256": state.get("skill_hash"),
        "render_contract_sha256": state.get("render_hash"),
        "prompt_sha256": state["prompt_hash"], "output_sha256": _sha256_text(xml),
        "selected_attempt": state.get("selected_attempt"), "validated": True,
        "local_repair_codes": state.get("last_repair_codes") or [],
        "quality_warnings": state.get('quality_warnings') or [],
        "legacy_style_text": state.get('legacy_style_text',''),
        "written_at_unix": round(time.time(), 3),
    }
    atomic_write_json(state["cache_path"], payload)
    history = state['project'] / 'artifacts/pages' / f"page-{state['page_no']:02d}"
    history.mkdir(parents=True, exist_ok=True)
    # Same bytes under different requirements have separate provenance records.
    atomic_write_json(history / f"{state['prompt_hash']}-{payload['output_sha256']}.json", payload)
    if state.get("run_attempts_dir"):
        atomic_write_json(state["run_attempts_dir"] / state["cache_path"].name, payload)
    from call_budget import record_progress
    record_progress(state['page_no'])
    save_draft(state,xml,[])
    return output


def _run_render_attempt(state: dict, attempt: int, model_fn: Callable[..., str]) -> tuple[bool, bool, float]:
    started = time.time()
    page_no = state["page_no"]
    local_repair_codes: list[str] = []
    try:
        raw = model_fn(state["prompt"], max_tokens=10000, timeout=900)
    except Exception as exc:  # noqa: BLE001
        raw = ""
        xml = ""
        errors = [{"code": "model_call_failed", "message": str(exc), "hint": "Retry the page model call."}]
    else:
        try:
            xml = _extract_slide(raw)
            normalized, local_repair_codes = normalize_sml_aliases(
                xml, state.get("render_contract"), return_repairs=True,
            )
            xml = normalized
            errors = lint_slide_xml(xml)
            errors.extend(page_asset_contract_errors(xml, state["page"]))
            errors.extend(rendered_text_quality_errors(ET.fromstring(xml), state["page"], page_no))
            errors.extend(rendered_image_quality_errors(
                ET.fromstring(xml), state["page"], page_no, state["project"] / "assets",
            ))
        except Exception as exc:  # noqa: BLE001
            xml = raw
            errors = [{"code": "invalid_model_xml", "message": str(exc), "hint": "Return one complete slide XML."}]

    if errors and xml.strip().startswith("<slide"):
        try:
            normalized, geometry_codes = repair_minor_geometry(xml, errors)
            normalized, second_pass_codes = normalize_sml_aliases(normalized, state.get("render_contract"), return_repairs=True)
            normalized_errors = lint_slide_xml(normalized)
            normalized_errors.extend(page_asset_contract_errors(normalized, state["page"]))
            normalized_errors.extend(
                rendered_text_quality_errors(ET.fromstring(normalized), state["page"], page_no)
            )
            normalized_errors.extend(rendered_image_quality_errors(
                ET.fromstring(normalized), state["page"], page_no, state["project"] / "assets",
            ))
            if len(normalized_errors) < len(errors):
                xml, errors = normalized, normalized_errors
                local_repair_codes = list(dict.fromkeys([
                    *local_repair_codes, *geometry_codes, *second_pass_codes,
                ]))
        except (ET.ParseError, ValueError):
            pass

    raw_path = state["attempts_dir"] / f"slide-{page_no:02d}-attempt-{attempt:02d}.txt"
    report_path = state["attempts_dir"] / f"slide-{page_no:02d}-attempt-{attempt:02d}.json"
    attempt_payload = {
        "run_id": state.get("run_id"), "page": page_no,
        "attempt": attempt, "error_count": len(errors), "errors": errors,
        "local_repair_applied": bool(local_repair_codes),
        "local_repair_codes": local_repair_codes,
        "started_at_unix": round(started, 3),
        "finished_at_unix": round(time.time(), 3),
        "latency_s": round(time.time() - started, 3),
    }
    atomic_write_text(raw_path, raw)
    atomic_write_json(report_path, attempt_payload)
    if state.get("run_attempts_dir"):
        atomic_write_text(state["run_attempts_dir"] / raw_path.name, raw)
        atomic_write_json(state["run_attempts_dir"] / report_path.name, attempt_payload)
    state["last_repair_codes"] = local_repair_codes

    if not errors:
        state["selected_attempt"] = attempt
        _write_render_success(state, xml)
        return True, bool(local_repair_codes), time.time() - started
    state["last_errors"] = errors
    state["prompt"] = _repair_prompt(state["original_prompt"], xml, errors)
    return False, bool(local_repair_codes), time.time() - started


def render_page(
    project: Path,
    blueprint: dict,
    page: dict,
    style_text: str,
    *,
    max_retries: int = 2,
    model_fn: Callable[..., str] = sol,
    use_cache: bool = True,
) -> Path:
    """Render and strictly validate one page before it reaches authoring/."""
    state = _prepare_render_state(
        project, blueprint, page, style_text, use_cache,
        skill_sha256(Path(__file__).resolve().parents[1]),
        render_contract_sha256(Path(__file__).resolve().parents[1]),
    )
    if state["cached"]:
        return state["output"]
    for attempt in range(1, max_retries + 2):
        succeeded, _, _ = _run_render_attempt(state, attempt, model_fn)
        if succeeded:
            return state["output"]
    summary = "; ".join(
        f"{item.get('code')}: {item.get('message')}" for item in state["last_errors"][:5]
    )
    raise RuntimeError(
        f"slide {state['page_no']} failed strict SML lint after {max_retries + 1} attempts: {summary}"
    )


def render_page_strict(
    project: Path,
    blueprint: dict,
    page: dict,
    style_text: str,
    *,
    max_retries: int = 2,
    model_fn: Callable[..., str] = sol,
    use_cache: bool = False,
    initial_xml: str | None = None,
    initial_errors: list[dict] | None = None,
) -> tuple[Path | None, int, str | None]:
    """Targeted full-page rerender with lossless validation and no local SML compiler."""
    state = _prepare_render_state(
        project, blueprint, page, style_text, use_cache,
        skill_sha256(Path(__file__).resolve().parents[1]),
        render_contract_sha256(Path(__file__).resolve().parents[1]),
    )
    if state["cached"]:
        return state["output"], 0, None
    from recovery_feedback import select_base, recovery_rank, repair_feedback, record_attempt
    best, history = select_base(state, initial_xml)
    if best:
        if not best[1]:
            return _write_render_success(state, best[0]), 0, None
        state["prompt"] = _repair_prompt(state["original_prompt"], best[0], best[1], history)

    calls = 0
    attempt = 0
    while attempt < max_retries + 1 or (max_retries > 0 and getattr(model_fn, 'progress_controlled', False)):
        attempt += 1
        started = time.time()
        calls += 1
        raw = ""
        strategy = repair_feedback(best[0], best[1], history)['strategy'] if best else 'initial'
        from request_journal import set_context
        set_context(model_fn,state,'full')
        if best and strategy == 'recompose':
            history = record_attempt(state, best[0], best[1], best[0], best[1],
                                     strategy=strategy, intent=True)
        try:
            try:
                raw = str(model_fn(state["prompt"], max_tokens=10000, timeout=900))
            except BudgetExhausted:
                raise
            except Exception as exc:
                return None, calls, 'model_transport_error: ' + str(exc)
            finally:
                calls += max(0,getattr(model_fn,'last_submission_count',1)-1)
            xml = _extract_slide(raw)
            candidate, errors, _repair_codes = _validate_batch_candidate(state, xml)
        except BudgetExhausted as exc:
            return None, calls if getattr(model_fn,'last_submission_count',0) else calls - 1, str(exc)
        except Exception as exc:  # noqa: BLE001
            candidate = raw
            errors = [{
                "code": "invalid_model_xml", "message": str(exc),
                "hint": "Return one complete page-scoped SML slide.",
            }]

        history = record_attempt(state, best[0] if best else '', best[1] if best else [],
                                 candidate, errors, strategy=strategy)
        save_draft(state, candidate, errors)
        feedback(model_fn, progress_score(errors), "strict validation")
        raw_path = state["attempts_dir"] / f"slide-{state['page_no']:02d}-strict-{attempt:02d}.txt"
        report_path = state["attempts_dir"] / f"slide-{state['page_no']:02d}-strict-{attempt:02d}.json"
        report = {
            "run_id": state.get("run_id"), "page": state["page_no"],
            "attempt": attempt, "mode": "strict_full_rerender",
            "repair_strategy": strategy,
            "error_count": len(errors), "errors": errors,
            "local_repair_applied": False, "local_repair_codes": [],
            "started_at_unix": round(started, 3),
            "finished_at_unix": round(time.time(), 3),
            "latency_s": round(time.time() - started, 3),
        }
        atomic_write_text(raw_path, raw)
        atomic_write_json(report_path, report)
        if state.get("run_attempts_dir"):
            atomic_write_text(state["run_attempts_dir"] / raw_path.name, raw)
            atomic_write_json(state["run_attempts_dir"] / report_path.name, report)

        if any(e.get('code') in LOCAL_FAILURE_CODES for e in errors):
            return None, calls, 'local_dependency_failure: ' + str(errors)
        if not errors:
            state["selected_attempt"] = f"strict-{attempt}"
            state["last_repair_codes"] = []
            return _write_render_success(state, candidate), calls, None
        state["last_errors"] = errors
        if best is None or recovery_rank(errors) < recovery_rank(best[1]):
            best = (candidate, errors)
        state["prompt"] = _repair_prompt(state["original_prompt"], best[0], best[1], history)

    summary = "; ".join(
        f"{item.get('code')}: {item.get('message')}" for item in state["last_errors"][:5]
    )
    return None, calls, (
        f"slide {state['page_no']} failed strict lossless validation after {calls} calls: {summary}"
    )


def render_direct(
    project: Path, blueprint: dict, style_text: str,
    start: int | None, end: int | None, max_retries: int = 2,
    workers: int = 4, force: bool = False,
    model_fn: Callable[..., str] = sol,
    page_numbers: set[int] | None = None,
    stage_name: str = "render",
) -> int:
    selected = [
        page for page in blueprint.get("pages", [])
        if (start is None or page["no"] >= start)
        and (end is None or page["no"] <= end)
        and (page_numbers is None or int(page["no"]) in page_numbers)
    ]
    if not selected:
        raise ValueError("no pages selected for rendering")
    if workers < 1:
        raise ValueError("workers must be at least 1")
    if max_retries < 0:
        raise ValueError("max_retries cannot be negative")

    batch_started = time.time()
    current_skill_hash = skill_sha256(Path(__file__).resolve().parents[1])
    current_render_hash = render_contract_sha256(Path(__file__).resolve().parents[1])
    states = [
        _prepare_render_state(
            project, blueprint, page, style_text, not force, current_skill_hash, current_render_hash,
        )
        for page in selected
    ]
    pending = [state for state in states if not state["cached"]]
    cache_hits = len(states) - len(pending)
    for state in states:
        if state["cached"]:
            print(f"[cached+linted] {state['output'].name}")

    model_calls = 0
    locally_repaired_attempts = 0
    local_repair_counts: Counter[str] = Counter()
    for attempt in range(1, max_retries + 2):
        if not pending:
            break
        next_pending: list[dict] = []
        with ThreadPoolExecutor(max_workers=min(workers, len(pending))) as executor:
            futures = {
                executor.submit(_run_render_attempt, state, attempt, model_fn): state
                for state in pending
            }
            for future in as_completed(futures):
                state = futures[future]
                succeeded, repaired, latency = future.result()
                model_calls += 1
                locally_repaired_attempts += int(repaired)
                local_repair_counts.update(state.get("last_repair_codes") or [])
                if succeeded:
                    output = state["output"]
                    print(
                        f"[rendered+linted] {output.name} bytes={output.stat().st_size} "
                        f"attempt={attempt} latency_s={round(latency, 1)}"
                    )
                else:
                    next_pending.append(state)
                    if attempt <= max_retries:
                        print(f"[retry-queued] slide-{state['page_no']:02d} next_attempt={attempt + 1}")
        pending = sorted(next_pending, key=lambda item: item["page_no"])

    write_stage_metric(
        project, stage_name, batch_started, status="failed" if pending else "success",
        pages=len(states), cache_hits=cache_hits, model_calls=model_calls,
        local_repairs=sum(local_repair_counts.values()),
        locally_repaired_attempts=locally_repaired_attempts,
        local_repair_counts=dict(sorted(local_repair_counts.items())), workers=workers,
        mode="legacy_direct_diagnostic",
    )
    if pending:
        failures = []
        for state in pending:
            summary = "; ".join(
                f"{item.get('code')}: {item.get('message')}" for item in state["last_errors"][:5]
            )
            message = (
                f"slide {state['page_no']} failed strict SML lint after "
                f"{max_retries + 1} attempts: {summary}"
            )
            failures.append((state["page_no"], message))
            print(f"[FAIL] slide-{state['page_no']:02d}: {message}", file=sys.stderr)
        details = "; ".join(f"slide {page_no}: {message}" for page_no, message in failures)
        raise RuntimeError(f"render failed for {len(failures)} page(s): {details}")
    return 0


def _validate_batch_candidate(state: dict, xml: str, *, check_conversion: bool = True) -> tuple[str, list[dict], list[str]]:
    """Validate the model's exact SML without compiling or repairing it locally."""
    page_no = state["page_no"]
    try:
        root = ET.fromstring(xml)
        lint_warnings = []
        errors = lint_slide_xml(xml, warnings_out=lint_warnings)
        errors.extend(page_asset_contract_errors(xml, state["page"]))
        from image_lineage import lineage_findings
        errors.extend(lineage_findings(state['project'], state.get('blueprint',{}), [state['page']]))
        errors.extend(page_font_contract_errors(xml, state.get("render_contract") or {}, include_advisory=True))
        errors.extend(rendered_text_quality_errors(root, state["page"], page_no, include_advisory=True))
        errors.extend(rendered_image_quality_errors(
            root, state["page"], page_no, state["project"] / "assets", include_advisory=True,
        ))
        visible = ' '.join(''.join(n.itertext()) for n in root.iter() if n.tag.split('}')[-1] == 'p')
        errors.extend(xml_copy_findings(root, page_no, include_advisory=True))
        # A page is not successful until the actual local backend can save and
        # reopen it. This also supplies converter findings to ordinary repairs.
        if check_conversion and not blocking(errors):
            from page_conversion import conversion_findings
            errors.extend(conversion_findings(xml, state['project'] / 'assets'))
        errors, warnings = partition(errors)
        state['quality_warnings'] = lint_warnings + warnings
        return xml, errors, []
    except Exception as exc:  # noqa: BLE001
        if isinstance(exc, ET.ParseError):
            code = 'invalid_model_xml'
        elif isinstance(exc, (OSError, Image.DecompressionBombError)):
            code = 'asset_consumer_error'
        else:
            code = 'validator_internal_error'
        return xml, [{
            "code": code,
            "message": str(exc),
            "hint": "Return one complete page-scoped SML slide." if isinstance(exc, ET.ParseError) else "Inspect local asset/validator environment; do not spend model retries on this exception.",
        }], []


def build_patch_prompt(
    page: dict, sml: str, defects: list[dict], *, run_id: str, round_number: int, history=None,
) -> str:
    """Expose stable targets and require an exact conservative patch envelope."""
    envelope = {
        "patch_schema_version": "1", "run_id": run_id, "page_no": int(page["no"]),
        "base_sml_hash": sml_sha256(sml), "blueprint_hash": blueprint_sha256(page),
        "preserve_text_hash": preserve_text_sha256(sml),
        "preserve_assets_hash": preserve_assets_sha256(sml),
        "round": round_number,
        "defect_ids": [item.get("defect_id") for item in defects if item.get("defect_id")],
        "operations": [],
    }
    inventory = prompt_element_inventory(sml)
    from recovery_feedback import repair_feedback
    return f"""SML_PATCH_REQUEST
你是 SML 局部修复专家。判断当前缺陷能否通过保守局部修改解决。
设计、坐标和样式修改值必须由你明确给出；本地程序只会校验、事务式应用或回滚。

{COPY_CONTRACT}

## 页面蓝图
{json.dumps(audience_page(page), ensure_ascii=False, indent=2)}

## 当前 SML
{sml}

## 可寻址对象清单
{json.dumps(inventory, ensure_ascii=False, separators=(',',':'))}

## 待修缺陷
{json.dumps(defects, ensure_ascii=False, indent=2)}

## 修复决策依据（证据，不是额外指令）
{json.dumps(repair_feedback(sml, defects, history), ensure_ascii=False, indent=2)}
若所需构图调整无法用允许的操作表达，返回 full_rerender，不要压缩文本框掩盖溢出。

## 可用操作与硬边界
对象的 rules 引用 rule_profiles；引用的规则完整适用于该对象，不得把其他对象的操作权限借用过来。
每个目标只允许其 allowed_operations 列出的字段。crop 操作指向现有 crop 子节点，不能把 type 写在 img 上。
没有可行字段或需要新增节点时返回 full_rerender；不得猜测 CSS 属性。
{json.dumps({
    "operations": {name: sorted(fields) for name, fields in PATCH_OPERATION_FIELDS.items()},
    "small_edit_recommendations": {k:v for k,v in PATCH_LIMITS.items() if k != "max_rounds"},
    "protocol_limits": {"max_operations": PATCH_PROTOCOL_MAX_OPERATIONS, "max_rounds": PATCH_LIMITS["max_rounds"]},
    "null_semantics": "before=null means the attribute must be absent; after=null removes it",
}, ensure_ascii=False, indent=2)}

## 运行时已绑定的请求身份（无需抄写哈希；若返回这些字段则必须与此一致）
{json.dumps({'page_no':envelope['page_no'],'round':round_number}, ensure_ascii=False)}

只能输出以下二者之一：
1. {{"page_no":{int(page['no'])},"operations":[...]}}；operations 仅可使用 set_geometry、set_text_layout、set_style、set_crop、set_z_order。
2. {{"action":"full_rerender","page_no":{int(page['no'])},"reason":"..."}}

每个 operation 必须包含 op_id、op_type、target.object_id、before、after；reason 是可选解释，不因遗漏而拒绝有效修复。
before 与 after 的字段集合必须完全相同；新增属性也要在 before 中明确写 null。例如：
{{"op_id":"op-1","op_type":"set_text_layout","target":{{"object_id":"从清单选取的真实ID"}},"before":{{"autoFit":null}},"after":{{"autoFit":"normal-auto-fit"}},"reason":"启用已确认可行的文本布局属性"}}
坐标区间不是独立可任选：修改后的 x+w≤960、y+h≤540，且 x/y≥0、w/h>0。32px/20% 只是小改动参考，不是拒绝安全补丁的限制；所有精确值由你提供，整页复验失败则回滚。
放大字框前检查与有效文字的墨迹冲突；不能靠缩小字框隐藏未解决的字高问题。背景装饰板不自动等于文本裁切容器。
运行时根据本次对象清单绑定 stable_path 和 element_fingerprint，勿抄写长哈希。
禁止改文字、事实、素材、对象数量、schema 或页面结构。
"""


def patch_feasibility(sml: str, errors: list[dict]) -> dict:
    """Optimistic capacity bound only; never calculates or writes a replacement layout."""
    errors = blocking(errors)
    if not errors:
        return {'action':'already_valid','reason':'current page has no blocking findings'}
    if any(e.get('code') in LOCAL_FAILURE_CODES for e in errors):
        return {'action':'block','reason':'local dependency/validator failure'}
    from xml_lint import extract_elements, element_ref, estimate_text_width, attach_source_xml_paths, build_source_xml_paths
    from ppt_contract import MIN_BODY_FONT, MIN_CAPTION_FONT
    import math
    extracted = extract_elements(sml)
    attach_source_xml_paths(extracted,build_source_xml_paths(sml,1))
    elements = {element_ref(e):e for e in extracted}
    for error in errors:
        if error.get('code') != 'text_may_overflow_shape':
            continue
        for ref in error.get('elements',[]):
            element = elements.get(ref)
            if not element or not element.get('text'):
                continue
            minimum = MIN_CAPTION_FONT if element.get('textType')=='caption' else MIN_BODY_FONT
            width, height = 960.0, 540.0
            if width <= 0 or height <= 0:
                return {'action':'full_rerender','reason':'invalid text container'}
            # Even a smaller-font, zero-padding, tight-leading, widest legal
            # container cannot hold this copy: do not buy an impossible patch.
            advance = estimate_text_width(element['text'],minimum,0,False,element.get('fontFamily',''))
            lower_height = max(1,math.ceil(advance/width))*minimum
            if lower_height > height*1.15:
                return {'action':'full_rerender','reason':'text capacity exceeds conservative patch envelope'}
    return {'action':'patch','reason':'local patch may be feasible'}


def repair_page_with_model_patch(
    project: Path, blueprint: dict, page: dict, draft_path: Path, defects: list[dict],
    *, run_id: str, model_fn: Callable[..., str], max_rounds: int = 2,
    resolve_on_success: bool = True,
    render_state: dict | None = None,
) -> tuple[bool, int, str | None]:
    """Try bounded model-authored patches and publish only a fully valid page."""
    defects = blocking(defects)
    if any(d.get('code') == 'ghost_number_too_large' for d in defects):
        from qa_gate import _text_boxes
        try:
            boxes = _text_boxes(ET.fromstring(draft_path.read_text(encoding='utf-8')))
            for box in boxes:
                if box['font_size'] >= 64 and re.fullmatch(r'\d{1,3}', box['text'].strip()):
                    smallest_patch_area = box['w'] * box['h'] * (1 - PATCH_LIMITS['max_resize_ratio']) ** 2
                    if smallest_patch_area > 960 * 540 * GHOST_NUMBER_MAX_AREA_RATIO:
                        return False, 0, 'full_rerender: numeric area cannot fit within transactional resize limits'
        except ET.ParseError:
            return False, 0, 'full_rerender: malformed SML cannot receive a conservative patch'
    state = render_state or _prepare_render_state(
        project, blueprint, page, "", False,
        skill_sha256(Path(__file__).resolve().parents[1]),
        render_contract_sha256(Path(__file__).resolve().parents[1]),
    )
    calls = 0
    from recovery_feedback import recovery_history, repair_feedback, record_attempt
    history = recovery_history(state)
    last_reason: str | None = None
    original_defect_ids = [item['defect_id'] for item in defects if item.get('defect_id')]
    if draft_path.is_file():
        original = draft_path.read_text(encoding='utf-8')
        _, current_errors, _ = _validate_batch_candidate(state,original)
        route = patch_feasibility(original,current_errors)
        if route['action']=='already_valid':
            _write_render_success(state,original)
            return True,0,None
        if route['action'] in {'full_rerender','block'}:
            return False,0,('full_rerender: ' if route['action']=='full_rerender' else 'local_dependency_failure: ')+route['reason']
    if not draft_path.is_file():
        return False, 0, 'full_rerender: missing draft'
    working_path = (state.get('run_attempts_dir') or state['attempts_dir']) / f"slide-{state['page_no']:02d}-patch-working.xml"
    atomic_write_text(working_path, draft_path.read_text(encoding='utf-8'))
    defects = current_errors
    for round_number in range(1, max_rounds + 1):
        sml = working_path.read_text(encoding="utf-8")
        decision = repair_feedback(sml, defects, history)
        if decision['strategy'] != 'local_repair':
            record_attempt(state, sml, defects, sml, defects, strategy=decision['strategy'], intent=True)
            return False, calls, 'full_rerender: ' + decision['strategy']
        prompt = build_patch_prompt(
            page, sml, defects, run_id=run_id, round_number=round_number, history=history,
        )
        if last_reason:
            prompt += "\nPrevious transaction was rejected; correct this cause: " + last_reason
        calls += 1
        patch_started = time.time()
        raw = ""
        from request_journal import set_context
        set_context(model_fn,state,'patch',base_xml=sml,run_id=run_id,round_number=round_number,
                    defect_ids=[item['defect_id'] for item in defects if item.get('defect_id')])
        try:
            try:
                raw = model_fn(prompt, max_tokens=6000, timeout=600)
            except BudgetExhausted:
                raise
            except Exception as exc:
                return False, calls, 'model_transport_error: ' + str(exc)
            finally:
                calls += max(0,getattr(model_fn,'last_submission_count',1)-1)
            response = extract_json(str(raw))
            if not isinstance(response, dict):
                raise ValueError("patch response must be a JSON object, not an array or scalar")
            if response.get("action") == "full_rerender":
                reason = str(response.get("reason") or "model requested full rerender")
                if state.get("run_attempts_dir"):
                    atomic_write_json(state['run_attempts_dir'] / f"slide-{state['page_no']:02d}-patch-{round_number:02d}.json",
                                      {"page": state['page_no'], "status": "rerender_requested", "reason": reason})
                feedback(model_fn, len(defects), "model requested full rerender")
                record_attempt(state, sml, defects, sml, defects, strategy='recompose')
                return False, calls, reason
            response = bind_patch_response(response, sml, page, run_id=run_id,
                round_number=round_number,
                defect_ids=[item['defect_id'] for item in defects if item.get('defect_id')])
            result = apply_patch_transaction(
                working_path, response, page,
                validate_fn=lambda candidate: _validate_batch_candidate(state, candidate)[1],
                expected_run_id=run_id,
                expected_defect_ids=[
                    item.get("defect_id") for item in defects if item.get("defect_id")
                ],
            )
        except BudgetExhausted as exc:
            return False, calls if getattr(model_fn,'last_submission_count',0) else calls - 1, str(exc)
        except (PatchRejected, ValueError, TypeError, json.JSONDecodeError, ET.ParseError) as exc:
            last_reason = str(exc)
            feedback(model_fn, len(defects) or 1, "patch rejected")
            history = record_attempt(state, sml, defects, sml, defects, strategy='local_repair', detail=last_reason)
            if state.get("run_attempts_dir"):
                prefix = state["run_attempts_dir"] / f"slide-{state['page_no']:02d}-patch-{round_number:02d}"
                atomic_write_text(prefix.with_suffix('.txt'), str(raw))
                atomic_write_json(prefix.with_suffix('.json'), {
                    "page": state['page_no'], "status": "rejected", "reason": last_reason,
                    "latency_s": time.time() - patch_started,
                })
            continue
        if state.get("run_attempts_dir"):
            prefix = state["run_attempts_dir"] / f"slide-{state['page_no']:02d}-patch-{round_number:02d}"
            atomic_write_text(prefix.with_suffix('.txt'), str(raw))
            atomic_write_json(prefix.with_suffix('.json'), {
                "page": state['page_no'], "status": "committed" if result.committed else "rejected",
                "reason": result.reason, "latency_s": time.time() - patch_started,
                "validation_errors": result.errors,
            })
        if result.committed:
            save_draft(state, working_path.read_text(encoding='utf-8'), [])
        elif result.candidate_xml and candidate_improves(defects, result.errors):
            save_draft(state, result.candidate_xml, result.errors)
        feedback(model_fn, 0 if result.committed else max(1, progress_score(result.errors)), "patch validation")
        history = record_attempt(state, sml, defects, result.candidate_xml or sml,
                                 [] if result.committed else result.errors or defects,
                                 strategy='local_repair', detail=result.reason)
        if any(e.get('code') in LOCAL_FAILURE_CODES for e in result.errors):
            return False, calls, 'local_dependency_failure: ' + str(result.errors)
        if result.committed:
            final_xml = working_path.read_text(encoding="utf-8")
            atomic_write_text(draft_path, final_xml)
            state["selected_attempt"] = f"patch-{round_number}"
            state["last_repair_codes"] = ["model_transactional_patch"]
            _write_render_success(state, final_xml)
            defect_ids = original_defect_ids
            if resolve_on_success and defect_ids:
                resolve_defects(project, run_id, defect_ids)
            return True, calls, None
        if result.candidate_xml and candidate_improves(defects, result.errors):
            # Isolated exact model work, never a successful authoring/cache entry.
            atomic_write_text(working_path, result.candidate_xml)
            save_draft(state, result.candidate_xml, result.errors)
            atomic_write_json(working_path.with_suffix('.json'), {
                'status':'candidate','page_no':state['page_no'],'prompt_hash':state['prompt_hash'],
                'base_sml_sha256':sml_sha256(sml),'sml_sha256':sml_sha256(result.candidate_xml),
                'errors':result.errors,'round':round_number,'run_id':run_id})
            defects = result.errors
            last_reason = 'Previous exact patch improved this isolated candidate; repair its remaining findings.'
            continue
        last_reason = str(result.reason or '') + '\nRejected candidate findings (original SML was restored):\n' + json.dumps(result.errors, ensure_ascii=False)
    decision = repair_feedback(working_path.read_text(encoding='utf-8'), defects, history)
    if decision['strategy'] == 'recompose':
        return False, calls, 'full_rerender: recompose; ' + (last_reason or 'non-improving local repair')
    return False, calls, last_reason or "patch rounds exhausted"


def render_adaptive_batches(
    project: Path, blueprint: dict, style_text: str,
    start: int | None, end: int | None, *, workers: int = 4,
    force: bool = False, model_fn: Callable[..., str] = sol,
    page_numbers: set[int] | None = None, stage_name: str = "render",
    repair: bool = True, max_retries: int = 2,
    repair_pages: set[int] | None = None, extra_calls: int = 0, approval_id: str | None = None,
) -> int:
    """Render complete first-pass batches before any page-level recovery."""
    selected = [
        page for page in blueprint.get("pages", [])
        if (start is None or int(page["no"]) >= start)
        and (end is None or int(page["no"]) <= end)
        and (page_numbers is None or int(page["no"]) in page_numbers)
    ]
    if not selected:
        raise ValueError("no pages selected for rendering")
    if workers < 1:
        raise ValueError("workers must be at least 1")
    if max_retries < 0:
        raise ValueError("max_retries cannot be negative")

    started = time.time()
    run_id = os.environ.get("PPT_BUILD_RUN_ID", "").strip() or (
        "render-" + time.strftime("%Y%m%dT%H%M%S")
    )
    current_skill_hash = skill_sha256(Path(__file__).resolve().parents[1])
    current_render_hash = render_contract_sha256(Path(__file__).resolve().parents[1])
    states = [
        _prepare_render_state(
            project, blueprint, page, style_text, not force,
            current_skill_hash, current_render_hash,
        ) for page in selected
    ]
    pending_states = [state for state in states if not state["cached"]]
    excluded = set()
    if repair_pages is not None:
        unresolved = {s['page_no'] for s in pending_states}
        if not repair_pages or not repair_pages.issubset(unresolved):
            raise ValueError('repair-pages must name unresolved pages only; validated pages are immutable cache hits')
        excluded = unresolved - repair_pages
        pending_states = [s for s in pending_states if s['page_no'] in repair_pages]
    if extra_calls and (not repair_pages or not approval_id):
        raise ValueError('extra-calls requires repair-pages and approval-id')
    grants = distribute_grant(extra_calls, repair_pages or set())
    state_by_page = {state["page_no"]: state for state in pending_states}
    # Pilot/full/resume invocations may share one run; never overwrite their costs.
    batch_invocation = uuid.uuid4().hex
    batch_dir = project / "reports" / "runs" / run_id / "render_batches" / batch_invocation
    draft_dir = project / "reports" / "runs" / run_id / "render_drafts"
    batch_dir.mkdir(parents=True, exist_ok=True)
    draft_dir.mkdir(parents=True, exist_ok=True)
    findings: list[dict] = []
    first_pass_states = []
    from delivery import read as read_delivery_json
    asset_errors = read_delivery_json(project/'reports/asset_preflight.json').get('errors',[])
    from image_lineage import lineage_findings
    for issue in lineage_findings(project,blueprint,[s['page'] for s in pending_states]):
        # The dependency queue checks receipts at admission time. A tracked old
        # file may be awaiting regeneration; do not exclude its page prematurely.
        if os.environ.get('PPT_DEPENDENCY_QUEUE')=='1':
            continue
        asset_errors.append(issue)
    blocked_sources = {e.get('src') for e in asset_errors if e.get('code') == 'asset_consumer_error'}
    for state in pending_states:
        if any(i.get('src') in blocked_sources for i in state['page'].get('images',[])):
            findings.append({'page_no':state['page_no'],'stage':'asset_preflight',
                             'code':'asset_consumer_error','message':'Repair declared asset before rerender'})
            continue
        from recovery_feedback import select_base
        best, _ = select_base(state) if not force else (None, [])
        if best:
            candidate, errors = best
            if not errors:
                _write_render_success(state, candidate)
                continue
            atomic_write_text(draft_dir / f"slide-{state['page_no']:02d}.xml", candidate)
            findings.extend(dict(e, page_no=state['page_no'], stage='render_resumed_draft') for e in errors)
        else:
            first_pass_states.append(state)
    first_pages = [state['page'] for state in first_pass_states]
    if os.environ.get('PPT_DEPENDENCY_QUEUE') == '1':
        from dependency_queue import dependency_batches
        batches = dependency_batches(project, first_pages, build_render_batches)
    else:
        batches = build_render_batches(first_pages)
    salvaged_pages = 0
    model_calls = 0
    response_cache_hits = set()
    first_pass_validated = []
    first_pass_latencies = []
    executions = {i: {'run_id':run_id,'stage':stage_name,'invocation':batch_invocation,'batch':i,'pages':[int(p['no']) for p in batch],
                     'execution_state':'queued','submitted':False,'responded':False,
                     'response_cache_hit':False}
                  for i,batch in enumerate(batches,1)}
    def record_execution(index, **updates):
        # Each worker owns one entry; coordinator reads it after completion.
        executions.setdefault(index,{'run_id':run_id,'stage':stage_name,'invocation':batch_invocation,'batch':index,'execution_state':'queued',
                                     'submitted':False,'responded':False,'response_cache_hit':False})
        executions[index]['pages']=[int(p['no']) for p in batches[index-1]]
        executions[index].update(updates)
        atomic_write_json(batch_dir / f'batch-{index:02d}.json',executions[index])
    for index in executions:
        record_execution(index)

    def run_batch(index: int, batch_pages: list[dict]) -> tuple[int, str, float, str | None]:
        record_execution(index,execution_state='preparing')
        prompt = build_batch_prompt(blueprint, batch_pages, style_text)
        calibration_path = project / 'reports/runs' / run_id / 'pilot_calibration.json'
        if stage_name != 'pilot_render' and calibration_path.exists():
            calibration = json.loads(calibration_path.read_text(encoding='utf-8'))
            if calibration.get('run_id') == run_id:
                prompt += '\nPILOT_CALIBRATION（内部诊断，不是正文）：\n' + json.dumps({
                    'observed_codes': calibration.get('observed_codes', {}),
                    'instruction': '优先自查这些已实测的问题类型；依照上面的字体、连线和文字空间合同设计。不要复制其他页内容或改变事实。'
                }, ensure_ascii=False)
        call_started = time.time()
        try:
            key = _sha256_text(prompt)
            saved = project / 'reports/render_responses' / (key + '.json')
            if saved.exists():
                raw = json.loads(saved.read_text(encoding='utf-8'))['response']
                response_cache_hits.add(index)
                record_execution(index,execution_state='replayed',response_cache_hit=True)
            else:
                budget = WorkBudget(project, 'render-first-pass', 'render')
                token = budget.reserve('batch:' + key)
                record_execution(index,execution_state='admitted',attempt_id=token)
                try:
                    from request_journal import invoke
                    def measured_model(*args, **kwargs):
                        count=executions[index].get('submission_count',0)+1
                        record_execution(index,execution_state='submitted',submitted=True,submission_count=count)
                        try:
                            response = model_fn(*args, **kwargs)
                        except BudgetExhausted:
                            # Adapter admission refusal is explicitly not a request.
                            record_execution(index,execution_state='budget_denied',submitted=False)
                            record_execution(index,submission_count=count-1,submitted=count>1)
                            raise
                        record_execution(index,execution_state='responded',responded=True)
                        return response
                    raw = invoke(budget,token,prompt,measured_model,context={'kind':'batch'},max_tokens=24000,timeout=1200)
                    token = budget.effective_token(token)
                    record_execution(index,attempt_id=token)
                    receipt = json.loads((project / 'reports/request_journal' / f'{token}.json').read_text(encoding='utf-8'))
                    record_execution(index, **{k: receipt.get(k) for k in
                        ('provider_usage', 'finish_reason', 'response_id', 'model', 'requested_max_tokens')})
                    atomic_write_json(saved, {'response': str(raw)})
                    budget.finish(token, remaining=0, detail='response saved; fragments validated separately')
                except Exception as exc:
                    with budget.connect() as db:
                        db.execute("UPDATE attempts SET status='outcome_unknown',detail=? WHERE id=? AND status='in_flight'",
                                   (type(exc).__name__,token))
                    raise
            return index, str(raw), time.time() - call_started, None
        except BudgetExhausted as exc:
            if 'transport_retry_exhausted' in str(exc):
                record_execution(index,execution_state='post_submit_error')
                return index,'',time.time()-call_started,'model_transport_error: '+str(exc)
            record_execution(index,execution_state='budget_denied')
            return index, '', time.time() - call_started, 'budget_denied: ' + str(exc)
        except Exception as exc:  # noqa: BLE001
            record_execution(index,execution_state=('post_submit_error' if executions[index]['submitted'] else 'pre_submit_error'))
            return index, "", time.time() - call_started, str(exc)

    def completed_batches():
        if os.environ.get('PPT_DEPENDENCY_QUEUE') == '1':
            from dependency_queue import completed_ready_batches
            yield from completed_ready_batches(project, batches, workers, run_batch)
            return
        if batches:
            with ThreadPoolExecutor(max_workers=min(workers, len(batches))) as executor:
                futures = {
                    executor.submit(run_batch, index, batch): index
                    for index, batch in enumerate(batches, 1)
                }
                for future in as_completed(futures):
                    yield future.result()

    for index, raw, latency, call_error in completed_batches():
        first_pass_latencies.append(latency)
        denied = bool(call_error and call_error.startswith('budget_denied:'))
        dependency_failed = bool(call_error and call_error.startswith('asset_dependency_'))
        if dependency_failed:
            record_execution(index,execution_state='dependency_blocked')
        model_calls += executions[index].get('submission_count',int(executions[index]['submitted']))
        batch_pages = batches[index - 1]
        page_ids = [int(page["no"]) for page in batch_pages]
        atomic_write_text(batch_dir / f"batch-{index:02d}.txt", raw)
        expected_hashes = {
            int(page["no"]): blueprint_sha256(page) for page in batch_pages
        }
        fragments = extract_complete_slide_fragments(raw, expected_hashes) if raw else {}
        report = {
            **executions[index],
            "run_id": run_id, "batch": index, "pages": page_ids,
            "latency_s": round(latency, 3), "model_error": call_error,
            "response_cache_hit": index in response_cache_hits,
            "complete_fragments": sorted(fragments),
        }
        atomic_write_json(batch_dir / f"batch-{index:02d}.json", report)
        print(json.dumps({"event": "batch_completed", **report}, ensure_ascii=False), flush=True)
        for page_no in page_ids:
            state = state_by_page[page_no]
            xml = fragments.get(page_no)
            if xml is None:
                message = call_error or "batch response did not contain a complete framed slide"
                findings.append({
                    "page_no": page_no, "stage": "render_first_pass", "severity": "blocking",
                    "code": ("execution_budget_exhausted" if denied else 'asset_dependency_failed' if dependency_failed
                             else 'model_transport_error' if call_error else "missing_slide"), "message": message,
                    "evidence_hash": _sha256_text(f"{index}:{page_no}:{message}"),
                    "suggested_action": "full_rerender",
                })
                continue
            salvaged_pages += 1
            normalized, errors, repair_codes = _validate_batch_candidate(state, xml)
            save_draft(state, normalized, errors)
            atomic_write_text(draft_dir / f"slide-{page_no:02d}.xml", normalized)
            if errors:
                for error in errors:
                    findings.append({
                        "page_no": page_no, "stage": "render_first_pass",
                        "severity": "blocking", "code": error.get("code", "render_invalid"),
                        "message": error.get("message", "render validation failed"),
                        "object_id": (error.get("elements") or [None])[0],
                        "evidence_hash": _sha256_text(json.dumps(error, ensure_ascii=False, sort_keys=True)),
                        "suggested_action": classify_action({"code": error.get("code", "render_invalid")}),
                    })
                continue
            state["selected_attempt"] = f"batch-{index:02d}"
            state["last_repair_codes"] = repair_codes
            _write_render_success(state, normalized)
            first_pass_validated.append(page_no)

    if findings:
        merge_defects(project, run_id, findings)
    if stage_name == 'pilot_render':
        # Calibration records diagnosis only. Page quality is still validated
        # and repaired in the ordinary full pass, under the SAME page budgets.
        blocked = {'model_transport_error', 'execution_budget_exhausted', 'validator_internal_error',
                   'asset_consumer_error', 'asset_dependency_failed', 'invalid_model_xml'}
        atomic_write_json(project / 'reports/runs' / run_id / 'pilot_calibration.json', {
            'run_id': run_id, 'observed_codes': dict(Counter(f['code'] for f in findings)),
            'deferred_pages': sorted({f['page_no'] for f in findings}),
            'can_continue': bool(salvaged_pages or any(s['cached'] for s in states))
                            and not any(f['code'] in blocked for f in findings),
            'paid_repair_calls': 0 if not repair else None,
            'first_pass_only': not repair})

    # Recovery is deliberately postponed until every first-pass batch has
    # completed. Patchable drafts enter the transactional model-authored patch
    # lane first; unsafe or unsuccessful pages receive a targeted full rerender.
    recovery_calls = 0
    patch_calls = 0
    patch_successes = 0
    full_rerenders = 0
    unresolved_pages = sorted({int(item["page_no"]) for item in findings})
    recovery_results: list[dict] = []
    if repair and unresolved_pages:
        page_lookup = {int(page["no"]): page for page in selected}
        open_by_page: dict[int, list[dict]] = {}
        for defect in load_open_defects(project, run_id):
            open_by_page.setdefault(int(defect.get("page_no") or 0), []).append(defect)
        def recover_one(page_no: int) -> dict:
            recovery_scope = validation_scope(project, state_by_page[page_no]['prompt_hash'], 'render_repair', 'page')
            recovery_model = ValidationBudgetModel(project, recovery_scope, model_fn)
            if page_no in grants:
                recovery_model.approval_id = approval_id + ':render:' + str(page_no)
                recovery_model.budget.grant(['page'], grants[page_no], recovery_model.approval_id)
            page_defects = open_by_page.get(page_no, [])
            if any(d.get('code') in LOCAL_FAILURE_CODES for d in page_defects):
                return {'page_no': page_no, 'patch_calls': 0, 'patch_success': False,
                        'full_rerender': False, 'strict_calls': 0, 'error': 'local_dependency_failure'}
            if any(d.get('code') == 'execution_budget_exhausted' for d in page_defects):
                return {'page_no': page_no, 'patch_calls': 0, 'patch_success': False,
                        'full_rerender': False, 'strict_calls': 0, 'error': 'execution_budget_exhausted'}
            draft_path = draft_dir / f"slide-{page_no:02d}.xml"
            patchable = draft_path.is_file() and page_defects and all(
                item.get("suggested_action") == "patch" for item in page_defects
            )
            page_patch_calls = 0
            if patchable:
                patched, calls, _reason = repair_page_with_model_patch(
                    project, blueprint, page_lookup[page_no], draft_path, page_defects,
                    run_id=run_id, model_fn=recovery_model, max_rounds=min(2, max_retries + 1),
                    resolve_on_success=False,
                    render_state=state_by_page[page_no],
                )
                page_patch_calls += calls
                if _reason and ('budget_exhausted' in _reason or _reason.startswith(('transport_retry_exhausted:', 'model_transport_error:', 'local_dependency_failure:', 'scoped_approval_exhausted:', 'no_progress:', 'page_repair_limit:', 'project_resource_limit:', 'work_already_complete:'))):
                    return {'page_no': page_no, 'patch_calls': page_patch_calls, 'patch_success': False,
                            'full_rerender': False, 'strict_calls': 0, 'error': _reason}
                if patched:
                    return {
                        "page_no": page_no, "patch_calls": page_patch_calls,
                        "patch_success": True, "full_rerender": False,
                        "strict_calls": 0, "error": None,
                    }
            output, calls, strict_error = render_page_strict(
                project, blueprint, page_lookup[page_no], style_text,
                max_retries=max_retries, model_fn=recovery_model, use_cache=False,
                initial_xml=load_draft(state_by_page[page_no]) or (draft_path.read_text(encoding="utf-8") if draft_path.is_file() else None),
                initial_errors=page_defects,
            )
            return {
                "page_no": page_no, "patch_calls": page_patch_calls,
                "patch_success": False, "full_rerender": True,
                "strict_calls": calls,
                "error": None if output is not None else (strict_error or "strict rerender failed"),
            }

        with ThreadPoolExecutor(max_workers=min(workers, len(unresolved_pages))) as executor:
            futures = {executor.submit(recover_one, page_no): page_no for page_no in unresolved_pages}
            for future in as_completed(futures):
                recovery_results.append(future.result())

        recovery_failures = []
        for result in recovery_results:
            page_no = int(result["page_no"])
            patch_calls += int(result["patch_calls"])
            patch_successes += int(bool(result["patch_success"]))
            full_rerenders += int(result["strict_calls"])
            recovery_calls += int(result["patch_calls"]) + int(result["strict_calls"])
            if result["error"] is None:
                page_defects = open_by_page.get(page_no, [])
                defect_ids = [
                    item.get("defect_id") for item in page_defects if item.get("defect_id")
                ]
                if defect_ids:
                    resolve_defects(project, run_id, defect_ids)
            else:
                # Replace historical first-pass findings with the final candidate's
                # actual errors. Only this coordinator writes the shared map.
                ids = [d['defect_id'] for d in open_by_page.get(page_no, []) if d.get('defect_id')]
                attempts = sorted((project / 'reports/runs' / run_id / 'render_attempts').glob(
                    f'slide-{page_no:02d}-strict-*.json'))
                if 'budget_exhausted' in result['error'] or result['error'].startswith('model_transport_error:'):
                    merge_defects(project, run_id, [{'page_no': page_no, 'stage': 'render_final',
                        'code': 'execution_budget_exhausted' if 'budget_exhausted' in result['error'] else 'model_transport_error',
                        'message': result['error'], 'severity': 'blocking', 'suggested_action': 'block'}])
                elif attempts:
                    if ids:
                        resolve_defects(project, run_id, ids)
                    latest = json.loads(attempts[-1].read_text(encoding='utf-8'))
                    merge_defects(project, run_id, [dict(e, page_no=page_no, stage='render_final')
                                                   for e in latest.get('errors', [])])
                recovery_failures.append((page_no, str(result["error"])))
        unresolved_pages = [page_no for page_no, _error in recovery_failures]

    if excluded:
        unresolved_pages = sorted(set(unresolved_pages) | excluded)
        merge_defects(project, run_id, [{'page_no': n, 'stage': 'render_not_selected',
            'code': 'unresolved_page_not_selected', 'severity': 'blocking',
            'message': 'Not selected for scoped recovery; no model calls spent.',
            'suggested_action': 'block'} for n in sorted(excluded)])
    submitted_pages = {n for e in executions.values() if e['submitted'] for n in e['pages']}
    responded_pages = {n for e in executions.values() if e['responded'] for n in e['pages']}
    submitted_validated = sorted(submitted_pages.intersection(first_pass_validated))
    write_stage_metric(
        project, stage_name, started,
        status="failed" if unresolved_pages else "success",
        pages=len(states), cache_hits=len(states) - len(pending_states),
        batch_count=len(batches), model_calls=model_calls + recovery_calls,
        first_pass_model_calls=model_calls, recovery_model_calls=recovery_calls,
        first_pass_pages=len(first_pass_states), first_pass_validated_pages=sorted(first_pass_validated),
        first_pass_queued_pages=len(first_pass_states),
        first_pass_submitted_pages=len(submitted_pages), first_pass_submitted_page_numbers=sorted(submitted_pages),
        first_pass_responded_pages=len(responded_pages),
        first_pass_submitted_validated_pages=submitted_validated,
        first_pass_replayed_pages=sum(len(e['pages']) for e in executions.values() if e['response_cache_hit']),
        first_pass_dependency_blocked_pages=sorted(
            {n for e in executions.values() if e['execution_state']=='dependency_blocked' for n in e['pages']} |
            {f['page_no'] for f in findings if f.get('stage') == 'asset_preflight'}),
        first_pass_page_pass_rate=(len(submitted_validated)/len(submitted_pages) if submitted_pages else None),
        first_pass_batch_latency_s=first_pass_latencies,
        first_pass_defects_by_code=dict(Counter(e['code'] for e in findings if e.get('stage')=='render_first_pass')),
        recovery_pages_considered=len(recovery_results),
        recovery_pages_attempted=sum(r['patch_calls']+r['strict_calls']>0 for r in recovery_results),
        recovery_pages_succeeded=sum(not r.get('error') for r in recovery_results),
        salvaged_pages=salvaged_pages, first_pass_defects=len(findings),
        patch_calls=patch_calls, patch_successes=patch_successes,
        patch_rejected_calls=max(0, patch_calls - patch_successes),
        full_rerenders=full_rerenders,
        full_rerender_pages=sum(r['strict_calls']>0 for r in recovery_results),
        full_rerender_routes=sum(bool(r['full_rerender']) for r in recovery_results),
        metric_revision='submission-aware-v2',
        unresolved_pages=unresolved_pages,
        final_open_defects=len(load_open_defects(project, run_id)),
        workers=workers, mode="adaptive_batch_v1",
    )
    stop_reasons = {str(r['page_no']): r['error'] for r in recovery_results if r.get('error')}
    for n in excluded:
        stop_reasons[str(n)] = 'unresolved_page_not_selected'
    stopped_local = any('local_dependency_failure' in reason for reason in stop_reasons.values())
    stalled = any(any(code in reason for code in ('no_progress:', 'work_already_complete:', 'project_resource_limit:', 'scoped_approval_exhausted:'))
                  for reason in stop_reasons.values())
    atomic_write_json(project / 'reports/render_recovery.json', {
        'run_id': run_id, 'unresolved_pages': unresolved_pages,
        'stop_reasons': stop_reasons,
        **recovery_advice(stop_reasons),
        'repair_pages': ','.join(map(str, unresolved_pages)),
        'budget_policy': 'resume preserves history; explicit extra-calls is total across selected pages',
    })
    return 1 if unresolved_pages else 0


def render_legacy_script(project: Path, blueprint: dict, style_text: str) -> int:
    raise RuntimeError(
        "legacy script mode is disabled because generated build_sml.py can bypass "
        "the per-page strict SML pre-write validator; use --mode direct"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="render blueprint to SML")
    parser.add_argument("--project", default=".")
    parser.add_argument(
        "--mode", choices=("adaptive-batch", "direct", "script"), default="adaptive-batch",
    )
    parser.add_argument("--start", type=int)
    parser.add_argument("--end", type=int)
    parser.add_argument(
        "--max-retries", type=int, default=2,
        help="targeted strict full-page retries after batch validation; patch rounds stay capped at 2",
    )
    parser.add_argument("--workers", type=int, default=4, help="concurrent page renders (default: 4)")
    parser.add_argument("--pages", default="", help="comma-separated page numbers for a pilot/selective render")
    parser.add_argument("--stage-name", default="render", help="performance stage label")
    parser.add_argument("--force", action="store_true", help="ignore matching validated page caches")
    parser.add_argument('--repair-pages', default='')
    parser.add_argument('--extra-calls', type=int, default=0)
    parser.add_argument('--approval-id')
    parser.add_argument('--first-pass-only', action='store_true', help='calibrate pilot; defer page repairs to full pass')
    args = parser.parse_args()
    if args.first_pass_only and (args.mode != 'adaptive-batch' or args.stage_name != 'pilot_render' or args.repair_pages or args.extra_calls):
        parser.error('first-pass-only requires pilot_render and no scoped repair grant')
    project = Path(args.project).resolve()
    blueprint = json.loads((project / "reports/blueprint.json").read_text(encoding="utf-8"))
    brief_path = project / "reports/brief.json"
    brief = json.loads(brief_path.read_text(encoding="utf-8")) if brief_path.exists() else {}
    skill_root = Path(__file__).resolve().parents[1]
    style_text = select_style_reference(brief, skill_root).read_text(encoding="utf-8")
    if args.mode == "script":
        return render_legacy_script(project, blueprint, style_text)
    page_numbers = {
        int(item.strip()) for item in args.pages.split(",") if item.strip()
    } or None
    if args.mode == "adaptive-batch":
        return render_adaptive_batches(
            project, blueprint, style_text, args.start, args.end,
            workers=args.workers, force=args.force, page_numbers=page_numbers,
            stage_name=args.stage_name, max_retries=args.max_retries,
            repair_pages={int(n) for n in args.repair_pages.split(',') if n} or None,
            extra_calls=args.extra_calls, approval_id=args.approval_id,
            repair=not args.first_pass_only,
        )
    return render_direct(
        project, blueprint, style_text, args.start, args.end,
        args.max_retries, args.workers, args.force,
        page_numbers=page_numbers, stage_name=args.stage_name,
    )


if __name__ == "__main__":
    raise SystemExit(main())
