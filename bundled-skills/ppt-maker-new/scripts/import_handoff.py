#!/usr/bin/env python3
"""Validate and import a lossless client extraction package; never summarize."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path
from stage_runtime import atomic_write_json, atomic_write_text
from ingest_materials import _image_size, IMAGE_EXTENSIONS


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot_asset(project, source, expected):
    """Byte-preserving source isolation; never overwrite an existing snapshot."""
    source = Path(source)
    if digest(source) != expected:
        raise ValueError('asset source hash mismatch before isolation')
    target = Path(project) / 'inputs/assets' / (expected + source.suffix.lower())
    if not target.resolve().is_relative_to(Path(project).resolve() / 'inputs/assets'):
        raise ValueError('asset snapshot path escapes input directory')
    if target.exists():
        if target.is_symlink() or digest(target) != expected:
            raise ValueError('asset snapshot conflict; preserve existing file')
        return target.resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.source-', dir=target.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        shutil.copyfile(source, temporary)
        if digest(temporary) != expected or digest(source) != expected:
            raise ValueError('asset source changed while isolating')
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return target.resolve()


def verified_asset_sources(project):
    """Resolve only receipt-bound, exact-byte source relocations."""
    project = Path(project)
    manifest = project / 'reports/assets_manifest.json'
    rows = json.loads(manifest.read_text(encoding='utf-8')).get('assets', []) if manifest.exists() else []
    sources = {a['asset_id']: Path(a['staged_path']) for a in rows}
    for row in rows:
        if row.get('sha256') and digest(sources[row['asset_id']]) != row['sha256']:
            raise ValueError('staged asset source hash mismatch')
    path = project / 'reports/asset_source_bindings.json'
    if not path.exists():
        return sources
    receipt = verify_receipt(project)
    bindings = json.loads(path.read_text(encoding='utf-8'))
    if (bindings.get('handoff_sha256') != receipt['sha256'] or
            bindings.get('assets_manifest_sha256') != digest(manifest)):
        raise ValueError('asset source bindings do not match the handoff')
    originals = {a['asset_id']: a for a in rows}
    seen = set()
    for binding in bindings.get('assets', []):
        aid = binding['asset_id']
        if aid in seen or aid not in originals:
            raise ValueError('unknown/duplicate source binding')
        seen.add(aid)
        original = originals[aid]
        expected = original['sha256']
        target = Path(binding['path'])
        canonical = project / 'inputs/assets' / (expected + Path(original['staged_path']).suffix.lower())
        if (binding.get('sha256') != expected or target != canonical.resolve() or
                not target.resolve().is_relative_to(project.resolve() / 'inputs/assets') or
                target.is_symlink() or digest(target) != expected):
            raise ValueError('asset source binding hash/path mismatch')
        sources[aid] = target
    return sources


def recover_asset_sources(project):
    """Offline, locked relocation. Leaves manifests, blueprint and budgets untouched."""
    from ppt import lock_project, ensure_reconciliation_idle
    project = Path(project).resolve()
    handle = lock_project(project)
    try:
        ensure_reconciliation_idle(project)
        receipt = verify_receipt(project)
        manifest = project / 'reports/assets_manifest.json'
        # A bad prior binding is evidence to inspect, not silently replace.
        verified_asset_sources(project)
        rows = json.loads(manifest.read_text(encoding='utf-8')).get('assets', [])
        bindings = [{'asset_id': a['asset_id'], 'sha256': a['sha256'],
                     'path': str(snapshot_asset(project, Path(a['staged_path']), a['sha256']))}
                    for a in rows]
        atomic_write_json(project / 'reports/asset_source_bindings.json', {
            'version': 1, 'handoff_sha256': receipt['sha256'],
            'assets_manifest_sha256': digest(manifest), 'assets': bindings})
        result = {'status': 'isolated', 'asset_count': len(bindings), 'model_calls': 0,
                  'next_action': 'resume_existing_project'}
        if (project / 'reports/blueprint.json').exists():
            from asset_preflight import preflight_project
            result['preflight'] = preflight_project(project)
            result['status'] = result['preflight']['status']
        return result
    finally:
        handle.close()


def validate_package(package):
    if package.get('version') != 1 or not isinstance(package.get('current_request'), str):
        raise ValueError('handoff requires version 1 and verbatim current_request')
    sources = package.get('sources', [])
    ids = [s['source_id'] for s in sources]
    inventory = package.get('inventory', [])
    if len(ids) != len(set(ids)) or len(inventory) != len(set(inventory)) or set(ids) != set(inventory):
        raise ValueError('handoff inventory mismatch')
    for s in sources:
        path = Path(s['original_path'])
        if not path.is_absolute() or not path.is_file() or digest(path) != s.get('sha256'):
            raise ValueError(f"source hash/path mismatch: {s['source_id']}")
        if s.get('source_class') not in {'material', 'history', 'artifact'}:
            raise ValueError('invalid source_class')
        if s.get('status') != 'complete' or not s.get('extractor'):
            raise ValueError(f"source extraction incomplete: {s['source_id']}")
        units = s.get('units', [])
        actual = [u['unit_id'] for u in units]
        expected = s.get('expected_units')
        if not isinstance(expected, list) or actual != expected or len(actual) != len(set(actual)):
            raise ValueError(f"unit coverage/order mismatch: {s['source_id']}")
        if not units and path.suffix.lower() not in IMAGE_EXTENSIONS:
            raise ValueError('empty textual source requires explicit extraction resolution')
        for u in units:
            if not isinstance(u.get('text'), str) or not isinstance(u.get('locator'), dict) or not u['locator']:
                raise ValueError('unit requires verbatim text and locator')
            if s['source_class'] == 'history' and (
                u.get('role') not in {'user', 'assistant', 'system', 'tool'} or not u.get('message_id')
            ):
                raise ValueError('history unit requires original role and message_id')
            if u.get('method') == 'ocr' and not u.get('image_path'):
                raise ValueError('OCR unit requires original image_path')
            if u.get('method') == 'ocr' and not Path(u['image_path']).is_file():
                raise ValueError('OCR image missing')
    asset_ids = set()
    for a in package.get('assets', []):
        if not a.get('asset_id') or a['asset_id'] in asset_ids or a.get('source_id') not in ids:
            raise ValueError('invalid asset identity')
        asset_ids.add(a['asset_id'])
        p = Path(a['path'])
        if not p.is_absolute() or p.suffix.lower() not in IMAGE_EXTENSIONS or not p.is_file() or digest(p) != a.get('sha256'):
            raise ValueError('asset hash/path mismatch')


def import_package(package, project):
    from ppt import lock_project
    project=Path(project).resolve()
    handle=lock_project(project)
    try:
        return _import_package(package,project)
    finally:
        handle.close()


def _import_package(package, project):
    validate_package(package)  # Validate everything before changing any active report.
    project = Path(project)
    reports = project / 'reports'
    key = hashlib.sha256(json.dumps(package, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    receipt_path=reports/'handoff_receipt.json'
    prior=json.loads(receipt_path.read_text(encoding='utf-8')) if receipt_path.exists() else {}
    occupied=any((reports/name).exists() for name in ('blueprint.json','build_state.json','brief.json','dsh_status.json'))
    if (prior and prior.get('sha256') != key) or (occupied and not prior):
        raise ValueError('project_input_conflict: existing project inputs/outputs must not be silently replaced; use a separate project for a new task')
    if prior:
        verify_receipt(project)
        return {'source_count':len(package['sources']),'asset_count':len(package.get('assets',[])), 'sha256':key, 'reused':True}
    sources, turns, artifacts, assets, sections = [], [], [], [], []
    artifact_ids = {}
    for s in package['sources']:
        sid, cls = s['source_id'], s['source_class']
        entry = dict(s, staged_path=s['original_path'], kind='image' if Path(s['original_path']).suffix.lower() in IMAGE_EXTENSIONS else 'document',
                     extension=Path(s['original_path']).suffix.lower(), status='extracted')
        entry.pop('units', None)
        sources.append(entry)
        if cls == 'artifact':
            rid = 'R' + str(len(artifacts) + 1).zfill(3)
            artifact_ids[sid] = rid
            artifacts.append(dict(entry, artifact_id=rid, lifecycle='candidate_unless_confirmed_by_later_user_turn'))
        for u in s['units']:
            if cls == 'history':
                turns.append(dict(u, turn_id='H' + str(len(turns) + 1).zfill(4),
                                  source_id=sid, content=u['text']))
                turns[-1].pop('text')
            else:
                sections.extend([f"\n## {sid} [{cls}] {u['unit_id']} {json.dumps(u['locator'], ensure_ascii=False)}\n", u['text']])
                structure = {k: v for k, v in u.items() if k not in {'text', 'unit_id', 'locator'}}
                if structure:
                    sections.append('\n[原始结构元数据]\n' + json.dumps(structure, ensure_ascii=False))
    by_id = {s['source_id']: s for s in sources}
    for a in package.get('assets', []):
        p = Path(a['path'])
        width, height = _image_size(p)
        staged = snapshot_asset(project, p, a['sha256'])
        entry = dict(a, staged_path=str(staged), original_path=str(p), extension=p.suffix.lower(),
                     source_class=by_id[a['source_id']]['source_class'], width=width,
                     height=height, bytes=p.stat().st_size)
        if a['source_id'] in artifact_ids:
            entry['artifact_id'] = artifact_ids[a['source_id']]
        assets.append(entry)
    payloads = {'source_manifest.json': {'sources': sources},
                'assets_manifest.json': {'assets': assets},
                'conversation_turns.json': {'turns': turns},
                'artifact_manifest.json': {'artifacts': artifacts},
                'current_request.json': {'authority': 'current_user_request', 'text': package['current_request']}}
    atomic_write_json(project / 'artifacts/extractions' / (key + '.json'), package)
    for name, value in payloads.items():
        atomic_write_json(reports / name, dict(value, version=1))
    atomic_write_text(reports / 'material.md', '\n'.join(sections))
    atomic_write_json(reports / 'handoff_receipt.json', {'version': 1, 'sha256': key,
                      'package_path': str((project / 'artifacts/extractions' / (key + '.json')).resolve()),
                      'report_hashes': {n: digest(reports / n) for n in [*payloads, 'material.md']},
                      'semantic_fidelity': 'not_certified_by_structural_validation'})
    return {'source_count': len(sources), 'asset_count': len(assets), 'sha256': key}


def verify_receipt(project):
    receipt = json.loads((project / 'reports/handoff_receipt.json').read_text(encoding='utf-8'))
    package_path = Path(receipt['package_path'])
    package = json.loads(package_path.read_text(encoding='utf-8-sig'))
    key = hashlib.sha256(json.dumps(package, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    if key != receipt['sha256']:
        raise ValueError('handoff package hash mismatch')
    validate_package(package)
    for name, expected in receipt['report_hashes'].items():
        if digest(project / 'reports' / name) != expected:
            raise ValueError('handoff report changed: ' + name)
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', required=True)
    parser.add_argument('--project', required=True)
    args = parser.parse_args()
    print(json.dumps(import_package(json.loads(Path(args.package).read_text(encoding='utf-8-sig')), Path(args.project)), ensure_ascii=False))
