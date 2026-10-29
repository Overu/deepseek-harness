#!/usr/bin/env python3
"""export_share.py 的离线单元测试（零成本、不联网）。

守护：导出的是**单文件、零依赖** HTML，且图形元素数量与计划一致。
"""
from __future__ import annotations
import json, re, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "export_share.py"
PLAN = ROOT / "examples" / "ecommerce-poster-fanout.plan.json"


def main() -> int:
    checks = []
    def expect(name, cond, detail=""):
        checks.append((name, cond, detail))

    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "share.html"
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), str(PLAN), "--canvas-id", "103460",
             "--name", "示例工作流", "--out", str(out)],
            capture_output=True, text=True)
        expect("导出成功", proc.returncode == 0 and out.exists(), proc.stderr[-200:])
        doc = out.read_text(encoding="utf-8")
        expect("节点框数量与计划一致", len(re.findall(r"<rect ", doc)) == len(plan["nodes"]),
               f'{len(re.findall(r"<rect ", doc))} vs {len(plan["nodes"])}')
        expect("连线数量与计划一致", len(re.findall(r"<line ", doc)) == len(plan["edges"]),
               f'{len(re.findall(r"<line ", doc))} vs {len(plan["edges"])}')
        expect("零外部依赖（无 CDN 引用）",
               not re.search(r'(src|href)="https?://', doc), "存在外链资源")
        expect("标题与画布地址已写入", "示例工作流" in doc and "dsh-resource://canvas/103460" in doc)
        expect("单文件（体积合理 < 200KB）", out.stat().st_size < 200_000, str(out.stat().st_size))

    failed = [c for c in checks if not c[1]]
    for name, ok, detail in checks:
        print(f"{'✅' if ok else '❌'} {name}" + (f"  ← {detail}" if not ok and detail else ""))
    print(f"\n{len(checks) - len(failed)}/{len(checks)} 通过")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
