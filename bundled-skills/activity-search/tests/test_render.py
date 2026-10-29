#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""离线自测：验证解析与渲染，不发任何网络请求。

运行：python3 tests/test_render.py
"""

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "scripts", "ragflow_retrieval.py")

sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import ragflow_retrieval as rr  # noqa: E402

PASS, FAIL = 0, 0


def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✅ {name}")
    else:
        FAIL += 1
        print(f"  ❌ {name} {extra}")


ARCHIVE = {
    "活动名称": "测试咖啡快闪",
    "活动时间": [{"阶段名": "全期", "开始日期": "2026-06-26", "结束日期": "2026-06-28"}],
    "地理位置": [{"场所名称": "正佳广场", "城市": "广州市", "详细地址": "天河区正佳广场"}],
    "场地属性": [{"场地类型": ["广场"], "室内外属性": ["室外"],
               "空间使用属性": ["共享区域"], "补充说明": "顶棚遮阳"}],
    "品牌": [{"名称": "NESCAFÉ", "角色": "发起品牌"}],
    "行业": [{"名称": "食品饮料", "判断类型": "确定事实", "依据": "主体品牌为咖啡"}],
    "活动标的": [{"类型": "主推产品", "名称": "丝滑拿铁", "所属品牌": ["NESCAFÉ"],
               "核心卖点": ["丝滑", "提神"]}],
    "活动目标": [{"目标": "新品推广", "判断类型": "合理推断", "依据": "大量装置"}],
    "目标群体": [{"维度": "消费需求", "描述": "都市上班族", "判断类型": "合理推断", "依据": "文案"}],
    "布景搭建": [{"名称": "主装置", "主题或风格": "年轻治愈",
               "视觉与结构特征": ["巨型咖啡瓶", "IP公仔", "积木方块"],
               "材料与尺寸": "木质烤漆", "品牌元素": ["Logo"], "呈现状态": "已落地事实"}],
    "空间分区": {"区域": [{"区域名称": "入口区", "功能": "派发试饮", "位置关系": "入口处"}],
              "参观动线": "入口 -> 主装置 -> 兑奖"},
    "互动玩法": [{"玩法名称": "免费试饮", "参与流程": ["到场", "领取"],
               "参与门槛": "无门槛", "完成条件": "到场即可", "奖励": "试饮", "限制条件": None}],
    "活动图片": [{"图片画面描述": "女性手持咖啡", "图片文案": "主标题：丝滑"}],
}


def payload_wrapped(chunks):
    return {"code": 0, "data": {"chunks": chunks, "doc_aggs": [
        {"count": len(chunks), "doc_id": "d1", "doc_name": "a.txt"}], "total": len(chunks)}}


def chunk(content, sim=0.8, term=0.5, vec=0.9):
    return {"content": content, "content_ltks": "abc", "similarity": sim,
            "term_similarity": term, "vector_similarity": vec,
            "document_keyword": "a.txt", "document_id": "d1", "id": "c1",
            "dataset_id": "ds1", "image_id": "", "important_keywords": [],
            "mom_id": "", "positions": [], "row_id": None, "tag_kwd": [],
            "doc_type_kwd": ""}


def run_cli(args):
    r = subprocess.run([sys.executable, SCRIPT] + args,
                       capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


def main():
    print("== 1. 内容形态解析 ==")
    obj, kind = rr.parse_chunk_content(json.dumps(ARCHIVE, ensure_ascii=False))
    check("单档案 dict 识别", kind == "archive-dict", kind)
    obj, kind = rr.parse_chunk_content("```json\n" + json.dumps(ARCHIVE, ensure_ascii=False) + "\n```")
    check("剥离 ```json 围栏", kind == "archive-dict", kind)
    obj, kind = rr.parse_chunk_content(json.dumps([ARCHIVE, ARCHIVE], ensure_ascii=False))
    check("多档案 list 识别", kind == "archive-list" and len(obj) == 2, kind)
    obj, kind = rr.parse_chunk_content("这是一段普通文本说明")
    check("纯文本兜底", kind == "text", kind)
    obj, kind = rr.parse_chunk_content("说明文字\n" + json.dumps(ARCHIVE, ensure_ascii=False))
    check("说明+JSON 混合截取", kind == "archive-dict", kind)

    print("\n== 2. 响应包装兼容 ==")
    data, err = rr.unwrap(payload_wrapped([chunk(json.dumps(ARCHIVE, ensure_ascii=False))]))
    check("形态A {code,data}", err is None and len(data["chunks"]) == 1, str(err))
    data, err = rr.unwrap({"chunks": [chunk("{}")], "doc_aggs": [], "total": 1})
    check("形态B 裸结构", err is None and len(data["chunks"]) == 1, str(err))
    data, err = rr.unwrap({"code": 401, "data": None, "message": "Unauthorized"})
    check("code!=0 报错", err is not None and "401" in err, str(err))

    print("\n== 3. 渲染输出且不泄漏原始字段 ==")
    hits, aggs, total = rr.build_hits(rr.unwrap(
        payload_wrapped([chunk(json.dumps(ARCHIVE, ensure_ascii=False))]))[0])
    md = rr.render_report_md("测试", hits, aggs, total, 1.23, full=True)
    check("含活动名称", "测试咖啡快闪" in md)
    check("含时间与地点", "2026-06-26" in md and "正佳广场" in md)
    check("保留判断类型标注", "合理推断" in md)
    for internal in ["content_ltks", "doc_aggs", "dataset_id", "mom_id",
                     "important_keywords", "vector_similarity:", '"chunks"']:
        check(f"不泄漏 {internal}", internal not in md)

    print("\n== 4. --full 开关生效 ==")
    brief = rr.render_report_md("测试", hits, aggs, total, None, full=False)
    check("非 full 含展开提示", "--full" in brief)
    check("full 展开多特征", "IP公仔" in md and "IP公仔" not in brief)
    check("full 展开参与流程", "到场" in md)

    print("\n== 5. 无结果兜底 ==")
    empty = rr.render_report_md("测试", [], [], 0, 0.5, full=False)
    check("空结果给出建议", "未检索到" in empty and "threshold" in empty)

    print("\n== 6. 多档案切片渲染 ==")
    hits2, _, t2 = rr.build_hits({"chunks": [chunk(json.dumps([ARCHIVE, ARCHIVE], ensure_ascii=False))],
                                  "doc_aggs": [], "total": 1})
    md2 = rr.render_report_md("测试", hits2, [], t2, None, full=False)
    check("提示切片含多份档案", "2 份活动档案" in md2)

    print("\n== 7. CLI 离线渲染（--raw-file，不发请求） ==")
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(payload_wrapped([chunk(json.dumps(ARCHIVE, ensure_ascii=False))]),
                  f, ensure_ascii=False)
        tmp = f.name
    try:
        for style in ["markdown", "plain", "compact", "formatted"]:
            rc, out, err = run_cli(["测试", "--raw-file", tmp, "--style", style])
            check(f"--style {style} 退出码 0", rc == 0, err[:120])
            check(f"--style {style} 有输出", len(out.strip()) > 0)
            check(f"--style {style} 无内部字段", "content_ltks" not in out and "doc_aggs" not in out)
        rc, out, _ = run_cli(["测试", "--raw-file", tmp, "--style", "compact"])
        check("compact 单行速览", "0.800" in out)
        rc, out, _ = run_cli(["测试", "--raw-file", tmp, "--style", "plain"])
        check("plain 去 Markdown 标记", not out.strip().startswith("#") and "**" not in out)
    finally:
        os.unlink(tmp)

    print("\n== 7.5 事件式报告（默认格式） ==")
    a1 = dict(ARCHIVE)
    a1["原始链接"] = "https://www.xiaohongshu.com/discovery/item/682d75c60000000021019c25?xsec_token=x1"
    a2 = json.loads(json.dumps(ARCHIVE, ensure_ascii=False))
    a2["原始链接"] = ["https://www.xiaohongshu.com/discovery/item/682d7de000000000220067c9?xsec_token=x2"]
    a2["活动图片"] = ARCHIVE["活动图片"] * 3
    h3, _, t3 = rr.build_hits({"chunks": [chunk(json.dumps(a1, ensure_ascii=False)),
                                         chunk(json.dumps(a2, ensure_ascii=False))],
                               "doc_aggs": [], "total": 2})
    ev = rr.render_report_events("咖啡", h3, t3, 1.0, full=False)
    check("事件式含概览表", "## 概览" in ev and "| # | 活动 |" in ev)
    check("同名活动归并", "已归并 **2** 篇笔记" in ev and ev.count("### 1.") == 1, ev[:200])
    check("两条原帖链接并列", ev.count("xiaohongshu.com/discovery/item/") == 2)
    check("含使用提醒", "## 使用提醒" in ev)
    check("默认不展开图片描述", "女性手持咖啡" not in ev)
    ev_full = rr.render_report_events("咖啡", h3, t3, 1.0, full=True)
    check("--full 展开逐张图片", "女性手持咖啡" in ev_full)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(payload_wrapped([chunk(json.dumps(a1, ensure_ascii=False))]), f, ensure_ascii=False)
        tmp2 = f.name
    try:
        _rc, ev_cli, _err = run_cli(["咖啡", "--raw-file", tmp2, "--style", "report"])
        check("CLI report 可渲染", _rc == 0 and "## 概览" in ev_cli, _err[:120])
        _rc2, ev_def, _ = run_cli(["咖啡", "--raw-file", tmp2])
        check("CLI 无 --style 时默认 report", _rc2 == 0 and "## 概览" in ev_def)
    finally:
        os.unlink(tmp2)

    print("\n== 7.6 相关性分层（附录） ==")
    side = dict(ARCHIVE)
    side["活动名称"] = "顺带提及的活动"
    side["活动标的"] = [{"类型": "主推产品", "名称": "威士忌", "所属品牌": ["X"]}]
    side["活动图片"] = [{"图片画面描述": "桌上有一盒巧克力作为道具", "图片文案": None}]
    h4, _, t4 = rr.build_hits({"chunks": [chunk(json.dumps(a1, ensure_ascii=False)),
                                          chunk(json.dumps(side, ensure_ascii=False))],
                               "doc_aggs": [], "total": 2})
    ev2 = rr.render_report_events("咖啡", h4, t4, None, full=False)
    check("低相关进入附录", "附：仅被提及" in ev2 and "顺带提及的活动" in ev2)
    check("主体仍保留", "测试咖啡快闪" in ev2.split("## 附")[0])

    print("\n== 7.7 无名称活动兜底 ==")
    noname = json.loads(json.dumps(ARCHIVE, ensure_ascii=False))
    noname.pop("活动名称")
    h5, _, t5 = rr.build_hits({"chunks": [chunk(json.dumps(noname, ensure_ascii=False))],
                               "doc_aggs": [], "total": 1})
    ev3 = rr.render_report_events("拿铁", h5, t5, None, full=False)
    check("无名称时给出可读标题", "（未命名）" in ev3 and "NESCAFÉ" in ev3)

    print("\n== 8. 参数校验 ==")
    rc, out, err = run_cli(["--style", "markdown"])
    check("缺 question 时报错退出", rc != 0)

    print(f"\n{'='*46}\n通过 {PASS} 项，失败 {FAIL} 项\n{'='*46}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
