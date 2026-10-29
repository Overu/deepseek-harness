#!/usr/bin/env python3
"""Sanitize TikHub responses and run a two-object semantic canary."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlsplit


FORBIDDEN_KEYS = {"token", "access_token", "refresh_token", "api_key", "apikey", "authorization", "cache_url", "cookie", "cookies", "headers", "request_headers", "set_cookie", "set-cookie", "sign", "signature", "xsec_token"}
SENSITIVE_QUERY_KEYS = {"auth_key", "signature", "sign", "token", "wssecret", "x-oss-credential", "x-oss-signature", "xsec_token"}


def _is_transient_url(value: str) -> bool:
    if not value.lower().startswith(("http://", "https://")):
        return False
    try:
        keys = {key.lower() for key, _ in parse_qsl(urlsplit(value).query)}
    except ValueError:
        return True
    return bool(keys & SENSITIVE_QUERY_KEYS)


def sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        clean: dict[str, Any] = {}
        for key, item in value.items():
            if str(key).lower() in FORBIDDEN_KEYS:
                continue
            clean[str(key)] = None if isinstance(item, str) and _is_transient_url(item) else sanitize_value(item)
        return clean
    if isinstance(value, list):
        return [sanitize_value(item) for item in value]
    if isinstance(value, str) and _is_transient_url(value):
        return None
    return value


def dotted_get(value: Any, path: str) -> Any:
    current = value
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            raise KeyError(path)
        current = current[part]
    return current


def sanitize_command(args: argparse.Namespace) -> int:
    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    Path(args.output).write_text(json.dumps(sanitize_value(payload), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"sanitized: {args.output}")
    return 0


def canary_command(args: argparse.Namespace) -> int:
    left = sanitize_value(json.loads(Path(args.left).read_text(encoding="utf-8")))
    right = sanitize_value(json.loads(Path(args.right).read_text(encoding="utf-8")))
    try:
        left_core = dotted_get(left, args.core_field)
        right_core = dotted_get(right, args.core_field)
    except KeyError:
        print(f"INVALID: missing core field {args.core_field}", file=sys.stderr)
        return 1
    if left_core in (None, "", [], {}) or right_core in (None, "", [], {}):
        print(f"INVALID: empty core field {args.core_field}", file=sys.stderr)
        return 1
    left_data = left.get("data", left) if isinstance(left, dict) else left
    right_data = right.get("data", right) if isinstance(right, dict) else right
    if left_data == right_data:
        print("INVALID: identical payloads for different objects; route semantics invalid", file=sys.stderr)
        return 1
    print("OK: two-object semantic canary passed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sanitize = sub.add_parser("sanitize")
    sanitize.add_argument("--input", required=True)
    sanitize.add_argument("--output", required=True)
    sanitize.set_defaults(func=sanitize_command)
    canary = sub.add_parser("canary")
    canary.add_argument("--left", required=True)
    canary.add_argument("--right", required=True)
    canary.add_argument("--core-field", required=True)
    canary.set_defaults(func=canary_command)
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
