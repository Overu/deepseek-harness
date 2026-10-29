"""Persist the best exact model-authored draft per semantic page identity."""
import json
from pathlib import Path
from xml.etree import ElementTree as ET
from stage_runtime import atomic_write_json, sha256_text


LOCAL_FAILURE_CODES = {'asset_consumer_error', 'validator_internal_error', 'asset_dependency_failed', 'model_transport_error'}


def save_draft(state: dict, xml: str, errors: list[dict]):
    try:
        ET.fromstring(xml)
    except ET.ParseError:
        return
    path = state['project'] / 'reports/render_checkpoints' / (state['prompt_hash'] + '.json')
    payload = {'page_no':state['page_no'],'prompt_hash':state['prompt_hash'],
               'xml':xml,'sml_sha256':sha256_text(xml),'error_count':len(errors),'errors':errors,
               'status':'candidate' if errors else 'validated',
               'legacy_style_text':state.get('legacy_style_text','')}
    # Error count alone cannot rank usability. Retain exact candidates so a
    # two-cosmetic-error page is not lost behind a one-fatal-error page.
    atomic_write_json(path.parent/'candidates'/state['prompt_hash']/(payload['sml_sha256']+'.json'),payload)
    old = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    from recovery_feedback import recovery_rank
    if (old and isinstance(old.get('errors'), list)
            and recovery_rank(old['errors']) <= recovery_rank(errors)):
        return
    atomic_write_json(path,payload)


def load_draft(state: dict) -> str | None:
    path = state['project'] / 'reports/render_checkpoints' / (state['prompt_hash'] + '.json')
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        if data.get('prompt_hash') == state['prompt_hash'] and data.get('page_no') == state['page_no']:
            if data.get('sml_sha256') and data['sml_sha256'] != sha256_text(data['xml']):
                return None
            return data['xml']
    except (OSError, ValueError, KeyError):
        pass
    return None


def load_candidates(state: dict) -> list[str]:
    values = []
    legacy = load_draft(state)
    if legacy: values.append(legacy)
    root = state['project']/'reports/render_checkpoints/candidates'/state['prompt_hash']
    for path in sorted(root.glob('*.json')):
        try:
            row=json.loads(path.read_text(encoding='utf-8'))
            if (row.get('page_no')==state['page_no'] and row.get('prompt_hash')==state['prompt_hash']
                    and row.get('sml_sha256')==sha256_text(row['xml']) and row['xml'] not in values):
                values.append(row['xml'])
        except (OSError,ValueError,KeyError,TypeError):
            continue
    return values


def distribute_grant(extra_calls: int, pages: set[int]) -> dict[int, int]:
    if extra_calls == 0:
        return {}
    if extra_calls < len(pages):
        raise ValueError('extra-calls is a TOTAL; provide at least one per selected unresolved page')
    ordered = sorted(pages)
    return {n: extra_calls // len(ordered) + int(i < extra_calls % len(ordered)) for i, n in enumerate(ordered)}
