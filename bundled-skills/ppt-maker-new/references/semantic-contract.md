# Unified decoration and patch contract — v5.4.1

Read before rendering or diagnosing a giant-letter/section page. SOL authors every
layout change. DSH does not resize text, edit installed code or loosen a gate.

## Shared interpretation

- Lint and QA use the same extracted alpha, paint order, fonts and estimated glyph
  geometry. Overlapping empty text-frame padding alone is not a collision.
- Faint large display text before all opaque effective text stays background decoration
  even when resizing its frame removes their intersection. Estimated self-clipping
  remains advisory. Prefer adequately sized frames; this is not visual certification.
- An unbordered translucent rectangular canvas-edge wash is not a text-clipping
  container; opaque fills, rounded cards and visible borders are not wash exemptions. A remote
  panel intersecting less than half a title's width without owning its origin does
  not establish ownership. Real nearby cards and edge-flush captions retain checks.
- Card/card overlap does not apply to background washes. Actual shape-over-text
  occlusion, canvas overflow and opaque-text collision still apply. Alpha alone is
  not proof of readability; content authority, copy guards and font checks remain.
- Plan required claims as effective text, never only as faint decoration. No new
  invented SML role/clip attributes: schema-derived attributes remain authoritative.

## Prevent repeated model mistakes

Planning and rendering share DECORATION_CONTRACT in scripts/ppt_contract.py. Large
letters are a geometry risk even on a low-word-count chapter page. Independent
read-only risk scheduling uses batches of at most three for giant/rotated/clipped
blocks; it does not rewrite model complexity, layout or coordinates.

Patch inventory reports exact node-local fields, scalar constraints, feasible
coordinate intervals, coupled canvas sums and z-order indexes. before and after
must have identical keys; absent old attributes use null. A complete example is
in each patch prompt. Never clamp, round or infer missing values. Displacement
and resize percentages are advisory; schema, content and full-page blocking checks
still decide whether the exact model-authored transaction commits.
Malformed operations reject as protocol findings, not unhandled process crashes.

## Recovery and evidence

Initial generation plus at most three automatic repair calls per page is unchanged;
patch and redesign share the persistent cap. Non-progress may stop earlier. Other
pages continue; default delivery preserves all page positions with exact usable
model drafts or technical placeholders and an honest needs_attention manifest.
Among equally valid saved drafts, delivery prefers one without advisory self-clipping
over one with it. This selection reuses exact model bytes and makes no new API call.

An offline validator replay measures compatibility, not pixel quality or online
latency. Keep the installed version and frozen runs immutable. Test an upgrade in
a separate project/candidate; revalidate saved model SML through the managed entry.
Never invent a visual-review report or claim that static success proves visual safety.
