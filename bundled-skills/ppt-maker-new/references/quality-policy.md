# Shared graded quality policy

Use scripts/quality_policy.py in planning, lint, rendering, patch validation, QA,
defect recovery and delivery. No stage may turn a report-only finding into a blocking
repair, approval request or placeholder simply because a report is nonempty.

Findings retain code, scope/page, measurement/evidence, severity, confidence and
repair_action. Unknown codes remain blocking, even if their payload says warning.
Named low-confidence/style findings are warnings, not hidden or silently deleted.
`plan_text_capacity_risk` is also report-only: an early estimate for explicitly
sized text, consumed within an existing rendering call, never a new planning stop.

`scope` separates page problems from project dependencies. Conversion and patch
validation also partition findings. Native image frames preserve rounding and borders;
`img_round_corner_skipped` is retained only for reading historical reports, not a current fallback.
Unsupported crop semantics report `image_crop_unsupported`. Missing images, skipped data and unknown
converter findings still block. Near-fit evidence never overrides simultaneous
substantial overflow on the other axis.

Native capability declarations live in `lark/scripts/backend_capabilities.py`;
the prompt, local-PPTX lint profile and converter consume that same source. The
generic SML readback profile is not the production backend profile. Native text
rotation and all three autoFit modes preserve their requested settings; omitted
autoFit means no-auto-fit, not the library's grow-textbox default. `fill_approximated`
discloses radial-to-solid or runtime linear-fill fallback as a style warning;
shape/connector/chart type loss still blocks because it can change meaning.

Generation attribute guidance is the intersection of executable XSD scalar rules
and the backend's `GENERATION_ATTRIBUTES`, not the entire interchange schema.
Every advertised attribute includes a scalar contract; ignored image filters are
not generation options. Syntax ranges are not layout recommendations: reserve
canvas/container clearance and use readability targets (including table cells),
not advisory tolerance floors. The quick-reference table example is checked through
schema validation, native PPTX export and reopen; this is not a screenshot review.

QA copies complete lint findings, including measurements and the source SML hash.
Delivery reruns those checks for each candidate and replaces only verifiable
lint-owned historical evidence. Do not infer permission to clear untagged external
findings or source/asset failures. Candidate warnings belong to the selected bytes,
not the last candidate inspected. A successful native save/reopen is structural
compatibility evidence, not proof of visual equivalence in PowerPoint.

## Report only

Adjacent layout similarity, cross-page asset reuse frequency, large-number area,
mixed-script spacing, title orphan lines, default footer margin, decorative/background
role size estimates, mild font-size deviation, font-contract style mismatch and
unavailable glyph measurements are advisory. A short-label estimated width within
the box and legacy height-estimate excess up to 2px are uncertainty bands, not proof of
clipping. Height estimates also use relative extent and measured clearance: up to
one quarter of a line AND 10% of available box height is advisory when the linter
finds enough surrounding space for that excess. These are uncertainty heuristics,
not verified PowerPoint pixels. Missing/invalid clearance, rotated/vertical text,
crossing a container boundary or simultaneous width excess cannot gain this allowance.
These bands do not exempt content canvas overflow, text collision, missing
assets, schema failures or content loss.

Intentional background bleed uses the existing SML id prefix `decor-bleed-` and
the shared backend predicate: empty rect/round-rect/ellipse/oval, behind meaningful
content, positive finite dimensions and a visible canvas intersection. Only this
declared decoration becomes `decorative_canvas_bleed` (advisory); it is not a text
container. Low alpha alone does not qualify, nor do text/data/images/connectors or
foreground shapes. Native export preserves exact coordinates. Patches use the same
rule; local code does not move/resize anything. Text-box intersection alone is not
glyph collision: use existing estimated ink bounds, never a blanket 4px waiver.

SOL can improve isolated warnings inside an already needed call. User-specified
typography/brand/design requirements remain positive planning and rendering goals,
not merely optional validator warnings. Before images/rendering, a detected deck-level
pattern can enter the bounded design opportunity in design-quality.md: one SOL call,
at most six selected pages, keep or exact design changes, no retry or delivery gate.
Warning severity does not change. This is not a semantic verifier or screenshot review.

## Blocking

Invalid schema/finite geometry, unsafe paths, missing or corrupt assets, altered
hashes, missing required content, explicit production-note markers, substantial
estimated overflow and serious overlap remain blocking. Local dependency failures
do not consume paid model repair. Guard facts, qualifiers and source authority.
Ordinary business words such as 请确认/等待确认/点击查看 are not production notes
on their own; do not delete or relabel them locally.
Discussion of system prompts, concept names or an embedded status marker is only
weak lexical evidence. Report it, but do not buy a repair. Definite authoring tasks
remain blocked. Known internal metadata is excluded recursively from audience copy.

## Recovery and delivery

For best-effort delivery only, a larger but still bounded height estimate (up to
half a line AND 20% of box height, with enough measured clearance) may be retained
as `imperfect`. It remains blocking for strict acceptance and is listed in delivery
issues, not marked successful. Other blockers must be absent: schema, content,
asset, serious overlap or unknown errors cannot ride along with a near-fit exception.
The linter measures clearance against canvas, enclosing panels and nearby objects;
local code never enlarges the box or edits the text. This is risk-based working
delivery, not a claim that visual clipping was ruled out. Large or unmeasured risks
still use the existing recovery/placeholder path. Do not replace these conditions
with a fixed “5.5px is safe” rule.

SOL may change failed-page layout and complexity while retaining no/role/must_keep
and locked business claims. Accepted pages remain intact during defect repair.
The separate pre-production design opportunity may change accepted design fields
only, before build begins; scoped repair grants never authorize it. A design change records
the exact model values and updates its accepted checkpoint design, not its facts.

Patch movement/resize and small object-count targets are guidance, not gates.
Runtime still binds hashes/old values and schema-local fields, checks finite final
canvas bounds and full-page blockers, and leaves formal output unchanged on failure. It never invents
coordinates. At most 128 operations is a protocol resource guard, not a slide
design quota. Up to two patch rounds share the same three automatic page-repair
calls as full rerenders. No-progress compares blocking burden with measured
overflow magnitude when available; warnings contribute zero. Explicit user caps
and persistent stop history remain enforced.

An exact model patch that reduces measured blocking burden without new blocker
types/objects or worsened existing ones can be retained in an isolated working SML.
The next patch sees that candidate and its exact inventory/hashes; successful pages
and formal success caches remain untouched until full validation passes. Candidates
are checkpointed with normal page/input provenance and revalidated on resume; they
do not reset call budgets. Failed unsafe/schema/content-changing patches roll back.
Patch reason text is optional. Schema-numeric before=60.0 and before=60 are equal;
this does not grant approximate geometry or text equivalence.

For an explicitly routed `recompose` attempt, object paths may legitimately change.
Normally compare findings within each code: count, total and peak measured burden
cannot increase, and overall burden must decrease. One measured risk transition is
also progress: all prior blockers were structural collisions/container overflow,
all are removed, and only bounded height estimates remain with no increase in finding
count. Each residual must have consistent positive finite measurements, excess at
most half a line AND 20% of available height, and no simultaneous width excess.
Existing height estimates may not be worsened under this transition. Unknown,
schema/content/source/asset failures never qualify. Pixel and area units are not
added together to justify a new error class; the executable predicate is
`bounded_height_residual` in the shared policy.

This is progress for another already-bounded repair, NOT a delivery waiver. Clearance
is still required for the separate imperfect-delivery policy above. Local patches
still compare the same objects. When the latest improved recomposition matches the
current SML hash and only bounded height estimates remain, routing returns to local
repair; an old success or failed follow-up cannot reset escalation. SOL still authors
all replacement values. No allowance is renewed and no page is marked validated by
this progress test.

Container ownership is inferred, not clipping evidence by proximity alone. A real
gap cannot be bridged by adjacency padding. Rectangular edge-flush captions remain
checked; a tangent ellipse bounding box alone cannot own a ring-band label. Nested
ellipses use actual ellipse-span support at the label midline to disambiguate bands.
Standalone ellipse spills, real nested-card spills, canvas bounds and occlusion
remain checked independently. This geometry heuristic is not a visual review.

Planning density is optional; unknown complexity uses normal scheduling without
rewriting the blueprint. Required-reference order does not change membership.
Claims tolerate surrounding whitespace and a terminal Chinese full stop only;
`verbatim_fields` remain exact. No digit, qualifier or negation changes are inferred.
Revalidate matching old failed drafts before requesting another paid planning call.

Use common installed system font families, never arbitrary installed decorative
fonts. Index actual font name tables once and reuse a project cache keyed by file
path/size/mtime. Known missing fonts route to environment repair before model build;
uninspectable fonts are unknown, not confirmed absent. Common-family resolution is
an explicit technical fallback, recorded in font_preflight; it is not portable font
embedding or proof of identical layout on another machine.

Warning-only pages remain usable and retain their warnings in QA. When blocked
repair stops, managed best-effort revalidates candidates and uses an imperfect
page only when safe under this policy; otherwise it inserts a technical placeholder.
Unknown errors never automatically become safe. Missing content, source/provenance
failure and broken PPTX integrity cannot be excused as style preferences.
`next_action` means immediate delivery/dependency handling; `optional_refinement`
separately describes pages and any authorization for additional paid refinement.
The existence of the latter never requires approval just to deliver the working deck.
For ordinary best-effort builds, the initial full-count export is followed by the
adaptive pre-delivery stage described in resilient-delivery.md. Its first response
can unlock one last targeted call only with measured progress while still unusable.
Usable candidates stop immediately. Ordinary retries are unchanged; no-progress,
second-response failure and cap exhaustion retain the best available delivery and
never recursively start more stages.

Visual review is not a workflow stage. Structural acceptance with warnings is
not visual acceptance; disclose 未进行视觉验收.
