#!/usr/bin/env python3
"""Run-scoped defect aggregation for adaptive rendering and repair."""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

from stage_runtime import atomic_write_json
from quality_policy import classify


STRUCTURAL_CODES = frozenset({
    "invalid_slide_root", "invalid_model_xml", "missing_slide", "missing_data",
    "wrong_reading_order", "unsafe_asset_change", "text_content_changed",
    "page_structure_invalid", "blueprint_hash_mismatch",
})
PATCHABLE_CODES = frozenset({
    "bbox_overlap", "text_overlap", "text_box_overlap", "text_may_overflow_shape",
    "text_overflows_container", "whiteboard_external_overlap", "image_covers_text",
    "image_may_cover_vertical_text", "table_covers_text", "chart_covers_text",
    "title_orphan_line", "footer_zone_intrusion", "ghost_number_too_large",
    "ghost_number_overlaps_text", "asset_role_geometry_mismatch",
    "contain_image_will_crop", "missing_font_family", "invalid_font_family",
    "font_not_installed", "font_contract_mismatch", "font_missing_cjk_coverage",
    "font_too_small", "icon_transparent_fill_color",
})


@dataclass(frozen=True)
class Defect:
    page_no: int
    stage: str
    severity: str
    code: str
    message: str
    evidence_hash: str
    object_id: str | None = None
    suggested_action: str | None = None


def _path(project: Path, run_id: str) -> Path:
    return project / "reports" / "runs" / run_id / "defect_map.json"


def classify_action(defect: dict) -> str:
    """Choose only the safety lane, never concrete design changes."""
    if classify(defect)['severity'] != 'blocking':
        return 'report_only'
    if defect.get('code') in {'asset_consumer_error', 'validator_internal_error', 'source_receipt_invalid'}:
        return 'block'
    if str(defect.get('code') or '') in {'unknown_artifact_reference', 'forbidden_artifact_reference',
            'unknown_decision_reference', 'forbidden_historical_decision', 'unknown_asset_reference',
            'missing_artifact_reference', 'plan_text_budget', 'excessive_asset_reuse',
            'adjacent_layout_repetition', 'uncovered_must_keep', 'invalid_blueprint_structure', 'plan_ghost_number_too_large'}:
        return 'plan_repair'
    explicit = str(defect.get("suggested_action") or "").strip()
    if explicit in {"patch", "full_rerender", "block"}:
        return explicit
    code = str(defect.get("code") or "")
    if code in PATCHABLE_CODES or code.endswith("_out_of_canvas"):
        return "patch"
    return "full_rerender"


def _defect_id(defect: dict) -> str:
    identity = {
        "page_no": int(defect.get("page_no") or defect.get("page") or 0),
        "stage": str(defect.get("stage") or "unknown"),
        "code": str(defect.get("code") or "unknown"),
        "object_id": defect.get("object_id"),
        "evidence_hash": str(defect.get("evidence_hash") or ""),
    }
    encoded = json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "D-" + hashlib.sha256(encoded).hexdigest()[:16]


def merge_defects(project: Path, run_id: str, defects: Iterable[dict | Defect]) -> Path:
    """Idempotently merge findings into the current run's defect map."""
    path = _path(project, run_id)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        payload = {"version": 1, "run_id": run_id, "defects": []}
    if payload.get("run_id") != run_id:
        raise ValueError("defect map run_id mismatch")
    by_id = {str(item.get("defect_id")): item for item in payload.get("defects", [])}
    now = round(time.time(), 3)
    for raw in defects:
        item = classify(asdict(raw) if isinstance(raw, Defect) else dict(raw))
        item["page_no"] = int(item.get("page_no") or item.pop("page", 0) or 0)
        item.setdefault("stage", "unknown")
        item.setdefault("severity", "blocking")
        item.setdefault("code", "unknown")
        item.setdefault("message", item["code"])
        if not item.get("evidence_hash"):
            evidence = json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            item["evidence_hash"] = hashlib.sha256(evidence.encode("utf-8")).hexdigest()
        item["suggested_action"] = classify_action(item)
        item["defect_id"] = _defect_id(item)
        item.setdefault("status", "open")
        item.setdefault("first_seen_at_unix", now)
        item["last_seen_at_unix"] = now
        previous = by_id.get(item["defect_id"])
        if previous:
            item["first_seen_at_unix"] = previous.get("first_seen_at_unix", now)
        by_id[item["defect_id"]] = item
    payload["defects"] = sorted(
        by_id.values(), key=lambda item: (int(item.get("page_no") or 0), str(item.get("defect_id"))),
    )
    payload["updated_at_unix"] = now
    atomic_write_json(path, payload)
    return path


def load_open_defects(project: Path, run_id: str) -> list[dict]:
    path = _path(project, run_id)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return []
    if payload.get("run_id") != run_id:
        raise ValueError("defect map run_id mismatch")
    return [classify(item) for item in payload.get("defects", [])
            if item.get("status") == "open" and classify(item)['severity'] == 'blocking']


def resolve_defects(project: Path, run_id: str, defect_ids: Iterable[str]) -> Path:
    path = _path(project, run_id)
    payload = json.loads(path.read_text(encoding="utf-8"))
    targets = set(defect_ids)
    now = round(time.time(), 3)
    for item in payload.get("defects", []):
        if item.get("defect_id") in targets:
            item["status"] = "resolved"
            item["resolved_at_unix"] = now
    payload["updated_at_unix"] = now
    atomic_write_json(path, payload)
    return path


def sync_stage_defects(
    project: Path, run_id: str, stage: str, defects: Iterable[dict | Defect],
) -> Path:
    """Replace the open finding set for one deterministic QA stage."""
    prepared: list[dict] = []
    for raw in defects:
        item = asdict(raw) if isinstance(raw, Defect) else dict(raw)
        item["stage"] = stage
        item["page_no"] = int(item.get("page_no") or item.pop("page", 0) or 0)
        item.setdefault("severity", "blocking")
        item.setdefault("code", "unknown")
        item.setdefault("message", item["code"])
        if not item.get("evidence_hash"):
            evidence = json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            item["evidence_hash"] = hashlib.sha256(evidence.encode("utf-8")).hexdigest()
        prepared.append(item)
    current_ids = {_defect_id(item) for item in prepared}
    path = _path(project, run_id)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        payload = {"version": 1, "run_id": run_id, "defects": []}
    now = round(time.time(), 3)
    for item in payload.get("defects", []):
        if (
            item.get("stage") == stage and item.get("status") == "open"
            and item.get("defect_id") not in current_ids
        ):
            item["status"] = "resolved"
            item["resolved_at_unix"] = now
    payload["updated_at_unix"] = now
    atomic_write_json(path, payload)
    return merge_defects(project, run_id, prepared)
