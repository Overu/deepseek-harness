#!/usr/bin/env python3
"""Validate the user-visible, front-planning business report contract."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


SECTIONS = [
    "一、品类判断",
    "二、竞品格局",
    "三、本品现状",
    "四、用户声音",
    "五、机会点",
    "六、数据说明",
]
SUBHEADINGS = ["核心观点", "金句", "支持点"]
TECHNICAL_TERMS = [
    "方法学",
    "数据抓取",
    "接口",
    "路由",
    "API",
    "HTTP",
    "接口路由",
    "平台路由",
    "证据 ID",
    "证据ID",
    "evidence_id",
    "source_id",
    "insight_handoff",
    "platform_gaps",
    "cache_key",
    "下游交接包",
    "样本",
    "样本限制",
    "数据限制",
    "置信度",
    "下游交接",
]


def split_sections(text: str) -> tuple[list[str], dict[str, str]]:
    matches = list(re.finditer(r"(?m)^# ([^#\n]+)\s*$", text))
    names = [match.group(1).strip() for match in matches]
    bodies: dict[str, str] = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        bodies[match.group(1).strip()] = text[match.end() : end]
    return names, bodies


def subsection(body: str, name: str) -> str:
    match = re.search(
        rf"(?ms)^## {re.escape(name)}\s*$\n(.*?)(?=^## |\Z)", body
    )
    return match.group(1).strip() if match else ""


def validate_competitors(body: str) -> list[str]:
    errors: list[str] = []
    support = subsection(body, "支持点")
    blocks = list(re.finditer(r"(?m)^### (.+?)\s*$", support))
    if not blocks:
        return ["二、竞品格局的支持点必须按品牌或产品使用三级标题分块"]
    for index, block in enumerate(blocks):
        end = blocks[index + 1].start() if index + 1 < len(blocks) else len(support)
        content = support[block.end() : end]
        name = block.group(1).strip()
        for dimension in ("形象占位", "主打卖点/功能", "传播概念/活动"):
            if dimension not in content:
                errors.append(f"竞品 {name} 缺少维度：{dimension}")
    return errors


def validate_user_voices(body: str) -> list[str]:
    support = subsection(body, "支持点")
    pairs = re.findall(r"(?m)^[-*]\s+\*\*(.+?)\*\*\s*[：:]\s*“([^”]+)”\s*$", support)
    if len(pairs) < 2:
        return ["四、用户声音至少需要两组‘人群标签：用户原话’"]
    if len({label.strip() for label, _ in pairs}) != len(pairs):
        return ["四、用户声音的人群标签必须互不重复"]
    return []


def validate_data_section(body: str) -> list[str]:
    errors: list[str] = []
    lines = [line.rstrip() for line in body.splitlines() if line.strip()]
    if any(not re.match(r"^(?:[-*]\s+|\s{2,}[-*]\s+)", line) for line in lines):
        errors.append("六、数据说明必须使用单一项目列表，不得使用独立正文或小标题")

    source_rows = [
        line
        for line in lines
        if re.match(
            r"^[-*]\s+([^#：:\n]+)[：:]\s*([0-9,]+)\s*组关键词[、，,]\s*([0-9,]+)\s*条\s*(.+?)\s*$",
            line,
        )
    ]
    if not source_rows:
        errors.append("六、数据说明必须按数据来源类型写明关键词组数和资料量")

    date_rows = [
        line
        for line in lines
        if re.match(
            r"^[-*]\s+数据时间[：:]\s*\d{4}-\d{2}-\d{2}\s*[～~—-]\s*\d{4}-\d{2}-\d{2}\s*$",
            line,
        )
    ]
    if len(date_rows) != 1:
        errors.append("六、数据说明必须包含 YYYY-MM-DD ～ YYYY-MM-DD 的数据时间")

    reference_headers = [line for line in lines if line.strip() == "- 主要参考资料"]
    reference_links = [
        line
        for line in lines
        if re.match(r"^\s{2,}[-*]\s+\[\*\*.+?\*\*\]\(https://[^)]+\)\s*$", line)
    ]
    if len(reference_headers) != 1 or not reference_links:
        errors.append("六、数据说明必须以‘主要参考资料’项目及其二级链接列表收尾")

    if reference_headers:
        header_index = lines.index(reference_headers[0])
        if any(not line.startswith(("  - ", "  * ")) for line in lines[header_index + 1 :]):
            errors.append("主要参考资料之后只能列二级 Markdown 链接")
    return errors


def validate(text: str) -> list[str]:
    errors: list[str] = []
    names, bodies = split_sections(text)
    first_heading = re.search(r"(?m)^# [^#\n]+\s*$", text)
    if first_heading is None or text[: first_heading.start()].strip():
        errors.append("用户可见报告不得在六个固定章节之外增加导语或前言")
    if names != SECTIONS:
        missing = [name for name in SECTIONS if name not in names]
        extras = [name for name in names if name not in SECTIONS]
        if missing:
            errors.append("缺少或写错固定章节：" + "、".join(missing))
        if extras:
            errors.append("存在非规范一级章节：" + "、".join(extras))
        if not missing and not extras:
            errors.append("六个固定章节顺序不正确")

    for section in SECTIONS[:5]:
        body = bodies.get(section, "")
        if not body:
            continue
        actual_subheadings = re.findall(r"(?m)^## ([^#\n]+)\s*$", body)
        if actual_subheadings != SUBHEADINGS:
            errors.append(
                f"{section} 的二级标题只能依次为：" + "、".join(SUBHEADINGS)
            )
        positions = [body.find(f"## {heading}") for heading in SUBHEADINGS]
        for heading, position in zip(SUBHEADINGS, positions):
            if position < 0 or not subsection(body, heading):
                errors.append(f"{section} 缺少有效的‘{heading}’")
        if all(position >= 0 for position in positions) and positions != sorted(positions):
            errors.append(f"{section} 必须按核心观点、金句、支持点排序")

    data_body = bodies.get("六、数据说明", "")
    if re.search(r"(?m)^## [^#\n]+\s*$", data_body):
        errors.append("六、数据说明不得出现核心观点、金句、支持点或其他二级标题")

    for term in TECHNICAL_TERMS:
        if term in {"API", "HTTP"}:
            found = re.search(
                rf"(?i)(?<![A-Za-z0-9]){re.escape(term)}(?![A-Za-z0-9])", text
            )
        else:
            found = term.lower() in text.lower()
        if found:
            errors.append(f"用户可见报告含技术过程内容：{term}")

    if bodies.get("二、竞品格局"):
        errors.extend(validate_competitors(bodies["二、竞品格局"]))
    if bodies.get("四、用户声音"):
        errors.extend(validate_user_voices(bodies["四、用户声音"]))
    if data_body:
        errors.extend(validate_data_section(data_body))
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    try:
        text = Path(args.input).read_text(encoding="utf-8")
    except OSError as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 2
    errors = validate(text)
    if errors:
        print("INVALID:\n- " + "\n- ".join(errors), file=sys.stderr)
        return 1
    print("OK: business report passed six-part output checks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
