#!/usr/bin/env python3
"""Run read-only TikHub smoke probes through the logged-in enterprise proxy."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
import sys
import time
import urllib.parse
from pathlib import Path

from enterprise_proxy import ProxyError, request as proxy_request

# 敏感字段判定：先做 camelCase 归一化，再按段边界匹配。
# 结尾的 (?!(?:_?[a-z0-9])) 而非简单字符类：sign_count / author 这类业务字段不误伤，
# 而归一化后带尾下划线的 access_token 仍能命中。
SENSITIVE_KEY = re.compile(
    r"(?:^|[_\-.])"
    r"(?:"
    r"authorization|auth|cookie|credential|"
    r"token|secret|password|passwd|session|signature|"
    r"xsec|play_url|download_url|signed_url|"
    r"api_key|access_key|secret_key|private_key|"
    r"sign|chksm|chksum|checksum|verify|nonce"
    r")"
    r"(?!(?:_?[a-z0-9]))",
    re.IGNORECASE,
)
# 短名（sn/ts 等）按整段相等判定
EXACT_SENSITIVE_KEYS = {"sn", "ts", "sig", "sign", "signature", "chksm", "chksum", "checksum", "sid"}
# 探针运行期记录被脱敏的 key 名，供运行结束后的自检输出
REDACTED_KEYS: set[str] = set()


def _normalize_key_name(key: object) -> str:
    """把 camelCase key 归一化成 snake_case，让 accessToken 与 access_token 命中同一条规则。"""
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", str(key))


def is_sensitive_key(key: object) -> bool:
    """判断字段名是否属于敏感字段（授权/凭据/签名/短期播放地址）。"""
    raw = str(key).strip()
    if raw.lower() in EXACT_SENSITIVE_KEYS:
        return True
    return bool(SENSITIVE_KEY.search(_normalize_key_name(raw)))


def _record_redaction(key: object) -> None:
    REDACTED_KEYS.add(str(key))


SEED_PROBES = [
    {"id": "douyin.search", "platform": "douyin", "method": "POST", "path": "/api/v1/douyin/search/fetch_general_search_v2", "json": {"keyword": "扫地机器人", "cursor": 0}},
    {"id": "xiaohongshu.search", "platform": "xiaohongshu", "method": "GET", "path": "/api/v1/xiaohongshu/app_v2/search_notes", "params": {"keyword": "扫地机器人", "page": 1}},
    {"id": "bilibili.search", "platform": "bilibili", "method": "GET", "path": "/api/v1/bilibili/web/fetch_general_search", "params": {"keyword": "扫地机器人", "order": "totalrank", "page": 1, "page_size": 10}},
    {"id": "weibo.search", "platform": "weibo", "method": "GET", "path": "/api/v1/weibo/web/fetch_search", "params": {"keyword": "扫地机器人", "page": 1, "search_type": "1"}},
    {"id": "zhihu.search", "platform": "zhihu", "method": "GET", "path": "/api/v1/zhihu/web/fetch_article_search_v3", "params": {"keyword": "扫地机器人", "offset": "0", "limit": "10"}},
    {"id": "kuaishou.feed", "platform": "kuaishou", "method": "GET", "path": "/api/v1/kuaishou/app/fetch_selection_feed"},
    {"id": "wechat_search.article", "platform": "wechat_search", "method": "POST", "path": "/api/v1/wechat_search/v2/fetch_search", "json": {"keyword": "扫地机器人", "business_type": "article", "raw": False}},
    {"id": "wechat_search.video", "platform": "wechat_search", "method": "POST", "path": "/api/v1/wechat_search/v2/fetch_search_videos", "json": {"keyword": "扫地机器人", "raw": False}},
    {"id": "tiktok.search", "platform": "tiktok", "method": "GET", "path": "/api/v1/tiktok/web/fetch_general_search", "params": {"keyword": "robot vacuum", "offset": 0}},
    {"id": "instagram.search", "platform": "instagram", "method": "GET", "path": "/api/v1/instagram/v1/fetch_search", "params": {"query": "robot vacuum"}},
    {"id": "youtube.search", "platform": "youtube", "method": "GET", "path": "/api/v1/youtube/web_v2/get_general_search_v2", "params": {"keyword": "robot vacuum", "type": "video"}},
    {"id": "reddit.search", "platform": "reddit", "method": "GET", "path": "/api/v1/reddit/app/fetch_dynamic_search", "params": {"query": "robot vacuum", "search_type": "post", "sort": "RELEVANCE", "need_format": True}},
    {"id": "twitter.search", "platform": "twitter", "method": "GET", "path": "/api/v1/twitter/web/fetch_search_timeline", "params": {"keyword": "robot vacuum", "search_type": "Top"}},
    {"id": "threads.search", "platform": "threads", "method": "GET", "path": "/api/v1/threads/web/search_top", "params": {"query": "robot vacuum"}},
    {"id": "linkedin.company", "platform": "linkedin", "method": "GET", "path": "/api/v1/linkedin/web_v2/get_company_profile", "params": {"url": "https://www.linkedin.com/company/openai/"}},
    {"id": "telegram.channel", "platform": "telegram", "method": "GET", "path": "/api/v1/telegram/web/fetch_channel_info", "params": {"channel": "durov"}},
    {"id": "lemon8.search", "platform": "lemon8", "method": "GET", "path": "/api/v1/lemon8/app/fetch_search", "params": {"query": "robot vacuum"}},
    {"id": "xigua.search", "platform": "xigua", "method": "GET", "path": "/api/v1/xigua/app/v2/search_video", "params": {"keyword": "扫地机器人", "offset": 0}},
    {"id": "pipixia.search", "platform": "pipixia", "method": "GET", "path": "/api/v1/pipixia/app/fetch_search", "params": {"keyword": "扫地机器人", "offset": "0"}},
]


def sanitize(value):
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if is_sensitive_key(key):
                _record_redaction(key)
                result[key] = "[REDACTED]"
            else:
                result[key] = sanitize(item)
        return result
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    if isinstance(value, str) and value.startswith(("http://", "https://")):
        parsed = urllib.parse.urlsplit(value)
        if parsed.netloc.lower() == "mp.weixin.qq.com":
            return value
        query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        safe_query = []
        for key, item in query:
            if is_sensitive_key(key):
                _record_redaction(key)
            else:
                safe_query.append((key, item))
        return urllib.parse.urlunsplit(
            (parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(safe_query), "")
        )
    return value


def summarize(payload):
    data = payload.get("data") if isinstance(payload, dict) else None
    result = {
        "top_code": payload.get("code") if isinstance(payload, dict) else None,
        "message": str(payload.get("message", ""))[:240] if isinstance(payload, dict) else "",
        "request_id": payload.get("request_id") if isinstance(payload, dict) else None,
        "data_type": type(data).__name__,
    }
    if isinstance(data, list):
        result["data_count"] = len(data)
        if data and isinstance(data[0], dict):
            result["sample_keys"] = sorted(data[0].keys())[:40]
    elif isinstance(data, dict):
        result["data_keys"] = sorted(data.keys())[:60]
        for key in ("items", "list", "data", "results", "feeds", "aweme_list"):
            child = data.get(key)
            if isinstance(child, list):
                result["nested_list_key"] = key
                result["nested_count"] = len(child)
                if child and isinstance(child[0], dict):
                    result["sample_keys"] = sorted(child[0].keys())[:40]
                break
    return result


SAFE_DATA_STRING_LIMIT = 200


def build_payload_view(payload, include_payload=False):
    """构造落盘用的白名单视图：只保留摘要键与示例数据键，签名/播放地址不落盘。

    默认写入的键：code / message / status / request_id（如果有）与
    data_type / data_count / data_keys / data_sample（示例数据）。完整响应体
    只在显式传 --include-payload 时写入，且仍经过 sanitize()。
    """
    summary = summarize(payload)
    view = {
        "code": summary["top_code"],
        "message": summary["message"],
        "data_type": summary["data_type"],
    }
    if isinstance(payload, dict) and "request_id" in payload:
        view["request_id"] = payload.get("request_id")
    if isinstance(payload, dict) and "status" in payload:
        view["status"] = payload.get("status")
    data = payload.get("data") if isinstance(payload, dict) else None
    if isinstance(data, list):
        view["data_count"] = len(data)
        view["data_sample"] = sanitize(data[:2])
    elif isinstance(data, dict):
        view["data_keys"] = sorted(data.keys())[:60]
        for key in ("items", "list", "data", "results", "feeds", "aweme_list"):
            child = data.get(key)
            if isinstance(child, list):
                view["data_count"] = len(child)
                view["data_sample"] = sanitize(child[:2])
                break
    elif isinstance(data, str):
        view["data_sample"] = sanitize(data[:SAFE_DATA_STRING_LIMIT])
    if include_payload:
        view["_full_payload_redacted"] = sanitize(payload)
    return view


def is_probe_success(status, payload):
    """探针成功的判据：HTTP 2xx 且顶层 code 为 200，且没有被包装的错误码。

    顶层 code=200 也可能是嵌套超时（TikHub 的 request_timeout 包装），
    因此 data 后缀或内层 code/error 出现错误时同样判失败。
    """
    if status is None or not 200 <= status < 300:
        return False
    if not isinstance(payload, dict):
        return False
    code = payload.get("code")
    if code is not None and code != 200:
        return False
    data = payload.get("data")
    if isinstance(data, dict):
        inner = data.get("code")
        if inner is not None and inner != 200:
            return False
        if data.get("error"):
            return False
        if str(data.get("message", "")).startswith("request_timeout"):
            return False
    return True

def run_probe(probe, timeout, include_payload=False):
    started = time.time()
    try:
        payload = proxy_request(
            "tikhub", probe["method"], probe["path"],
            query=probe.get("params", {}), body=probe.get("json"), timeout=timeout,
        )
    except ProxyError as error:
        return {**probe, "http_status": error.status, "ok": False,
                "elapsed_s": round(time.time() - started, 3), "error": str(error)}
    status = 200
    summary = summarize(payload)
    return {
        **probe,
        "http_status": status,
        "ok": is_probe_success(status, payload),
        "elapsed_s": round(time.time() - started, 3),
        "summary": summary,
        "payload": build_payload_view(payload, include_payload=include_payload),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--probes-file", help="Optional JSON array of probe definitions")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--timeout", type=int, default=45)
    parser.add_argument(
        "--include-payload",
        action="store_true",
        help="Write the full (redacted) response body to --output; off by default so media signatures and short-lived play URLs stay out of long-term storage",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit 1 when any single probe fails; default exits 1 only when every probe fails",
    )
    args = parser.parse_args()
    probes = SEED_PROBES
    if args.probes_file:
        probes = json.loads(Path(args.probes_file).read_text(encoding="utf-8"))
        if not isinstance(probes, list):
            raise ValueError("probes file must contain a JSON array")
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [
            pool.submit(run_probe, probe, args.timeout, args.include_payload)
            for probe in probes
        ]
        results = [future.result() for future in futures]
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    document = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "payload_included": args.include_payload,
        "redacted_keys": sorted(REDACTED_KEYS),
        "results": results,
    }
    output.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    for item in results:
        summary = item.get("summary", {})
        print(f"{item['id']} http={item.get('http_status')} ok={item.get('ok')} code={summary.get('top_code')} data={summary.get('data_type')} count={summary.get('data_count', summary.get('nested_count', '-'))} error={item.get('error', '')}")
    print(f"redacted keys: {', '.join(sorted(REDACTED_KEYS)) or '(none in this run)'}")
    failed = [item for item in results if not item.get("ok")]
    if args.strict and failed:
        print(f"strict: {len(failed)}/{len(results)} probe(s) failed", file=sys.stderr)
        return 1
    if results and len(failed) == len(results):
        print(f"all {len(results)} probe(s) failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
