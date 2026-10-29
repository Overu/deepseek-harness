#!/usr/bin/env python3
"""check_complete.py —— 画布完整性门（交付前必过）。

为什么需要它：
    "建好了"和"完整"是两件事。一个画布可能：
      · 节点建齐但没跑（生成节点 outputs 为空）
      · 有个"待上传/占位"节点忘了处理
      · 混进了自检清单这类内部逻辑节点
      · 名字写着"7 节点"实际只有 6 个
    这些都不该被当成"已完成"交付。本脚本把"完整"变成可判定的检查。

用法：
    # 1) 取真实节点快照（含 outputs/params/value）
    #    canvas_get(view:"nodes") 的结果保存为 nodes.json
    python3 check_complete.py nodes.json
    python3 check_complete.py nodes.json --json
    python3 check_complete.py nodes.json --expect-node-count 6   # 额外核对节点数

检查项（ERROR = 不完整，必须补齐或明确说明；NOTE = 建议处理）：
    K1 生成节点必须有真实产物：有 generation.images/videos/audios 却 outputs 为空 → 未执行/未完成
    K2 文本节点必须有内容：value（正文）或 params.prompt（LLM 指令）至少一个非空
    K3 占位节点未处理：标题含 待上传/占位/TODO/待补 且无内容 → 卡在等人
    K4 内部逻辑节点混入：标题含 自检/清单/旁注/说明/话术/备忘 → 不该建在画布上
    K5 孤立节点：既无 inputs 也无 outputs，且不是任何边的端点 → 链路外的噪音
       （传 --graph 可精确判定是不是源节点；不传时只看有无连线与内容）
    K6 画布标题节点数与实际不符（如标题写"7 节点"实际 6 个）→ 建议改名
    K7 --expect-node-count 与实际不符 → 计划与画布不一致
    K8 孤立节点：一条边都没有（需要 --graph 才能精确判定）→ ERROR
    K9 位置重叠：position+size 矩形相交 → ERROR，用 canvas_layout 重排
    K10 下游文本节点未运行：text 节点有入边但正文为空 → ERROR，需用户运行
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

PLACEHOLDER_MARKERS = ["待上传", "占位", "TODO", "待补", "未完成", "占位节点"]
INTERNAL_NOTE_MARKERS = ["自检", "检查清单", "清单", "旁注", "不参与生成", "注意事项", "交付话术", "参数说明", "备忘"]


def is_generator(node: dict) -> bool:
    """生成节点：image/video/TTS audio（带模型或提示词，而不是上传素材节点）。"""
    if node.get("type") not in {"image", "video", "audio"}:
        return False
    params = node.get("params") or {}
    if node.get("type") == "audio":
        return params.get("modelType") == "tts" and bool(params.get("model"))
    return bool(params.get("model")) or bool(node.get("prompt"))


def node_outputs(node: dict) -> list[str]:
    outs = [u for u in (node.get("outputs") or []) if isinstance(u, str) and u.strip()]
    if not outs and isinstance(node.get("value"), str) and node["value"].strip().startswith("http"):
        outs = [node["value"]]
    return outs


def check(snapshot: dict, expect_node_count: int | None = None, graph: dict | None = None) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    notes: list[str] = []
    nodes = snapshot.get("nodes") or []
    edges = (graph or {}).get("edges") or []
    sources = {e.get("source") for e in edges}
    targets = {e.get("target") for e in edges}

    for n in nodes:
        nid = n.get("id", "?")
        title = str(n.get("title") or "")
        tag = f"「{title or nid}」"

        # K1 生成节点必须有真实产物
        if is_generator(n):
            gen = n.get("generation") or {}
            wanted = int(gen.get("images") or 0) + int(gen.get("videos") or 0) + int(gen.get("audios") or 0)
            if not node_outputs(n):
                if wanted > 0:
                    errors.append(f"[K1] {tag} 是生成节点，声明要产出 {wanted} 个但 outputs 为空 —— 未执行或未完成")
                else:
                    errors.append(f"[K1] {tag} 是生成节点但没有产物（也没声明产出数量）—— 画布不完整")
        # K2 文本节点必须有内容
        if n.get("type") == "text":
            body = str(n.get("text") or n.get("value") or "").strip()
            prompt = str((n.get("params") or {}).get("prompt") or n.get("prompt") or "").strip()
            if not body and not prompt:
                errors.append(f"[K2] {tag} 是文本节点，但既没有正文也没有 LLM 指令 —— 空节点")
        # K3 占位节点
        if any(m in title for m in PLACEHOLDER_MARKERS) and not node_outputs(n) and not str(n.get("value") or "").strip():
            errors.append(f"[K3] {tag} 仍是占位/待上传状态，用户还需操作 —— 不能算完成")
        # K4 内部逻辑节点
        if any(m in title for m in INTERNAL_NOTE_MARKERS):
            errors.append(f"[K4] {tag} 是内部逻辑（自检/清单/说明），不该建在画布上")
        # K5 孤立节点
        connected = bool(n.get("inputs")) or bool(node_outputs(n)) or nid in sources or nid in targets
        if not connected:
            body = str(n.get("text") or n.get("value") or "").strip()
            if n.get("type") == "text" and (body or (n.get("params") or {}).get("prompt")):
                notes.append(f"[K5] {tag} 没有任何连线（若只是旁注，请删除；若是输入，请接线）")
            elif n.get("type") in {"image", "video"} and not is_generator(n):
                notes.append(f"[K5] {tag} 既无输入也无产物（素材未导入？）")

    # 未传 graph 时无法精确判孤立，明确提示而不是静默放过
    if graph is None and len(nodes) > 1:
        notes.append("[K8] 未传 --graph，孤立节点只能粗判；请用 canvas_get(view:graph) 存 graph.json 后带 --graph 复跑")

    # K8 孤立节点（给了 graph 才能精确判定：一条边都没有 = 孤立）
    if graph is not None and len(nodes) > 1:
        edge_nodes = sources | targets
        for n in nodes:
            if n.get("id") not in edge_nodes:
                errors.append(f"[K8] 「{n.get('title')}」没有任何连线 —— 孤立节点；删掉，或给它接输入/下游")

    # K9 位置重叠（用 canvas_get(nodes) 回执里的 position + size 判矩形相交）
    rects = []
    for n in nodes:
        pos, size = n.get("position"), n.get("size")
        if isinstance(pos, dict) and isinstance(size, dict):
            rects.append((n, float(pos.get("x") or 0), float(pos.get("y") or 0),
                          float(size.get("width") or 0), float(size.get("height") or 0)))
    for i in range(len(rects)):
        for j in range(i + 1, len(rects)):
            a, ax, ay, aw, ah = rects[i]
            b, bx, by, bw, bh = rects[j]
            if ax < bx + bw - 1 and bx < ax + aw - 1 and ay < by + bh - 1 and by < ay + ah - 1:
                errors.append(
                    f"[K9] 「{a.get('title')}」与「{b.get('title')}」位置重叠 —— "
                    f"用 canvas_layout(grid/horizontal/vertical) 重排，不要指望单节点拖拽"
                )

    # K10 下游文本节点必须运行（有入边 = LLM 下游节点，没产物就不能供下游使用）
    for n in nodes:
        if n.get("type") != "text":
            continue
        if not n.get("inputs"):
            continue
        body = str(n.get("text") or n.get("value") or "").strip()
        if not body:
            errors.append(
                f"[K10] 「{n.get('title')}」是下游文本节点但还没运行（正文为空）—— "
                f"agent 不能运行文本节点，必须由用户在画布内点运行后，再跑它的下游"
            )

    # K6 标题节点数
    m = re.search(r"(\d+)\s*节点", str(snapshot.get("name") or ""))
    if m and int(m.group(1)) != len(nodes):
        notes.append(f"[K6] 画布名写「{m.group(1)} 节点」，实际 {len(nodes)} 个 —— 建议改名以免误导")

    # K7 与期望节点数不一致
    if expect_node_count is not None and expect_node_count != len(nodes):
        errors.append(f"[K7] 期望 {expect_node_count} 个节点，实际 {len(nodes)} 个")

    return errors, notes


def main() -> int:
    ap = argparse.ArgumentParser(description="画布完整性门")
    ap.add_argument("snapshot", help="canvas_get(view:nodes) 的 JSON 输出")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--expect-node-count", type=int, default=None)
    ap.add_argument("--graph", default=None, help="canvas_get(view:graph) 的 JSON（可选，用于精确判定孤立节点）")
    args = ap.parse_args()

    try:
        snap = json.loads(Path(args.snapshot).read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"无法读取/解析快照：{exc}", file=sys.stderr)
        return 2

    graph = None
    if args.graph:
        try:
            graph = json.loads(Path(args.graph).read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            print(f"无法读取/解析图：{exc}", file=sys.stderr)
            return 2
    errors, notes = check(snap, args.expect_node_count, graph)
    ok = not errors

    if args.json:
        print(json.dumps({"ok": ok, "errors": errors, "notes": notes}, ensure_ascii=False, indent=2))
        return 0 if ok else 1

    nodes = snap.get("nodes") or []
    print(f"画布完整性：{snap.get('name') or snap.get('canvasId')}　（{len(nodes)} 个节点）\n")
    for e in errors:
        print(f"  ✗ {e}")
    for n in notes:
        print(f"  ! {n}")
    print()
    print("结论：完整 ✅" if ok else "结论：不完整 ❌ —— 补齐或明确说明缺口后再交付")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
