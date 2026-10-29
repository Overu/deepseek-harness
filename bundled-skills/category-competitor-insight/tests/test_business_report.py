import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "validate_business_report.py"


def valid_report() -> str:
    return """# 一、品类判断

## 核心观点
高端防蓝光眼镜正在从静态防护升级为全天候视觉适配工具。

## 金句
> 用户购买的不是一副更贵的眼镜，而是一套全天候保持清晰与舒适的视觉方案。

## 支持点
- 工作与户外场景连续切换，让动态适配比单一防护更有价值。
- 高端需求同时指向光学品质、舒适体验和外观表达。

# 二、竞品格局

## 核心观点
市场竞争集中在镜片权威与场景体验，但尚未形成动态调色与度数适配的一体化心智。

## 金句
> 竞品都在证明镜片更专业，真正的空位是证明视觉系统更懂场景。

## 支持点
### 品牌甲｜产品 A
- 形象占位：专业光学权威。
- 主打卖点/功能：防蓝光与高透光。
- 传播概念/活动：专业测试与实验室背书。

### 品牌乙｜产品 B
- 形象占位：时尚科技配饰。
- 主打卖点/功能：自动变色与轻量镜架。
- 传播概念/活动：城市通勤主题内容。

# 三、本品现状

## 核心观点
蔡司镜片提供信任起点，动态调色与度数调整才是建立新品类价值的关键。

## 金句
> 蔡司负责让用户相信，动态适配负责让用户选择。

## 支持点
- 品牌资产能够降低高客单产品的首次理解成本。
- 产品表达需要从技术参数转向场景变化中的直接体验。

# 四、用户声音

## 核心观点
高价值用户更关心长时间佩戴后的稳定舒适，而不是单一参数领先。

## 金句
> 真正驱动高端购买的，是一天结束时眼睛依然轻松。

## 支持点
- **高频屏幕职场人**：“我不是不愿意花钱，是戴一整天不能再酸胀。”
- **户外通勤人群**：“进出室内外如果不用换眼镜，才是真的方便。”
- **品质敏感型用户**：“镜片品牌让我放心，但外观也得配得上这个价格。”

# 五、机会点

## 核心观点
品牌应抢占“动态视觉管理”而不是继续挤在“防蓝光”功能赛道。

## 金句
> 从防一束光，升级为适应每一种光。

## 支持点
- 建立从办公、通勤到户外连续切换的完整场景叙事。
- 将蔡司镜片作为品质证明，把动态调色与度数调整作为购买理由。

# 六、数据说明

- 行业媒体与研究报告：24 组关键词、23 条公开资料
- 公开社区与电商讨论：20 组关键词、13 条帖子与 228 条评论
- 数据时间：2024-04-20 ～ 2026-09-22
- 主要参考资料
  - [**“一瓶水卖上百元”，理肤泉陷“智商税”争议背后，市场地位面临挑战**](https://ctdsb.net/c1666_202509/2527712.html)
  - [**国货品牌颐莲的保湿喷雾卖得比雅漾还好**](https://m.jiemian.com/article/12347016.html)
"""


def run_validator(report: str) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "report.md"
        source.write_text(report, encoding="utf-8")
        return subprocess.run(
            [sys.executable, str(VALIDATOR), "--input", str(source)],
            text=True,
            capture_output=True,
            check=False,
        )


class BusinessReportContractTests(unittest.TestCase):
    def test_skill_routes_user_visible_output_to_business_template(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        template = (ROOT / "references" / "report-template.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("用户可见报告", skill)
        self.assertIn("python3 scripts/validate_business_report.py", skill)
        self.assertIn("观点 — 金句 — 支持点", skill)
        self.assertIn("一、品类判断", template)
        self.assertIn("六、数据说明", template)
        self.assertIn("数据来源类型", template)
        self.assertIn("主要参考资料", template)
        self.assertIn("前五部分", template)

    def test_accepts_six_part_front_planning_report(self) -> None:
        result = run_validator(valid_report())
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_rejects_missing_required_section(self) -> None:
        report = valid_report().replace("# 三、本品现状", "# 三、本品概述")
        result = run_validator(report)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("三、本品现状", result.stderr + result.stdout)

    def test_rejects_technical_process_content(self) -> None:
        report = valid_report().replace(
            "- 工作与户外场景连续切换，让动态适配比单一防护更有价值。",
            "- 数据抓取接口路由为 /api/v1/example，证据 ID 为 E-001。",
        )
        result = run_validator(report)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("技术过程", result.stderr + result.stdout)

    def test_rejects_standalone_api_or_sample_language(self) -> None:
        report = valid_report().replace(
            "- 工作与户外场景连续切换，让动态适配比单一防护更有价值。",
            "- API 返回的样本显示，工作与户外场景连续切换。",
        )
        result = run_validator(report)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("技术过程", result.stderr + result.stdout)

    def test_rejects_preamble_or_extra_subsection(self) -> None:
        report = "# 项目摘要\n这是摘要。\n\n" + valid_report()
        result = run_validator(report)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("非规范一级章节", result.stderr + result.stdout)

        report = "这是报告导语。\n\n" + valid_report()
        result = run_validator(report)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("六个固定章节之外", result.stderr + result.stdout)

        report = valid_report().replace(
            "# 三、本品现状\n",
            "# 三、本品现状\n\n## 背景说明\n背景内容。\n",
        )
        result = run_validator(report)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("二级标题", result.stderr + result.stdout)

    def test_rejects_three_analysis_subheadings_in_data_section(self) -> None:
        report = valid_report().replace(
            "# 六、数据说明\n\n",
            "# 六、数据说明\n\n## 核心观点\n这是多余的小标题。\n\n",
        )
        result = run_validator(report)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("六、数据说明", result.stderr + result.stdout)

    def test_rejects_legacy_data_layout_outside_single_list(self) -> None:
        report = valid_report().replace(
            "- 行业媒体与研究报告：24 组关键词、23 条公开资料\n"
            "- 公开社区与电商讨论：20 组关键词、13 条帖子与 228 条评论\n"
            "- 数据时间：2024-04-20 ～ 2026-09-22\n"
            "- 主要参考资料\n"
            "  - [**“一瓶水卖上百元”，理肤泉陷“智商税”争议背后，市场地位面临挑战**](https://ctdsb.net/c1666_202509/2527712.html)\n"
            "  - [**国货品牌颐莲的保湿喷雾卖得比雅漾还好**](https://m.jiemian.com/article/12347016.html)",
            "行业媒体与研究报告：24 组关键词、23 条公开资料\n\n"
            "- 公开社区与电商讨论：20 组关键词、13 条帖子与 228 条评论\n"
            "- 数据时间：2024-04-20 ～ 2026-09-22\n\n"
            "### 参考资料\n\n"
            "- [**“一瓶水卖上百元”，理肤泉陷“智商税”争议背后，市场地位面临挑战**](https://ctdsb.net/c1666_202509/2527712.html)\n"
            "- [**国货品牌颐莲的保湿喷雾卖得比雅漾还好**](https://m.jiemian.com/article/12347016.html)",
        )
        result = run_validator(report)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("单一项目列表", result.stderr + result.stdout)

    def test_rejects_competitor_without_three_dimensions(self) -> None:
        report = valid_report().replace(
            "- 传播概念/活动：专业测试与实验室背书。", ""
        )
        result = run_validator(report)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("传播概念/活动", result.stderr + result.stdout)

    def test_rejects_user_voice_without_persona_quote_pair(self) -> None:
        report = valid_report().replace(
            "- **高频屏幕职场人**：“我不是不愿意花钱，是戴一整天不能再酸胀。”",
            "- 用户普遍重视佩戴舒适。",
        ).replace(
            "- **户外通勤人群**：“进出室内外如果不用换眼镜，才是真的方便。”",
            "- 用户也重视场景切换。",
        ).replace(
            "- **品质敏感型用户**：“镜片品牌让我放心，但外观也得配得上这个价格。”",
            "- 用户还重视品牌与外观。",
        )
        result = run_validator(report)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("人群标签", result.stderr + result.stdout)

    def test_rejects_data_section_without_source_volume_and_date(self) -> None:
        report = valid_report().replace(
            "- 行业媒体与研究报告：24 组关键词、23 条公开资料\n", ""
        ).replace(
            "- 公开社区与电商讨论：20 组关键词、13 条帖子与 228 条评论\n",
            "",
        ).replace(
            "- 数据时间：2024-04-20 ～ 2026-09-22", ""
        )
        result = run_validator(report)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("数据说明", result.stderr + result.stdout)


if __name__ == "__main__":
    unittest.main()
