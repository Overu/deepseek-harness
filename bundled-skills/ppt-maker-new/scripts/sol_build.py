#!/usr/bin/env python3
"""Run the expensive image and page-render branches concurrently, then gate."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable

from stage_runtime import atomic_write_json, skill_sha256 as _skill_sha256
from ppt_contract import visible_page_character_count
from defect_map import load_open_defects


RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,96}$")


def _normalize_run_id(run_id: str | None) -> str | None:
    if run_id is None:
        return None
    value = str(run_id).strip()
    if not RUN_ID_PATTERN.fullmatch(value):
        raise ValueError("run_id must contain only letters, digits, dot, underscore, or hyphen")
    return value


def _new_run_id() -> str:
    return time.strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:10]


def _claim_run_id(project: Path, run_id: str) -> None:
    """Claim a run once; retries must use a new ID so snapshots stay append-only."""
    run_dir = project / "reports" / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    marker = run_dir / "run_claim.json"
    payload = json.dumps({"run_id": run_id, "claimed_at_unix": round(time.time(), 3)})
    try:
        descriptor = os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as exc:
        raise ValueError(f"run_id {run_id!r} has already been used; choose a new run_id") from exc
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(payload)


def _archive_run_report(project: Path, run_id: str | None, name: str, payload: dict) -> None:
    if run_id:
        atomic_write_json(project / "reports" / "runs" / run_id / name, payload)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _authoring_sha256(project: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted((project / "authoring").glob("slide-*.xml")):
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _assert_skill_unchanged(skill_root: Path, expected_hash: str) -> None:
    if _skill_sha256(skill_root) != expected_hash:
        raise RuntimeError("skill files changed during this build; start a new run with the new version")


def require_structural_workflow(project: Path, run_id: str | None) -> None:
    """Old visual runs need fresh structural evidence, never status relabeling."""
    path = project / 'reports/runs' / str(run_id) / 'workflow_contract.json'
    try:
        contract = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        raise RuntimeError('missing workflow contract; rebuild or reassemble with this version') from exc
    if contract.get('visual_mode') != 'off':
        raise RuntimeError('legacy visual workflow; rebuild or reassemble with this version')


def integrity_evidence(project: Path, output: Path, run_id: str) -> str:
    path = project / 'reports/runs' / run_id / 'pptx_integrity.json'
    try:
        report = json.loads(path.read_text(encoding='utf-8'))
        blueprint = json.loads((project / 'reports/blueprint.json').read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        raise RuntimeError('missing or invalid PPTX integrity evidence') from exc
    expected = len(blueprint.get('pages') or [])
    if (report.get('status') != 'passed' or report.get('errors') or expected < 1
            or report.get('run_id') != run_id
            or report.get('expected_slides') != expected or report.get('slide_count') != expected
            or not output.is_file() or report.get('input_sha256') != _sha256_file(output)):
        raise RuntimeError('PPTX integrity evidence is failed, incomplete or stale')
    return _sha256_file(path)


def write_build_state(
    project: Path, status: str, branches: dict | None = None, *, run_id: str | None = None,
    skill_sha256: str | None = None,
) -> Path:
    run_id = _normalize_run_id(run_id)
    if status == 'pending_visual_review':
        raise RuntimeError('visual review removed; rebuild or reassemble with this version')
    if status == "success" and (not run_id or not skill_sha256):
        raise RuntimeError(f"build status {status!r} requires non-empty run_id and skill_sha256")
    path = project / "reports" / "build_state.json"
    if branches is None and path.is_file():
        try:
            previous = json.loads(path.read_text(encoding="utf-8"))
            if previous.get("run_id") == run_id:
                branches = previous.get("branches") or {}
                skill_sha256 = skill_sha256 or previous.get("skill_sha256")
        except (OSError, json.JSONDecodeError, TypeError):
            pass
    payload = {
        "version": 2, "run_id": run_id, "status": status, "branches": branches or {},
        "visual_mode": "off",
        "delivery_policy": json.loads((project/'reports/runs'/str(run_id)/'workflow_contract.json').read_text(encoding='utf-8')).get('delivery_policy','strict')
            if (project/'reports/runs'/str(run_id)/'workflow_contract.json').exists() else 'strict',
        "blueprint_sha256": _sha256_file(project / "reports/blueprint.json")
        if (project / "reports/blueprint.json").is_file() else None,
        "authoring_sha256": _authoring_sha256(project),
        "skill_sha256": skill_sha256,
        "updated_at_unix": round(time.time(), 3),
    }
    atomic_write_json(path, payload)
    _archive_run_report(project, run_id, "build_state.json", payload)
    return path


def write_release_manifest(
    project: Path, output: Path, status: str, *, run_id: str | None = None,
    skill_sha256: str | None = None,
) -> Path:
    """Bind release status to the exact blueprint, authoring set, and PPTX bytes."""
    blueprint = project / "reports" / "blueprint.json"
    qa_path = project / "reports" / "qa_gate.json"
    run_id = _normalize_run_id(run_id)
    if status == "success" and (not run_id or not skill_sha256):
        raise RuntimeError(f"release status {status!r} requires non-empty run_id and skill_sha256")
    if status == 'pending_visual_review':
        raise RuntimeError('visual review removed; rebuild or reassemble with this version')
    qa_hash = None
    defect_map_hash = None
    contract_path = project / 'reports/runs' / str(run_id) / 'workflow_contract.json'
    integrity_hash = None
    asset_path = project / 'reports/asset_preflight.json'
    asset_hash = _sha256_file(asset_path) if asset_path.exists() else None
    workflow_version = json.loads(contract_path.read_text(encoding='utf-8')).get('version', 0) if contract_path.exists() else 0
    if status == 'success' and workflow_version >= 7:
        if not asset_path.exists() or not json.loads(asset_path.read_text(encoding='utf-8')).get('complete'):
            raise RuntimeError('release requires complete consumer asset evidence')
    if status == 'success' and asset_path.exists():
        from asset_preflight import verify_assets
        asset_report = json.loads(asset_path.read_text(encoding='utf-8'))
        if asset_report.get('status') != 'success' or verify_assets(asset_report.get('assets', [])):
            raise RuntimeError('asset preflight missing/stale consumer inputs')
    if status == 'success' and (project / 'reports/handoff_receipt.json').exists():
        from import_handoff import verify_receipt
        verify_receipt(project)
    if status == "success" and not qa_path.is_file():
        raise RuntimeError("release requires the active-run QA report")
    if status == "success" and qa_path.is_file():
        try:
            qa = json.loads(qa_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, TypeError) as exc:
            raise RuntimeError("release requires a valid QA report") from exc
        provenance = qa.get("provenance") or {}
        if not provenance:
            raise RuntimeError('structural release requires QA provenance')
        if qa.get("summary", {}).get("gate_passed") is not True:
            raise RuntimeError("release requires a passing QA report")
        if provenance:
            if provenance.get("run_id") != run_id:
                raise RuntimeError("QA report run_id does not match the release run")
            if blueprint.is_file() and provenance.get("blueprint_sha256") != _sha256_file(blueprint):
                raise RuntimeError("QA report is stale for the current blueprint")
            if provenance.get("authoring_sha256") != _authoring_sha256(project):
                raise RuntimeError("QA report is stale for the current authoring files")
            expected_defect_hash = provenance.get("defect_map_sha256")
            if expected_defect_hash:
                defect_path = project / "reports" / "runs" / str(run_id) / "defect_map.json"
                if not defect_path.is_file() or _sha256_file(defect_path) != expected_defect_hash:
                    raise RuntimeError("QA defect map is missing or stale")
                open_blocking = [
                    item for item in load_open_defects(project, str(run_id))
                    if item.get("severity") == "blocking"
                ]
                if open_blocking:
                    raise RuntimeError(
                        f"release has {len(open_blocking)} open blocking defects"
                    )
                defect_map_hash = expected_defect_hash
        qa_hash = _sha256_file(qa_path)
    if status == 'success':
        require_structural_workflow(project, run_id)
        integrity_hash = integrity_evidence(project, output, str(run_id))
    payload = {
        "version": 2,
        "run_id": run_id,
        "status": status,
        "output_path": str(output.resolve()),
        "output_sha256": _sha256_file(output) if output.is_file() else None,
        "blueprint_sha256": _sha256_file(blueprint) if blueprint.is_file() else None,
        "authoring_sha256": _authoring_sha256(project),
        "skill_sha256": skill_sha256,
        "qa_gate_sha256": qa_hash,
        "defect_map_sha256": defect_map_hash,
        "visual_mode": "off",
        "visual_review_status": "not_performed",
        "workflow_contract_sha256": _sha256_file(contract_path) if contract_path.is_file() else None,
        "pptx_integrity_sha256": integrity_hash,
        "asset_preflight_sha256": asset_hash,
        "created_at_unix": round(time.time(), 3),
    }
    path = project / "reports" / "release_manifest.json"
    atomic_write_json(path, payload)
    _archive_run_report(project, run_id, "release_manifest.json", payload)
    return path


def verify_release_manifest(project: Path, output: Path) -> list[str]:
    errors: list[str] = []
    path = project / "reports" / "release_manifest.json"
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return ["release manifest is missing or invalid"]
    if manifest.get('visual_mode') != 'off':
        return ['legacy visual release; rebuild or reassemble with this version']
    if manifest.get("status") != "success":
        errors.append(f"release status is {manifest.get('status')!r}, not 'success'")
    if manifest.get('asset_preflight_sha256'):
        from asset_preflight import verify_assets
        asset_path = project / 'reports/asset_preflight.json'
        if not asset_path.exists() or _sha256_file(asset_path) != manifest['asset_preflight_sha256']:
            errors.append('asset preflight changed after release')
        else:
            errors.extend(verify_assets(json.loads(asset_path.read_text(encoding='utf-8')).get('assets', [])))
    if (project / 'reports/handoff_receipt.json').exists():
        try:
            from import_handoff import verify_receipt
            verify_receipt(project)
        except (ValueError, OSError) as exc:
            errors.append('source receipt invalid: ' + str(exc))
    if not manifest.get("run_id"):
        errors.append("release manifest is missing required run_id")
    if not manifest.get("skill_sha256"):
        errors.append("release manifest is missing required skill_sha256")
    if not output.is_file():
        errors.append("release output file is missing")
    elif manifest.get("output_sha256") != _sha256_file(output):
        errors.append("output hash does not match release manifest")
    blueprint = project / "reports" / "blueprint.json"
    if not blueprint.is_file() or manifest.get("blueprint_sha256") != _sha256_file(blueprint):
        errors.append("blueprint hash does not match release manifest")
    if manifest.get("authoring_sha256") != _authoring_sha256(project):
        errors.append("authoring hash does not match release manifest")
    qa_path = project / "reports" / "qa_gate.json"
    if manifest.get("qa_gate_sha256") and (
        not qa_path.is_file() or manifest.get("qa_gate_sha256") != _sha256_file(qa_path)
    ):
        errors.append("QA report hash does not match release manifest")
    run_id = manifest.get("run_id")
    if manifest.get("defect_map_sha256"):
        defect_path = project / "reports" / "runs" / str(run_id) / "defect_map.json"
        if (
            not defect_path.is_file()
            or manifest.get("defect_map_sha256") != _sha256_file(defect_path)
        ):
            errors.append("defect map changed after release gating")
        else:
            open_blocking = [
                item for item in load_open_defects(project, str(run_id))
                if item.get("severity") == "blocking"
            ]
            if open_blocking:
                errors.append("release defect map contains open blocking defects")
    if not manifest.get("qa_gate_sha256"):
        errors.append("release manifest is missing required QA evidence")
    try:
        require_structural_workflow(project, run_id)
    except RuntimeError as exc:
        errors.append(str(exc))
    contract_path = project / 'reports/runs' / str(run_id) / 'workflow_contract.json'
    if manifest.get('workflow_contract_sha256') and (not contract_path.is_file() or
            manifest['workflow_contract_sha256'] != _sha256_file(contract_path)):
        errors.append('workflow contract changed after release')
    if contract_path.exists() and json.loads(contract_path.read_text(encoding='utf-8')).get('version', 0) >= 7:
        if not manifest.get('asset_preflight_sha256'):
            errors.append('release is missing required consumer asset evidence')
    try:
        build_state = json.loads((project / "reports/build_state.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        errors.append("unified build state is missing or invalid")
    else:
        if build_state.get("status") != "success":
            errors.append(f"unified build status is {build_state.get('status')!r}, not 'success'")
        if build_state.get("run_id") != manifest.get("run_id"):
            errors.append("build state run_id does not match release manifest run_id")
        if build_state.get("skill_sha256") != manifest.get("skill_sha256"):
            errors.append("skill hash does not match across the release provenance chain")
        if build_state.get('visual_mode') != 'off':
            errors.append('build visual mode does not match workflow contract')
        frozen_skill_hash = manifest.get("skill_sha256")
        if frozen_skill_hash and _skill_sha256(Path(__file__).resolve().parents[1]) != frozen_skill_hash:
            errors.append("current skill files do not match the version used by the release")
    if not manifest.get('workflow_contract_sha256') or manifest.get('visual_review_status') != 'not_performed':
        errors.append('structural release must explicitly declare no visual acceptance')
    try:
        if manifest.get('pptx_integrity_sha256') != integrity_evidence(project, output, str(run_id)):
            errors.append('PPTX integrity evidence changed after release')
    except RuntimeError as exc:
        errors.append(str(exc))
    return errors


def publish_release(project: Path, output: Path, destination: Path) -> Path:
    """Serialize publication against managed builds and copy approved bytes only."""
    from ppt import lock_project
    with lock_project(project):
        return _publish_release_locked(project,output,destination)


def _publish_release_locked(project: Path, output: Path, destination: Path) -> Path:
    from delivery import read, verify_working_delivery
    manifest = read(project / 'reports/release_manifest.json')
    working = manifest.get('status') == 'needs_attention'
    verifier = verify_working_delivery if working else verify_release_manifest
    errors = verifier(project, output)
    if errors:
        raise RuntimeError("output is not releasable: " + "; ".join(errors))
    approved = read(project/'reports/runs'/manifest['run_id']/'delivery_manifest.json') if working else manifest
    approved_hash = approved.get('output_sha256')
    if output.resolve() == destination.resolve():
        raise ValueError("release destination must differ from the build output")
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".tmp", dir=str(destination.parent),
    )
    os.close(fd)
    temporary = Path(temporary_name)
    try:
        shutil.copy2(output, temporary)
        if _sha256_file(temporary) != approved_hash:
            raise RuntimeError("published copy hash differs from the approved output")
        errors = verifier(project, temporary)
        if errors:
            raise RuntimeError('publication evidence changed: '+'; '.join(errors))
        os.replace(temporary, destination)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    manifest = json.loads((project / "reports/release_manifest.json").read_text(encoding="utf-8"))
    payload = {
        "version": 1,
        "status": "needs_attention" if working else "success",
        "run_id": manifest.get("run_id"),
        "source_path": str(output.resolve()),
        "destination_path": str(destination.resolve()),
        "source_sha256": approved_hash,
        "destination_sha256": _sha256_file(destination),
        "published_at_unix": round(time.time(), 3),
    }
    receipt = project / "reports" / "delivery_receipt.json"
    atomic_write_json(receipt, payload)
    _archive_run_report(project, manifest.get("run_id"), "delivery_receipt.json", payload)
    return receipt


def run_parallel_branches(tasks: dict[str, Callable[[], int]]) -> dict[str, dict]:
    """Run independent branches together and return measured, fail-closed results."""
    if not tasks:
        return {}

    def timed(name: str, task: Callable[[], int]) -> tuple[str, dict]:
        started = time.time()
        try:
            code = int(task())
            return name, {
                "returncode": code,
                "status": "success" if code == 0 else "failed",
                "duration_s": round(time.time() - started, 3),
            }
        except Exception as exc:  # noqa: BLE001
            return name, {
                "returncode": 1, "status": "failed",
                "duration_s": round(time.time() - started, 3), "error": str(exc),
            }

    results: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=len(tasks)) as executor:
        futures = {executor.submit(timed, name, task): name for name, task in tasks.items()}
        for future in as_completed(futures):
            name, result = future.result()
            results[name] = result
    return results


def write_performance_summary(
    project: Path, *, started: float, finished: float,
    orchestration: dict[str, dict], status: str, run_id: str | None = None,
) -> Path:
    run_id = _normalize_run_id(run_id)
    stages: dict[str, dict] = {}
    stage_history: dict[str, list[dict]] = {}
    ignored_stale_stages: list[str] = []
    stage_dir = project / "reports" / "performance_stages"
    if stage_dir.exists():
        for path in sorted(stage_dir.glob("*.json")):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError, TypeError):
                continue
            stage_name = str(payload.get("stage") or path.stem)
            if run_id is not None and payload.get("run_id") != run_id:
                ignored_stale_stages.append(stage_name)
                continue
            stages[stage_name] = payload
    event_dir = project / "reports" / "runs" / str(run_id) / "performance_events"
    if run_id and event_dir.exists():
        for path in sorted(event_dir.glob("*.json")):
            try:
                event = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError, TypeError):
                continue
            stage_history.setdefault(str(event.get("stage") or "unknown"), []).append(event)
    output = project / "reports" / "performance.json"
    additive = ('duration_s', 'generated', 'model_calls', 'first_pass_model_calls',
                'recovery_model_calls', 'patch_calls', 'patch_successes', 'failures')
    stage_totals = {name: {key: round(sum(float(event.get(key) or 0) for event in events), 3)
                          for key in additive if any(key in event for event in events)}
                    for name, events in stage_history.items()}
    payload = {
        "version": 2,
        "run_id": run_id,
        "status": status,
        "total_duration_s": round(max(0.0, finished - started), 3),
        "critical_parallel_branch_s": round(max(
            (float(orchestration.get(name, {}).get("duration_s", 0)) for name in ("images", "render")),
            default=0.0,
        ), 3),
        "orchestration": orchestration,
        "stages": stages,
        "stage_history": stage_history,
        "stage_totals": stage_totals,
        "stage_totals_note": "Additive event work, not wall-clock critical path; cache events do not erase generation.",
        "ignored_stale_stages": sorted(ignored_stale_stages),
    }
    atomic_write_json(output, payload)
    _archive_run_report(project, run_id, "performance.json", payload)
    return output


def _run_command(name: str, command: list[str], run_id: str | None = None) -> int:
    print(f"[{name}] {' '.join(command)}", flush=True)
    environment = os.environ.copy()
    if run_id:
        environment["PPT_BUILD_RUN_ID"] = run_id
    if name == 'render':
        environment['PPT_DEPENDENCY_QUEUE'] = '1'
        environment['PPT_ASSET_GENERATION_ID'] = f'{run_id}:full'
    return subprocess.run(command, check=False, env=environment).returncode


def select_pilot_page_numbers(blueprint: dict, limit: int) -> list[int]:
    """Choose a small deterministic cross-section of layout families and densities."""
    pages = list(blueprint.get("pages") or [])
    if limit <= 0 or not pages:
        return []
    limit = min(limit, len(pages))
    selected: list[int] = []

    def add(page: dict) -> None:
        number = int(page.get("no") or 0)
        if number > 0 and number not in selected and len(selected) < limit:
            selected.append(number)

    add(pages[0])
    if limit > 1:
        densest = max(
            pages,
            key=visible_page_character_count,
        )
        add(densest)
    def risks(page):
        layout = page.get("layout") or {}
        features = {"role:" + str(page.get("role")), "density:" + str(layout.get("density")),
                    "complexity:" + str(page.get("complexity"))}
        features.update("block:" + str(b.get("type")) for b in layout.get("blocks", []))
        images = page.get("images") or []
        features.update("crop:" + str(i.get("crop")) for i in images)
        features.update("image:" + str(i.get("role")) for i in images)
        if len(images) > 1:
            features.add("multi-image")
        if int(page.get("no", 0)) > len(pages) // 2:
            features.add("second-half")
        return features
    covered = set().union(*(risks(p) for p in pages if int(p.get("no", 0)) in selected))
    while len(selected) < limit:
        candidates = [p for p in pages if int(p.get("no", 0)) not in selected]
        if not candidates:
            break
        winner = max(candidates, key=lambda p: (len(risks(p) - covered), visible_page_character_count(p)))
        add(winner)
        covered.update(risks(winner))
    if len(selected) < limit:
        add(pages[-1])
    for page in pages:
        add(page)
    return selected


def build_gate_commands(
    project: Path, output: Path, expected_slides: int,
    scripts: Path, lark_scripts: Path, run_id: str | None = None,
) -> list[tuple[str, list[str]]]:
    """Return fail-fast gates; SML/provenance QA precedes PPTX conversion."""
    gates = [
        ("lint_brief", [sys.executable, str(scripts / "lint_brief.py"), "--project", str(project)]),
        ("qa_gate", [
            sys.executable, str(scripts / "qa_gate.py"), "--project", str(project),
            "--require-render-provenance",
        ]),
        ("convert", [
            sys.executable, str(lark_scripts / "sml_to_pptx.py"),
            "--input", str(project / "authoring"), "--assets", str(project / "assets"),
            "--output", str(output),
        ]),
    ]
    gates.append(('pptx_integrity', [sys.executable, str(scripts / 'pptx_integrity.py'),
        '--input', str(output), '--expected-slides', str(expected_slides),
        '--run-id', str(run_id), '--report', str(project / 'reports/runs' / str(run_id) / 'pptx_integrity.json')]))
    return gates


def run_pipeline(
    project: Path, output: Path, expected_slides: int, *,
    image_workers: int = 4, render_workers: int = 4,
    max_retries: int = 2, force: bool = False, pilot_pages: int = 5,
    run_id: str | None = None,
    repair_pages: str | None = None, extra_calls: int = 0, approval_id: str | None = None,
    delivery_policy: str = 'best-effort',
) -> int:
    skill_root = Path(__file__).resolve().parents[1]
    scripts = skill_root / "scripts"
    lark_scripts = skill_root / "lark" / "scripts"
    started = time.time()
    run_id = _normalize_run_id(run_id) or _new_run_id()
    if delivery_policy not in {'best-effort','strict'}:
        raise ValueError('invalid delivery policy')
    from final_repair import recover_pending_transaction
    recover_pending_transaction(project, output)
    _claim_run_id(project, run_id)
    atomic_write_json(project / 'reports/runs' / run_id / 'workflow_contract.json',
                      {'version': 9, 'visual_mode': 'off', 'delivery_policy': delivery_policy})
    skill_hash = _skill_sha256(skill_root)
    output.parent.mkdir(parents=True, exist_ok=True)
    write_build_state(project, "running", run_id=run_id, skill_sha256=skill_hash)
    write_release_manifest(project, output, "building", run_id=run_id, skill_sha256=skill_hash)

    image_command = [
        sys.executable, str(scripts / "gen_images.py"), "--project", str(project),
        "--workers", str(image_workers),
    ]
    if delivery_policy == 'best-effort':
        image_command.append('--allow-partial-assets')
    render_command = [
        sys.executable, str(scripts / "sol_render.py"), "--project", str(project),
        "--workers", str(render_workers), "--max-retries", str(max_retries),
    ]
    if force:
        image_command.append("--overwrite")
        render_command.append("--force")
    if repair_pages:
        if force:
            raise ValueError('scoped recovery cannot force rerender validated pages')
        render_command += ['--repair-pages', repair_pages]
        if extra_calls:
            if not approval_id:
                raise ValueError('extra-calls requires approval-id')
            render_command += ['--extra-calls', str(extra_calls), '--approval-id', approval_id]
    blueprint = json.loads((project / "reports/blueprint.json").read_text(encoding="utf-8"))
    from plan_request import verify_plan_request
    verify_plan_request(project)
    from blueprint_validation import static_findings
    brief = json.loads((project / 'reports/brief.json').read_text(encoding='utf-8')) if (project / 'reports/brief.json').exists() else {}
    findings = static_findings(blueprint, brief)
    atomic_write_json(project / 'reports/runs' / run_id / 'blueprint_preflight.json', {
        'status': 'failed' if findings else 'success', 'errors': findings,
        'blueprint_sha256': _sha256_file(project / 'reports/blueprint.json'),
    })
    if findings:
        from defect_map import sync_stage_defects
        sync_stage_defects(project, run_id, 'blueprint_preflight', findings)
        write_build_state(project, 'failed', {'blueprint_preflight': 'failed'}, run_id=run_id, skill_sha256=skill_hash)
        write_release_manifest(project, output, 'failed', run_id=run_id, skill_sha256=skill_hash)
        return 1
    from font_policy import preflight_contract
    font_errors = preflight_contract((blueprint.get('theme', {}).get('render_contract') or {}).get('fonts'))
    if font_errors:
        atomic_write_json(project / 'reports/runs' / run_id / 'font_preflight.json', {'status':'failed','errors':font_errors})
        write_build_state(project, 'failed', {'fonts':'failed'}, run_id=run_id, skill_sha256=skill_hash)
        write_release_manifest(project, output, 'failed', run_id=run_id, skill_sha256=skill_hash)
        return 1
    from asset_preflight import preflight_project
    asset_report = preflight_project(project)
    from asset_preflight import partial_asset_errors
    if asset_report['errors'] and not (delivery_policy == 'best-effort' and partial_asset_errors(asset_report)):
        write_build_state(project, 'failed', {'images': 'failed'}, run_id=run_id, skill_sha256=skill_hash)
        write_release_manifest(project, output, 'failed', run_id=run_id, skill_sha256=skill_hash)
        return 1
    pilot_numbers = [] if repair_pages else select_pilot_page_numbers(blueprint, pilot_pages)
    pilot_command = [
        *render_command,
        "--pages", ",".join(str(number) for number in pilot_numbers),
        "--stage-name", "pilot_render",
        "--first-pass-only",
    ]

    def timed_command(name: str, command: list[str]) -> dict:
        task_started = time.time()
        try:
            code = int(_run_command(name, command, run_id=run_id))
            return {
                "returncode": code,
                "status": "success" if code == 0 else "failed",
                "duration_s": round(time.time() - task_started, 3),
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "returncode": 1, "status": "failed",
                "duration_s": round(time.time() - task_started, 3), "error": str(exc),
            }

    orchestration: dict[str, dict] = {}

    def working_delivery(findings=None):
        if delivery_policy != 'best-effort':
            return False
        try:
            _assert_skill_unchanged(skill_root,skill_hash)
            from delivery import export_best_effort
            # Expand src-scoped failures to every consumer, including copies on
            # other pages. Never render an untracked/conflicting input as valid.
            asset_findings = []
            for error in asset_report['errors']:
                consumers = [p['no'] for p in blueprint['pages'] if any(
                    i.get('src') == error.get('src') for i in p.get('images',[]))]
                asset_findings.extend(dict(error,page_no=n) for n in (consumers or [error.get('page_no')]))
            result = export_best_effort(project,output,run_id=run_id,extra_findings=(findings or [])+asset_findings)
            # Full-count initial export already exists. One independent closing
            # opportunity never changes the ordinary page retry allowance.
            if not repair_pages:
                from final_repair import repair_before_delivery
                result = repair_before_delivery(project, output, run_id=run_id, initial=result,
                    workers=render_workers, extra_findings=(findings or [])+asset_findings)
                final_report = json.loads((project/'reports/runs'/run_id/'final_repair.json').read_text(encoding='utf-8'))
                orchestration['final_repair'] = {'returncode': 0, 'status': final_report['status'],
                    'calls': final_report['calls'], 'duration_s': final_report['duration_s'],
                    'applied_pages': final_report['applied_pages']}
            orchestration['working_delivery'] = {'returncode':0,'status':'needs_attention',
                'attention_pages':result['attention_pages']}
            write_build_state(project,'needs_attention',
                {name:item.get('status') for name,item in orchestration.items()},run_id=run_id,skill_sha256=skill_hash)
            write_performance_summary(project,started=started,finished=time.time(),
                orchestration=orchestration,status='needs_attention',run_id=run_id)
            return True
        except Exception as exc:
            orchestration['working_delivery'] = {'returncode':1,'status':'failed','error':str(exc)}
            return False

    with ThreadPoolExecutor(max_workers=2) as executor:
        from dependency_queue import write_asset_stage
        # Limit speculative image work to pilot assets. Remaining images are
        # submitted only after the pilot has demonstrated contract compatibility.
        initial_images = [*image_command, "--pages", ",".join(map(str, pilot_numbers))] if pilot_numbers else image_command
        image_phase = 'pilot' if pilot_numbers else 'full'
        write_asset_stage(project, run_id, image_phase, 'running')
        image_future = executor.submit(timed_command, "images", initial_images)
        orchestration["images"] = image_future.result()
        write_asset_stage(project, run_id, image_phase, orchestration['images']['status'], orchestration['images'])
        if pilot_numbers:
            orchestration["pilot_render"] = (
                timed_command("pilot_render", pilot_command)
                if orchestration["images"].get("returncode") == 0
                else {"returncode": 1, "status": "blocked", "duration_s": 0}
            )
            calibration_path = project / 'reports/runs' / run_id / 'pilot_calibration.json'
            calibration = json.loads(calibration_path.read_text(encoding='utf-8')) if calibration_path.exists() else {}
            if (orchestration['pilot_render'].get('returncode') == 1
                    and calibration.get('run_id') == run_id and calibration.get('first_pass_only')
                    and calibration.get('can_continue')):
                orchestration['pilot_render'].update(status='repairs_deferred',
                    first_pass_returncode=1, returncode=0,
                    deferred_pages=calibration.get('deferred_pages', []))
        write_build_state(project, "running", {
            name: result.get("status") for name, result in orchestration.items()
        }, run_id=run_id, skill_sha256=skill_hash)
        if not pilot_numbers or orchestration["pilot_render"].get("returncode") == 0 or delivery_policy == 'best-effort':
            # A bad representative PAGE does not block unrelated pages. Cached
            # successes and persisted per-page caps prevent duplicate pilot work.
            if pilot_numbers and (orchestration['images'].get('returncode') == 0 or delivery_policy == 'best-effort'):
                write_asset_stage(project, run_id, 'full', 'running')
            render_future = executor.submit(timed_command, "render", render_command)
            if pilot_numbers and (orchestration["images"].get("returncode") == 0 or delivery_policy == 'best-effort'):
                orchestration["images"] = timed_command("images", image_command)
                write_asset_stage(project, run_id, 'full', orchestration['images']['status'], orchestration['images'])
        else:
            render_future = None
        if render_future is not None:
            orchestration["render"] = render_future.result()
    if all(item.get('returncode') == 0 for item in orchestration.values()):
        from asset_preflight import finalize_assets
        try:
            finalize_assets(project)
        except Exception as exc:
            orchestration['images'] = {'returncode': 1, 'status': 'failed',
                                       'error': 'asset_consumer_error: ' + str(exc)}
    if any(item.get("returncode") != 0 for item in orchestration.values()):
        if working_delivery():
            return 0  # Valid file produced; build status remains needs_attention.
        write_performance_summary(
            project, started=started, finished=time.time(),
            orchestration=orchestration, status="failed", run_id=run_id,
        )
        write_release_manifest(project, output, "failed", run_id=run_id, skill_sha256=skill_hash)
        write_build_state(project, "failed", {
            name: result.get("status") for name, result in orchestration.items()
        }, run_id=run_id, skill_sha256=skill_hash)
        return 1

    try:
        _assert_skill_unchanged(skill_root, skill_hash)
    except RuntimeError as exc:
        orchestration["skill_integrity"] = {"returncode": 1, "status": "failed", "error": str(exc)}
        write_performance_summary(
            project, started=started, finished=time.time(), orchestration=orchestration,
            status="failed", run_id=run_id,
        )
        write_release_manifest(project, output, "failed", run_id=run_id, skill_sha256=skill_hash)
        write_build_state(project, "failed", {"skill_integrity": "failed"}, run_id=run_id, skill_sha256=skill_hash)
        return 1

    write_build_state(project, "gating", {
        name: result.get("status") for name, result in orchestration.items()
    }, run_id=run_id, skill_sha256=skill_hash)

    gates = build_gate_commands(project, output, expected_slides, scripts, lark_scripts, run_id)
    status = "success"
    for name, command in gates:
        try:
            _assert_skill_unchanged(skill_root, skill_hash)
        except RuntimeError as exc:
            orchestration["skill_integrity"] = {"returncode": 1, "status": "failed", "error": str(exc)}
            status = "failed"
            break
        gate_started = time.time()
        code = _run_command(name, command, run_id=run_id)
        if code != 0 and name == "qa_gate" and not repair_pages:
            # One bounded recovery for concrete page-level QA failures. Reuse
            # all other pages; do not mutate prompts or installed skill code.
            report_path = project / "reports" / "runs" / run_id / "qa_gate.json"
            if report_path.is_file():
                report = json.loads(report_path.read_text(encoding="utf-8"))
                issues = report.get("errors") or []
                repairable = {"font_too_small", "font_missing_cjk_coverage", "font_contract_mismatch",
                              "missing_font_family", "font_not_installed", "invalid_font_family"}
                if issues and all(e.get("page") and e.get("code") in repairable for e in issues):
                    numbers = sorted({int(e["page"]) for e in issues})
                    repair_command = [*render_command, "--pages", ",".join(map(str, numbers))]
                    if _run_command("qa_page_repair", repair_command, run_id=run_id) == 0:
                        code = _run_command(name, command, run_id=run_id)
        orchestration[name] = {
            "returncode": code, "status": "success" if code == 0 else "failed",
            "duration_s": round(time.time() - gate_started, 3),
        }
        if code != 0:
            status = "failed"
            break
    if status == 'failed' and name in {'qa_gate','convert','pptx_integrity'}:
        from delivery import read
        qa = read(project/'reports/runs'/run_id/'qa_gate.json')
        provenance = qa.get('provenance') or {}
        current = (provenance.get('run_id') == run_id
                   and provenance.get('blueprint_sha256') == _sha256_file(project/'reports/blueprint.json')
                   and provenance.get('authoring_sha256') == _authoring_sha256(project))
        issues = qa.get('errors',[]) if current else [{'code':name+'_execution_failed','message':'No current-run QA evidence; strict gate did not complete'}]
        if working_delivery(issues):
            return 0
    write_performance_summary(
        project, started=started, finished=time.time(),
        orchestration=orchestration, status=status, run_id=run_id,
    )
    try:
        write_release_manifest(
            project, output, status,
            run_id=run_id, skill_sha256=skill_hash,
        )
    except (RuntimeError, ValueError) as exc:
        status = "failed"
        orchestration["release_manifest"] = {
            "returncode": 1, "status": "failed", "error": str(exc),
        }
        write_release_manifest(project, output, "failed", run_id=run_id, skill_sha256=skill_hash)
        write_performance_summary(
            project, started=started, finished=time.time(), orchestration=orchestration,
            status="failed", run_id=run_id,
        )
    write_build_state(project, status, {
        name: result.get("status") for name, result in orchestration.items()
    }, run_id=run_id, skill_sha256=skill_hash)
    return 0 if status == "success" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="parallel PPT build with strict quality gates")
    parser.add_argument("--project", default=".")
    parser.add_argument("--output", default=None)
    parser.add_argument("--expected-slides", type=int, default=None)
    parser.add_argument("--image-workers", type=int, default=4)
    parser.add_argument("--render-workers", type=int, default=4)
    parser.add_argument("--max-retries", type=int, default=2)
    parser.add_argument("--pilot-pages", type=int, default=5, help="representative pages to gate before full rendering")
    parser.add_argument("--run-id", default=None, help="optional immutable build run identifier")
    parser.add_argument("--force", action="store_true")
    parser.add_argument('--visual-mode', choices=['off'], help=argparse.SUPPRESS)  # old off-only commands
    parser.add_argument('--delivery-policy', choices=['best-effort','strict'],default='best-effort')
    parser.add_argument('--repair-pages')
    parser.add_argument('--extra-calls', type=int, default=0)
    parser.add_argument('--approval-id')
    args = parser.parse_args()
    project = Path(args.project).resolve()
    blueprint = json.loads((project / "reports" / "blueprint.json").read_text(encoding="utf-8"))
    expected = args.expected_slides or int(blueprint.get("page_count") or len(blueprint.get("pages", [])))
    if expected < 1:
        raise ValueError("expected slide count must be positive")
    output = Path(args.output).resolve() if args.output else project / "out.pptx"
    return run_pipeline(
        project, output, expected,
        image_workers=args.image_workers, render_workers=args.render_workers,
        max_retries=args.max_retries, force=args.force,
        pilot_pages=args.pilot_pages, run_id=args.run_id,
        repair_pages=args.repair_pages, extra_calls=args.extra_calls, approval_id=args.approval_id,
        delivery_policy=args.delivery_policy,
    )


if __name__ == "__main__":
    raise SystemExit(main())
