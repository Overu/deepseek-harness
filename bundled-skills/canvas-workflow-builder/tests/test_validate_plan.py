#!/usr/bin/env python3
"""validate_plan.py 的离线单元测试（零成本、不联网、不触碰画布）。

运行：
    python3 tests/test_validate_plan.py

设计：以一份「正确计划」为基线，逐个注入缺陷，断言对应规则命中。
"""

from __future__ import annotations

import copy
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("validate_plan", ROOT / "scripts" / "validate_plan.py")
vp = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(vp)  # type: ignore[union-attr]


def base_plan() -> dict:
    """一份正确计划：1 素材图 + 1 代笔文本 + 2 个生成节点（A2 原型）。"""
    return {
        "goal": "用商品图做 2 张 3:4 电商主图",
        "archetype": "A2",
        "brief": {
            "deliverables": [{"kind": "image", "count": 2, "ratio": "3:4", "resolution": "4K"}],
            "assets": [
                {
                    "role": "商品图",
                    "kind": "image",
                    "uploader": "agent",
                    "source": "attachment",
                    "nodeLocalId": "in1",
                }
            ],
            "text": {"title": "轻薄保温杯", "price": "129"},
            "style": "高级银灰",
            "compliance": ["无绝对化用语"],
        },
        "nodes": [
            {"localId": "in1", "role": "input", "type": "image", "title": "商品实拍图"},
            {
                "localId": "t1",
                "role": "text",
                "type": "text",
                "title": "卖点文案",
                "textMode": "copy",
                "text": "标题：轻薄保温杯\n卖点：24h 保温｜316 内胆｜一手可握\n价格：¥129",
            },
            {
                "localId": "g1",
                "role": "generator",
                "type": "image",
                "title": "主图-银灰",
                "prompt": "图1 为商品参考，保持外观、logo 与比例一致；银灰渐变背景，居中构图，3:4 竖版，商业摄影质感。",
                "config": {
                    "modelType": "reference_image_to_image",
                    "model": "gpt-image-2",
                    "params": {"aspect_ratio": "3:4", "resolution": "4K", "quality": "high", "gen_count": 1},
                },
            },
            {
                "localId": "g2",
                "role": "generator",
                "type": "image",
                "title": "主图-暖光",
                "prompt": "图1 为商品参考，保持外观一致；暖光木质台面背景，右下角价格标签，3:4 竖版。",
                "config": {
                    "modelType": "reference_image_to_image",
                    "model": "gpt-image-2",
                    "params": {"aspect_ratio": "3:4", "resolution": "4K", "gen_count": 1},
                },
            },
        ],
        "edges": [
            {"from": "in1", "to": "g1", "sourceHandle": "image_source", "targetHandle": "image_target"},
            {"from": "in1", "to": "g2", "sourceHandle": "image_source", "targetHandle": "image_target"},
            {"from": "t1", "to": "g1", "sourceHandle": "text_source", "targetHandle": "text_target"},
            {"from": "t1", "to": "g2", "sourceHandle": "text_source", "targetHandle": "text_target"},
        ],
        "runs": ["g1", "g2"],
        "manualSteps": [],
        "estimate": {"images": 2, "videos": 0, "points": "26-1790", "needsConfirmation": False},
        "acceptance": ["商品外观与参考图一致", "中文无错字", "无绝对化用语"],
    }


def run(plan: dict) -> vp.Report:
    rep = vp.Report()
    vp.check(plan, rep)
    return rep


def rules_hit(rep: vp.Report) -> set[str]:
    return {r for _, r, _ in rep.items}


def main() -> int:
    checks: list[tuple[str, bool, str]] = []

    def expect(name: str, cond: bool, detail: str = "") -> None:
        checks.append((name, cond, detail))

    # 基线：无 ERROR
    rep = run(base_plan())
    expect("基线计划 0 error", not rep.errors, f"errors={[m for _, _, m in rep.errors]}")

    # R1 localId 重复
    p = base_plan(); p["nodes"].append(copy.deepcopy(p["nodes"][0]))
    expect("R1 localId 重复", "R1" in rules_hit(run(p)))

    # R2 悬空引用
    p = base_plan(); p["edges"][0]["to"] = "nope"
    expect("R2 悬空引用", "R2" in rules_hit(run(p)))

    # R2 自环
    p = base_plan(); p["edges"].append({"from": "g1", "to": "g1", "sourceHandle": "image_source", "targetHandle": "image_target"})
    expect("R2 自环", "R2" in rules_hit(run(p)))

    # R2 runs 含非生成节点
    p = base_plan(); p["runs"] = ["t1"]
    expect("R2 runs 只能含 image/video", "R2" in rules_hit(run(p)))

    # R3 成环
    p = base_plan()
    p["nodes"].append({"localId": "g3", "role": "generator", "type": "image", "title": "三", "prompt": "保持图1外观一致",
                       "config": {"modelType": "reference_image_to_image", "model": "gpt-image-2", "params": {}}})
    p["edges"] += [
        {"from": "g1", "to": "g3", "sourceHandle": "image_source", "targetHandle": "image_target"},
        {"from": "g3", "to": "g1", "sourceHandle": "image_source", "targetHandle": "image_target"},
    ]
    expect("R3 成环", "R3" in rules_hit(run(p)))

    # R4 生成节点无输入
    p = base_plan()
    p["nodes"].append({"localId": "g9", "role": "generator", "type": "image", "title": "孤儿",
                       "prompt": "纯文生图：银色保温杯产品图", "config": {"modelType": "text_to_image", "model": "gpt-image-2", "params": {}}})
    p["runs"].append("g9")
    expect("R4 无输入生成节点", "R4" in rules_hit(run(p)))

    # R4 allowNoInput 放行
    p = base_plan()
    p["nodes"].append({"localId": "g9", "role": "generator", "type": "image", "title": "纯文生图", "allowNoInput": True,
                       "prompt": "银色保温杯产品图", "config": {"modelType": "text_to_image", "model": "gpt-image-2", "params": {}}})
    p["runs"].append("g9")
    rep = run(p)
    expect("R4 allowNoInput 放行", not any(r == "R4" for _, r, _ in rep.items))

    # R5 端口与节点类型不符
    p = base_plan(); p["edges"][0]["sourceHandle"] = "text_source"
    expect("R5 端口与类型不符", "R5" in rules_hit(run(p)))

    # R5 缺端口
    p = base_plan(); del p["edges"][0]["targetHandle"]
    expect("R5 缺端口", "R5" in rules_hit(run(p)))

    # R6 非法连法 image → audio
    p = base_plan()
    p["nodes"].append({"localId": "a1", "role": "generator", "type": "audio", "title": "配音"})
    p["edges"].append({"from": "in1", "to": "a1", "sourceHandle": "image_source", "targetHandle": "audio_target"})
    expect("R6 image→audio 非法", "R6" in rules_hit(run(p)))

    # R6 合法连法 video → text（视频反推）
    p = base_plan()
    p["nodes"] += [
        {"localId": "v1", "role": "input", "type": "video", "title": "参考视频"},
        {"localId": "t2", "role": "text", "type": "text", "title": "反推脚本", "textMode": "copy", "text": "分镜描述"},
    ]
    p["edges"].append({"from": "v1", "to": "t2", "sourceHandle": "video_source", "targetHandle": "video_target"})
    expect("R6 video→text 合法", not any(r == "R6" for _, r, _ in run(p).items))

    # R7 旧参数名
    p = base_plan(); p["nodes"][2]["config"]["params"]["times"] = 1
    expect("R7 旧参数名", "R7" in rules_hit(run(p)))

    # R7 旧模型名
    p = base_plan(); p["nodes"][2]["config"]["model"] = "gemini-3-pro-preview"
    expect("R7 旧模型名", "R7" in rules_hit(run(p)))

    # R8 文本节点配 modelType
    p = base_plan(); p["nodes"][1]["config"] = {"modelType": "text_to_image", "model": "gpt-image-2"}
    expect("R8 文本节点不得配模型", "R8" in rules_hit(run(p)))

    # R9 llm 模式缺 prompt / 未登记 manualSteps
    p = base_plan()
    p["nodes"].append({"localId": "t9", "role": "text", "type": "text", "title": "灵感", "textMode": "llm"})
    expect("R9 llm 缺 prompt", "R9" in rules_hit(run(p)))

    p = base_plan()
    p["nodes"].append({"localId": "t9", "role": "text", "type": "text", "title": "灵感", "textMode": "llm", "prompt": "输出 2 段描述"})
    expect("R9 llm 未登记 manualSteps", "R9" in rules_hit(run(p)))

    p = base_plan()
    p["nodes"].append({"localId": "t9", "role": "text", "type": "text", "title": "灵感", "textMode": "llm", "prompt": "输出 2 段描述"})
    p["manualSteps"].append({"node": "t9", "reason": "文本节点 agent 不可执行", "action": "在画布点生成，或改为 copy 模式"})
    expect("R9 llm 登记后放行", not any(r == "R9" for _, r, _ in run(p).items))

    # R10 生成节点缺 model/modelType
    p = base_plan(); del p["nodes"][2]["config"]["model"]
    expect("R10 缺 model", "R10" in rules_hit(run(p)))

    # R11 素材缺 source
    p = base_plan(); del p["brief"]["assets"][0]["source"]
    expect("R11 素材缺 source", "R11" in rules_hit(run(p)))

    # R12 视频素材可由 agent 导入（alpha.30 起支持 attachment/conversation_asset/workspace_file）
    p = base_plan()
    p["brief"]["assets"].append({"role": "参考视频", "kind": "video", "uploader": "agent", "source": "attachment"})
    expect("R12 视频素材可 agent 导入", "R12" not in rules_hit(run(p)))

    # R12 agent 声明 user_upload 非法
    p = base_plan()
    p["brief"]["assets"].append({"role": "参考视频", "kind": "video", "uploader": "agent", "source": "user_upload"})
    expect("R12 agent 不得声明 user_upload", "R12" in rules_hit(run(p)))

    # R12 视频素材 user 上传但未登记 manualSteps
    p = base_plan()
    p["brief"]["assets"].append({"role": "参考视频", "kind": "video", "uploader": "user", "source": "user_upload", "nodeLocalId": "in1"})
    expect("R12 用户上传须登记", "R12" in rules_hit(run(p)) or "R11" in rules_hit(run(p)))

    # R13 数量闸门
    p = base_plan(); p["estimate"] = {"images": 40, "videos": 0, "needsConfirmation": False}
    expect("R13 数量闸门", "R13" in rules_hit(run(p)))

    # R14 禁用能力
    p = base_plan(); p["nodes"].append({"localId": "x1", "role": "input", "type": "image", "title": "组节点 group"})
    expect("R14 group 扫描", "R14" in rules_hit(run(p)))

    p = base_plan(); p["nodes"].append({"localId": "x2", "role": "generator", "type": "image", "title": "multiViewTool 多视角"})
    expect("R14 工具节点扫描", "R14" in rules_hit(run(p)))

    # R15 placement 与 position 冲突
    p = base_plan()
    p["nodes"][2]["placement"] = {"mode": "absolute", "position": {"x": 1, "y": 2}}
    p["nodes"][2]["position"] = {"x": 3, "y": 4}
    expect("R15 放置冲突", "R15" in rules_hit(run(p)))

    # R16 提示词缺主体锁定（warning）
    p = base_plan(); p["nodes"][2]["prompt"] = "生成一张好看的银灰背景海报"
    expect("R16 缺主体锁定告警", "R16" in rules_hit(run(p)))

    # R17 绝对化用语
    p = base_plan(); p["nodes"][1]["text"] = "全网最好的保温杯，销量第一"
    expect("R17 绝对化用语", "R17" in rules_hit(run(p)))

    # R17 豁免：讲合规规则时不该误报（"无绝对化用语" 里的"绝对"）
    p = base_plan(); p["nodes"][1]["text"] = "合规要求：不使用绝对化用语，不写「第一」「100%」"
    expect("R17 豁免合规说明", not any(r == "R17" for _, r, _ in run(p).items))

    # R17 豁免不应当过宽：真的在用还是要报
    p = base_plan(); p["nodes"][1]["text"] = "无与伦比的最好选择"
    expect("R17 不误豁免真违规", "R17" in rules_hit(run(p)))

    # R17 混合：先讲规则、后真的用了 → 仍要报
    p = base_plan(); p["nodes"][1]["text"] = "不使用绝对化用语。标题：全国第一"
    expect("R17 规则+真违规混合", "R17" in rules_hit(run(p)))

    # R19 内部逻辑不得建节点（自检清单等旁注节点）
    p = base_plan()
    p["nodes"].append({"localId": "t_note", "role": "text", "type": "text",
                       "title": "交付自检清单（旁注）", "textMode": "copy", "text": "1. 检查外观"})
    expect("R19 旁注节点被拦", "R19" in rules_hit(run(p)))

    # R19 正常文案节点不受影响
    p = base_plan()
    p["nodes"].append({"localId": "t2", "role": "text", "type": "text",
                       "title": "促销文案", "textMode": "copy", "text": "限时特惠"})
    expect("R19 正常节点放行", not any(r == "R19" for _, r, _ in run(p).items))

    # R18 估算不一致（warning）
    p = base_plan(); p["estimate"]["images"] = 5
    expect("R18 估算不一致告警", "R18" in rules_hit(run(p)))

    # R22 孤立节点（挂一个谁都不连的文本节点）
    p = base_plan()
    p["nodes"].append({"localId": "orphan", "role": "text", "type": "text",
                       "title": "备用素材", "textMode": "copy", "text": "孤"})
    expect("R22 孤立节点被拦", "R22" in rules_hit(run(p)))

    # R23 坐标重叠（两个 3:4 节点只错开 20px）
    p = base_plan()
    for n in p["nodes"]:
        n["placement"] = {"mode": "absolute", "position": {"x": 0, "y": 0}}
    expect("R23 坐标重叠被拦", "R23" in rules_hit(run(p)))

    # R23 正常间距放行
    p = base_plan()
    for i, n in enumerate(p["nodes"]):
        n["placement"] = {"mode": "absolute", "position": {"x": i * 520, "y": 0}}
    expect("R23 正常间距放行", "R23" not in rules_hit(run(p)))

    # R24 下游文本节点未登记 manualSteps
    p = base_plan()
    p["nodes"].append({"localId": "t_llm", "role": "text", "type": "text", "title": "文案适配",
                       "textMode": "llm", "prompt": "结合【brief】写 3 条卖点"})
    p["edges"].append({"from": "t1", "to": "t_llm", "sourceHandle": "text_source", "targetHandle": "text_target"})
    p["manualSteps"] = []
    expect("R24 下游文本未登记被拦", "R24" in rules_hit(run(p)))

    # R24 登记后放行
    p["manualSteps"] = [{"node": "t_llm", "reason": "LLM 下游节点需用户运行", "action": "在画布内点运行"}]
    expect("R24 登记 manualSteps 后放行", "R24" not in rules_hit(run(p)))

    # R25 视频接音频但 prompt 没声明用音频
    p = base_plan()
    p["nodes"].append({"localId": "v1", "role": "generator", "type": "video", "title": "镜头1",
                       "prompt": "保持图1人物一致，雨夜驾驶室，缓慢推镜。",
                       "config": {"modelType": "reference_image_to_video",
                                  "model": "seedance-2.5-vip-r2v",
                                  "params": {"aspect_ratio": "9:16", "duration": 6, "resolution": "480p"}}})
    p["nodes"].append({"localId": "a2", "role": "generator", "type": "audio", "title": "旁白1",
                       "prompt": "二〇〇三年冬。",
                       "config": {"modelType": "tts", "model": "speech-2.8-turbo",
                                  "voiceId": "male-qn-jingying"}})
    p["edges"].append({"from": "g1", "to": "v1", "sourceHandle": "image_source", "targetHandle": "image_target"})
    p["edges"].append({"from": "a2", "to": "v1", "sourceHandle": "audio_source", "targetHandle": "audio_target"})
    expect("R25 视频接音频但 prompt 未声明被拦", "R25" in rules_hit(run(p)))

    # R25 声明后放行
    p["nodes"][-2]["prompt"] = ("使用连入的图片1和音频1生成这条视频：图片1是画面底本，音频1是这条视频的音轨，"
                                "原样使用、逐字对齐。\n保持图1人物一致，雨夜驾驶室，缓慢推镜。")
    expect("R25 声明使用连入音频后放行", "R25" not in rules_hit(run(p)))

    # R26 runs 顺序颠倒（视频排在它的图片/音频上游之前）
    p26 = base_plan()
    p26["nodes"].append({"localId": "v1", "role": "generator", "type": "video", "title": "镜头1",
                         "prompt": "使用连入的图片1和音频1生成这条视频：音频1是音轨，原样使用。",
                         "config": {"modelType": "reference_image_to_video",
                                    "model": "seedance-2.5-vip-r2v",
                                    "params": {"aspect_ratio": "9:16", "duration": 6, "resolution": "480p"}}})
    p26["nodes"].append({"localId": "a2", "role": "generator", "type": "audio", "title": "旁白1",
                         "prompt": "二〇〇三年冬。",
                         "config": {"modelType": "tts", "model": "speech-2.8-turbo",
                                    "voiceId": "male-qn-jingying"}})
    p26["edges"].append({"from": "g1", "to": "v1", "sourceHandle": "image_source", "targetHandle": "image_target"})
    p26["edges"].append({"from": "a2", "to": "v1", "sourceHandle": "audio_source", "targetHandle": "audio_target"})
    p26["runs"] = ["v1", "a2", "g1", "g2"]
    expect("R26 runs 逆序被拦", "R26" in rules_hit(run(p26)))

    # TTS 台词直写 prompt（零入边）应合法
    p = {
        "goal": "单条配音", "archetype": "A8",
        "nodes": [{"localId": "a1", "role": "generator", "type": "audio", "title": "旁白",
                   "prompt": "凌晨一点，城市把最后一批加班的人放回街上。",
                   "config": {"modelType": "tts", "model": "speech-2.8-turbo",
                              "voiceId": "male-qn-jingying", "seniorParams": {"speed": 0.9}}}],
        "edges": [], "runs": ["a1"], "manualSteps": [],
        "estimate": {"images": 0, "videos": 0, "audios": 1},
    }
    expect("prompt 直写 TTS 零入边放行", not run(p).errors, f"errors={[m for _, _, m in run(p).errors]}")

    # 文本边 + prompt 同时写 → warning
    p2 = copy.deepcopy(p)
    p2["nodes"].insert(0, {"localId": "tx", "role": "text", "type": "text", "title": "台词",
                           "textMode": "copy", "text": "x"})
    p2["edges"] = [{"from": "tx", "to": "a1", "sourceHandle": "text_source", "targetHandle": "text_target"}]
    expect("TTS 边+prompt 双写告警", "R10" in rules_hit(run(p2)))

    # 两边都空 → error
    p3 = copy.deepcopy(p); p3["nodes"][0]["prompt"] = ""
    expect("TTS 无台词被拦", "R10" in rules_hit(run(p3)))

    # 端到端：写临时文件跑 CLI
    with tempfile.TemporaryDirectory() as td:
        fp = Path(td) / "plan.json"
        fp.write_text(json.dumps(base_plan(), ensure_ascii=False), encoding="utf-8")
        import subprocess

        proc = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "validate_plan.py"), str(fp)],
            capture_output=True, text=True,
        )
        expect("CLI 基线退出码 0", proc.returncode == 0, proc.stdout[-300:])
        fp.write_text(json.dumps({**base_plan(), "runs": ["t1"]}, ensure_ascii=False), encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "validate_plan.py"), str(fp), "--json"],
            capture_output=True, text=True,
        )
        expect("CLI 缺陷计划退出码 1", proc.returncode == 1, proc.stdout[-300:])
        expect("CLI --json 可解析", json.loads(proc.stdout)["ok"] is False, proc.stdout[:200])

    failed = [c for c in checks if not c[1]]
    for name, ok, detail in checks:
        print(f"{'✅' if ok else '❌'} {name}" + (f"  ← {detail}" if not ok and detail else ""))
    print(f"\n{len(checks) - len(failed)}/{len(checks)} 通过")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
