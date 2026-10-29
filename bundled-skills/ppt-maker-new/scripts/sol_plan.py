#!/usr/bin/env python3
"""Plan a PPT from a decision-oriented brief and one routed style reference."""
from __future__ import annotations

import argparse
import json
import os
import re
import time
import hashlib
import threading
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable

from ingest_materials import ingest_context
from font_policy import resolve_font_contract
from ppt_contract import (
    STYLE_POLICY, budget_prompt_text, normalize_page_contract, planning_call_budget, planning_ranges,
    validate_generated_extension,
)
from sol_brief import generate_brief
from blueprint_validation import static_findings, require_static_blueprint, reference_contract
from audience_copy import COPY_CONTRACT
from plan_repair import (page_contract_prompt, infeasible_lock, editable_claim_fields, page_hash,
                         apply_page_patch, claim_equivalent, PLANNING_PROTOCOL)
from sol_common import extract_json, is_safe_asset_src, planning_response as sol_response
from stage_runtime import (
    atomic_write_json, atomic_write_text, load_validated_json_cache, prompt_fingerprint,
    write_json_cache, write_stage_metric,
)


STYLE_ROUTES = {
    "strategy-and-analysis": "strategy-and-analysis.md",
    "business-pitch": "business-pitch.md",
    "business-review": "business-review.md",
    "academic-research": "academic-research.md",
    "learning-and-training": "learning-and-training.md",
    "technical-presentation": "technical-presentation.md",
    "brand-storytelling": "brand-storytelling.md",
}

DEFAULT_FONTS = {
    "zh_display": "Microsoft YaHei",
    "zh_body": "Microsoft YaHei",
    "latin_display": "Arial",
    "latin_body": "Arial",
}


class PlanOutputError(RuntimeError):
    """A planner response failed before it could satisfy the blueprint contract."""


def attach_available_assets(brief: dict, project: Path) -> dict:
    """Attach the exact deterministic asset records used by downstream mapping."""
    enriched = dict(brief)
    manifest_path = project / "reports" / "assets_manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        enriched["available_assets"] = manifest.get("assets", [])
    else:
        enriched.setdefault("available_assets", [])
    return enriched


def select_style_reference(brief: dict, skill_root: Path) -> Path:
    visual = brief.get("visual_dna") or {}
    scene = str(visual.get("scene") or "").strip().lower().replace("_", "-")
    aliases = {
        "brand": "brand-storytelling", "branding": "brand-storytelling",
        "marketing": "business-pitch", "strategy": "strategy-and-analysis",
        "analysis": "strategy-and-analysis", "pitch": "business-pitch",
    }
    filename = STYLE_ROUTES.get(aliases.get(scene, scene), "fallback.md")
    return skill_root / "lark" / "references" / "style" / filename


def build_prompt(topic: str, pages: int, extra: str, brief: dict, style_reference: str) -> str:
    return f"""你是世界级演示策划与版式设计师。基于已经提炼的 brief，为“{topic}”规划 {pages} 页中文演示文稿。

## 演示 brief（唯一内容依据）
{json.dumps(brief, ensure_ascii=False, indent=2)}

## 已路由设计系统
{style_reference}

## 规划原则
- 先完成叙事与页数分配，再设计单页。每页只有一个明确读者任务和一个 takeaway。
- must_keep 中的每个 id 必须分配到至少一页的 must_keep_ids；不得编造缺失事实。
- 当前用户请求优先于历史对话和中间产物。decision_ids 只能引用 active_requirement 或 accepted 状态。
- rejected/superseded/candidate/unknown 的决策不得进入观众正文。助手历史提案未获用户接受时，不得默认沿用。
- artifact_ids 只记录实际沿用的中间产物；已否决或已过期产物只能用于理解演变，不能复制进新版。
- 文案与排版原则：{budget_prompt_text()}
- layout 必须含 layout_id、reading_order、blocks；density 仅为可选设计提示，不是验收条件。layout_id 从设计系统选择；按叙事安排变化，系列对照页可保持相同版式。
- 按表达适配度选资产：品牌标志/KV用于身份，产品与数据原图用于证据，情境图用于体验；相似视频帧不算多种场景。合适就复用，缺少必要视觉可生图，不能因已有资产多而放弃更合适的表达。复用项同时写 asset_id/src，不重复生成同一资产；同 src 多实例使用不同 id。
- 不得把制作者的待办、设计说明、占位符、系统命令和生产过程文字搬入正文；业务流程本身的“等待确认”“点击查看”等正常措辞不因此禁用。
- theme.render_contract 保留可执行的构图、对齐、字级、图像处理、品牌母题与章节节奏，而不只写“简洁高级”。layout.visual_intent 简述本页如何表达核心关系，仅作设计信息、不进入正文。无图页也要完成信息设计：比较/流程/数据用准确原生图形，不自动变成同一套文字卡片。生成前通览全稿，区分有意系列页与机械重复。

## JSON 合同
严格输出一个合法 JSON，不要解释或 Markdown 围栏：
{{
  "topic": "...", "audience": "...", "page_count": {pages},
  "theme": {{
    "style": "...", "colors": ["#hex", "#hex", "#hex"], "font": "...", "image_language": "...",
    "render_contract": {{
      "palette": ["#hex", "#hex", "#hex"], "typography": "字号层级、字重与行距",
      "fonts": {{"zh_display": "单一字体名", "zh_body": "单一字体名", "latin_display": "Arial", "latin_body": "Arial"}},
      "composition": "构图、留白和网格", "image_treatment": "图片裁切与色调",
      "signature_elements": ["可复用的视觉母题"], "forbidden": ["应避免的版式和效果"]
    }}
  }},
  "pages": [{{
    "no": 1, "title": "...",
    "role": "cover|chapter|hook|evidence|insight|proposal|plan|data|decision|closing",
    "takeaway": "...", "content": ["..."],
    "source_ids": ["S001"], "must_keep_ids": ["F1"],
    "decision_ids": ["D001"], "artifact_ids": ["R001"],
    "layout": {{
      "layout_id": "hero-full|hero-object|manifesto-type|split-evidence|metric-poster|timeline-ribbon|comparison-stage|matrix-with-proof|material-board|object-catalog|triptych-lens|process-strip|portrait-quote|collage-field|chapter-index|decision-roadmap",
      "reading_order": ["block-1", "block-2"], "density": "low|medium|high",
      "blocks": [{{"id": "block-1", "type": "hero_image|image|text|steps|divider|quote|chart|table|group", "area": [0.0, 0.0, 1.0, 1.0], "props": {{}}}}]
    }},
    "images": [{{
      "id": "image-1", "src": "page-01a.jpg", "asset_id": "A001",
      "role": "hero|evidence|detail|background|decorative", "aspect": "16:9",
      "crop": "cover|contain", "desc": "仅当没有 asset_id 时提供生成描述",
      "requirement": "主体位置、留白方向和镜头要求"
    }}]
  }}]
}}

{page_contract_prompt(brief)}
额外要求：{extra or '无'}
"""


def build_outline_prompt(topic: str, pages: int, extra: str, brief: dict, style_reference: str) -> str:
    """Build a compact whole-deck contract whose output remains bounded for long decks."""
    return f"""GLOBAL_OUTLINE_ONLY
你是演示总策划。为“{topic}”先输出 {pages} 页全局骨架；此调用不写单页详细 content、blocks 或 images。

{COPY_CONTRACT}
{STYLE_POLICY}

## brief（唯一内容依据）
{json.dumps(brief, ensure_ascii=False, indent=2)}

## 设计系统
{style_reference}

## 输出合同
严格输出一个 JSON 对象，不要解释或 Markdown：
{{
  "topic": "...", "audience": "...", "page_count": {pages},
  "theme": {{
    "style": "...", "colors": ["#hex", "#hex", "#hex"], "font": "...", "image_language": "...",
    "render_contract": {{
      "palette": ["#hex", "#hex", "#hex"], "typography": "...",
      "fonts": {{"zh_display": "单一字体名", "zh_body": "单一字体名", "latin_display": "Arial", "latin_body": "Arial"}},
      "composition": "...", "image_treatment": "...",
      "signature_elements": ["..."], "forbidden": ["..."]
    }}
  }},
  "pages": [{{
    "no": 1, "title": "...", "role": "cover|chapter|hook|evidence|insight|proposal|plan|data|decision|closing",
    "takeaway": "...", "must_keep_ids": ["F1"],
    "layout_id": "hero-full|hero-object|manifesto-type|split-evidence|metric-poster|timeline-ribbon|comparison-stage|matrix-with-proof|material-board|object-catalog|triptych-lens|process-strip|portrait-quote|collage-field|chapter-index|decision-roadmap"
  }}]
}}

要求：
- pages 必须恰好 {pages} 项且 no 连续；must_keep 在骨架阶段完整分配。
- 按内容决定跨页变化，不设相邻页差异配额。
- fonts 的每个值只能是一个字体家族名，禁止逗号分隔的伪字体栈。
- 默认只选常见系统字体：中文微软雅黑/苹方/等线/黑体/宋体，英文 Arial/Calibri。Linux 可用已安装 Noto Sans CJK SC。不要主动使用思源宋体、Playfair Display、Inter 等额外设计字体；本地预检会选择实际可用的常见字体，不下载字体。标题和正文可用同一字体，以字号和粗细区分。
- 输出保持精简；不得展开详细正文、图片描述或 blocks。
额外要求：{extra or '无'}
"""


def build_segment_prompt(
    topic: str, start: int, end: int, brief: dict, outline: dict, style_reference: str,
    extra: str = "",
) -> str:
    """Build one independently executable detail segment tied to the global outline."""
    from brief_capacity import planning_brief
    brief = planning_brief(brief, start, end)
    skeleton = outline.get("pages", [])
    assigned = [page for page in skeleton if start <= int(page.get("no", 0)) <= end]
    compact_outline = {
        "topic": outline.get("topic"), "audience": outline.get("audience"),
        "page_count": outline.get("page_count"), "theme": outline.get("theme"),
        "pages": skeleton,
    }
    return f"""DETAIL_SEGMENT
SEGMENT_RANGE: {start}-{end}
当前额外要求（不得从历史助手建议自行增补）：{extra or '无'}
你是演示策划与版式设计师。根据已锁定的全局骨架，只展开“{topic}”第 {start}–{end} 页。

## brief（唯一内容依据）
{json.dumps(brief, ensure_ascii=False, indent=2)}

## 全局骨架（用于跨段一致性；业务主张锁定，设计字段可由 SOL 调整）
{json.dumps(compact_outline, ensure_ascii=False, separators=(',', ':'))}

## 本段待展开页面
{json.dumps(assigned, ensure_ascii=False, indent=2)}

字符数不构成骨架不可行的证据；保持已锁定的标题与结论，不为凑字数缩写。
允许修改的主张字段：{json.dumps([{'no': p['no'], 'editable_claim_fields': sorted(editable_claim_fields(p))} for p in assigned if editable_claim_fields(p)], ensure_ascii=False)}
只有 editable_claim_fields 列出的字段允许 SOL 修复生产注记问题；layout 与 complexity 可调整，其余业务字段继续锁定。不得只删标签后伪装成事实。

按本页表达需要选择原生图表/关系图、合适已有图或必要的新图。无图不等于无视觉，策略/数据/流程不能默认排成文字卡片。
KV和近似视频帧不能仅凭文件数覆盖全部情境；素材适配才复用，缺少有效情境表达时可生图。图片数量不按页数换算，不设最低配额；当前用户明确禁生图时尊重其要求。历史助手建议不等于用户要求。

## 设计系统
{style_reference}

严格输出 NDJSON；每一行必须是一个独立、完整的
{page_contract_prompt(brief)}
{{"type":"page_blueprint","page":{{...完整页面...}}}} JSON 对象，不要 Markdown 围栏。
记录必须恰好覆盖第 {start}–{end} 页，每页补齐：
- content、source_ids、must_keep_ids、decision_ids、artifact_ids；
- layout={{layout_id, reading_order, blocks}}，density 可选；初始参考骨架，不可行时由 SOL 定向换版式；
- images；生成图必须使用唯一的 page-NN[a-z].jpg；复用已有资产时填写 asset_id，并可沿用其受支持格式；
- 文案与排版原则：{budget_prompt_text()}
不得输出 theme、解释或本段之外页面。必须先闭合当前 JSON 行再开始下一页，便于截断后保留完整记录。
"""


def build_adaptive_initial_prompt(
    topic: str, pages: int, start: int, end: int, extra: str,
    brief: dict, style_reference: str,
) -> str:
    """Ask for the global lock plus the first detailed range in one call."""
    return f"""ADAPTIVE_PLAN_INITIAL
你是演示总策划与版式设计师。为“{topic}”一次完成全稿骨架，并详细展开第 {start}–{end} 页。

## brief（唯一内容依据）
{json.dumps(brief, ensure_ascii=False, indent=2)}

## 设计系统
{style_reference}

严格输出 NDJSON，不要解释或 Markdown 围栏。每行是一个独立 JSON 对象，依次输出：
1. 一条 deck 记录：
{{"type":"deck","topic": "...", "audience": "...", "page_count": {pages},
  "theme": {{"style": "...", "colors": ["#hex"], "font": "...", "image_language": "...",
    "render_contract": {{"palette": ["#hex"], "typography": "...",
      "fonts": {{"zh_display": "单一字体名", "zh_body": "单一字体名", "latin_display": "Arial", "latin_body": "Arial"}},
      "composition": "...", "image_treatment": "...", "signature_elements": [], "forbidden": []}}}}}}
2. 一条全稿骨架记录：
{{"type":"outline","pages":[{{"no": 1, "title": "...", "role": "evidence", "takeaway": "...",
    "must_keep_ids": [], "layout_id": "split-evidence", "complexity": "simple|normal|complex"}}]}}
3. 第 {start}–{end} 页各一条详细记录：
{{"type":"page_blueprint","page":{{"no": {start}, "title": "...", "role": "evidence", "takeaway": "...",
    "content": [], "source_ids": [], "must_keep_ids": [], "decision_ids": [], "artifact_ids": [],
    "complexity": "simple|normal|complex",
    "layout": {{"layout_id": "...", "reading_order": [], "density": "low|medium|high", "blocks": []}},
    "images": []}}}}

硬性要求：
- outline 必须恰好 {pages} 项，页码连续，完整分配 must_keep；pages 只含第 {start}–{end} 页。
- pages 中每页的 title、role、takeaway、must_keep_ids、业务主张与 outline 一致，layout.layout_id 和 complexity 可由 SOL 调整。
- complexity 衡量几何与排版难度，不是字数：simple 为少量独立元素；normal 为常规多栏/图文；complex 包括≥96px巨字、旋转、层叠面板或复杂表图。巨字分隔页不应标 simple。
- 每页详细字段必须完整；不得依赖本地代码补版式、坐标、文案、素材或图片选择。
- 文案与排版原则：{budget_prompt_text()}
{page_contract_prompt(brief)}
- 按内容决定跨页变化，不设相邻页差异配额。
- 生成图必须使用唯一 page-NN[a-z].jpg；复用素材必须写 asset_id。
- 必须先闭合当前 JSON 行再开始下一行，便于输出截断时保留完整记录。
额外要求：{extra or '无'}
"""


def build_targeted_plan_repair_prompt(
    topic: str, missing_numbers: list[int], brief: dict, outline: dict, style_reference: str,
    *, drafts: dict | None = None, rejected: dict | None = None,
) -> str:
    from brief_capacity import planning_brief
    brief = planning_brief(brief)
    if brief.get('source_page_contract'):
        brief = dict(brief, source_page_contract=dict(brief['source_page_contract'], source_pages=[
            p for p in brief['source_page_contract']['source_pages'] if p['no'] in missing_numbers]))
    assigned = [page for page in outline.get("pages", []) if int(page.get("no", 0)) in missing_numbers]
    drafts, rejected = drafts or {}, rejected or {}
    from plan_repair import restoration_fields
    repairs = [{'no': n, 'error': rejected.get(n, 'missing complete page record'),
                'outline_restorations': restoration_fields(drafts.get(n, {}), next((p for p in assigned if p['no'] == n), {})),
                'allowed_response_modes': ['page_patch', 'page_blueprint'] if n in drafts else ['page_blueprint'],
                'base_sha256': page_hash(drafts[n]) if n in drafts else None,
                'draft': drafts.get(n),
                'unlock_title_takeaway': infeasible_lock(next((p for p in assigned if p['no'] == n), {})),
                'editable_claim_fields': sorted(editable_claim_fields(next((p for p in assigned if p['no'] == n), {})))}
               for n in missing_numbers]
    return f"""ADAPTIVE_PLAN_TARGETED_REPAIR
只补齐“{topic}”中以下缺失或无效页面：{','.join(map(str, missing_numbers))}。
这是按实际剩余工作量调度的定向修复，不得重写成功页面或全局章程。预算由运行器按验证进展判断，不由模型自行申请无限重试。

## brief（唯一内容依据）
{json.dumps(brief, ensure_ascii=False, separators=(',', ':'))}

## 锁定的全局骨架
{json.dumps(outline, ensure_ascii=False, separators=(',', ':'))}

## 本次目标页
{json.dumps(assigned, ensure_ascii=False, separators=(',', ':'))}

## 逐页失败原稿与诊断（保留成功页；不要重新生成整稿）
{json.dumps(repairs, ensure_ascii=False, separators=(',', ':'))}

{page_contract_prompt(brief)}

## 设计系统
{style_reference}

严格输出 NDJSON，每个目标页恰好一行。已有 draft 优先返回最小精确补丁：
{{"type":"page_patch","no":6,"set":{{"content":["保留完整业务含义的表述"],"images":[{{"id":"image-6","src":"page-06.jpg","role":"hero","crop":"cover","desc":"具体画面"}}]}}}}
请求的原稿哈希由运行器绑定，不要在输出中抄写哈希；本地只应用你的精确值并验证、失败不放行。
set 仅包含需变更的顶层字段：content/images/layout/complexity/source_ids/decision_ids/artifact_ids/internal_notes。
逐页优化模式下，缺失或错误的 source_page_ref 也可由 SOL 精确修复为同号原页引用；不能改变页数与顺序。
title/takeaway 仅可修改该页 editable_claim_fields 列出的字段（原字段含生产注记）；其余主张字段锁定。不得只删标签伪装成事实。
锁定的是全局骨架，不是错误草稿：outline_restorations 中列出的字段可用 set 精确恢复为 expected 值，不得另行改写或增删 must_keep 分配。其余 role/no/must_keep_ids 继续锁定；layout（含 layout_id）和 complexity 可由 SOL 定向调整。
每个set值是完整替换值，不是字符串别名映射，不得让本地猜文件名或改文案。
缺失原稿，或已有草稿无法用合法补丁修好时，输出该目标页完整 {{"type":"page_blueprint","page":{{...}}}}；完整替换也须遵守骨架。成功页不变，不重新规划整稿。
不要回显未变字段、原稿和错误，不要重写全部页面。先闭合当前JSON行再开始下一页。
"""


def _topic_brief(topic: str) -> dict:
    return {
        "presentation_goal": f"让目标受众理解并回应“{topic}”",
        "audience": "由主题判断", "decision": "由主题判断", "thesis": topic,
        "narrative": ["建立语境", "展开核心内容", "形成结论"],
        "must_keep": [], "optional": [], "exclude": [], "open_questions": [],
        "decision_ledger": [{
            "id": "D001", "decision": f"围绕“{topic}”制作演示文稿", "status": "active_requirement",
            "turn_ids": [], "source_ids": [], "rationale": "current topic-only request",
        }],
        "artifact_lineage": [], "conflicts": [], "current_request": topic,
        "visual_dna": {"scene": "fallback", "style_family": "由主题判断"},
    }


def _validate_page_output_contract(page: dict, number: int) -> None:
    """Reject page contracts that cannot safely reach the current renderer."""
    for image in page.get("images", []):
        src = str(image.get("src") or "").strip()
        if not src:
            raise ValueError(f"page {number} image is missing src")
        if not is_safe_asset_src(src):
            raise ValueError(f"page {number} has unsafe image src {src!r}")
        validate_generated_extension(image, number)


def _validate_blueprint(blueprint: dict, expected_pages: int, brief: dict | None = None) -> None:
    require_static_blueprint(blueprint, brief or {})
    pages = blueprint.get("pages")
    if not isinstance(pages, list) or len(pages) != expected_pages:
        actual = len(pages) if isinstance(pages, list) else 0
        raise ValueError(f"blueprint page count mismatch: expected {expected_pages}, got {actual}")
    covered: set[str] = set()
    non_background_sources: list[str] = []
    non_background_asset_ids: list[str] = []
    previous_layout_signature: tuple | None = None
    available_assets = {
        str(item.get("asset_id")): item
        for item in (brief or {}).get("available_assets", []) if item.get("asset_id")
    }
    available_asset_ids = set(available_assets)
    artifact_statuses = {
        str(item.get("artifact_id")): str(item.get("status") or "unknown")
        for item in (brief or {}).get("artifact_lineage", []) if item.get("artifact_id")
    }
    decisions = {
        str(item.get("id")): str(item.get("status") or "unknown")
        for item in (brief or {}).get("decision_ledger", [])
        if item.get("id")
    }
    from brief_contract import ELIGIBLE_DECISION_STATUSES,ELIGIBLE_ARTIFACT_STATUSES
    allowed_decision_statuses = ELIGIBLE_DECISION_STATUSES
    for number, page in enumerate(pages, 1):
        normalized = normalize_page_contract(page, number)
        page.clear()
        page.update(normalized)
        if "layout" not in page:
            raise ValueError(f"page {number} is missing layout")
        if not page["layout"].get("layout_id"):
            raise ValueError(f"page {number} layout is missing layout_id")
        _validate_page_output_contract(page, number)
        covered.update(str(item) for item in page["must_keep_ids"])
        for decision_id in (str(item) for item in page["decision_ids"]):
            if decision_id not in decisions:
                raise ValueError(f"page {number} references unknown decision {decision_id}")
            if decisions[decision_id] not in allowed_decision_statuses:
                raise ValueError(
                    f"page {number} references forbidden decision {decision_id} ({decisions[decision_id]})"
                )
        for image in page["images"]:
            src = str(image.get("src") or "").strip()
            if not src:
                raise ValueError(f"page {number} image is missing src")
            if not is_safe_asset_src(src):
                raise ValueError(f"page {number} has unsafe image src {src!r}")
            if image.get("role") != "background":
                non_background_sources.append(src)
            asset_id = str(image.get("asset_id") or "").strip()
            if asset_id and image.get("role") not in {"background", "decorative"}:
                non_background_asset_ids.append(asset_id)
            if asset_id and asset_id not in available_asset_ids:
                raise ValueError(f"page {number} references unknown asset_id {asset_id}")
            asset = available_assets.get(asset_id, {})
            if asset.get("source_class") == "artifact":
                artifact_id = str(asset.get("artifact_id") or "")
                status = artifact_statuses.get(artifact_id, "unknown")
                if status not in ELIGIBLE_ARTIFACT_STATUSES:
                    raise ValueError(
                        f"page {number} asset {asset_id} comes from forbidden artifact {artifact_id or '<unknown>'} ({status})"
                    )
                if artifact_id not in {str(item) for item in page["artifact_ids"]}:
                    raise ValueError(f"page {number} asset {asset_id} must cite artifact {artifact_id}")

        layout = page["layout"]
        blocks = layout.get("blocks") or []
        layout_signature = (
            str(layout.get("layout_id") or ""),
            str(layout.get("density") or ""),
            tuple(str(block.get("type") or "") for block in blocks),
            tuple(str(image.get("role") or "") for image in page.get("images", [])),
        )
        previous_layout_signature = layout_signature

    required = {
        str(item.get("id"))
        for item in (brief or {}).get("must_keep", [])
        if item.get("id")
    }
    missing = sorted(required - covered)
    if missing:
        raise ValueError("uncovered must_keep ids: " + ", ".join(missing))
    # Identity/reuse/instance checks are owned by the shared static contract.


def _ensure_render_contract(blueprint: dict, style_text: str) -> list[dict]:
    theme = blueprint.setdefault("theme", {})
    if not isinstance(theme.get("render_contract"), dict) or not theme["render_contract"]:
        raise ValueError("blueprint theme is missing model-authored render_contract")
    fonts = theme["render_contract"].get("fonts")
    if not isinstance(fonts, dict):
        fonts = DEFAULT_FONTS
    resolved, issues = resolve_font_contract(fonts)
    theme["render_contract"]["fonts"] = resolved
    return issues


def _validate_outline(outline: dict, expected_pages: int) -> None:
    pages = outline.get("pages")
    if not isinstance(pages, list) or len(pages) != expected_pages:
        actual = len(pages) if isinstance(pages, list) else 0
        raise ValueError(f"outline page count mismatch: expected {expected_pages}, got {actual}")
    for number, page in enumerate(pages, 1):
        if int(page.get("no", 0)) != number:
            raise ValueError(f"outline page numbering mismatch at {number}")
        if not str(page.get("title") or "").strip():
            raise ValueError(f"outline page {number} is missing title")
        if not str(page.get("layout_id") or "").strip():
            raise ValueError(f"outline page {number} is missing layout_id")
        complexity = str(page.get("complexity") or "normal").strip().lower()
        page["complexity"] = complexity


def _normalize_model_result(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        return {
            "content": value, "finish_reason": None, "usage": {},
            "response_id": None, "model": None,
        }
    if isinstance(value, dict) and "content" in value:
        return {
            "content": str(value.get("content") or ""),
            "finish_reason": value.get("finish_reason"),
            "usage": value.get("usage") or {},
            "response_id": value.get("response_id"),
            "model": value.get("model"),
        }
    raise PlanOutputError("plan_output_invalid_response: model returned neither text nor a metadata response")


def _call_plan_model(
    model_fn: Callable[..., Any], prompt: str, *, max_tokens: int, timeout: int,
    reports: Path, call_no: int, label: str, run_id: str | None = None,
    allow_truncated: bool = False,
) -> tuple[str, dict]:
    """Call one planner stage and persist bounded, credential-free diagnostics."""
    started = time.time()
    try:
        result = _normalize_model_result(model_fn(prompt, max_tokens=max_tokens, timeout=timeout))
    except Exception as exc:
        failure = {
            "call": call_no, "label": label, "status": "failed", "error": str(exc),
            "requested_max_tokens": max_tokens, "prompt_chars": len(prompt),
            "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
            "run_id": run_id, "started_at_unix": round(started, 3),
            "finished_at_unix": round(time.time(), 3),
            "latency_s": round(time.time() - started, 3),
        }
        atomic_write_json(reports / "plan_calls" / f"call-{call_no:02d}.json", failure)
        if run_id:
            atomic_write_json(reports / "runs" / run_id / "plan_calls" / f"call-{call_no:02d}.json", failure)
        raise
    content = result["content"]
    diagnostic = {
        "call": call_no, "label": label, "status": "success", "validation_status": "pending",
        "finish_reason": result.get("finish_reason"), "usage": result.get("usage") or {},
        "response_id": result.get("response_id"), "model": result.get("model"),
        "requested_max_tokens": max_tokens, "prompt_chars": len(prompt),
        "content_chars": len(content),
        "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
        "content_sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
        "run_id": run_id, "started_at_unix": round(started, 3),
        "finished_at_unix": round(time.time(), 3),
        "latency_s": round(time.time() - started, 3),
    }
    atomic_write_json(reports / "plan_calls" / f"call-{call_no:02d}.json", diagnostic)
    atomic_write_text(reports / "plan_calls" / f"call-{call_no:02d}.txt", content)
    if run_id:
        run_calls = reports / "runs" / run_id / "plan_calls"
        atomic_write_json(run_calls / f"call-{call_no:02d}.json", diagnostic)
        atomic_write_text(run_calls / f"call-{call_no:02d}.txt", content)
    finish_reason = str(result.get("finish_reason") or "").lower()
    if finish_reason in {"length", "max_tokens", "max_output_tokens"} and not allow_truncated:
        raise PlanOutputError(
            f"plan_output_truncated: {label} reached its output limit ({max_tokens} tokens); "
            "retain complete records, target exact missing pages, or raise --plan-max-tokens"
        )
    if not content.strip():
        raise PlanOutputError(f"plan_output_empty: {label} returned no content")
    return content, diagnostic


def parse_complete_jsonl_records(raw: str) -> list[dict]:
    """Return only complete JSON-object lines, ignoring a truncated tail."""
    records: list[dict] = []
    for line in raw.splitlines():
        candidate = line.strip()
        if not candidate:
            continue
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            records.append(value)
    return records


def _parse_adaptive_initial(raw: str, label: str) -> dict:
    """Accept the primary JSON envelope or an independently recoverable JSONL stream."""
    try:
        payload = _parse_plan_json(raw, label)
    except PlanOutputError:
        payload = {}
    if not isinstance(payload.get("outline"), list) or not isinstance(payload.get("pages"), list):
        records = parse_complete_jsonl_records(raw)
        deck = next((item for item in records if item.get("type") in {"deck", "charter"}), None)
        outline_record = next((item for item in records if item.get("type") == "outline"), None)
        page_records = [item.get("page") or item for item in records if item.get("type") == "page_blueprint"]
        if not deck or not outline_record:
            raise PlanOutputError(f"plan_output_invalid_json: {label} is missing outline")
        payload = {
            "topic": deck.get("topic"), "audience": deck.get("audience"),
            "page_count": deck.get("page_count"), "theme": deck.get("theme"),
            "outline": outline_record.get("pages"), "pages": page_records,
        }
    return payload


def _validated_partial_pages(payload: dict, outline: dict, allowed: set[int]) -> tuple[dict[int, dict], dict[int, str]]:
    """Validate independent pages without fabricating records for missing entries."""
    accepted: dict[int, dict] = {}
    rejected: dict[int, str] = {}
    skeleton = {int(page["no"]): page for page in outline["pages"]}
    raw_pages = payload.get("pages") or []
    seen = set()
    for raw_page in raw_pages:
        try:
            number = int(raw_page.get("no", 0))
        except (AttributeError, TypeError, ValueError):
            continue
        if number not in allowed or number in seen:
            accepted.pop(number, None)
            rejected[number] = "page is outside the assigned range or duplicated"
            continue
        seen.add(number)
        try:
            locked = skeleton[number]
            for field in ("title", "role", "takeaway"):
                if field in editable_claim_fields(locked):
                    continue
                if not claim_equivalent(raw_page.get(field), locked.get(field), exact=field == "role" or field in locked.get("verbatim_fields", [])):
                    raise ValueError(f"changed locked {field}")
            if set(raw_page.get("must_keep_ids", [])) != set(locked.get("must_keep_ids", [])):
                raise ValueError("changed locked must_keep_ids")
            layout = raw_page.get("layout") or {}
            if not str(layout.get("layout_id") or ""):
                raise ValueError("missing layout_id")
            complexity = str(raw_page.get("complexity") or locked.get("complexity") or "normal").lower()
            raw_page["complexity"] = complexity
            _validate_page_output_contract(raw_page, number)
            accepted[number] = normalize_page_contract(raw_page, number)
            accepted[number]["complexity"] = complexity
        except (KeyError, TypeError, ValueError) as exc:
            rejected[number] = str(exc)
    return accepted, rejected


def _mark_plan_validation(
    reports: Path, run_id: str | None, diagnostic: dict, status: str, error: str | None = None,
) -> None:
    updated = dict(diagnostic)
    updated["validation_status"] = status
    updated["validation_error"] = error
    updated["validated_at_unix"] = round(time.time(), 3)
    name = f"call-{int(updated['call']):02d}.json"
    atomic_write_json(reports / "plan_calls" / name, updated)
    if run_id:
        atomic_write_json(reports / "runs" / run_id / "plan_calls" / name, updated)


def _parse_plan_json(raw: str, label: str) -> dict:
    try:
        payload = extract_json(raw)
    except ValueError as exc:
        raise PlanOutputError(f"plan_output_invalid_json: {label}: {exc}") from exc
    if not isinstance(payload, dict):
        raise PlanOutputError(f"plan_output_invalid_json: {label} must return a JSON object")
    return payload


def _validate_segment(payload: dict, outline: dict, start: int, end: int) -> list[dict]:
    pages = payload.get("pages")
    expected_count = end - start + 1
    if not isinstance(pages, list) or len(pages) != expected_count:
        actual = len(pages) if isinstance(pages, list) else 0
        raise ValueError(f"segment {start}-{end} page count mismatch: expected {expected_count}, got {actual}")
    skeleton = {int(page["no"]): page for page in outline["pages"]}
    for expected_no, page in zip(range(start, end + 1), pages):
        if int(page.get("no", 0)) != expected_no:
            raise ValueError(f"segment {start}-{end} page numbering mismatch at {expected_no}")
        locked = skeleton[expected_no]
        for field in ("title", "role", "takeaway"):
            if not claim_equivalent(page.get(field), locked.get(field), exact=field == "role" or field in locked.get("verbatim_fields", [])):
                raise ValueError(f"segment page {expected_no} changed locked {field}")
        if set(page.get("must_keep_ids", [])) != set(locked.get("must_keep_ids", [])):
            raise ValueError(f"segment page {expected_no} changed locked must_keep_ids")
        layout = page.get("layout") or {}
        if not str(layout.get("layout_id") or ""):
            raise ValueError(f"segment page {expected_no} missing layout_id")
        _validate_page_output_contract(page, expected_no)
        normalized = normalize_page_contract(page, expected_no)
        page.clear()
        page.update(normalized)
    return pages


def generate_blueprint(
    root: Path, topic: str, pages: int, extra: str, brief: dict, style_text: str, *,
    model_fn: Callable[..., Any] = sol_response, force: bool = False,
    segment_threshold: int = 24, segment_size: int = 10, plan_workers: int = 4,
    plan_max_tokens: int = 32000, segment_max_retries: int = 1,
    repair_pages: list[int] | None = None, extra_calls: int = 0, approval_id: str | None = None,
) -> dict:
    if pages < 1:
        raise ValueError("pages must be positive")
    if extra_calls < 0 or (extra_calls and (not repair_pages or not approval_id)):
        raise ValueError('extra calls require explicit repair_pages and approval_id')
    # These two segment arguments remain accepted for old callers only. The
    # canonical capacity-aware ranges live in ppt_contract; this is not a retry ceiling.
    if (
        segment_size < 1 or plan_workers < 1 or plan_max_tokens < 1000
        or segment_max_retries not in {0, 1}
    ):
        raise ValueError(
            "segment_size and plan_workers must be positive; plan_max_tokens must be at least 1000; "
            "segment_max_retries must be 0 or 1"
        )
    reports = root / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    from brief_capacity import planning_brief
    brief = planning_brief(brief)
    if brief.get('source_page_contract') and len(brief['source_page_contract']['source_pages']) != pages:
        raise ValueError('preserve-pages requested count differs from original source count')
    prompt = build_prompt(topic, pages, extra, brief, style_text)
    adaptive_ranges = planning_ranges(pages, max_tokens=plan_max_tokens)
    separate_outline = pages > 60
    normal_plan_calls = len(adaptive_ranges) + int(separate_outline)
    segmented = len(adaptive_ranges) > 1
    fingerprint = prompt_fingerprint(
        prompt + json.dumps({
            "segmented": segmented, "planning_ranges": adaptive_ranges,
            "plan_workers": plan_workers, "plan_max_tokens": plan_max_tokens,
            "exceptional_repair_enabled": segment_max_retries > 0,
        }, sort_keys=True),
        "blueprint-v9-work-budget",
    )
    output_path = reports / "blueprint.json"
    cache_path = reports / "blueprint-cache.json"
    started = time.time()
    plan_run_id = os.environ.get("PPT_BUILD_RUN_ID", "").strip() or (
        "plan-" + time.strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:8]
    )
    font_issues: list[dict] = []
    from workflow_runtime import model_request, planning_scope
    stage_scope = planning_scope(root, topic, pages, brief)
    original_model_fn = model_fn
    from work_budget import WorkBudget
    from plan_checkpoint import save_checkpoint, load_checkpoint, repair_checkpoint
    work_budget = WorkBudget(root, stage_scope, 'plan')
    # Design/instructions must match before reusing a partial plan; worker changes do not invalidate it.
    checkpoint_scope = prompt_fingerprint(stage_scope + extra + style_text, 'plan-checkpoint-v1')
    # Separate actual adapter submissions from parser invocations/cache replays.
    submitted_tokens = set()
    def budgeted_model(prompt, **kwargs):
        # Exact completed responses survive interruption; parsing/validation is
        # always rerun by the caller. Changed instructions consume remaining budget.
        key = prompt_fingerprint(prompt + json.dumps(kwargs, sort_keys=True), 'plan-response-v1')
        saved = reports / 'plan_responses' / (key + '.json')
        if saved.exists():
            return json.loads(saved.read_text(encoding='utf-8'))['response']
        from request_journal import admit, settle_error, response_ready
        token = admit(work_budget, 'request:' + key, prompt, request_kwargs=kwargs)
        if not response_ready(work_budget,token):
            submitted_tokens.add(token)
        try:
            response = model_request(root, 'plan', prompt, original_model_fn,
                                     scope=stage_scope, budget=work_budget, token=token, **kwargs)
            atomic_write_json(saved, {'response': response})
            work_budget.finish(token, remaining=0, detail='response persisted; validation follows')
            return response
        except Exception as exc:
            settle_error(work_budget, token, exc)
            raise
    model_fn = budgeted_model

    def validate(payload: dict) -> None:
        render_contract = (payload.get("theme") or {}).get("render_contract")
        if not isinstance(render_contract, dict) or not render_contract:
            raise ValueError("blueprint theme is missing render_contract")
        _validate_blueprint(payload, pages, brief)

    def improve_design(payload):
        # Targeted defect grants never authorize changing other accepted pages.
        if repair_pages or extra_calls:
            return payload,0
        from design_refinement import refine_design
        refined,calls=refine_design(root,payload,brief,stage_scope,original_model_fn)
        if refined!=payload:
            outline=dict(refined,pages=[dict(p,layout_id=p['layout']['layout_id']) for p in refined['pages']])
            accepted={p['no']:p for p in refined['pages']}
            save_checkpoint(root,checkpoint_scope,outline,accepted,accepted,{})
        return refined,calls

    if not force:
        cached = load_validated_json_cache(output_path, cache_path, fingerprint, validate)
        if cached is not None:
            cached,design_calls=improve_design(cached)
            write_json_cache(output_path,cache_path,fingerprint,cached)
            segment_count = len(adaptive_ranges)
            write_stage_metric(
                root, "plan", started, cache_hit=not design_calls, prompt_chars=len(prompt),
                segmented=segmented, segment_count=segment_count, model_calls=design_calls,
                design_refinement_calls=design_calls,
                workers=min(plan_workers, max(1, segment_count - 1)) if segmented else 1,
                normal_call_budget=normal_plan_calls, exceptional_repair_calls=0,
                run_id=plan_run_id,
            )
            return cached

    checkpoint = load_checkpoint(root, checkpoint_scope) if not force else None
    if repair_pages and checkpoint is None:
        raise ValueError('no matching planning checkpoint; do not restart the whole deck to repair a page')
    if checkpoint is not None:
        outline = checkpoint['outline']
        _validate_outline(outline, pages)
        # Accepted is historical state, not an exemption from today's contract.
        merged = dict(checkpoint['drafts']); merged.update(checkpoint['accepted'])
        findings = static_findings(dict(outline, pages=[merged[n] for n in sorted(merged)]),
                                   brief, complete=len(merged) == pages)
        # Historical rejection is not evidence of a current defect. Revalidate
        # all scoped drafts, including locked claims, before buying a repair.
        retired = {n for n in merged
                   if n not in checkpoint['accepted'] and n in merged
                   and (not repair_pages or n in repair_pages)}
        rechecked, _ = _validated_partial_pages(
            {'pages': [merged[n] for n in sorted(retired)]}, outline, retired)
        blocked = {f.get('page') for f in findings}
        promoted = set()
        for number, draft in rechecked.items():
            if None not in blocked and number not in blocked:
                checkpoint['accepted'][number] = draft
                checkpoint['errors'].pop(number, None)
                promoted.add(number)
        for finding in findings:
            number = finding.get('page')
            if number in checkpoint['accepted']:
                checkpoint['drafts'][number] = checkpoint['accepted'].pop(number)
            if number in merged:
                checkpoint['errors'][number] = checkpoint['errors'].get(number, '') + '; ' + finding['code'] + ': ' + finding['message']
        save_checkpoint(root, checkpoint_scope, outline, checkpoint['accepted'], checkpoint['drafts'], checkpoint['errors'])
        if not segment_max_retries and len(checkpoint['accepted']) != pages and not extra_calls:
            raise PlanOutputError('recovery disabled; unresolved pages remain in checkpoint')
        remaining_targets = [n for n in repair_pages if n not in promoted] if repair_pages else None
        if len(checkpoint['accepted']) == pages or (repair_pages and not remaining_targets):
            page_results, repairs = checkpoint['accepted'], 0
        else:
            page_results, repairs = repair_checkpoint(root, checkpoint, topic, brief, style_text,
                original_model_fn, max_tokens=plan_max_tokens, targets=remaining_targets,
                extra_calls=extra_calls, approval_id=approval_id)
        if len(page_results) != pages:
            raise PlanOutputError('requested pages repaired; other unresolved pages remain in plan_checkpoint.json')
        blueprint = dict(outline, pages=[page_results[n] for n in range(1, pages + 1)])
        font_issues.extend(_ensure_render_contract(blueprint, style_text))
        _validate_blueprint(blueprint, pages, brief)
        blueprint,design_calls=improve_design(blueprint)
        write_json_cache(output_path, cache_path, fingerprint, blueprint)
        write_stage_metric(root, "plan", started, cache_hit=False, resumed=True,
                           model_calls=repairs+design_calls, design_refinement_calls=design_calls,normal_call_budget=normal_plan_calls,
                           exceptional_repair_calls=repairs, run_id=plan_run_id)
        return blueprint

    if not segmented:
        raw, single_diagnostic = _call_plan_model(
            model_fn, prompt, max_tokens=plan_max_tokens, timeout=1200,
            reports=reports, call_no=1, label="single-blueprint", run_id=plan_run_id,
        )
        blueprint = _parse_plan_json(raw, "single-blueprint")
        atomic_write_text(reports / "blueprint_raw.txt", raw)
        model_calls, segment_count = len(submitted_tokens), 1
        drafts = {int(p['no']): p for p in blueprint.get('pages', [])}
        outline = dict(blueprint, pages=[dict(p, layout_id=(p.get('layout') or {}).get('layout_id'),
                          complexity=p.get('complexity', 'normal')) for p in drafts.values()])
        _validate_outline(outline, pages)
        accepted, rejected = _validated_partial_pages(blueprint, outline, set(range(1, pages + 1)))
        for f in static_findings(blueprint, brief):
            n = f.get('page')
            if n in drafts:
                accepted.pop(n, None)
                rejected[n] = rejected.get(n, '') + '; ' + f['code'] + ': ' + f['message']
        checkpoint = save_checkpoint(root, checkpoint_scope, outline, accepted, drafts, rejected)
        if len(accepted) < pages and segment_max_retries:
            accepted, repairs = repair_checkpoint(root, checkpoint, topic, brief, style_text,
                original_model_fn, max_tokens=plan_max_tokens)
            model_calls += repairs
        if len(accepted) != pages:
            raise PlanOutputError('planning incomplete; resume saved checkpoint')
        blueprint['pages'] = [accepted[n] for n in range(1, pages + 1)]
    else:
        first_start, first_end = adaptive_ranges[0]
        initial_prompt = (build_outline_prompt(topic, pages, extra, brief, style_text) if separate_outline
                          else build_adaptive_initial_prompt(topic, pages, first_start, first_end, extra, brief, style_text))
        initial_raw, initial_diagnostic = _call_plan_model(
            model_fn, initial_prompt, max_tokens=plan_max_tokens, timeout=1200,
            reports=reports, call_no=1, label=f"adaptive-initial-{first_start}-{first_end}",
            run_id=plan_run_id, allow_truncated=True,
        )
        if separate_outline:
            outline_payload = _parse_plan_json(initial_raw, "global-outline")
            initial = dict(outline_payload, outline=outline_payload.get('pages', []), pages=[])
        else:
            initial = _parse_adaptive_initial(initial_raw, "adaptive-initial")
        outline = {
            "topic": initial.get("topic") or topic,
            "audience": initial.get("audience") or brief.get("audience") or "",
            "page_count": pages,
            "theme": initial.get("theme") or {},
            "pages": initial.get("outline") or [],
        }
        font_issues.extend(_ensure_render_contract(outline, style_text))
        _validate_outline(outline, pages)
        atomic_write_json(reports / 'runs' / plan_run_id / 'outline_capacity.json', {
            'infeasible_pages': [p['no'] for p in outline['pages'] if infeasible_lock(p)],
            'policy': 'only SOL may shorten title/takeaway of these pages; role and budgets unchanged'})
        first_pages, first_rejected = _validated_partial_pages(
            initial, outline, set(range(first_start, first_end + 1)),
        )
        _mark_plan_validation(
            reports, plan_run_id, initial_diagnostic,
            "accepted" if len(first_pages) == first_end - first_start + 1 else "accepted_partial",
            None if not first_rejected else json.dumps(first_rejected, ensure_ascii=False, sort_keys=True),
        )
        atomic_write_text(reports / "plan_raw" / "adaptive-initial.txt", initial_raw)

        page_results: dict[int, dict] = dict(first_pages)
        page_drafts = {int(p['no']): p for p in initial.get('pages', []) if isinstance(p, dict) and str(p.get('no', '')).isdigit()}
        rejected_pages: dict[int, str] = dict(first_rejected)
        raw_results: dict[int, str] = {0: initial_raw}
        result_lock = threading.Lock()
        call_lock = threading.Lock()
        call_counter = 1
        exceptional_repair_calls = 0

        def next_call_no() -> int:
            nonlocal call_counter
            with call_lock:
                call_counter += 1
                return call_counter

        def plan_segment(index: int, start: int, end: int) -> tuple[int, dict[int, dict], dict[int, str], str]:
            prompt = build_segment_prompt(topic, start, end, brief, outline, style_text, extra=extra)
            label = f"detail-{start}-{end}"
            diagnostic = None
            try:
                raw, diagnostic = _call_plan_model(
                    model_fn, prompt, max_tokens=plan_max_tokens, timeout=1200,
                    reports=reports, call_no=next_call_no(), label=label, run_id=plan_run_id,
                    allow_truncated=True,
                )
                try:
                    payload = _parse_plan_json(raw, label)
                except PlanOutputError:
                    payload = {}
                if not isinstance(payload.get("pages"), list):
                    records = parse_complete_jsonl_records(raw)
                    payload = {"pages": [
                        item.get("page") or item for item in records
                        if item.get("type") == "page_blueprint"
                    ]}
                with result_lock:
                    for p in payload.get('pages', []):
                        if isinstance(p, dict) and str(p.get('no', '')).isdigit() and start <= int(p['no']) <= end:
                            page_drafts[int(p['no'])] = p
                accepted, rejected = _validated_partial_pages(
                    payload, outline, set(range(start, end + 1)),
                )
                status = "accepted" if len(accepted) == end - start + 1 else "accepted_partial"
                _mark_plan_validation(
                    reports, plan_run_id, diagnostic, status,
                    None if not rejected else json.dumps(rejected, ensure_ascii=False, sort_keys=True),
                )
                return index, accepted, rejected, raw
            except (ValueError, PlanOutputError) as exc:
                if diagnostic is not None:
                    _mark_plan_validation(reports, plan_run_id, diagnostic, "rejected", str(exc))
                return index, {}, {number: str(exc) for number in range(start, end + 1)}, ""

        save_checkpoint(root, checkpoint_scope, outline, page_results, page_drafts, rejected_pages)
        remaining_ranges = list(enumerate(adaptive_ranges if separate_outline else adaptive_ranges[1:], start=1))
        with ThreadPoolExecutor(max_workers=min(plan_workers, len(remaining_ranges))) as executor:
            futures = {
                executor.submit(plan_segment, index, start, end): (index, start, end)
                for index, (start, end) in remaining_ranges
            }
            for future in as_completed(futures):
                index, accepted, rejected, segment_raw = future.result()
                with result_lock:
                    page_results.update(accepted)
                    rejected_pages.update(rejected)
                    raw_results[index] = segment_raw
                    save_checkpoint(root, checkpoint_scope, outline, page_results, page_drafts, rejected_pages)

        # Collect cross-layer and deck-wide errors BEFORE spending the repair call.
        candidates = dict(page_drafts)
        candidates.update(page_results)
        findings = static_findings({'pages': [candidates[n] for n in sorted(candidates)],
                                    'page_count': pages}, brief, complete=len(candidates) == pages)
        atomic_write_json(reports / 'runs' / plan_run_id / 'plan_static_findings.json', findings)
        for finding in findings:
            number = finding.get('page')
            if number in candidates:
                page_results.pop(number, None)
                rejected_pages[number] = rejected_pages.get(number, '') + '; ' + finding['code'] + ': ' + finding['message']
        missing_numbers = sorted(set(range(1, pages + 1)) - set(page_results))
        checkpoint = save_checkpoint(root, checkpoint_scope, outline, page_results, page_drafts, rejected_pages)
        if missing_numbers and segment_max_retries > 0:
            page_results, exceptional_repair_calls = repair_checkpoint(
                root, checkpoint, topic, brief, style_text, original_model_fn, max_tokens=plan_max_tokens)
            call_counter += exceptional_repair_calls
        if len(page_results) != pages:
            raise PlanOutputError('planning incomplete; unresolved pages saved in reports/plan_checkpoint.json')

        merged_pages = [page_results[number] for number in range(1, pages + 1)]
        blueprint = {
            "topic": outline.get("topic") or topic,
            "audience": outline.get("audience") or brief.get("audience") or "",
            "page_count": pages,
            "theme": outline.get("theme") or {},
            "pages": merged_pages,
        }
        for index, (start, end) in enumerate(adaptive_ranges):
            atomic_write_text(
                reports / "plan_raw" / f"segment-{index + 1:02d}-{start:02d}-{end:02d}.txt",
                raw_results.get(index, ""),
            )
        if exceptional_repair_calls:
            atomic_write_text(
                reports / "plan_raw" / "exceptional-targeted-repair.txt",
                raw_results.get(len(adaptive_ranges), ""),
            )
        atomic_write_text(reports / "blueprint_raw.txt", json.dumps(blueprint, ensure_ascii=False, indent=2))
        model_calls = len(submitted_tokens) + exceptional_repair_calls
        segment_count = len(adaptive_ranges)

    font_issues.extend(_ensure_render_contract(blueprint, style_text))
    font_issues = list({
        json.dumps(issue, ensure_ascii=False, sort_keys=True): issue for issue in font_issues
    }.values())
    atomic_write_json(reports / "font_preflight.json", {
        "status": ("unresolved" if not all(blueprint["theme"]["render_contract"]["fonts"].values()) else
                   "unverified" if any(i['code']=='font_coverage_unverified' for i in font_issues) else
                   "resolved_with_fallbacks" if font_issues else "ok"),
        "fonts": blueprint["theme"]["render_contract"]["fonts"],
        "issues": font_issues,
    })
    _validate_blueprint(blueprint, pages, brief)
    if not segmented:
        _mark_plan_validation(reports, plan_run_id, single_diagnostic, "accepted")
    blueprint,design_calls=improve_design(blueprint)
    write_json_cache(output_path, cache_path, fingerprint, blueprint)
    write_stage_metric(
        root, "plan", started, cache_hit=False, prompt_chars=len(prompt),
        segmented=segmented, segment_count=segment_count, model_calls=model_calls+design_calls,
        design_refinement_calls=design_calls,
        workers=min(plan_workers, max(1, segment_count - 1)) if segmented else 1,
        plan_max_tokens=plan_max_tokens,
        normal_call_budget=normal_plan_calls,
        exceptional_repair_calls=exceptional_repair_calls if segmented else max(0, model_calls - 1),
        exceptional_targeted_repair=bool(exceptional_repair_calls) if segmented else model_calls > 1,
        segment_retry_calls=0,
        run_id=plan_run_id,
    )
    return blueprint


def main() -> int:
    parser = argparse.ArgumentParser(description="plan a PPT from a brief")
    parser.add_argument("--topic", default=None)
    parser.add_argument("--pages", type=int, default=None)
    parser.add_argument("--outdir", default=".")
    parser.add_argument("--extra", default=None)
    parser.add_argument("--extra-file")
    parser.add_argument("--replace-plan", action="store_true")
    parser.add_argument("--brief", default=None, help="brief JSON path")
    parser.add_argument("--material", action="append", default=[], help="ZIP/folder/DOCX/text/image input; may repeat")
    parser.add_argument("--history", action="append", default=[], help="chat history export; may repeat")
    parser.add_argument("--artifact", action="append", default=[], help="intermediate artifact; may repeat")
    parser.add_argument("--current-request", default="", help="current user request; highest authority")
    parser.add_argument("--force", action="store_true", help="ignore matching validated brief/blueprint caches")
    parser.add_argument("--segment-threshold", type=int, default=24, help=argparse.SUPPRESS)
    parser.add_argument("--segment-size", type=int, default=10, help=argparse.SUPPRESS)
    parser.add_argument("--plan-workers", type=int, default=4, help="concurrent detail-planning calls")
    parser.add_argument("--plan-max-tokens", type=int, default=32000, help="maximum output tokens per planner call")
    parser.add_argument(
        "--segment-max-retries", type=int, default=1,
        help="enable progress-based targeted recovery (0 off, 1 on; not a call ceiling)",
    )
    parser.add_argument('--repair-pages', help='comma-separated unresolved page numbers; never replan accepted pages')
    parser.add_argument('--extra-calls', type=int, default=0, help='explicit extra recovery attempts for these targets')
    parser.add_argument('--approval-id', help='stable user approval identity; replay cannot replenish it')
    args = parser.parse_args()

    root = Path(args.outdir).resolve()
    from plan_request import resolve_request, read_extra, accept_request
    request = resolve_request(root, args.topic, args.pages, read_extra(args.extra, args.extra_file), replace=args.replace_plan)
    args.topic, args.pages, args.extra = request['topic'], request['pages'], request['extra']
    for name in ("reports", "assets", "authoring"):
        (root / name).mkdir(parents=True, exist_ok=True)
    if args.brief:
        brief = json.loads(Path(args.brief).read_text(encoding="utf-8"))
    elif args.material or args.history or args.artifact or args.current_request:
        result = ingest_context(
            args.material, root, history_inputs=args.history,
            artifact_inputs=args.artifact, current_request=args.current_request,
        )
        if result["extract_failure_count"]:
            raise RuntimeError(
                f"context ingestion failed for {result['extract_failure_count']} source(s); inspect source_manifest.json"
            )
        brief = generate_brief(root, args.topic, force=args.force)
    elif (root / "reports/brief.json").exists():
        brief = json.loads((root / "reports/brief.json").read_text(encoding="utf-8"))
    else:
        brief = _topic_brief(args.topic)
        (root / "reports/brief.json").write_text(json.dumps(brief, ensure_ascii=False, indent=2), encoding="utf-8")

    brief = attach_available_assets(brief, root)

    skill_root = Path(__file__).resolve().parents[1]
    style_path = select_style_reference(brief, skill_root)
    started = time.time()
    from plan_request import accepted_override
    preserved = None if args.force else accepted_override(root, request)
    if preserved is not None:
        _validate_blueprint(preserved, args.pages, brief)
        write_stage_metric(root, 'plan', started, cache_hit=True, model_calls=0, source='accepted_user_revision_or_adoption')
        print(f"PAGES: {len(preserved['pages'])}\ncache_hit: true\naccepted_plan_preserved: true")
        return 0
    blueprint = generate_blueprint(
        root, args.topic, args.pages, args.extra, brief,
        style_path.read_text(encoding="utf-8"), force=args.force,
        segment_threshold=args.segment_threshold, segment_size=args.segment_size,
        plan_workers=args.plan_workers, plan_max_tokens=args.plan_max_tokens,
        segment_max_retries=args.segment_max_retries,
        repair_pages=[int(n) for n in args.repair_pages.split(',')] if args.repair_pages else None,
        extra_calls=args.extra_calls, approval_id=args.approval_id,
    )
    accept_request(root, request, origin='managed' if os.environ.get('PPT_BUILD_RUN_ID') else 'direct')
    print(f"PAGES: {len(blueprint['pages'])}")
    print(f"STYLE: {style_path.name}")
    print(f"latency_s: {round(time.time() - started, 1)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
