#!/usr/bin/env python3
"""render_plan.py —— 把 plan.json 渲染成**可照做的工具调用序列**（dry-run，不触碰画布）。

用法：
    python3 render_plan.py plan.json            # 人读版：编号步骤 + 每步参数
    python3 render_plan.py plan.json --json     # 机器可读：{"steps": [...]}

为什么要它：
    计划正确不代表执行顺序正确。本脚本把「先建什么、后连什么、什么时候读版本、哪些步骤要人工」
    固化成一条线性清单，避免执行时跳步（例如：先连线后读版本、没配模型就跑生成、素材没落地就连线）。

注意：
    仍然要按 SKILL.md 的纪律执行——每步写前读最新 confirmed 版本；素材导入后读回核对；
    批量 canvas_run（≤20/批、并发 8）但下游依赖未就绪时不要一起提交。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

CANVAS = "<canvasId>"
VER = "<最新 confirmed 版本>"

UPLOAD_SOURCES = {"attachment", "conversation_asset", "canvas_node", "workspace_file"}


def build_steps(plan: dict) -> list[dict]:
    steps: list[dict] = []
    nodes = plan.get("nodes") or []
    edges = plan.get("edges") or []
    runs = plan.get("runs") or []
    manual = plan.get("manualSteps") or []
    by_id = {n["localId"]: n for n in nodes if n.get("localId")}

    steps.append({
        "tool": "canvas_create",
        "args": {"name": plan.get("goal", "画布工作流")[:100]},
        "note": "若用户已指定画布，跳过此步并改用其 canvasId；create_unknown 不得自动重试",
    })
    steps.append({
        "tool": "canvas_get",
        "args": {"canvasId": CANVAS, "view": "nodes"},
        "note": f"取当前 confirmed 版本，作为后续所有 expectedVersion={VER}",
    })

    # 1) 素材导入（文本/图片/视频/音频四类来源）
    for n in nodes:
        if n.get("role") != "input":
            continue
        src = (n.get("source") or "").lower()
        if src in UPLOAD_SOURCES:
            source: dict = {"type": src}
            if src == "attachment":
                source["attachmentId"] = "<canvas_assets 返回的 attachmentId>"
            elif src == "conversation_asset":
                source["assetRef"] = "<canvas_assets 返回的 assetRef>"
            elif src == "canvas_node":
                source.update({
                    "canvasId": "<来源画布ID>",
                    "nodeId": "<来源节点ID>",
                    "outputIndex": "<多产物时必填，0 起>",
                })
            else:
                source["path"] = "<当前会话工作区内的文件路径>"
            steps.append({
                "tool": "canvas_asset_import",
                "args": {
                    "canvasId": CANVAS, "expectedVersion": VER,
                    "source": source,
                    "title": n.get("title", "")[:100],
                    "placement": n.get("placement") or {"mode": "auto"},
                },
                "note": f"节点 {n['localId']}({n.get('title')})：{src} 导入；文本/图片/视频/音频均可；导入后 canvas_get 读回真实 ID 与 outputs",
            })
        else:
            steps.append({
                "tool": "canvas_node_edit",
                "args": {
                    "canvasId": CANVAS, "expectedVersion": VER,
                    "ops": [{"op": "add", "node": {"type": n.get("type"), "placement": {"mode": "auto"},
                                                   "changes": {"title": n.get("title", "")[:100]}}}],
                },
                "note": f"节点 {n['localId']}：占位节点，等待用户提供 {n.get('type')} 素材；导入后 canvas_get 读回确认非空 URL 再继续",
            })

    # 2) 文本节点（一次 ops 批量新增）
    text_ops = []
    for n in nodes:
        if n.get("role") != "text":
            continue
        changes: dict = {"title": n.get("title", "")[:100]}
        if n.get("text"):
            changes["text"] = n["text"]
        if n.get("prompt"):
            changes["prompt"] = n["prompt"]          # → params.prompt（LLM 指令）
        text_ops.append({"op": "add", "node": {"type": "text",
                                               "placement": n.get("placement") or {"mode": "auto"},
                                               "changes": changes}})
    if text_ops:
        steps.append({
            "tool": "canvas_node_edit",
            "args": {"canvasId": CANVAS, "expectedVersion": VER, "ops": text_ops},
            "note": "文本节点批量新增；LLM 节点模型不能由工具指定，实际默认值以画布 UI 为准，用户可在 UI 改",
        })

    # 3) 生成节点：一次 ops 批量 add → 读目录 → 一次 ops 批量 configure
    gen_nodes = [n for n in nodes if n.get("role") == "generator"]
    add_ops = []
    for n in gen_nodes:
        cfg = n.get("config") or {}
        changes: dict = {"title": n.get("title", "")[:100]}
        if n.get("prompt"):
            changes["prompt"] = n["prompt"]
        if cfg.get("params"):
            changes["params"] = cfg["params"]
        add_ops.append({"op": "add", "node": {"type": n.get("type"),
                                              "placement": n.get("placement") or {"mode": "auto"},
                                              "changes": changes}})
    if add_ops:
        steps.append({
            "tool": "canvas_node_edit",
            "args": {"canvasId": CANVAS, "expectedVersion": VER, "ops": add_ops},
            "note": "生成节点批量新增；model/modelType/voiceId 走下一步 configure",
        })
        for ntype in sorted({n.get("type") for n in gen_nodes}):
            steps.append({
                "tool": "canvas_models",
                "args": {"canvasId": CANVAS, "nodeType": ntype},
                "note": f"读实时目录核对 {ntype} 的 modelType/model/paramHints"
                        + ("（audio 再读 voiceSelection 与 seniorParamHints）" if ntype == "audio" else ""),
            })
        cfg_ops = []
        for n in gen_nodes:
            cfg = n.get("config") or {}
            configuration: dict = {"modelType": cfg.get("modelType"), "model": cfg.get("model"),
                                   "params": cfg.get("params") or {}}
            if cfg.get("voiceId"):
                configuration["voiceId"] = cfg["voiceId"]
            if cfg.get("seniorParams"):
                configuration["seniorParams"] = cfg["seniorParams"]
            cfg_ops.append({"op": "configure", "nodeId": f"<{n['localId']} 的真实节点ID>",
                            "configuration": configuration})
        steps.append({
            "tool": "canvas_node_edit",
            "args": {"canvasId": CANVAS, "expectedVersion": VER, "ops": cfg_ops},
            "note": "批量 configure：image/video 设模式与参数；TTS audio 设 voiceId/seniorParams；文本节点会被 UNSUPPORTED_NODE 拒绝",
        })

    # 4) 连线（一次 ops 批量）
    if edges:
        edge_ops = [{
            "op": "add",
            "connection": {
                "sourceNodeId": f"<{e['from']} 的真实节点ID>",
                "targetNodeId": f"<{e['to']} 的真实节点ID>",
                "sourceHandle": e.get("sourceHandle"),
                "targetHandle": e.get("targetHandle"),
            },
        } for e in edges]
        steps.append({
            "tool": "canvas_edges",
            "args": {"canvasId": CANVAS, "expectedVersion": VER, "ops": edge_ops},
            "note": "批量连线；显式端口便于复核；回执 warnings 若出现「仅支持文本输入」→ 调用 configure 改模式",
        })
        if any(e.get("sourceHandle") == "image_source" for e in edges):
            steps.append({
                "tool": "canvas_get",
                "args": {"canvasId": CANVAS, "view": "graph"},
                "note": "读回 ports/allowedInputTypes，确认图片/视频边落在正确端口",
            })

    # 5) 结构复核
    steps.append({
        "tool": "canvas_get",
        "args": {"canvasId": CANVAS, "view": "graph"},
        "note": "逐项对照计划：节点数、端口方向、每条边、实时参数；有差异先修再跑",
    })

    # 6) 执行（批量；依赖未就绪的下游留到下一批）
    if runs:
        steps.append({
            "tool": "canvas_run",
            "args": {"canvasId": CANVAS, "nodeIds": [f"<{lid} 的真实节点ID>" for lid in runs],
                     "expectedVersion": VER},
            "note": "批量提交（≤20/批，并发 8）；paused 时只受理 nextIndex 前缀，收完本 Job 再读版本续跑；"
                    "submission_unknown 有 jobId 用 job_output 收；下游依赖未就绪时不要一起提交",
        })
        steps.append({
            "tool": "job_output",
            "args": {"jobId": "<canvas_run 返回的 jobId>", "wait": True},
            "note": "收集每个节点的终态与 outputs；completed 且有产物才算完成",
        })

    for m in manual:
        node = by_id.get(m.get("node"), {})
        steps.append({
            "tool": "（人工）",
            "args": {"node": m.get("node"), "title": node.get("title")},
            "note": f"{m.get('reason', '')}｜需用户操作：{m.get('action', '—')}",
        })
    return steps


def main() -> int:
    ap = argparse.ArgumentParser(description="把计划渲染成工具调用序列（dry-run）")
    ap.add_argument("plan")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    try:
        plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"无法读取/解析计划：{exc}", file=sys.stderr)
        return 2

    steps = build_steps(plan)
    if args.json:
        print(json.dumps({"goal": plan.get("goal"), "stepCount": len(steps), "steps": steps},
                         ensure_ascii=False, indent=2))
        return 0

    print(f"执行序列（dry-run）：{plan.get('goal')}")
    print(f"共 {len(steps)} 步\n")
    for i, s in enumerate(steps, 1):
        tool = s["tool"]
        print(f"{i:>2}. {tool}")
        for k, v in (s.get("args") or {}).items():
            print(f"      {k}: {json.dumps(v, ensure_ascii=False)}")
        if s.get("note"):
            print(f"      ↳ {s['note']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
