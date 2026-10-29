# DSH managed runtime

New tasks start with `ppt.py init --project NEW_DIRECTORY`; normal resumes do not.
Do not mix a new handoff with an existing blueprint/assets directory. Identical
handoffs remain reusable. Read [asset-recovery.md](asset-recovery.md) for image
lineage and `ppt.py reconcile` after an interrupted/cancelled worker has stopped.
Reconciliation is offline. Subsequent managed text execution uses the bounded
transport policy in work-budget.md, without per-disconnect duplicate-cost approval.

All long stages use `ppt.py start --stage brief|plan|build|revise --project PROJECT`.
The first plan requires --pages N and accepts --topic; resumes inherit these and
extra requirements from reports/plan_request.json. Wait for status to become
terminal before advancing; a launcher response does not mean stage completion.
Native managed jobs can instead run `ppt.py execute --stage brief|plan|build|revise`.
Build/resume remain available. There is no review stage or visual repair command.

macOS/Linux use fcntl/POSIX process groups. The bundled Windows adapter uses
msvcrt byte locks, CREATE_NEW_PROCESS_GROUP and psutil creation-identity-safe
process queries/cancellation. It never uses Windows os.kill(pid, 0) as a probe.
Windows native DSH acceptance is still required; mocked API tests are not that acceptance.

Use Python 3.10+ from the same interpreter for installation and execution. On
Windows the command may be `python` or `py -3`, not `python3`; discover the actual
DSH interpreter, then use its full path. Missing dependencies are listed by doctor:
`<python> -m pip install -r <skill>/requirements.txt`. This is a setup command,
not an automatic runtime install. No Office/PDF/screenshot renderer is required.
Never print or bundle credentials.

Doctor imports dependencies, reports their versions, tests UTF-8 atomic file
replacement and lock contention in a temporary project subdirectory, and saves/
reopens a tiny PPTX. `local_ready` covers these local checks only. Font coverage,
network access and background-job retention are reported separately; a successful
local smoke check is not certification of the DSH host or final slide appearance.

This enterprise distribution routes text through the logged-in client's `ppt-text`
connection and images through `media-generator`. Doctor reports adapter support and
local proxy prerequisites without reading vendor credentials or contacting the
upstream. `server_credentials=not_checked` and `enterprise_proxy_verified=false`
remain explicit until a live integration check. Network/gateway and retention
compatibility remain client acceptance items. See [enterprise-proxy.md](enterprise-proxy.md).

Internal text/JSON and child streams use UTF-8. External handoff JSON accepts a
UTF-8 BOM; a legacy extraction helper also accepts explicit UTF-16/32 BOMs. It
does not guess GBK or silently replace undecodable source characters. Windows
user-installed fonts are searched as well as system fonts. Native chart text
uses the page/theme body family; explicit chart-title family remains respected.
Neither font resolution nor native save/reopen proves identical display on another OS.

Asset paths use portable relative names. Drive-relative paths, reserved device
names, trailing dots/spaces and case/Unicode-equivalent collisions are reported
before generation; user files are not renamed. Backslash separators resolve
consistently. Readiness hashing is deduplicated within one scan, never across
scans without rechecking; final asset/receipt hashes remain mandatory.

`ppt.py start --project PROJECT` launches a platform-separated worker and returns
after recorded startup. The worker owns the lock and freezes .ppt-runtime/run-id.
It uses build for projects without build history and resume for prior build states.
Brief/plan stage history alone is not build history. It never restarts automatically.
All new runs perform structural checks only. The removed review stage/required mode
cannot be enabled. Old off-only CLI flags remain hidden compatibility no-ops.
For a legacy pending review or pixel-gate failure, use the new installed version's
managed resume (or offline deliver for saved work). It creates a new snapshot and
fresh structural evidence, preserving the old run and its explicit delivery policy.
Do not rewrite old manifests/contracts or claim their visual checks passed.
Diagnose before invoking start again. On uncertain startup use status, not retry.

Some clients kill all descendants even after detachment. In that environment use
DSH's actual native managed-job tool to run ppt.py build/resume and retain its job ID.
Do not invent tool flags. Without verified retention, report the compatibility block;
do not repeatedly hit the 600-second foreground timeout.

Use `ppt.py capabilities --project PROJECT` to discover supported flags and terminal statuses.
`ppt.py status` reads durable state. A free lock plus a recent heartbeat means
owner_lost_suspected, not permission to restart. Running requests are in_flight,
not confirmed lost calls. Inspect retained requests before retrying an uncertain call.
`ppt.py wait --project PROJECT --wait-seconds 20` returns at terminal state or timeout
(hard maximum 60 seconds); avoid fixed long sleeps and blind start loops.
`ppt.py cancel` writes a run-specific request; the owner terminates its own child
POSIX process group or creation-bound Windows descendant tree and marks aborted.
It does not terminate the DSH host's process group/job. Never kill an old PID from a log. User cancellation
does not authorize automatic restart. Console logs: reports/runs/run-id/console.log.
The image scheduler also observes this marker before dispatch and stops refilling
its bounded queue. The built-in generator checks before each retry/fallback. Already
returned images retain their hash-bound receipts; cancellation is not a refund.
This cooperative path supplements process termination; it cannot retract a request
already sent. Custom generators must implement their own in-process cancellation.
No tail pipelines, unmanaged nohup, installed-code or snapshot hotpatching.

New worker records include OS process-start identities for owner and child. Under
the project lock, a mismatching identity means PID reuse, not a live project worker.
Legacy terminal records cannot prove ownership using an old PID alone. Remote
outcome uncertainty uses bounded text recovery, not a global restart veto; inaccessible or ambiguous
live-worker identity is not permission to kill it or force a restart.

Budget authority is reports/execution_budget.sqlite. Normal work scales with output
capacity; no default max(40,3*pages) or four-call planning stop. User-set --call-budget
is a cumulative project text-attempt cap and survives resume. Legacy ledger counts
and caps are imported once; they are not reset by upgrading. See work-budget.md.

Recovery decision order:

1. Read ppt.py status and metrics. Plan status includes planned_pages and
   unresolved_plan_pages; render status distinguishes frames, validated pages and delivery.
   `render_execution` additionally distinguishes submitted/responded/replayed pages,
   dependency-blocked pages and budget refusals. Its model_submissions counts first-pass
   adapter submissions only; use performance stage totals for repair calls as well.
   Legacy batches without submission evidence are marked unknown, never guessed.
2. For Brief, inspect brief_checkpoint.json and brief_recovery.json and follow
   brief-recovery.md; do not resubmit full source materials to fix an enum error.
   For plan, inspect plan_checkpoint.json and budget_stop.json. For build, inspect
   the current run's defect_map and actual validated page caches.
3. Useful unresolved work resumes through the same managed stage. The planner reads
   matching checkpoints rather than rewriting successful pages.
4. no_progress requires diagnosis. If the user explicitly authorizes a page-specific
   extra attempt, use the exact managed plan example in work-budget.md. Approval IDs
   are stable identities of real user authorization, not random IDs minted on retry.
5. project_resource_limit needs explicit authorization of a higher cumulative
   --call-budget N. A scoped one-call grant does not override this cap.
6. Do not clear SQLite, alter the topic or create a project to bypass a stop. Existing
   legacy partial files lacking a matching checkpoint require provenance assessment;
   this version does not claim automatic migration of every prior plan artifact.
7. Rendering supports `--stage build --repair-pages 18`; explicit additional calls use
   --extra-calls and --approval-id as in work-budget.md. The normal repair cap is three
   per page, shared across patches/redesign/resume. After stopping, finish the working
   deck without further authorization. `ppt.py deliver --project PROJECT` is offline.
   Read immediate next_action independently of optional_refinement; the latter is
not an approval prerequisite for delivery. Confirmed font dependency failures
   use repair_environment, not repeated SOL calls. Managed workers reuse the
   reports/font_index.json metadata cache; font replacement risk remains disclosed.

Default structural release becomes success after QA, conversion and integrity gating;
publish through publish_release.py and disclose 未进行视觉验收. No run waits for
screenshot review or approval to review. Feishu remains disabled. Offline tests
do not certify DSH UI survival, gateway throughput or end-to-end speed.

Default delivery policy is best-effort. Render/QA page failures can finish with
needs_attention, full page count and reports/delivery_issues.md, not status success.
Ordinary full builds save the initial working file, then automatically run their
single residual-page final_repair stage before returning. Wait for the managed job
to finish, not merely for out.pptx to appear. Inspect reports/final_repair.json; do not
duplicate the stage with an extra manual retry or approval grant. Offline deliver
only reuses saved candidates and remains network-free.
Status distinguishes available_pages, validated_pages and delivered_pages. Inspect
the current run_id and issue list before presenting the actual PPTX file (never pass
a project directory to a present-file tool). Use --delivery-policy strict only when
all-or-nothing quality is explicitly required. See resilient-delivery.md.

## Planning requirements and direct-plan adoption

```bash
python3 <skill>/scripts/ppt.py start --stage plan --project <project> --topic "主题" --pages 22 --extra-file <requirements.txt>
python3 <skill>/scripts/ppt.py start --stage plan --project <project>
```

The second command resumes the original topic/count/requirements exactly. Omitted
extra inherits; explicit `--extra ""` requests empty requirements. `--extra` and
`--extra-file` are mutually exclusive. Multiline file contents are copied into the
managed run before launch; do not rely on a temporary attachment remaining readable.
To intentionally change persisted requirements use --replace-plan with the changed
values. A pending change cannot be built against an older accepted blueprint; a
failed new plan leaves the previous accepted file in place. This is a plan change,
not a way to replenish a stopped repair allowance.

For an already-produced direct blueprint, use:

```bash
python3 <skill>/scripts/ppt.py adopt-plan --project <project>
```

This locally checks and adopts the current artifact without model calls. It does
not reconstruct absent historical instructions; original_request_verified=false
is explicit for legacy adoption. Do not rerun all planning to register a valid
artifact. Managed build still performs current preflight/source/hash checks.

User-requested edits of accepted pages use [managed-revision.md](managed-revision.md),
not --repair-pages. Use DSH's verified native job for `ppt.py revise`, or managed
`ppt.py start --stage revise`; retain the job ID, then wait in <=60s intervals.
Present the returned PPTX file path, never its project directory. Copy read-only
attachments into a writable project input area only when extraction requires writes.

## Image producer and render execution evidence

`asset_stage.json` binds run_id, phase (pilot/full), generation_id and explicit
status. A running record has no returncode. The managed render queue requires the
matching full-stage terminal record; a pilot result or running record cannot end
the wait. Receipt/hash checks still decide image readiness. Ready pages are batched
separately from waiting pages. During production, a partial batch uses a short
250ms coalescing window before submitting ready peers; it does not wait for all
images or producer termination. Splits retain page identity and capacity limits.

Batch evidence is under `reports/runs/<run>/render_batches/<invocation>/`; pilot,
full render and replay no longer overwrite each other. `metric_revision` is
submission-aware-v2. first_pass_pages remains the legacy queued-page count;
first_pass_submitted_pages and first_pass_responded_pages are separate. The pass
rate uses validated newly submitted pages / newly submitted pages, null when none
were submitted. Replays, dependency failures and admission refusals are excluded.
full_rerenders counts actual full-page calls; full_rerender_pages and
full_rerender_routes separately count pages and attempted routing. Reports count
skill adapter calls, not provider-internal retries, billed tokens or invoice cost.
Use stage_totals across pilot/render events, never sum overlapping snapshot totals.
