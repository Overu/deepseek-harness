#!/usr/bin/env python3
"""verify_canvas.py 的离线单元测试（零成本、不联网）。

运行：
    python3 tests/test_verify_canvas.py

用 examples/ecommerce-poster-7node.plan.json 与 examples/canvas-graph.sample.json
作为一对"计划 ↔ 真实画布图"的基准，然后逐个注入偏差，断言脚本能抓到。
"""

from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLAN = ROOT / "examples" / "ecommerce-poster-fanout.plan.json"
GRAPH = ROOT / "examples" / "canvas-graph.sample.json"
SCRIPT = ROOT / "scripts" / "verify_canvas.py"


def run(plan: dict, graph: dict) -> tuple[int, dict]:
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "plan.json"
        g = Path(td) / "graph.json"
        p.write_text(json.dumps(plan, ensure_ascii=False), encoding="utf-8")
        g.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), str(p), str(g), "--json"],
            capture_output=True, text=True,
        )
        return proc.returncode, json.loads(proc.stdout)


def main() -> int:
    import importlib.util as _ilu  # noqa: F401  (保持与其它测试一致的导入风格)

    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    graph = json.loads(GRAPH.read_text(encoding="utf-8"))
    checks: list[tuple[str, bool, str]] = []

    def expect(name: str, cond: bool, detail: str = "") -> None:
        checks.append((name, cond, detail))

    # 基线：计划与画布一致
    code, out = run(plan, graph)
    expect("基线一致（退出码 0）", code == 0 and out["ok"], json.dumps(out, ensure_ascii=False)[:200])
    expect("基线无坐标重叠提醒", not any("C6" in n for n in out["notes"]), str(out["notes"]))

    # 少一条边
    g = copy.deepcopy(graph); g["edges"] = g["edges"][:-1]
    code, out = run(plan, g)
    expect("少一条边被抓到", code == 1 and any("C3" in d for d in out["diff"]), str(out["diff"])[:200])

    # 多一条边
    g = copy.deepcopy(graph)
    extra = dict(g["edges"][0]); extra["target"] = g["nodes"][1]["id"]
    extra["targetHandle"] = "text_target"
    g["edges"] = g["edges"] + [extra]
    code, out = run(plan, g)
    expect("多一条边进 notes", any("C4" in n for n in out["notes"]), str(out["notes"])[:200])

    # 节点标题被改（匹配失败）
    g = copy.deepcopy(graph); g["nodes"][3]["title"] = "④ 主图·被改名了"
    code, out = run(plan, g)
    expect("节点改名被抓到", code == 1 and any("C1" in d for d in out["diff"]), str(out["diff"])[:200])

    # 坐标重叠
    g = copy.deepcopy(graph); g["nodes"][4]["position"] = {"x": 0, "y": 0}
    code, out = run(plan, g)
    expect("坐标重叠进 notes", any("C6" in n for n in out["notes"]), str(out["notes"])[:200])

    # 生成节点丢了输入边
    g = copy.deepcopy(graph)
    g["edges"] = [e for e in g["edges"] if e["target"] != g["nodes"][3]["id"]]
    code, out = run(plan, g)
    expect("生成节点无输入被抓到", code == 1 and any("C5" in d or "C3" in d for d in out["diff"]),
           str(out["diff"])[:200])

    failed = [c for c in checks if not c[1]]
    for name, ok, detail in checks:
        print(f"{'✅' if ok else '❌'} {name}" + (f"  ← {detail}" if not ok and detail else ""))
    print(f"\n{len(checks) - len(failed)}/{len(checks)} 通过")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
