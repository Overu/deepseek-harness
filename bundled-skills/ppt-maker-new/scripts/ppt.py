#!/usr/bin/env python3
"""DSH managed stage runner: frozen inputs, lock, status, cancellation and bounded resume."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import uuid
import threading
import hashlib
from stage_runtime import atomic_write_json, skill_sha256
from platform_runtime import (acquire_lock, process_identity, process_alive,
                              spawn_options, bind_child, stop_child, child_environment,
                              configure_console, ADAPTER_VERSION)


def read_json(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def planning_progress(project):
    checkpoint = read_json(project / 'reports/plan_checkpoint.json')
    accepted = sorted(int(n) for n in checkpoint.get('accepted', {}))
    all_pages = {int(p['no']) for p in checkpoint.get('outline', {}).get('pages', [])}
    remaining = sorted(all_pages - set(accepted))
    result = {'planned_pages': len(accepted), 'planned_page_numbers': accepted,
              'unresolved_plan_pages': remaining}
    if remaining:
        stop = read_json(project / 'reports/budget_stop.json')
        if stop.get('scope') == checkpoint.get('scope'):
            result['budget_stop'] = stop
    return result


def render_progress(project, run_id):
    run = project / 'reports/runs' / str(run_id)
    fragments = set()
    validated = set()
    execution_rows = []
    for path in (run / 'render_batches').rglob('*.json'):
        row = read_json(path)
        fragments.update(row.get('complete_fragments', []))
        execution_rows.append(row)
    execution = {'metric_revision':'submission-aware-v2',
                 'model_submissions':sum(r.get('submission_count',int(r.get('submitted') is True)) for r in execution_rows),
                 'legacy_batches_without_submission_evidence':sum('submitted' not in r for r in execution_rows)}
    for key,predicate in {
        'submitted_pages': lambda r:r.get('submitted') is True,
        'responded_pages': lambda r:r.get('responded') is True,
        'replayed_pages': lambda r:r.get('response_cache_hit') is True,
        'dependency_blocked_pages': lambda r:r.get('execution_state')=='dependency_blocked',
        'budget_denied_pages': lambda r:r.get('execution_state')=='budget_denied',
        'queued_pages': lambda r:r.get('execution_state')=='queued',
    }.items():
        execution[key]=sorted({n for r in execution_rows if predicate(r) for n in r.get('pages',[])})
    for path in (run / 'render_attempts').glob('slide-*-cache.json'):
        cache = read_json(path)
        output = project / 'authoring' / path.name.replace('-cache.json', '.xml')
        if cache.get('validated') is True and cache.get('run_id') == run_id and output.is_file():
            if hashlib.sha256(output.read_bytes()).hexdigest() == cache.get('output_sha256'):
                validated.add(int(path.name.split('-')[1]))
    fragments.update(validated)
    receipt = read_json(project / 'reports/delivery_receipt.json')
    delivery = read_json(run/'delivery_manifest.json')
    available = 0
    attention = []
    if delivery.get('run_id') == run_id and delivery.get('output_path'):
        output = Path(delivery['output_path'])
        if output.is_file() and hashlib.sha256(output.read_bytes()).hexdigest() == delivery.get('output_sha256'):
            available = delivery.get('page_count',0)
            attention = delivery.get('attention_pages',[])
            validated = {r['page_no'] for r in delivery.get('pages',[]) if r['status']=='validated'}
    delivered = 0
    if receipt.get('run_id') == run_id and receipt.get('destination_path'):
        destination = Path(receipt['destination_path'])
        if destination.is_file() and hashlib.sha256(destination.read_bytes()).hexdigest() == receipt.get('destination_sha256'):
            delivered = available or len(validated)
    return {'complete_fragment_pages': len(fragments), 'validated_pages': len(validated),
            'render_execution':execution,
            'validated_page_numbers': sorted(validated), 'delivered_pages': delivered,
            'available_pages':available,'attention_page_numbers':attention,
            'delivery_quality':delivery.get('quality') if available else None,
            'quality_message':delivery.get('quality_message') if available else None}


def next_action(build):
    branches = build.get('branches') or {}
    if build.get('status') == 'needs_attention':
        return 'publish_working_deck'
    if branches.get('blueprint_preflight') == 'failed':
        return 'needs_plan_repair'
    if branches.get('fonts') == 'failed':
        return 'repair_environment'
    if build.get('status') == 'success':
        return 'publish'
    if build.get('status') == 'pending_visual_review' or branches.get('pixel_gate') == 'failed':
        return 'resume'  # legacy run: obtain fresh structural evidence
    if branches.get('images') == 'failed':
        return 'repair_assets'
    if branches.get('render') == 'failed' or branches.get('pilot_render') == 'failed':
        return 'inspect_then_scoped_render_repair'
    if branches.get('qa_gate') == 'failed' or branches.get('lint_brief') == 'failed':
        return 'inspect_contract'
    return 'inspect_then_resume'


def capabilities():
    return {'delivery_policies':['best-effort','strict'], 'default_delivery_policy':'best-effort',
            'automatic_page_repairs':3,'scoped_render_repair':True,'scoped_brief_repair':True,
            'offline_delivery_action':'deliver','condition_wait_action':'wait',
            'planning_extra':True,'planning_resume_inherits_request':True,'adopt_plan_action':'adopt-plan',
            'user_revision_action':'revise','revision_stage':'revise',
            'new_project_action':'init','request_reconciliation_action':'reconcile',
            'offline_asset_recovery_action':'recover-assets','pilot_repairs_deferred':True,
            'generated_image_lineage':True,'unknown_outcome_acknowledgement':True,
            'terminal_statuses':['success','needs_attention','failed','aborted','interrupted'],
            'native_job_command':'ppt.py execute --stage brief|plan|build|revise',
            'visual_review_supported':False}


def get_status(project):
    from work_budget import summary
    state = read_json(project/'reports/dsh_status.json')
    if state.get('status') != 'running' and (state.get('status') == 'pending_visual_review'
            or state.get('next_action') in {'review', 'record_review', 'inspect_visual'}):
        # Display migration advice without rewriting historical evidence. The
        # uncertain-request guard below still takes precedence over resuming.
        state['next_action'] = 'resume'
    if state.get('stage') == 'plan': state.update(planning_progress(project))
    if state.get('run_id'): state.update(render_progress(project,state['run_id']))
    state['call_budget'] = summary(project)
    state['restart_safe'] = state.get('status') not in {'running','aborted'}
    if state.get('status') == 'running':
        try:
            handle = lock_project(project)
        except RuntimeError:
            state['owner_state'] = 'lock_held'
        else:
            handle.close()
            age = max(0,time.time()-float(state.get('updated_at') or state.get('started_at') or 0))
            state['heartbeat_age_s'] = round(age,2)
            if age <= 10:
                state['owner_state'] = 'owner_lost_suspected'
                state['next_action'] = 'wait_and_reconcile_request'
            else:
                state['status'] = 'interrupted'
                state['owner_state'] = 'owner_lost'
                state['restart_safe'] = state['call_budget'].get('in_flight',0) == 0
                state['next_action'] = 'inspect_unknown_request' if not state['restart_safe'] else 'inspect_then_resume'
    state['capabilities'] = capabilities()
    if state['call_budget'].get('in_flight',0):
        state['restart_safe'] = False
        if state.get('status') != 'running':
            state['next_action'] = 'inspect_unknown_request'
    return state


def wait_for_status(project, timeout=20):
    if not 0 <= timeout <= 60:
        raise ValueError('wait timeout must be between 0 and 60 seconds')
    deadline = time.monotonic()+timeout
    while True:
        state = get_status(project)
        if state.get('status') != 'running':
            return state
        remaining = deadline-time.monotonic()
        if remaining <= 0:
            return dict(state,wait_timed_out=True)
        time.sleep(min(.5,remaining))


def request_cancel(project):
    state = read_json(project / 'reports/dsh_status.json')
    if state.get('status') != 'running':
        raise RuntimeError('no running task to cancel')
    run_id = state['run_id']
    if Path(run_id).name != run_id:
        raise RuntimeError('invalid run identity')
    atomic_write_json(project / 'reports/cancel' / (run_id + '.json'), {'requested_at': time.time()})
    return {'run_id': run_id, 'status': 'cancel_requested'}


def initialize_project(project):
    """Explicit new-task intent; never clear an existing project to make room."""
    handle=lock_project(project)
    try:
        occupied=[str(p.relative_to(project)) for name in ('assets','authoring','.ppt-runtime','artifacts')
                  if (p:=project/name).exists() and (not p.is_dir() or any(p.iterdir()))]
        occupied += [str(p.relative_to(project)) for name in ('blueprint.json','build_state.json',
            'handoff_receipt.json','brief.json','dsh_status.json','project_identity.json')
            if (p:=project/'reports'/name).exists()]
        if occupied:
            raise ValueError('new_project_conflict: use a separate directory for a new task; resume existing work explicitly: '+', '.join(occupied))
        identity={'project_id':uuid.uuid4().hex,'created':time.time()}
        atomic_write_json(project/'reports/project_identity.json',identity)
        return identity
    finally:handle.close()


def ensure_reconciliation_idle(project):
    state=read_json(project/'reports/dsh_status.json')
    for field in ('child_pid','pid'):
        pid=state.get(field)
        if not pid or int(pid)==os.getpid():
            continue
        if process_alive(pid) is False:
            continue
        identity=state.get(field+'_identity')
        current=process_identity(pid)
        if identity and current and identity != current:
            continue  # Same number, different OS process; never signal it.
        if not identity and state.get('status') in {'success','failed','aborted','needs_attention'}:
            # Terminal legacy owners released their project lock. A bare old PID
            # cannot establish ownership; unknown model requests still block below.
            continue
        raise RuntimeError('local worker may still be active; wait/cancel before reconciliation')


def start_managed(project, workers, call_budget, stage='build', topic=None, pages=None,
                  repair_pages=None, extra_calls=0, approval_id=None, preserve_source=None, delivery_policy=None,
                  extra=None, replace_plan=False, instruction=None):
    if stage not in {'brief', 'plan', 'build', 'revise'}:
        raise ValueError('unsupported stage; visual review has been removed')
    # The worker owns the lock and process group. Never use shell nohup/pipelines.
    # Check for a live owner before dispatch; the worker repeats the atomic lock.
    handle = lock_project(project)
    try:
        ensure_reconciliation_idle(project)
        from request_journal import reconcile_all
        reconcile_all(project)
    finally:
        handle.close()
    previous = read_json(project / 'reports/dsh_status.json')
    from work_budget import summary as budget_summary
    budget_state = budget_summary(project)
    if budget_state.get('in_flight',0):
        raise RuntimeError('request outcome uncertain; inspect retained request before restart')
    if previous.get('status') == 'running' and not get_status(project).get('restart_safe'):
        raise RuntimeError('request may still be active; use wait/status before restart')
    action = ('resume' if (project / 'reports/build_state.json').exists() or previous.get('stage') == 'build' else 'build') if stage == 'build' else 'execute'
    token = uuid.uuid4().hex
    log_path = project / 'reports' / ('launcher-' + token + '.log')
    command = [sys.executable, '-u', str(Path(__file__).resolve()), action,
               '--project', str(project), '--workers', str(workers), '--stage', stage]
    if topic is not None: command += ['--topic', topic]
    if extra is not None:
        from stage_runtime import atomic_write_text
        extra_path = project/'reports'/('launcher-'+token+'-requirements.txt')
        atomic_write_text(extra_path, extra)
        command += ['--extra-file', str(extra_path)]
    if replace_plan: command += ['--replace-plan']
    if instruction is not None:
        from stage_runtime import atomic_write_text
        instruction_path=project/'reports'/('launcher-'+token+'-revision.txt')
        atomic_write_text(instruction_path,instruction)
        command += ['--instruction-file',str(instruction_path)]
    if delivery_policy is not None:
        command += ['--delivery-policy',delivery_policy]
    if pages is not None:
        command += ['--pages', str(pages)]
    if call_budget is not None:
        command += ['--call-budget', str(call_budget)]
    if repair_pages:
        command += ['--repair-pages', repair_pages]
    if extra_calls:
        command += ['--extra-calls', str(extra_calls), '--approval-id', approval_id]
    if preserve_source:
        command += ['--preserve-source', preserve_source]
    with log_path.open('ab') as log:
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log,
                                 stderr=subprocess.STDOUT, env=child_environment(), **spawn_options())
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        state = read_json(project / 'reports/dsh_status.json')
        if state.get('pid') == child.pid and state.get('run_id') != previous.get('run_id'):
            threading.Thread(target=child.wait, daemon=True).start()
            return dict(state, launcher_log=str(log_path), managed=True)
        if child.poll() is not None:
            raise RuntimeError('worker failed to start; inspect ' + str(log_path))
        time.sleep(0.05)
    threading.Thread(target=child.wait, daemon=True).start()
    raise RuntimeError('worker startup uncertain; use status before retry; log=' + str(log_path))


def lock_project(project):
    return acquire_lock(project / 'reports/dsh.lock')


def freeze_skill(root, destination):
    destination.mkdir(parents=True, exist_ok=False)
    for name in ('SKILL.md', 'scripts', 'lark', 'references', 'contracts', 'VERSION', 'requirements.txt'):
        source = root / name
        if source.is_dir():
            shutil.copytree(source, destination / name,
                            ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        elif source.is_file():
            shutil.copy2(source, destination / name)
    return destination


def run(project, action, workers=4, call_budget=None, stage='build', topic=None, pages=None,
        repair_pages=None, extra_calls=0, approval_id=None, preserve_source=None, delivery_policy=None,
        extra=None, replace_plan=False, instruction=None):
    if stage not in {'brief', 'plan', 'build', 'revise'}:
        raise ValueError('unsupported stage; visual review has been removed')
    if action == 'deliver' and (stage != 'build' or repair_pages or extra_calls):
        raise ValueError('deliver is offline build assembly; no stage override or repair calls')
    handle = lock_project(project)
    status_path = project / 'reports/dsh_status.json'
    previous = read_json(status_path)
    try:
        ensure_reconciliation_idle(project)
        from request_journal import reconcile_all
        reconcile_all(project)
    except Exception:
        handle.close()
        raise
    from work_budget import summary as budget_summary
    budget_state = budget_summary(project)
    if action != 'deliver' and budget_state.get('in_flight',0):
        handle.close()
        raise RuntimeError('request outcome uncertain; inspect retained request before restart')
    # Do not race a recently alive owner whose process is hidden by the host.
    if previous.get('status') == 'running':
        from work_budget import summary as budget_summary
        fresh = time.time()-float(previous.get('updated_at') or previous.get('started_at') or 0) <= 10
        if fresh or (action != 'deliver' and budget_summary(project).get('in_flight',0)):
            handle.close()
            raise RuntimeError('request outcome uncertain; reconcile active request before restart')
    prior_build = read_json(project / 'reports/build_state.json')
    delivery_policy = delivery_policy or prior_build.get('delivery_policy') or 'best-effort'
    has_build_history = (project / 'reports/build_state.json').exists() or previous.get('stage', 'build') == 'build' and bool(previous)
    if has_build_history and previous.get('status') in ('failed', 'aborted', 'interrupted', 'running') and action == 'build':
        handle.close()
        raise RuntimeError('existing incomplete run; use resume to preserve completed pages')
    if action == 'build' and has_build_history:
        handle.close()
        raise RuntimeError('project already has build history; use resume')
    run_id = time.strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex[:10]
    root = Path(__file__).resolve().parents[1]
    runtime = project / '.ppt-runtime' / run_id
    try:
        if stage == 'plan':
            from plan_request import resolve_request
            request = resolve_request(project, topic, pages, extra, replace=replace_plan)
            topic, pages, extra = request['topic'], request['pages'], request['extra']
        freeze_skill(root, runtime)
    except Exception:
        handle.close()
        raise
    state = {'run_id': run_id, 'parent_run_id': previous.get('run_id'),
             'status': 'running', 'stage': stage, 'pid': os.getpid(), 'pid_identity':process_identity(os.getpid()), 'started_at': time.time(),
             'snapshot': str(runtime), 'skill_sha256': skill_sha256(runtime),
             'platform':sys.platform, 'host_adapter':ADAPTER_VERSION}
    atomic_write_json(status_path, state)
    env = child_environment(PPT_BUILD_RUN_ID=run_id,
               PPT_FONT_INDEX_CACHE=str(project / 'reports/font_index.json'))
    from work_budget import WorkBudget, summary
    WorkBudget(project, 'project', stage, call_limit=call_budget)
    env.pop('PPT_CALL_BUDGET_DB', None)
    env.pop('PPT_CALL_BUDGET_LIMIT', None)
    state['call_budget'] = summary(project)
    command = [sys.executable, '-u', str(runtime / 'scripts/sol_build.py'),
               '--project', str(project), '--run-id', run_id,
               '--render-workers', str(workers), '--image-workers', str(workers)]
    command += ['--delivery-policy',delivery_policy]
    if action == 'deliver':
        command = [sys.executable,'-u',str(runtime/'scripts/delivery.py'), '--project',str(project),
                   '--run-id',run_id,'--delivery-policy',delivery_policy]
    if stage == 'brief':
        command = [sys.executable, '-u', str(runtime / 'scripts/sol_brief.py'), '--project', str(project), '--topic', topic or '']
        if preserve_source:
            command += ['--preserve-source', preserve_source]
    elif stage == 'plan':
        from stage_runtime import atomic_write_text
        extra_path = project/'reports/runs'/run_id/'plan-requirements.txt'
        atomic_write_text(extra_path, extra)
        command = [sys.executable, '-u', str(runtime / 'scripts/sol_plan.py'), '--outdir', str(project),
                   '--topic', topic, '--pages', str(pages), '--plan-workers', str(workers), '--extra-file', str(extra_path)]
    elif stage == 'revise':
        from stage_runtime import atomic_write_text
        instruction_path=project/'reports/runs'/run_id/'revision-instruction.txt'
        atomic_write_text(instruction_path,instruction)
        command=[sys.executable,'-u',str(runtime/'scripts/managed_revision.py'),'--project',str(project),
                 '--run-id',run_id,'--pages',str(pages),'--instruction-file',str(instruction_path)]
    if stage in {'plan', 'build'}:
        if repair_pages:
            command += ['--repair-pages', repair_pages]
    if stage in {'brief', 'plan', 'build'}:
        if extra_calls:
            command += ['--extra-calls', str(extra_calls), '--approval-id', approval_id]
    cancelled = False
    child = None
    old_handlers = {}
    def cancel(signum, frame):
        nonlocal cancelled
        cancelled = True
        if child is not None and child.poll() is None:
            stop_child(child)
    try:
        for sig in (signal.SIGINT, signal.SIGTERM):
            old_handlers[sig] = signal.signal(sig, cancel)
        log_dir = project / 'reports/runs' / run_id
        log_dir.mkdir(parents=True, exist_ok=True)
        with (log_dir / 'console.log').open('ab', buffering=0) as log:
            child = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                                     env=env, **spawn_options())
            bind_child(child)
            state['child_pid'] = child.pid
            state['child_pid_identity'] = process_identity(child.pid)
            while child.poll() is None:
                if (project / 'reports/cancel' / (run_id + '.json')).exists() and not cancelled:
                    cancel(signal.SIGTERM, None)
                state['updated_at'] = time.time()
                state.update(render_progress(project, run_id))
                if stage == 'plan':
                    state.update(planning_progress(project))
                state['build'] = read_json(log_dir / 'build_state.json')
                state['call_budget'] = summary(project)
                atomic_write_json(status_path, state)
                print(json.dumps(state, ensure_ascii=False), flush=True)
                if cancelled:
                    try:
                        child.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        stop_child(child, force=True)
                    break
                time.sleep(2)
            code = child.wait()
        completed_build = read_json(log_dir / 'build_state.json')
        terminal = completed_build.get('status')
        if terminal not in {'success','needs_attention'}:
            terminal = 'failed'
        state['status'] = 'aborted' if cancelled else (terminal if code == 0 else 'failed')
        if stage not in {'build','revise'} and code == 0 and not cancelled:
            state['status'] = 'success'
        state['returncode'] = code
        state['finished_at'] = time.time()
        if cancelled:
            from request_journal import reconcile_all
            reconcile_all(project)
            for name in ('build_state.json', 'release_manifest.json'):
                for directory in (project / 'reports', log_dir):
                    path = directory / name
                    payload = read_json(path)
                    if payload.get('run_id') == run_id:
                        payload['status'] = 'aborted'
                        payload['updated_at_unix'] = time.time()
                        atomic_write_json(path, payload)
        state['build'] = read_json(log_dir / 'build_state.json')
        state.update(render_progress(project, run_id))
        if stage == 'plan':
            state.update(planning_progress(project))
        state['next_action'] = 'reconcile_then_resume' if cancelled else next_action(state['build'])
        if stage not in {'build','revise'}:
            state['next_action'] = ({'brief': 'plan', 'plan': 'build'}[stage]
                                    if code == 0 else 'inspect_' + stage)
        if stage == 'plan' and state.get('unresolved_plan_pages'):
            state['next_action'] = 'inspect_then_scoped_plan_repair'
        if stage == 'brief' and not cancelled:
            recovery = read_json(project / 'reports/brief_recovery.json')
            if recovery.get('run_id') == run_id:
                state['brief_recovery'] = recovery
                state['next_action'] = recovery.get('next_action', state['next_action'])
        state['call_budget'] = summary(project)
        if stage == 'build':
            recovery = read_json(project / 'reports/render_recovery.json')
            if recovery.get('run_id') == run_id:
                state['render_recovery'] = recovery
                state['optional_refinement'] = recovery.get('optional_refinement')
                if code != 0 and (state['build'].get('branches') or {}).get('render') == 'failed':
                    state['next_action'] = recovery.get('next_action', state['next_action'])
        atomic_write_json(status_path, state)
        print(json.dumps(state, ensure_ascii=False), flush=True)
        return 130 if cancelled else code
    finally:
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)
        handle.close()


def main():
    configure_console()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['doctor', 'build', 'resume', 'status', 'metrics', 'start', 'cancel', 'execute','deliver','wait','capabilities','adopt-plan','revise','reconcile','init','recover-assets'])
    parser.add_argument('--stage', choices=['build', 'brief', 'plan','revise'], default='build')
    parser.add_argument('--topic', default=None)
    parser.add_argument('--pages', help='plan: total count; revise: comma-separated target pages')
    parser.add_argument('--extra', default=None)
    parser.add_argument('--extra-file')
    parser.add_argument('--replace-plan', action='store_true', help='explicitly change persisted planning requirements')
    parser.add_argument('--instruction-file', help='revise: user-authorized changes, read losslessly')
    parser.add_argument('--project', required=True)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--visual-mode', choices=['off'], help=argparse.SUPPRESS)  # legacy off-only CLI
    parser.add_argument('--call-budget', type=int, default=None,
                        help='explicit cumulative text-attempt cap across stages; omitted means work-based admission, not a fixed page multiple')
    parser.add_argument('--delivery-policy',choices=['best-effort','strict'],default=None,
                        help='new projects default best-effort; resume preserves explicit strict policy')
    parser.add_argument('--wait-seconds',type=float,default=20)
    parser.add_argument('--repair-pages', help='plan/build: comma-separated unresolved page numbers; keeps accepted pages')
    parser.add_argument('--preserve-source', help='brief: source_id for page-preserving optimization')
    parser.add_argument('--extra-calls', type=int, default=0)
    parser.add_argument('--approval-id', help='stable explicit user approval identity')
    parser.add_argument('--acknowledge-unknown-attempt',type=int,
                        help='reconcile only: explicit user acceptance of possible duplicate billing; does not add retry allowance')
    parser.add_argument('--acknowledge-unknown-image',help='reconcile only: exact unresolved image src')
    parser.add_argument('--image-request-id',help='exact unresolved image request ID from reconcile')
    args = parser.parse_args()
    project = Path(args.project).resolve()
    if args.action=='init':
        print(json.dumps(initialize_project(project),ensure_ascii=False));return 0
    if args.action=='recover-assets':
        from import_handoff import recover_asset_sources
        result = recover_asset_sources(project)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result['status'] in {'success', 'isolated'} else 1
    if args.acknowledge_unknown_attempt is not None and (args.action!='reconcile' or not args.approval_id):
        parser.error('unknown attempt acknowledgement requires reconcile and explicit --approval-id')
    if args.acknowledge_unknown_image and (args.action!='reconcile' or not args.approval_id or not args.image_request_id):
        parser.error('unknown image acknowledgement requires reconcile, --image-request-id and --approval-id')
    if args.action=='reconcile':
        handle=lock_project(project)
        try:
            ensure_reconciliation_idle(project)
            from request_journal import reconcile_all,acknowledge_unknown
            result=reconcile_all(project)
            if args.acknowledge_unknown_attempt is not None:
                acknowledgement=acknowledge_unknown(project,args.acknowledge_unknown_attempt,args.approval_id)
                result=reconcile_all(project)
                result['acknowledgement']=acknowledgement
            if args.acknowledge_unknown_image:
                from image_lineage import acknowledge_image_unknown
                acknowledgement=acknowledge_image_unknown(project,args.acknowledge_unknown_image,args.image_request_id,args.approval_id)
                result=reconcile_all(project)
                result['image_acknowledgement']={key:acknowledgement[key] for key in ('src','request_id','status','approval_id')}
            print(json.dumps(result,ensure_ascii=False))
            return 0
        finally:handle.close()
    from plan_request import read_extra
    extra = read_extra(args.extra, args.extra_file)
    if args.action == 'revise':
        args.stage='revise'
    instruction=None
    if args.stage == 'revise':
        if not args.pages or not args.instruction_file:
            parser.error('revise requires --pages and --instruction-file')
        if args.repair_pages or args.extra_calls or extra is not None or args.replace_plan:
            parser.error('revision is a distinct user request, not repair/plan override')
        from managed_revision import targets
        args.pages=','.join(map(str,targets(args.pages)))
        instruction=Path(args.instruction_file).read_text(encoding='utf-8')
    elif args.instruction_file: parser.error('instruction-file requires revise')
    if args.pages is not None and args.stage != 'revise':
        try: args.pages = int(args.pages)
        except ValueError: parser.error('plan --pages must be a positive integer')
    if args.action == 'adopt-plan':
        from plan_request import adopt_plan
        handle = lock_project(project)
        try: print(json.dumps(adopt_plan(project, args.topic, args.pages, extra), ensure_ascii=False))
        finally: handle.close()
        return 0
    if (extra is not None or args.replace_plan) and args.stage != 'plan':
        parser.error('extra/extra-file/replace-plan require --stage plan')
    if args.action == 'capabilities':
        print(json.dumps(capabilities())); return 0
    if args.action == 'wait':
        print(json.dumps(wait_for_status(project,args.wait_seconds),ensure_ascii=False)); return 0
    if args.workers < 1:
        parser.error('workers must be positive')
    if args.call_budget is not None and args.call_budget < 1:
        parser.error('call-budget must be positive')
    if args.extra_calls < 0 or (args.extra_calls and (not args.approval_id or
            (args.stage != 'brief' and not args.repair_pages))):
        parser.error('extra-calls requires --approval-id and unresolved --repair-pages (Brief uses its saved draft)')
    if args.repair_pages and args.stage not in {'plan', 'build'}:
        parser.error('repair-pages requires stage plan or build')
    if args.preserve_source and args.stage != 'brief':
        parser.error('preserve-source requires stage brief')
    if args.stage == 'plan' and args.pages is not None and args.pages < 1:
        parser.error('plan stage requires positive --pages')
    if args.action == 'doctor':
        from runtime_doctor import diagnose
        result = diagnose(project)
        print(json.dumps(result,ensure_ascii=False))
        return 0 if result['local_ready'] and result['enterprise_proxy_ready'] and result['gateway']['supported'] else 2
    if args.action == 'status':
        state = get_status(project)
        print(json.dumps(state, ensure_ascii=False))
        return 0
    if args.action == 'metrics':
        from workflow_runtime import project_summary
        print(json.dumps(project_summary(project), ensure_ascii=False))
        return 0
    if args.action == 'start':
        print(json.dumps(start_managed(project, args.workers, args.call_budget, args.stage, args.topic, args.pages, args.repair_pages, args.extra_calls, args.approval_id, args.preserve_source,args.delivery_policy, extra, args.replace_plan, instruction), ensure_ascii=False))
        return 0
    if args.action == 'cancel':
        print(json.dumps(request_cancel(project), ensure_ascii=False))
        return 0
    return run(project, args.action, args.workers, args.call_budget, args.stage, args.topic, args.pages, args.repair_pages, args.extra_calls, args.approval_id, args.preserve_source,args.delivery_policy, extra, args.replace_plan, instruction)


if __name__ == '__main__':
    raise SystemExit(main())
