#!/usr/bin/env python3
"""Small content-addressed cache and timing helpers for PPT stages."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Callable
from platform_runtime import configure_console

configure_console()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def skill_sha256(skill_root: Path) -> str:
    """Hash executable skill inputs while ignoring generated cache files."""
    digest = hashlib.sha256()
    paths: list[Path] = []
    for name in ("SKILL.md", "scripts", "lark", "references", "contracts", "VERSION", "requirements.txt"):
        candidate = skill_root / name
        if candidate.is_file():
            paths.append(candidate)
        elif candidate.is_dir():
            paths.extend(path for path in candidate.rglob("*") if path.is_file())
    for path in sorted(paths):
        if "__pycache__" in path.parts or path.suffix in {".pyc", ".pyo"}:
            continue
        digest.update(path.relative_to(skill_root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def render_contract_sha256(skill_root: Path) -> str:
    """Hash only inputs that can change generated SML or its validation."""
    # The complete page prompt is already fingerprinted separately. This hash
    # covers only code that can change SML bytes before they are written.
    # Validator/schema changes deliberately trigger revalidation, not a model call.
    # Generated pages are revalidated on reuse. Logging, prompts and repair
    # implementation changes do not invalidate already valid model output.
    relative_inputs = ("contracts/generation_version.txt",)
    paths: list[Path] = []
    for relative in relative_inputs:
        candidate = skill_root / relative
        if candidate.is_file():
            paths.append(candidate)
        elif candidate.is_dir():
            paths.extend(path for path in candidate.rglob("*") if path.is_file())
    digest = hashlib.sha256()
    for path in sorted(paths):
        if "__pycache__" in path.parts or path.suffix in {".pyc", ".pyo"}:
            continue
        digest.update(path.relative_to(skill_root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def prompt_fingerprint(prompt: str, version: str) -> str:
    model = os.environ.get("TX_CLOUD_MODEL", "").strip()
    return sha256_text(json.dumps(
        {"version": version, "model": model, "prompt": prompt},
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ))


def atomic_write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(value)
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def atomic_write_json(path: Path, payload: Any) -> None:
    atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=2))


def load_validated_json_cache(
    output_path: Path,
    cache_path: Path,
    fingerprint: str,
    validator: Callable[[dict], None],
) -> dict | None:
    if not output_path.is_file() or not cache_path.is_file():
        return None
    try:
        raw = output_path.read_text(encoding="utf-8")
        payload = json.loads(raw)
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
        if cache.get("fingerprint") != fingerprint:
            return None
        if cache.get("output_sha256") != sha256_text(raw):
            return None
        validator(payload)
        return payload
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None


def write_json_cache(output_path: Path, cache_path: Path, fingerprint: str, payload: dict) -> None:
    raw = json.dumps(payload, ensure_ascii=False, indent=2)
    atomic_write_text(output_path, raw)
    atomic_write_json(cache_path, {
        "fingerprint": fingerprint,
        "output_sha256": sha256_text(raw),
    })


def write_stage_metric(project: Path, stage: str, started: float, **values: Any) -> None:
    run_id = str(values.pop("run_id", "") or os.environ.get("PPT_BUILD_RUN_ID", "")).strip() or None
    payload = {
        "stage": stage,
        "run_id": run_id,
        "duration_s": round(max(0.0, time.time() - started), 3),
        "finished_at_unix": round(time.time(), 3),
        **values,
    }
    atomic_write_json(project / "reports" / "performance_stages" / f"{stage}.json", payload)
    if run_id:
        atomic_write_json(
            project / "reports" / "runs" / run_id / "performance_stages" / f"{stage}.json",
            payload,
        )
        event_id = f"{time.time_ns()}-{uuid.uuid4().hex[:8]}"
        atomic_write_json(
            project / "reports" / "runs" / run_id / "performance_events" / f"{stage}-{event_id}.json",
            payload,
        )
