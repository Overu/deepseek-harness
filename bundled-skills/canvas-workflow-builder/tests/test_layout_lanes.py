#!/usr/bin/env python3
"""layout_plan.py 泳道模式（--lanes）的离线单元测试（零成本、不联网）。

运行：
    python3 tests/test_layout_lanes.py

守护的性质：
    N1 确定性：同一输入两次结果一致
    N2 同序列同行：序号相同的节点 y 完全相同（同一镜头各阶段能横着读）
    N3 左→右：同一行内 x 随阶段递增；每条边都指向更右的列
    N4 不重叠：任意两个卡片矩形不相交
    N5 输入槽在顶上：无序号节点（Brief / 待上传素材）独占行且排在最上方
    N6 无负坐标
"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "layout_plan.py"

spec = importlib.util.spec_from_file_location("layout_plan", SCRIPT)
lp = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(lp)  # type: ignore[union-attr]


def tvc_plan() -> dict:
    """一条 5 镜 TVC：Brief + 产品槽 + 5 分镜 + 5 镜头 + 5 旁白。"""
    nodes = [
        {"localId": "t_brief", "role": "text", "type": "text", "title": "品牌与产品 Brief"},
        {"localId": "in_product", "role": "input", "type": "image", "title": "产品图｜待上传"},
    ]
    for i in range(1, 6):
        nodes.append({"localId": f"img_sh{i}", "role": "generator", "type": "image",
                      "title": f"分镜{i}｜镜头", "config": {"params": {"aspect_ratio": "16:9"}}})
        nodes.append({"localId": f"vid_sh{i}", "role": "generator", "type": "video",
                      "title": f"镜头{i}｜成片", "config": {"params": {"aspect_ratio": "16:9"}}})
        nodes.append({"localId": f"aud_sh{i}", "role": "generator", "type": "audio",
                      "title": f"旁白{i}"})
    edges = []
    for i in range(1, 6):
        edges.append({"from": "t_brief", "to": f"img_sh{i}", "sourceHandle": "text_source", "targetHandle": "text_target"})
        edges.append({"from": f"img_sh{i}", "to": f"vid_sh{i}", "sourceHandle": "image_source", "targetHandle": "image_target"})
        edges.append({"from": f"aud_sh{i}", "to": f"vid_sh{i}", "sourceHandle": "audio_source", "targetHandle": "audio_target"})
    for i in (3, 4, 5):
        edges.append({"from": "in_product", "to": f"img_sh{i}", "sourceHandle": "image_source", "targetHandle": "image_target"})
    return {"goal": "TVC", "archetype": "custom", "nodes": nodes, "edges": edges, "runs": []}


def main() -> int:
    plan = tvc_plan()
    pos = lp.build_layout_lanes(plan)
    pos2 = lp.build_layout_lanes(tvc_plan())
    checks: list[tuple[str, bool, str]] = []

    def expect(name: str, cond: bool, detail: str = "") -> None:
        checks.append((name, cond, detail))

    by_id = {n["localId"]: n for n in plan["nodes"]}
    size = {lid: lp.node_size(by_id[lid]) for lid in pos}

    expect("N1 确定性", pos == pos2, f"{pos} vs {pos2}")
    expect("N6 无负坐标", all(p["x"] >= 0 and p["y"] >= 0 for p in pos.values()))

    # N2：同一序号（1..5）的旁白 / 分镜 / 镜头在同一行
    for i in range(1, 6):
        ys = {pos[lid]["y"] for lid in (f"aud_sh{i}", f"img_sh{i}", f"vid_sh{i}")}
        expect(f"N2 第{i}镜同行", len(ys) == 1, f"y={ys}")

    # N3a：同一行内自左向右 = 分镜（画面）→ 旁白（声音）→ 镜头（成片）
    for i in range(1, 6):
        xs = [pos[lid]["x"] for lid in (f"img_sh{i}", f"aud_sh{i}", f"vid_sh{i}")]
        expect(f"N3a 第{i}镜列序", xs == sorted(xs) and len(set(xs)) == 3, f"x={xs}")

    # N3b：每条边 target.x > source.x
    bad = [e for e in plan["edges"] if pos[e["to"]]["x"] <= pos[e["from"]]["x"]]
    expect("N3b 边全部左→右", not bad, f"{bad[:3]}")

    # N4：矩形不相交
    boxes = {lid: (p["x"], p["y"], p["x"] + size[lid][0], p["y"] + size[lid][1]) for lid, p in pos.items()}
    overlaps = []
    lids = list(boxes)
    for i, a in enumerate(lids):
        for b in lids[i + 1:]:
            ax1, ay1, ax2, ay2 = boxes[a]
            bx1, by1, bx2, by2 = boxes[b]
            if ax1 < bx2 and bx1 < ax2 and ay1 < by2 and by1 < ay2:
                overlaps.append((a, b))
    expect("N4 卡片不重叠", not overlaps, f"{overlaps[:3]}")

    # N5：输入槽独占最左一列，且不与任何序列行重叠
    left_x = min(p["x"] for p in pos.values())
    expect("N5 输入槽在最左列", pos["t_brief"]["x"] == left_x and pos["in_product"]["x"] == left_x,
           f"brief={pos['t_brief']['x']} product={pos['in_product']['x']} left={left_x}")
    expect("N5b 输入槽不与分镜同列", pos["in_product"]["x"] < pos["img_sh1"]["x"],
           f"{pos['in_product']['x']} vs {pos['img_sh1']['x']}")

    # CLI：--lanes --in-place 能写回 placement
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "plan.json"
        p.write_text(json.dumps(plan, ensure_ascii=False), encoding="utf-8")
        import subprocess
        r = subprocess.run([sys.executable, str(SCRIPT), str(p), "--lanes", "--in-place"],
                           capture_output=True, text=True)
        expect("N7 CLI 退出码", r.returncode == 0, r.stderr[-300:])
        written = json.loads(p.read_text(encoding="utf-8"))
        ok = all(n.get("placement", {}).get("mode") == "absolute" for n in written["nodes"])
        expect("N7 写回 placement", ok)

    width = max(len(n) for n, _, _ in checks)
    failed = 0
    for name, cond, detail in checks:
        print(f"  {'PASS' if cond else 'FAIL'}  {name:<{width}}  {'' if cond else detail}")
        failed += 0 if cond else 1
    print(f"\n共 {len(checks)} 项，失败 {failed} 项")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
