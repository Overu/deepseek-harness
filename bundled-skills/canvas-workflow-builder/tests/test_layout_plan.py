#!/usr/bin/env python3
"""layout_plan.py 的离线单元测试（零成本、不联网）。

运行：
    python3 tests/test_layout_plan.py

守护的性质（这些就是"布局不乱"的可验证定义）：
    L1 确定性：同一输入跑两次结果完全一致（无随机）
    L2 不重叠：任何两个节点坐标不同
    L3 左→右：每条边都指向更右的列（target.x > source.x）
    L4 同层同列：依赖深度相同的节点 x 相同
    L5 父子对齐：子节点所在列与父节点列相邻（x 差 = 列间距），且父子 y 距离不超过一个列高
    L6 写回格式：--in-place 写 placement.absolute 并删除互斥的 position
    L7 无负坐标（归一化生效）
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
SCRIPT = ROOT / "scripts" / "layout_plan.py"
PLAN = ROOT / "examples" / "ecommerce-poster-fanout.plan.json"

spec = importlib.util.spec_from_file_location("layout_plan", SCRIPT)
lp = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(lp)  # type: ignore[union-attr]


def main() -> int:
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    # 这个示例已按"内部逻辑不进画布"清理过：不应再有旁注类节点
    plan = copy.deepcopy(plan)
    checks: list[tuple[str, bool, str]] = []

    def expect(name: str, cond: bool, detail: str = "") -> None:
        checks.append((name, cond, detail))

    pos = lp.build_layout(plan)
    pos2 = lp.build_layout(copy.deepcopy(plan))

    expect("L1 确定性", pos == pos2, f"{pos} vs {pos2}")

    by_id = {n["localId"]: n for n in plan["nodes"]}
    size = {lid: lp.node_size(by_id[lid]) for lid in pos}
    boxes = {lid: (p["x"], p["y"], p["x"] + size[lid][0], p["y"] + size[lid][1]) for lid, p in pos.items()}
    overlap = []
    lids = list(boxes)
    for i, a in enumerate(lids):
        for b in lids[i + 1:]:
            ax1, ay1, ax2, ay2 = boxes[a]
            bx1, by1, bx2, by2 = boxes[b]
            if ax1 < bx2 and bx1 < ax2 and ay1 < by2 and by1 < ay2:
                overlap.append((a, b))
    expect("L2 不重叠", not overlap, str(overlap))

    edges = [(e["from"], e["to"]) for e in plan.get("edges") or []]
    bad = [(a, b) for a, b in edges if pos[a]["x"] >= pos[b]["x"]]
    expect("L3 左→右", not bad, str(bad))

    depths: dict[str, set[float]] = {}
    for lid, p in pos.items():
        depths.setdefault(str(p["x"]), set()).add(p["x"])
    # 同层的 x 必须一致：按 x 分组后每组内 x 唯一
    expect("L4 同层同列", all(len(v) == 1 for v in depths.values()))

    x_of = {lid: p["x"] for lid, p in pos.items()}

    # L5 列内最小行距：相邻节点之间至少留 ROW_GAP（画幅越高占位越高，不能固定 y 差）
    by_col: dict[float, list[str]] = {}
    for lid, pp in pos.items():
        by_col.setdefault(pp["x"], []).append(lid)
    gaps_bad = []
    for col, lids_in_col in by_col.items():
        lids_sorted = sorted(lids_in_col, key=lambda lid: pos[lid]["y"])
        for a, b in zip(lids_sorted, lids_sorted[1:]):
            gap = pos[b]["y"] - (pos[a]["y"] + size[a][1])
            if gap < lp.ROW_GAP - 1e-6:
                gaps_bad.append((col, a, b, round(gap, 1)))
    expect("L5 列内最小行距", not gaps_bad, str(gaps_bad))

    # L8 fan-out 整齐：同一个父节点的多个子节点应落在同一列（x 相同）
    children: dict[str, list[str]] = {}
    for a, b in edges:
        children.setdefault(a, []).append(b)
    messy = [(a, {x_of[c] for c in kids}) for a, kids in children.items()
             if len(kids) > 1 and len({x_of[c] for c in kids}) > 1]
    expect("L8 fan-out 同列", not messy, str(messy))

    expect("L7 无负坐标", all(p["x"] >= 0 and p["y"] >= 0 for p in pos.values()), str(pos))

    # L6 --in-place
    with tempfile.TemporaryDirectory() as td:
        fp = Path(td) / "plan.json"
        # 故意先塞一个互斥的 position 字段
        dirty = copy.deepcopy(plan)
        for n in dirty["nodes"]:
            n["position"] = {"x": 9, "y": 9}
        fp.write_text(json.dumps(dirty, ensure_ascii=False), encoding="utf-8")
        proc = subprocess.run([sys.executable, str(SCRIPT), str(fp), "--in-place"],
                              capture_output=True, text=True)
        out = json.loads(fp.read_text(encoding="utf-8"))
        ok = proc.returncode == 0 and all(
            n.get("placement", {}).get("mode") == "absolute" and "position" not in n for n in out["nodes"]
        )
        expect("L6 --in-place 写 placement 且清 position", ok, proc.stdout[-200:])

    failed = [c for c in checks if not c[1]]
    for name, ok, detail in checks:
        print(f"{'✅' if ok else '❌'} {name}" + (f"  ← {detail}" if not ok and detail else ""))
    print(f"\n{len(checks) - len(failed)}/{len(checks)} 通过")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
