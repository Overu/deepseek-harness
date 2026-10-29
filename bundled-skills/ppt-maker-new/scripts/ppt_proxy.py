"""Enterprise-only PPT egress; no vendor keys or user tokens are read here."""
from contextlib import contextmanager
import base64
import io
import hashlib
import json
import os
from pathlib import Path
import time

from enterprise_proxy import request as proxy_request, ProxyError

MAX_REQUEST = 2 * 1024 * 1024
MAX_CONCURRENT_REQUESTS = 10


def proxy_environment_ready():
    home, node = os.environ.get('DSH_HOME'), os.environ.get('DSH_SKILL_PROXY_NODE')
    return bool(home and node and Path(node).is_absolute() and Path(node).is_file()
                and (Path(home) / 'skill-proxy/connection.json').is_file())


@contextmanager
def request_slot(wait_seconds=1250):
    # flock coordinates threads AND the independent image/render worker processes.
    # Ten slots shared by all PPT projects under this DSH home, released on crash.
    from platform_runtime import acquire_lock
    if not proxy_environment_ready():
        raise ProxyError('PPT_PROXY_NOT_READY', 503)
    root = Path(os.environ['DSH_HOME']) / 'skill-proxy/ppt-slots'
    root.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + wait_seconds
    handle = None
    while handle is None:
        for slot in range(MAX_CONCURRENT_REQUESTS):
            try:
                candidate = acquire_lock(root / str(slot))
            except RuntimeError as exc:
                if 'project already has an active build' not in str(exc):
                    raise
            else:
                handle = candidate
                break
        if handle is None:
            if time.monotonic() >= deadline:
                raise ProxyError('PPT_QUEUE_TIMEOUT_NOT_SUBMITTED', 429)
            time.sleep(0.1)
    try:
        yield
    finally:
        handle.close()


def request(connection, path, body, *, timeout=1200, before_send=None):
    if connection not in {'ppt-text', 'media-generator'}:
        raise ValueError('unsupported PPT connection')
    envelope = {'method': 'POST', 'path': path, 'query': {}, 'body': body}
    if len(json.dumps(envelope, ensure_ascii=False).encode('utf-8')) > MAX_REQUEST - 1024:
        raise ProxyError('PPT_REQUEST_TOO_LARGE_NOT_SUBMITTED', 413)
    with request_slot():
        run_id = os.environ.get('PPT_BUILD_RUN_ID')
        stopped = (Path(os.environ['DSH_HOME']) / 'skill-proxy/ppt-slots' /
                   ('stopped-' + hashlib.sha256(run_id.encode()).hexdigest())) if run_id else None
        if stopped and stopped.exists():
            raise ProxyError('PPT_RUN_STOPPED_AFTER_PROXY_ERROR', 409)
        if before_send:
            before_send()
        # Never retry a transport error; the paid request might have completed.
        try:
            return proxy_request(connection, 'POST', path, body=body, timeout=min(timeout + 30, 1250))
        except ProxyError:
            if stopped:
                stopped.touch()
            raise


def image_data_url(path):
    """Bounded in-memory image encoding; never changes source evidence files."""
    from PIL import Image, ImageOps
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert('RGB')
        image.thumbnail((1920, 1920))
        for quality in (90, 80, 70):
            buffer = io.BytesIO()
            image.save(buffer, format='JPEG', quality=quality)
            if buffer.tell() <= 400 * 1024:
                return 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')
    raise ProxyError('PPT_SCREENSHOT_TOO_LARGE_NOT_SUBMITTED', 413)
