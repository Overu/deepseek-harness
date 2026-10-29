# Asset identity and interrupted requests

## New task versus resume

Use `ppt.py init --project NEW_DIRECTORY` before importing a new task. It rejects
existing build/input records and nonempty assets/authoring/runtime directories,
preserving them. It does not move, delete or adopt old content. Original input files
can live in an input directory. Do not run init again for ordinary resume.

Importer holds the project lock. An identical handoff is reused after receipt
verification. A different handoff or old project without a matching receipt raises
project_input_conflict before writes. Intentional input replacement/migration is
not automated in this candidate. Use the existing revision entry for page edits;
do not create a new project to reset usage or repair limits.

## Source/derivative separation and legacy recovery

New imports copy verified original raster bytes to `inputs/assets/<sha256>.<suffix>`.
`assets/` is output-only; it is not the authoritative input store. Copies preserve
bytes and are checked again on use. Original handoff paths/bytes remain unchanged.

For an existing imported project whose original asset was also its output target:

```bash
python3 <skill>/scripts/ppt.py recover-assets --project <project>
python3 <skill>/scripts/ppt.py resume --project <project>
```

Stop/wait for the current job first. Recovery holds the project lock, verifies the
original receipt and source hashes, snapshots bytes and writes hash-bound source
bindings before consumer preflight. It makes zero model calls and does not modify
the blueprint, accepted pages, original receipt or call ledger. Resume revalidates
accepted pages and targets remaining work; it is not a new project or fresh budget.
Recovery is source isolation, NOT permission to change inputs, adopt unknown files,
rewrite src aliases or overwrite originals. Changed sources/snapshots, missing
receipts, a live owner or unresolved calls stop recovery with evidence. Existing
budget/no-progress stops remain; use the documented genuine scoped authorization
only when needed. Do not fabricate approval or reset history.

A same-byte existing target is accepted only after consumer validation. An oversized
or invalid original occupying that target is preserved and reported, not resized in
place. This candidate cannot migrate that target automatically: ordinary revision
protects image demand and is NOT a path-migration bypass. Stop that asset/page with
the exact consumer finding; best-effort may finish unaffected pages and disclose its
placeholder, while strict still fails. Do not spend render retries on this dependency
or create another project. A separate asset-destination migration capability would
be needed for that exceptional case. Preserve legacy blueprint paths exactly.

## Generated images are not trusted by filename

Generated images require a matching prompt/requirement/theme/aspect demand hash and
output byte hash in image-cache.json. The generation cache also checks generator,
model and generation settings. Identical demand reuse is allowed; conflicting
demands sharing one src fail before image calls. Reused source assets with asset_id
remain governed by asset_preflight and their original/derivative receipts.

An untracked file is preserved and not marked ready. Inspect/register a genuinely
user-authorized source asset through the handoff instead of fabricating a receipt.
--overwrite is not an unknown-request acknowledgement and is not an automatic
conflict-recovery instruction. No blanket --force-new/--adopt exists.

Page validation, dependency readiness and QA check generated-image receipts too.
image_lineage.json makes conflicts visible; best-effort may show a disclosed
placeholder for an affected page, never silently use the unrelated image.
Matching legacy generation contracts can acquire demand receipts in the image stage
without another image call. A bare legacy file cannot be proven by its name alone.

## Offline reconciliation

After a cancelled/interrupted owner has stopped, run:

```bash
python3 <skill>/scripts/ppt.py reconcile --project <project>
```

The project lock and local process checks protect this operation. Do not kill a
PID from an old log or edit SQLite. request_reconciliation.json lists recoverable
ordinary render responses, remaining unknown text attempts, and image transactions.
Managed resume automatically invokes the same saved-response reconciliation;
cancel itself never restarts work. Existing final-repair/revision recovery remains.

Ordinary batch/full-page/patch responses are persisted before validation. Exact
saved responses are bound to their request and current page identity, revalidated
and restored without another model call. Both pending ledger entries and the
completed-before-checkpoint crash window are handled. Recovered candidates do not
automatically become a release or override newer accepted authoring.

Image transactions persist the validated temporary output hash before replacing
the final file. Resuming the IMAGE stage recovers matching response_saved output
and commits its receipt without calling the image provider. The reconcile command
lists these image transactions; it does not materialize them itself. A changed
target is preserved and reported. Paid temporary output is retained on commit failure.

## Text recovery versus unknown image transactions

No response + stopped local process does NOT prove the provider cancelled or did
not charge. Text recovery is now automatic and bounded under work-budget.md; do not
ask for duplicate-billing acknowledgement after an ordinary disconnect. The legacy
text acknowledgement command remains a diagnostic override, not a normal step.
For ambiguous submitted generated-image transactions, after inspection an explicitly accepted
unknown IMAGE request uses the image-specific acknowledgement below. Neither text
nor image usage is reset by cancellation:

```bash
python3 <skill>/scripts/ppt.py reconcile --project <project> --acknowledge-unknown-attempt <ID> --approval-id <actual-user-message-ID>
python3 <skill>/scripts/ppt.py reconcile --project <project> --acknowledge-unknown-image <src> --image-request-id <exact-request-ID> --approval-id <actual-user-message-ID>
```

These are narrowly scoped diagnostic actions, not normal text workflow steps. Never
invent approval IDs. Text acknowledgement retains the attempt and grants no new
allowance; normal project/page limits still apply. Image acknowledgement archives
the exact request and approval before permitting a later explicit resume. Temporary
filenames are attempt-unique. Neither command sends a new paid request or automatically
resumes. Saved image output should be recovered, not acknowledged as unknown.

Local preparation is recorded as `preparing`; a proven pre-dispatch cancellation or
child-launch failure is `not_submitted`. Neither is a remote unknown request. After
repairing the local dependency, an explicit resume can continue those tasks. Saved
output/cache/hash commit failures still retain recoverable authoritative evidence.
`image_transactions` is authoritative; `image_requests` is a diagnostic history copy.
Failure to write that copy emits a warning and records `history_write_errors` where
writable, without blocking generation or readiness. Metrics exposes history gaps
and incomplete coverage. Authority/ownership/hash writes are not optional. Previously
submitted/unknown records without proof of non-submission are not silently unlocked.

Limitations: no provider-side query/cancel/idempotency adapter; no exactly-once
billing guarantee. Image-generator-internal bounded retry/fallback is inherited,
not redesigned here; this change prevents blind outer-stage resubmission of an
ambiguous child result. Provider output/diagnostics are retained locally, and may
contain private URLs; do not publish logs or bundle project transactions. macOS/Linux
locking is covered; native DSH job retention and remote gateway behavior still need
real-client acceptance. Existing quality, repair allowance and structural-only checks
are unchanged.
