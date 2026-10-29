import json
import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "validate_insight_output.py"
GUARD = ROOT / "scripts" / "tikhub_guard.py"
CLIENT = ROOT / "scripts" / "tikhub_readonly.py"
sys.path.insert(0, str(ROOT / "scripts"))
CLIENT_SPEC = importlib.util.spec_from_file_location("category_tikhub_readonly", CLIENT)
CLIENT_MODULE = importlib.util.module_from_spec(CLIENT_SPEC)
assert CLIENT_SPEC and CLIENT_SPEC.loader
CLIENT_SPEC.loader.exec_module(CLIENT_MODULE)


def run_validator(payload: dict) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "input.json"
        source.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        return subprocess.run(
            [sys.executable, str(VALIDATOR), "--input", str(source)],
            text=True,
            capture_output=True,
            check=False,
        )


def valid_insight_output() -> dict:
    return {
        "requested_platforms": ["douyin", "xiaohongshu"],
        "platform_gaps": [],
        "queries": [
            {
                "query_id": "q-dy-1",
                "platform": "douyin",
                "query": "雪糕 测评",
                "pages_collected": 3,
                "saturation_reached": False,
                "effective_sample_size": 46,
            },
            {
                "query_id": "q-xhs-1",
                "platform": "xiaohongshu",
                "query": "雪糕 测评",
                "pages_collected": 3,
                "saturation_reached": False,
                "effective_sample_size": 55,
            },
        ],
        "excluded_evidence_ids": ["noise-pet-name"],
        "opportunities": [
            {
                "opportunity_id": "OPP-01",
                "evidence_refs": ["content-1", "comment-1"],
            }
        ],
        "insight_handoff": {
            "handoff_id": "HANDOFF-1",
            "opportunity_inputs": [
                {"opportunity_id": "OPP-01", "creator_archetypes": ["食品测评"]}
            ],
        },
    }


class EndpointContractTests(unittest.TestCase):
    def test_contract_has_methods_and_required_parameters(self) -> None:
        contract = json.loads(
            (ROOT / "references" / "tikhub-endpoints.json").read_text(
                encoding="utf-8"
            )
        )
        endpoints = {item["path"]: item for item in contract["endpoints"]}

        xhs = endpoints["/api/v1/xiaohongshu/app_v2/search_notes"]
        self.assertEqual(xhs["method"], "GET")

        trend = endpoints["/api/v1/douyin/index/fetch_multi_keyword_hot_trend"]
        self.assertEqual(trend["method"], "POST")
        self.assertEqual(
            trend["required_parameters"],
            ["keyword_list", "start_date", "end_date"],
        )

        billboard = endpoints["/api/v1/douyin/billboard/fetch_hot_total_list"]
        self.assertEqual(billboard["method"], "GET")
        self.assertIn("type", billboard["required_parameters"])

    def test_skill_requires_sampling_and_noise_exclusion_gates(self) -> None:
        text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("样本充分性门禁", text)
        self.assertIn("连续两页", text)
        self.assertIn("禁止重新作为机会证据", text)
        self.assertIn("python3 scripts/validate_insight_output.py", text)


class InsightValidatorTests(unittest.TestCase):
    def test_accepts_three_pages_per_core_query(self) -> None:
        result = run_validator(valid_insight_output())
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_rejects_one_page_without_saturation(self) -> None:
        payload = valid_insight_output()
        payload["queries"][0]["pages_collected"] = 1
        result = run_validator(payload)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("pages_collected", result.stdout + result.stderr)

    def test_rejects_excluded_noise_reused_as_evidence(self) -> None:
        payload = valid_insight_output()
        payload["opportunities"][0]["evidence_refs"].append("noise-pet-name")
        result = run_validator(payload)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("noise-pet-name", result.stdout + result.stderr)

    def test_rejects_missing_platform_without_gap(self) -> None:
        payload = valid_insight_output()
        payload["queries"] = [payload["queries"][0]]
        result = run_validator(payload)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("xiaohongshu", result.stdout + result.stderr)

    def test_rejects_missing_handoff_for_creator_downstream(self) -> None:
        payload = valid_insight_output()
        payload["insight_handoff"] = None
        result = run_validator(payload)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("insight_handoff", result.stdout + result.stderr)


class SanitizerTests(unittest.TestCase):
    def test_removes_transient_fields_but_keeps_stable_public_url(self) -> None:
        payload = {
            "cache_url": "https://example.invalid/cache",
            "data": {
                "xsec_token": "secret",
                "sign": "secret",
                "source_url": "https://example.com/post/123",
                "media_url": "https://cdn.example.com/a.jpg?x-oss-signature=secret",
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "raw.json"
            target = Path(tmp) / "clean.json"
            source.write_text(json.dumps(payload), encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(GUARD),
                    "sanitize",
                    "--input",
                    str(source),
                    "--output",
                    str(target),
                ],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            cleaned = json.loads(target.read_text(encoding="utf-8"))

        serialized = json.dumps(cleaned, ensure_ascii=False)
        self.assertNotIn("cache_url", serialized)
        self.assertNotIn("xsec_token", serialized)
        self.assertNotIn("x-oss-signature", serialized)
        self.assertEqual(cleaned["data"]["source_url"], "https://example.com/post/123")


class ReadonlyClientTests(unittest.TestCase):
    def test_posts_through_enterprise_proxy_and_writes_only_sanitized_json(self) -> None:
        observed = {}

        def fake_proxy(connection, method, path, **kwargs):
            observed.update(connection=connection, method=method, path=path, **kwargs)
            return {
                "code": 200,
                "cache_url": "https://example.invalid/cache",
                "data": {"items": [1], "xsec_token": "secret"},
            }

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "response.json"
            argv = [
                str(CLIENT),
                "--contract", str(ROOT / "references" / "tikhub-endpoints.json"),
                "--path", "/api/v1/douyin/search/fetch_general_search_v2",
                "--body-json", '{"keyword":"雪糕","offset":0,"count":20}',
                "--output", str(output),
            ]
            with patch.object(CLIENT_MODULE, "proxy_request", side_effect=fake_proxy), patch.object(sys, "argv", argv):
                result = CLIENT_MODULE.main()
            self.assertEqual(result, 0)
            cleaned = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(observed["connection"], "tikhub")
        self.assertEqual(observed["method"], "POST")
        self.assertEqual(observed["body"]["keyword"], "雪糕")
        serialized = json.dumps(cleaned)
        self.assertNotIn("cache_url", serialized)
        self.assertNotIn("xsec_token", serialized)


if __name__ == "__main__":
    unittest.main()
