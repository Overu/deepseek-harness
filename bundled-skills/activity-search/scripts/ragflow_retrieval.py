#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""RAGFlow 检索接口封装 —— 调用 + 解析 + 易读输出。

设计目标：**绝不把接口原始 JSON 直接抛给用户**。
原始响应经解析后，按「活动档案」结构渲染成 Markdown / 纯文本 / 紧凑摘要。

用法：
    python3 ragflow_retrieval.py "雀巢"
    python3 ragflow_retrieval.py "华伦天奴" --page-size 5 --threshold 0.6
    python3 ragflow_retrieval.py "雀巢" --full            # 展开全部字段
    python3 ragflow_retrieval.py "雀巢" --style plain     # 无 Markdown 语法
    python3 ragflow_retrieval.py "雀巢" --style compact   # 一行一条速览
    python3 ragflow_retrieval.py "雀巢" --json-out /tmp/x.json  # 落盘原始结果（可选）
    python3 ragflow_retrieval.py --raw-file /tmp/prev.json      # 离线渲染已有响应
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from typing import Any

from enterprise_proxy import ProxyError, request as proxy_request

# ---------------------------------------------------------------- 默认配置

DEFAULT_DATASET = "be388896c48211f19f5ded9d5b020479"

ENV_DATASET = "RAGFLOW_DATASET_IDS"
CONNECTION_ID = "activity-search"
RETRIEVAL_PATH = "/api/v1/retrieval"

# 活动档案的标准字段（按展示顺序）
ARCHIVE_FIELDS = [
    "活动名称", "活动时间", "地理位置", "场地属性", "品牌", "行业",
    "活动标的", "活动目标", "目标群体", "布景搭建", "空间分区",
    "互动玩法", "活动图片",
]


# ---------------------------------------------------------------- 解析层

def strip_code_fence(text: str) -> str:
    """去掉 ```json ... ``` 围栏，以及可能的引导性说明文字。"""
    s = (text or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", s)
        s = re.sub(r"\s*```\s*$", "", s)
    return s.strip()


def parse_chunk_content(content: str) -> tuple[Any, str]:
    """把 chunk.content 解析成结构化对象。

    返回 (对象, 形态标签)。形态标签：
      archive-dict  单条活动档案
      archive-list  多条活动档案数组
      text          纯文本（无法解析为 JSON）
    """
    s = strip_code_fence(content)
    if not s:
        return None, "empty"
    if s[0] not in "[{":
        # 可能是「说明文字 + JSON」的混合体，尝试截取第一个 JSON 块
        m = re.search(r"[\[{].*[\]}]", s, re.S)
        if not m:
            return s, "text"
        s = m.group(0)
    try:
        obj = json.loads(s)
    except json.JSONDecodeError:
        return content.strip(), "text"

    if isinstance(obj, list):
        if obj and all(isinstance(x, dict) and "活动名称" in x for x in obj):
            return obj, "archive-list"
        if all(isinstance(x, dict) for x in obj):
            return obj, "record-list"
        return obj, "list"
    if isinstance(obj, dict):
        if "活动名称" in obj or set(obj) & set(ARCHIVE_FIELDS):
            return obj, "archive-dict"
        return obj, "dict"
    return obj, "scalar"


def unwrap(payload: Any) -> tuple[dict, str | None]:
    """兼容两种响应包装：{code,data:{...}} 与裸 {chunks,...}。

    返回 (核心数据, 错误信息)。
    """
    if not isinstance(payload, dict):
        return {}, "响应不是 JSON 对象"
    if "code" in payload:
        code = payload.get("code")
        if code not in (0, "0", None):
            msg = payload.get("message") or payload.get("msg") or "(无 message)"
            return {}, f"接口返回业务错误 code={code}：{msg}"
        data = payload.get("data")
        if isinstance(data, dict):
            return data, None
        return {}, "code=0 但 data 字段缺失或不是对象"
    if "chunks" in payload or "doc_aggs" in payload:
        return payload, None
    return payload, "无法识别的响应结构（既无 code 也无 chunks）"


@dataclass
class Hit:
    """一条检索命中。"""
    rank: int
    similarity: float
    term_similarity: float
    vector_similarity: float
    document_keyword: str
    document_id: str
    chunk_id: str
    kind: str
    archives: list[dict] = field(default_factory=list)
    text: str = ""

    @property
    def title(self) -> str:
        if self.archives:
            names = [a.get("活动名称") for a in self.archives if a.get("活动名称")]
            if names:
                return " ／ ".join(names)
        if self.text:
            head = re.sub(r"\s+", " ", self.text).strip()
            return head[:60] + ("…" if len(head) > 60 else "")
        return "(无标题)"


def build_hits(data: dict) -> tuple[list[Hit], list[dict], int]:
    chunks = data.get("chunks") or []
    doc_aggs = data.get("doc_aggs") or []
    total = data.get("total")
    if total is None:
        total = len(chunks)

    hits: list[Hit] = []
    for i, c in enumerate(chunks, 1):
        obj, kind = parse_chunk_content(c.get("content", ""))
        h = Hit(
            rank=i,
            similarity=float(c.get("similarity") or 0.0),
            term_similarity=float(c.get("term_similarity") or 0.0),
            vector_similarity=float(c.get("vector_similarity") or 0.0),
            document_keyword=c.get("document_keyword") or "",
            document_id=c.get("document_id") or "",
            chunk_id=c.get("id") or "",
            kind=kind,
        )
        if kind in ("archive-dict", "dict"):
            h.archives = [obj]
        elif kind in ("archive-list", "record-list", "list"):
            h.archives = [x for x in obj if isinstance(x, dict)]
        else:
            h.text = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)
        hits.append(h)
    return hits, doc_aggs, int(total)


# ---------------------------------------------------------------- 渲染层

def _fmt_list(v: Any) -> str:
    if isinstance(v, list):
        return "、".join(str(x) for x in v if x not in (None, ""))
    return "" if v is None else str(v)


def _j(v: Any) -> str:
    """把任意值压成单行可读文本。"""
    if v is None or v == [] or v == {}:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, (int, float, bool)):
        return str(v)
    if isinstance(v, list):
        return "、".join(x for x in (_j(i) for i in v) if x)
    if isinstance(v, dict):
        return "；".join(f"{k}：{_j(x)}" for k, x in v.items() if _j(x))
    return str(v)


def render_archive_md(a: dict, heading_level: int = 3, full: bool = False) -> list[str]:
    """把一份活动档案渲染成 Markdown 行。"""
    out: list[str] = []
    h = "#" * heading_level
    name = a.get("活动名称") or "(未命名活动)"
    out.append(f"{h} {name}")

    # 概览行：时间 / 地点 / 品牌 / 行业
    periods = a.get("活动时间") or []
    ptexts = []
    for p in periods:
        if not isinstance(p, dict):
            continue
        s, e = p.get("开始日期"), p.get("结束日期")
        stage = p.get("阶段名")
        span = " ~ ".join(x for x in [s, e] if x) or "时间待定"
        ptexts.append(f"{stage}（{span}）" if stage else span)
    locs = a.get("地理位置") or []
    ltexts = []
    for l in locs:
        if not isinstance(l, dict):
            continue
        ltexts.append("".join(str(l.get(k)) for k in ("城市", "详细地址") if l.get(k))
                      or _j(l.get("场所名称")))
    brands = [b.get("名称") for b in (a.get("品牌") or []) if isinstance(b, dict) and b.get("名称")]
    inds = [i.get("名称") for i in (a.get("行业") or []) if isinstance(i, dict) and i.get("名称")]

    if ptexts:
        out.append(f"- **活动时间**：{_fmt_list(ptexts)}")
    if ltexts:
        out.append(f"- **活动地点**：{_fmt_list(ltexts)}")
    if brands:
        out.append(f"- **品牌**：{_fmt_list(brands)}")
    if inds:
        out.append(f"- **行业**：{_fmt_list(inds)}")

    # 场地属性
    for fa in a.get("场地属性") or []:
        if not isinstance(fa, dict):
            continue
        bits = [_fmt_list(fa.get("场地类型")), _fmt_list(fa.get("室内外属性")),
                _fmt_list(fa.get("空间使用属性"))]
        bits = [b for b in bits if b]
        note = fa.get("补充说明")
        line = _fmt_list(bits)
        if note:
            line += f"（{note}）"
        if line:
            out.append(f"- **场地属性**：{line}")

    # 目标群体
    tg = a.get("目标群体") or []
    if tg:
        out.append("- **目标群体**：")
        for t in tg:
            if isinstance(t, dict):
                out.append(f"  - {t.get('维度') or '维度'}：{t.get('描述') or ''}"
                           f"（{t.get('判断类型') or '—'}）")

    # 活动标的
    targets = a.get("活动标的") or []
    if targets:
        out.append("- **活动标的**：")
        for t in targets:
            if isinstance(t, dict):
                out.append(f"  - {t.get('类型') or '标的'}｜{t.get('名称') or ''}"
                           f"（卖点：{_fmt_list(t.get('核心卖点')) or '—'}）")

    # 活动目标
    goals = a.get("活动目标") or []
    if goals:
        out.append("- **活动目标**：" + "；".join(
            f"{g.get('目标')}（{g.get('判断类型') or '—'}）"
            for g in goals if isinstance(g, dict)))

    # 布景搭建
    scenes = a.get("布景搭建") or []
    if scenes:
        out.append("- **布景搭建**：")
        for s in scenes:
            if not isinstance(s, dict):
                continue
            out.append(f"  - **{s.get('名称') or '(未命名)'}**｜{s.get('主题或风格') or '—'}"
                       f"（{s.get('呈现状态') or '—'}）")
            feats = s.get("视觉与结构特征") or []
            if full:
                for f in feats:
                    out.append(f"    - {_j(f)}")
                extra = []
                if s.get("材料与尺寸"):
                    extra.append(f"材料/尺寸：{_j(s.get('材料与尺寸'))}")
                if s.get("品牌元素"):
                    extra.append(f"品牌元素：{_fmt_list(s.get('品牌元素'))}")
                if extra:
                    out.append("    - " + "；".join(extra))
            else:
                if feats:
                    out.append(f"    - {_j(feats[0])}"
                               + (f"（等 {len(feats)} 项）" if len(feats) > 1 else ""))

    # 空间分区
    zones = a.get("空间分区") or {}
    if isinstance(zones, dict):
        areas = zones.get("区域") or []
        if areas:
            out.append("- **空间分区**：")
            for z in areas:
                if isinstance(z, dict):
                    out.append(f"  - {z.get('区域名称') or '区域'}：{z.get('功能') or ''}"
                               + (f"（{z.get('位置关系')}）" if z.get("位置关系") else ""))
        if zones.get("参观动线"):
            out.append(f"- **参观动线**：{zones.get('参观动线')}")

    # 互动玩法
    plays = a.get("互动玩法") or []
    if plays:
        out.append("- **互动玩法**：")
        for p in plays:
            if not isinstance(p, dict):
                continue
            out.append(f"  - **{p.get('玩法名称') or '玩法'}**：奖励 {p.get('奖励') or '—'}"
                       f"｜门槛 {p.get('参与门槛') or '—'}")
            if full:
                steps = p.get("参与流程") or []
                for si, st in enumerate(steps, 1):
                    out.append(f"    {si}. {_j(st)}")
                if p.get("限制条件"):
                    out.append(f"    - 限制：{p.get('限制条件')}")

    # 活动图片
    pics = a.get("活动图片") or []
    if pics:
        out.append(f"- **活动图片**：{len(pics)} 张")
        limit = len(pics) if full else min(len(pics), 3)
        for p in pics[:limit]:
            if isinstance(p, dict):
                out.append(f"  - 画面：{p.get('图片画面描述') or '—'}")
                if p.get("图片文案"):
                    out.append(f"    文案：{p.get('图片文案')}")
        if not full and len(pics) > limit:
            out.append(f"  - …（另有 {len(pics) - limit} 张，用 --full 展开）")
    return out


# ------------------------------------------------ 事件式报告（默认输出规范）

NOTE_RE = re.compile(r"(?:item|explore|discovery/item)/([0-9a-f]{24})")


def _txt(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, list):
        return "；".join(x for x in (_txt(i) for i in v) if x)
    if isinstance(v, dict):
        return "；".join(f"{k}：{_txt(x)}" for k, x in v.items() if _txt(x))
    return str(v).strip()


def _links(a: dict) -> list[str]:
    v = a.get("原始链接")
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x or "").strip()]
    return [str(v).strip()] if v and str(v).strip() else []


def _note_id(url: str) -> str:
    m = NOTE_RE.search(url or "")
    return m.group(1) if m else ""


def _period_text(a: dict) -> str:
    texts: list[str] = []
    for p in a.get("活动时间") or []:
        if not isinstance(p, dict):
            continue
        s, e = p.get("开始日期"), p.get("结束日期")
        if s and e and s == e:
            span = str(s)
        elif s and e:
            span = f"{s} ~ {e}"
        elif s:
            span = f"{s} 起"
        elif e:
            span = f"截至 {e}"
        else:
            span = ""
        stage = p.get("阶段名")
        texts.append(f"{stage}（{span}）" if stage and span else (stage or span))
    return "；".join(t for t in texts if t) or "档案未标注"


def _loc_text(a: dict) -> str:
    seen: set[str] = set()
    out: list[str] = []
    for l in a.get("地理位置") or []:
        if not isinstance(l, dict):
            continue
        parts = [str(x) for x in (l.get("城市"), l.get("场所名称"),
                                  l.get("详细地址"), l.get("具体位置")) if x]
        line = "｜".join(dict.fromkeys(parts))
        if line and line not in seen:
            seen.add(line)
            out.append(line)
    return "；".join(out)


def _brand_text(a: dict) -> str:
    out = []
    for b in a.get("品牌") or []:
        if isinstance(b, dict) and b.get("名称"):
            out.append(f"{b['名称']}（{b['角色']}）" if b.get("角色") else str(b["名称"]))
    if not out:  # 品牌字段为空时，退回活动标的里的所属品牌
        for t in a.get("活动标的") or []:
            if isinstance(t, dict):
                for b in t.get("所属品牌") or []:
                    if isinstance(b, str) and b and b not in out:
                        out.append(b)
    return "、".join(out)


def _industry_text(a: dict) -> str:
    out = []
    for i in a.get("行业") or []:
        if isinstance(i, dict) and i.get("名称"):
            out.append(f"{i['名称']}（{i['判断类型']}）" if i.get("判断类型") else str(i["名称"]))
    return "、".join(out)


def _site_text(a: dict) -> str:
    out = []
    for p in a.get("场地属性") or []:
        if not isinstance(p, dict):
            continue
        bits = [_txt(p.get("场地类型")), _txt(p.get("室内外属性")),
                _txt(p.get("空间使用属性"))]
        line = "｜".join(b for b in bits if b)
        if p.get("补充说明"):
            line += f"（{_txt(p['补充说明'])}）"
        if line and line not in out:
            out.append(line)
    return "；".join(out)


def _event_key(a: dict) -> str:
    """归并键：名称 + 档期 + 城市；无名称时退回品牌 + 场地。"""
    name = re.sub(r"\s+", "", str(a.get("活动名称") or ""))
    city = ""
    for l in a.get("地理位置") or []:
        if isinstance(l, dict) and l.get("城市"):
            city = str(l["城市"])
            break
    if name:
        return f"{name}|{_period_text(a)}|{city}"
    brands = "-".join(sorted(re.sub(r"\s+", "", str(b.get("名称") or ""))
                             for b in (a.get("品牌") or []) if isinstance(b, dict)))
    return f"__unnamed__{brands}|{_period_text(a)}|{_loc_text(a)}"


def _display_name(a: dict) -> str:
    """无活动名称时给出可读标题：品牌 · 场所。"""
    name = str(a.get("活动名称") or "").strip()
    if name:
        return name
    brand = ""
    for b in a.get("品牌") or []:
        if isinstance(b, dict) and b.get("名称"):
            brand = str(b["名称"])
            break
    venue = ""
    for l in a.get("地理位置") or []:
        if isinstance(l, dict) and (l.get("场所名称") or l.get("具体位置")):
            venue = str(l.get("场所名称") or l.get("具体位置"))
            break
    bits = [brand] if brand == venue else [b for b in (brand, venue) if b]
    return "（未命名）" + (" · ".join(bits) if bits else "档案无标题")


def group_events(hits: list[Hit]) -> list[dict]:
    """把命中切片里的档案按活动归并（同名活动视为一场，多篇笔记并列）。"""
    order: list[str] = []
    groups: dict[str, dict] = {}
    for h in hits:
        for a in h.archives:
            key = _event_key(a)
            g = groups.get(key)
            if g is None:
                g = {"archives": [], "links": [], "score": h.similarity}
                groups[key] = g
                order.append(key)
            for link in _links(a):
                if link not in g["links"]:
                    g["links"].append(link)
            g["archives"].append(a)
            g["score"] = max(g["score"], h.similarity)
    for g in groups.values():
        g["archives"].sort(key=lambda x: len(json.dumps(x, ensure_ascii=False)), reverse=True)
    return [groups[k] for k in order]


def _terms(question: str) -> list[str]:
    raw = re.split(r"[\s,，、;；/|()（）]+", question or "")
    terms = [t for t in raw if len(t) >= 2]
    if not terms and question:
        terms = [question.strip()]
    return terms or []


def _mentions(a: dict, terms: list[str]) -> int:
    blob = json.dumps(a, ensure_ascii=False)
    return sum(blob.count(t) for t in terms if t)


def _all_strings(v: Any):
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict):
        for x in v.values():
            yield from _all_strings(x)
    elif isinstance(v, list):
        for x in v:
            yield from _all_strings(x)


def _context_snippet(a: dict, terms: list[str], width: int = 26) -> str:
    """从档案里找出关键词出现的那句人话，截一小段作为语境。"""
    for text in _all_strings(a):
        for t in terms:
            i = text.find(t)
            if i >= 0:
                snip = text[max(0, i - width): i + width + len(t)]
                return re.sub(r"\s+", " ", snip).strip()
    return ""


def _core_mentions(a: dict, terms: list[str]) -> int:
    """只统计主体字段：活动名称、品牌名、行业名、标的类型与名称。

    图片文案、卖点描述里的顺带提及（如"黑巧克力柑橘气息"）不算主体相关。
    """
    core = {"活动名称": a.get("活动名称"),
            "品牌": [b.get("名称") for b in (a.get("品牌") or []) if isinstance(b, dict)],
            "行业": [i.get("名称") for i in (a.get("行业") or []) if isinstance(i, dict)],
            "标的": [[t.get("类型"), t.get("名称")] for t in (a.get("活动标的") or [])
                   if isinstance(t, dict)]}
    blob = json.dumps(core, ensure_ascii=False)
    return sum(blob.count(t) for t in terms if t)


def render_event_block(g: dict, idx: int, full: bool) -> list[str]:
    a = g["archives"][0]
    L = [f"### {idx}. {_display_name(a)}", ""]
    L.append(f"- **时间**：{_period_text(a)}")
    loc = _loc_text(a)
    if loc:
        L.append(f"- **地点**：{loc}")
    meta = []
    if _brand_text(a):
        meta.append(f"**品牌**：{_brand_text(a)}")
    if _industry_text(a):
        meta.append(f"**行业**：{_industry_text(a)}")
    if meta:
        L.append("- " + "｜".join(meta))
    site = _site_text(a)
    if site:
        L.append(f"- **场地**：{site}")
    goals = [f"{x.get('目标')}（{x.get('判断类型') or '未标注'}）"
             for x in (a.get("活动目标") or []) if isinstance(x, dict) and x.get("目标")]
    if goals:
        L.append(f"- **活动目标**：{'、'.join(goals)}")
    if g["links"]:
        links = "；".join(f"[{_note_id(l)[:8] or '原帖'}]({l})" for l in g["links"])
        L.append(f"- 📎 **原帖**：{links}")
    if len(g["archives"]) > 1:
        L.append(f"- 已归并 **{len(g['archives'])}** 篇笔记为同一场活动")
    L.append("")

    targets = a.get("活动标的") or []
    if targets:
        L.append("**活动标的**")
        for t in targets:
            if not isinstance(t, dict):
                continue
            bits = [str(x) for x in (t.get("类型"), t.get("名称")) if x]
            extra = []
            if t.get("所属品牌"):
                extra.append(f"品牌 {_txt(t['所属品牌'])}")
            if t.get("核心卖点"):
                extra.append(f"卖点 {_txt(t['核心卖点'])}")
            line = "｜".join(bits) or "—"
            L.append(f"- {line}" + (f"（{'；'.join(extra)}）" if extra else ""))
        L.append("")

    aud = a.get("目标群体") or []
    if aud:
        bits = []
        for t in aud:
            if isinstance(t, dict) and t.get("描述"):
                tag = f"（{t['判断类型']}）" if t.get("判断类型") else ""
                bits.append(f"{t.get('维度') or '维度'}：{t['描述']}{tag}")
        if bits:
            L.append("**目标群体**：" + "；".join(bits))
            L.append("")

    scenes = a.get("布景搭建") or []
    if scenes:
        L.append("**装置与布景**")
        for s in scenes:
            if not isinstance(s, dict):
                continue
            head = f"- **{s.get('名称') or '装置'}**"
            if s.get("主题或风格"):
                head += f"｜{_txt(s['主题或风格'])}"
            if s.get("呈现状态"):
                head += f"｜{_txt(s['呈现状态'])}"
            L.append(head)
            feats = s.get("视觉与结构特征") or []
            if isinstance(feats, str):
                feats = [feats]
            if full:
                for f in feats:
                    if _txt(f):
                        L.append(f"  - {_txt(f)}")
                if s.get("材料与尺寸"):
                    L.append(f"  - 材料：{_txt(s['材料与尺寸'])}")
                if s.get("品牌元素"):
                    L.append(f"  - 品牌元素：{_txt(s['品牌元素'])}")
            elif feats:
                L.append(f"  - {_txt(feats[0])}"
                         + (f"（等 {len(feats)} 项，--full 展开）" if len(feats) > 1 else ""))
        L.append("")

    zones = a.get("空间分区") or {}
    if isinstance(zones, dict) and zones.get("区域"):
        L.append("**空间分区**")
        for z in zones["区域"]:
            if isinstance(z, dict):
                bits = [str(x) for x in (z.get("区域名称"), z.get("功能"), z.get("位置关系")) if x]
                L.append("- " + "｜".join(bits))
        if zones.get("参观动线"):
            L.append(f"- 参观动线：{_txt(zones['参观动线'])}")
        L.append("")

    plays = a.get("互动玩法") or []
    if plays:
        L.append("**互动玩法**")
        for p in plays:
            if not isinstance(p, dict):
                continue
            L.append(f"- **{p.get('玩法名称') or '玩法'}**")
            for k, label in (("参与门槛", "门槛"), ("奖励", "奖励"),
                             ("完成条件", "完成条件"), ("限制条件", "限制")):
                v = _txt(p.get(k))
                if v:
                    L.append(f"  - {label}：{v}")
            if full:
                flow = p.get("参与流程") or []
                if isinstance(flow, str):
                    flow = [flow]
                for si, st in enumerate(flow, 1):
                    if _txt(st):
                        L.append(f"  {si}. {_txt(st)}")
        L.append("")

    pics = a.get("活动图片") or []
    if pics:
        if full:
            L.append(f"**笔记图片（{len(pics)} 张）**")
            for j, pic in enumerate(pics, 1):
                if isinstance(pic, dict):
                    L.append(f"{j}. 画面：{_txt(pic.get('图片画面描述')) or '—'}")
                    if pic.get("图片文案"):
                        L.append(f"   文案：{_txt(pic['图片文案'])}")
        else:
            L.append(f"**笔记图片**：{len(pics)} 张（--full 展开逐张画面与文案）")
        L.append("")
    return L


def render_report_events(question: str, hits: list[Hit], total: int,
                         elapsed: float | None, full: bool,
                         mention_min: int = 1) -> str:
    """事件式报告（默认格式）：概览表 + 逐场卡片（含原帖链接）+ 附录 + 使用提醒。"""
    events = group_events(hits)
    terms = _terms(question)
    main_g, side_g = [], []
    for g in events:
        a = g["archives"][0]
        if mention_min and _core_mentions(a, terms) < mention_min:
            side_g.append(g)
        else:
            main_g.append(g)

    L = [f"# 检索结果：{question}", ""]
    notes = sum(len(g["archives"]) for g in main_g)
    meta = f"命中 {len(hits)} 条切片｜归并为 **{len(main_g)}** 场活动（{notes} 篇笔记）"
    if elapsed is not None:
        meta += f"｜total={total}｜{elapsed:.2f}s"
    L.append(meta)
    L.append("")
    L.append("> 同一活动的多篇笔记已合并、链接并列；"
             "字段后的「确定事实 / 合理推断」为档案原始判断类型，转述时请保留。")
    L.append("")

    if not main_g:
        L.append("> 未检索到与关键词足够相关的活动档案。可降低 `--threshold`、"
                 "换同义词（品牌名 / 品类名 / 玩法词），或确认该数据集是否已收录相关素材。")
        if side_g:
            L.append("")
            L.append("## 附：仅被提及（不作为活动主体）")
            L.append("")
            for g in side_g:
                a = g["archives"][0]
                L.append(f"- {_display_name(a)}（{_brand_text(a) or '品牌未标注'}）")
        return "\n".join(L).rstrip() + "\n"

    L.append("## 概览")
    L.append("")
    L.append("| # | 活动 | 时间 | 地点 | 品牌 | 笔记 |")
    L.append("|---|---|---|---|---|---|")
    for i, g in enumerate(main_g, 1):
        a = g["archives"][0]
        name = _display_name(a).replace("|", "／")
        brands = _brand_text(a)
        if len(brands) > 42:
            brands = brands[:42] + "…"
        loc = _loc_text(a) or "—"
        if len(loc) > 30:
            loc = loc[:30] + "…"
        L.append(f"| {i} | {name} | {_period_text(a)} | {loc} | "
                 f"{brands or '—'} | {len(g['archives'])} |")
    L.append("")

    L.append("## 逐场详情")
    L.append("")
    for i, g in enumerate(main_g, 1):
        L.extend(render_event_block(g, i, full))

    if side_g:
        L.append("## 附：仅被提及（不作为活动主体）")
        L.append("")
        L.append("> 关键词只出现在图片文案、道具或风味描述里，不构成该品类活动，仅供排除参考。")
        L.append("")
        seen: set[str] = set()
        shown = 0
        for g in side_g:
            a = g["archives"][0]
            name = _display_name(a)
            if name in seen:
                continue
            seen.add(name)
            if shown >= 10:
                continue
            shown += 1
            cnt = _mentions(a, terms)
            ctx = _context_snippet(a, terms)
            line = f"- {name}（{_brand_text(a) or '品牌未标注'}）"
            if cnt:
                line += f"：提及 {cnt} 次"
            if ctx:
                line += f"｜语境「…{ctx}…」"
            if g["links"]:
                line += f"｜[原帖]({g['links'][0]})"
            L.append(line)
        rest = len(seen) - shown
        if rest > 0:
            L.append(f"- …另有 {rest} 场仅被提及，已略")
        L.append("")

    L.append("## 使用提醒")
    L.append("")
    L.append("- 字段标注：「确定事实」为原文明确写出，「合理推断」为档案模型推断，"
             "对外提案引用时应区分。")
    missing = [f"{i}. {_display_name(g['archives'][0])}"
               for i, g in enumerate(main_g, 1)
               if _period_text(g["archives"][0]) == "档案未标注"]
    if missing:
        L.append("- 时间缺失（仅能依节庆语境推断档期，勿当排期依据）：" + "；".join(missing))
    if len(events) > len(main_g):
        L.append(f"- 相关性分层：另有 {len(side_g)} 场仅被顺带提及，已放入附录，"
                 "不要把其当作品类活动案例引用。")
    L.append("- 原帖链接含 `xsec_token`，可能过期；失效时可在小红书按笔记 ID 搜索。")
    if not full:
        L.append("- 加 `--full` 可展开装置全部视觉特征、玩法流程与逐张图片文案。")
    return "\n".join(L).rstrip() + "\n"


def render_hit_md(h: Hit, full: bool) -> list[str]:
    out: list[str] = []
    out.append(f"### 命中 {h.rank}｜相似度 {h.similarity:.4f}")
    out.append(f"- 关键词 {h.term_similarity:.4f} ／ 向量 {h.vector_similarity:.4f}"
               f"｜来源 `{h.document_keyword or '未知文档'}`")
    if h.kind == "text" or not h.archives:
        out.append("")
        out.append(h.text or "(空内容)")
        return out
    if len(h.archives) > 1:
        out.append(f"- 该切片含 **{len(h.archives)} 份活动档案**")
    for ai, a in enumerate(h.archives, 1):
        out.append("")
        if len(h.archives) > 1:
            out.append(f"#### {ai}. {a.get('活动名称') or '(未命名活动)'}")
            out.extend(render_archive_md(a, heading_level=5, full=full)[1:])
        else:
            out.extend(render_archive_md(a, heading_level=4, full=full))
    return out


def render_report_md(question: str, hits: list[Hit], doc_aggs: list[dict],
                     total: int, elapsed: float | None, full: bool) -> str:
    L: list[str] = []
    L.append(f"# 检索结果：{question}")
    L.append("")
    meta = [f"命中 **{len(hits)}** 条", f"total={total}"]
    if elapsed is not None:
        meta.append(f"耗时 {elapsed:.2f}s")
    L.append("｜".join(meta))
    L.append("")

    if not hits:
        L.append("> 未检索到符合阈值的内容。可尝试降低 `--threshold`，"
                 "或确认该数据集是否已收录相关素材。")
        return "\n".join(L)

    # 概览表
    L.append("## 概览")
    L.append("")
    L.append("| # | 相似度 | 活动名称 | 时间 | 地点 | 来源文档 |")
    L.append("|---|---|---|---|---|---|")
    for h in hits:
        a = h.archives[0] if h.archives else {}
        periods = a.get("活动时间") or []
        t = ""
        if periods and isinstance(periods[0], dict):
            p0 = periods[0]
            t = " ~ ".join(x for x in [p0.get("开始日期"), p0.get("结束日期")] if x)
        locs = a.get("地理位置") or []
        loc = ""
        if locs and isinstance(locs[0], dict):
            l0 = locs[0]
            loc = f"{l0.get('城市') or ''}{l0.get('场所名称') or ''}"
        L.append(f"| {h.rank} | {h.similarity:.4f} | {h.title} | {t} | {loc} | {h.document_keyword} |")
    L.append("")

    # 详情
    L.append("## 详情")
    L.append("")
    for h in hits:
        L.extend(render_hit_md(h, full))
        L.append("")

    # 命中文档分布
    if doc_aggs:
        L.append("## 命中文档分布")
        L.append("")
        for a in doc_aggs:
            L.append(f"- {a.get('doc_name')}：{a.get('count')} 条")
        L.append("")

    if not full:
        L.append("> 提示：加 `--full` 可展开装置细节、互动流程与全部图片文案。")
    return "\n".join(L).rstrip() + "\n"


def render_compact(hits: list[Hit], total: int, elapsed: float | None) -> str:
    L = [f"命中 {len(hits)} 条（total={total}"
         + (f"，{elapsed:.2f}s" if elapsed is not None else "") + "）"]
    for h in hits:
        a = h.archives[0] if h.archives else {}
        periods = a.get("活动时间") or []
        t = ""
        if periods and isinstance(periods[0], dict):
            p0 = periods[0]
            t = "~".join(x for x in [p0.get("开始日期"), p0.get("结束日期")] if x)
        brands = [b.get("名称") for b in (a.get("品牌") or [])
                  if isinstance(b, dict) and b.get("名称")]
        L.append(f"{h.rank}. [{h.similarity:.3f}] {h.title}"
                 + (f"｜{t}" if t else "")
                 + (f"｜{'、'.join(brands)}" if brands else ""))
    return "\n".join(L) + "\n"


def render_formatted(hits: list[Hit], question: str, width: int = 74) -> str:
    """近似 JSON 的格式化视图：只保留关键字段，绝不含内部元数据。"""
    def block(a: dict) -> Any:
        periods = a.get("活动时间") or []
        ptexts = []
        for p in periods:
            if isinstance(p, dict):
                span = " ~ ".join(x for x in [p.get("开始日期"), p.get("结束日期")] if x)
                ptexts.append(f"{p.get('阶段名')}（{span}）" if p.get("阶段名") else span)
        locs = a.get("地理位置") or []
        ltexts = []
        for l in locs:
            if isinstance(l, dict):
                ltexts.append(f"{l.get('城市') or ''}{l.get('详细地址') or l.get('场所名称') or ''}")
        return {
            "活动名称": a.get("活动名称"),
            "活动时间": ptexts,
            "活动地点": ltexts,
            "品牌": [b.get("名称") for b in (a.get("品牌") or []) if isinstance(b, dict)],
            "行业": [i.get("名称") for i in (a.get("行业") or []) if isinstance(i, dict)],
            "活动标的": [f"{t.get('类型')}：{t.get('名称')}" for t in (a.get("活动标的") or [])
                     if isinstance(t, dict)],
            "活动目标": [g.get("目标") for g in (a.get("活动目标") or []) if isinstance(g, dict)],
            "目标群体": [t.get("描述") for t in (a.get("目标群体") or []) if isinstance(t, dict)],
            "布景搭建": [s.get("名称") for s in (a.get("布景搭建") or []) if isinstance(s, dict)],
            "空间区域": [z.get("区域名称") for z in ((a.get("空间分区") or {}).get("区域") or [])
                     if isinstance(z, dict)],
            "互动玩法": [p.get("玩法名称") for p in (a.get("互动玩法") or []) if isinstance(p, dict)],
            "活动图片数": len(a.get("活动图片") or []),
        }

    L = [f"【检索：{question}】共 {len(hits)} 条命中", ""]
    for h in hits:
        L.append(f"── 命中 {h.rank}  相似度 {h.similarity:.4f}"
                 f"（关键词 {h.term_similarity:.4f} / 向量 {h.vector_similarity:.4f}）")
        L.append(f"   来源文档：{h.document_keyword}")
        for a in (h.archives or []):
            payload = json.dumps(block(a), ensure_ascii=False, indent=2)
            for line in payload.splitlines():
                L.append("   " + line)
        if not h.archives and h.text:
            for line in h.text.splitlines()[:20]:
                L.append("   " + line)
        L.append("")
    return "\n".join(L).rstrip() + "\n"


# ---------------------------------------------------------------- 请求层

def call_api(question: str, dataset_ids: list[str], page: int, page_size: int,
             threshold: float, weight: float, timeout: float) -> tuple[dict, float]:
    """Call the fixed enterprise RAGFlow route without handling credentials locally."""
    body = {
        "question": question,
        "dataset_ids": dataset_ids,
        "page": page,
        "page_size": page_size,
        "similarity_threshold": threshold,
        "vector_similarity_weight": weight,
    }
    t0 = time.time()
    try:
        payload = proxy_request(
            CONNECTION_ID, "POST", RETRIEVAL_PATH, body=body, timeout=timeout)
    except ProxyError as e:
        raise RuntimeError(f"企业检索网关失败：{e.code}（HTTP {e.status}）") from None
    elapsed = time.time() - t0
    if not isinstance(payload, dict):
        raise RuntimeError("企业检索网关返回了无效响应")
    return payload, elapsed


# ---------------------------------------------------------------- 主流程

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="RAGFlow 检索接口封装：调用 + 解析 + 易读输出（不输出原始 JSON）")
    p.add_argument("question", nargs="?", help="检索问题/关键词")
    p.add_argument("--dataset-ids", default=os.environ.get(ENV_DATASET, DEFAULT_DATASET),
                   help="多个用逗号分隔")
    p.add_argument("--page", type=int, default=1)
    p.add_argument("--page-size", type=int, default=5)
    p.add_argument("--threshold", type=float, default=0.6)
    p.add_argument("--weight", type=float, default=0.75)
    p.add_argument("--timeout", type=float, default=60.0)
    p.add_argument("--style", choices=["report", "markdown", "plain", "compact", "formatted"],
                   default="report",
                   help="输出风格，默认 report（事件式：概览表 + 逐场卡片 + 原帖链接）")
    p.add_argument("--full", action="store_true", help="展开全部字段")
    p.add_argument("--mentions", type=int, default=1,
                   help="事件式报告的相关性门槛：关键词在名称/标的/品牌/行业中"
                        "出现次数少于该值则放入附录，0=不拆分")
    p.add_argument("--raw-file", help="离线渲染已有响应 JSON（不发请求）")
    p.add_argument("--json-out", help="可选：把原始响应落盘到该路径")
    p.add_argument("--save-md", help="可选：把渲染结果另存为文件")
    args = p.parse_args(argv)

    # 取数
    elapsed: float | None = None
    if args.raw_file:
        with open(args.raw_file, encoding="utf-8") as f:
            payload = json.load(f)
        question = args.question or os.path.basename(args.raw_file)
    else:
        if not args.question:
            p.error("需要提供 question（或用 --raw-file 离线渲染）")
        question = args.question
        try:
            payload, elapsed = call_api(
                question, [d.strip() for d in args.dataset_ids.split(",") if d.strip()],
                args.page, args.page_size, args.threshold, args.weight, args.timeout)
        except RuntimeError as e:
            print(f"❌ 检索失败：{e}", file=sys.stderr)
            return 2

    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

    data, err = unwrap(payload)
    if err:
        print(f"❌ 检索失败：{err}", file=sys.stderr)
        return 1

    hits, doc_aggs, total = build_hits(data)

    if args.style == "compact":
        out = render_compact(hits, total, elapsed)
    elif args.style == "formatted":
        out = render_formatted(hits, question)
    elif args.style == "report":
        out = render_report_events(question, hits, total, elapsed, args.full, args.mentions)
    elif args.style == "plain":
        out = render_report_events(question, hits, total, elapsed, args.full, args.mentions)
        out = re.sub(r"^#{1,6}\s*", "", out, flags=re.M)
        out = out.replace("**", "").replace("`", "")
    else:
        out = render_report_md(question, hits, doc_aggs, total, elapsed, args.full)

    print(out, end="")
    if args.save_md:
        with open(args.save_md, "w", encoding="utf-8") as f:
            f.write(out)
        print(f"\n（已保存到 {args.save_md}）", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
