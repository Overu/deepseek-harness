"""Consumer-level asset checks and bounded, traceable technical derivatives.

No source file is overwritten. Decoding large/unsupported images happens in an
isolated process, never by disabling Pillow's safety guard in renderer threads.
"""
from __future__ import annotations
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from stage_runtime import atomic_write_json, sha256_file


class AssetConsumerError(ValueError):
    pass


def partial_asset_errors(report: dict) -> bool:
    """Only locatable asset failures may be isolated; source authority stays fatal."""
    return bool(report.get('errors')) and all(
        e.get('code') == 'asset_consumer_error' and e.get('src') and e.get('page_no')
        for e in report['errors'])


def consumer_check(path: Path, max_edge: int = 4096) -> dict:
    from PIL import Image
    from pptx.parts.image import Image as PptImage
    with Image.open(path) as im:
        result = {'format': im.format, 'size': list(im.size)}
        if max(im.size) > max_edge or im.format not in {'PNG', 'JPEG', 'GIF', 'BMP', 'TIFF'}:
            raise AssetConsumerError('asset requires a technical derivative')
        im.load()
    image = PptImage.from_file(str(path))
    _ = image.ext, image.content_type, image.size
    return result


def materialize(source: Path, target: Path, *, max_edge: int = 4096) -> dict:
    source, target = source.resolve(), target.resolve()
    if source == target:
        raise AssetConsumerError('source and derivative must be different paths')
    before = sha256_file(source)
    if target.exists() and sha256_file(target) == before:
        info = consumer_check(target, max_edge)
        return dict(info, source_path=str(source), source_sha256=before,
                    output_path=str(target), output_sha256=before,
                    transformation='verified-existing-byte-copy', max_edge=max_edge, policy_version=1)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.asset-', suffix=target.suffix, dir=target.parent)
    os.close(fd)
    temporary = Path(name)
    transformed = False
    try:
        try:
            consumer_check(source, max_edge)
            # Preserve content bytes when format already matches the target.
            same = source.suffix.lower().replace('.jpeg', '.jpg') == target.suffix.lower().replace('.jpeg', '.jpg')
            if not same:
                raise AssetConsumerError('format conversion required')
            shutil.copyfile(source, temporary)
        except Exception:
            transformed = True
            result = subprocess.run([sys.executable, str(Path(__file__).resolve()),
                '--normalize', str(source), str(temporary), str(max_edge)],
                capture_output=True, text=True, timeout=90, encoding='utf-8')
            if result.returncode:
                raise AssetConsumerError('asset normalization failed (no model retry): ' + result.stderr[-1200:])
        info = consumer_check(temporary, max_edge)
        if sha256_file(source) != before:
            raise AssetConsumerError('source changed during preflight')
        os.replace(temporary, target)
        return dict(info, source_path=str(source), source_sha256=before,
                    output_path=str(target), output_sha256=sha256_file(target),
                    transformation='first-frame/exif/resize/encode' if transformed else 'byte-copy',
                    max_edge=max_edge, policy_version=1)
    finally:
        temporary.unlink(missing_ok=True)


def verify_assets(rows: list[dict]) -> list[str]:
    errors = []
    for row in rows:
        for prefix in ('source', 'output'):
            try:
                if sha256_file(Path(row[prefix + '_path'])) != row[prefix + '_sha256']:
                    errors.append(f'{prefix} asset changed: {row.get("asset_id", row.get("src"))}')
            except (KeyError, OSError):
                errors.append(f'{prefix} asset missing: {row.get("asset_id", row.get("src"))}')
    return errors


def preflight_project(project: Path) -> dict:
    from gen_images import collect_specs, _asset_lookup
    from sol_common import resolve_asset_target
    blueprint = json.loads((project / 'reports/blueprint.json').read_text(encoding='utf-8'))
    if (project / 'reports/handoff_receipt.json').exists():
        from import_handoff import verify_receipt
        try:
            verify_receipt(project)
        except (OSError, ValueError) as exc:
            report = {'version': 1, 'status': 'failed', 'assets': [],
                      'errors': [{'code': 'source_receipt_invalid', 'message': str(exc)}]}
            atomic_write_json(project / 'reports/asset_preflight.json', report)
            return report
    try:
        lookup = _asset_lookup(project)
    except (OSError, ValueError, KeyError) as exc:
        report = {'version': 1, 'status': 'failed', 'assets': [],
                  'errors': [{'code': 'source_receipt_invalid', 'message': str(exc)}]}
        atomic_write_json(project / 'reports/asset_preflight.json', report)
        return report
    report_path = project / 'reports/asset_preflight.json'
    try:
        old = json.loads(report_path.read_text(encoding='utf-8')).get('assets', []) if report_path.exists() else []
    except (ValueError, OSError) as exc:
        return {'version': 1, 'status': 'failed', 'assets': [],
                'errors': [{'code': 'asset_preflight_corrupt', 'message': str(exc)}]}
    cached = {r['src']: r for r in old}
    rows, errors, seen = [], [], set()
    for spec in collect_specs(blueprint):
        if not spec.get('asset_id') or spec['src'] in seen:
            continue
        seen.add(spec['src'])
        try:
            source = lookup.get(spec['asset_id'])
            if source is None:
                raise AssetConsumerError('unknown asset_id')
            target = resolve_asset_target(project / 'assets', spec['src'])
            prior = cached.get(spec['src'])
            if target.exists() and not prior and sha256_file(target) != sha256_file(source):
                # Old image-cache lineage permits migration, never an arbitrary overwrite.
                legacy_path = project / 'reports/image-cache.json'
                legacy = json.loads(legacy_path.read_text(encoding='utf-8')).get('assets', {}).get(spec['src'], {}) if legacy_path.exists() else {}
                if (legacy.get('source_sha256') != sha256_file(source)
                        or legacy.get('output_sha256') != sha256_file(target)):
                    raise AssetConsumerError('untracked reused-asset conflict; preserve user file and inspect lineage')
            if prior and target.exists() and sha256_file(target) != prior.get('output_sha256'):
                raise AssetConsumerError('tracked derivative changed externally; inspect before regenerating')
            if prior and prior.get('source_path') == str(source.resolve()) and not verify_assets([prior]):
                row = prior
            else:
                row = materialize(source, target)
            rows.append(dict(row, asset_id=spec['asset_id'], src=spec['src']))
        except Exception as exc:
            errors.append({'code': 'asset_consumer_error', 'asset_id': spec.get('asset_id'),
                           'src': spec['src'], 'page_no': spec['page_no'], 'message': str(exc)})
    report = {'version': 1, 'status': 'failed' if errors else 'success', 'assets': rows, 'errors': errors}
    atomic_write_json(report_path, report)
    return report


def _normalize(source: str, target: str, max_edge: int):
    import resource
    # Finite resource ceiling: this is a decoder worker, not an unbounded bypass.
    if sys.platform.startswith('linux'):
        resource.setrlimit(resource.RLIMIT_AS, (3 * 1024**3, 3 * 1024**3))
        resource.setrlimit(resource.RLIMIT_CPU, (75, 75))
    # macOS sandbox may reject setrlimit; pixel ceiling and parent timeout
    # remain enforced on every platform, without silently lifting the guard.
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = 125_000_000  # hard error above 250 MP, isolated worker only
    with Image.open(source) as image:
        if image.width * image.height > 250_000_000:
            raise AssetConsumerError('asset exceeds 250 MP decoder ceiling; provide a smaller derivative')
        image.seek(0)
        image.draft('RGB', (max_edge, max_edge))
        image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        image = ImageOps.exif_transpose(image)
        if Path(target).suffix.lower() in {'.jpg', '.jpeg'}:
            image.convert('RGB').save(target, 'JPEG', quality=92)
        else:
            image.convert('RGBA' if 'A' in image.getbands() else 'RGB').save(target, 'PNG')


def finalize_assets(project: Path):
    """Bind every consumed image, including generated images, before final gates."""
    from gen_images import collect_specs
    from sol_common import resolve_asset_target
    path = project / 'reports/asset_preflight.json'
    report = json.loads(path.read_text(encoding='utf-8'))
    rows = {r['src']: r for r in report['assets']}
    errors = verify_assets(list(rows.values()))
    if errors:
        raise AssetConsumerError('; '.join(errors))
    bp = json.loads((project / 'reports/blueprint.json').read_text(encoding='utf-8'))
    specs = collect_specs(bp)
    for spec in specs:
        target = resolve_asset_target(project / 'assets', spec['src'])
        info = consumer_check(target)
        if spec['src'] not in rows:
            digest = sha256_file(target)
            rows[spec['src']] = dict(info, src=spec['src'], source_path=str(target),
                output_path=str(target), source_sha256=digest, output_sha256=digest,
                transformation='generated-or-provided-consumer-image')
    report['assets'] = [rows[src] for src in sorted({s['src'] for s in specs})]
    report['complete'] = True
    atomic_write_json(path, report)
    return report


if __name__ == '__main__':
    if len(sys.argv) == 5 and sys.argv[1] == '--normalize':
        _normalize(sys.argv[2], sys.argv[3], int(sys.argv[4]))
    else:
        raise SystemExit('internal decoder worker; use preflight_project from the build runner')
