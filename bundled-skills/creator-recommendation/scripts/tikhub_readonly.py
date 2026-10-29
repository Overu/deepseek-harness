#!/usr/bin/env python3
"""Contract-driven read-only client with business checks and a task-local ledger."""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from enterprise_proxy import ProxyError, request as proxy_request

from tikhub_guard import sanitize_value, dotted_get


def parse_pairs(values: list[str]) -> dict:
    result = {}
    for value in values:
        if "=" not in value:
            raise ValueError("each --query must contain one key=value pair")
        key, raw = value.split("=", 1)
        if key in result:
            raise ValueError(f"duplicate query parameter: {key}")
        result[key] = raw
    return result


def prepare(endpoint: dict, values: list[str], body: dict) -> tuple[dict, dict]:
    query = parse_pairs(values)
    specs = endpoint.get("parameters", {})
    if not isinstance(body, dict):
        raise ValueError("--body-json must be a JSON object")
    for location, params in (("query", query), ("body", body)):
        for name, value in params.items():
            if name not in specs:
                raise ValueError(f"undeclared parameter: {name}")
            expected = specs[name].get("location", endpoint.get("parameter_transport", "query"))
            if location != expected:
                raise ValueError(f"{name} must be in {expected}")
            if isinstance(value, str) and any(f"&{key}=" in value for key in specs):
                raise ValueError("use separate --query key=value flags; do not join parameters with &")
            allowed = specs[name].get("allowed")
            if allowed and str(value) not in {str(item) for item in allowed}:
                raise ValueError(f"unsupported value for {name}")
    for name, spec in specs.items():
        if name not in query and name not in body and "default" in spec:
            (body if spec.get("location", endpoint.get("parameter_transport", "query")) == "body" else query)[name] = spec["default"]
    missing = [name for name in endpoint.get("required_parameters", []) if query.get(name) in (None, "") and body.get(name) in (None, "")]
    if missing:
        raise ValueError("missing required parameters: " + ", ".join(missing))
    return query, body


def get(value, path):
    try:
        return dotted_get(value, path)
    except KeyError:
        return None


def inspect_response(payload, endpoint: dict, http_status: int, raw: str = "") -> dict:
    """Return allowlisted diagnostic fields only; never echo server text or credentials."""
    result = {"http_status": http_status, "status": "ok", "business_code": None,
              "request_id": None, "billing_status": "unknown"}
    if isinstance(payload, dict):
        rid = payload.get("request_id") or get(payload, "detail.request_id")
        if isinstance(rid, str) and re.fullmatch(r"[\w-]{1,128}", rid):
            result["request_id"] = rid
    text = raw.lower()
    if "won't be charged" in text or "不会被扣费" in text or "不计费" in text:
        result["billing_status"] = "server_declared_not_charged"
    rules = endpoint.get("response_validation", {})
    for path in rules.get("error_code_fields", ["code", "detail.code", "data.base_resp.status_code"]):
        code = get(payload, path)
        if code is not None and str(code) not in {"0", "200"}:
            result.update(status="upstream_error", business_code=code if isinstance(code, (int, float)) else None)
            break
    if http_status >= 400:
        result["status"] = "upstream_error" if http_status in {400, 500, 502, 503, 504} else "http_error"
        if http_status == 403:
            if "cloudflare" in text or "error code: 1010" in text:
                result["status"] = "edge_blocked"
            elif any(marker in text for marker in ("invalid api key", "invalid token", "expired token", "api key expired")):
                result["status"] = "authentication_error"
            else:
                result["status"] = "forbidden_unknown"
        elif http_status == 401:
            result["status"] = "authentication_error"
        elif http_status == 422:
            result["status"] = "parameter_error"
        elif http_status == 429:
            result["status"] = "rate_limited"
        return result
    if result["status"] != "ok":
        return result
    if not isinstance(payload, dict) or payload.get("data") is None:
        result["status"] = "invalid_response"
    elif "result_path" in rules:
        value = get(payload, rules["result_path"])
        expected = rules.get("result_type")
        if value is None or (expected == "list" and not isinstance(value, list)):
            result["status"] = "invalid_response"
        elif value in ([], {}):
            result["status"] = "empty"
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contract", required=True)
    parser.add_argument("--path", required=True)
    parser.add_argument("--query", action="append", default=[])
    parser.add_argument("--body-json", default="{}")
    parser.add_argument("--output")
    parser.add_argument("--timeout", type=float, default=60)
    parser.add_argument("--max-cost-usd", type=float, help="declared per-call ceiling, not a cumulative budget")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-catalog", action="store_true", help="one documented health probe only")
    parser.add_argument("--ledger", help="task-local JSONL; defaults to output directory/_tikhub_calls.jsonl")
    parser.add_argument("--recheck-route", action="store_true", help="one deliberate probe after correcting a diagnosed route failure")
    args = parser.parse_args()
    try:
        contract = json.loads(Path(args.contract).read_text(encoding="utf-8"))
        endpoint = next((item for item in contract.get("endpoints", []) if item.get("path") == args.path), None)
        if endpoint is None:
            raise ValueError("path is not declared in contract")
        if endpoint.get("status") not in {"live", "fallback"} and not (args.allow_catalog and endpoint.get("status") == "catalog"):
            raise ValueError(f"endpoint status is not callable: {endpoint.get('status')}")
        query, body = prepare(endpoint, args.query, json.loads(args.body_json))
        price = float(endpoint.get("price_usd", 0))
        if args.max_cost_usd is not None and price > args.max_cost_usd:
            raise ValueError(f"declared call cost ${price:.4f} exceeds cap")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    method = endpoint["method"].upper()
    if args.dry_run:
        print(f"DRY RUN {method} {args.path}")
        print("query: " + ("&".join(f"{key}={value}" for key, value in query.items()) or "(none)"))
        print("body: " + json.dumps(body, ensure_ascii=False, sort_keys=True))
        print(f"declared_cost_usd: {price:.4f}")
        return 0
    if not args.output:
        print("ERROR: --output is required for a live gateway call", file=sys.stderr)
        return 2
    output = Path(args.output)
    ledger = Path(args.ledger) if args.ledger else output.parent / "_tikhub_calls.jsonl"
    if ledger.exists() and not args.recheck_route:
        try:
            entries = [json.loads(line) for line in ledger.read_text(encoding="utf-8").splitlines() if line.strip()]
            last = next((item for item in reversed(entries) if item.get("path") == args.path), {})
            if last.get("status") in {"upstream_error", "invalid_response", "transport_error", "rate_limited", "gateway_error"}:
                print("ERROR: route circuit open in task ledger; use a verified fallback or one --recheck-route diagnostic probe", file=sys.stderr)
                return 2
        except (ValueError, OSError):
            print("ERROR: cannot read task ledger", file=sys.stderr)
            return 2
    payload, raw, http_status = None, "", 0
    try:
        # No automatic retries: even an SSL read failure may follow a billed request.
        payload = proxy_request("tikhub", method, args.path, query=query,
                                body=body if method == "POST" else None, timeout=args.timeout)
        http_status = 200
        raw = json.dumps(payload, ensure_ascii=False)
        state = inspect_response(payload, endpoint, http_status, raw)
    except ProxyError as exc:
        # Gateway failures may follow a completed paid call. Preserve unknown billing
        # and stop this route; gateway HTTP status is not the vendor HTTP status.
        state = {"status": "gateway_error", "gateway_http_status": exc.status,
                 "http_status": None, "billing_status": "unknown"}
    except (TimeoutError, OSError):
        state = {"status": "transport_error", "http_status": http_status or None, "billing_status": "unknown"}
    except (ValueError, UnicodeError):
        state = {"status": "invalid_response", "http_status": http_status or None, "billing_status": "unknown"}
    state.update(path=args.path, checked_at=datetime.now(timezone.utc).isoformat(), declared_cost_usd=price,
                 response_saved=state["status"] in {"ok", "empty"})
    output.parent.mkdir(parents=True, exist_ok=True)
    if state["response_saved"]:
        output.write_text(json.dumps(sanitize_value(payload), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    Path(str(output) + ".status.json").write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    ledger.parent.mkdir(parents=True, exist_ok=True)
    with ledger.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(state, ensure_ascii=False) + "\n")
    print(json.dumps(state, ensure_ascii=False))
    return 0 if state["response_saved"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
