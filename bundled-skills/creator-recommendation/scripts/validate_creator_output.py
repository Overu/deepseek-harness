#!/usr/bin/env python3
"""Validate creator evidence, recommendation tiers, and platform coverage."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlsplit


FORBIDDEN_KEYS = {"cache_url", "xsec_token", "sign", "signature", "cookie", "cookies", "authorization"}
SENSITIVE_URL_KEYS = {"x-oss-signature", "x-oss-credential", "auth_key", "wssecret", "xsec_token", "sign", "signature", "token"}
FORMULAS = {"min_max_ratio": "min_views/max_views", "median_max_ratio": "median_views/max_views"}
COMMERCIAL_EVIDENCE_TYPES = {"observed_public", "authorized_actual"}
COMMERCIAL_RECORD_KINDS = {"platform_commercial_record", "authorized_cooperation_record", "explicit_paid_partnership"}
NON_EVENT_FIELDS = {"online_status", "start_time", "end_time", "price", "price_20_60", "price_60", "item_publish_time", "checked_at", "captured_at"}
NON_RECOMMENDATION_TIERS = {"淘汰/暂缓", "淘汰", "暂缓"}


def parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def walk(value: Any, path: str = "root") -> list[str]:
    errors: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            child = f"{path}.{key}"
            if str(key).lower() in FORBIDDEN_KEYS:
                errors.append(f"forbidden transient field: {child}")
            errors.extend(walk(item, child))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            errors.extend(walk(item, f"{path}[{index}]"))
    elif isinstance(value, str) and value.lower().startswith(("http://", "https://")):
        keys = {key.lower() for key, _ in parse_qsl(urlsplit(value).query)}
        if keys & SENSITIVE_URL_KEYS:
            errors.append(f"transient signed URL: {path}")
    return errors


def validate(payload: dict[str, Any]) -> list[str]:
    errors = walk(payload)
    creators = payload.get("creators") or []
    requested = set(payload.get("requested_platforms") or [])
    covered = {creator.get("platform") for creator in creators if creator.get("platform")}
    gaps = {gap.get("platform") for gap in (payload.get("platform_gaps") or []) if isinstance(gap, dict)}
    for platform in sorted(requested - covered - gaps):
        errors.append(f"requested platform lacks creator evidence or platform_gaps declaration: {platform}")

    objective = payload.get("objective")
    for index, creator in enumerate(creators):
        prefix = f"creators[{index}]"
        profile = creator.get("profile") or {}
        recent = creator.get("recent_posts") or {}
        capability = creator.get("commercial_capability") or {}
        audience = creator.get("audience") or {}
        if not creator.get("creator_key") or not creator.get("platform"):
            errors.append(f"{prefix}: creator_key and platform are required")
        if profile.get("followers") is None or not profile.get("followers_captured_at"):
            errors.append(f"{prefix}.profile requires followers and followers_captured_at")
        if not isinstance(recent.get("sample_size"), int) or recent.get("median_views") is None:
            errors.append(f"{prefix}.recent_posts requires sample_size and median_views")
        metric = recent.get("stability_metric") or {}
        name, formula = metric.get("name"), metric.get("formula")
        if name not in FORMULAS or FORMULAS.get(name) != formula:
            errors.append(f"{prefix}.recent_posts.stability_metric name/formula mismatch")

        tier = creator.get("tier")
        audience_available = audience.get("status") in {"verified", "modelled", "authorized"}
        audience_score = ((capability.get("dimensions") or {}).get("audience_fit") or {}).get("score")
        if tier == "优先邀约" and (not audience_available or audience_score is None):
            errors.append(f"{prefix}: audience evidence is required for 优先邀约")
        if tier == "素材复用优先" and not creator.get("asset_reuse_evidence"):
            errors.append(f"{prefix}.asset_reuse_evidence is required for 素材复用优先")

        if tier not in NON_RECOMMENDATION_TIERS:
            activity = creator.get("recent_commercial_activity") or {}
            latest = parse_timestamp(activity.get("latest_verified_commercial_at"))
            checked = parse_timestamp(activity.get("checked_at"))
            if activity.get("status") != "verified":
                errors.append(f"{prefix}.recent_commercial_activity requires verified status for recommendation")
            if latest is None or checked is None:
                errors.append(f"{prefix}.recent_commercial_activity requires latest_verified_commercial_at and checked_at")
            elif (checked.date() - latest.date()).days < 0:
                errors.append(f"{prefix}.recent_commercial_activity cannot be dated after checked_at")
            elif (checked.date() - latest.date()).days > 90:
                errors.append(f"{prefix}.recent_commercial_activity is over 90 days old and cannot be recommended")
            if activity.get("evidence_type") not in COMMERCIAL_EVIDENCE_TYPES:
                errors.append(f"{prefix}.recent_commercial_activity requires a verified commercial evidence type")
            if not activity.get("evidence_refs"):
                errors.append(f"{prefix}.recent_commercial_activity requires evidence_refs")
            records = activity.get("evidence") or []
            by_ref = {record.get("evidence_ref"): record for record in records if isinstance(record, dict)}
            dates = []
            for ref in activity.get("evidence_refs") or []:
                record = by_ref.get(ref)
                label = f"{prefix}.recent_commercial_activity.evidence[{ref}]"
                if not record:
                    errors.append(f"{label}: evidence_ref must resolve to a commercial record")
                    continue
                if record.get("creator_key") != creator.get("creator_key"):
                    errors.append(f"{label}: commercial record must match creator_key")
                if record.get("record_kind") not in COMMERCIAL_RECORD_KINDS:
                    errors.append(f"{label}: quote availability or ordinary posts are not commercial records")
                if record.get("evidence_type") not in COMMERCIAL_EVIDENCE_TYPES:
                    errors.append(f"{label}: estimates cannot prove a commercial event")
                field = record.get("source_field")
                if not isinstance(field, str) or field.rsplit(".", 1)[-1] in NON_EVENT_FIELDS:
                    errors.append(f"{label}: source_field must identify a commercial record or explicit partnership marker")
                if not record.get("source_ref") or not record.get("commercial_marker"):
                    errors.append(f"{label}: source_ref and explicit commercial_marker are required")
                event = parse_timestamp(record.get("commercial_at"))
                if event is None:
                    errors.append(f"{label}: commercial_at event date is required")
                else:
                    dates.append(event.date())
                    if checked and event.date() > checked.date():
                        errors.append(f"{label}: commercial event is after checked_at")
            if dates and latest and latest.date() != max(dates):
                errors.append(f"{prefix}.recent_commercial_activity: latest date must match the latest cited commercial event, not capture time")
            if latest and checked and 30 < (checked.date() - latest.date()).days <= 90 and not activity.get("selection_reason"):
                errors.append(f"{prefix}.recent_commercial_activity: 31-90 day candidate needs selection_reason")

        coverage = capability.get("commercial_evidence_coverage")
        score = capability.get("commercial_capability_score")
        dimensions = capability.get("dimensions") or {}
        if score is not None and (not isinstance(coverage, (int, float)) or coverage < 70):
            errors.append(f"{prefix}: commercial_capability_score requires >=70% evidence coverage")
        if objective == "精准人群" and ((dimensions.get("audience_fit") or {}).get("score") is None) and score is not None:
            errors.append(f"{prefix}: audience_fit missing, commercial score must be null")
        if objective == "转化" and ((dimensions.get("conversion") or {}).get("score") is None) and score is not None:
            errors.append(f"{prefix}: conversion missing, commercial score must be null")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    try:
        payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("root must be an object")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 2
    errors = validate(payload)
    if errors:
        print("INVALID:\n- " + "\n- ".join(errors), file=sys.stderr)
        return 1
    print("OK: creator output passed hardening checks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
