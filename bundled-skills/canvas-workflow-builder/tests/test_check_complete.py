#!/usr/bin/env python3
"""check_complete.py 的离线单元测试（零成本、不联网）。

运行：
    python3 tests/test_check_complete.py

基线用 examples/canvas-nodes.sample.json —— 一份**真实**的未完成画布快照
（⑥ 有生成配置但无产物、画布名写"7 节点"实际 6 个），然后逐个补齐/注入缺陷。
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
SCRIPT = ROOT / "scripts" / "check_complete.py"
SAMPLE = ROOT / "examples" / "canvas-nodes.sample.json"

spec = importlib.util.spec_from_file_location("check_complete", SCRIPT)
cc = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(cc)  # type: ignore[union-attr]


def rules(snap: dict, expect: int | None = None) -> set[str]:
    errors, notes = cc.check(snap, expect)
    out = set()
    for line in errors + notes:
        if line.startswith("["):
            out.add(line[1:line.index("]")])
    return out


def main() -> int:
    base = json.loads(SAMPLE.read_text(encoding="utf-8"))
    checks: list[tuple[str, bool, str]] = []

    def expect(name: str, cond: bool, detail: str = "") -> None:
        checks.append((name, cond, detail))

    # 真实样本：不完整（⑥ 无产物）
    errors, notes = cc.check(base)
    expect("样本被判定不完整", bool(errors), str(errors))
    expect("K1 抓到未执行节点", any("K1" in e for e in errors), str(errors))
    expect("K6 抓到画布名与实际不符", any("K6" in n for n in notes), str(notes))

    # 补齐 ⑥ → 应通过（K6 只是 note，不阻塞）
    done = copy.deepcopy(base)
    for n in done["nodes"]:
        if n["title"].startswith("⑥"):
            n["outputs"] = ["https://x/3.jpg"]
            n["value"] = "https://x/3.jpg"
    done["name"] = "超跑电商海报工作流（6 节点）"
    errors2, notes2 = cc.check(done)
    expect("补齐后完整（0 error）", not errors2, str(errors2))
    expect("改名后无 K6", not any("K6" in n for n in notes2), str(notes2))

    # K2 空文本节点
    p = copy.deepcopy(done)
    p["nodes"].append({"id": "t_empty", "type": "text", "title": "空文案", "value": "", "params": {"prompt": ""},
                       "inputs": [], "outputs": []})
    expect("K2 空文本节点", "K2" in rules(p), str(cc.check(p)[0]))

    # K3 占位节点
    p = copy.deepcopy(done)
    p["nodes"].append({"id": "v_ph", "type": "video", "title": "待上传：参考视频", "value": "", "params": {},
                       "inputs": [], "outputs": []})
    expect("K3 占位节点", "K3" in rules(p), str(cc.check(p)[0]))

    # K4 内部逻辑节点
    p = copy.deepcopy(done)
    p["nodes"].append({"id": "t_note", "type": "text", "title": "交付自检清单", "value": "1. 检查外观",
                       "params": {}, "inputs": [], "outputs": []})
    expect("K4 内部逻辑节点", "K4" in rules(p), str(cc.check(p)[0]))

    # K5 孤立纯文本（有内容）→ note
    p = copy.deepcopy(done)
    p["nodes"].append({"id": "t_free", "type": "text", "title": "旁白素材", "value": "一段文字",
                       "params": {}, "inputs": [], "outputs": []})
    expect("K5 孤立节点提示", "K5" in rules(p), str(cc.check(p)[1]))

    # K7 期望节点数不一致
    errors7, _ = cc.check(done, expect_node_count=9)
    expect("K7 期望节点数不一致", any("K7" in e for e in errors7), str(errors7))

    # K8 孤立节点（给了 graph 才能精确判定）
    p = copy.deepcopy(done)
    p["nodes"].append({"id": "orphan", "type": "text", "title": "孤儿", "text": "孤", "inputs": []})
    g = {"edges": [{"id": "e1", "source": "n1", "target": "n2"}]}
    errors8, _ = cc.check(p, None, g)
    expect("K8 孤立节点（有 graph）", any("K8" in e for e in errors8), str(errors8))

    # K9 位置重叠
    p = copy.deepcopy(done)
    for n in p["nodes"]:
        n["position"] = {"x": 0, "y": 0}
        n["size"] = {"width": 400, "height": 400}
    errors9, _ = cc.check(p, None, None)
    expect("K9 位置重叠", any("K9" in e for e in errors9), str(errors9))

    # K10 下游文本节点未运行（有入边但正文为空）
    p = copy.deepcopy(done)
    t = next(n for n in p["nodes"] if n.get("type") == "text")
    t["text"] = ""
    t["value"] = ""
    t["inputs"] = [{"nodeId": "n1", "edgeId": "e9", "sourceHandle": "text_source", "targetHandle": "text_target"}]
    errors10, _ = cc.check(p, None, None)
    expect("K10 下游文本未运行", any("K10" in e for e in errors10), str(errors10))

    # K9 正常间距放行
    p = copy.deepcopy(done)
    for i, n in enumerate(p["nodes"]):
        n["position"] = {"x": i * 520, "y": 0}
        n["size"] = {"width": 400, "height": 400}
    errors_ok, _ = cc.check(p, None, None)
    expect("K9 正常间距放行", not any("K9" in e for e in errors_ok), str(errors_ok))

    # CLI 端到端
    with tempfile.TemporaryDirectory() as td:
        fp = Path(td) / "nodes.json"
        fp.write_text(json.dumps(base, ensure_ascii=False), encoding="utf-8")
        proc = subprocess.run([sys.executable, str(SCRIPT), str(fp)], capture_output=True, text=True)
        expect("CLI 不完整 → 退出码 1", proc.returncode == 1, proc.stdout[-200:])
        fp.write_text(json.dumps(done, ensure_ascii=False), encoding="utf-8")
        proc = subprocess.run([sys.executable, str(SCRIPT), str(fp), "--json"], capture_output=True, text=True)
        ok = proc.returncode == 0 and json.loads(proc.stdout)["ok"] is True
        expect("CLI 完整 → 退出码 0 且 --json 可解析", ok, proc.stdout[:200])

    failed = [c for c in checks if not c[1]]
    for name, ok, detail in checks:
        print(f"{'✅' if ok else '❌'} {name}" + (f"  ← {detail}" if not ok and detail else ""))
    print(f"\n{len(checks) - len(failed)}/{len(checks)} 通过")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
