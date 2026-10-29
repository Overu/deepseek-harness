#!/usr/bin/env python3
"""Single-request public-data collector via the enterprise API gateway."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import errno
import hashlib
import json
import os
import re
import sys
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

from enterprise_proxy import ProxyError, request as proxy_request

CATALOG = Path(__file__).resolve().parent.parent / "references/public-endpoints.json"
MAX_BYTES = 12 * 1024 * 1024
LOCK_RETRY_SECONDS = 0.1
DROP_KEYS = {
    "authorization", "cookie", "cookies", "token", "access_token", "refresh_token",
    "cache_url", "request_headers", "password", "sign", "signature", "xsec_token",
    "url_token", "urltoken", "decode_key", "decodekey", "full_url", "media",
    "play_addr", "download_addr", "playurl", "play_url", "downloadurl", "video_url", "media_url",
    "openid", "email", "mobile", "phone", "ip_region", "ip_wording",
    "ipregioninfo", "head_url", "headurl", "logo_url", "avatar", "avatar_url",
}
SIGNED_QUERY = {"token", "access_token", "sign", "signature", "xsec_token", "auth_key", "authkey",
                "wssecret", "wstime", "x-oss-signature", "x-oss-credential", "expires", "expire",
                "x-expires", "x-signature", "expiretime"}


class CollectorError(ValueError):
    pass


class BudgetExceeded(CollectorError):
    def __init__(self, budget, prior, spent, price, path):
        super().__init__("cumulative task budget would be exceeded")
        self.diagnostic = {
            "status": "budget_exhausted", "stage": "budget_check", "path": path,
            "data_request_attempted": False, "output_saved": False,
            "budget_usd": str(budget), "prior_spend_usd": str(prior),
            "cumulative_reserved_usd": str(spent), "reserved_usd": "0",
            "next_request_usd": str(price), "minimum_total_budget_usd": str(spent + price),
            "additional_usd_needed": str(spent + price - budget),
            "next_action": "request_user_budget_approval",
        }


def now():
    return datetime.now(timezone.utc).isoformat()


def money(value):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise CollectorError("invalid budget or price") from None
    if not result.is_finite() or result < 0:
        raise CollectorError("budget and price must be finite and nonnegative")
    return result


def sanitize(value, secret=""):
    if isinstance(value, dict):
        return {str(k): sanitize(v, secret) for k, v in value.items()
                if str(k).lower() not in DROP_KEYS}
    if isinstance(value, list):
        return [sanitize(v, secret) for v in value]
    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > 2**53 - 1:
        return str(value)
    if isinstance(value, str):
        value = value.replace(secret, "[redacted]") if secret else value
        if value.startswith(("http://", "https://")):
            try:
                parsed = urlsplit(value)
                if ({k.lower() for k, _ in parse_qsl(parsed.query)} & SIGNED_QUERY
                        or re.search(r"\.(mp4|m3u8|flv|mp3|aac|wav|webm)$", parsed.path, re.I)):
                    return None
            except ValueError:
                return None
        return value
    return value


def matches(value, spec):
    if "anyOf" in spec:
        if not any(matches(value, part) for part in spec["anyOf"]):
            return False
    else:
        types = {"string": isinstance(value, str), "integer": type(value) is int,
                 "boolean": type(value) is bool, "null": value is None,
                 "number": type(value) in (int, float)}
        if spec.get("type") in types and not types[spec["type"]]:
            return False
    if "enum" in spec and not any(type(value) is type(v) and value == v for v in spec["enum"]):
        return False
    if isinstance(value, str):
        if len(value) < spec.get("minLength", 0) or len(value) > spec.get("maxLength", 100000):
            return False
        if "pattern" in spec and re.search(spec["pattern"], value) is None:
            return False
    if type(value) in (int, float):
        if value < spec.get("minimum", -float("inf")) or value > spec.get("maximum", float("inf")):
            return False
    return True


def prepare(route, supplied):
    if not isinstance(supplied, dict):
        raise CollectorError("parameters must be a JSON object")
    specs = route["parameters"]
    if set(supplied) - set(specs):
        raise CollectorError("undeclared parameter")
    params = {k: s["default"] for k, s in specs.items() if "default" in s}
    params.update(supplied)
    if any(params.get(k) in (None, "") for k in route.get("required", [])):
        raise CollectorError("missing required parameter")
    for group in route.get("require_any", []):
        if not any(params.get(k) not in (None, "") for k in group):
            raise CollectorError("missing object ID or public share URL")
    for key, value in params.items():
        if not matches(value, specs[key]):
            raise CollectorError("invalid parameter type or allowed value: " + key)
    return params


def _check_integer_precision(value):
    """The Node gateway must supply large IDs as strings; reject rounded numbers."""
    if isinstance(value, dict):
        for item in value.values():
            _check_integer_precision(item)
    elif isinstance(value, list):
        for item in value:
            _check_integer_precision(item)
    elif type(value) in (int, float) and abs(value) > 2**53 - 1:
        raise CollectorError("gateway returned unsafe numeric values; large IDs must be strings")


def request_json(path, method="GET", params=None, timeout=45):
    if not path.startswith("/api/v1/") or "?" in path or "#" in path:
        raise CollectorError("invalid official API path")
    params = {k: v for k, v in (params or {}).items() if v is not None}
    if method not in {"GET", "POST"}:
        raise CollectorError("unsupported read-only method")
    payload = proxy_request("tikhub", method, path,
                            query=params if method == "GET" else {},
                            body=params if method == "POST" else None, timeout=timeout)
    if len(json.dumps(payload, ensure_ascii=False).encode("utf-8")) > MAX_BYTES:
        raise CollectorError("response exceeds text-data size limit")
    _check_integer_precision(payload)
    return 200, payload


def dotted(value, path):
    for key in path.split("."):
        if not isinstance(value, dict) or key not in value:
            return None
        value = value[key]
    return value


def comment_sample(contract, payload, min_valid_comments=None):
    """Count visible, nonblank, identified comments in this response only."""
    items = dotted(payload, contract["items_path"])
    result = {"items_path": contract["items_path"], "state": "invalid_structure",
              "returned_count": None, "valid_comment_count": None,
              "duplicate_count": None, "unusable_count": None,
              "min_valid_comments": min_valid_comments, "sample_status": "not_assessed",
              "assessment_scope": "current_response_only"}
    if not isinstance(items, list):
        return result
    seen, duplicates, unusable = set(), 0, 0
    for item in items:
        if not isinstance(item, dict) or item.get("hidden") is True or item.get("invalid") is True:
            unusable += 1
            continue
        identity = next((item.get(key) for key in contract["id_fields"]
                         if isinstance(item.get(key), str) and item[key].strip()), None)
        text = next((item.get(key) for key in contract["text_fields"]
                     if isinstance(item.get(key), str) and item[key].strip()), None)
        if identity is None or text is None:
            unusable += 1
        elif identity in seen:
            duplicates += 1
        else:
            seen.add(identity)
    result.update(state="valid_comments" if seen else ("empty_page" if not items else "no_usable_comments"),
                  returned_count=len(items), valid_comment_count=len(seen),
                  duplicate_count=duplicates, unusable_count=unusable)
    if min_valid_comments is not None:
        result["sample_status"] = "target_met" if len(seen) >= min_valid_comments else "insufficient"
    return result


def inspect_response(route, status, payload, min_valid_comments=None):
    result = {"http_status": status, "status": "business_ok_unreviewed",
              "business_code": None, "request_id": None}
    if isinstance(payload, dict):
        rid = payload.get("request_id")
        if isinstance(rid, str) and re.fullmatch(r"[\w-]{1,128}", rid):
            result["request_id"] = rid
    if not 200 <= status < 300:
        result["status"] = "forbidden_unknown" if status == 403 else "http_error"
        return result
    if not isinstance(payload, dict):
        result["status"] = "invalid_response"
        return result
    for field in route["business_code_paths"]:
        code = dotted(payload, field)
        if code is not None and str(code) not in {"0", "200"}:
            result["status"] = "business_error"
            result["business_code"] = code if type(code) in (int, float) else None
            return result
    contract = route.get("response_contract", {})
    for field in contract.get("success_paths", []):
        if dotted(payload, field) is False:
            result["status"] = "business_error"
            return result
    if contract.get("kind") == "comments":
        sample = comment_sample(contract, payload, min_valid_comments)
        result["comment_sample"] = sample
        if sample["state"] == "invalid_structure":
            result["status"] = "invalid_response"
        elif sample["state"] == "empty_page":
            result["status"] = "empty"
        return result
    if payload.get("data") is None:
        result["status"] = "invalid_response"
    elif payload["data"] in ([], {}):
        result["status"] = "empty"
    return result


@contextmanager
def ledger_lock(stream):
    """Serialize the existing task ledger using the host's native process lock."""
    if sys.platform == "win32":
        import msvcrt
        # Windows permits locking past EOF; keep empty JSONL files free of sentinel bytes.
        stream.seek(0)
        while True:
            try:
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                break
            except OSError as exc:
                if exc.errno not in {errno.EACCES, errno.EAGAIN}:
                    raise
                # A request can outlast LK_LOCK's built-in ten-second retry window.
                time.sleep(LOCK_RETRY_SECONDS)
        try:
            yield
        finally:
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def read_ledger(stream):
    stream.seek(0)
    try:
        rows = [json.loads(line) for line in stream if line.strip()]
        if any(not isinstance(r, dict) or r.get("kind") not in {"reserve", "result", "diagnostic", "budget_update"} for r in rows):
            raise ValueError()
        reservations = [r for r in rows if r["kind"] == "reserve"]
        if len({r["call_id"] for r in reservations}) != len(reservations):
            raise ValueError()
        for row in reservations:
            money(row["budget_usd"])
            money(row["prior_spend_usd"])
            money(row["reserved_usd"])
            if not row.get("path"):
                raise ValueError()
        budget_state(rows)
    except (ValueError, KeyError, TypeError):
        raise CollectorError("invalid task ledger; do not reset spent budget") from None
    return rows


def append_row(stream, row):
    stream.seek(0, 2)
    stream.write(json.dumps(row, ensure_ascii=False) + "\n")
    stream.flush()
    os.fsync(stream.fileno())


def budget_state(rows):
    """Replay append-only approvals without rewriting historical reservations."""
    budget, prior, approval_refs = None, None, set()
    for row in rows:
        if row["kind"] == "reserve" or (row["kind"] == "diagnostic" and row.get("stage") == "budget_check"):
            limit, prior_spend = money(row["budget_usd"]), money(row["prior_spend_usd"])
            if budget is None:
                budget, prior = limit, prior_spend
            if limit != budget or prior_spend != prior:
                raise CollectorError("task budget differs from existing ledger")
        elif row["kind"] == "budget_update":
            previous, limit = money(row["previous_budget_usd"]), money(row["budget_usd"])
            prior_spend, ref = money(row["prior_spend_usd"]), row["approval_ref"]
            if (not isinstance(ref, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", ref)
                    or ref in approval_refs or not isinstance(row["approved_at"], str) or not row["approved_at"]
                    or limit <= previous or (budget is not None and (previous != budget or prior_spend != prior))):
                raise CollectorError("invalid task budget approval history")
            budget, prior = limit, prior_spend
            approval_refs.add(ref)
    return budget, prior


def resolve_budget(rows, budget=None, prior=None):
    recorded_budget, recorded_prior = budget_state(rows)
    budget = money(budget) if budget is not None else (recorded_budget if recorded_budget is not None else Decimal(1))
    prior = money(prior) if prior is not None else (recorded_prior if recorded_prior is not None else Decimal(0))
    if recorded_budget is not None and (budget != recorded_budget or prior != recorded_prior):
        raise CollectorError("task budget differs from existing ledger")
    return budget, prior


def approve_budget(stream, rows, budget, prior, approved_budget, approval_ref):
    """Caller supplies the new total and a reference only after explicit user consent."""
    if approved_budget is None and approval_ref is None:
        return budget
    if (approved_budget is None or not isinstance(approval_ref, str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", approval_ref)):
        raise CollectorError("budget approval requires a new total and an approval reference")
    limit = money(approved_budget)
    existing = next((r for r in rows if r["kind"] == "budget_update" and r["approval_ref"] == approval_ref), None)
    if existing is not None:
        if money(existing["budget_usd"]) == limit == budget:
            return budget
        raise CollectorError("approval reference already used for another budget")
    if limit <= budget:
        raise CollectorError("approved budget must increase the current task total")
    row = {"kind": "budget_update", "previous_budget_usd": str(budget), "budget_usd": str(limit),
           "prior_spend_usd": str(prior), "approval_ref": approval_ref, "approved_at": now()}
    append_row(stream, row)
    rows.append(row)
    return limit


def check_budget(rows, budget, prior, price, path, recheck=False):
    budget, prior = resolve_budget(rows, budget, prior)
    reservations = [r for r in rows if r["kind"] == "reserve"]
    spent = prior + sum((money(r["reserved_usd"]) for r in reservations), Decimal(0))
    if spent + price > budget:
        raise BudgetExceeded(budget, prior, spent, price, path)
    route_calls = [r for r in reservations if r["path"] == path]
    if route_calls:
        last = route_calls[-1]
        result = next((r for r in reversed(rows) if r["kind"] == "result"
                       and r.get("call_id") == last["call_id"]), None)
        failed = result is None or result.get("status") not in {"business_ok_unreviewed", "empty"}
        if failed and (not recheck or any(r.get("recheck") for r in route_calls)):
            raise CollectorError("route stopped after failure; one diagnosed --recheck is allowed")
    return spent


def failure_diagnostic(error, stage, path):
    """Allowlisted machine diagnostics; never include upstream text or error bodies."""
    result = {"stage": stage, "path": path, "output_saved": False}
    if isinstance(error, ProxyError):
        code = error.code if isinstance(error.code, str) and re.fullmatch(r"[A-Z][A-Z0-9_]{0,127}", error.code) else "PROXY_ERROR"
        result.update(status="gateway_error", gateway_code=code,
                      gateway_http_status=error.status, http_status=None)
    else:
        result.update(status="transport_or_storage_error", error_code="COLLECTION_FAILED")
    return result


def collect(route, params, output, ledger, budget=None, prior=None, timeout=45, recheck=False,
            min_valid_comments=None, approved_budget=None, approval_ref=None):
    if output.exists():
        raise CollectorError("output already exists; preserve prior snapshots")
    price = money(route.get("price_usd"))
    price_info = {"price_basis": "builtin_catalog", "price_checked_at": route.get("price_checked_at")}
    output.parent.mkdir(parents=True, exist_ok=True)
    ledger.parent.mkdir(parents=True, exist_ok=True)
    # Hold the same task ledger lock through reservation and completion to share one budget.
    with ledger.open("a+", encoding="utf-8") as stream, ledger_lock(stream):
        rows = read_ledger(stream)
        budget, prior = resolve_budget(rows, budget, prior)
        budget = approve_budget(stream, rows, budget, prior, approved_budget, approval_ref)
        # Use the bundled unit price; pricing-route availability is not a data prerequisite.
        try:
            spent = check_budget(rows, budget, prior, price, route["path"], recheck)
        except BudgetExceeded as exc:
            append_row(stream, dict(exc.diagnostic, kind="diagnostic", finished_at=now()))
            raise
        call_id = uuid.uuid4().hex
        append_row(stream, {"kind": "reserve", "call_id": call_id, "path": route["path"],
                           "reserved_at": now(), "budget_usd": str(budget),
                           "prior_spend_usd": str(prior), "reserved_usd": str(price),
                           **price_info,
                           "recheck": recheck,
                           "params_sha256": hashlib.sha256(json.dumps(params, sort_keys=True,
                               ensure_ascii=False).encode()).hexdigest()})
        stage = "data_request"
        try:
            status, payload = request_json(route["path"], route["method"], params, timeout=timeout)
            stage = "response_validation"
            result = inspect_response(route, status, payload, min_valid_comments)
            result["stage"] = stage
            if result["status"] in {"business_ok_unreviewed", "empty"}:
                stage = "output_write"
                with output.open("x", encoding="utf-8") as saved:
                    json.dump(sanitize(payload), saved, ensure_ascii=False, indent=2)
                    saved.write("\n")
                result["output_saved"] = True
                result["stage"] = "completed"
            else:
                result["output_saved"] = False
        except (ProxyError, TimeoutError, OSError, CollectorError) as exc:
            result = failure_diagnostic(exc, stage, route["path"])
        result.update(kind="result", call_id=call_id, path=route["path"], finished_at=now(),
                      data_request_attempted=True,
                      current_actual_usd=None, reserved_usd=str(price),
                      cumulative_reserved_usd=str(spent + price), budget_usd=str(budget),
                      remaining_budget_usd=str(budget - spent - price), **price_info)
        append_row(stream, result)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", required=True, help="exact path from bundled endpoint catalog")
    parser.add_argument("--params", help="JSON parameter file; credentials are never accepted here")
    parser.add_argument("--execute", action="store_true", help="make one budgeted request; default is dry-run")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--ledger", type=Path)
    parser.add_argument("--budget-usd", help="initial task budget; later calls inherit the ledger (default: 1)")
    parser.add_argument("--prior-spend-usd", help="prior spend outside this ledger; later calls inherit it (default: 0)")
    parser.add_argument("--approve-budget-usd", help="user-approved NEW TOTAL, not an incremental amount")
    parser.add_argument("--approval-ref", help="reference to explicit user consent; required for a budget increase")
    parser.add_argument("--timeout", type=int, default=45, choices=range(30, 61), metavar="30..60")
    parser.add_argument("--recheck", action="store_true", help="one diagnostic request after a diagnosed failure")
    parser.add_argument("--min-valid-comments", type=int,
                        help="explicit per-response comment target; not an overall evidence-adequacy claim")
    args = parser.parse_args(argv)
    try:
        if ((args.approve_budget_usd is None) != (args.approval_ref is None)
                or (args.approve_budget_usd is not None and not args.execute)):
            raise CollectorError("budget approval requires --execute, --approve-budget-usd and --approval-ref")
        catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
        route = next((r for r in catalog["endpoints"] if r["path"] == args.path), None)
        if route is None or route["status"] not in {"docs_confirmed", "historical_success"}:
            raise CollectorError("path is not in the public read-only catalog")
        supplied = json.loads(Path(args.params).read_text(encoding="utf-8")) if args.params else {}
        params = prepare(route, supplied)
        if args.min_valid_comments is not None and (args.min_valid_comments < 1 or
                route.get("response_contract", {}).get("kind") != "comments"):
            raise CollectorError("positive --min-valid-comments requires a comment response contract")
        if not args.execute:
            rows = []
            if args.ledger is not None and args.ledger.exists():
                with args.ledger.open(encoding="utf-8") as stream:
                    rows = read_ledger(stream)
            budget, _ = resolve_budget(rows, args.budget_usd, args.prior_spend_usd)
            print(json.dumps({"mode": "dry_run", "path": route["path"], "method": route["method"],
                              "parameter_names": sorted(params), "catalog_price_usd": route["price_usd"],
                              "price_basis": "builtin_catalog", "price_checked_at": route.get("price_checked_at"),
                              "budget_usd": str(budget),
                              "live_verified": False}, ensure_ascii=False))
            return 0
        if args.output is None or args.ledger is None:
            raise CollectorError("execute requires output and shared task ledger")
        if args.output.resolve() == args.ledger.resolve():
            raise CollectorError("output and ledger must be different files")
        result = collect(route, params, args.output, args.ledger, args.budget_usd,
                         args.prior_spend_usd, args.timeout, args.recheck, args.min_valid_comments,
                         args.approve_budget_usd, args.approval_ref)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["output_saved"] else 1
    except BudgetExceeded as exc:
        print(json.dumps(exc.diagnostic, ensure_ascii=False))
        return 2
    except (CollectorError, OSError, ValueError, KeyError, ProxyError, TimeoutError):
        # Do not echo file content, parameters, upstream messages or credentials.
        error = sys.exc_info()[1]
        print(json.dumps({"error": str(error) if isinstance(error, CollectorError)
                          else "invalid local input or collector configuration"}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
