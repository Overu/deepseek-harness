#!/usr/bin/env python3
"""layout_plan.py —— 按依赖关系自动排布节点坐标（确定性算法，不依赖画布）。

为什么需要它：
    坐标只能在 add 时用 placement 指定；之后只有 canvas_layout 的整体重排，
    **不能把单个节点挪到任意坐标**——坐标写错只能删掉重建。所以坐标必须在建图之前算好。

算法（五步，全部确定性，无随机）：
    1. **分层**：`depth(n) = 0`（无入边）或 `max(depth(父)) + 1`，即最长路径分层。
    2. **尺寸**：按 aspect_ratio 算真实尺寸（长边 400）：
       `3:4→400×533`、`1:1→400×400`、`9:16→400×711`、`16:9→711×400`；文本/音频按 400×400。
    3. **列坐标**：首列 0，之后 `x = 上一列 x + max(520, 上一列最大宽 + 120)`，避免宽幅节点压到下一列。
    4. **列内落位**：按父节点重心 y 排序，依次 `y = 上一节点 y + 上一节点高 + 560`（最小行距），
       再整列垂直居中到父节点中心均值。
    5. **归一化**：整体平移到最小 x/y = 0，无负坐标。

**`--lanes`（序列泳道模式，镜头/分镜/套图类工作流默认用它）**
    默认算法只按"列 = 依赖深度"堆叠，镜头一多就成一条长竖列，人看不出"第 3 镜在哪"。
    `--lanes` 在此之上再加一层：**列 = 阶段（从左到右），行 = 序列（同一镜头/同一套图的各阶段节点同 y）**。
    实现：
      1. 列沿用默认算法（依赖深度 + 宽度感知），**不改左→右顺序**；
      2. 从标题（`镜头3｜…` / `分镜3｜…` / `旁白3` / `套图3`）或 localId 尾部数字（`img_sh3`）取序列号；
      3. 无序号的节点（Brief、产品图等输入槽）按计划顺序各占一行排在最上；
      4. 同一序列号的节点归入同一行，`y` 相同；行高取该行最高卡片，行距 `LANE_ROW_GAP`；
      5. 同列同 y 的冲突（同一行同一列放了两个）按列向下顺延，保证卡片永不相交。
    结果：横着读一行就是"这一镜：旁白 → 分镜 → 镜头"，竖着读一列就是"所有输入 / 所有分镜 / 所有成片"。

用法：
    python3 layout_plan.py plan.json                 # 打印坐标建议（不改文件）
    python3 layout_plan.py plan.json --lanes         # 序列泳道布局（镜头/分镜类必用）
    python3 layout_plan.py plan.json --in-place      # 写回 plan.json 的 placement
    python3 layout_plan.py plan.json --lanes --in-place
    python3 layout_plan.py plan.json --json          # 机器可读

写回格式：`placement: {"mode": "absolute", "position": {"x": .., "y": ..}}`，
并自动删除互斥的 `position` 字段（两者同时出现会被工具层拒收）。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

COLUMN_GAP = 520          # 相邻列最小间距
COLUMN_PADDING = 120      # 宽幅节点右侧留白
ROW_GAP = 560             # 同列相邻节点最小行距（9:16 也不会压到下一个）
LANE_ROW_GAP = 300        # 泳道模式行距：卡片之间留 300（400 高卡片 → 行距 700），不挤
LANE_COLUMN_GAP = 400     # 泳道模式列距：卡片右缘到下一列左缘留 400
NODE_LONG_EDGE = 400      # 节点长边基准

# 序列号来源：标题里的「镜头3｜…」「分镜3」「旁白3」，或 localId 尾部数字（img_sh3 / vid_3）
SEQ_IN_TITLE = re.compile(r"(?:镜头|分镜|旁白|场景|套图|配音|变体|版本|镜)\s*(\d+)")
SEQ_IN_ID = re.compile(r"(?:^|[_-])(?:sh|shot|seq|img|vid|aud|s|v)?[_-]?0*(\d+)$", re.I)


def node_size(node: dict) -> tuple[float, float]:
    """按 aspect_ratio 估算节点真实尺寸（长边 400）。"""
    if node.get("type") not in {"image", "video"}:
        return float(NODE_LONG_EDGE), float(NODE_LONG_EDGE)
    ratio = ((node.get("config") or {}).get("params") or {}).get("aspect_ratio") or "1:1"
    try:
        w, h = (float(x) for x in str(ratio).split(":"))
    except (ValueError, TypeError):
        return float(NODE_LONG_EDGE), float(NODE_LONG_EDGE)
    if w <= 0 or h <= 0:
        return float(NODE_LONG_EDGE), float(NODE_LONG_EDGE)
    if w >= h:
        return round(NODE_LONG_EDGE * w / h, 1), float(NODE_LONG_EDGE)
    return float(NODE_LONG_EDGE), round(NODE_LONG_EDGE * h / w, 1)


def node_sequence(node: dict) -> int | None:
    """取节点的序列号（第几镜 / 第几套图）。取不到返回 None。"""
    title = str(node.get("title") or "")
    m = SEQ_IN_TITLE.search(title)
    if m:
        return int(m.group(1))
    m = SEQ_IN_ID.search(str(node.get("localId") or ""))
    if m:
        return int(m.group(1))
    return None


def build_layout(plan: dict, column_gap: int = COLUMN_GAP, row_gap: int = ROW_GAP) -> dict[str, dict]:
    nodes = [n for n in (plan.get("nodes") or []) if n.get("localId")]
    order = {n["localId"]: i for i, n in enumerate(nodes)}
    edges = [e for e in (plan.get("edges") or []) if e.get("from") in order and e.get("to") in order]
    by_id = {n["localId"]: n for n in nodes}
    size = {lid: node_size(n) for lid, n in by_id.items()}

    parents: dict[str, list[str]] = {n["localId"]: [] for n in nodes}
    for e in edges:
        parents[e["to"]].append(e["from"])

    # ---- 1) 分层：最长路径 ----
    depth: dict[str, int] = {}
    for lid in sorted(order, key=lambda k: order[k]):
        stack, visiting = [lid], set()
        while stack:
            cur = stack[-1]
            if cur in depth:
                stack.pop(); continue
            ps = parents[cur]
            if not ps:
                depth[cur] = 0; stack.pop(); continue
            if all(p in depth for p in ps):
                depth[cur] = max(depth[p] for p in ps) + 1; stack.pop(); continue
            if cur in visiting:      # 有环（不该发生，validate_plan 会先拦）
                depth[cur] = 0; stack.pop(); continue
            visiting.add(cur)
            stack.extend(p for p in ps if p not in depth)
    for lid in order:
        depth.setdefault(lid, 0)

    columns: dict[int, list[str]] = {}
    for lid, d in depth.items():
        columns.setdefault(d, []).append(lid)

    # ---- 2/3) 列坐标（宽度感知） ----
    col_width = {d: max(size[lid][0] for lid in ids) for d, ids in columns.items()}
    x_of: dict[int, float] = {}
    x = 0.0
    for d in sorted(columns):
        x_of[d] = x
        x += max(float(column_gap), col_width[d] + COLUMN_PADDING)

    # ---- 4) 列内排序、落位、垂直居中 ----
    pos: dict[str, dict] = {}
    for d in sorted(columns):
        col = columns[d]

        def barycenter(lid: str) -> float:
            ps = [p for p in parents[lid] if p in pos]
            if not ps:
                return float("inf")          # 无父节点者排最前
            return sum(pos[p]["y"] + size[p][1] / 2 for p in ps) / len(ps)

        col_sorted = sorted(col, key=lambda lid: (barycenter(lid), order[lid]))
        y = 0.0
        for lid in col_sorted:
            pos[lid] = {"x": round(x_of[d], 1), "y": round(y, 1)}
            y += size[lid][1] + row_gap

        linked = [p for lid in col_sorted for p in parents[lid] if p in pos]
        if linked:
            col_center = (pos[col_sorted[0]]["y"] + pos[col_sorted[-1]]["y"] + size[col_sorted[-1]][1]) / 2
            parent_center = sum(pos[p]["y"] + size[p][1] / 2 for p in linked) / len(linked)
            shift = parent_center - col_center
            for lid in col_sorted:
                pos[lid]["y"] = round(pos[lid]["y"] + shift, 1)

    # ---- 5) 归一化 ----
    min_x = min(p["x"] for p in pos.values())
    min_y = min(p["y"] for p in pos.values())
    for p in pos.values():
        p["x"] = round(p["x"] - min_x, 1)
        p["y"] = round(p["y"] - min_y, 1)
    return pos


STAGE_LABELS = {0: "输入", 1: "画面", 2: "声音", 3: "成片"}


def node_stage(node: dict) -> int:
    """阶段号：0 输入（文本 / 上传素材槽）、1 画面（生成图）、2 声音（TTS）、3 成片（视频）。

    这是"人怎么读一条生产线"的顺序，不是依赖深度：TTS 台词直写、零入边，但它服务的是成片，
    所以排在分镜之后、镜头之前，而不是和输入挤在第一列。
    """
    if node.get("role") == "input":
        return 0
    return {"text": 0, "image": 1, "audio": 2, "video": 3}.get(str(node.get("type")), 1)


def _depths(nodes: list[dict], edges: list[dict]) -> dict[str, int]:
    ids = [n["localId"] for n in nodes]
    parents: dict[str, list[str]] = {i: [] for i in ids}
    for e in edges:
        parents[e["to"]].append(e["from"])
    depth: dict[str, int] = {}

    def walk(node: str, stack: tuple[str, ...] = ()) -> int:
        if node in depth:
            return depth[node]
        if node in stack:            # 成环（validate_plan 会先拦），兜底不递归
            return 0
        ps = parents[node]
        depth[node] = 0 if not ps else max(walk(p, stack + (node,)) for p in ps) + 1
        return depth[node]

    for i in ids:
        walk(i)
    return depth


def build_layout_lanes(plan: dict, column_gap: int = COLUMN_GAP, row_gap: int = LANE_ROW_GAP) -> dict[str, dict]:
    """序列泳道布局：列 = 阶段（输入 → 画面 → 声音 → 成片），行 = 序列（同一镜头/套图同 y）。"""
    nodes = [n for n in (plan.get("nodes") or []) if n.get("localId")]
    if not nodes:
        return {}
    order = {n["localId"]: i for i, n in enumerate(nodes)}
    by_id = {n["localId"]: n for n in nodes}
    size = {lid: node_size(n) for lid, n in by_id.items()}
    edges = [e for e in (plan.get("edges") or []) if e.get("from") in order and e.get("to") in order]
    depth = _depths(nodes, edges)

    # ---- 1) 列 = (阶段, 阶段内依赖深度)；同类型的链式节点（底图→延展）靠第二项分成两列 ----
    key_of = {lid: (node_stage(by_id[lid]), depth[lid]) for lid in order}
    columns: dict[tuple[int, int], list[str]] = {}
    for lid in sorted(order, key=lambda k: order[k]):
        columns.setdefault(key_of[lid], []).append(lid)
    x_of: dict[str, float] = {}
    cursor = 0.0
    for key in sorted(columns):
        members = columns[key]
        widest = max(size[lid][0] for lid in members)
        for lid in members:
            x_of[lid] = cursor
        cursor += widest + LANE_COLUMN_GAP

    # ---- 2) 行 = 序列号；同一镜的旁白/分镜/镜头同 y ----
    plain: list[str] = []
    seq_buckets: dict[int, list[str]] = {}
    for n in nodes:
        lid = n["localId"]
        seq = node_sequence(n)
        if seq is None:
            plain.append(lid)
        else:
            seq_buckets.setdefault(seq, []).append(lid)
    lanes: list[list[str]] = [seq_buckets[s] for s in sorted(seq_buckets)]
    for lane in lanes:
        lane.sort(key=lambda lid: (x_of[lid], order[lid]))

    pos: dict[str, dict] = {}
    y = 0.0
    for lane in lanes:
        lane_h = max(size[lid][1] for lid in lane)
        for lid in lane:
            pos[lid] = {"x": x_of[lid], "y": round(y, 1)}
        y += lane_h + row_gap

    # ---- 3) 无序号节点（Brief / 待上传素材槽）落在自己的列，从该列顶部往下排 ----
    col_cursor: dict[float, float] = {}
    for lid in plain:
        col = x_of[lid]
        y0 = col_cursor.get(col, 0.0)
        pos[lid] = {"x": col, "y": round(y0, 1)}
        col_cursor[col] = y0 + size[lid][1] + row_gap

    # ---- 4) 同列冲突顺延，保证矩形永不相交 ----
    for col in sorted(set(x_of.values())):
        col_ids = sorted([lid for lid in pos if x_of[lid] == col], key=lambda l: (pos[l]["y"], order[l]))
        prev_bottom: float | None = None
        for lid in col_ids:
            if prev_bottom is not None and pos[lid]["y"] < prev_bottom + row_gap:
                pos[lid]["y"] = round(prev_bottom + row_gap, 1)
            prev_bottom = pos[lid]["y"] + size[lid][1]

    # ---- 5) 归一化 ----
    min_x = min(p["x"] for p in pos.values())
    min_y = min(p["y"] for p in pos.values())
    for p in pos.values():
        p["x"] = round(p["x"] - min_x, 1)
        p["y"] = round(p["y"] - min_y, 1)
    return pos


def main() -> int:
    ap = argparse.ArgumentParser(description="按依赖关系自动排布节点坐标")
    ap.add_argument("plan")
    ap.add_argument("--in-place", action="store_true", help="把坐标写回 plan.json 的 placement")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--lanes", action="store_true", help="序列泳道布局：行=镜头/套图，列=阶段（镜头/分镜类工作流用这个）")
    ap.add_argument("--column-gap", type=int, default=COLUMN_GAP)
    ap.add_argument("--row-gap", type=int, default=ROW_GAP)
    args = ap.parse_args()

    path = Path(args.plan)
    try:
        plan = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"无法读取/解析计划：{exc}", file=sys.stderr)
        return 2

    if args.lanes:
        pos = build_layout_lanes(plan, args.column_gap, LANE_ROW_GAP)
        header = "坐标建议（泳道布局：行 = 镜头/序列，列 = 阶段，从左到右即执行顺序）：\n"
    else:
        pos = build_layout(plan, args.column_gap, args.row_gap)
        header = "坐标建议（列 = 依赖深度，列内按父节点重心排序并按画幅高度落位）：\n"

    if args.json:
        print(json.dumps(pos, ensure_ascii=False, indent=2))
    else:
        print(header)
        for n in plan.get("nodes") or []:
            lid = n.get("localId")
            if lid in pos:
                print(f"  {lid:<18} x={pos[lid]['x']:>7}  y={pos[lid]['y']:>8}   {n.get('title', '')}")

    if args.in_place:
        for n in plan.get("nodes") or []:
            lid = n.get("localId")
            if lid not in pos:
                continue
            n.pop("position", None)          # 与 placement 互斥
            n["placement"] = {"mode": "absolute", "position": pos[lid]}
        path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"\n已写回 {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
