#!/usr/bin/env python3
"""Canonical cross-stage contracts for planning, rendering, and QA.

Keep values here deliberately small and deterministic: prompts may describe
the contract, but executable validation must import the same definitions.
"""
from __future__ import annotations

import copy
import math
import re
from pathlib import Path


COMPACT_ROLES = frozenset({"cover", "chapter", "hook", "closing"})
ARGUMENT_ROLES = frozenset({"evidence", "data", "insight", "proposal", "plan", "decision"})
# Legacy density estimates retained for callers, never a validation/repair limit.
ROLE_TEXT_BUDGETS = {"compact": 40, "visual": 120, "argument": 180}
TEXT_LENGTH_POLICY = '''以语句通顺、语义准确、信息完整和页面可读为准，不按页面角色设置固定字数上限或下限。
字符数仅能作为内部信息密度估算，不能单独触发压缩、扩写、重试、解锁主张、拆页或占位。
保留关键事实、数字、条件和限定语；实际排版拥挤时优先调整文本区、换行和版式，不机械删字或缩成不可读小字。
用户明确提出的字数要求仍须按其指定范围遵守，通过 current_request/已接受决策传递给 SOL；不得从设计参考或历史技能阈值推导用户限制。
用户没有规定字数时，不为凑字符数改写已经通顺准确的文案。'''
GHOST_NUMBER_MAX_AREA_RATIO = 0.18
VALID_DENSITIES = frozenset({"low", "medium", "high"})
VALID_IMAGE_ROLES = frozenset({"hero", "evidence", "detail", "background", "decorative"})
VALID_IMAGE_CROPS = frozenset({"cover", "contain"})
GENERATED_RASTER_EXTENSIONS = frozenset({".jpg", ".jpeg"})
PLANNING_BREAKPOINTS = ((18, 1), (36, 2), (60, 3))
RENDER_BATCH_SIZES = {"simple": 9, "normal": 5, "complex": 3}
VALID_COMPLEXITIES = frozenset(RENDER_BATCH_SIZES)
PAGE_REPAIR_LIMIT = 3  # Initial generation is separate; patches and redesign share this cap.
MIN_BODY_FONT = 15
MIN_CAPTION_FONT = 11
WRAP_CONTRACT = '''Text hierarchy is not a line-count constraint. Explicit wrap="true"
allows multiline text, including title/headline, when its measured height fits.
Use wrap="false" only for intentionally single-line text with enough width.
Keep actual height/nowrap overflow blocking; do not widen a valid multiline box
merely because the unwrapped sentence is wider than its container.'''

DECORATION_CONTRACT = '''Decorative display lettering is not effective body copy.
Keep faint large decoration behind opaque readable text; never encode a required claim
only in faint decoration. Prefer a full-height text frame even for ghost letters;
do not alternate shrinking its frame and moving the title to suppress a finding.
Plan giant letters (>=96px), rotations and layered panels as geometry-risk pages,
not simple pages merely because their word count is small. Reserve disjoint glyph
regions for effective titles. Display-frame area is advisory; KPI numerals are not
automatically decoration, and size alone never justifies a failed page.
A decorative background wash is not automatically a clipping container. Real cards
must contain their text. Do not use CSS clip/overflow properties absent from the XSD.
Lint/QA share alpha, paint order and estimated glyph geometry. Faint background
lettering's estimated self-clipping is advisory, not proof of visual safety; actual
canvas overflow, opaque text collision and content-preservation failures still block.'''


def render_scheduling_complexity(page: dict) -> str:
    """Conservative scheduling only; never mutate the model's design or metadata."""
    declared = str(page.get('complexity') or 'normal')
    layout = page.get('layout') or {}
    for block in layout.get('blocks', []):
        props = block.get('props') or {}
        try:
            size = float(props.get('font_size') or props.get('fontSize') or 0)
            rotation = float(props.get('rotation') or 0)
        except (TypeError, ValueError):
            return 'complex'
        if size >= 96 or rotation or props.get('clip') is True:
            return 'complex'
    return declared if declared in VALID_COMPLEXITIES else 'normal'


def explicit_multiline(element: dict) -> bool:
    return str(element.get('wrap', '')).lower() in {'true', '1'}


PATCH_LIMITS = {
    "max_rounds": 2,
    "max_objects": 5,
    "max_operations": 8,
    "max_move_px": 32.0,
    "max_resize_ratio": 0.20,
}
PATCH_PROTOCOL_MAX_OPERATIONS = 128  # Resource guard, not a layout preference.
STYLE_POLICY = '''设计目标是准确、精美且符合用户品牌要求；提速依靠批量、并发和复用正确工作，不靠省略信息设计。
按阅读任务设计：对照/矩阵、流程图、准确图表、适配情境图或有意的文字构图；无图不等于套文字卡片。
统一视觉母题并安排全稿节奏；合理系列页可同构。已有资产按用途与适配度选择，缺少必要情境图可生成；不把KV/近似帧数量当视觉覆盖度，不用生成图冒充事实证据。
不设图片/版式配额。风格警告不阻断交付；成段同构/主视觉复用在规划后由SOL有界判断，可保留或定向改善，不循环返工。不设截图验收。

正文页：小章节＋主标题→证据→来源/页码。用户模板/封面/章节页除外；章节只出现一次。
全稿统一标题锚点、主辅字级及正文间距。按语义换行避免孤字，按实际行高留足盒高与间距再放正文；长标题先重组空间，不缩小硬塞。
title/takeaway/content 不是三个必填文本框。标题讲结论，正文补证据/条件/动作；底部无新信息就不设总结条。例：“渠道决定增长”与“增长取决于渠道，先试点”→标题保留，正文仅补“先试点”。图表/表格同理。
保留事实、数字、限定、必要标签和逐字要求；释放空间留白。只用已有 SOL 调用，不加字数门禁/审查；本地及保真补丁不改文案。
图文卡片明确选留白内嵌、贴边拼接或整图背景：内嵌图与正文各留空间；贴边图仅外缘两角圆、图文接缝直角，图片区域与外卡片相接的圆角半径一致；整图背景沿完整轮廓填充，文字避主体。图片用原生裁切形状及自身边框，不用直角照片覆盖圆角底板冒充裁切；组合不产生裁切。支持的形状是 rect/round-rect/ellipse；全圆角或仅 top/bottom/left/right 两角。裁切保主体和必要文字，装饰轮廓不穿过有效文字。'''
PATCH_OPERATION_FIELDS = {
    "set_geometry": frozenset({"topLeftX", "topLeftY", "width", "height"}),
    "set_text_layout": frozenset({
        "fontFamily", "fontSize", "lineSpacing", "textAlign", "verticalAlign",
        "wrap", "autoFit", "marginLeft", "marginRight", "marginTop", "marginBottom",
    }),
    "set_style": frozenset({"color", "alpha", "width", "dash"}),
    "set_crop": frozenset({"type", "anchor", "presetHandlers", "roundedCorners"}),
    "set_z_order": frozenset({"index"}),
}


DENSITY_ALIASES = {
    "极低": "low", "低": "low", "中低": "low", "very-low": "low", "medium-low": "low",
    "中": "medium", "适中": "medium", "normal": "medium",
    "中高": "high", "高": "high", "medium-high": "high", "very-high": "high",
}
IMAGE_ROLE_ALIASES = {
    "主图": "hero", "hero-image": "hero", "proof": "evidence", "证据": "evidence",
    "细节": "detail", "背景": "background", "装饰": "decorative",
}


ASSET_REUSE_LIMIT = 3


def asset_reuse_findings(uses, hashes):
    """One identity policy, shared by plan and QA. Background/decorative
    exemption is checked separately against actual rendered area by QA.
    Byte hashes merge aliases; absence of bytes falls back to asset_id/src.
    Count distinct pages, not multiple crops within one page.
    """
    groups, parents = {}, {}
    def find(key):
        parents.setdefault(key, key)
        if parents[key] != key:
            parents[key] = find(parents[key])
        return parents[key]
    indexed = []
    for use in uses:
        if use.get('role') in {'background', 'decorative'}:
            continue
        keys = ['src:' + str(use.get('src'))]
        if use.get('asset_id'):
            keys.append('asset:' + use['asset_id'])
        if hashes.get(use.get('src')):
            keys.append('hash:' + hashes[use['src']])
        for key in keys[1:]:
            parents[find(key)] = find(keys[0])
        indexed.append((keys[0], use['page']))
    for key, page in indexed:
        groups.setdefault(find(key), set()).add(page)
    return [{'identity': key, 'pages': sorted(pages), 'limit': ASSET_REUSE_LIMIT}
            for key, pages in groups.items() if len(pages) > ASSET_REUSE_LIMIT]


def planning_call_budget(page_count: int) -> int:
    """Return the normal planning-call budget for a deck.

    Small decks retain their batching targets. Larger decks scale with work;
    this estimate is not an execution or repair ceiling.
    """
    if page_count < 1:
        raise ValueError("page_count must be positive")
    for maximum, calls in PLANNING_BREAKPOINTS:
        if page_count <= maximum:
            return calls
    return math.ceil(page_count / 20)


def planning_ranges(page_count: int, max_tokens: int = 32000, tokens_per_page: int = 1100) -> list[tuple[int, int]]:
    """Split pages evenly across the normal planner calls."""
    if max_tokens < 1000 or tokens_per_page < 1:
        raise ValueError('invalid output capacity')
    capacity = max(1, int((max_tokens * .75 - 1600) / tokens_per_page))
    calls = max(planning_call_budget(page_count), math.ceil(page_count / capacity))
    base, remainder = divmod(page_count, calls)
    ranges: list[tuple[int, int]] = []
    start = 1
    for index in range(calls):
        size = base + (1 if index < remainder else 0)
        end = start + size - 1
        ranges.append((start, end))
        start = end + 1
    return ranges


def render_batch_size(complexity: str) -> int:
    """Map a model-authored complexity label to a scheduling-only batch size."""
    normalized = str(complexity or "").strip().lower()
    if normalized not in VALID_COMPLEXITIES:
        raise ValueError(f"invalid render complexity {complexity!r}")
    return RENDER_BATCH_SIZES[normalized]


def text_budget(role: str) -> int:
    """Legacy density estimate only; not a hard or soft gate."""
    normalized = str(role or "").strip().lower()
    if normalized in COMPACT_ROLES:
        return ROLE_TEXT_BUDGETS["compact"]
    if normalized in ARGUMENT_ROLES:
        return ROLE_TEXT_BUDGETS["argument"]
    return ROLE_TEXT_BUDGETS["visual"]


def budget_prompt_text() -> str:
    """Compatibility name for the natural-copy policy (no numeric targets)."""
    return TEXT_LENGTH_POLICY + '\n' + STYLE_POLICY


def _content_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.splitlines() if item.strip()]
    if not isinstance(value, list):
        raise ValueError("content must be a string or an array of strings")
    return [str(item).strip() for item in value if str(item).strip()]


def normalize_page_contract(page: dict, number: int) -> dict:
    """Normalize harmless planner drift and reject missing semantic inputs."""
    if not isinstance(page, dict):
        raise ValueError(f"page {number} must be an object")
    normalized = copy.deepcopy(page)
    normalized["no"] = number
    normalized["content"] = _content_list(normalized.get("content"))
    for key in ("source_ids", "must_keep_ids", "decision_ids", "artifact_ids"):
        value = normalized.get(key, [])
        if value is None:
            value = []
        if not isinstance(value, list):
            raise ValueError(f"page {number} {key} must be an array")
        normalized[key] = [str(item) for item in value]

    layout = normalized.get("layout")
    if not isinstance(layout, dict):
        raise ValueError(f"page {number} is missing layout")
    # Density is optional design metadata, not a condition for usable output.
    blocks = layout.get("blocks", [])
    if blocks is None:
        blocks = []
    if not isinstance(blocks, list):
        raise ValueError(f"page {number} layout.blocks must be an array")
    layout["blocks"] = blocks

    images = normalized.get("images", [])
    if images is None:
        images = []
    if not isinstance(images, list):
        raise ValueError(f"page {number} images must be an array")
    normalized_images: list[dict] = []
    for index, raw_image in enumerate(images, 1):
        if not isinstance(raw_image, dict):
            raise ValueError(f"page {number} image {index} must be an object")
        image = copy.deepcopy(raw_image)
        src = str(image.get("src") or "").strip()
        image["src"] = src
        image["id"] = str(image.get("id") or f"image-{number:02d}-{index:02d}")
        if not str(image.get("role") or "").strip():
            raise ValueError(f"page {number} image {index} is missing role")
        role = str(image.get("role")).strip().lower()
        role = IMAGE_ROLE_ALIASES.get(role, role)
        if role not in VALID_IMAGE_ROLES:
            raise ValueError(f"page {number} image {index} has invalid role {role!r}")
        image["role"] = role
        if not str(image.get("crop") or "").strip():
            raise ValueError(f"page {number} image {index} is missing crop")
        crop = str(image.get("crop")).strip().lower()
        if crop not in VALID_IMAGE_CROPS:
            raise ValueError(f"page {number} image {index} has invalid crop {crop!r}")
        image["crop"] = crop
        if not image.get("desc"):
            for alias in ("usage", "purpose", "alt", "description"):
                if image.get(alias):
                    image["desc"] = str(image[alias]).strip()
                    break
        if not image.get("asset_id") and not str(image.get("desc") or "").strip():
            raise ValueError(f"page {number} generated image {src!r} is missing description")
        normalized_images.append(image)
    normalized["images"] = normalized_images
    return normalized


def visible_page_character_count(page: dict) -> int:
    values = [page.get("title", ""), page.get("takeaway", ""), *_content_list(page.get("content"))]
    return sum(len(re.sub(r"\s+", "", str(item))) for item in values)


def validate_generated_extension(image: dict, number: int) -> None:
    src = str(image.get("src") or "")
    if not image.get("asset_id") and Path(src).suffix.lower() not in GENERATED_RASTER_EXTENSIONS:
        allowed = ", ".join(sorted(GENERATED_RASTER_EXTENSIONS))
        raise ValueError(f"page {number} generated image {src!r} must use a raster output extension ({allowed})")
