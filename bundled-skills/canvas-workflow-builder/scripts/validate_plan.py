#!/usr/bin/env python3
"""validate_plan.py —— 画布工作流计划的离线静态校验（零成本、不触碰画布）。

用法：
    python3 validate_plan.py plan.json            # 人读报告，0 error 才可施工
    python3 validate_plan.py plan.json --json     # 机器可读结果
    python3 validate_plan.py plan.json --strict   # 把 warning 也当失败

校验规则（ERROR = 必须修；WARN = 需确认或说明理由）：
    R1  结构完整性：必填字段、节点 localId 唯一、类型枚举合法、标题 ≤100、正文/提示词 ≤32768
    R2  引用完整性：edges/runs/manualSteps 的 localId 必须存在；禁止自环
    R3  无环：依赖图必须是 DAG（成环的图整图执行会被原生拒绝）
    R4  生成节点可达性：每个 generator 至少 1 条输入边，或显式声明 text_to_image（无输入）
    R5  端口合法性：sourceHandle/targetHandle 必须与来源/目标节点类型匹配
    R6  连线矩阵：source 类型 → target 类型必须在允许矩阵内（同媒体前缀 或 目标允许集含源媒体）
    R7  参数名新旧：出现 times/image_size/size/ratio/seconds 等旧名 → ERROR 并给映射
    R8  文本节点边界：不得有 modelType；params 不得含 model/modelType/prompt
    R9  文本节点双模式：llm 模式必须有 prompt 且登记 manualSteps；copy 模式必须有正文
    R10 配置完整性：image/video 生成节点必须给出 config.modelType + config.model（运行期须以实时目录复核）
    R11 素材合法性：input 节点必须声明 source；uploader=user 的素材必须登记 manualSteps
    R12 素材来源合法：agent 不得声明 user_upload；视频/音频可由 agent 通过四类来源导入
    R13 数量闸门：images>30 或 videos>6 → estimate.needsConfirmation 必须为 true
    R14 禁用能力扫描：group / 工具节点（*Tool）/ 模板实例化 / 整图运行 / 复制节点
    R15 放置冲突：同一节点不得同时给 placement 与 position
    R16 提示词自包含性：有图片输入的生成节点，提示词应含主体锁定词（保持/一致/不变/参考）
    R17 合规红线：提示词/正文/标题中出现绝对化用语
    R18 估算一致性：estimate.images/videos 应与 runs 中节点类型统计一致（不一致 → WARN）
    R19 内部逻辑不入画布：自检清单/合规检查/话术/说明类"旁注节点"必须删掉（ERROR）
    R20 模式门：image/video 的 modelType 必须与入边素材匹配（WARN/ERROR）
    R21（并入 R10）TTS 必须配 modelType=tts 与 voiceId
    R22 孤立节点：每个节点至少参与一条边（单节点画布放行）
    R23 布局重叠：absolute 坐标下按 aspect_ratio 估算的节点矩形不得相交
    R24 下游文本节点必须运行：text 节点有入边时必须登记 manualSteps（LLM 下游，agent 跑不了）
    R25 视频节点接了音频入边：prompt 必须声明“使用连入的图片N和音频N”，且 modelType 必须是 reference_image_to_video
    R26 runs 顺序：上游必须先于下游出现（否则下游拿不到产物就开始跑）
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ERROR, WARN = "ERROR", "WARN"

LEGACY_PARAM_MAP = {
    "times": "gen_count",
    "image_size": "resolution",
    "size": "resolution",
    "ratio": "aspect_ratio",
    "duration_seconds": "duration",
    "seconds": "duration",
}

LEGACY_MODEL_MAP = {"gemini-3-pro-preview": "gemini-3.1-preview? → gemini-3.1-pro-preview"}

ALLOWED_TARGETS = {
    "text": {"text", "image", "video"},
    "image": {"text", "image"},
    "video": {"text", "image", "video", "audio"},
    "audio": {"text", "audio"},
}

HANDLE_MEDIA = {
    "text_source": "text",
    "image_source": "image",
    "video_source": "video",
    "audio_source": "audio",
    "text_target": "text",
    "image_target": "image",
    "video_target": "video",
    "audio_target": "audio",
}

GENERATOR_TYPES = {"image", "video", "audio"}
RUNNABLE_AUDIO_MODE = "tts"
STANDARD_NODE_TYPES = {"text", "image", "video", "audio"}

COMPLIANCE_BLACKLIST = ["最佳", "最好", "最强", "最优", "第一", "国家级", "100%", "绝对", "顶级", "唯一", "史上"]

REFERENCE_LOCK_WORDS = ["保持", "一致", "不变", "参考", "图1", "参考图"]

# R25：视频节点有音频入边时，prompt 必须出现“使用连入音频”的肯定表达
AUDIO_USE_HINTS = ["音频1", "音频2", "音频3", "@Audio", "@音频", "音频素材", "连入的音频", "连入音频"]
# R25 的反向信号：这些句子会把模型推去“自行生成音轨”
AUDIO_NEG_HINTS = ["不添加音效", "不添加任何音效", "不要音效", "无需音效", "不需要音频", "不要音频", "垫底", "不要配音", "无需配音"]

# R17 的豁免语境：这些词出现在「合规要求/禁用词说明」里，不是在用绝对化用语本身。
# 例：正文写「无不使用绝对化用语」——「绝对」是规则名，不该报错。
COMPLIANCE_MENTION_HINTS = ["不使用", "禁用", "禁止", "严禁", "避免", "不得", "不写", "不要写", "勿", "规避", "红线", "合规", "违规", "忌用"]
COMPLIANCE_MENTION_SUFFIXES = ["化用语", "化表述", "化词汇", "化词", "用语"]

# R19：这些词出现在节点标题里 → 说明它是个"内部逻辑"节点，不该建到画布上
INTERNAL_NOTE_MARKERS = ["自检", "检查清单", "清单", "旁注", "不参与生成", "注意事项", "交付话术", "参数说明", "备忘", "TODO"]

FORBIDDEN_CAPABILITIES = [
    (r"\bgroup\b|组节点|创建组", "group 组节点（工具层不支持）"),
    (r"[a-zA-Z]+Tool\b|multiViewTool|poseTool|storyboardTool|highDefinitionTool", "工具节点（不能创建）"),
    (r"模板实例化|实例化模板|apply_template|canvas-template/get", "模板实例化（无公开入口）"),
    (r"整图运行|整批运行|一键执行|run_all|batch_run", "整图/整批运行（无公开入口）"),
    (r"复制节点|copyNode|copy_node", "复制节点（无公开入口）"),
]


def is_compliance_mention(text: str, term: str, window: int = 10) -> bool:
    """判断 term 是否只是在"讲合规规则"，而不是真的把绝对化用语写进了画面/文案。

    豁免条件（任一条成立即豁免该次出现）：
      ① term 后紧跟「化用语 / 化表述 / 用语」等规则性后缀（如「绝对化用语」）；
      ② term 前 window 个字符内出现「不使用 / 禁用 / 避免 / 不得 / 合规 …」这类约束词。
    只要有任何一次出现**不满足**豁免条件，就判定为"真的在用"，返回 False。
    """
    idx = text.find(term)
    if idx < 0:
        return False
    while idx >= 0:
        tail = text[idx + len(term): idx + len(term) + 4]
        exempt = any(tail.startswith(suf) for suf in COMPLIANCE_MENTION_SUFFIXES) or any(
            hint in text[max(0, idx - window): idx] for hint in COMPLIANCE_MENTION_HINTS
        )
        if not exempt:
            return False
        idx = text.find(term, idx + len(term))
    return True


class Report:
    def __init__(self) -> None:        self.items: list[tuple[str, str, str]] = []

    def error(self, rule: str, msg: str) -> None:
        self.items.append((ERROR, rule, msg))

    def warn(self, rule: str, msg: str) -> None:
        self.items.append((WARN, rule, msg))

    @property
    def errors(self) -> list[tuple[str, str, str]]:
        return [i for i in self.items if i[0] == ERROR]

    @property
    def warnings(self) -> list[tuple[str, str, str]]:
        return [i for i in self.items if i[0] == WARN]


def check(plan: dict, rep: Report) -> None:
    nodes = plan.get("nodes") or []
    edges = plan.get("edges") or []
    runs = plan.get("runs") or []
    manual = plan.get("manualSteps") or []
    estimate = plan.get("estimate") or {}

    # ---------- R1 结构完整性 ----------
    if not plan.get("goal"):
        rep.error("R1", "缺少 goal")
    if not nodes:
        rep.error("R1", "nodes 为空：没有任何节点")
    by_id: dict[str, dict] = {}
    for i, n in enumerate(nodes):
        lid = n.get("localId")
        if not lid:
            rep.error("R1", f"nodes[{i}] 缺少 localId")
            continue
        if lid in by_id:
            rep.error("R1", f"localId 重复：{lid}")
        by_id[lid] = n
        ntype = n.get("type")
        if ntype not in STANDARD_NODE_TYPES:
            rep.error("R1", f"{lid}: type={ntype!r} 不是标准节点（只能是 text/image/video/audio）")
        if n.get("role") not in {"input", "text", "generator"}:
            rep.error("R1", f"{lid}: role 必须是 input/text/generator")
        title = n.get("title") or ""
        if len(title) > 100:
            rep.error("R1", f"{lid}: title 超过 100 字符")
        for field in ("text", "prompt"):
            if len(n.get(field) or "") > 32768:
                rep.error("R1", f"{lid}: {field} 超过 32768 字符")

    # ---------- R15 放置冲突 ----------
    for lid, n in by_id.items():
        if n.get("placement") and n.get("position"):
            rep.error("R15", f"{lid}: placement 与 position 互斥（工具层会报 INVALID_ARGUMENT）")

    # ---------- R2 引用完整性 / 自环 ----------
    for i, e in enumerate(edges):
        src, dst = e.get("from"), e.get("to")
        if src not in by_id or dst not in by_id:
            rep.error("R2", f"edges[{i}]: from/to 指向不存在的 localId（{src} → {dst}）")
            continue
        if src == dst:
            rep.error("R2", f"edges[{i}]: 禁止自环（{src}）")
    for lid in runs:
        if lid not in by_id:
            rep.error("R2", f"runs 中的 {lid} 不存在")
            continue
        ntype = by_id[lid].get("type")
        if ntype not in GENERATOR_TYPES:
            rep.error("R2", f"runs 只能包含 image/video/TTS audio 节点，但给了 {lid}({ntype})")
        elif ntype == "audio" and (by_id[lid].get("config") or {}).get("modelType") != RUNNABLE_AUDIO_MODE:
            rep.error("R2", f"{lid}: audio 只有配置为 TTS（modelType='tts'）才可运行；音乐/翻唱不在公开范围")
    for i, m in enumerate(manual):
        if m.get("node") not in by_id:
            rep.error("R2", f"manualSteps[{i}] 指向不存在的节点 {m.get('node')}")

    # ---------- R3 无环 ----------
    adj: dict[str, list[str]] = {lid: [] for lid in by_id}
    for e in edges:
        if e.get("from") in by_id and e.get("to") in by_id:
            adj[e["from"]].append(e["to"])
    color: dict[str, int] = {}

    def dfs(u: str, stack: list[str]) -> None:
        color[u] = 1
        for v in adj.get(u, []):
            if color.get(v) == 1:
                rep.error("R3", "存在环：" + " → ".join(stack + [u, v]))
            elif color.get(v, 0) == 0:
                dfs(v, stack + [u])
        color[u] = 2

    for lid in by_id:
        if color.get(lid, 0) == 0:
            dfs(lid, [])

    # ---------- R5/R6 端口与连线矩阵 ----------
    for i, e in enumerate(edges):
        src, dst = e.get("from"), e.get("to")
        if src not in by_id or dst not in by_id:
            continue
        s_type, t_type = by_id[src].get("type"), by_id[dst].get("type")
        sh, th = e.get("sourceHandle"), e.get("targetHandle")
        if not sh or not th:
            rep.error("R5", f"edges[{i}]({src}→{dst}): 必须显式写 sourceHandle/targetHandle")
            continue
        if sh not in HANDLE_MEDIA or th not in HANDLE_MEDIA:
            rep.error("R5", f"edges[{i}]: 端口名非法（{sh} / {th}）")
            continue
        if not sh.endswith("_source"):
            rep.error("R5", f"edges[{i}]: sourceHandle 必须以 _source 结尾")
        if not th.endswith("_target"):
            rep.error("R5", f"edges[{i}]: targetHandle 必须以 _target 结尾")
        # 来源媒体的端口必须与该节点实际输出类型一致
        if HANDLE_MEDIA[sh] != s_type:
            rep.error("R5", f"edges[{i}]: 来源是 {s_type} 节点，却用 {sh}")
        # 目标端口必须是目标节点真实拥有的端口
        if HANDLE_MEDIA[th] not in ALLOWED_TARGETS.get(t_type, set()):
            rep.error("R5", f"edges[{i}]: {t_type} 节点没有 {th} 输入端口")
            continue
        # 连线矩阵
        if HANDLE_MEDIA[sh] == HANDLE_MEDIA[th]:
            continue  # 同媒体前缀直接放行
        if HANDLE_MEDIA[sh] not in ALLOWED_TARGETS[t_type]:
            rep.error(
                "R6",
                f"edges[{i}]: {s_type} → {t_type} 不被允许（{t_type} 只接受 "
                f"{'/'.join(sorted(ALLOWED_TARGETS[t_type]))}）",
            )

    # ---------- R4 生成节点可达性 ----------
    incoming: dict[str, list[dict]] = {lid: [] for lid in by_id}
    for e in edges:
        if e.get("to") in incoming:
            incoming[e["to"]].append(e)
    for lid, n in by_id.items():
        if n.get("role") != "generator":
            continue
        if n.get("type") not in GENERATOR_TYPES:
            continue
        # TTS 台词直写 prompt 时没有入边是合法的（2026-10-21 实测可出音频）
        if n.get("type") == "audio" and (n.get("prompt") or "").strip():
            continue
        if not incoming[lid] and not n.get("allowNoInput"):
            rep.error(
                "R4",
                f"{lid}: 生成节点没有任何输入边；若确为纯文生图，请显式加 \"allowNoInput\": true",
            )

    # ---------- R7 参数新旧名 ----------
    def scan_params(where: str, params: dict) -> None:
        for k in params or {}:
            if k in LEGACY_PARAM_MAP:
                rep.error("R7", f"{where}: 参数名 {k!r} 是旧字段，请改为 {LEGACY_PARAM_MAP[k]!r}")

    for lid, n in by_id.items():
        cfg = n.get("config") or {}
        scan_params(lid, cfg.get("params") or {})
        model = cfg.get("model")
        if isinstance(model, str) and model in LEGACY_MODEL_MAP:
            rep.error("R7", f"{lid}: 模型名 {model!r} 已下线，请用 gemini-3.1-pro-preview")

    # ---------- R8/R9/R10 文本节点与生成节点配置 ----------
    for lid, n in by_id.items():
        ntype = n.get("type")
        cfg = n.get("config") or {}
        if ntype == "text":
            if cfg.get("modelType") or cfg.get("model"):
                rep.error("R8", f"{lid}: 文本节点不得配置 modelType/model（工具层不支持，只能 UI 选）")
            if cfg.get("params"):
                bad = [k for k in cfg["params"] if k in {"model", "modelType", "prompt"}]
                if bad:
                    rep.error("R8", f"{lid}: params 不得包含 {bad}")
            mode = n.get("textMode")
            if mode == "llm":
                if not (n.get("prompt") or "").strip():
                    rep.error("R9", f"{lid}: textMode=llm 必须有 prompt（LLM 指令）")
                if lid not in {m.get("node") for m in manual}:
                    rep.error("R9", f"{lid}: textMode=llm 的节点 agent 跑不了，必须登记到 manualSteps")
            elif mode == "copy":
                if not (n.get("text") or "").strip():
                    rep.error("R9", f"{lid}: textMode=copy 必须有 text 正文")
            else:
                rep.warn("R9", f"{lid}: 文本节点未标注 textMode（llm 还是 copy？）")
        if n.get("role") == "generator" and ntype in GENERATOR_TYPES:
            if not cfg.get("modelType") or not cfg.get("model"):
                rep.error("R10", f"{lid}: 生成节点必须给出 config.modelType 与 config.model（运行期以 canvas_models 复核）")
            if ntype == "audio":
                if cfg.get("modelType") != RUNNABLE_AUDIO_MODE:
                    rep.error("R10", f"{lid}: audio 生成节点必须 modelType='tts'")
                if not cfg.get("voiceId"):
                    rep.error("R10", f"{lid}: TTS 必须给出 config.voiceId（voiceSelection.required）")
                has_text_edge = any(
                    HANDLE_MEDIA.get(e.get("sourceHandle", "")) == "text" for e in incoming.get(lid, [])
                )
                has_prompt = bool((n.get("prompt") or "").strip())
                # 2026-10-21 实测：audio 的 prompt 就是待朗读文本，零入边也能出音频
                if not has_text_edge and not has_prompt:
                    rep.error(
                        "R10",
                        f"{lid}: TTS 既没有文本入边、prompt 也为空 —— 没有可朗读内容；"
                        "台词可直接写进该节点 prompt，或接一条 text 边",
                    )
                elif has_text_edge and has_prompt:
                    rep.warn("R10", f"{lid}: 既有文本入边又写了 prompt，会读两遍/算两遍字符；二选一")
            elif not (n.get("prompt") or "").strip():
                rep.error("R10", f"{lid}: 生成节点必须有 prompt")

    # ---------- R11/R12 素材合法性 ----------
    brief = plan.get("brief") or {}
    for i, a in enumerate(brief.get("assets") or []):
        kind, uploader = a.get("kind"), a.get("uploader")
        src = a.get("source")
        tag = f"assets[{i}]({a.get('role') or '未命名'})"
        if not src:
            rep.error("R11", f"{tag}: 必须声明 source（attachment/conversation_asset/canvas_node/user_upload）")
        if kind in {"video", "audio"} and uploader == "agent" and src == "user_upload":
            rep.error("R12", f"{tag}: user_upload 表示用户在画布上传；agent 侧请改用 attachment/conversation_asset/canvas_node/workspace_file 导入")
        if kind == "image" and uploader == "user" and src != "canvas_node":
            rep.warn("R11", f"{tag}: 图片建议由 agent 自动导入（attachment/conversation_asset），除非用户坚持自己传")
        nid = a.get("nodeLocalId")
        if nid and nid not in by_id:
            rep.error("R11", f"{tag}: nodeLocalId={nid} 不存在")
        if uploader == "user" and nid and nid not in {m.get("node") for m in manual}:
            rep.error("R11", f"{tag}: 需用户上传的素材必须登记到 manualSteps（节点 {nid}）")

    # ---------- R13 数量闸门 ----------
    total_images = estimate.get("images")
    total_videos = estimate.get("videos")
    if (isinstance(total_images, int) and total_images > 30) or (
        isinstance(total_videos, int) and total_videos > 6
    ):
        if not estimate.get("needsConfirmation"):
            rep.error("R13", "预计 >30 图或 >6 视频，estimate.needsConfirmation 必须为 true（先经官方确认）")

    # ---------- R18 估算一致性 ----------
    run_types = [by_id[lid].get("type") for lid in runs if lid in by_id]
    n_img, n_vid, n_aud = run_types.count("image"), run_types.count("video"), run_types.count("audio")
    if isinstance(total_images, int) and total_images != n_img:
        rep.warn("R18", f"estimate.images={total_images} 与 runs 中 image 节点数 {n_img} 不一致")
    if isinstance(total_videos, int) and total_videos != n_vid:
        rep.warn("R18", f"estimate.videos={total_videos} 与 runs 中 video 节点数 {n_vid} 不一致")
    total_audios = estimate.get("audios")
    if isinstance(total_audios, int) and total_audios != n_aud:
        rep.warn("R18", f"estimate.audios={total_audios} 与 runs 中 audio 节点数 {n_aud} 不一致")

    # ---------- R14 禁用能力扫描 ----------
    blob = json.dumps(plan, ensure_ascii=False)
    for pattern, label in FORBIDDEN_CAPABILITIES:
        if re.search(pattern, blob):
            rep.error("R14", f"计划中出现不可用能力：{label}")

    # ---------- R16 提示词自包含性 ----------
    for lid, n in by_id.items():
        if n.get("type") not in GENERATOR_TYPES or not n.get("prompt"):
            continue
        has_image_input = any(
            HANDLE_MEDIA.get(e.get("sourceHandle", "")) == "image" for e in incoming.get(lid, [])
        )
        if has_image_input and not any(w in n["prompt"] for w in REFERENCE_LOCK_WORDS):
            rep.warn(
                "R16",
                f"{lid}: 有图片输入但提示词里没有主体锁定表述（保持/一致/不变/参考/图1），商品容易被改形",
            )

    # ---------- R20 模式门（image/video 的模式必须与入边匹配） ----------
    for lid, n in by_id.items():
        if n.get("type") not in {"image", "video"}:
            continue
        cfg = n.get("config") or {}
        mode = cfg.get("modelType")
        if not mode:
            continue
        img_in = sum(1 for e in incoming.get(lid, []) if HANDLE_MEDIA.get(e.get("sourceHandle", "")) == "image")
        has_av = any(HANDLE_MEDIA.get(e.get("sourceHandle", "")) in {"video", "audio"} for e in incoming.get(lid, []))
        if n.get("type") == "image":
            if mode == "text_to_image" and img_in > 0:
                rep.warn("R20", f"{lid}: text_to_image 收到了图片入边（原生会报「仅支持文本输入」）→ 改为 reference_image_to_image")
            if mode == "reference_image_to_image" and img_in == 0:
                rep.error("R20", f"{lid}: reference_image_to_image 需要图片入边，当前没有")
        if n.get("type") == "video":
            if mode == "image_to_video" and img_in != 1:
                rep.error("R20", f"{lid}: image_to_video 需要且仅需要 1 张图片入边，当前 {img_in}")
            if mode == "first_last_frame_to_video" and img_in != 2:
                rep.error("R20", f"{lid}: first_last_frame_to_video 需要 2 张图片入边，当前 {img_in}")
            if mode == "text_to_video" and (img_in or has_av):
                rep.error("R20", f"{lid}: text_to_video 只接受文本输入，但当前有图片/音视频入边")
            if mode == "reference_image_to_video" and img_in == 0 and not has_av:
                rep.error("R20", f"{lid}: reference_image_to_video 需要图片或音视频入边")

    # ---------- R19 内部逻辑不得建节点 ----------
    for lid, n in by_id.items():
        title = str(n.get("title") or "")
        hits = [w for w in INTERNAL_NOTE_MARKERS if w in title]
        if hits:
            rep.error(
                "R19",
                f"{lid}: 标题含 {hits}——自检清单/说明/话术属**内部逻辑**，不该建到画布上；"
                "请删掉该节点，把内容留在技能文档或交付说明里（画布只放 input/text/generator 三种角色的节点）",
            )

    # ---------- R17 合规红线 ----------
    for lid, n in by_id.items():
        text_blob = " ".join(filter(None, [n.get("title"), n.get("text"), n.get("prompt")]))
        # 「第一次/第一步/第一版…」是序数用法，不是绝对化用语
        text_blob = re.sub(r"第一(?=[次步版天周月季年批轮期张条格镜章节句行页位类部分])", "", text_blob)
        hits = [w for w in COMPLIANCE_BLACKLIST if w in text_blob and not is_compliance_mention(text_blob, w)]
        if hits:
            rep.error("R17", f"{lid}: 出现绝对化用语 {hits}（广告法风险）")

    # ---------- R22 孤立节点 ----------
    touched: set[str] = set()
    for e in edges:
        if e.get("from") in by_id:
            touched.add(e["from"])
        if e.get("to") in by_id:
            touched.add(e["to"])
    for lid in by_id:
        if len(by_id) > 1 and lid not in touched:
            rep.error(
                "R22",
                f"{lid}: 孤立节点——没有参与任何一条边。画布只放参与生成/交付的节点："
                "要么接上游输入，要么接下游产物；纯说明/备用一律删掉",
            )

    # ---------- R23 布局重叠 ----------
    def plan_size(n: dict) -> tuple[float, float]:
        if n.get("type") not in {"image", "video"}:
            return 400.0, 400.0
        ratio = ((n.get("config") or {}).get("params") or {}).get("aspect_ratio") or "1:1"
        try:
            w, h = (float(x) for x in str(ratio).split(":"))
        except (ValueError, TypeError):
            return 400.0, 400.0
        if w <= 0 or h <= 0:
            return 400.0, 400.0
        return (round(400 * w / h, 1), 400.0) if w >= h else (400.0, round(400 * h / w, 1))

    boxes: list[tuple[str, float, float, float, float]] = []
    for lid, n in by_id.items():
        pl = n.get("placement") or {}
        pos = pl.get("position")
        if pl.get("mode") != "absolute" or not isinstance(pos, dict):
            continue
        w, h = plan_size(n)
        boxes.append((lid, float(pos.get("x") or 0), float(pos.get("y") or 0), w, h))
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            aid, ax, ay, aw, ah = boxes[i]
            bid, bx, by, bw, bh = boxes[j]
            if ax < bx + bw - 1 and bx < ax + aw - 1 and ay < by + bh - 1 and by < ay + ah - 1:
                rep.error(
                    "R23",
                    f"{aid} 与 {bid} 位置重叠（{aw:.0f}×{ah:.0f} / {bw:.0f}×{bh:.0f}）——"
                    "跑 layout_plan.py 重排，别手拍坐标",
                )

    if len(boxes) < len(by_id) and any((n.get("placement") or {}).get("mode") in {"auto", "after"} for n in by_id.values()):
        rep.warn("R23", "有节点用 auto/after 放置，原生会按顺序排但无法离线判重叠；建完必须用 canvas_get(nodes) 复核 K9")

    # ---------- R24 下游文本节点必须运行 ----------
    manual_nodes = {m.get("node") for m in manual}
    for lid, n in by_id.items():
        if n.get("type") != "text" or not incoming.get(lid):
            continue
        if lid not in manual_nodes:
            rep.error(
                "R24",
                f"{lid}: 文本节点有上游入边（属于 LLM 下游），它的内容要跑出来才能供下游用；"
                "agent 不能运行文本节点 → 必须登记到 manualSteps（或改成 copy 代笔消除这个节点）",
            )

    # ---------- R25 视频节点使用上游音频必须在 prompt 里声明 ----------
    for lid, n in by_id.items():
        if n.get("type") != "video":
            continue
        audio_ins = [e for e in incoming.get(lid, [])
                     if (by_id.get(e.get("from")) or {}).get("type") == "audio"]
        if not audio_ins:
            continue
        prompt = str(n.get("prompt") or "")
        cfg = n.get("config") or {}
        if cfg.get("modelType") != "reference_image_to_video":
            rep.error("R25", f"{lid}: 接了音频入边，modelType 必须是 reference_image_to_video"
                              f"（当前 {cfg.get('modelType')!r}），否则音频入边无效")
        if not any(h in prompt for h in AUDIO_USE_HINTS):
            rep.error("R25", f"{lid}: 上游有音频节点，但 prompt 没有声明使用这条音频 —— "
                              "第一段要写「使用连入的图片1和音频1生成这条视频…音频1是音轨，原样使用、逐字对齐」；"
                              "只挂音频边不等于模型会用，跑出来是静音视频")
        neg = [w for w in AUDIO_NEG_HINTS if w in prompt]
        if neg:
            rep.warn("R25", f"{lid}: prompt 出现 {neg}，容易被模型理解成“音轨自行生成”，建议删掉这些否定句")

    # ---------- R26 runs 必须是拓扑序 ----------
    run_pos = {lid: i for i, lid in enumerate(runs)}
    for lid, i in run_pos.items():
        for e in incoming.get(lid, []):
            src = e.get("from")
            if src in run_pos and run_pos[src] > i:
                rep.error("R26", f"runs 顺序错：{lid} 排在第 {i + 1} 位，但上游 {src} 在第 "
                                  f"{run_pos[src] + 1} 位 —— 上游必须先跑完拿到产物，下游才能提交")


def main() -> int:
    ap = argparse.ArgumentParser(description="画布工作流计划静态校验")
    ap.add_argument("plan", help="plan.json 路径")
    ap.add_argument("--json", action="store_true", help="输出机器可读结果")
    ap.add_argument("--strict", action="store_true", help="warning 也视为失败")
    args = ap.parse_args()

    try:
        plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"无法读取/解析计划：{exc}", file=sys.stderr)
        return 2

    rep = Report()
    check(plan, rep)
    failed = bool(rep.errors) or (args.strict and bool(rep.warnings))

    if args.json:
        print(json.dumps(
            {
                "ok": not failed,
                "errors": [{"rule": r, "message": m} for _, r, m in rep.errors],
                "warnings": [{"rule": r, "message": m} for _, r, m in rep.warnings],
            },
            ensure_ascii=False,
            indent=2,
        ))
        return 1 if failed else 0

    print(f"计划校验：{args.plan}")
    print(f"  错误 {len(rep.errors)} 条，警告 {len(rep.warnings)} 条\n")
    for level, rule, msg in rep.items:
        mark = "✗" if level == ERROR else "!"
        print(f"  {mark} [{rule}] {msg}")
    print()
    if rep.errors:
        print("结论：不可施工（先修 ERROR）")
    elif rep.warnings:
        print("结论：可施工（warning 需确认或说明理由）")
    else:
        print("结论：可施工 ✅")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
