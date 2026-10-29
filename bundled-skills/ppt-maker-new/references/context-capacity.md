# Long-source input capacity

Use for long evidence/history ingestion, capacity errors and gateway overrides.
DSH extracts verbatim; only SOL interprets or summarizes. Originals remain archived.

## Allocation, not a character ceiling

The default text model is gpt-6.1-sol. This model-only update retains the existing
interface capacity configuration: 1,050,000 context tokens and 128,000 maximum output
tokens. These retained settings are not a new capacity benchmark or verification
of this model's current gateway limits.
Default output reserve is 128,000 and safety margin 72,000, leaving 850,000 input
tokens for the COMPLETE request. With a 50,000-token authority/instruction envelope,
800,000 tokens remain for evidence. This is calculated allowance, not a new 800K gate
and not a promise of latency, semantic recall or gateway acceptance.

Input limit = min(configured gateway max_input_tokens if any,
context_window - max(output_reserve_tokens, requested output) - safety_margin_tokens).
The actual Brief envelope, original current request, history, sources, assets and
page-preservation instructions are counted. They are not silently summarized away.
If that envelope alone cannot fit, report the actual constraint instead of paying
for repeated evidence summaries. Brief content repairs use the same capacity path;
every initial/retry/repair request gets a final check before call admission.

## Offline counting and project configuration

No network tokenizer download or extra model call is required. By default the runtime
uses UTF-8 byte count as a conservative upper bound for byte-level text tokenization,
explicitly reported as `utf8_byte_upper_bound`. This may split CJK earlier than a
matching tokenizer would. It is NOT actual token usage and must not be quoted as a bill.
For accurate local counts, configure an approved, model-matching local tokenizer.json
via `tokenizer_file` and install its `tokenizers` runtime in the DSH Python environment.
The skill neither downloads one nor claims an arbitrary tokenizer matches the gateway.
A host adapter can also supply its approved counter programmatically.

Optional `<project>/context_capacity.json` overrides the profile, for example for
a verified smaller gateway (these numbers illustrate configuration, not a claimed limit):

```json
{
  "context_window": 262144,
  "max_output_tokens": 32000,
  "output_reserve_tokens": 32000,
  "safety_margin_tokens": 16000,
  "max_input_tokens": 200000,
  "chunk_target_tokens": 100000,
  "reading_output_tokens": 16000,
  "workers": 3
}
```

Optional controls: `max_reduce_rounds` (default 4), `max_split_depth` (default 8),
`tokenizer_file` (local path, relative to project or absolute). They bound malformed
or non-converging model output, not source characters or total source-file size.
Do not change configuration while a worker is active. Resume reads it from the
project, independently of installed-skill refresh. Effective settings and counting
method are recorded in `reports/context_capacity.json`. The report distinguishes
direct, reduced, blocked_envelope and stopped; its estimates are not provider usage.

## Reading and recovery

If the complete request fits, send the raw evidence directly to Brief without an
extra reading model call. Otherwise split at paragraph boundaries where possible,
preserving every input character and order. SOL receives source IDs and offsets,
preserves facts/qualifiers/conflicts, and returns compact reading records. Complete
readings are cached under artifacts/sol_context with input/response hashes.
Reading uses a bounded rolling window: each completed slot may start the next
chunk without waiting for a slower sibling. Results are assembled in original
offset order, not completion order. Worker count and paid-call caps are unchanged;
failures/cancellation stop new work while completed receipts remain reusable.

An output truncated by length is saved but never treated as complete evidence. Only
that piece is bisected and reread; successful siblings and the truncated parent
receipt are reused on resume. Oversized aggregate readings are reduced again by SOL
if they are shrinking; no-progress stops without losing the original or successful
readings. The runtime does not assert semantic completeness from a nonempty response.

All new reading calls share the explicit cumulative project cap. There is no fixed
32-chunk source-size gate. Unknown text transport results use the persistent bounded
recovery in work-budget.md, not manual duplicate-cost approval or SQLite edits. Saved responses can be
reconciled and reused after interruption without new paid calls. Pre-v2 unbound text
caches are retained, not silently certified or overwritten. Budget/cancel/no-progress
stops do not authorize a new project or extra paid retries.

Larger requests can cost more or be slower; this change removes unnecessary forced
reading calls but does not guarantee that a maximum-sized request is fastest.
Gateway payload limits, timeouts and pricing remain deployment-specific and require
separate confirmation. This revision includes offline capacity tests, not a paid
800K-token gateway benchmark.
