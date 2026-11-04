"""Effective asset inventory: immutable import plus atomic, source-bound additions.

Registration is technical bookkeeping. It never accepts an artifact, rewrites a
blueprint, chooses an image by filename, or replenishes a model-call allowance.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
from stage_runtime import atomic_write_json, sha256_file


def _key(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':')).encode('utf-8')).hexdigest()


def discover_assets(package):
    """Keep explicit IDs; discover raster sources and explicitly extracted figures."""
    from ingest_materials import IMAGE_EXTENSIONS
    rows = [dict(a) for a in package.get('assets', [])]
    known = {(a['source_id'], a['sha256']) for a in rows}
    ids = {a['asset_id'] for a in rows}
    for source in package.get('sources', []):
        paths = [source['original_path']] if Path(source['original_path']).suffix.lower() in IMAGE_EXTENSIONS else []
        paths += [u['image_path'] for u in source.get('units', []) if u.get('image_path')]
        for name in paths:
            path = Path(name)
            if not path.is_absolute() or not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
                raise ValueError('extracted image requires an absolute, existing raster path')
            digest = sha256_file(path)
            identity = (source['source_id'], digest)
            if identity in known:
                continue
            aid = 'A' + _key(identity)[:20]
            if aid in ids:
                raise ValueError('automatic asset ID collision')
            rows.append(dict(asset_id=aid, source_id=source['source_id'], path=str(path), sha256=digest))
            known.add(identity); ids.add(aid)
    return rows


def _base(project):
    manifest = project / 'reports/assets_manifest.json'
    rows = json.loads(manifest.read_text(encoding='utf-8')).get('assets', []) if manifest.exists() else []
    receipt_path = project / 'reports/handoff_receipt.json'
    if receipt_path.exists():
        from import_handoff import verify_receipt
        receipt = verify_receipt(project)
    else:
        receipt = {}
    return rows, {'base_manifest_sha256': sha256_file(manifest) if manifest.exists() else None,
                  'handoff_sha256': receipt.get('sha256')}


def _load(project, binding):
    path = project / 'reports/asset_registry.json'
    if not path.exists():
        return dict(version=1, **binding, assets=[], aliases=[])
    value = json.loads(path.read_text(encoding='utf-8'))
    content = {k: v for k, v in value.items() if k != 'sha256'}
    if (value.get('sha256') != _key(content) or value.get('version') != 1
            or any(value.get(k) != v for k, v in binding.items())):
        raise ValueError('asset registry integrity/source binding mismatch')
    return content


def available_assets(project):
    """Single inventory consumed by Brief, plan, image production and QA."""
    project = Path(project)
    base, binding = _base(project)
    registry = _load(project, binding)
    from import_handoff import _base_verified_asset_sources
    sources = _base_verified_asset_sources(project)
    rows = [dict(a, staged_path=str(sources[a['asset_id']])) for a in base]
    lookup = {a['asset_id']: a for a in rows}
    for row in registry['assets']:
        row = dict(row)
        path = Path(row['staged_path'])
        canonical = project.resolve() / 'inputs/assets' / (row['sha256'] + Path(row['original_path']).suffix.lower())
        if (row['asset_id'] in lookup or path != canonical or path.is_symlink()
                or sha256_file(path) != row['sha256']):
            raise ValueError('registered asset identity/path/hash mismatch')
        rows.append(row); lookup[row['asset_id']] = row
    for alias in registry['aliases']:
        target = lookup.get(alias['target_asset_id'])
        if (alias['asset_id'] in lookup or target is None or
                (target.get('source_id'), target.get('sha256')) != (alias['source_id'], alias['sha256'])):
            raise ValueError('asset alias identity mismatch')
        row = dict(target, asset_id=alias['asset_id'], alias_of=target['asset_id'])
        rows.append(row); lookup[row['asset_id']] = row
    return rows


def attach_assets(brief, project):
    project = Path(project)
    result = dict(brief)
    if (project / 'reports/assets_manifest.json').exists() or (project / 'reports/asset_registry.json').exists():
        result['available_assets'] = available_assets(project)
    return result


def _source_rows(project):
    path = project / 'reports/source_manifest.json'
    sources = json.loads(path.read_text(encoding='utf-8')).get('sources', []) if path.exists() else []
    path = project / 'reports/artifact_manifest.json'
    artifacts = json.loads(path.read_text(encoding='utf-8')).get('artifacts', []) if path.exists() else []
    return {s['source_id']: dict(s, artifact_id=next((a['artifact_id'] for a in artifacts
            if a.get('source_id') == s['source_id']), s.get('artifact_id'))) for s in sources}


def synchronize(project, additions=None):
    """Caller holds the project lock. One JSON replacement commits all additions."""
    from import_handoff import snapshot_asset, digest
    from ingest_materials import IMAGE_EXTENSIONS, _image_size
    from sol_common import resolve_asset_target
    project = Path(project).resolve()
    base, binding = _base(project)
    current = available_assets(project)  # Refuse a damaged existing registry.
    registry = _load(project, binding)
    before = _key(registry)
    sources = _source_rows(project)
    proposed = []
    receipt_path = project / 'reports/handoff_receipt.json'
    if receipt_path.exists():
        receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
        package = json.loads(Path(receipt['package_path']).read_text(encoding='utf-8-sig'))
        proposed += discover_assets(package)
    if additions is not None:
        if additions.get('version') != 1 or not isinstance(additions.get('assets'), list):
            raise ValueError('asset additions require version 1 and an assets array')
        proposed += additions['assets']
    by_id = {a['asset_id']: a for a in current}
    by_identity = {(a['source_id'], a.get('sha256')): a for a in current}
    added = []
    for item in proposed:
        sid = item.get('source_id'); source = sources.get(sid)
        if source is None:
            raise ValueError('asset registration requires an existing source_id')
        origin = Path(source.get('original_path') or source['staged_path'])
        if digest(origin) != source['sha256']:
            raise ValueError('asset parent source hash changed')
        path = Path(item['path'])
        expected = item.get('sha256')
        if not path.is_absolute() or path.suffix.lower() not in IMAGE_EXTENSIONS or not path.is_file() or sha256_file(path) != expected:
            raise ValueError('asset registration hash/path mismatch')
        if any(a['source_id'] == sid and a.get('original_path') == str(path)
               and a.get('sha256') and a['sha256'] != expected for a in current):
            raise ValueError('registered image source changed; preserve the previous binding')
        aid = item.get('asset_id') or ('A' + _key((sid, expected))[:20])
        if not isinstance(aid, str) or not aid.strip() or aid != aid.strip():
            raise ValueError('invalid asset ID')
        if aid in by_id:
            if (by_id[aid]['source_id'], by_id[aid].get('sha256')) != (sid, expected):
                raise ValueError('existing asset ID cannot be rebound')
            continue
        existing = by_identity.get((sid, expected))
        if existing:
            alias = dict(asset_id=aid, target_asset_id=existing['asset_id'], source_id=sid, sha256=expected)
            registry['aliases'].append(alias)
            row = dict(existing, asset_id=aid, alias_of=existing['asset_id'])
        else:
            snapshot = snapshot_asset(project, path, expected)
            width, height = _image_size(snapshot)
            row = dict(asset_id=aid, source_id=sid, sha256=expected, original_path=str(path), path=str(path),
                       staged_path=str(snapshot), extension=path.suffix.lower(), width=width, height=height,
                       bytes=snapshot.stat().st_size, source_class=source['source_class'])
            if source.get('artifact_id'):
                row['artifact_id'] = source['artifact_id']
            registry['assets'].append(row)
            by_identity[(sid, expected)] = row
        by_id[aid] = row; added.append(aid)
    bp_path = project / 'reports/blueprint.json'
    blueprint = json.loads(bp_path.read_text(encoding='utf-8')) if bp_path.exists() else {}
    unresolved, affected = [], set()
    for page in blueprint.get('pages', []):
        for image in page.get('images', []):
            aid = image.get('asset_id')
            if not aid:
                continue
            if aid in by_id:
                if aid in added:
                    affected.add(page['no'])
                continue
            expected = image.get('source_sha256') or image.get('sha256')
            if not expected and image.get('src'):
                target = resolve_asset_target(project / 'assets', image['src'])
                if target.is_file():
                    expected = sha256_file(target)
            matches = [a for a in by_id.values() if expected and a.get('sha256') == expected
                       and (not image.get('source_id') or a['source_id'] == image['source_id'])]
            identities = {(a['source_id'], a['sha256']) for a in matches}
            if len(identities) == 1:
                target = next(a for a in matches if not a.get('alias_of')) if any(not a.get('alias_of') for a in matches) else matches[0]
                registry['aliases'].append(dict(asset_id=aid, target_asset_id=target['asset_id'],
                                                source_id=target['source_id'], sha256=target['sha256']))
                by_id[aid] = dict(target, asset_id=aid, alias_of=target['asset_id'])
                added.append(aid); affected.add(page['no'])
            else:
                unresolved.append(dict(page_no=page['no'], src=image.get('src'), asset_id=aid,
                                       reason='unknown asset_id; no unique source/hash match'))
    if _key(registry) != before:
        # Snapshots are already hash-verified. An interruption before this point
        # leaves harmless orphan snapshots; readers see either complete inventory.
        atomic_write_json(project / 'reports/asset_registry.json', dict(registry, sha256=_key(registry)))
    return dict(status='needs_attention' if unresolved else 'success', added_asset_ids=added,
                asset_count=len(by_id), affected_pages=sorted(affected), unresolved=unresolved,
                model_calls=0, next_action='resume_existing_project')


def register_assets(project, additions=None):
    from ppt import lock_project, ensure_reconciliation_idle
    project = Path(project).resolve()
    handle = lock_project(project)
    try:
        ensure_reconciliation_idle(project)
        return synchronize(project, additions)
    finally:
        handle.close()
