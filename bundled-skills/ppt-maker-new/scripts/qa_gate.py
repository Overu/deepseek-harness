#!/usr/bin/env python3
"""Cross-layer release gate for brief, blueprint, assets, and authoring SML."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from copy import deepcopy
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

from defect_map import sync_stage_defects

from sol_common import resolve_asset_target
from font_policy import available_font_families, font_is_available, font_supports_cjk
from ppt_contract import GHOST_NUMBER_MAX_AREA_RATIO
from page_validation import typography_errors
from quality_policy import blocking, classify, partition


LARK_SCRIPTS = Path(__file__).resolve().parents[1] / "lark" / "scripts"
if str(LARK_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(LARK_SCRIPTS))
from xml_lint import (lint_xml, extract_elements, is_text_element,
                      should_flag_overlap, is_background_decorative_text)  # noqa: E402


from audience_copy import META_PATTERNS, xml_copy_findings


DISPLAY_TEXT_TYPES = {"title", "headline", "sub-headline", "subtitle", "section-title"}
CJK = r"\u3400-\u9fff"
# Numbers with Chinese units and all-cap acronyms are normal Chinese copy.
MIXED_SCRIPT_GLUE = re.compile(rf"(?:[a-z][{CJK}]|[{CJK}][A-Z][a-z]+|[a-z]\.[A-Z])")


def _number(value: str | None, default: float = 0.0) -> float:
    try:
        return float(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def _text_boxes(xml_root: ET.Element) -> list[dict]:
    # Use the same alpha, paint-order, font and glyph geometry as backend lint.
    # Strip namespaces on a private copy for its XML parser, never the caller's SML.
    local_root = deepcopy(xml_root)
    for node in local_root.iter():
        node.tag = node.tag.split('}')[-1]
    elements = extract_elements(ET.tostring(local_root, encoding='unicode'))
    boxes: list[dict] = []
    for element in elements:
        if not is_text_element(element):
            continue
        lines = [p['text'].strip() for p in element.get('paragraphs', [])]
        boxes.append({
            "x": element['x'], "y": element['y'],
            "w": element['width'], "h": element['height'],
            "font_size": element['fontSize'],
            "text_type": str(element.get('textType') or 'body'),
            "text": "\n".join(line for line in lines if line),
            "lines": [line for line in lines if line],
            "semantic": element,
            "background_decoration": is_background_decorative_text(element, elements),
        })
    return boxes


def _overlap_ratio(first: dict, second: dict) -> float:
    width = max(0.0, min(first["x"] + first["w"], second["x"] + second["w"]) - max(first["x"], second["x"]))
    height = max(0.0, min(first["y"] + first["h"], second["y"] + second["h"]) - max(first["y"], second["y"]))
    smaller = min(first["w"] * first["h"], second["w"] * second["h"])
    return (width * height / smaller) if smaller > 0 else 0.0


def rendered_text_quality_errors(xml_root: ET.Element, page: dict, page_no: int, *, include_advisory=False) -> list[dict]:
    errors: list[dict] = []
    boxes = _text_boxes(xml_root)
    semantic_elements = [box['semantic'] for box in boxes]
    furniture_types = {"caption", "source", "footer", "page-number"}
    for box in boxes:
        text = box["text"].strip()
        if MIXED_SCRIPT_GLUE.search(text):
            _add(errors, "mixed_script_glue", f"missing separator between scripts or sentences: {text[:80]!r}", page_no)
        if box["text_type"] in DISPLAY_TEXT_TYPES and len(box["lines"]) > 1:
            tail = re.sub(r"\s+", "", box["lines"][-1])
            if len(tail) == 1 and re.fullmatch(rf"[A-Za-z0-9{CJK}]", tail):
                _add(errors, "title_orphan_line", f"display text ends with a one-character line: {tail}", page_no)
        if box["text_type"] not in furniture_types and box["y"] + box["h"] > 510:
            _add(errors, "footer_zone_intrusion", "non-footer text enters the bottom 30px safe zone", page_no)

    ghost_indexes = {
        index for index, box in enumerate(boxes)
        if box["font_size"] >= 64 and re.fullmatch(r"\d{1,3}", re.sub(r"\s+", "", box["text"]))
    }
    for index in ghost_indexes:
        ghost = boxes[index]
        if ghost["w"] * ghost["h"] > 960 * 540 * GHOST_NUMBER_MAX_AREA_RATIO:
            _add(errors, "ghost_number_too_large", "large decorative number exceeds 18% of canvas area", page_no)
        if any(should_flag_overlap(ghost['semantic'], other['semantic'], semantic_elements) for other_index, other in enumerate(boxes) if other_index != index):
            _add(errors, "ghost_number_overlaps_text", "large decorative number intersects effective text", page_no)

    for first_index, first in enumerate(boxes):
        for second in boxes[first_index + 1:]:
            if should_flag_overlap(first['semantic'], second['semantic'], semantic_elements):
                _add(
                    errors, "text_box_overlap",
                    f"text boxes overlap materially: {first['text'][:24]!r} / {second['text'][:24]!r}", page_no,
                )
    return [classify(e) for e in errors] if include_advisory else blocking(errors)


def rendered_image_quality_errors(
    xml_root: ET.Element, page: dict, page_no: int, assets_dir: Path,
    *, include_advisory=False,
) -> list[dict]:
    errors: list[dict] = []
    rendered_images: dict[str, list[ET.Element]] = {}
    for node in xml_root.iter():
        if node.tag.split("}")[-1] == "img":
            rendered_images.setdefault(str(node.attrib.get("src") or ""), []).append(node)
    for image in page.get("images", []):
        src = str(image.get("src") or "")
        nodes = rendered_images.get(src) or []
        if not nodes:
            continue
        role = str(image.get("role") or "").lower()
        box_x = _number(nodes[0].attrib.get("topLeftX"))
        box_y = _number(nodes[0].attrib.get("topLeftY"))
        box_width = _number(nodes[0].attrib.get("width"))
        box_height = _number(nodes[0].attrib.get("height"))
        area_ratio = (box_width * box_height) / (960 * 540)
        edge_count = sum((
            box_x <= 5,
            box_y <= 5,
            box_x + box_width >= 955,
            box_y + box_height >= 535,
        ))
        if role == "background" and area_ratio < 0.65 and edge_count < 3:
            _add(
                errors,
                "asset_role_geometry_mismatch",
                f"image {src!r} is labelled background but covers only {area_ratio:.1%} of the canvas",
                page_no,
            )
        elif role == "decorative" and area_ratio > 0.25:
            _add(
                errors,
                "asset_role_geometry_mismatch",
                f"image {src!r} is labelled decorative but covers {area_ratio:.1%} of the canvas",
                page_no,
            )
        if image.get("crop") != "contain":
            continue
        try:
            from PIL import Image

            asset_path = resolve_asset_target(assets_dir, src)
            with Image.open(asset_path) as opened:
                source_aspect = opened.width / opened.height
            box_aspect = box_width / box_height
        except (OSError, ValueError, ZeroDivisionError):
            continue
        if abs(box_aspect - source_aspect) / source_aspect > 0.03:
            _add(
                errors, "contain_image_will_crop",
                f"contain image {src!r} aspect {source_aspect:.3f} is placed in {box_aspect:.3f}; converter will crop it",
                page_no,
            )
    return [classify(e) for e in errors] if include_advisory else blocking(errors)


def _add(errors: list[dict], code: str, message: str, page: int | None = None) -> None:
    item = {"code": code, "message": message}
    if page is not None:
        item["page"] = page
    if item not in errors:
        errors.append(item)


def _visible_page_text(page: dict) -> str:
    parts = [str(page.get("title", "")), str(page.get("takeaway", ""))]
    content = page.get("content", [])
    if isinstance(content, str):
        parts.extend(content.splitlines())
    elif isinstance(content, list):
        parts.extend(str(value) for value in content)
    elif content is not None:
        parts.append(str(content))
    return "\n".join(parts)


def sync_qa_defect_map(root: Path, run_id: str, errors: list[dict]) -> Path:
    """Mirror the current deterministic QA result into the run defect map."""
    defects = []
    for error in errors:
        evidence = json.dumps(error, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        defects.append({
            "page_no": int(error.get("page") or 0),
            "severity": "blocking", "code": error.get("code", "qa_error"),
            "message": error.get("message", "QA gate failed"),
            "evidence_hash": hashlib.sha256(evidence.encode("utf-8")).hexdigest(),
        })
    return sync_stage_defects(root, run_id, "qa_gate", defects)


def evaluate(
    root: Path,
    brief: dict,
    blueprint: dict,
    min_body_font: float = 15,
    min_caption_font: float = 11,
    require_render_provenance: bool = False,
    installed_fonts: set[str] | frozenset[str] | None = None,
    selected_dir: Path | None = None,
) -> dict:
    if selected_dir is not None and require_render_provenance:
        raise ValueError('selection QA is not strict pipeline provenance certification')
    errors: list[dict] = []
    warnings: list[dict] = []
    pages = blueprint.get("pages", [])
    from image_lineage import lineage_findings
    errors.extend(lineage_findings(root,blueprint,pages))
    from blueprint_validation import static_findings
    errors.extend(static_findings(blueprint, brief, include_advisory=True))
    expected = int(blueprint.get("page_count", len(pages)))
    slides = sorted((selected_dir if selected_dir is not None else root / "authoring").glob("slide-*.xml"))
    if len(pages) != expected:
        _add(errors, "blueprint_page_count_mismatch", f"page_count={expected}, pages={len(pages)}")
    if len(slides) != expected:
        _add(errors, "authoring_page_count_mismatch", f"expected {expected} slide XML files, found {len(slides)}")
    expected_slide_names = {
        f"slide-{int(page.get('no', index)):02d}.xml"
        for index, page in enumerate(pages, 1)
    }
    actual_slide_names = {slide.name for slide in slides}
    if actual_slide_names != expected_slide_names:
        missing = sorted(expected_slide_names - actual_slide_names)
        unexpected = sorted(actual_slide_names - expected_slide_names)
        _add(
            errors,
            "authoring_page_set_mismatch",
            f"missing={missing or []}, unexpected={unexpected or []}",
        )

    if require_render_provenance:
        build_state_path = root / "reports" / "build_state.json"
        active_run_id = None
        try:
            build_state = json.loads(build_state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, TypeError):
            _add(errors, "missing_unified_build_state", "reports/build_state.json is missing or invalid")
        else:
            active_run_id = build_state.get("run_id")
            if build_state.get("status") not in {"gating", "success"}:
                _add(errors, "unified_build_failed", f"unified build status is {build_state.get('status')!r}")
        strict_run_scope = bool(active_run_id and build_state.get("skill_sha256")) if 'build_state' in locals() else False
        run_metric_path = (
            root / "reports" / "runs" / str(active_run_id) / "performance_stages" / "render.json"
            if active_run_id else root / "reports" / "performance_stages" / "render.json"
        )
        render_metric_path = (
            run_metric_path if strict_run_scope or run_metric_path.is_file()
            else root / "reports" / "performance_stages" / "render.json"
        )
        try:
            render_metric = json.loads(render_metric_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, TypeError):
            _add(errors, "missing_render_provenance", "reports/performance_stages/render.json is missing or invalid")
        else:
            if render_metric.get("status") != "success":
                _add(errors, "render_stage_failed", f"render stage status is {render_metric.get('status')!r}")
            if render_metric.get("mode") != "adaptive_batch_v1":
                _add(
                    errors, "non_release_render_mode",
                    "release QA requires the lossless adaptive-batch renderer",
                )
            if render_metric.get("run_id") != active_run_id:
                _add(
                    errors,
                    "render_run_mismatch",
                    "render stage run_id does not match the active unified build",
                )

    covered = {str(item) for page in pages for item in page.get("must_keep_ids", [])}
    for fact in brief.get("must_keep", []):
        fact_id = str(fact.get("id", ""))
        if fact_id and fact_id not in covered:
            _add(errors, "uncovered_must_keep", f"{fact_id}: {fact.get('claim', '')}")

    decisions = {
        str(item.get("id")): str(item.get("status") or "unknown")
        for item in brief.get("decision_ledger", []) if item.get("id")
    }
    artifacts = {
        str(item.get("artifact_id")): str(item.get("status") or "unknown")
        for item in brief.get("artifact_lineage", []) if item.get("artifact_id")
    }
    available_assets = {
        str(item.get("asset_id")): item
        for item in brief.get("available_assets", []) if item.get("asset_id")
    }
    contract_fonts = set(
        str(value) for value in
        ((((blueprint.get("theme") or {}).get("render_contract") or {}).get("fonts") or {}).values())
        if value
    )
    host_fonts = None if installed_fonts is None else frozenset(installed_fonts)

    image_uses = []
    asset_id_uses: list[tuple[str, int]] = []
    for page in pages:
        page_no = int(page.get("no", 0) or 0)
        text = _visible_page_text(page)
        # Visible blueprint copy is checked by the shared static contract above.
        # Reference authority is checked once by the shared static contract above.
        for image in page.get("images", []):
            src = str(image.get("src", ""))
            try:
                asset_path = resolve_asset_target(root / "assets", src)
            except ValueError:
                _add(errors, "unsafe_asset_path", f"asset src must stay inside assets/: {src}", page_no)
                continue
            if not asset_path.exists():
                _add(errors, "missing_asset", f"missing assets/{src or '<empty>'}", page_no)
            asset_id = str(image.get("asset_id") or "")
            if asset_id and image.get("role") not in {"background", "decorative"}:
                asset_id_uses.append((asset_id, page_no))
            asset = available_assets.get(asset_id, {})
            if asset.get("source_class") == "artifact":
                artifact_id = str(asset.get("artifact_id") or "")
                status = artifacts.get(artifact_id, "unknown")
                if status != "accepted":
                    _add(
                        errors, "forbidden_artifact_asset",
                        f"asset {asset_id} comes from artifact {artifact_id or '<unknown>'} with status {status}",
                        page_no,
                    )
            image_uses.append((src, image.get("role"), page_no))
    content_hashes = {}
    # Repeated asset instances are validated against model-authored IDs in the
    # shared blueprint contract and exact rendered instance counts below.
    for src, role, page_no in image_uses:
        if not src or role == "background":
            continue
        try:
            path = resolve_asset_target(root / "assets", src)
            if not path.is_file():
                continue
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
        except (OSError, ValueError):
            continue
        content_hashes[src] = digest
    from ppt_contract import asset_reuse_findings
    uses = [dict(image, page=page['no']) for page in pages for image in page.get('images', [])]
    for finding in asset_reuse_findings(uses, content_hashes):
        _add(errors, 'excessive_asset_id_reuse', json.dumps(finding, ensure_ascii=False))

    pages_by_no = {int(page.get("no", index)): page for index, page in enumerate(pages, 1)}
    for slide in slides:
        xml = slide.read_text(encoding="utf-8")
        if require_render_provenance:
            run_cache_path = (
                root / "reports" / "runs" / str(active_run_id) / "render_attempts" / f"{slide.stem}-cache.json"
                if active_run_id else root / "reports" / "render_attempts" / f"{slide.stem}-cache.json"
            )
            cache_path = (
                run_cache_path if strict_run_scope or run_cache_path.is_file()
                else root / "reports" / "render_attempts" / f"{slide.stem}-cache.json"
            )
            try:
                cache = json.loads(cache_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError, TypeError):
                _add(errors, "missing_render_cache", f"{slide.name}: validated render cache is missing")
            else:
                actual_hash = hashlib.sha256(xml.encode("utf-8")).hexdigest()
                if strict_run_scope and cache.get("run_id") != active_run_id:
                    _add(errors, "render_cache_run_mismatch", f"{slide.name}: cache is not from the active run")
                elif cache.get("run_id") not in {None, active_run_id}:
                    _add(errors, "render_cache_run_mismatch", f"{slide.name}: cache belongs to another run")
                if strict_run_scope and cache.get("validated") is not True:
                    _add(errors, "unvalidated_render_cache", f"{slide.name}: active-run cache is not marked validated")
                if strict_run_scope and cache.get("skill_sha256") != build_state.get("skill_sha256"):
                    _add(errors, "render_cache_skill_mismatch", f"{slide.name}: cache skill hash differs from the active build")
                if not cache.get("prompt_sha256") or cache.get("output_sha256") != actual_hash:
                    _add(
                        errors, "render_cache_mismatch",
                        f"{slide.name}: output changed after its validated render cache was written",
                    )
        strict = lint_xml(xml, str(slide), backend='local-pptx')
        strict_errors = list((strict.get("document") or {}).get("errors", []))
        strict_warnings = list((strict.get("document") or {}).get("warnings", []))
        for item in strict.get("slides", []):
            strict_errors.extend(item.get("errors", []))
            strict_warnings.extend(item.get("warnings", []))
        page_no_match = re.search(r"(\d+)", slide.stem)
        page_no = int(page_no_match.group(1)) if page_no_match else None
        for item in strict_errors:
            # Keep measurements/clearance/identity intact across the boundary.
            finding = dict(item, page=page_no, message=f"{slide.name}: {item.get('message', '')}",
                           validation_source='sml_lint', sml_sha256=hashlib.sha256(xml.encode('utf-8')).hexdigest())
            if finding not in errors:
                errors.append(finding)
        for item in strict_warnings:
            warning = dict(item, message=f"{slide.name}: {item.get('message', '')}",
                           validation_source='sml_lint', sml_sha256=hashlib.sha256(xml.encode('utf-8')).hexdigest())
            if page_no is not None:
                warning["page"] = page_no
            if warning not in warnings:
                warnings.append(warning)
        try:
            xml_root = ET.fromstring(xml)
        except ET.ParseError as exc:
            _add(errors, "invalid_slide_xml", f"{slide.name}: {exc}")
            continue
        texts = " ".join(node.text or "" for node in xml_root.iter() if node.tag.split("}")[-1] == "p")
        page = pages_by_no.get(page_no or -1, {})
        expected_sources = Counter(str(item.get("src") or "") for item in page.get("images", []))
        rendered_sources = Counter(
            str(node.attrib.get("src") or "")
            for node in xml_root.iter()
            if node.tag.split("}")[-1] == "img"
        )
        if rendered_sources != expected_sources:
            _add(
                errors,
                "rendered_asset_mismatch",
                f"{slide.name}: rendered={dict(rendered_sources)}, blueprint={dict(expected_sources)}",
                page_no,
            )
        for item in rendered_image_quality_errors(xml_root, page, page_no or 0, root / "assets", include_advisory=True):
            if item not in errors:
                errors.append(item)
        errors.extend(xml_copy_findings(xml_root, page_no, include_advisory=True))
        for item in rendered_text_quality_errors(xml_root, page, page_no or 0, include_advisory=True):
            if item not in errors:
                errors.append(item)
        errors.extend(typography_errors(
            xml_root, {"fonts": {str(i): f for i, f in enumerate(contract_fonts)}},
            page_no, require_fonts=require_render_provenance,
            min_body=min_body_font, min_caption=min_caption_font, installed=host_fonts, include_advisory=True,
        ))
    errors, advisories = partition(errors)
    warnings.extend(advisories)
    return {
        "summary": {
            "error_count": len(errors),
            "warning_count": len(warnings),
            "gate_passed": not errors,
            "release_ready": False,
            "release_stage": "preconversion_qa",
        },
        "errors": errors,
        "warnings": warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="run ppt-maker cross-layer quality gate")
    parser.add_argument("--project", default=".")
    parser.add_argument("--min-body-font", type=float, default=15)
    parser.add_argument("--min-caption-font", type=float, default=11)
    parser.add_argument(
        "--require-render-provenance", action="store_true",
        help="require a successful render stage and an exact validated cache for every slide",
    )
    args = parser.parse_args()
    root = Path(args.project).resolve()
    brief = json.loads((root / "reports/brief.json").read_text(encoding="utf-8"))
    blueprint = json.loads((root / "reports/blueprint.json").read_text(encoding="utf-8"))
    report = evaluate(
        root, brief, blueprint, args.min_body_font, args.min_caption_font,
        require_render_provenance=args.require_render_provenance,
    )
    build_state_path = root / "reports" / "build_state.json"
    try:
        build_state = json.loads(build_state_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        build_state = {}
    defect_map_path = None
    if build_state.get("run_id"):
        defect_map_path = sync_qa_defect_map(
            root, str(build_state["run_id"]), report.get("errors", []),
        )
    authoring_digest = hashlib.sha256()
    for slide in sorted((root / "authoring").glob("slide-*.xml")):
        authoring_digest.update(slide.name.encode("utf-8"))
        authoring_digest.update(b"\0")
        authoring_digest.update(slide.read_bytes())
        authoring_digest.update(b"\0")
    report["provenance"] = {
        "run_id": build_state.get("run_id"),
        "blueprint_sha256": hashlib.sha256((root / "reports/blueprint.json").read_bytes()).hexdigest(),
        "authoring_sha256": authoring_digest.hexdigest(),
        "defect_map_sha256": hashlib.sha256(defect_map_path.read_bytes()).hexdigest()
        if defect_map_path and defect_map_path.is_file() else None,
        "generated_at_unix": round(time.time(), 3),
    }
    qa_path = root / "reports" / "qa_gate.json"
    qa_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if build_state.get("run_id"):
        run_path = root / "reports" / "runs" / str(build_state["run_id"]) / "qa_gate.json"
        run_path.parent.mkdir(parents=True, exist_ok=True)
        run_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False))
    return 0 if report["summary"]["gate_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
