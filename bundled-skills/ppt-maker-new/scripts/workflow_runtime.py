"""Project-wide immutable model attempts and restart-resistant stage budgets."""
import hashlib
import json
import math
from pathlib import Path
import sqlite3
import time
import uuid
from stage_runtime import atomic_write_json, atomic_write_text


def model_request(project, stage, prompt, model_fn, *, scope='', limit=None, budget=None, token=None, **kwargs):
    if budget is not None:
        from request_journal import invoke
        return invoke(budget, token, prompt, model_fn, context={'kind':'workflow','phase':stage},
                      preserve_result=True, **kwargs)
    reports = Path(project) / 'reports'
    reports.mkdir(parents=True, exist_ok=True)
    request_id = uuid.uuid4().hex
    record = {'id': request_id, 'stage': stage, 'scope': scope, 'status': 'in_flight',
              'started': time.time(), 'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest()}
    with sqlite3.connect(reports / 'workflow_calls.sqlite', timeout=30) as db:
        db.execute('CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, stage TEXT, scope TEXT, started REAL)')
        db.execute('BEGIN IMMEDIATE')
        used = db.execute('SELECT count(*) FROM requests WHERE stage=? AND scope=?', (stage, scope)).fetchone()[0]
        if limit is not None and used >= limit:
            raise RuntimeError(f'{stage}_budget_exhausted: {used}/{limit}; inspect saved responses, not --force')
        db.execute('INSERT INTO requests VALUES (?,?,?,?)', (request_id, stage, scope, record['started']))
    directory = reports / 'requests'
    atomic_write_json(directory / (request_id + '.json'), record)
    try:
        result = model_fn(prompt, **kwargs)
        raw = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
        atomic_write_text(directory / (request_id + '.txt'), raw)
        record.update(status='completed', output_sha256=hashlib.sha256(raw.encode()).hexdigest())
        from sol_common import response_metadata
        record.update(response_metadata(result))
        return result
    except Exception as exc:
        record.update(status='failed', error_type=type(exc).__name__)
        raise
    finally:
        record['finished'] = time.time()
        record['latency_s'] = round(record['finished']-record['started'], 3)
        atomic_write_json(directory / (request_id + '.json'), record)


def planning_scope(root, topic, pages, brief):
    # Prompt wording, worker count and --force never reset the input budget.
    value = {'topic': topic, 'pages': pages, 'brief': brief}
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def _nonnegative_number(value):
    try:
        return type(value) in {int, float} and math.isfinite(value) and value >= 0
    except OverflowError:
        return False


def _reported_usage(value):
    """Keep supported finite counters only; absence is unknown, never zero."""
    if value is None:
        return {}, False
    if not isinstance(value, dict):
        return {}, True
    result, invalid = {}, False
    for key in ('prompt_tokens', 'completion_tokens', 'total_tokens', 'input_tokens', 'output_tokens'):
        if value.get(key) is None:
            continue
        if _nonnegative_number(value[key]):
            result[key] = value[key]
        else:
            invalid = True
    details = value.get('prompt_tokens_details')
    if details is not None:
        if not isinstance(details, dict):
            invalid = True
        elif details.get('cached_tokens') is not None:
            if _nonnegative_number(details['cached_tokens']):
                result['prompt_tokens_details'] = {'cached_tokens':details['cached_tokens']}
            else:
                invalid = True
    return result, invalid


def _text_metric_receipts(reports, directory, *, journal=False):
    """Read-only fault isolation for metrics, never authorizes render recovery."""
    rows, invalid = [], []
    for path in sorted((reports/directory).glob('*.json')):
        if journal and not path.stem.isdigit():
            continue
        try:
            row = json.loads(path.read_text(encoding='utf8'))
            if not isinstance(row, dict):
                raise ValueError('receipt must be an object')
            if any(not isinstance(row.get(k), str) or not row[k] for k in ('stage', 'status')):
                raise ValueError('invalid stage/status')
            token = row.get('attempt_id')
            if token is not None and (type(token) is not int or token < 1):
                raise ValueError('invalid attempt identity')
            if journal:
                if token != int(path.stem):
                    raise ValueError('journal identity mismatch')
                row['id'] = 'attempt:' + path.stem
            elif not isinstance(row.get('id'), str) or not row['id']:
                raise ValueError('invalid request identity')
            usage, bad_usage = _reported_usage(row.get('provider_usage'))
            row['provider_usage'] = usage
            bad_time = any(row.get(k) is not None and not _nonnegative_number(row[k])
                           for k in ('started','finished','latency_s'))
            if bad_time:
                for key in ('started','finished','latency_s'):
                    row.pop(key, None)
            if bad_usage or bad_time:
                invalid.append({'path':str(path.relative_to(reports)), 'reason':'invalid usage/timing fields'})
            rows.append(row)
        except (OSError, ValueError) as exc:
            invalid.append({'path':str(path.relative_to(reports)), 'reason':type(exc).__name__})
    return rows, invalid


def image_usage_summary(reports):
    """Separate image requests/attempts from text tokens; legacy gaps stay unknown."""
    requests = {}
    invalid, history_gaps = [], []
    # The current transaction supersedes the same request's history if interrupted
    # between their writes; different request IDs for a src must never coalesce.
    for directory in ('image_requests', 'image_transactions'):
        for path in sorted((reports / directory).glob('*.json')):
            try:
                row = json.loads(path.read_text(encoding='utf8'))
                if not isinstance(row, dict):
                    raise ValueError('not an object')
                key = row.get('request_id')
                if key is not None and (not isinstance(key,str) or not key):
                    raise ValueError('invalid request identity')
                key = key or 'legacy:' + path.name
                if not isinstance(row.get('status','unknown'),str):
                    raise ValueError('invalid request status')
                requests[key] = row
            except (OSError, ValueError) as exc:
                invalid.append({'path':str(path.relative_to(reports)), 'reason':type(exc).__name__})
    unreadable = len(invalid)
    attempts, missing, states = [], 0, {}
    for key, row in requests.items():
        status = str(row.get('status', 'unknown'))
        states[status] = states.get(status, 0) + 1
        if row.get('history_write_errors'):
            history_gaps.append(key)
        details = row.get('provider_attempts')
        if not isinstance(details, list) or not details:
            missing += 1
            continue
        bad_details = False
        for item in details:
            if not isinstance(item, dict):
                bad_details = True
                continue
            if (type(item.get('attempt')) is not int or item['attempt'] < 1
                    or not isinstance(item.get('model'),str) or not isinstance(item.get('status'),str)
                    or (item.get('latency_s') is not None and not _nonnegative_number(item['latency_s']))):
                bad_details = True
                continue
            # Expose only numeric token counters, not arbitrary provider payloads.
            usage, bad_usage = _reported_usage(item.get('provider_usage'))
            if bad_usage:
                invalid.append({'request_id':key, 'reason':'invalid provider usage'})
            attempts.append({'request_id':key, 'attempt':item.get('attempt'),
                             'model':item.get('model'), 'status':item.get('status'),
                             'latency_s':item.get('latency_s'), 'reported_usage':usage or None})
        if bad_details:
            missing += 1
            invalid.append({'request_id':key, 'reason':'invalid provider attempt details'})
    known = [a for a in attempts if a['reported_usage']]
    return {'generation_requests':len(requests), 'request_statuses':states,
            'reported_provider_attempts':len(attempts) if attempts else None,
            'requests_without_attempt_details':missing, 'unreadable_receipts':unreadable,
            'invalid_receipts':invalid, 'history_write_gaps':history_gaps,
            'records_with_usage':len(known), 'records_without_usage':len(attempts)-len(known),
            'complete':bool(attempts) and not missing and not invalid and not history_gaps and len(known)==len(attempts)
                       and all(a['reported_usage'].get('total_tokens') is not None for a in known),
            'attempts':attempts,
            'meaning':'reported image usage only; missing attempts/usage are unknown, not zero; not a billing estimate'}


def project_summary(project):
    reports = Path(project) / 'reports'
    attempts, invalid = _text_metric_receipts(reports, 'requests')
    render_attempts, invalid_journals = _text_metric_receipts(reports, 'request_journal', journal=True)
    invalid += invalid_journals
    # Canonical attempt identities deduplicate phase-specific companion receipts.
    by_attempt = {r['attempt_id']:r for r in render_attempts}
    all_receipts = [r for r in attempts if r.get('attempt_id') not in by_attempt] + render_attempts
    not_submitted=sum(r.get('status')=='not_submitted' for r in all_receipts)
    usage_receipts=[r for r in all_receipts if r.get('status')!='not_submitted']
    missing_receipts = []
    ledger = reports/'execution_budget.sqlite'
    if ledger.exists():
        with sqlite3.connect(ledger.resolve().as_uri()+'?mode=ro',uri=True) as db:
            for token,stage,status in db.execute('SELECT id,stage,status FROM attempts'):
                # Imported legacy rows cannot be joined exactly to old UUID receipts;
                # leave coverage explicitly unknown instead of guessing correspondence.
                if token not in by_attempt and not any(r.get('attempt_id')==token for r in attempts):
                    missing_receipts.append({'attempt_id':token,'stage':stage,'status':status})
    usage_records = [{'id': r['id'], 'stage': r['stage'], 'usage': r['provider_usage'],
                      'model': r.get('model'), 'finish_reason': r.get('finish_reason')}
                     for r in usage_receipts if r.get('provider_usage')]
    totals = {}
    for key in ('prompt_tokens', 'completion_tokens', 'total_tokens'):
        values = [r['usage'][key] for r in usage_records
                  if _nonnegative_number(r['usage'].get(key))]
        totals[key] = sum(values) if values else None
    cache_values = [r['usage']['prompt_tokens_details'].get('cached_tokens') for r in usage_records
                    if isinstance(r['usage'].get('prompt_tokens_details'), dict)]
    cache_values = [v for v in cache_values if _nonnegative_number(v)]
    totals['cached_input_tokens'] = sum(cache_values) if cache_values else None
    coverage = {'records_with_usage': len(usage_records),
                'records_without_usage': len(usage_receipts) - len(usage_records) + len(missing_receipts),
                'not_submitted':not_submitted,
                'missing_receipts': missing_receipts,
                'invalid_receipts': invalid,
                'complete': bool(usage_receipts) and not missing_receipts and not invalid and len(usage_records) == len(usage_receipts)
                            and all(isinstance(r['usage'].get('total_tokens'), (int, float))
                                    and not isinstance(r['usage']['total_tokens'], bool)
                                    for r in usage_records),
                'reported_totals': totals,
                'meaning': 'reported subtotal only; unavailable fields are not zero; not a billing estimate'}
    stages = {}
    for a in all_receipts:
        counts = stages.setdefault(a['stage'], {})
        counts[a['status']] = counts.get(a['status'], 0) + 1
    build_reservations = 0
    build_budget = {}
    build_runs = {}
    path = reports / 'call_budget.sqlite'
    if path.exists():
        with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True) as db:
            tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if 'calls' in tables:
                build_reservations = db.execute('SELECT count(*) FROM calls').fetchone()[0]
                build_runs = dict(db.execute('SELECT run_id,count(*) FROM calls GROUP BY run_id'))
            if 'policy' in tables:
                row = db.execute('SELECT soft,hard FROM policy WHERE id=1').fetchone()
                if row:
                    build_budget = {'soft_limit': row[0], 'hard_limit': row[1]}
            if 'budget_events' in tables:
                build_budget['events'] = [dict(started=r[0], old_limit=r[1], new_limit=r[2], reason=r[3])
                    for r in db.execute('SELECT started,old_limit,new_limit,reason FROM budget_events ORDER BY started')]
    from work_budget import summary as execution_summary
    durations = {}
    for row in all_receipts:
        if _nonnegative_number(row.get('finished')) and _nonnegative_number(row.get('started')):
            durations.setdefault(row['stage'], []).append(max(0, row['finished']-row['started']))
    return {'execution_budget': execution_summary(project), 'stages': stages, 'build_request_reservations': build_reservations,
            'observed_request_latency_s':durations,
            'provider_usage_records': usage_records, 'provider_usage_summary': coverage,
            'image_usage_summary':image_usage_summary(reports),
            'billing_status':'not_computed; missing provider usage is unknown, not zero',
            'build_budget': build_budget, 'build_reservations_by_run': build_runs,
            'note': 'in_flight after interruption means outcome unknown; reservations are not provider billing'}
