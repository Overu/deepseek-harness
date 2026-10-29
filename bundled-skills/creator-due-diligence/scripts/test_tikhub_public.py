"""Offline regression checks; no credentials or live API calls."""
import contextlib
import io
import json
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import tikhub_public as api


class CollectorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads(api.CATALOG.read_text())

    def route(self, suffix="douyin/app/v3/fetch_video_comments"):
        return next(r for r in self.catalog["endpoints"] if r["path"] == "/api/v1/" + suffix)

    def test_catalog_covers_eight_platform_inventory_and_prices(self):
        platforms = {r["platform"] for r in self.catalog["endpoints"]}
        self.assertTrue({"douyin", "xiaohongshu", "weibo", "bilibili", "kuaishou",
                         "wechat_channels", "wechat_mp", "zhihu"} <= platforms)
        self.assertEqual(len(self.catalog["endpoints"]), len({r["path"] for r in self.catalog["endpoints"]}))
        for route in self.catalog["endpoints"]:
            self.assertEqual(route["status"], "docs_confirmed")
            self.assertGreaterEqual(api.money(route["price_usd"]), 0)
            self.assertEqual(route["parameter_location"], "body" if route["method"] == "POST" else "query")

    def test_comment_count_does_not_override_documented_twenty(self):
        with self.assertRaises(api.CollectorError):
            api.prepare(self.route(), {"aweme_id": "123", "count": 100})
        self.assertEqual(api.prepare(self.route(), {"aweme_id": "123"})["count"], 20)

    def test_large_id_must_be_supplied_as_string(self):
        with self.assertRaises(api.CollectorError):
            api.prepare(self.route(), {"aweme_id": 999999999999999999})

    def test_share_url_alternative_and_unknown_parameter(self):
        route = self.route("xiaohongshu/app_v2/get_note_comments")
        with self.assertRaises(api.CollectorError):
            api.prepare(route, {})
        self.assertIn("share_text", api.prepare(route, {"share_text": "https://xhslink.com/a/abc"}))
        with self.assertRaises(api.CollectorError):
            api.prepare(route, {"note_id": "abc", "cookie": "not-accepted"})

    def test_post_body_cursor_preserved_and_private_search_not_accepted(self):
        route = self.route("wechat_search/v2/fetch_search")
        params = api.prepare(route, {"keyword": "sample", "cursor": "ab+/==", "business_type": "account"})
        self.assertEqual(params["cursor"], "ab+/==")
        self.assertIs(params["raw"], False)
        with self.assertRaises(api.CollectorError):
            api.prepare(route, {"keyword": "sample", "business_type": "moments"})

    def test_kuaishou_posts_need_numeric_id_not_homepage_eid(self):
        route = self.route("kuaishou/app/fetch_user_post_v2")
        with self.assertRaises(api.CollectorError):
            api.prepare(route, {"user_id": "3xabc"})
        self.assertEqual(api.prepare(route, {"user_id": "123456"})["user_id"], "123456")

    def test_sanitizer_removes_credentials_media_and_large_number_precision_risk(self):
        raw = {"Authorization": "secret", "data": {"cid": 14941130915890399732,
               "text": "provider echoed secret", "cache_url": "https://example.org/cache",
               "media": {"url": "https://cdn.example.org/file.mp4"},
               "link": "https://example.org/item?sign=sensitive", "openid": "private", "token": "private",
               "clip": "https://cdn.example.org/file.mp4",
               "public_url": "https://www.douyin.com/video/123"}}
        clean = api.sanitize(raw, "secret")
        rendered = json.dumps(clean)
        self.assertNotIn("secret", rendered)
        self.assertNotIn("openid", rendered)
        self.assertNotIn("token", clean["data"])
        self.assertNotIn("media", clean["data"])
        self.assertIsNone(clean["data"]["link"])
        self.assertIsNone(clean["data"]["clip"])
        self.assertEqual(clean["data"]["cid"], "14941130915890399732")
        self.assertEqual(clean["data"]["public_url"], "https://www.douyin.com/video/123")

    def test_requests_use_gateway_and_preserve_opaque_cursor(self):
        payload = {"code": 200, "data": {"id": "14941130915890399732"}}
        path = "/api/v1/wechat_search/v2/fetch_search"
        with patch.object(api, "proxy_request", return_value=payload) as request:
            status, result = api.request_json(path, "POST", {"cursor": "ab+/==", "keyword": "sample"})
        self.assertEqual(status, 200)
        self.assertEqual(result, payload)
        self.assertEqual(request.call_args.args, ("tikhub", "POST", path))
        self.assertEqual(request.call_args.kwargs["body"]["cursor"], "ab+/==")
        self.assertEqual(request.call_args.kwargs["query"], {})

    def test_gateway_unsafe_numeric_ids_are_rejected(self):
        with patch.object(api, "proxy_request", return_value={"code": 200, "data": {"id": 14941130915890399732}}):
            with self.assertRaisesRegex(api.CollectorError, "large IDs must be strings"):
                api.request_json(self.route()["path"])

    def test_nested_error_and_403_do_not_become_valid_evidence(self):
        result = api.inspect_response(self.route(), 200, {"code": 200, "data": {"baseResponse": {"ret": -1}}})
        self.assertEqual(result["status"], "business_error")
        self.assertEqual(api.inspect_response(self.route(), 403, {})["status"], "forbidden_unknown")

    def test_empty_comment_page_is_not_evidence_of_no_comments(self):
        result = api.inspect_response(self.route(), 200, {"code": 200, "data": {"comments": []}})
        self.assertEqual(result["status"], "empty")
        self.assertEqual(result["comment_sample"]["valid_comment_count"], 0)
        self.assertEqual(result["comment_sample"]["sample_status"], "not_assessed")

    def test_douyin_posts_minimal_recipe_has_no_unverified_defaults(self):
        route = self.route("douyin/app/v3/fetch_user_post_videos")
        self.assertEqual(api.prepare(route, {"sec_user_id": "sample"}), {"sec_user_id": "sample"})
        self.assertEqual(api.prepare(route, {"sec_user_id": "sample", "max_cursor": 1783760474000}),
                         {"sec_user_id": "sample", "max_cursor": 1783760474000})
        with self.assertRaises(api.CollectorError):
            api.prepare(route, {"sec_user_id": "sample", "count": 20})

    def test_nested_xhs_comment_fixture_is_counted_at_correct_path(self):
        route = self.route("xiaohongshu/app_v2/get_note_comments")
        payload = {"code": 200, "data": {"code": 0, "success": True, "data": {
            "comments": [{"id": "c1", "content": "公开评论样例", "hidden": False, "invalid": False}],
            "has_more": True}}}
        result = api.inspect_response(route, 200, payload, min_valid_comments=5)
        self.assertEqual(result["status"], "business_ok_unreviewed")
        sample = result["comment_sample"]
        self.assertEqual(sample["items_path"], "data.data.comments")
        self.assertEqual(sample["valid_comment_count"], 1)
        self.assertEqual(sample["sample_status"], "insufficient")
        self.assertEqual(sample["assessment_scope"], "current_response_only")

    def test_comment_counts_exclude_duplicates_blank_hidden_and_invalid(self):
        payload = {"code": 200, "data": {"comments": [
            {"cid": "1", "text": "有效"}, {"cid": "1", "text": "重复"},
            {"cid": "2", "text": "  "}, {"cid": "3", "text": "不可见", "hidden": True},
            {"cid": "4", "text": "无效", "invalid": True}, {"text": "缺少ID"}]}}
        sample = api.inspect_response(self.route(), 200, payload, min_valid_comments=1)["comment_sample"]
        self.assertEqual(sample["returned_count"], 6)
        self.assertEqual(sample["valid_comment_count"], 1)
        self.assertEqual(sample["duplicate_count"], 1)
        self.assertEqual(sample["unusable_count"], 4)
        self.assertEqual(sample["sample_status"], "target_met")

    def test_wrong_comment_structure_and_nested_failure_are_not_empty_success(self):
        route = self.route("xiaohongshu/app_v2/get_note_comments")
        for payload in ({"code": 200, "data": {"data": {}}},
                        {"code": 200, "data": {"data": {"comments": "unexpected"}}}):
            self.assertEqual(api.inspect_response(route, 200, payload)["status"], "invalid_response")
        payload = {"code": 200, "data": {"code": 0, "success": False, "data": {"comments": []}}}
        self.assertEqual(api.inspect_response(route, 200, payload)["status"], "business_error")

    def test_cli_defaults_to_one_dollar_and_uses_only_target_route(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            params = root / "params.json"
            params.write_text(json.dumps({"aweme_id": "123"}))
            stdout = io.StringIO()
            payload = {"code": 200, "data": {"comments": [{"cid": "c1", "text": "公开样例"}]}}
            with patch.object(api, "proxy_request", return_value=payload) as request, \
                    contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(stdout):
                result = api.main(["--path", self.route()["path"], "--params", str(params), "--execute",
                    "--output", str(root / "result.json"), "--ledger", str(root / "calls.jsonl")])
            self.assertEqual(result, 0)
            summary = json.loads(stdout.getvalue())
            self.assertTrue(summary["output_saved"])
            self.assertEqual(summary["reserved_usd"], "0.001")
            self.assertEqual(summary["price_basis"], "builtin_catalog")
            self.assertEqual(summary["price_checked_at"], "2026-10-19")
            self.assertIsNone(summary["current_actual_usd"])
            with (root / "calls.jsonl").open() as stream:
                rows = api.read_ledger(stream)
            self.assertEqual([r["kind"] for r in rows], ["reserve", "result"])
            self.assertEqual(rows[0]["budget_usd"], "1")
            self.assertEqual(rows[0]["price_basis"], "builtin_catalog")
            self.assertEqual([c.args[:3] for c in request.call_args_list],
                             [("tikhub", "GET", self.route()["path"])])

    def test_catalog_price_allows_collection_when_price_lookup_route_is_forbidden(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            def gateway(connection, method, path, **kwargs):
                if path != self.route()["path"]:
                    raise api.ProxyError("SKILL_PROXY_ROUTE_FORBIDDEN", 403)
                return {"code": 200, "data": {"comments": [{"cid": "1", "text": "样例"}]}}
            with patch.object(api, "proxy_request", side_effect=gateway) as request:
                result = api.collect(self.route(), {}, root / "one.json", root / "ledger.jsonl", Decimal(1), Decimal(0))
            self.assertTrue(result["output_saved"])
            self.assertEqual(result["stage"], "completed")
            self.assertEqual(result["reserved_usd"], "0.001")
            self.assertEqual(request.call_count, 1)

    def test_legacy_pricing_diagnostic_does_not_block_catalog_priced_collection(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            ledger = root / "calls.jsonl"
            ledger.write_text(json.dumps({"kind": "diagnostic", "stage": "price_lookup",
                "path": "/api/v1/tikhub/user/get_endpoint_info", "target_path": self.route()["path"],
                "data_request_attempted": False, "reserved_usd": "0"}) + "\n")
            with patch.object(api, "proxy_request", return_value={"code": 200, "data": {
                     "comments": [{"cid": "1", "text": "样例"}]}}) as request:
                result = api.collect(self.route(), {}, root / "one.json", ledger, Decimal(1), Decimal(0))
            self.assertTrue(result["output_saved"])
            self.assertEqual(request.call_count, 1)
            self.assertEqual(result["cumulative_reserved_usd"], "0.001")

    def test_missing_or_invalid_catalog_price_never_triggers_price_lookup(self):
        for price in (None, -1, "NaN", "unknown"):
            with self.subTest(price=price), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                route = dict(self.route(), price_usd=price)
                with patch.object(api, "proxy_request", return_value={"code": 200, "data": {}}) as request, \
                        self.assertRaises(api.CollectorError):
                    api.collect(route, {}, root / "out.json", root / "ledger.jsonl", Decimal(1), Decimal(0))
                request.assert_not_called()

    def test_default_task_budget_is_shared_across_platforms_and_stops_above_one_dollar(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            payload = {"code": 200, "data": {"comments": [{"cid": "c1", "text": "样例"}],
                "code": 0, "success": True, "data": {"comments": [{"id": "c2", "content": "样例"}]}}}
            cases = [("xiaohongshu/app_v2/get_note_comments", {"note_id": "n1"}, 0),
                     ("douyin/app/v3/fetch_video_comments", {"aweme_id": "123"}, 0),
                     ("douyin/app/v3/fetch_video_comments", {"aweme_id": "456"}, 2)]
            with patch.object(api, "proxy_request", return_value=payload) as request:
                for index, (suffix, supplied, expected) in enumerate(cases):
                    params = root / f"params-{index}.json"
                    params.write_text(json.dumps(supplied))
                    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                        code = api.main(["--path", self.route(suffix)["path"], "--params", str(params), "--execute",
                            "--output", str(root / f"out-{index}.json"), "--ledger", str(root / "ledger.jsonl"),
                            "--prior-spend-usd", "0.989"])
                    self.assertEqual(code, expected)
            with (root / "ledger.jsonl").open() as stream:
                rows = api.read_ledger(stream)
            results = [r for r in rows if r["kind"] == "result"]
            self.assertEqual([r["reserved_usd"] for r in results], ["0.01", "0.001"])
            self.assertEqual(results[-1]["cumulative_reserved_usd"], "1.000")
            self.assertEqual(request.call_count, 2)
            self.assertFalse((root / "out-2.json").exists())

    def test_default_budget_counts_uncertain_request_before_diagnostic_recheck(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            params = root / "params.json"
            params.write_text(json.dumps({"aweme_id": "123"}))
            base = ["--path", self.route()["path"], "--params", str(params), "--execute",
                    "--ledger", str(root / "ledger.jsonl"), "--prior-spend-usd", "0.999"]
            with patch.object(api, "proxy_request", side_effect=api.ProxyError("OUTCOME_UNKNOWN", 504)) as request, \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                first = api.main(base + ["--output", str(root / "one.json")])
                second = api.main(base + ["--output", str(root / "two.json"), "--recheck"])
            self.assertEqual(first, 1)
            self.assertEqual(second, 2)
            self.assertEqual(request.call_count, 1)
            with (root / "ledger.jsonl").open() as stream:
                rows = api.read_ledger(stream)
            result = next(r for r in rows if r["kind"] == "result")
            self.assertEqual(result["cumulative_reserved_usd"], "1.000")
            self.assertEqual(result["gateway_code"], "OUTCOME_UNKNOWN")
            self.assertEqual(result["reserved_usd"], "0.001")
            self.assertEqual(rows[-1]["status"], "budget_exhausted")
            self.assertEqual(rows[-1]["reserved_usd"], "0")

    def budget_cli(self, root, name, extra=()):
        params = root / "params.json"
        params.write_text(json.dumps({"aweme_id": "123"}))
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            try:
                code = api.main(["--path", self.route()["path"], "--params", str(params), "--execute",
                    "--output", str(root / name), "--ledger", str(root / "ledger.jsonl"), *extra])
            except SystemExit as exc:
                code = exc.code
        try:
            summary = json.loads(stdout.getvalue() or stderr.getvalue())
        except ValueError:
            summary = {"error": stderr.getvalue()}
        return code, summary

    def test_budget_stop_reports_approval_needed_without_another_request(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            payload = {"code": 200, "data": {"comments": [{"cid": "1", "text": "样例"}]}}
            with patch.object(api, "proxy_request", return_value=payload) as request:
                self.assertEqual(self.budget_cli(root, "one.json", ["--prior-spend-usd", "0.999"])[0], 0)
                code, result = self.budget_cli(root, "two.json", ["--prior-spend-usd", "0.999"])
            self.assertEqual(code, 2)
            self.assertEqual(result.get("status"), "budget_exhausted")
            self.assertFalse(result["data_request_attempted"])
            self.assertEqual(result["budget_usd"], "1")
            self.assertEqual(result["cumulative_reserved_usd"], "1.000")
            self.assertEqual(result["next_request_usd"], "0.001")
            self.assertEqual(result["minimum_total_budget_usd"], "1.001")
            self.assertEqual(result["additional_usd_needed"], "0.001")
            self.assertEqual(result["next_action"], "request_user_budget_approval")
            self.assertEqual(request.call_count, 1)

    def test_approved_budget_resumes_original_ledger_and_is_used_by_later_calls(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            payload = {"code": 200, "data": {"comments": [{"cid": "1", "text": "样例"}]}}
            with patch.object(api, "proxy_request", return_value=payload) as request:
                self.assertEqual(self.budget_cli(root, "one.json", ["--prior-spend-usd", "0.999"])[0], 0)
                original = (root / "ledger.jsonl").read_text()
                code, resumed = self.budget_cli(root, "two.json",
                    ["--approve-budget-usd", "2", "--approval-ref", "chat-confirmation-01"])
                self.assertEqual(code, 0)
                self.assertEqual(resumed["budget_usd"], "2")
                self.assertEqual(resumed["cumulative_reserved_usd"], "1.001")
                code, later = self.budget_cli(root, "three.json")
            self.assertEqual(code, 0)
            self.assertEqual(later["budget_usd"], "2")
            self.assertEqual(later["cumulative_reserved_usd"], "1.002")
            self.assertEqual(request.call_count, 3)
            self.assertTrue((root / "ledger.jsonl").read_text().startswith(original))
            with (root / "ledger.jsonl").open() as stream:
                rows = api.read_ledger(stream)
            updates = [r for r in rows if r["kind"] == "budget_update"]
            self.assertEqual(len(updates), 1)
            self.assertEqual(updates[0]["previous_budget_usd"], "1")
            self.assertEqual(updates[0]["budget_usd"], "2")
            self.assertEqual(updates[0]["prior_spend_usd"], "0.999")
            self.assertEqual(updates[0]["approval_ref"], "chat-confirmation-01")
            self.assertTrue(updates[0]["approved_at"])

    def test_approval_before_first_reservation_preserves_prior_spend(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            payload = {"code": 200, "data": {"comments": []}}
            with patch.object(api, "proxy_request", return_value=payload) as request:
                self.assertEqual(self.budget_cli(root, "one.json", ["--prior-spend-usd", "1"])[0], 2)
                code, result = self.budget_cli(root, "two.json", [
                    "--approve-budget-usd", "2", "--approval-ref", "chat-confirmation-01"])
            self.assertEqual(code, 0)
            self.assertEqual(result["cumulative_reserved_usd"], "1.001")
            self.assertEqual(request.call_count, 1)

    def test_budget_increase_requires_approval_and_cannot_reset_prior_spend(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.object(api, "proxy_request", return_value={"code": 200, "data": {"comments": []}}) as request:
                self.assertEqual(self.budget_cli(root, "one.json", ["--prior-spend-usd", "0.9"])[0], 0)
                original = (root / "ledger.jsonl").read_text()
                cases = [["--budget-usd", "2", "--prior-spend-usd", "0.9"],
                         ["--approve-budget-usd", "2"], ["--approval-ref", "chat-confirmation-01"],
                         ["--approve-budget-usd", "0.5", "--approval-ref", "chat-confirmation-01"],
                         ["--approve-budget-usd", "NaN", "--approval-ref", "chat-confirmation-01"],
                         ["--approve-budget-usd", "2", "--approval-ref", "not a reference"],
                         ["--approve-budget-usd", "2", "--approval-ref", "chat-confirmation-01", "--prior-spend-usd", "0"]]
                for index, args in enumerate(cases):
                    with self.subTest(args=args):
                        self.assertEqual(self.budget_cli(root, f"bad-{index}.json", args)[0], 2)
                        self.assertEqual((root / "ledger.jsonl").read_text(), original)
            self.assertEqual(request.call_count, 1)

    def test_repeated_approval_is_idempotent_and_later_increase_is_a_new_total(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.object(api, "proxy_request", return_value={"code": 200, "data": {"comments": []}}):
                self.assertEqual(self.budget_cli(root, "one.json")[0], 0)
                args = ["--approve-budget-usd", "2", "--approval-ref", "chat-confirmation-01"]
                self.assertEqual(self.budget_cli(root, "two.json", args)[0], 0)
                self.assertEqual(self.budget_cli(root, "three.json", args)[0], 0)
                self.assertEqual(self.budget_cli(root, "four.json", ["--approve-budget-usd", "3",
                    "--approval-ref", "chat-confirmation-02"])[0], 0)
                self.assertEqual(self.budget_cli(root, "bad.json", args)[0], 2)
                self.assertEqual(self.budget_cli(root, "bad-2.json", ["--approve-budget-usd", "4",
                    "--approval-ref", "chat-confirmation-02"])[0], 2)
                code, result = self.budget_cli(root, "five.json")
            self.assertEqual(code, 0)
            self.assertEqual(result["budget_usd"], "3")
            self.assertEqual(result["cumulative_reserved_usd"], "0.005")
            with (root / "ledger.jsonl").open() as stream:
                rows = api.read_ledger(stream)
            self.assertEqual([r["budget_usd"] for r in rows if r["kind"] == "budget_update"], ["2", "3"])

    def test_budget_approval_does_not_reset_failed_route_circuit_or_reserved_cost(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.object(api, "proxy_request", side_effect=api.ProxyError("OUTCOME_UNKNOWN", 504)) as request:
                self.assertEqual(self.budget_cli(root, "one.json", ["--prior-spend-usd", "0.999"])[0], 1)
                args = ["--approve-budget-usd", "2", "--approval-ref", "chat-confirmation-01"]
                self.assertEqual(self.budget_cli(root, "blocked.json", args)[0], 2)
                code, result = self.budget_cli(root, "two.json", ["--recheck"])
                self.assertEqual(code, 1)
                self.assertEqual(result["cumulative_reserved_usd"], "1.001")
                self.assertEqual(self.budget_cli(root, "blocked-2.json", ["--recheck",
                    "--approve-budget-usd", "3", "--approval-ref", "chat-confirmation-02"])[0], 2)
            self.assertEqual(request.call_count, 2)

    def test_invalid_budget_update_chain_is_rejected_when_reading_ledger(self):
        reserve = {"kind": "reserve", "call_id": "x", "path": "p", "budget_usd": "1",
                   "prior_spend_usd": "0.9", "reserved_usd": "0.001"}
        valid = {"kind": "budget_update", "previous_budget_usd": "1", "budget_usd": "2",
                 "prior_spend_usd": "0.9", "approval_ref": "chat-confirmation-01", "approved_at": "2026-10-22"}
        for change in ({"previous_budget_usd": "0.5"}, {"budget_usd": "1"}, {"approval_ref": ""},
                       {"prior_spend_usd": "0"}, {"approved_at": ""}):
            with self.subTest(change=change), self.assertRaises(api.CollectorError):
                api.read_ledger(io.StringIO(json.dumps(reserve) + "\n" + json.dumps(dict(valid, **change)) + "\n"))

    def test_cli_saves_nested_comments_and_reports_insufficient_sample(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            params = root / "params.json"
            params.write_text(json.dumps({"note_id": "sample"}))
            payload = {"code": 200, "data": {"code": 0, "success": True, "data": {
                "comments": [{"id": "c1", "content": "有效样例"}], "has_more": True}}}
            stdout = io.StringIO()
            with patch.object(api, "request_json", return_value=(200, payload)), \
                 contextlib.redirect_stdout(stdout):
                code = api.main(["--path", self.route("xiaohongshu/app_v2/get_note_comments")["path"],
                    "--params", str(params), "--execute", "--output", str(root / "out.json"),
                    "--ledger", str(root / "ledger.jsonl"), "--budget-usd", "1", "--min-valid-comments", "5"])
            self.assertEqual(code, 0)  # Successful collection, not evidence adequacy.
            result = json.loads(stdout.getvalue())
            self.assertTrue(result["output_saved"])
            self.assertEqual(result["comment_sample"]["valid_comment_count"], 1)
            self.assertEqual(result["comment_sample"]["sample_status"], "insufficient")
            self.assertEqual(json.loads((root / "out.json").read_text())["data"]["data"]["comments"][0]["content"], "有效样例")

    def test_missing_comment_structure_is_recorded_as_validation_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.object(api, "request_json", return_value=(200, {"code": 200, "data": {}})):
                result = api.collect(self.route(), {}, root / "out.json", root / "ledger.jsonl", Decimal(1), Decimal(0))
            self.assertEqual(result["stage"], "response_validation")
            self.assertEqual(result["status"], "invalid_response")
            self.assertFalse(result["output_saved"])
            self.assertEqual(result["reserved_usd"], "0.001")
            self.assertFalse((root / "out.json").exists())

    def test_minimum_comment_target_is_validated_before_any_network_call(self):
        with tempfile.TemporaryDirectory() as folder:
            params = Path(folder) / "params.json"
            params.write_text(json.dumps({"aweme_id": "123"}))
            with patch.object(api, "request_json") as request, contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(api.main(["--path", self.route()["path"], "--params", str(params),
                                           "--min-valid-comments", "0"]), 2)
            request.assert_not_called()

    @patch.object(api, "request_json", return_value=(200, {"code": 200, "data": {"comments": [{"text": "ok"}]}}))
    def test_two_requests_share_cumulative_budget(self, request):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            result = api.collect(self.route(), {"aweme_id": "123"}, root / "one.json", root / "calls.jsonl",
                                 Decimal("0.0015"), Decimal(0))
            self.assertTrue(result["output_saved"])
            with self.assertRaises(api.CollectorError):
                api.collect(self.route(), {"aweme_id": "123"}, root / "two.json", root / "calls.jsonl",
                            Decimal("0.0015"), Decimal(0))
            self.assertEqual(request.call_count, 1)
            self.assertFalse((root / "two.json").exists())
            with (root / "calls.jsonl").open() as stream:
                rows = api.read_ledger(stream)
            self.assertEqual(sum(api.money(r["reserved_usd"]) for r in rows if r["kind"] == "reserve"), Decimal("0.001"))

    @patch.object(api, "request_json", side_effect=api.ProxyError("OUTCOME_UNKNOWN", 504, "private detail"))
    def test_failure_keeps_reservation_and_allows_only_one_diagnostic_recheck(self, request):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            call = lambda name, recheck=False: api.collect(self.route(), {"aweme_id": "123"}, root / name,
                root / "calls.jsonl", Decimal("1"), Decimal(0), recheck=recheck)
            first = call("one.json")
            self.assertEqual(first["status"], "gateway_error")
            self.assertEqual(first["stage"], "data_request")
            self.assertEqual(first["path"], self.route()["path"])
            self.assertEqual(first["gateway_code"], "OUTCOME_UNKNOWN")
            self.assertIsNone(first["current_actual_usd"])
            self.assertNotIn("private detail", json.dumps(first))
            with self.assertRaises(api.CollectorError):
                call("two.json")
            self.assertEqual(call("three.json", True)["reserved_usd"], "0.001")
            with self.assertRaises(api.CollectorError):
                call("four.json", True)
            self.assertEqual(request.call_count, 2)
            with (root / "calls.jsonl").open() as stream:
                rows = api.read_ledger(stream)
            self.assertEqual(sum(api.money(r["reserved_usd"]) for r in rows if r["kind"] == "reserve"), Decimal("0.002"))

    @patch.object(api, "request_json")
    def test_existing_snapshot_is_never_overwritten(self, request):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            out = root / "one.json"
            out.write_text("existing")
            with self.assertRaises(api.CollectorError):
                api.collect(self.route(), {}, out, root / "calls.jsonl", Decimal(1), Decimal(0))
            self.assertEqual(out.read_text(), "existing")
            request.assert_not_called()

    def test_prior_spend_budget_changes_and_corrupt_ledger_fail_closed(self):
        row = {"kind": "reserve", "call_id": "x", "path": "p", "budget_usd": "1",
               "prior_spend_usd": "0.9", "reserved_usd": "0.05"}
        with self.assertRaises(api.CollectorError):
            api.check_budget([row], Decimal(1), Decimal("0.9"), Decimal("0.1"), "q")
        with self.assertRaises(api.CollectorError):
            api.check_budget([row], Decimal(2), Decimal("0.9"), Decimal("0.01"), "q")
        with self.assertRaises(api.CollectorError):
            api.read_ledger(io.StringIO("{broken"))

    def test_dry_run_never_uses_network_or_requires_key(self):
        with tempfile.TemporaryDirectory() as folder:
            params = Path(folder) / "params.json"
            params.write_text(json.dumps({"aweme_id": "123"}))
            output = io.StringIO()
            with patch.object(api, "request_json") as request, contextlib.redirect_stdout(output):
                status = api.main(["--path", self.route()["path"], "--params", str(params)])
            self.assertEqual(status, 0)
            self.assertEqual(json.loads(output.getvalue())["mode"], "dry_run")
            request.assert_not_called()

    def test_non_catalog_write_route_is_rejected(self):
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(api.main(["--path", "/api/v1/pipixia/app/increase_post_view"]), 2)


if __name__ == "__main__":
    unittest.main()
