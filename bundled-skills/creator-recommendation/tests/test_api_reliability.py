import contextlib
import io
import json
from pathlib import Path
import ssl
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import tikhub_readonly as client
import validate_creator_output as validator
from test_skill_hardening import valid_creator_output

SEARCH = next(item for item in json.loads((ROOT / "references/tikhub-endpoints.json").read_text())["endpoints"]
              if item["name"] == "xingtu_search_kol_v2")


class ApiReliabilityTests(unittest.TestCase):
    def test_replays_logged_upstream_400_with_nonbilling_claim(self):
        payload = {"detail": {"code": 400, "request_id": "2b5187b8-ef9d-4eec-9e33-537b8ef2cbdc",
                              "message": "Request failed. Please retry. You won't be charged for this request."}}
        result = client.inspect_response(payload, SEARCH, 400, json.dumps(payload))
        self.assertEqual(result["status"], "upstream_error")
        self.assertEqual(result["billing_status"], "server_declared_not_charged")
        self.assertEqual(result["business_code"], 400)

    def test_top_level_success_does_not_hide_nested_failure(self):
        payload = {"code": 200, "data": {"base_resp": {"status_code": 400}, "authors": []}}
        self.assertEqual(client.inspect_response(payload, SEARCH, 200)["status"], "upstream_error")

    def test_empty_is_distinct_from_broken_structure(self):
        self.assertEqual(client.inspect_response({"code": 200, "data": {"authors": []}}, SEARCH, 200)["status"], "empty")
        self.assertEqual(client.inspect_response({"code": 200, "data": {}}, SEARCH, 200)["status"], "invalid_response")
        self.assertEqual(client.inspect_response({"code": 200, "data": {"authors": [{"star_id": "1"}]}}, SEARCH, 200)["status"], "ok")

    def test_403_does_not_automatically_mean_bad_key(self):
        self.assertEqual(client.inspect_response(None, SEARCH, 403, "Cloudflare Error code: 1010")["status"], "edge_blocked")
        self.assertEqual(client.inspect_response({}, SEARCH, 403, "Forbidden")["status"], "forbidden_unknown")
        self.assertEqual(client.inspect_response({}, SEARCH, 403, "invalid API key")["status"], "authentication_error")

    def test_rejects_fake_pagination_and_combined_query(self):
        with self.assertRaisesRegex(ValueError, "undeclared"):
            client.prepare(SEARCH, ["keyword=足球", "page=2"], {})
        with self.assertRaisesRegex(ValueError, "separate"):
            client.prepare(SEARCH, ["keyword=足球&followerRange=10-100"], {})
        with self.assertRaisesRegex(ValueError, "duplicate"):
            client.parse_pairs(["keyword=足球", "keyword=探店"])

    def test_rejects_wrong_parameter_location(self):
        with self.assertRaisesRegex(ValueError, "must be in query"):
            client.prepare(SEARCH, [], {"keyword": "足球"})

    def test_failure_is_saved_safely_and_next_batch_call_is_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "probe.json"
            argv = ["client", "--contract", str(ROOT / "references/tikhub-endpoints.json"),
                    "--path", SEARCH["path"], "--query", "keyword=足球", "--output", str(output)]
            payload = {"code": 200, "data": {"base_resp": {"status_code": 400},
                       "authorization": "secret", "authors": []}}
            with patch.object(sys, "argv", argv), \
                 patch.object(client, "proxy_request", return_value=payload) as request, \
                 contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(client.main(), 1)
                self.assertEqual(client.main(), 2)
            self.assertEqual(request.call_count, 1)
            self.assertFalse(output.exists())
            status = Path(str(output) + ".status.json").read_text()
            self.assertNotIn("secret", status)
            self.assertFalse(json.loads(status)["response_saved"])

    def test_ssl_failure_is_not_retried_or_declared_free(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "probe.json"
            argv = ["client", "--contract", str(ROOT / "references/tikhub-endpoints.json"),
                    "--path", SEARCH["path"], "--query", "keyword=足球", "--output", str(output)]
            with patch.object(sys, "argv", argv), \
                 patch.object(client, "proxy_request", side_effect=ssl.SSLError("read failure")) as request, \
                 contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(client.main(), 1)
                self.assertEqual(client.main(), 2)
            self.assertEqual(request.call_count, 1)
            status = json.loads(Path(str(output) + ".status.json").read_text())
            self.assertEqual(status["billing_status"], "unknown")

    def test_gateway_failure_keeps_billing_unknown_and_blocks_followup(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "probe.json"
            argv = ["client", "--contract", str(ROOT / "references/tikhub-endpoints.json"),
                    "--path", SEARCH["path"], "--query", "keyword=足球", "--output", str(output)]
            with patch.object(sys, "argv", argv), \
                 patch.object(client, "proxy_request", side_effect=client.ProxyError(
                     "UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN", 504, {"token": "secret"})) as request, \
                 contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(client.main(), 1)
                self.assertEqual(client.main(), 2)
            self.assertEqual(request.call_count, 1)
            status = Path(str(output) + ".status.json").read_text()
            self.assertNotIn("secret", status)
            state = json.loads(status)
            self.assertEqual(state["status"], "gateway_error")
            self.assertEqual(state["billing_status"], "unknown")
            self.assertIsNone(state["http_status"])

    def test_gateway_success_preserves_query_and_sanitizes_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "probe.json"
            argv = ["client", "--contract", str(ROOT / "references/tikhub-endpoints.json"),
                    "--path", SEARCH["path"], "--query", "keyword=足球", "--output", str(output)]
            payload = {"code": 200, "data": {"authors": [{"star_id": "1", "token": "secret"}]}}
            with patch.object(sys, "argv", argv), \
                 patch.object(client, "proxy_request", return_value=payload) as request, \
                 contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(client.main(), 0)
            self.assertEqual(request.call_args.args, ("tikhub", "GET", SEARCH["path"]))
            self.assertEqual(request.call_args.kwargs["query"]["keyword"], "足球")
            self.assertNotIn("secret", output.read_text())


class CommercialEvidenceTests(unittest.TestCase):
    def test_rejects_logged_quote_availability_substitution(self):
        payload = valid_creator_output()
        activity = payload["creators"][0]["recent_commercial_activity"]
        activity["latest_verified_commercial_at"] = activity["checked_at"]
        activity["evidence"][0].update(record_kind="quote_availability", source_field="task_infos.price_infos.online_status")
        errors = validator.validate(payload)
        self.assertTrue(any("ordinary posts" in error for error in errors))
        self.assertTrue(any("not capture time" in error for error in errors))

    def test_unresolved_reference_does_not_pass(self):
        payload = valid_creator_output()
        payload["creators"][0]["recent_commercial_activity"]["evidence"] = []
        self.assertTrue(any("must resolve" in error for error in validator.validate(payload)))

    def test_another_creator_or_estimate_cannot_prove_event(self):
        payload = valid_creator_output()
        record = payload["creators"][0]["recent_commercial_activity"]["evidence"][0]
        record.update(creator_key="douyin:someone-else", evidence_type="platform_estimate")
        errors = validator.validate(payload)
        self.assertTrue(any("match creator_key" in error for error in errors))
        self.assertTrue(any("estimates cannot prove" in error for error in errors))

    def test_31_to_90_days_requires_selection_reason(self):
        payload = valid_creator_output()
        activity = payload["creators"][0]["recent_commercial_activity"]
        activity["latest_verified_commercial_at"] = "2026-08-10T10:00:00+08:00"
        activity["evidence"][0]["commercial_at"] = activity["latest_verified_commercial_at"]
        self.assertTrue(any("selection_reason" in error for error in validator.validate(payload)))
        activity["selection_reason"] = "该细分场景暂无近30天合格候选"
        self.assertEqual(validator.validate(payload), [])


if __name__ == "__main__":
    unittest.main()
