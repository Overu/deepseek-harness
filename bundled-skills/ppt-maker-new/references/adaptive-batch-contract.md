# Adaptive Batch Contract

Read this reference when planning or rendering more than 18 pages, diagnosing high model-call counts, recovering a partial batch, or applying a local SML correction.

## Responsibility boundary

The model owns narrative, copy, blocks, layout, geometry, typography, crop, image choice, z-order, and exact repair values. Local code may only schedule calls, parse complete records without loss, validate contracts, apply exact whitelisted operations transactionally, and roll back.

Local code must not choose or rewrite layout IDs, blocks, coordinates, text, assets, colors, font sizes, crop, or reading order. Missing/unknown scheduling labels use `normal` scheduling; an existing label is not rewritten. Density is optional guidance. Read-only geometry risk can reduce batch capacity without changing design fields. Font family resolution is a recorded common-system-font technical fallback, not permission to alter copy or layout.

## Planning calls

Scheduling is capacity-based in scripts/ppt_contract.py; see work-budget.md.
At default 32000 output tokens, <=60 pages normally use 1–3 calls, while 200 pages
use a separate compact global-outline call plus 10 detail batches. Reducing output
capacity increases batch count instead of removing necessary work.

For 50 pages, initial NDJSON contains deck, outline and pages 1–17; the next batches
expand 18–34 and 35–50. Large decks separate outline and details. Complete records
survive truncated tails. Invalid global outline is not guessed locally.

Only unresolved pages enter capacity-sized repair batches. Repairs are not a fixed
fourth/final call: validated progress permits more, persistent no-progress stops.
Checkpoint accepted pages after each batch; resume targets failures only.

Character count alone does not make an outline infeasible and never unlocks its
title/takeaway. Preserve natural, complete copy; adjust layout for readability.
Only explicit user length requirements apply to their stated scope, not historical
role-based character targets. A production-note
finding unlocks only the contaminated title/takeaway field. The request lists
`editable_claim_fields`; clean companion fields stay locked.
Role/must_keep stay locked to the authoritative outline, not to a contradictory
failed draft. `outline_restorations` explicitly lists current/expected values;
SOL may set exactly the expected role/title/takeaway/must_keep_ids for those fields.
Arbitrary changes remain rejected; local code never invents a restoration.
SOL may revise failed-page layout_id and complexity. Output-token capacity diagnostics are
stored before expansion. All page-producing prompts embed the same JSON contract
from scripts/plan_repair.py, including valid reused/generated image objects.

Repair includes failed drafts, per-page rejection reasons and base_sha256. Existing
drafts should return compact NDJSON records:
`{"type":"page_patch","no":6,"set":{"content":["model-authored text"]}}`.
The runtime binds the request base hash; explicit incorrect legacy echoes are rejected.
Each set field replaces its complete value. Allowed keys: content, images, layout,
complexity, source_ids, decision_ids, artifact_ids, internal_notes, plus title/takeaway only when
listed in editable_claim_fields or semantically unchanged under the restricted
terminal-Chinese-full-stop/edge-whitespace equivalence. Explicit verbatim_fields
stay exact. Additionally, a field explicitly listed in `outline_restorations`
(including role or must_keep_ids) is patchable ONLY to its exact expected value.
This is restoration of the existing authority, not unlocking it. internal_notes is a list of strings, not audience
copy; see audience-copy.md. Never strip labels locally or fabricate evidence.
In preserve-pages mode, SOL may also correct source_page_ref to the same-number
original page; the shared validator enforces its source identity and page order.
No alias conversion is performed by local code. Candidate patches must pass the full
page contract and locked-field validation before selection. Missing drafts or existing
failed drafts without a sufficient legal patch may return full page_blueprint records
subject to the SAME outline locks; successful pages may never be targeted by defect repair. Duplicate
records, stale hashes, wrong targets and forbidden keys are rejected. Unresolved
drafts/accepted pages/errors are retained in reports/plan_checkpoint.json; immutable
repair request evidence is in reports/plan_repairs and reports/request_journal.

## First-pass rendering

After a valid complete plan, the independent bounded pre-production design opportunity
may keep or refine accepted design fields before assets/rendering start; see
design-quality.md. It is not a failed-page repair and does not reset repair history.
Rendering receives compact neighboring design-sequence metadata plus selected-page
visual_intent, not neighboring business copy. Neither metadata belongs on the slide.

The blueprint model assigns `simple|normal|complex` scheduling metadata. The renderer visits selected pages in blueprint order and groups them without changing their design:

- simple: 9 pages per model call;
- normal: 5 pages per model call;
- complex: 3 pages per model call.

From v5.4.1, blocks declaring >=96px font size, nonzero rotation or explicit clip
use complex scheduling even if their model-authored label is simple. This only
reduces batch size; it never changes the blueprint, design or page repair allowance.
See semantic-contract.md for the shared decoration and transaction rules.

For mixed complexity, a batch's capacity is the smallest limit among its included pages. Before adding a page, the scheduler calculates that candidate minimum and closes the current batch if the new count would exceed it. Non-contiguous pilot selections are first restored to blueprint order and follow the same rule. The default pilot contains at most five pages so an all-normal pilot fits one call; its validated pages are cache hits in the full pass.

Pilot selects pages by risk features rather than unique layout IDs, and materializes
their assets first. Managed pilot uses `--first-pass-only`: save/validate every draft,
record `pilot_calibration.json`, defer paid per-page repairs to the full pass under
the same persistent budgets. Current-run measured codes guide subsequent prompts.
Recoverable page defects may continue in strict mode; transport/asset/internal failures
do not count as successful calibration. Strict final quality gates remain mandatory.
Best-effort can continue unrelated pages after pilot failure as before.
Completed batches are saved and validated immediately, while
repair calls remain postponed until first-pass completion.

v5 admits first-pass batches only when current-run asset-ready hash records match.
Each generated image is cached immediately, not after the entire image pool exits.
No-image batches may overtake blocked batches; blueprint order inside each batch is
preserved. Only the matching full producer's terminal state ends waiting; pilot/running
states cannot prematurely fail the queue. Failed dependencies stop only their pages;
ready siblings are salvaged into ready-only batches without changing page identities.
Planning has input-scoped persistent budgets and exact-response reuse across restart.
Output-token default is 32000, not a claim about context capacity. --force does not
grant more calls. DSH context uses references/dsh-handoff.md rather than local parsing.

Each response uses independent slide frames with the exact page blueprint hash:

```text
<<<SLIDE page="18" blueprint_hash="...">>>
<slide ...>...</slide>
<<<END_SLIDE page="18">>>
```

A wrong page number, duplicate page, wrong blueprint hash, incomplete frame, invalid XML, or failed page gate is rejected independently. Complete siblings are retained. All first-pass batches finish before repair begins.

The default CLI mode is `adaptive-batch`:

```bash
python3 <skill>/scripts/sol_render.py \
  --project <project> \
  --mode adaptive-batch \
  --workers 4
```

Use `--mode direct` only for non-releasable diagnosis. Even targeted single-page
production repair uses adaptive-batch and the ordinary provenance chain.

## Defect map and repair

The current run stores `reports/runs/<run_id>/defect_map.json`. Findings carry page, stage, severity, stable evidence hash, status, and the safety lane `patch|full_rerender|block`.

When a complete SML draft has only local layout/style defects, the model receives the current SML, page blueprint, defect evidence, immutable hashes, and a stable element inventory. It returns either an exact patch envelope or `full_rerender`.

Allowed patch operations are:

- `set_geometry`
- `set_text_layout`
- `set_style`
- `set_crop`
- `set_z_order`

The final transaction must match run ID, page number, base SML hash, page-blueprint
hash, text/asset-preservation hashes, object ID, stable path, fingerprint and old values.
SOL returns page_no and operations with object_id and exact before/after values.
Runtime binds the immutable envelope and target identity from that request inventory;
explicit wrong echoes reject, never auto-correct. This avoids asking SOL to transcribe
long hashes. Each operation supplies exact new values; local code never calculates replacements.

Operation names are not universal attribute permissions. Each inventory node carries
allowed_operations and schema-derived scalar constraints. Only those node-local fields
are offered and accepted; crop operations target crop, not img/shape. Style width
cannot bypass shape geometry limits. Missing legal operations require SOL redesign.
Asset-consumer and validator-internal exceptions stop paid recovery immediately.

The executor applies the full patch to a temporary in-memory copy, enforces limits from `ppt_contract.py`, runs the complete page validator, verifies unchanged text and assets, and atomically commits only when all blocking checks pass. Warnings are returned, not escalated. Runtime binds the active run ID and requested defect IDs. Otherwise the authoring page is untouched. A safe improving model-authored candidate may survive in isolated working/checkpoint storage for the next repair, never in the successful cache; see quality-policy.md. reason is optional; numeric scalar old values use exact numerical equality, not tolerance.

Patch requests use at most two local rounds inside the shared three-call page cap.
Substantial text-capacity conflict bypasses the patch lane; a rejected/non-improving
patch routes the next admitted call to full SOL recomposition instead of another
micro-adjustment. Persisted chronological strategy evidence also reaches resumed
and closing repair. Improving patches can retain their remaining local opportunity.
Recomposition changes arrangement, not source claims, qualifiers or required assets;
local routing never computes replacement geometry or grants a new call. Five objects,
eight operations and 32px/20% are advisory, not acceptance limits.
Transactions have a 128-operation protocol resource safeguard.
before/after key sets must match, including before=null for newly added attributes.
Inventory includes canvas-intersected ranges, coupled x+w/y+h bounds and integer
z-order indexes. A legal move combined with a legal resize must still fit the canvas.
Text and asset preservation count repeated occurrences but ignore drawing order;
legal z-order changes therefore preserve content. Fractional/boolean indexes reject.
Values outside schema or final canvas bounds reject, never clamp. Missing pages,
structure/read-order/content problems or unsafe patches may go to SOL full-page
rerender only with remaining page allowance and without a no-progress stop. Assets
and transport failures never trigger paid SML repair. Otherwise select working output.

Recovery starts only after every first-pass batch completes. Different failed pages use bounded concurrency; operations for the same page are serialized so hashes and rollback preconditions cannot race.

Patch rejection reasons are included in the next request. Non-object JSON is a
bounded protocol rejection, not a process crash. Strict rerenders receive the failed
draft and current findings on their first request. Final failed-page findings replace
the first-pass open set, preserving resolved entries as history.

## Release evidence

QA mirrors current findings into the same run-scoped defect map. Strict/success
publication refuses stale maps and open blocking defects. Best-effort needs_attention
uses a separate evidence chain and disclosed imperfect/placeholder pages instead.
All runs record visual_review_status=not_performed. Visual review is removed;
release uses structural, provenance and PPTX integrity evidence only.

Adaptive rendering shares the persistent work-based ledger. Patches and strict
rerenders use one page identity and at most three automatic repair calls after initial
generation. Two consecutive non-improving results stop earlier across runs. An explicit
project cap is never raised automatically. Cached first-pass responses are revalidated
without a provider request. A denied admission is not a model call.
Best exact failed drafts are checkpointed by semantic page identity and revalidated
before a resume, avoiding a new initial batch. Official scoped render grants and
their strict total-call semantics are documented in work-budget.md.
Numeric area and reuse frequency are advisory; size alone cannot schedule repair.

Failed/diagnostic outputs cannot be promoted to strict success by standalone conversion,
QA or copying. Managed best-effort instead uses a distinct hash-bound needs_attention
manifest, complete page slots and disclosed limitations. See resilient-delivery.md.
The legacy direct renderer is explicitly tagged `legacy_direct_diagnostic`; provenance-aware QA accepts only `adaptive_batch_v1`.
