#!/usr/bin/env python3
"""Run xml_lint page by page and fail closed on empty or malformed output."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


DEFAULT_LINT = Path(__file__).resolve().parent.parent / "lark" / "scripts" / "xml_lint.py"


def run(root: Path, lint: Path) -> int:
    authoring = root / "authoring"
    reports = root / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    slides = sorted(authoring.glob("slide-*.xml"))
    blocking = []
    warnings = []
    raw_logs = []
    if not slides:
        blocking.append({"file": None, "code": "empty_authoring", "message": "authoring contains no slide XML files"})
    for slide in slides:
        result = subprocess.run([sys.executable, str(lint), "--input", str(slide), "--json"], capture_output=True, text=True, encoding='utf-8')
        raw_logs.append(f"=== {slide} ===\n{result.stdout}\nSTDERR:\n{result.stderr}\n")
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError:
            blocking.append({"file": slide.name, "code": "invalid_lint_output", "message": (result.stderr or result.stdout or "empty output")[:300]})
            continue
        document = payload.get("document") or {}
        for error in document.get("errors", []):
            blocking.append({"file": slide.name, "code": error.get("code", "lint_error"), "message": error.get("message", "")})
        for warning in document.get("warnings", []):
            warnings.append({"file": slide.name, "code": warning.get("code", "lint_warning"), "message": warning.get("message", "")})
        for item in payload.get("slides", []):
            for error in item.get("errors", []):
                blocking.append({"file": slide.name, "code": error.get("code", "lint_error"), "message": error.get("message", "")})
            for warning in item.get("warnings", []):
                warnings.append({"file": slide.name, "code": warning.get("code", "lint_warning"), "message": warning.get("message", "")})
        if result.returncode != 0 and not any(item["file"] == slide.name for item in blocking):
            blocking.append({"file": slide.name, "code": "lint_failed", "message": (result.stderr or "non-zero exit")[:300]})
    (reports / "xml_lint.log").write_text("\n".join(raw_logs), encoding="utf-8")
    summary = {"error_count": len(blocking), "warning_count": len(warnings), "errors": blocking, "warnings": warnings}
    (reports / "lint_report.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [f"## {item['file'] or 'deck'}\n- {item['code']}: {item['message']}" for item in blocking]
    (reports / "lint_errors_brief.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"slides: {len(slides)} errors: {len(blocking)} warnings: {len(warnings)}")
    return 1 if blocking else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="lint authoring SML")
    parser.add_argument("--project", default=".")
    parser.add_argument("--lint", default=str(DEFAULT_LINT))
    args = parser.parse_args()
    return run(Path(args.project).resolve(), Path(args.lint).resolve())


if __name__ == "__main__":
    raise SystemExit(main())
