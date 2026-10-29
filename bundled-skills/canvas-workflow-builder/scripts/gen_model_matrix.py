#!/usr/bin/env python3
"""README —— 生成「模型×模式×参数」快照（references/model-matrix.md）。

为什么需要这个脚本：
    画布可用的模型、模式与参数枚举由远端目录决定（随账号/时间变化）。
    技能里不能硬编码模型名，但完全不带快照又会让规划阶段失去参照。
    因此：本脚本生成"某一时刻的真实快照"作为参照物，运行期一律以
    canvas_models 的实时返回为准（SKILL.md 硬规则 1）。

用法：
    python3 gen_model_matrix.py                    # 从远端目录取最新快照
    python3 gen_model_matrix.py --file params.json # 用本地已保存的目录 JSON
    python3 gen_model_matrix.py --out ../references/model-matrix.md

目录来源（公开 CDN，只读）：
    https://game-ai-admin-prod-cdn.idealead.com/model_node_setting/model_params_with_sort.json
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import urllib.request
from pathlib import Path

DEFAULT_URL = "https://game-ai-admin-prod-cdn.idealead.com/model_node_setting/model_params_with_sort.json"


def fetch(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310 (固定可信域名)
        return json.loads(resp.read().decode("utf-8"))


def choices_of(spec: object) -> str:
    """把参数定义压成一行可读文本：枚举值（含默认值）。"""
    if not isinstance(spec, dict):
        return str(spec)
    kind = spec.get("type", "?")
    if kind == "choices":
        raw = spec.get("choices") or []
        vals = []
        for item in raw:
            if isinstance(item, dict):
                v, label = item.get("value"), item.get("label")
                vals.append(str(v) if label in (None, "", str(v)) else f"{v}({label})")
            else:
                vals.append(str(item))
        rendered = " / ".join(vals)
        if len(rendered) > 200:
            rendered = rendered[:197] + "…"
        default = spec.get("default")
        return f"{rendered}（默认 {default}）" if default is not None else rendered
    if kind == "set":
        items = spec.get("setItems")
        if isinstance(items, dict) and items:
            names = "、".join(str(k) for k in items.keys())
            return f"⛔ 高级嵌套参数（{names}）—— 工具层不开放，只能在画布 UI 里设置"
        raw = spec.get("choices") or spec.get("values") or []
        n = len(raw) if isinstance(raw, list) else "?"
        return f"可选集（{n} 项）"
    if kind == "switch":
        return f"开关（默认 {spec.get('default')}）"
    if "choices" in spec or "values" in spec:
        return choices_of({"type": "choices", **spec})
    return str(kind)


def params_line(model: dict) -> str:
    params = model.get("parameters") or {}
    parts = [f"`{k}`={choices_of(v)}" for k, v in params.items()]
    if model.get("maxPrompt"):
        parts.append(f"提示词上限 {model['maxPrompt']} 字")
    if model.get("point"):
        parts.append(f"**计费点 {model['point']}**")
    return "；".join(parts) if parts else "—（无额外参数）"


def render_block(title: str, modes: dict, kind: str) -> list[str]:
    lines = [f"## {title}", ""]
    for mode, block in (modes or {}).items():
        label = (block or {}).get("name") or ""
        lines.append(f"### `{mode}`{'（' + label + '）' if label else ''}")
        lines.append("")
        lines.append("| 模型 value | 展示名 | 可用参数（枚举/区间） |")
        lines.append("|---|---|---|")
        models = (block or {}).get("models") or {}
        for mid, model in models.items():
            lines.append(f"| `{mid}` | {model.get('model_name', '')} | {params_line(model)} |")
        lines.append("")
    return lines


def render_text(text: dict) -> list[str]:
    lines = ["## 文本节点模型（LLM，agent 不能配置、不能运行）", ""]
    lines.append("| 模型 value | 展示名 | 可用参数 |")
    lines.append("|---|---|---|")
    for mid, model in (text or {}).items():
        lines.append(f"| `{mid}` | {model.get('model_name', '')} | {params_line(model)} |")
    lines.append("")
    return lines


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", help="本地目录 JSON；省略则从远端拉取")
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "references" / "model-matrix.md"))
    args = ap.parse_args()

    if args.file:
        data = json.loads(Path(args.file).read_text(encoding="utf-8"))
        source = f"本地文件 {args.file}"
    else:
        data = fetch(args.url)
        source = args.url

    stamp = dt.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")
    out: list[str] = [
        "# 模型 × 模式 × 参数 快照",
        "",
        f"> 生成时间：{stamp}　｜　来源：`{source}`",
        "> **这是某一时刻的参照快照，不是运行期依据。** 任何配置前必须用 `canvas_models` 读当前账号的实时返回；",
        "> 本文件只用于规划阶段预估可用模型与参数形状。刷新方式：`python3 scripts/gen_model_matrix.py`。",
        "",
    ]
    out += render_text(data.get("text", {}))
    out += render_block("图像模型（image）", data.get("image", {}), "image")
    out += render_block("视频模型（video）", data.get("video", {}), "video")
    out += render_block("音频模型（audio，仅能创建节点，agent 不能运行/配参）", data.get("audio", {}), "audio")
    if data.get("imageLayoutTool"):
        out += render_block("图像分层工具（imageLayoutTool，agent 不可创建）", {"default": data["imageLayoutTool"]}, "imageLayoutTool")

    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"written {target} ({len(out)} lines)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
