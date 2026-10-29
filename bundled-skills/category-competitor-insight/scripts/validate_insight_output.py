#!/usr/bin/env python3
"""Validate sampling, platform coverage, evidence hygiene, and downstream handoff."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlsplit


FORBIDDEN_KEYS = {"cache_url", "xsec_token", "sign", "signature", "cookie", "cookies", "authorization"}
SENSITIVE_URL_KEYS = {"x-oss-signature", "x-oss-credential", "auth_key", "wssecret", "xsec_token", "sign", "signature", "token"}


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
    requested = set(payload.get("requested_platforms") or [])
    queries = payload.get("queries") or []
    covered = {query.get("platform") for query in queries if query.get("platform")}
    gaps = {gap.get("platform") for gap in (payload.get("platform_gaps") or []) if isinstance(gap, dict)}
    for platform in sorted(requested - covered - gaps):
        errors.append(f"requested platform lacks query evidence or platform_gaps declaration: {platform}")

    for index, query in enumerate(queries):
        pages = query.get("pages_collected")
        saturated = query.get("saturation_reached") is True
        rates = query.get("new_unique_rates") or []
        valid_saturation = saturated and len(rates) >= 2 and all(
            isinstance(rate, (int, float)) and rate < 0.1 for rate in rates[-2:]
        )
        if not isinstance(pages, int) or (pages < 3 and not valid_saturation):
            errors.append(
                f"queries[{index}].pages_collected must be >=3, or saturation_reached with two rates <0.1"
            )

    excluded = set(payload.get("excluded_evidence_ids") or [])
    for opportunity in payload.get("opportunities") or []:
        reused = excluded & set(opportunity.get("evidence_refs") or [])
        for evidence_id in sorted(reused):
            errors.append(f"excluded evidence reused by opportunity: {evidence_id}")

    handoff = payload.get("insight_handoff")
    if not isinstance(handoff, dict) or not handoff.get("handoff_id") or not handoff.get("opportunity_inputs"):
        errors.append("insight_handoff with handoff_id and opportunity_inputs is required")
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
    print("OK: insight output passed hardening checks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
