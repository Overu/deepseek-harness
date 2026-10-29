#!/usr/bin/env python3
"""verify_canvas.py —— 把「计划」和「画布真实图」逐项对照（S5 结构复核自动化）。

用法：
    # 1) 先取真实图（工具输出原样存成 JSON）
    #    canvas_get(view:"graph") 的结果保存为 graph.json
    # 2) 对照
    python3 verify_canvas.py plan.json graph.json
    python3 verify_canvas.py plan.json graph.json --json

检查项：
    C1 节点数一致；计划里的每个节点都能在画布上按「标题 + 类型」唯一匹配到
    C2 画布上没有计划之外的节点（多出来的会列出）
    C3 每条计划边都能在画布上找到对应边（按解析后的真实节点 ID 比对）
    C4 画布上没有计划之外的边
    C5 生成节点的输入端口齐备（有图片输入边 / 文本输入边符合计划）
    C6 节点矩形是否重叠（按 graph 的 position+size；重叠可用 canvas_layout 整体重排）

退出码：0 = 完全一致；1 = 有差异；2 = 输入不可读。
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path


def load(path: str) -> dict:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"无法读取/解析 {path}：{exc}", file=sys.stderr)
        raise SystemExit(2) from exc


def main() -> int:
    ap = argparse.ArgumentParser(description="计划 vs 画布 逐项对照")
    ap.add_argument("plan")
    ap.add_argument("graph")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    plan = load(args.plan)
    graph = load(args.graph)

    diffs: list[str] = []
    notes: list[str] = []

    p_nodes = plan.get("nodes") or []
    c_nodes = graph.get("nodes") or []
    c_edges = graph.get("edges") or []

    # ---- C1 节点匹配（标题 + 类型唯一匹配）----
    by_key: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for n in c_nodes:
        by_key[(str(n.get("title")), str(n.get("type")))].append(n)

    plan_to_canvas: dict[str, str] = {}
    for pn in p_nodes:
        key = (str(pn.get("title")), str(pn.get("type")))
        cands = by_key.get(key, [])
        if not cands:
            diffs.append(f"[C1] 计划节点「{pn.get('title')}」({pn.get('type')}) 在画布上找不到")
        elif len(cands) > 1:
            diffs.append(f"[C1] 计划节点「{pn.get('title')}」在画布上匹配到 {len(cands)} 个，无法唯一确认")
        else:
            plan_to_canvas[pn["localId"]] = cands[0]["id"]

    if len(p_nodes) != len(c_nodes):
        diffs.append(f"[C1] 节点数不一致：计划 {len(p_nodes)}，画布 {len(c_nodes)}")

    # ---- C2 多余节点 ----
    matched_ids = set(plan_to_canvas.values())
    for n in c_nodes:
        if n["id"] not in matched_ids:
            notes.append(f"[C2] 画布上存在计划外节点「{n.get('title')}」({n.get('type')})")

    # ---- C3/C4 边比对 ----
    canvas_edge_keys = {
        (e.get("source"), e.get("target"), e.get("sourceHandle"), e.get("targetHandle"))
        for e in c_edges
    }
    expected_keys = set()
    for pe in plan.get("edges") or []:
        src = plan_to_canvas.get(pe["from"])
        dst = plan_to_canvas.get(pe["to"])
        if not src or not dst:
            diffs.append(f"[C3] 边 {pe['from']}→{pe['to']} 无法映射（节点未匹配）")
            continue
        key = (src, dst, pe.get("sourceHandle"), pe.get("targetHandle"))
        expected_keys.add(key)
        if key not in canvas_edge_keys:
            diffs.append(
                f"[C3] 计划边 {pe['from']}→{pe['to']} "
                f"({pe.get('sourceHandle')}→{pe.get('targetHandle')}) 在画布上不存在"
            )

    for e in c_edges:
        key = (e.get("source"), e.get("target"), e.get("sourceHandle"), e.get("targetHandle"))
        if key not in expected_keys:
            src_title = next((n.get("title") for n in c_nodes if n["id"] == e.get("source")), e.get("source"))
            dst_title = next((n.get("title") for n in c_nodes if n["id"] == e.get("target")), e.get("target"))
            notes.append(
                f"[C4] 画布上存在计划外边 {src_title}→{dst_title} "
                f"({e.get('sourceHandle')}→{e.get('targetHandle')})"
            )

    # ---- C5 生成节点输入齐备 ----
    for pn in p_nodes:
        if pn.get("role") != "generator":
            continue
        cid = plan_to_canvas.get(pn["localId"])
        if not cid:
            continue
        incoming = [e for e in c_edges if e.get("target") == cid]
        if not incoming and not pn.get("allowNoInput"):
            diffs.append(f"[C5] 生成节点「{pn.get('title')}」在画布上没有任何输入边")
        kinds = {str(e.get("sourceHandle", "")).split("_")[0] for e in incoming}
        if "image" in kinds and "image_target" not in {e.get("targetHandle") for e in incoming}:
            notes.append(f"[C5] 生成节点「{pn.get('title')}」有图片来源但没有 image_target 入边")

    # ---- C6 节点矩形重叠 ----
    boxes = []
    for n in c_nodes:
        p = n.get("position") or {}
        sz = n.get("size") or {}
        x, y = float(p.get("x", 0)), float(p.get("y", 0))
        w, h = float(sz.get("width", 400) or 400), float(sz.get("height", 400) or 400)
        boxes.append((str(n.get("title")), x, y, x + w, y + h))
    for i, a in enumerate(boxes):
        for b in boxes[i + 1:]:
            if a[1] < b[3] and b[1] < a[3] and a[2] < b[4] and b[2] < a[4]:
                notes.append(
                    f"[C6] 节点矩形重叠：「{a[0]}」与「{b[0]}」"
                    "（可用 canvas_layout 做 grid/horizontal/vertical 整体重排，或删掉重建）"
                )

    ok = not diffs
    if args.json:
        print(json.dumps({"ok": ok, "diff": diffs, "notes": notes}, ensure_ascii=False, indent=2))
        return 0 if ok else 1

    print(f"结构复核：计划 {args.plan}  ↔  画布 {graph.get('canvasId')} v{graph.get('version')}")
    print(f"  节点 {len(p_nodes)}→{len(c_nodes)}　边 {len(plan.get('edges') or [])}→{len(c_edges)}\n")
    for d in diffs:
        print(f"  ✗ {d}")
    for n in notes:
        print(f"  ! {n}")
    print()
    print("结论：一致 ✅" if ok else "结论：存在差异，先修再执行 ❌")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
