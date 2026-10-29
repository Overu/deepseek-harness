# Full-count working delivery

The default is best-effort, not all-or-nothing. Read this when a page fails rendering,
patching or quality gating. No new retry approval is needed just to finish a PPTX.

## Page lifecycle

Initial batched SOL generation → current page validation → feasible exact patch or
targeted SOL redesign → at most three automatic repair calls total → select page.
Patches and redesign share one persistent page allowance; resume does not reset it.
Two consecutive non-improving attempts stop earlier. Planning remains capacity-based
and progress-based; the three-page-repair cap is NOT a planning/deck-size cap.

Selection priority: current hash-matched validated authoring, freshly revalidated
exact model checkpoint, safe imperfect model candidate, fixed technical placeholder.
Never use an old failed checkpoint over a newer success. A provided mismatched
checkpoint hash rejects; legacy hashless checkpoints require matching semantic scope
and current validation but have weaker historic provenance. Do not claim that legacy
validation proves untouched model bytes.

The shared quality policy reports advisory findings without repairs or placeholders.
Substantial clipping, overlap, content leak, invalid schema, missing assets or unknown
blocking findings still use a placeholder, not an unreadable slide. Bounded relative
height-estimate risks with measured free space may retain exact content as imperfect
under quality-policy.md; do not mark them strict success. Full-page conversion is trialed before assembly.
Placeholders contain the original title, page number and fixed technical status only.
They do not invent business content, become accepted authoring, or consume model calls.

Original page count/order is preserved. Good pages are reused. The issue list states
which pages are imperfect/placeholders and why. Transport/asset failures stop paid
SML recovery; safe independent pages still proceed. Source authority, changed hashes,
invalid/incomplete blueprints, cancellation and broken PPTX integrity remain fatal.
This feature guarantees neither model completion nor delivery after global input,
filesystem or conversion failures.

## Pre-delivery closing round

An ordinary best-effort build first saves its complete working deck, then runs an
adaptive `final_repair` stage for residual model-fixable pages. The ordinary three-call
cap, existing gates and prior stage ordering remain unchanged. Valid/warning-only
pages and asset/font/validator failures are not paid targets. A live request for the
same page defers closing; stopped unknown ordinary requests do not. Pages without
any model draft remain placeholders; closing does not invent missing first-pass content.
The final stage uses existing validated measurements and exact model candidates;
SOL may recompose local regions while preserving required copy, facts and assets.

Each page initially gets one final call for its semantic page identity, independent
of run ID. A usable candidate is adopted without another call. If still unusable,
one additional targeted follow-up is admitted only when the first response reduces
measured defects under the shared progress policy. Local patches compare the same
objects; explicitly routed recomposition compares per-class burden and can recognize
resolved structural collisions leaving only bounded height estimates (see
quality-policy.md). This does not make that candidate safe to publish. Its prompt
uses that exact improved candidate and residual evidence, not the old request.
When only bounded estimates remain after verified recomposition, the follow-up targets
those local objects and neighbours, preserving the achieved layout rather than
automatically recomposing the whole page again.
No progress, dependency failures and schema/content regressions do not unlock it.
The stage stops after that follow-up even if it improves; no third call or renewed
ordinary allowance. Bounded parallel calls share the explicit cumulative cap.
The raw response is persisted before validation; resume replays it, not another call.
Under the project lock, managed start/resume can finish an in-flight final ledger
entry only when its matching, hash-verified saved response proves the request returned.
Altered response evidence stays blocked. Missing responses may use the separate
bounded text transport recovery in work-budget.md; saved replacement responses are
recovered through their attempt lineage. Unrelated page requests never block closing.
Offline deliver reuses validated checkpoints, not raw-only responses awaiting validation.
If transport recovery is exhausted, retain the working deck. No-progress does not start another closing round or ask the
user for approval merely to finish delivery.

Replacement SML must pass current checks for strict structural acceptance OR the
documented best-effort fit-risk class. The latter is `imperfect` with retained
findings, not a validated cache entry. Failures retain the complete initial deck;
usable content is preferred over a placeholder. Durable transaction backups recover interrupted
publication evidence before subsequent export; do not delete them or edit receipts.
Checked exact candidates remain available to normal resume and offline delivery;
both responses persist separately and are revalidated, so restart cannot rebuy them.
`reports/final_repair.json` shows calls, applied pages, deferred reasons and remaining
pages. This remains a needs_attention evidence chain, not strict release certification.
The report's calls count is this invocation's actual calls (replay is zero); cumulative
usage remains in reports/execution_budget.sqlite.

Explicit --repair-pages builds do not add a closing call on top of scoped grants.
Strict policy is unchanged. Offline `deliver` may reuse saved candidates but never
invokes SOL. Later optional paid refinement still needs its normal authorization.

## DSH commands

```bash
python3 <skill>/scripts/ppt.py start --project <project> --delivery-policy best-effort
python3 <skill>/scripts/ppt.py wait --project <project> --wait-seconds 20
```

If detached workers do not survive, use DSH's actual managed job tool around
`ppt.py execute --stage build`; do not guess native tool flags or relaunch uncertain work.
No Office conversion, screenshots, PDF or vision calls are part of quality checking.

To assemble existing current pages without any model call:

```bash
python3 <skill>/scripts/ppt.py deliver --project <project>
python3 <skill>/scripts/ppt.py status --project <project>
# Copy the returned snapshot path verbatim as <snapshot> (the new deliver run).
python3 <snapshot>/scripts/publish_release.py --project <project> --output <project>/out.pptx --destination <project>/待完善版.pptx
```

Publish verifies the frozen skill/input/SML/PPTX evidence. Managed runs freeze code;
use the SAME snapshot's publish_release.py for that run, not a newer installed version.
The compatible returned state may remain needs_attention even after all local
checks pass. Read delivery_manifest.quality and quality_message: blocking_count,
warning_count, attention_pages, whole_deck_qa and visual_checked are independent.
Each export now locally audits the actual selected deck, not old failed authoring;
the report is bound by the delivery manifest's hashes. Zero blockers plus passed
means current structure/content checks passed; warnings alone are not failure.
Legacy missing/not_rechecked evidence is unknown. Attach delivery_issues.md and say
“未进行视觉验收”. Exit 0 or needs_attention alone is not a quality verdict.
Never edit state to success, delete unresolved pages or bypass the publisher.

Optional later refinement: `ppt.py start --stage build --project <project> --repair-pages 18`.
If its persistent allowance is exhausted, obtain a real scoped authorization as in
work-budget.md. No authorization is required to keep using the delivered working deck.
`--delivery-policy strict` retains all-or-nothing publication and never auto-downgrades.
The managed deliver entry preserves an existing strict policy and refuses assembly;
switch only after explicit user consent, with `deliver --delivery-policy best-effort`.
