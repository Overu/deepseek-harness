#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Standalone gpt-image-2 text-to-image generator for ppt-maker-new (with fallback).

通过企业插件代理发送 text_to_image 请求；签名和真实用户身份由后台注入。
技能不读取厂商密钥，也不直接请求厂商生成接口。

健壮性：主模型默认 **gpt-image-2**（quality 默认 medium）；当主模型**连续失败 3 次**
（可用 `--max-retries` 调整）后，自动切换备选模型（默认 **即梦 5 Pro**
`doubao-seedream-5-0-pro-260628`）重试，避免生图环节单点失败。

运行时依赖已登录的企业插件及内置 Node；MG_IMAGE_MODEL 可选择图片模型。
代理错误或执行结果未知时立即停止，不自动重试或切换模型。

用法：
  python3 gen_gpt_image2.py "prompt" [--model gpt-image-2] [--fallback-model doubao-seedream-5-0-pro-260628]
      [--resolution 2K] [--aspect-ratio 16:9] [--mime-type JPEG] [--quality medium]
      [--gen-count 1] [--out assets/page-01.jpg] [--timeout 300]

成功时打印 {"code":0,"status":"success","model":...,"url":...}；带 --out 时下载到本地并剥 AIGC EXIF。
"""
import argparse
import json
import os
from pathlib import Path
import sys
import time
import urllib.request
import urllib.error
from ppt_proxy import request
DEFAULT_MODEL = os.environ.get("MG_IMAGE_MODEL", "gpt-image-2")
DEFAULT_QUALITY = "medium"
DEFAULT_FALLBACK = "doubao-seedream-5-0-pro-260628"  # 即梦 5 Pro
DEFAULT_RETRIES = 3  # 主模型连续失败达到此次数后，切换备选模型


def generate(prompt, model_id, resolution="2K", aspect_ratio="16:9", mime_type="JPEG",
             quality=DEFAULT_QUALITY, gen_count=1, timeout=300):
    params = {
        "resolution": resolution,
        "aspect_ratio": aspect_ratio,
        "mime_type": mime_type,
        "quality": quality,
    }
    if gen_count and gen_count != 1:
        params["gen_count"] = gen_count
    data = {
        "prompt": prompt,
        "image_url_list": [],
        "video_url_list": [],
        "audio_url_list": [],
        "image_params": params,
    }
    payload = {
        "model_id": model_id,
        "task_type": "text_to_image",
        "data": data,
    }
    return request('media-generator', '/v1/proxy', payload, timeout=timeout)


def _first_url(res):
    imgs = (res or {}).get("data", {}).get("image_list") or []
    if not imgs:
        return None
    u = imgs[0]
    return u.get("url") if isinstance(u, dict) else u


def _ok(res):
    return bool(_first_url(res)) and (res or {}).get("status") == "success"


def _get(url, out, timeout=180):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r, open(out, "wb") as f:
        f.write(r.read())
    try:
        from PIL import Image
        Image.open(out).convert("RGB").save(out, "JPEG", quality=92)
    except Exception:
        pass


def _build_model_chain(primary, fallback, retries):
    # 主模型先试 retries 次；连续失败达到 retries 次后，再切备选模型
    return [primary] * retries + [fallback]


def _is_retryable_failure(res):
    """Return True only for transient failures worth another paid/waiting call."""
    if res.get('no_retry'):
        return False
    value = (res or {}).get("code", -1)
    try:
        code = int(value)
    except (TypeError, ValueError):
        code = -1
    message = str((res or {}).get("message", "")).lower()
    permanent_terms = (
        "unauthorized", "forbidden", "invalid api", "invalid credential", "api key",
        "must be configured", "bad request", "invalid aspect", "unsupported",
        "content policy", "moderation", "safety policy",
    )
    if code in {400, 401, 403, 404, 405, 413, 415, 422} or any(term in message for term in permanent_terms):
        return False
    if code in {408, 504} or any(term in message for term in ('timeout', 'timed out', 'connection', 'network', 'reset by peer')):
        return False
    if code in {409, 425, 429} or 500 <= code <= 599:
        return True
    transient_terms = (
        "timeout", "timed out", "temporar", "rate limit", "throttl", "connection",
        "network", "reset by peer", "try again", "unavailable",
    )
    return any(term in message for term in transient_terms)


def _failure_from_exception(exc):
    code = getattr(exc, "code", -1)
    return {"code": code, "status": "failed", "message": str(exc), "no_retry": True}


def _generate_with_fallback(
    prompt, primary, fallback, retries, *, generate_fn=generate, attempt_records=None, **generation_options,
):
    chain = _build_model_chain(primary, fallback, retries)
    last_res = None
    for attempt, mid in enumerate(chain, 1):
        cancel_file=os.environ.get('PPT_IMAGE_CANCEL_FILE')
        if cancel_file and Path(cancel_file).exists():
            return None, None, {'code':-1,'status':'cancelled','message':'cancel_requested'}, attempt-1
        started = time.monotonic()
        try:
            res = generate_fn(prompt, mid, **generation_options)
        except Exception as exc:  # noqa: BLE001
            res = _failure_from_exception(exc)
        last_res = res
        if attempt_records is not None:
            attempt_records.append({'attempt': attempt, 'model': mid,
                'status': 'success' if _ok(res) else 'failed',
                'latency_s': round(time.monotonic() - started, 3),
                'provider_usage': res.get('usage') if isinstance(res.get('usage'), dict) else None})
        if _ok(res):
            print("[INFO] model=%s attempt=%d ok" % (mid, attempt), file=sys.stderr)
            return mid, _first_url(res), res, attempt
        print("[WARN] model=%s attempt=%d failed: code=%s status=%s msg=%s" % (
            mid, attempt, res.get("code"), res.get("status"),
            str(res.get("message", ""))[:140]), file=sys.stderr)
        if not _is_retryable_failure(res):
            print("[INFO] permanent image error; retries and fallback skipped", file=sys.stderr)
            return None, None, res, attempt
    return None, None, last_res, len(chain)


def main():
    ap = argparse.ArgumentParser(description="generate image (gpt-image-2 with 即梦5Pro fallback)")
    ap.add_argument("prompt")
    ap.add_argument("--model", default=DEFAULT_MODEL, help="primary model (default gpt-image-2)")
    ap.add_argument("--fallback-model", default=DEFAULT_FALLBACK, help="fallback model when primary fails (default 即梦5 Pro)")
    ap.add_argument("--resolution", default="2K")
    ap.add_argument("--aspect-ratio", default="16:9")
    ap.add_argument("--mime-type", default="JPEG")
    ap.add_argument("--quality", default=DEFAULT_QUALITY, help="image quality (default medium)")
    ap.add_argument("--gen-count", type=int, default=1)
    ap.add_argument("--max-retries", type=int, default=DEFAULT_RETRIES,
                    help="primary 连续失败达到此次数后切换备选（默认 3）")
    ap.add_argument("--out", default=None, help="download as this local jpg path")
    ap.add_argument("--timeout", type=int, default=300)
    a = ap.parse_args()

    attempt_records = []
    chosen, used_url, last_res, _ = _generate_with_fallback(
        a.prompt, a.model, a.fallback_model, a.max_retries,
        attempt_records=attempt_records,
        resolution=a.resolution, aspect_ratio=a.aspect_ratio,
        mime_type=a.mime_type, quality=a.quality,
        gen_count=a.gen_count, timeout=a.timeout,
    )

    if not chosen:
        print(json.dumps(
            {"code": -1, "status": "cancelled" if (last_res or {}).get('status')=='cancelled' else "failed",
             "message": "cancel_requested" if (last_res or {}).get('status')=='cancelled' else "all models failed",
             "provider_attempts": attempt_records,
             "last": str(last_res)[:400]}, ensure_ascii=False))
        sys.exit(1)

    result = {"code": 0, "status": "success", "model": chosen, "url": used_url,
              "provider_attempts": attempt_records}
    if a.out and used_url:
        try:
            _get(used_url, a.out)
            result["out"] = a.out
        except Exception as e:  # noqa: BLE001
            result["download_error"] = str(e)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
