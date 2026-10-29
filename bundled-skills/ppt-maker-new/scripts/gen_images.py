#!/usr/bin/env python3
"""Materialize reused assets and generate missing blueprint images."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from pathlib import Path

from sol_common import resolve_asset_target, portable_asset_key, is_safe_asset_src
from stage_runtime import atomic_write_json, sha256_file, sha256_text, write_stage_metric
from image_lineage import image_prompt, demand_hash, lineage_findings


DEFAULT_GEN = str(Path(__file__).parent / "gen_gpt_image2.py")
GENERATED_IMAGE_EXTENSIONS = {".jpg", ".jpeg"}
# rc13/rc14 -> rc15 changes observation/cancellation, not successful image semantics.
# Remove this compatibility alias when generation semantics change. Custom
# generators still require an exact file hash; no filename-based cache trust.
TELEMETRY_COMPATIBLE_GENERATORS = (
    # The enterprise rc13 adapter has the same success payload and image settings.
    'c541d9ccaf9169e773a3ab4e09045b7b9376cfdc704f6d5f6f66a494467d1cb0',
    '788fffe45b0a06ff38c70a58256fcd755813b0238e5a45ef3bebd5258507a884',
    '18207a4e8fd0b31a93e8e8d9eb5308ef4b2df733fa4fc95df562de48acdf4767',
)


def _save_image_transaction(reports, path, transaction):
    """Ownership is authoritative; an unavailable telemetry copy cannot veto it."""
    atomic_write_json(path, transaction)
    try:
        atomic_write_json(reports/'image_requests'/(transaction['request_id']+'.json'), transaction)
    except OSError as exc:
        # No provider payloads/credentials in diagnostics. Retain the warning in
        # the authoritative record so status/metrics can expose the coverage gap.
        transaction.setdefault('history_write_errors', []).append({
            'status':transaction['status'], 'error_type':type(exc).__name__})
        print(f"[WARN] {transaction['src']}: image history copy unavailable ({type(exc).__name__})", file=sys.stderr)
        try:
            atomic_write_json(path, transaction)
        except OSError:
            # The authoritative transition already succeeded above. Failure to
            # append its diagnostic must not prevent dispatch after 'submitted'.
            # The next transition carries the warning again; console retains it.
            print(f"[WARN] {transaction['src']}: history warning persistence unavailable", file=sys.stderr)


def collect_specs(blueprint: dict) -> list[dict]:
    specs = []
    for page in blueprint.get("pages", []):
        page_no = int(page.get("no", len(specs) + 1))
        images = page.get("images")
        if images is None:
            legacy = page.get("image") or {}
            images = [legacy] if legacy.get("desc") and "无图片" not in legacy.get("desc", "") else []
        for index, image in enumerate(images):
            spec = dict(image)
            suffix = chr(ord("a") + index) if len(images) > 1 else ""
            spec.setdefault("id", f"page-{page_no:02d}{suffix}")
            spec.setdefault("src", f"page-{page_no:02d}{suffix}.jpg")
            spec.setdefault("aspect", "16:9")
            spec["page_no"] = page_no
            specs.append(spec)
    return specs


def materialize_reused_asset(source: Path, target: Path, overwrite: bool = False) -> str:
    if target.exists() and not overwrite:
        return "skipped-existing"
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.suffix.lower() == target.suffix.lower():
        shutil.copy2(source, target)
    else:
        try:
            from PIL import Image
        except ImportError as exc:
            raise RuntimeError(f"Pillow is required to convert {source.suffix} to {target.suffix}") from exc
        with Image.open(source) as image:
            image.convert("RGB").save(target, "JPEG", quality=92)
    return "reused"


def _asset_lookup(project: Path) -> dict[str, Path]:
    path = project / "reports/assets_manifest.json"
    if not path.exists():
        return {}
    from import_handoff import verified_asset_sources
    return verified_asset_sources(project)


def run(
    project: Path,
    generator: str,
    model: str,
    fallback: str,
    retries: int,
    resolution: str,
    overwrite: bool,
    workers: int = 4,
    page_numbers: set[int] | None = None,
    allow_partial_assets: bool = False,
) -> int:
    started = time.time()
    if workers < 1:
        raise ValueError("workers must be at least 1")
    reports = project / "reports"
    run_id = os.environ.get('PPT_BUILD_RUN_ID')
    cancel_file = reports/'cancel'/(run_id+'.json') if run_id else None
    def cancelled():
        return cancel_file is not None and cancel_file.exists()
    assets = project / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    blueprint = json.loads((reports / "blueprint.json").read_text(encoding="utf-8"))
    specs = collect_specs(blueprint)
    # Validate the entire deck before filtering pilot pages or buying image work.
    identities = {}
    spellings = {}
    conflicts = []
    for spec in specs:
        key = portable_asset_key(spec['src'])
        if not is_safe_asset_src(spec['src']) or key in spellings and spellings[key] != spec['src']:
            conflicts.append({'code':'asset_consumer_error','page_no':spec['page_no'],
                              'src':spec['src'],'message':'unsafe or colliding cross-platform image path'})
        spellings[key] = spec['src']
        identity = ('asset', spec['asset_id']) if spec.get('asset_id') else ('generated', demand_hash(spec, blueprint))
        if spec['src'] in identities and identities[spec['src']] != identity:
            conflicts.append({'code':'asset_consumer_error','page_no':spec['page_no'],
                              'src':spec['src'],'message':'one src maps to conflicting image demands'})
        identities[spec['src']] = identity
    if conflicts:
        atomic_write_json(reports/'image_lineage.json', {'errors':conflicts})
        print(json.dumps(conflicts,ensure_ascii=False),file=sys.stderr)
        return 1
    if page_numbers is not None:
        specs = [s for s in specs if s['page_no'] in page_numbers]
    lookup = _asset_lookup(project)
    from asset_preflight import preflight_project, consumer_check, partial_asset_errors
    preflight = preflight_project(project)
    if preflight['errors']:
        print(json.dumps(preflight['errors'], ensure_ascii=False), file=sys.stderr)
        if not (allow_partial_assets and partial_asset_errors(preflight)):
            return 1
    blocked_sources = {e.get('src') for e in preflight['errors']}
    ready_reused = {row['src']: row for row in preflight['assets']}
    image_language = (blueprint.get("theme") or {}).get("image_language") or "cohesive editorial photography"
    for spec in specs:
        desc = spec.get("desc", "")
        requirement = spec.get("requirement", "")
        spec["prompt"] = image_prompt(spec, blueprint)
    (reports / "images_spec.json").write_text(json.dumps(specs, ensure_ascii=False, indent=2), encoding="utf-8")

    cache_path = reports / "image-cache.json"
    try:
        cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    except (OSError, json.JSONDecodeError, TypeError):
        cache = {}
    cache_assets = cache.get("assets") if isinstance(cache.get("assets"), dict) else {}
    cache = {"version": 1, "assets": cache_assets}
    generator_path = Path(generator)
    generator_identity = (
        sha256_file(generator_path) if generator_path.is_file() else str(generator_path)
    )

    failures = 0
    generated_successes = 0
    pending: list[tuple[dict, Path, Path, list[str], str]] = []
    pending_targets: set[Path] = set()
    def mark_ready(spec, target):
        run_id = os.environ.get('PPT_BUILD_RUN_ID')
        if run_id:
            atomic_write_json(reports / 'runs' / run_id / 'assets_ready' / (sha256_text(spec['src']) + '.json'),
                              {'src': spec['src'], 'sha256': sha256_file(target)})
    for spec in specs:
        try:
            if spec['src'] in blocked_sources:
                failures += 1
                continue  # Never overwrite an untracked/conflicting asset.
            target = resolve_asset_target(assets, spec["src"])
        except ValueError as exc:
            print(f"[FAIL] {spec.get('src', '<empty>')}: {exc}", file=sys.stderr)
            failures += 1
            continue
        asset_id = spec.get("asset_id")
        if asset_id:
            source = lookup.get(asset_id)
            if not source or not source.exists():
                print(f"[FAIL] unknown or missing asset_id {asset_id}", file=sys.stderr)
                failures += 1
                continue
            try:
                if spec['src'] in ready_reused:
                    row = ready_reused[spec['src']]
                    cache_assets[spec['src']] = row
                    atomic_write_json(cache_path, cache)
                    mark_ready(spec, target)
                    continue
                source_hash = sha256_file(source)
                prior = cache_assets.get(spec['src'], {})
                replace = overwrite
                if target.exists() and not overwrite:
                    if prior:
                        replace = (prior.get('source_sha256') != source_hash or
                                   prior.get('output_sha256') != sha256_file(target))
                    elif source_hash != sha256_file(target):
                        raise ValueError('untracked reused-asset conflict; inspect file before explicit overwrite')
                status = materialize_reused_asset(source, target, replace)
                cache_assets[spec['src']] = {'source_sha256': source_hash, 'output_sha256': sha256_file(target)}
                atomic_write_json(cache_path, cache)
                print(f"[{status}] {target.name}")
                mark_ready(spec, target)
            except Exception as exc:  # noqa: BLE001
                print(f"[FAIL] {target.name}: {exc}", file=sys.stderr)
                failures += 1
            continue
        if not spec.get("desc") or "无图片" in spec.get("desc", ""):
            continue
        if target.suffix.lower() not in GENERATED_IMAGE_EXTENSIONS:
            print(
                f"[FAIL] {target.name}: generated images must use a JPEG raster extension "
                f"({', '.join(sorted(GENERATED_IMAGE_EXTENSIONS))})",
                file=sys.stderr,
            )
            failures += 1
            continue
        if target in pending_targets:
            print(f"[deduplicated] {target.name}")
            continue
        contract = {
            "prompt": spec["prompt"], "model": model, "fallback": fallback,
            "retries": retries, "resolution": resolution,
            "aspect": spec.get("aspect", "16:9"), "mime_type": "JPEG",
            "quality": "medium", "generator": generator_identity,
        }
        contract_hash = sha256_text(json.dumps(
            contract, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        ))
        compatible_contracts = {contract_hash}
        if generator_path.resolve() == Path(DEFAULT_GEN).resolve():
            compatible_contracts.update(sha256_text(json.dumps(dict(contract,generator=identity),
                ensure_ascii=False,sort_keys=True,separators=(',',':')))
                for identity in TELEMETRY_COMPATIBLE_GENERATORS)
        cache_entry = cache_assets.get(spec["src"], {})
        transaction_path = reports/'image_transactions'/(sha256_text(spec['src'])+'.json')
        transaction = json.loads(transaction_path.read_text(encoding='utf8')) if transaction_path.exists() else {}
        if transaction.get('contract_sha256') in compatible_contracts and transaction.get('status') == 'response_saved':
            recovered = False
            temporary = resolve_asset_target(assets, transaction['temporary_src'])
            expected = transaction['output_sha256']
            if target.is_file() and sha256_file(target) == expected:
                cache_entry = transaction['receipt']
                recovered = True
            elif temporary.is_file() and sha256_file(temporary) == expected:
                if target.exists() and sha256_file(target) != transaction.get('previous_sha256'):
                    print(f'[FAIL] {target.name}: target changed during interrupted generation',file=sys.stderr)
                    failures += 1
                    continue
                consumer_check(temporary)
                os.replace(temporary,target)
                cache_entry = transaction['receipt']
                recovered = True
            if recovered:
                cache_assets[spec['src']] = cache_entry
                atomic_write_json(cache_path,cache)
                transaction = dict(transaction,status='committed')
                _save_image_transaction(reports,transaction_path,transaction)
        cache_matches = False
        if target.exists() and not overwrite and cache_entry.get("contract_sha256") in compatible_contracts:
            try:
                cache_matches = cache_entry.get("output_sha256") == sha256_file(target)
            except OSError:
                cache_matches = False
        if cache_matches:
            consumer_check(target)
            cache_entry['demand_sha256'] = demand_hash(spec,blueprint)
            cache_assets[spec['src']] = cache_entry
            atomic_write_json(cache_path,cache)
            print(f"[cached] {target.name}")
            mark_ready(spec, target)
            continue
        if target.exists() and not overwrite and not cache_entry:
            print(f"[FAIL] {target.name}: untracked generated-asset conflict; file preserved, not ready",file=sys.stderr)
            failures += 1
            continue

        if transaction.get('status') in {'submitted','response_saved','outcome_unknown'}:
            print(f"[FAIL] {target.name}: image request outcome unresolved; inspect image_transactions before retry",file=sys.stderr)
            failures += 1
            continue
        if target.exists() and cache_entry and not overwrite and cache_entry.get('output_sha256') != sha256_file(target):
            print(f"[FAIL] {target.name}: tracked image changed externally; file preserved",file=sys.stderr)
            failures += 1
            continue

        temporary = target.with_name(f".{target.stem}.{uuid.uuid4().hex}.tmp{target.suffix}")
        target.parent.mkdir(parents=True, exist_ok=True)
        command = [
            sys.executable, generator, spec["prompt"], "--model", model,
            "--fallback-model", fallback, "--max-retries", str(retries),
            "--resolution", resolution, "--aspect-ratio", spec.get("aspect", "16:9"),
            "--mime-type", "JPEG", "--quality", "medium", "--out", str(temporary), "--timeout", "280",
        ]
        pending.append((spec, target, temporary, command, contract_hash))
        pending_targets.add(target)

    def generate_one(item: tuple[dict, Path, Path, list[str], str]) -> tuple[dict, Path, bool, str, str]:
        spec, target, temporary, command, contract_hash = item
        transaction_path=reports/'image_transactions'/(sha256_text(spec['src'])+'.json')
        transaction={'src':spec['src'],'request_id':uuid.uuid4().hex,'contract_sha256':contract_hash,'status':'preparing',
            'run_id':os.environ.get('PPT_BUILD_RUN_ID'),
            'started':time.time(), 'requested_model':model, 'resolution':resolution,
            'temporary_src':str(temporary.relative_to(assets.resolve())),
            'previous_sha256':sha256_file(target) if target.exists() else None}
        def persist(**changes):
            transaction.update(changes)
            _save_image_transaction(reports,transaction_path,transaction)
        try:
            persist()
            temporary.unlink(missing_ok=True)
            if cancelled():
                persist(status='not_submitted',reason='cancel_requested')
                return spec, target, False, 'cancelled before dispatch', contract_hash
            persist(status='submitted')
            # A cancellation can arrive while persisting the submission intent.
            if cancelled():
                persist(status='not_submitted',reason='cancel_requested')
                return spec, target, False, 'cancelled before dispatch', contract_hash
            child_env=dict(os.environ, PYTHONIOENCODING='utf-8')
            child_env.pop('PPT_IMAGE_CANCEL_FILE', None)
            if cancel_file is not None:
                child_env['PPT_IMAGE_CANCEL_FILE']=str(cancel_file.resolve())
            try:
                result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8',
                                        env=child_env)
            except (FileNotFoundError, PermissionError) as exc:
                # Python reports these launch failures before the child can run.
                # Do not apply this classification to a nonzero child exit or to
                # ambiguous communication errors after launch.
                persist(status='not_submitted',reason='child_launch_failed',error_type=type(exc).__name__)
                return spec, target, False, 'child launch failed: '+type(exc).__name__, contract_hash
            transaction.update(finished=time.time())
            transaction['latency_s']=round(transaction['finished']-transaction['started'],3)
            try:
                payload=json.loads(result.stdout)
            except (ValueError, TypeError):
                payload={}
            # Only structured usage metadata; never signed URLs or auth fields.
            if isinstance(payload,dict) and isinstance(payload.get('provider_attempts'),list):
                transaction['provider_attempts']=[{k:row[k] for k in
                    ('attempt','model','status','latency_s','provider_usage') if k in row}
                    for row in payload['provider_attempts'] if isinstance(row,dict)]
            if result.returncode != 0 or not temporary.exists() or temporary.stat().st_size == 0:
                detail = (result.stderr or result.stdout or "generator produced no file")[-500:]
                # Only our built-in adapter supplies this explicit pre-API proof.
                if (generator_path.resolve()==Path(DEFAULT_GEN).resolve() and isinstance(payload,dict)
                        and payload.get('status')=='cancelled' and payload.get('provider_attempts')==[]):
                    persist(status='not_submitted',reason='cancel_requested')
                    return spec, target, False, 'cancelled before provider request', contract_hash
                # A failed process/download does not prove the provider did no work.
                persist(status='outcome_unknown',reason=detail,
                    provider_stdout=result.stdout,provider_stderr=result.stderr)
                return spec, target, False, detail, contract_hash
            consumer_check(temporary)
            receipt={'contract_sha256':contract_hash,'output_sha256':sha256_file(temporary),
                     'demand_sha256':demand_hash(spec,blueprint)}
            persist(status='response_saved',output_sha256=receipt['output_sha256'],receipt=receipt)
            if target.exists() and sha256_file(target) != transaction['previous_sha256']:
                raise ValueError('asset target changed during generation; refusing overwrite')
            os.replace(temporary, target)
            return spec, target, True, str(target.stat().st_size), contract_hash
        except Exception as exc:  # noqa: BLE001
            # Keep paid output and receipt on commit/validation errors for inspection.
            return spec, target, False, str(exc), contract_hash

    if pending:
        with ThreadPoolExecutor(max_workers=min(workers, len(pending))) as executor:
            remaining=iter(pending)
            futures=set()
            def fill_slots():
                while len(futures)<workers and not cancelled():
                    item=next(remaining,None)
                    if item is None:
                        break
                    futures.add(executor.submit(generate_one,item))
            fill_slots()
            while futures:
                done,futures=wait(futures,return_when=FIRST_COMPLETED)
                for future in done:
                    spec, target, succeeded, detail, contract_hash = future.result()
                    if succeeded:
                        transaction_path=reports/'image_transactions'/(sha256_text(spec['src'])+'.json')
                        transaction=json.loads(transaction_path.read_text(encoding='utf8'))
                        receipt=transaction['receipt']
                        if receipt['output_sha256'] != sha256_file(target):
                            print(f'[FAIL] {target.name}: asset changed before receipt commit',file=sys.stderr)
                            failures += 1
                            continue
                        print(f"[generated] {target.name} {detail}")
                        generated_successes += 1
                        cache_assets[spec['src']] = receipt
                        atomic_write_json(cache_path, cache)
                        _save_image_transaction(reports,transaction_path,dict(transaction,status='committed'))
                        mark_ready(spec, target)
                        continue
                    print(f"[FAIL] {target.name}: {detail}", file=sys.stderr)
                    failures += 1
                fill_slots()
    atomic_write_json(cache_path, cache)
    lineage_errors=lineage_findings(project,blueprint,
        [p for p in blueprint.get('pages',[]) if page_numbers is None or p['no'] in page_numbers])
    atomic_write_json(reports/'image_lineage.json',{'errors':lineage_errors})
    if lineage_errors and not failures:
        failures=len(lineage_errors)
    write_stage_metric(
        project, "images", started, status="cancelled" if cancelled() else ("failed" if failures else "success"),
        assets=len(specs), generated=generated_successes, failures=failures, workers=workers,
    )
    print(f"DONE total={len(specs)} failures={failures}")
    return 130 if cancelled() else (1 if failures else 0)


def main() -> int:
    parser = argparse.ArgumentParser(description="reuse and generate blueprint images")
    parser.add_argument("--project", default=".")
    parser.add_argument("--gen-script", default=DEFAULT_GEN)
    parser.add_argument("--resolution", default="2K")
    parser.add_argument("--model", default="gpt-image-2")
    parser.add_argument("--fallback-model", default="doubao-seedream-5-0-pro-260628")
    parser.add_argument("--max-retries", type=int, default=3)
    parser.add_argument("--workers", type=int, default=4, help="concurrent image generations (default: 4)")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument('--allow-partial-assets', action='store_true')
    parser.add_argument("--pages", default=None, help="only materialize comma-separated pilot page numbers")
    args = parser.parse_args()
    return run(Path(args.project).resolve(), args.gen_script, args.model, args.fallback_model,
               args.max_retries, args.resolution, args.overwrite, args.workers,
               {int(n) for n in args.pages.split(',')} if args.pages else None, args.allow_partial_assets)


if __name__ == "__main__":
    raise SystemExit(main())
