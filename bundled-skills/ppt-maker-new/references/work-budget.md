# Work-based execution budget

Normal generation and failed-work repair have different accounting. Quality policy follows quality-policy.md independently of execution allowance. SOL owns every content/design change; local code schedules,
validates, applies exact model patches and rolls back. There is no visual-review stage.

## Normal work

Capacity currently uses 75% of per-call output tokens minus 1600 overhead, estimating
1100 tokens per detailed page; 200 pages at 32000 output tokens schedule 10 detail
batches plus one global outline. These are conservative estimates, not verified model
limits. Smaller configured output capacity creates more batches. Large global outlines
must still fit one output; malformed/truncated outlines stop instead of local fabrication.
The 1M context window does not imply a 1M-token response. Exact accepted output is cached.

Reading is chunk-scoped; Brief is input-scoped; planning details are request-scoped.
Long-source admission and recovery follow [context-capacity.md](context-capacity.md).
Context-window capacity and cumulative paid-call authorization are separate: larger
input capacity does not clear an existing call cap. Reading responses now use the
shared request journal; complete saved responses reconcile without another call,
and a transport disconnect remains outcome_unknown rather than a settled failure.
Brief saved-draft recovery and its no-page-selector grant are documented in
[brief-recovery.md](brief-recovery.md); they use the same durable execution ledger.
Missing detail groups resumed without any draft are recorded as plan_detail_resume,
distinct from repair of existing drafts. Both preserve all already accepted pages.
Plan repair uses persistent failed-page group identities independent of transport
batch size. Smaller capacity splits a historical unit without merging it back or
resetting its grants/history. Each actual request is charged once; its remaining
work covers the whole persistent unit. Group-local no-progress stops are collected
while other eligible groups continue; explicit project caps still stop paid
continuation. Unknown text outcomes use bounded transport recovery below. No incomplete plan is released. Rendering repair uses semantic
page identities. Two consecutive non-improving attempts stop; reductions in measured blocking-defect burden (count plus overflow magnitude)
allow planning continuation, not a deck-wide fourth-call cutoff. Rendering additionally
limits each page to three automatic repair calls after initial generation; patch and
full-rerender calls share that cap across resume. Changed error wording alone
does not buy unlimited calls. Transport failures use the shared bounded recovery, not blind job restarts.
Within that unchanged allowance, substantive capacity conflicts go directly to
SOL recomposition, while small geometry estimates start locally. A rejected or
non-improving patch changes the next admitted call's strategy, not its entitlement.
Matching chronological history in reports/render_strategy survives resume and is
also supplied to final_repair. Resuming an already exhausted unit does not revive it.
Unordered candidate archives never count as repeated repair attempts. This routing
does not lower validation severity or authorize local layout/content changes.
Image requests remain separate: approved asset demand, bounded concurrency, per-asset
retry/fallback and permanent-error short circuit. Text-call allowance does not approve
extra images, fees, new sources or changed content.

## Resume just page 42

The pre-production design opportunity is accounted separately as `design_refinement`:
zero calls without signals, at most one admitted call per planning scope otherwise,
up to six selected pages in that response. It shares the explicit project cap, caches
its exact result/decision, and cannot repeat on resume or use a defect-repair grant.
Failure/cap stops defer this improvement, never request approval or block the valid
plan. It cannot add/change paid image-generation demand; only reuse already planned
images or existing assets. Initial planning can select useful new imagery normally.
This is additional to normal capacity-based planning estimates, not a promise
that a 200-page deck's aesthetics are exhaustively reviewed. See design-quality.md.

First inspect status/metrics and the matching reports/plan_checkpoint.json. With
51 accepted pages and only 42 unresolved, ordinary resume repairs only 42. After a
no-progress stop, a real user authorization of exactly one additional call is:

```bash
python3 <skill>/scripts/ppt.py start --stage plan --project <project> \
  --topic "原主题" --pages 52 --repair-pages 42 \
  --extra-calls 1 --approval-id "该次用户消息的稳定ID"
```

Keep original topic/page count/Brief/style. The approval is charged once even if the
result merely improves rather than passes. Repeating its ID cannot replenish it.
Ordinary resume of a previously authorized unit consumes its remaining grant;
when all its grants are exhausted, it cannot return to automatic allowance even
if the last authorized attempt improved. Unrelated work units remain unaffected.
If the one attempt improves the page but it still fails, stop after that call; do not
silently switch back to automatic recovery. Report the saved draft and remaining errors.
Only selected unresolved pages can change; accepted pages stay locked. Missing/stale
checkpoint is a diagnostic stop, not permission to replan all pages or create a project.
Runtime binds immutable base hashes; SOL returns no/set values. Wrong supplied hashes
still fail, and validation never silently corrects content.

## Resource ceiling versus retry grant

--call-budget N is an explicit cumulative cap on admitted text attempts across stages,
including historical imports and failed/unknown calls. It is not N additional calls.
New projects have no implicit numerical total cap; already persisted caps remain.
Only explicit user approval may raise one. A scoped retry grant cannot override it.
This ledger is not token billing or a monetary/time cap; request metadata retains
provider usage where available. Before promising time/cost, inspect real provider data.

Reports: execution_budget.sqlite, plan_checkpoint.json, plan_repairs/, request_journal/,
render_responses/, budget_stop.json and ppt.py metrics. A cached response still passes
current validation; cached does not mean visually reviewed or deliverable.
Old workflow_calls/call_budget history is imported once, without deleting originals.
Old per-run partial blueprints are not automatically trusted as new checkpoints.
An actually running local request still prevents concurrent submission to the same
unit. After the owner stops, managed reconciliation recovers saved responses first;
missing responses become remote-outcome-unknown, not permanently live local work.
Ordinary text disconnects/timeouts/transient HTTP errors get at most TWO replacement
requests per persistent (scope, stage, unit), with a short delay. Both replacements
can be used on one failure; later resumes cannot reset them. The initial request and
each replacement retain separate ledger IDs/receipts and count against explicit caps.
Superseded/abandoned unknown requests do not count as layout candidates or stagnation.
Replacement lineage fences late old results; usage of missing responses remains unknown.
No duplicate-charge confirmation is required. Continuous failure defers that unit;
other pages and the separate closing stage continue. A closing unit has its own
bounded transport allowance, not a reopened ordinary quality allowance. No recursive
closing rounds. Cancellation itself never starts work; an explicit resume may recover it.
An explicit scoped repair grant funds candidate-generation opportunities. Transport
replacements do not consume another candidate opportunity, but every submission
still consumes the explicit cumulative call cap. Once transport is exhausted, a
genuine new scoped retry grant may allow a later attempt after dependency repair;
it does not reset the two transport replacements. This is optional refinement, not
required approval to finish a best-effort deck.
Permanent HTTP/auth/config failures are not automatically retried. Diagnose the
dependency; do not spend SML edits on it. The optional one-shot design opportunity
does not buy transport replacements. Corrupt saved-response evidence is not a network
retry signal. Local locks, request hashes, source checks and explicit caps remain.
`ppt.py reconcile` is offline and sends no request. No provider query/idempotency
adapter or exactly-once billing guarantee is claimed. See asset-recovery.md for the
separate generated-image policy. Never equate cancellation with a refund.

Brief, planning, targeted planning, design refinement, revision and closing repair
share the attempt-bound journal with reading/rendering. A full saved response can
be replayed against the exact prompt/settings without a new admission, then parsed
and validated normally. Recovery does not certify its contents. Unknown transport
outcomes stay unknown. Proven local adapter failures before submission are
`not_submitted`, not duplicate-billing risk; admitted attempts remain in the cap.
Legacy unbound responses are not guessed. Metrics join receipts to ledger attempt
IDs. Missing receipts/usage make coverage incomplete; known tokens are a subtotal,
not an invoice estimate. requests/ remains readable for legacy diagnostics.
Malformed JSON, identity, timing or usage fields are isolated in metrics diagnostics;
valid sibling receipts still contribute known subtotals. `invalid_receipts` means
coverage is incomplete, not zero cost. This read-only tolerance does not relax
saved-response recovery or release validation.

## Scoped rendering recovery

The ordinary best-effort full build also has a separately accounted `final_repair`
stage after its initial complete PPTX export: one initial repair per eligible failed
page, followed only on measured progress while still unusable by one targeted call.
Usable candidates need no extra polish call. The maximum is two, not a default
allocation or a renewed three-call allowance. This adaptive stage is pre-authorized
by this workflow, does not consume a scoped grant, and respects the cumulative cap.
Targets scale with actual residual pages; no targets means no calls. Resume, run ID
changes and failed results do not replenish these opportunities. Responses persist and
revalidate before reuse. Only a live request for the SAME page blocks its closing call; unrelated
unknown outcomes do not. Text transport recovery uses the bounded policy above; material dependency
failures are deferred locally. There is no recursive final round.
See resilient-delivery.md. Offline deliver and explicit --repair-pages commands do
not start it, so an explicitly granted single recovery call remains a single call.

No-progress rendering stops are durable. For one explicitly authorized additional
render/patch call on page 42:

```bash
python3 <skill>/scripts/ppt.py start --stage build --project <project> \
  --repair-pages 42 --extra-calls 1 --approval-id "该次用户消息的稳定ID"
```

`extra-calls` is TOTAL, not per page. For multiple targets it is distributed in
ascending page order, at least one per selected page; unused allocation is not moved
to another page. Each granted attempt consumes allowance even if it improves but does
not pass. No automatic continuation after the grant is spent. Reusing an approval ID
does not replenish it or authorize another scope. The project cap still applies.

Without extra-calls, ordinary recovery stops at three page repair calls or earlier
durable no-progress. Passing pages are revalidated and reused. Best exact failed
SML is reused from render_checkpoints, so a resume does not start with a fresh batch.
Unselected failed pages receive no calls. Best-effort publishes a full-count working
deck with exact imperfect pages or fixed placeholders; strict publication stays blocked.
Finishing a working deck must not depend on another user retry approval.
`render_recovery.json` reports unresolved pages, stop reasons and next action. Asset
or validator failures require local dependency repair, not more model calls.
Manual standalone direct rendering is diagnostic, outside managed production guarantees.
