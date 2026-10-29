#!/usr/bin/env python3
"""Contract-driven read-only TikHub client using the logged-in enterprise proxy."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from enterprise_proxy import ProxyError, request as proxy_request
from tikhub_guard import sanitize_value


def parse_pairs(values: list[str]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for value in values:
        if "=" not in value:
            raise ValueError(f"query parameter must be key=value: {value}")
        key, raw = value.split("=", 1)
        result[key] = raw
    return result


def load_endpoint(contract_path: str, path: str) -> tuple[dict[str, Any], dict[str, Any]]:
    contract = json.loads(Path(contract_path).read_text(encoding="utf-8"))
    for endpoint in contract.get("endpoints", []):
        if endpoint.get("path") == path:
            return contract, endpoint
    raise ValueError(f"path is not declared in contract: {path}")


def apply_defaults(endpoint: dict[str, Any], query: dict[str, Any], body: dict[str, Any]) -> None:
    default_transport = endpoint.get("parameter_transport", "query")
    for name, spec in endpoint.get("parameters", {}).items():
        if name in query or name in body or "default" not in spec:
            continue
        location = spec.get("location", default_transport)
        (body if location == "body" else query)[name] = spec["default"]


def validate_required(endpoint: dict[str, Any], query: dict[str, Any], body: dict[str, Any]) -> None:
    missing = [
        name
        for name in endpoint.get("required_parameters", [])
        if query.get(name) in (None, "") and body.get(name) in (None, "")
    ]
    if missing:
        raise ValueError("missing required parameters: " + ", ".join(missing))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contract", required=True)
    parser.add_argument("--path", required=True)
    parser.add_argument("--query", action="append", default=[])
    parser.add_argument("--body-json", default="{}")
    parser.add_argument("--output")
    parser.add_argument("--timeout", type=float, default=60)
    parser.add_argument("--max-cost-usd", type=float)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        contract, endpoint = load_endpoint(args.contract, args.path)
        if endpoint.get("status") not in {"live", "fallback"}:
            raise ValueError(f"endpoint status is not callable: {endpoint.get('status')}")
        query = parse_pairs(args.query)
        body = json.loads(args.body_json)
        if not isinstance(body, dict):
            raise ValueError("--body-json must be a JSON object")
        apply_defaults(endpoint, query, body)
        validate_required(endpoint, query, body)
        price = float(endpoint.get("price_usd", 0))
        if args.max_cost_usd is not None and price > args.max_cost_usd:
            raise ValueError(f"declared call cost ${price:.4f} exceeds cap")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    method = endpoint["method"].upper()
    if args.dry_run:
        print(f"DRY RUN {method} {args.path}")
        print("query: " + ("&".join(f"{k}={v}" for k, v in query.items()) or "(none)"))
        print("body: " + json.dumps(body, ensure_ascii=False, sort_keys=True))
        print(f"declared_cost_usd: {price:.4f}")
        return 0

    if not args.output:
        print("ERROR: --output is required for a live call", file=sys.stderr)
        return 2
    try:
        payload = proxy_request(
            "tikhub", method, args.path,
            query=query, body=body if method == "POST" else None,
            timeout=args.timeout,
        )
    except ProxyError as exc:
        print(f"ERROR: enterprise proxy request failed: {exc}", file=sys.stderr)
        return 1
    if isinstance(payload, dict) and payload.get("code") not in (None, 0, 200):
        print(f"ERROR: business code {payload.get('code')}", file=sys.stderr)
        return 1

    cleaned = sanitize_value(payload)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"OK: sanitized response written to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
