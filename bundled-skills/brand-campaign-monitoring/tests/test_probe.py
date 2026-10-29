import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import tikhub_probe as probe
from enterprise_proxy import ProxyError


class ProbeTests(unittest.TestCase):
    def setUp(self):
        probe.REDACTED_KEYS.clear()

    def test_sanitize_removes_sensitive_fields_and_signed_query_values(self):
        cleaned = probe.sanitize({
            "accessToken": "secret",
            "source_url": "https://example.com/post/1",
            "media_url": "https://cdn.example.com/a.jpg?x-oss-signature=secret&width=100",
        })
        self.assertEqual(cleaned["accessToken"], "[REDACTED]")
        self.assertEqual(cleaned["source_url"], "https://example.com/post/1")
        self.assertEqual(cleaned["media_url"], "https://cdn.example.com/a.jpg?width=100")

    def test_probe_uses_enterprise_proxy_and_whitelists_persisted_payload(self):
        payload = {
            "code": 200,
            "data": {"items": [{"title": "样本", "xsec_token": "secret"}]},
        }
        item = {
            "id": "douyin.search",
            "method": "POST",
            "path": "/api/v1/douyin/search/fetch_general_search_v2",
            "json": {"keyword": "扫地机器人", "cursor": 0},
        }
        with patch.object(probe, "proxy_request", return_value=payload) as send:
            result = probe.run_probe(item, 45)
        send.assert_called_once_with(
            "tikhub", "POST", item["path"], query={}, body=item["json"], timeout=45
        )
        self.assertTrue(result["ok"])
        persisted = json.dumps(result["payload"])
        self.assertNotIn("secret", persisted)
        self.assertEqual(result["payload"]["data_sample"][0]["xsec_token"], "[REDACTED]")

    def test_proxy_failure_is_not_retried(self):
        item = {"id": "x", "method": "GET", "path": "/api/v1/test"}
        with patch.object(probe, "proxy_request", side_effect=ProxyError("OUTCOME_UNKNOWN", 504)) as send:
            result = probe.run_probe(item, 45)
        self.assertEqual(send.call_count, 1)
        self.assertFalse(result["ok"])
        self.assertEqual(result["http_status"], 504)


if __name__ == "__main__":
    unittest.main()
