"""Compatibility import for existing Python business scripts; networking is JavaScript.

Distributed as skills/scripts/enterprise_proxy.py. No HTTP client or credential access.
"""
import json
import os
from pathlib import Path
import subprocess


class ProxyError(RuntimeError):
    def __init__(self, code, status=502, body=None):
        self.code, self.status, self.body = code, status, body
        super().__init__(f'{code} (HTTP {status}); 不要自动重试付费请求，超时不代表上游未执行')


def request(connection, method, path, *, query=None, body=None, timeout=1250):
    if not os.environ.get('DSH_HOME'):
        raise ProxyError('DSH_HOME_MISSING', 503)
    node = os.environ.get('DSH_SKILL_PROXY_NODE', '')
    if not node or not Path(node).is_absolute() or not Path(node).is_file():
        raise ProxyError('DSH_SKILL_PROXY_NODE_MISSING: 请更新并启动企业插件', 503)
    script = Path(__file__).with_name('enterprise_proxy.mjs')
    if not script.is_file():
        script = Path(__file__).with_name('skill-proxy-client.mjs')
    try:
        result = subprocess.run([node, str(script), '--stdin'], input=json.dumps({
            'connection': connection, 'method': method, 'path': path,
            'query': query or {}, 'body': body, 'timeout': timeout,
        }, ensure_ascii=False), encoding='utf-8', capture_output=True, timeout=timeout + 10,
            check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise ProxyError('PROXY_UNAVAILABLE_OUTCOME_UNKNOWN') from None
    try:
        if result.returncode:
            error = json.loads(result.stderr)['error']
            raise ProxyError(error['code'], error['status'], error.get('body'))
        return json.loads(result.stdout)
    except (ValueError, KeyError, TypeError):
        raise ProxyError('INVALID_PROXY_RESPONSE') from None
