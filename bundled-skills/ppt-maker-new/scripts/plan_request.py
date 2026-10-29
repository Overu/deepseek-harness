"""Lossless managed planning requirements, separate from accepted artifact evidence."""
import json
from pathlib import Path
from stage_runtime import atomic_write_json, sha256_file, sha256_text


def read(path):
    if not path.exists(): return {}
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict): raise ValueError('invalid planning request record')
    return value


def read_extra(extra=None, extra_file=None):
    if extra is not None and extra_file is not None:
        raise ValueError('use only one of --extra and --extra-file')
    return Path(extra_file).read_text(encoding='utf-8') if extra_file is not None else extra


def resolve_request(project, topic=None, pages=None, extra=None, *, replace=False):
    path = project/'reports/plan_request.json'
    old = read(path)
    request = {'topic': old.get('topic', '') if topic is None else topic,
               'pages': old.get('pages') if pages is None else pages,
               'extra': old.get('extra', '') if extra is None else extra}
    if type(request['pages']) is not int or request['pages'] < 1:
        raise ValueError('first plan requires positive --pages; resume inherits saved pages')
    request['sha256'] = sha256_text(json.dumps(request, ensure_ascii=False, sort_keys=True))
    if old and old != request and not replace:
        raise ValueError('planning requirements changed; use --replace-plan for an intentional plan change')
    if old != request: atomic_write_json(path, request)
    return request


def accept_request(project, request, *, origin='managed'):
    prior=read(project/'reports/plan_acceptance.json')
    atomic_write_json(project/'reports/plan_acceptance.json', {
        'request_sha256': request['sha256'], 'blueprint_sha256': sha256_file(project/'reports/blueprint.json'),
        'brief_sha256': sha256_file(project/'reports/brief.json') if (project/'reports/brief.json').exists() else None,
        'origin': origin, 'original_request_verified': prior.get('original_request_verified',False)
            if origin=='user_revision' else origin != 'legacy_adoption'})


def verify_plan_request(project):
    request = read(project/'reports/plan_request.json')
    receipt = read(project/'reports/plan_acceptance.json')
    if not request and not receipt: return  # Legacy artifacts still undergo normal preflight.
    if not request or receipt.get('request_sha256') != request.get('sha256'):
        raise ValueError('planning requirements pending: finish plan before build')
    if receipt.get('blueprint_sha256') != sha256_file(project/'reports/blueprint.json'):
        raise ValueError('accepted blueprint changed; use managed revision or explicit adopt-plan')
    if 'brief_sha256' in receipt and receipt['brief_sha256'] != (sha256_file(project/'reports/brief.json') if (project/'reports/brief.json').exists() else None):
        raise ValueError('accepted planning brief changed; plan the updated inputs first')


def accepted_override(project, request):
    receipt=read(project/'reports/plan_acceptance.json')
    if (receipt.get('origin') not in {'user_revision','adopted_verified','legacy_adoption'} or
            receipt.get('request_sha256')!=request['sha256']): return None
    try: verify_plan_request(project)
    except ValueError: return None
    return read(project/'reports/blueprint.json')


def adopt_plan(project, topic=None, pages=None, extra=None):
    from blueprint_validation import static_findings
    from quality_policy import blocking
    from import_handoff import verify_receipt
    if (project/'reports/handoff_receipt.json').exists(): verify_receipt(project)
    bp = read(project/'reports/blueprint.json')
    findings = blocking(static_findings(bp, read(project/'reports/brief.json')))
    if findings: raise ValueError('cannot adopt invalid blueprint: '+json.dumps(findings, ensure_ascii=False))
    prior = read(project/'reports/plan_acceptance.json')
    request = resolve_request(project, topic, pages or len(bp.get('pages', [])), extra)
    if request['pages'] != len(bp.get('pages', [])):
        raise ValueError('adoption page count mismatch')
    matched = prior.get('blueprint_sha256') == sha256_file(project/'reports/blueprint.json') and prior.get('request_sha256') == request['sha256']
    accept_request(project, request, origin='adopted_verified' if matched and prior.get('original_request_verified') else 'legacy_adoption')
    return read(project/'reports/plan_acceptance.json')
