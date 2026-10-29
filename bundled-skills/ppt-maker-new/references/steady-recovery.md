# Consumer assets and page-preserving optimization

## Before rendering

The managed build validates the lossless source receipt and preflights all reused
assets before pilot/model work. It decodes actual image bytes and exercises the
python-pptx image consumer; filename extensions alone are not sufficient.

Oversized/unsupported images are converted in an isolated decoder subprocess to a
consumer-compatible derivative, first frame only, EXIF orientation applied, maximum
edge 4096 px. Originals are never overwritten. MPO is treated as a multi-frame source,
not ordinary JPEG. The decoder has a 250 MP ceiling and 90-second parent timeout;
Linux additionally enforces address-space/CPU limits. macOS retains finite pixel and
time bounds without assuming sandbox support for setrlimit. Above this capacity or
on corrupt data, stop that asset with asset_consumer_error and request a smaller valid
source for later refinement. Best-effort continues unrelated pages and uses placeholders
for affected pages; strict mode blocks. Source-receipt failures remain globally fatal.

reports/asset_preflight.json records original/derivative paths and hashes, technical
operation, dimensions and affected asset identity. External edits and untracked
target conflicts stop rather than overwrite. Valid derivatives are reused. Generated
images must also decode and pass the consumer before asset-ready publication.
Final release/publish verifies derivative hashes and the original handoff receipt.
This is not visual acceptance, OCR verification or permission to alter a source.

## Optimize an existing deck, page for page

Use only when the user requests preservation of the source deck's page structure.
DSH supplies the original full page text and metadata in handoff units, with positive
integer locator.slide (or locator.page), contiguous from 1. Multiple units on one
page are retained in original order. Select the actual source_id, not its filename.

```bash
python3 <skill>/scripts/ppt.py start --stage brief --project <project> --preserve-source S001
python3 <skill>/scripts/ppt.py start --stage plan --project <project> --topic "原主题" --pages 51
```

The mode is persisted in task_contract.json without rewriting current_request.
SOL writes the global Brief; source_page_contract separately carries exact original
units into SOL planning. Detail calls receive only their assigned pages' raw evidence;
SOL owns all extraction of meaning, summary, rewriting, facts and design. The local
validator checks count and each source_page_ref={source_id,page_no}; it does not
claim semantic proof that every fact is preserved. Review semantic coverage in SOL's
planning output. Any count/order change requires an explicitly different task scope.

Brief output starts at 12k–32k tokens based on input/page scale. A truncated top-level
object is rejected, never replaced with an inner JSON array. One capacity repair may
increase the limit up to 32k and request compact global output. Raw responses, finish
reason and provider usage are retained. Invalid contracts/transport errors do not
trigger this capacity retry; repeated truncation stops with evidence intact. Input
context size is not output capacity. No local summary is used to make an output fit.
Complete but invalid contracts instead use field-scoped SOL recovery described in
brief-recovery.md, not a new full generation or a capacity retry.

## Exact model patches

Every inventory target lists allowed_operations and schema-derived attribute types,
enums and bounds. Operations intersect their field allowlist with that node's XSD
attributes. Apply checks node legality and scalar values before whole-page validation.
For example, content cannot receive marginLeft, border cannot receive alpha, and
crop.type targets an existing crop child, not img. If a legal patch cannot express
the fix, SOL requests a targeted full rerender. No local attribute guessing or layout
repair. Transaction hashes, preserved text/assets and rollback rules remain in force.
