import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "validate_creator_output.py"
GUARD = ROOT / "scripts" / "tikhub_guard.py"
CLIENT = ROOT / "scripts" / "tikhub_readonly.py"


def run_json_tool(script: Path, payload: dict, *args: str) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "input.json"
        source.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        return subprocess.run(
            [sys.executable, str(script), "--input", str(source), *args],
            text=True,
            capture_output=True,
            check=False,
        )


def valid_creator_output() -> dict:
    return {
        "requested_platforms": ["douyin", "xiaohongshu"],
        "platform_gaps": [
            {
                "platform": "xiaohongshu",
                "reason": "未取得可验证报价，保留公开内容候选待补数",
            }
        ],
        "creators": [
            {
                "creator_key": "douyin:70001",
                "platform": "douyin",
                "tier": "优先测试",
                "profile": {
                    "followers": 120000,
                    "followers_captured_at": "2026-09-21T10:00:00+08:00",
                },
                "recent_posts": {
                    "sample_size": 10,
                    "median_views": 220000,
                    "view_range": {"min": 12000, "max": 900000},
                    "stability_metric": {
                        "name": "min_max_ratio",
                        "formula": "min_views/max_views",
                        "value": 0.0133,
                    },
                },
                "audience": {"status": "unavailable"},
                "asset_reuse_evidence": [],
                "recent_commercial_activity": {
                    "status": "verified",
                    "latest_verified_commercial_at": "2026-09-12T12:00:00+08:00",
                    "checked_at": "2026-09-21T10:00:00+08:00",
                    "evidence_type": "observed_public",
                    "evidence_refs": ["douyin:video:90001"],
                    "evidence": [{
                        "evidence_ref": "douyin:video:90001", "creator_key": "douyin:70001",
                        "commercial_at": "2026-09-12T12:00:00+08:00",
                        "record_kind": "explicit_paid_partnership", "evidence_type": "observed_public",
                        "source_ref": "douyin:video:90001", "source_field": "paid_partnership_label",
                        "commercial_marker": "平台标注：付费合作",
                    }],
                },
                "commercial_capability": {
                    "recommendation_fit_score": 82,
                    "commercial_capability_score": None,
                    "commercial_evidence_coverage": 60,
                    "recommended_roles": ["场景种草"],
                    "dimensions": {"audience_fit": {"score": None}},
                },
            }
        ],
    }


class EndpointContractTests(unittest.TestCase):
    def test_contract_captures_search_semantics_and_current_status(self) -> None:
        contract_path = ROOT / "references" / "tikhub-endpoints.json"
        contract = json.loads(contract_path.read_text(encoding="utf-8"))
        endpoints = {item["path"]: item for item in contract["endpoints"]}

        # 2026-10-16: the v2 search family broke upstream; discovery runs on search_kol_v2.
        search = endpoints["/api/v1/douyin/xingtu_v2/search_creator"]
        self.assertEqual(search["method"], "GET")
        self.assertEqual(search["status"], "failed")
        self.assertEqual(search["last_failure_at"], "2026-10-16")
        # API 默认是 2（昵称）；按内容发现必须显式传 3，这是策略要求而非接口默认值
        self.assertEqual(search["parameters"]["seach_type"]["default"], 2)
        self.assertEqual(search["parameters"]["seach_type"]["policy_required_value"], 3)
        self.assertIn("按内容", search["parameters"]["seach_type"]["meaning"])
        self.assertIn("显式", search["parameters"]["seach_type"]["policy_note"])

        discovery = endpoints["/api/v1/douyin/xingtu/search_kol_v2"]
        self.assertEqual(discovery["status"], "live")
        self.assertEqual(discovery["last_verified_at"], "2026-10-16")
        self.assertIn("price_20_60", " ".join(discovery["response_fields"]))

        for path in (
            "/api/v1/douyin/xingtu_v2/search_anchor",
            "/api/v1/douyin/xingtu/search_kol_v1",
        ):
            self.assertEqual(endpoints[path]["status"], "failed")

        audiences = endpoints["/api/v1/douyin/xingtu_v2/get_author_fans_distribution"]
        self.assertEqual(audiences["status"], "live")
        self.assertTrue(audiences["id_contract"]["two_object_canary_required"])
        self.assertIn("平台模型标签", audiences["evidence_note"])

        spread = endpoints["/api/v1/douyin/xingtu_v2/get_author_spread_info"]
        self.assertEqual(spread["status"], "live")
        self.assertTrue(spread["id_contract"]["two_object_canary_required"])

        self.assertEqual(
            endpoints["/api/v1/douyin/web/encrypt_uid_to_sec_user_id"]["status"], "live"
        )

        audience = endpoints[
            "/api/v1/douyin/xingtu_v2/get_author_audience_distribution"
        ]
        self.assertEqual(audience["status"], "failed")
        self.assertEqual(audience["last_failure_at"], "2026-09-21")

        link = endpoints["/api/v1/douyin/xingtu_v2/get_author_link_info"]
        self.assertEqual(link["id_contract"]["parameter"], "o_author_id")
        self.assertEqual(link["id_contract"]["preferred_source"], "star_id")

    def test_skill_requires_preflight_and_executable_validation(self) -> None:
        text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("输入门禁", text)
        self.assertIn("双对象语义健康检查", text)
        self.assertIn("python3 scripts/validate_creator_output.py", text)
        self.assertIn("禁止在执行脚本中读取", text)
        self.assertIn("search_kol_v2", text)
        self.assertIn("get_author_fans_distribution", text)
        self.assertIn("平台模型标签", text)


class CreatorValidatorTests(unittest.TestCase):
    def test_accepts_partial_evidence_as_priority_test_with_platform_gap(self) -> None:
        result = run_json_tool(VALIDATOR, valid_creator_output())
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_rejects_priority_invite_when_audience_is_missing(self) -> None:
        payload = valid_creator_output()
        payload["creators"][0]["tier"] = "优先邀约"
        result = run_json_tool(VALIDATOR, payload)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("audience", result.stdout + result.stderr)

    def test_rejects_missing_requested_platform_without_gap(self) -> None:
        payload = valid_creator_output()
        payload["platform_gaps"] = []
        result = run_json_tool(VALIDATOR, payload)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("xiaohongshu", result.stdout + result.stderr)

    def test_rejects_asset_reuse_tier_without_existing_asset(self) -> None:
        payload = valid_creator_output()
        payload["creators"][0]["tier"] = "素材复用优先"
        result = run_json_tool(VALIDATOR, payload)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("asset_reuse_evidence", result.stdout + result.stderr)

    def test_accepts_verified_commercial_activity_from_31_to_90_days(self) -> None:
        payload = valid_creator_output()
        payload["creators"][0]["recent_commercial_activity"][
            "latest_verified_commercial_at"
        ] = "2026-06-23T10:00:00+08:00"
        activity = payload["creators"][0]["recent_commercial_activity"]
        activity["evidence"][0]["commercial_at"] = activity["latest_verified_commercial_at"]
        activity["selection_reason"] = "该场景缺少同角色近30天合格候选"
        result = run_json_tool(VALIDATOR, payload)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_rejects_recommended_creator_without_verified_commercial_activity(self) -> None:
        payload = valid_creator_output()
        payload["creators"][0].pop("recent_commercial_activity")
        result = run_json_tool(VALIDATOR, payload)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("recent_commercial_activity", result.stdout + result.stderr)

    def test_rejects_recommended_creator_with_commercial_activity_over_90_days_old(self) -> None:
        payload = valid_creator_output()
        payload["creators"][0]["recent_commercial_activity"][
            "latest_verified_commercial_at"
        ] = "2026-06-22T10:00:00+08:00"
        result = run_json_tool(VALIDATOR, payload)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("recent_commercial_activity", result.stdout + result.stderr)

    def test_rejects_metric_name_formula_mismatch(self) -> None:
        payload = valid_creator_output()
        payload["creators"][0]["recent_posts"]["stability_metric"][
            "name"
        ] = "median_max_ratio"
        result = run_json_tool(VALIDATOR, payload)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("stability_metric", result.stdout + result.stderr)

    def test_rejects_forbidden_transient_fields(self) -> None:
        payload = valid_creator_output()
        payload["creators"][0]["cache_url"] = "https://example.invalid/cache"
        result = run_json_tool(VALIDATOR, payload)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("cache_url", result.stdout + result.stderr)


class CanaryTests(unittest.TestCase):
    def test_rejects_identical_payloads_for_two_different_creators(self) -> None:
        left = {"code": 200, "data": {"link_spread_index": {"value": 75.55}}}
        right = {"code": 200, "data": {"link_spread_index": {"value": 75.55}}}
        with tempfile.TemporaryDirectory() as tmp:
            left_path = Path(tmp) / "left.json"
            right_path = Path(tmp) / "right.json"
            left_path.write_text(json.dumps(left), encoding="utf-8")
            right_path.write_text(json.dumps(right), encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(GUARD),
                    "canary",
                    "--left",
                    str(left_path),
                    "--right",
                    str(right_path),
                    "--core-field",
                    "data.link_spread_index",
                ],
                text=True,
                capture_output=True,
                check=False,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("identical", (result.stdout + result.stderr).lower())


class ReadonlyClientTests(unittest.TestCase):
    def test_dry_run_applies_content_search_default_without_credentials(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(CLIENT),
                "--contract",
                str(ROOT / "references" / "tikhub-endpoints.json"),
                "--path",
                "/api/v1/douyin/xingtu/search_kol_v2",
                "--query",
                "keyword=雪糕",
                "--dry-run",
            ],
            text=True,
            capture_output=True,
            check=False,
            env={},
        )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn("keyword=雪糕", result.stdout)
        self.assertNotIn("config.toml", CLIENT.read_text(encoding="utf-8"))

    def test_failed_route_is_refused_and_catalog_needs_explicit_flag(self) -> None:
        failed = subprocess.run(
            [
                sys.executable, str(CLIENT),
                "--contract", str(ROOT / "references" / "tikhub-endpoints.json"),
                "--path", "/api/v1/douyin/xingtu_v2/search_creator",
                "--query", "keyword=足球",
                "--dry-run",
            ],
            text=True, capture_output=True, check=False, env={},
        )
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("not callable", failed.stderr + failed.stdout)

        catalog = subprocess.run(
            [
                sys.executable, str(CLIENT),
                "--contract", str(ROOT / "references" / "tikhub-endpoints.json"),
                "--path", "/api/v1/douyin/xingtu_v2/get_author_convert_ability",
                "--query", "o_author_id=6690905523996327943",
                "--dry-run",
            ],
            text=True, capture_output=True, check=False, env={},
        )
        self.assertNotEqual(catalog.returncode, 0)

        health = subprocess.run(
            [
                sys.executable, str(CLIENT),
                "--contract", str(ROOT / "references" / "tikhub-endpoints.json"),
                "--path", "/api/v1/douyin/xingtu_v2/get_author_convert_ability",
                "--query", "o_author_id=6690905523996327943",
                "--allow-catalog", "--dry-run",
            ],
            text=True, capture_output=True, check=False, env={},
        )
        self.assertEqual(health.returncode, 0, health.stderr + health.stdout)

    def test_client_uses_gateway_transport(self) -> None:
        text = CLIENT.read_text(encoding="utf-8")
        self.assertIn("enterprise_proxy", text)
        self.assertNotIn("TIKHUB_API_KEY", text)
        self.assertNotIn("urlopen", text)


if __name__ == "__main__":
    unittest.main()
