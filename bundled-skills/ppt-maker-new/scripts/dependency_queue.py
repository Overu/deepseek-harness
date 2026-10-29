"""Schedule only batches whose declared raster dependencies are materialized."""
import time
import json
import os
import hashlib
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from sol_common import resolve_asset_target


def write_asset_stage(project, run_id, phase, status, result=None):
    """One explicit producer protocol, shared with the queue consumer."""
    from stage_runtime import atomic_write_json
    if phase not in {'pilot', 'full'} or status not in {'running','success','failed','aborted'}:
        raise ValueError('invalid asset producer phase/status')
    record = dict(result or {})
    record.update(version=2, run_id=run_id, phase=phase,
                  generation_id=f'{run_id}:{phase}', status=status)
    if status == 'running':
        record.pop('returncode', None)
    elif type(record.get('returncode')) is not int:
        raise ValueError('terminal asset producer requires a real exit code')
    if status == 'success' and record['returncode'] != 0:
        raise ValueError('successful asset producer has nonzero exit code')
    atomic_write_json(project/'reports/runs'/run_id/'asset_stage.json', record)
    return record


def asset_stage_finished(project):
    run_id = os.environ.get('PPT_BUILD_RUN_ID', '')
    path = project/'reports/runs'/run_id/'asset_stage.json'
    try:
        record = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return False  # An unreadable marker is not proof of completion.
    if not isinstance(record, dict) or record.get('status') == 'running':
        return False
    expected = os.environ.get('PPT_ASSET_GENERATION_ID')
    if expected and (record.get('run_id') != run_id or record.get('phase') != 'full'
                     or record.get('generation_id') != expected):
        return False
    if record.get('run_id') and record['run_id'] != run_id:
        return False
    status = record.get('status')
    # Legacy diagnostic callers without a generation binding may read old terminal
    # records. New managed runs always require explicit matching full-stage state.
    return (type(record.get('returncode')) is int
            and (status in {'success','failed','aborted'} or status is None and not expected))


def dependency_batches(project, pages, batch_builder):
    """Do not tie currently ready pages to another page's pending assets."""
    ready_indices = set(ready_batches(project, [[page] for page in pages]))
    ready = [page for n,page in enumerate(pages) if n in ready_indices]
    waiting = [page for n,page in enumerate(pages) if n not in ready_indices]
    return batch_builder(ready) + batch_builder(waiting)


def ready_batches(project, batches):
    blueprint_path=project/'reports/blueprint.json'
    blueprint=json.loads(blueprint_path.read_text(encoding='utf-8')) if blueprint_path.exists() else None
    from image_lineage import lineage_findings
    from stage_runtime import sha256_file
    # Scope is one scan, not a persistent mtime cache. Revalidate the stamp on
    # every lookup, discard at the next scan, and retain final consumer hashes.
    hashes = {}
    def stamp(path):
        stat = path.stat()
        return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns
    def file_hash(path):
        before = stamp(path)
        if path in hashes and hashes[path][0] == before:
            return hashes[path][1]
        digest = sha256_file(path)
        if stamp(path) != before:
            raise ValueError('asset changed during readiness scan')
        hashes[path] = (before, digest)
        return digest
    try:
        asset_cache = json.loads((project/'reports/image-cache.json').read_text(encoding='utf-8')).get('assets',{})
    except (OSError, ValueError, AttributeError):
        asset_cache = {}
    def ready(image):
        target = resolve_asset_target(project / 'assets', image['src'])
        if not target.is_file():
            return False
        run_id = os.environ.get('PPT_BUILD_RUN_ID')
        if run_id and os.environ.get('PPT_DEPENDENCY_QUEUE') == '1':
            marker = project / 'reports/runs' / run_id / 'assets_ready' / (hashlib.sha256(image['src'].encode()).hexdigest() + '.json')
            if not marker.exists():
                return False
            try:
                return json.loads(marker.read_text(encoding='utf-8')).get('sha256') == file_hash(target)
            except (OSError, ValueError, AttributeError):
                return False
        return True
    return [index for index, batch in enumerate(batches)
            if (blueprint is None or not lineage_findings(project,blueprint,batch,file_hash=file_hash,asset_cache=asset_cache)) and all(ready(image)
                   for page in batch for image in page.get('images', []))]


def completed_ready_batches(project, batches, workers, run_batch, timeout=1200, microbatch_seconds=0.25):
    pending = dict(enumerate(batches, 1))
    partially_ready_since = {}
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=workers) as executor:
        active = {}
        while pending or active:
            for number, batch in list(pending.items()):
                if len(active) >= workers:
                    break
                ready_ids=set(ready_batches(project,[[p] for p in batch]))
                if ready_ids and len(ready_ids)<len(batch):
                    first=partially_ready_since.setdefault(number,time.monotonic())
                    if time.monotonic()-first >= microbatch_seconds:
                        ready=[p for i,p in enumerate(batch) if i in ready_ids]
                        unready=[p for i,p in enumerate(batch) if i not in ready_ids]
                        batches[number-1]=ready
                        pending[number]=ready
                        batches.append(unready)
                        pending[len(batches)]=unready
                        batch=ready
                    else:
                        continue
                if ready_ids and ready_batches(project, [batch]):
                    active[executor.submit(run_batch, number, batch)] = number
                    del pending[number]
            if active:
                done, _ = wait(active, timeout=0.2, return_when=FIRST_COMPLETED)
                for future in done:
                    del active[future]
                    yield future.result()
            elif pending:
                time.sleep(0.2)
            finished = asset_stage_finished(project)
            if pending and (finished or time.monotonic() - started > timeout):
                # Salvage ready image pages even if a peer in the same batch failed.
                # Preserve the original index for ready pages; append a failure-only
                # batch so the consumer's page-to-batch attribution stays exact.
                for number,batch in list(pending.items()):
                    ready_ids=set(ready_batches(project,[[p] for p in batch]))
                    if ready_ids and len(ready_ids)<len(batch):
                        ready=[p for i,p in enumerate(batch) if i in ready_ids]
                        unready=[p for i,p in enumerate(batch) if i not in ready_ids]
                        batches[number-1]=ready
                        pending[number]=ready
                        batches.append(unready)
                        pending[len(batches)]=unready
                # A stage can finish during wait() or while capacity is full.
                # Ready-but-not-yet-submitted batches must still get their turn.
                failed = [n for n,b in pending.items() if not ready_batches(project,[b])]
                for number in failed:
                    reason=('asset_dependency_finished_unready: inspect image lineage before rerender' if finished
                            else 'asset_dependency_timeout: repair assets before rerender')
                    yield number, '', 0.0, reason
                    del pending[number]
