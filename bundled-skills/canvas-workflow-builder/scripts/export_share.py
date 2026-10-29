#!/usr/bin/env python3
"""export_share.py —— 把画布工作流导出成**单文件 HTML**（可直接双击打开/转发）。

为什么需要：
    画布本体只存在于 DSH 客户端里（`dsh-resource://canvas/<id>`），没有对外链接。
    要给别人看/存档/评审，最实用的是导出一个**零依赖、离线可看**的 HTML：
    拓扑图 + 节点表 + 参数 + 提示词 + 连线 + 完整性状态。

用法：
    python3 export_share.py plan.json                          # 基础版
    python3 export_share.py plan.json --nodes nodes.json       # 附带产物/完整性状态
    python3 export_share.py plan.json --canvas-id 103465 --name "模特试穿视频" --out share.html

产出：单个 .html（内联 CSS + 手绘 SVG，不依赖任何 CDN / 网络）。
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import sys
from pathlib import Path

BOX_W, BOX_H = 190, 66
GAP_X, GAP_Y = 90, 34
PAD = 32


def esc(s: object) -> str:
    return html.escape(str(s if s is not None else ""))


def compute_layout(nodes: list[dict]) -> dict[str, dict]:
    """优先用计划里的 absolute 坐标；否则按 x 值分列兜底。"""
    pos: dict[str, dict] = {}
    for n in nodes:
        lid = n.get("localId")
        p = (n.get("placement") or {}).get("position") if isinstance(n.get("placement"), dict) else None
        if lid:
            pos[lid] = {"x": float((p or {}).get("x", 0)), "y": float((p or {}).get("y", 0))}
    if not pos:
        return {}
    # 归一化 + 缩放：把 x 映射成列号、y 映射成行号
    xs = sorted({round(v["x"]) for v in pos.values()})
    ys = sorted({round(v["y"]) for v in pos.values()})
    col = {x: i for i, x in enumerate(xs)}
    row = {y: i for i, y in enumerate(ys)}
    for v in pos.values():
        v["col"] = col[round(v["x"])]
        v["row"] = row[round(v["y"])]
    return pos


def render_svg(nodes: list[dict], edges: list[dict], pos: dict[str, dict]) -> tuple[str, int, int]:
    if not pos:
        return "<p>（无坐标信息，无法绘制拓扑）</p>", 0, 0
    cols = max(v["col"] for v in pos.values()) + 1
    rows = max(v["row"] for v in pos.values()) + 1
    width = PAD * 2 + cols * BOX_W + (cols - 1) * GAP_X
    height = PAD * 2 + rows * BOX_H + (rows - 1) * GAP_Y

    def center(lid: str) -> tuple[float, float]:
        v = pos[lid]
        x = PAD + v["col"] * (BOX_W + GAP_X) + BOX_W / 2
        y = PAD + v["row"] * (BOX_H + GAP_Y) + BOX_H / 2
        return x, y

    by_id = {n["localId"]: n for n in nodes if n.get("localId")}
    parts = [f'<svg viewBox="0 0 {width} {height}" width="100%" style="max-width:{width}px" '
             f'xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,Segoe UI,PingFang SC,sans-serif">']
    parts.append('<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" '
                 'orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#7b8494"/></marker></defs>')

    for e in edges:
        a, b = e.get("from"), e.get("to")
        if a not in pos or b not in pos:
            continue
        ax, ay = center(a)
        bx, by = center(b)
        # 从盒子边缘出发，避免箭头压在框上
        if pos[b]["col"] > pos[a]["col"]:
            ax += BOX_W / 2; bx -= BOX_W / 2
        elif pos[b]["col"] < pos[a]["col"]:
            ax -= BOX_W / 2; bx += BOX_W / 2
        else:
            ax = ax; bx = bx
            ay += (BOX_H / 2) if pos[b]["row"] > pos[a]["row"] else -(BOX_H / 2)
            by -= (BOX_H / 2) if pos[b]["row"] > pos[a]["row"] else -(BOX_H / 2)
        color = "#4155F0" if str(e.get("sourceHandle", "")).startswith("text") else "#52C41A"
        parts.append(f'<line x1="{ax:.0f}" y1="{ay:.0f}" x2="{bx:.0f}" y2="{by:.0f}" '
                     f'stroke="{color}" stroke-width="1.6" opacity="0.75" marker-end="url(#arrow)"/>')

    fill = {"input": "#EEF2FF", "text": "#F3F0FF", "generator": "#E9FBF0"}
    stroke = {"input": "#7C89F5", "text": "#9B8CF5", "generator": "#3FBF7F"}
    for lid, v in pos.items():
        n = by_id.get(lid, {})
        role = n.get("role", "text")
        x = PAD + v["col"] * (BOX_W + GAP_X)
        y = PAD + v["row"] * (BOX_H + GAP_Y)
        title = esc(n.get("title", lid))[:22]
        kind = esc(n.get("type", ""))
        parts.append(f'<rect x="{x}" y="{y}" width="{BOX_W}" height="{BOX_H}" rx="10" '
                     f'fill="{fill.get(role, "#fff")}" stroke="{stroke.get(role, "#999")}" stroke-width="1.4"/>')
        parts.append(f'<text x="{x + 12}" y="{y + 26}" font-size="13" fill="#1f2330">{title}</text>')
        parts.append(f'<text x="{x + 12}" y="{y + 46}" font-size="11" fill="#6b7280">'
                     f'{kind} · {esc(role)}</text>')
    parts.append("</svg>")
    return "\n".join(parts), width, height


def main() -> int:
    ap = argparse.ArgumentParser(description="把工作流计划导出成单文件 HTML")
    ap.add_argument("plan")
    ap.add_argument("--nodes", default=None, help="canvas_get(view:nodes) 的 JSON（可选，用于显示产物与完整性）")
    ap.add_argument("--canvas-id", default=None)
    ap.add_argument("--name", default=None)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    nodes = plan.get("nodes") or []
    edges = plan.get("edges") or []
    pos = compute_layout(nodes)
    svg, _, _ = render_svg(nodes, edges, pos)

    outputs: dict[str, list[str]] = {}
    if args.nodes:
        snap = json.loads(Path(args.nodes).read_text(encoding="utf-8"))
        for n in snap.get("nodes") or []:
            outs = [u for u in (n.get("outputs") or []) if isinstance(u, str)]
            if not outs and isinstance(n.get("value"), str) and n["value"].startswith("http"):
                outs = [n["value"]]
            if outs:
                outputs[str(n.get("title"))] = outs

    now = dt.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M")
    address = f"dsh-resource://canvas/{args.canvas_id}" if args.canvas_id else "—"
    title = args.name or plan.get("goal") or "画布工作流"

    rows = []
    for n in nodes:
        lid = n.get("localId", "")
        cfg = n.get("config") or {}
        params = cfg.get("params") or {}
        param_txt = "；".join(f"{k}={v}" for k, v in params.items()) or "—"
        model_txt = f"{cfg.get('modelType', '')} / {cfg.get('model', '')}" if cfg else "—"
        body = n.get("prompt") or n.get("text") or ""
        outs = outputs.get(str(n.get("title")), [])
        out_cell = (f'<a href="{esc(outs[0])}" target="_blank">产物</a>' if outs else
                    ('<span class="warn">未产出</span>' if n.get("role") == "generator" else "—"))
        rows.append(
            "<tr>"
            f"<td><b>{esc(n.get('title'))}</b><div class='muted'>{esc(lid)}</div></td>"
            f"<td>{esc(n.get('role'))}<div class='muted'>{esc(n.get('type'))}</div></td>"
            f"<td class='mono'>{esc(model_txt)}<div class='muted'>{esc(param_txt)}</div></td>"
            f"<td class='pre'>{esc(body[:400])}{'…' if len(body) > 400 else ''}</td>"
            f"<td>{out_cell}</td>"
            "</tr>"
        )

    edge_rows = "".join(
        f"<tr><td class='mono'>{esc(e.get('from'))} → {esc(e.get('to'))}</td>"
        f"<td class='mono'>{esc(e.get('sourceHandle'))} → {esc(e.get('targetHandle'))}</td></tr>"
        for e in edges
    )

    html_doc = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>{esc(title)}</title>
<style>
 body{{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f7f8fa;color:#1f2330;margin:0;padding:28px}}
 h1{{font-size:20px;margin:0 0 6px}} h2{{font-size:15px;margin:26px 0 10px}}
 .meta{{color:#6b7280;font-size:12px;line-height:1.9}}
 .card{{background:#fff;border:1px solid #e6e8ee;border-radius:12px;padding:18px;margin:14px 0}}
 table{{width:100%;border-collapse:collapse;font-size:12.5px}}
 th,td{{text-align:left;padding:8px 10px;border-bottom:1px solid #eef0f4;vertical-align:top}}
 th{{background:#fafbfc;color:#4b5563;font-weight:600}}
 .mono{{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:#374151}}
 .muted{{color:#9aa1ad;font-size:11px;margin-top:2px}}
 .pre{{white-space:pre-wrap;max-width:430px;color:#374151}}
 .warn{{color:#c2410c;font-weight:600}}
 .ok{{color:#0f766e;font-weight:600}}
 .legend span{{display:inline-block;margin-right:14px;font-size:12px;color:#4b5563}}
 .dot{{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px;vertical-align:middle}}
</style></head><body>
<h1>{esc(title)}</h1>
<div class="meta">
 画布地址：<span class="mono">{esc(address)}</span>　｜　导出时间：{now}<br>
 结构原型：{esc(plan.get('archetype', '—'))}　｜　节点 {len(nodes)} 个　｜　连线 {len(edges)} 条
</div>

<div class="card">
  <h2 style="margin-top:0">拓扑</h2>
  <div class="legend">
    <span><i class="dot" style="background:#EEF2FF;border:1px solid #7C89F5"></i>素材/输入</span>
    <span><i class="dot" style="background:#F3F0FF;border:1px solid #9B8CF5"></i>文本/脚本</span>
    <span><i class="dot" style="background:#E9FBF0;border:1px solid #3FBF7F"></i>生成</span>
    <span><i class="dot" style="background:#4155F0"></i>文本输入边</span>
    <span><i class="dot" style="background:#52C41A"></i>图片/视频输入边</span>
  </div>
  {svg}
</div>

<div class="card">
  <h2 style="margin-top:0">节点</h2>
  <table><thead><tr><th>节点</th><th>角色</th><th>模型 / 参数</th><th>提示词 / 正文</th><th>产物</th></tr></thead>
  <tbody>{''.join(rows)}</tbody></table>
</div>

<div class="card">
  <h2 style="margin-top:0">连线</h2>
  <table><thead><tr><th>边</th><th>端口</th></tr></thead><tbody>{edge_rows}</tbody></table>
</div>

<div class="meta" style="margin-top:18px">
  说明：本文件由 canvas-workflow-builder 技能导出，离线可看、无需联网。<br>
  画布本体在 DSH 客户端里（{esc(address)}），从会话中的成果卡片或侧边栏即可打开；
  本 HTML 只做结构展示，不含画布交互能力。
</div>
</body></html>"""

    out = Path(args.out or (Path(args.plan).stem + ".share.html"))
    out.write_text(html_doc, encoding="utf-8")
    print(f"已导出：{out}（{out.stat().st_size} bytes）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
