#!/usr/bin/env python3
"""Publish a named PPTX from strict success or an explicit working-deck manifest."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from sol_build import publish_release


def main() -> int:
    parser = argparse.ArgumentParser(description="publish an approved PPTX atomically")
    parser.add_argument("--project", default=".")
    parser.add_argument("--output", required=True, help="approved build output")
    parser.add_argument("--destination", required=True, help="named deliverable path")
    args = parser.parse_args()
    project = Path(args.project).resolve()
    receipt = publish_release(
        project,
        Path(args.output).resolve(),
        Path(args.destination).resolve(),
    )
    print(json.dumps({
        "published": True,
        "receipt": str(receipt),
        "status": json.loads(receipt.read_text(encoding='utf-8')).get('status'),
        "issues_path": str(project/'reports/delivery_issues.md')
            if json.loads(receipt.read_text(encoding='utf-8')).get('status')=='needs_attention' else None,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
