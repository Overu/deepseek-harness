#!/usr/bin/env python3
"""Contract-limited read-only TikHub transport. No credential or output files."""
import argparse
import datetime as dt
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit, parse_qsl

from enterprise_proxy import ProxyError, request as proxy_request

sys.dont_write_bytecode = True
from seeding_math import number, decimal_json, label

CONTRACT = Path(__file__).resolve().parent.parent / 'references/tikhub-endpoints.json'
FORBIDDEN = {'authorization', 'cookie', 'cookies', 'api_key', 'apikey', 'access_token',
             'refresh_token', 'token', 'xsec_token', 'sign', 'signature', 'cache_url',
             'headers', 'request_headers', 'set_cookie', 'set-cookie'}
SIGNED = {'auth_key', 'token', 'signature', 'sign', 'xsec_token', 'wssecret',
          'x-oss-signature', 'x-oss-credential', 'x-amz-signature', 'x-amz-credential'}


def sanitize(value, secret=None):
    if isinstance(value, dict):
        return {str(k): sanitize(v, secret) for k, v in value.items()
                if str(k).lower() not in FORBIDDEN}
    if isinstance(value, list):
        return [sanitize(v, secret) for v in value]
    if isinstance(value, str):
        if secret:
            value = value.replace(secret, '[REDACTED]')
        value = re.sub(r'(?i)bearer\s+\S+', '[REDACTED]', value)
        # Remove signed URLs even when embedded inside a prose field.
        for candidate in re.findall(r'https?://[^\s<>"\)]+', value):
            try:
                keys = {k.lower() for k, _ in parse_qsl(urlsplit(candidate).query)}
            except ValueError:
                keys = SIGNED
            if keys & SIGNED:
                value = value.replace(candidate, '[TRANSIENT_URL_REMOVED]')
        return value
    return value


def prepare(data, registry, probe=False):
    if not isinstance(data, dict):
        raise ValueError('input must be an object')
    allowed = {'endpoint', 'params', 'unit_price_usd', 'remaining_budget_usd',
               'price_source', 'price_checked_at'}
    if set(data)-allowed:
        raise ValueError('unknown top-level input field')
    endpoint = next((e for e in registry['endpoints'] if e['name'] == data.get('endpoint')), None)
    if endpoint is None or endpoint.get('read_only') is not True:
        raise ValueError('endpoint not registered as read-only')
    if endpoint['method'] not in {'GET', 'POST'} or not endpoint['path'].startswith('/api/v1/'):
        raise ValueError('invalid method or path contract')
    # current_status 是最近一次健康检查结论；与历史 status 冲突时以它为准
    effective_status = endpoint.get('current_status') or endpoint['status']
    if effective_status == 'failed':
        raise ValueError('route marked failed by the latest health check; use its replaced_by route')
    if effective_status not in {'historically_verified', 'live'} and not probe:
        raise ValueError('route unavailable; explicit probe needed for registered routes')
    params = data.get('params', {})
    if not isinstance(params, dict) or set(params)-set(endpoint['parameters']):
        raise ValueError('unknown or invalid parameters')
    params = dict(params)
    for key, spec in endpoint['parameters'].items():
        if key not in params and 'default' in spec:
            params[key] = spec['default']
    for key in endpoint.get('required_parameters', []):
        if key not in params or params[key] in (None, '') or (isinstance(params[key], str) and not params[key].strip()):
            raise ValueError('missing required parameter: '+key)
    query, body = {}, {}
    for key, value in params.items():
        spec = endpoint['parameters'][key]
        typ = endpoint.get('parameter_types', {}).get(key, 'string')
        if typ == 'integer':
            if type(value) is not int:
                raise ValueError('integer parameter required: '+key)
            if value < spec.get('minimum', 0) or value > spec.get('maximum', 1000000000):
                raise ValueError('parameter outside range: '+key)
        elif not isinstance(value, str) or len(value) > spec.get('max_length', 2048):
            raise ValueError('string parameter required: '+key)
        if 'allowed' in spec and value not in spec['allowed']:
            raise ValueError('parameter not in allowed values: '+key)
        if spec.get('format') == 'YYYYMMDD':
            if not re.fullmatch(r'\d{8}', value):
                raise ValueError('date parameter must be YYYYMMDD: '+key)
            dt.datetime.strptime(value, '%Y%m%d')
        where = spec.get('location', endpoint.get('parameter_transport', 'query'))
        if where not in {'query', 'body'}:
            raise ValueError('unknown parameter transport')
        (body if where == 'body' else query)[key] = value
    for key, spec in endpoint['parameters'].items():
        cond = spec.get('required_when')
        if cond:
            field, value = cond.split('=', 1)
            if str(params.get(field)) == value and params.get(key) in (None, ''):
                raise ValueError('missing conditional parameter: '+key)
    if endpoint['method'] == 'GET' and body:
        raise ValueError('GET cannot carry body parameters')
    if 'start_date' in params and 'end_date' in params and params['start_date'] > params['end_date']:
        raise ValueError('start_date must not be after end_date')
    return endpoint, query, body


def cost_gate(data, today=None):
    price = number(data.get('unit_price_usd'), 'unit_price_usd', positive=True)
    remaining = number(data.get('remaining_budget_usd'), 'remaining_budget_usd')
    label(data.get('price_source'), 'price_source')
    try:
        checked = dt.date.fromisoformat(data['price_checked_at'])
    except (ValueError, TypeError, KeyError):
        raise ValueError('valid price_checked_at required') from None
    age = ((today or dt.date.today())-checked).days
    if age < 0 or age > 7:
        raise ValueError('price evidence must be from the last 7 days')
    if price > remaining:
        raise ValueError('research budget exceeded')
    return price, remaining-price


def check_envelope(payload):
    if not isinstance(payload, dict) or payload.get('code') not in (200, 0):
        raise ValueError('invalid provider business status')
    current = payload.get('data')
    if current in (None, '', [], {}):
        raise ValueError('empty business data')
    # Inspect wrapper chains, not arbitrary content/product fields named code.
    for _ in range(6):
        if not isinstance(current, dict):
            break
        if current.get('success') is False:
            raise ValueError('upstream reported failure')
        for key in ('status_code', 'StatusCode', 'statusCode', 'code'):
            if key in current and current[key] not in (0, 200, '0', '200'):
                raise ValueError('upstream status needs investigation')
        if 'data' not in current:
            break
        current = current['data']
        if current in (None, '', [], {}):
            raise ValueError('empty nested business data')


def run(data, registry, execute=False, probe=False, today=None):
    endpoint, query, body = prepare(data, registry, probe)
    if not execute:
        return {'status': 'dry_run', 'method': endpoint['method'], 'path': endpoint['path'],
                'query': sanitize(query), 'body': sanitize(body),
                'historical_status': endpoint['status'],
                'current_status': endpoint.get('current_status'), 'network_called': False}, 0
    price, remaining = cost_gate(data, today)
    accounting = {'reserved_cost_usd': price, 'remaining_budget_usd': remaining,
                  'accounting': 'Conservative reservation; actual billing may differ.'}
    try:
        payload = proxy_request('tikhub', endpoint['method'], endpoint['path'],
                                query=query, body=body if endpoint['method'] == 'POST' else None,
                                timeout=30)
        raw = json.dumps(payload, allow_nan=False).encode()
        if len(raw) > 8*1024*1024:
            raise ValueError('response exceeds size limit')
        check_envelope(payload)
    except (ProxyError, TimeoutError, OSError, ValueError) as exc:
        # Never echo URLs, request parameters, credentials or raw error bodies.
        return {'status': 'request_failed', 'error_type': type(exc).__name__, **accounting}, 1
    return {'status': 'needs_semantic_validation', 'endpoint': endpoint['name'],
            'retrieved_at': dt.datetime.now(dt.timezone.utc).isoformat(),
            'payload': sanitize(payload), **accounting}, 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--probe', action='store_true')
    args = parser.parse_args()
    try:
        registry = json.loads(CONTRACT.read_text())
        result, code = run(json.load(sys.stdin), registry, args.execute, args.probe)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, default=decimal_json))
        return code
    except (ValueError, TypeError, KeyError, OSError) as exc:
        print(json.dumps({'status': 'rejected_before_request', 'error_type': type(exc).__name__}))
        return 2


if __name__ == '__main__':
    sys.exit(main())
