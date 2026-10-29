# Brief: one contract, durable targeted recovery

`scripts/brief_contract.py` owns authority statuses, confirmation requirements,
eligible references, field findings and allowed repair paths. Initial and repair
prompts use those definitions; planning reference eligibility imports the same sets.
User-provided facts belong in must_keep/optional with sources. They need no synthetic
approval. With no historical user turns, an accepted decision is invalid; current
explicit requirements can be active_requirement. A pure fact Brief can have no decisions.
This is not permission to relabel all accepted decisions locally.

Complete JSON that fails validation is saved in reports/brief_checkpoint.json before
repair. All findings are collected once; SOL returns exact JSON updates to allowed
paths. Valid facts, source IDs, narrative and unrelated fields remain locked. Local
code validates on a copy and persists only valid or strictly improving candidates.
Invalid/empty/overbroad patches do not overwrite prior work. Metadata repairs send
the draft, relevant context and source inventory, not the full material again.
Missing/content fields also receive original material. No local summary or design.

Ordinary continuation uses the same topic/input and managed stage:

```bash
python3 <skill>/scripts/ppt.py start --stage brief --project <project> --topic "原主题"
```

Use DSH native managed jobs around `execute` instead of `start` if that client kills
detached workers. First check status; never duplicate a live local request. Stopped
unknown text outcomes use the bounded recovery in work-budget.md without risk approval.
Matching drafts bypass initial generation and revalidate free of charge. Changing
prompt wording or --force does not reset the input-bound execution ledger.
Two non-improving attempts stop; improving repairs can continue under the explicit
project cap. A complete cached Brief needs no call. Truncation separately permits
one output-capacity retry; transport replacements are accounted separately from it.

Read reports/brief_recovery.json: errors, reason, next_action, checkpoint and run_id.
After no_progress, only actual user authorization enables an additional attempt:

```bash
python3 <skill>/scripts/ppt.py start --stage brief --project <project> --topic "原主题" \
  --extra-calls 1 --approval-id "真实授权消息ID"
```

Brief has no page selector. Grant requires a matching saved draft, is consumed once
and cannot override the cumulative project cap. Do not invent IDs, repeatedly ask
for approval to repair protocol errors, relabel statuses or edit installed code.
If ordinary automatic recovery fails, report exact fields and retained work.

Boundaries: old releases' unbound raw responses are evidence, not automatically
migratable checkpoints. This version does not silently seed a new checkpoint from
them, buy a new initial response, or clear old budgets. It reports
inspect_legacy_brief_provenance. An isolated replay is a test, not production migration.
Local checks verify references/structure, not whether a user's words semantically
approve a decision. SOL interprets that; genuine ambiguity remains a user choice.
Metadata recovery is not arbitrary content reclassification: it does not migrate
facts found only in decision_ledger to must_keep. Unsupported business claims or
missing evidence must not be fabricated to make a field validate.
