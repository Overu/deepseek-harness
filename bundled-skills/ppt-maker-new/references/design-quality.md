# Design quality with bounded cost

Speed comes from parallel assets, batch rendering, reuse of successful work and
targeted repairs. It must not come from replacing visual thinking with text cards.
No-image pages, series layouts and repeated brand marks can be excellent; image
count, layout count and fill ratios are not beauty scores.

## First-pass design is the main quality mechanism

SOL reads the reader's task and chooses its visual expression within normal planning:

- Compare alternatives: an aligned comparison or matrix, not unrelated prose boxes.
- Explain sequence/dependency: a flow with meaningful connections, not numbered cards
  without relationships.
- Explain quantities: a faithful native chart using supplied values. Do not invent
  numbers to obtain a chart or use a generated infographic as factual evidence.
- Convey product experience: suitable original imagery or new illustrative scenes
  when permitted. A packshot/KV is not automatically a lifestyle photograph.
- Deliver a statement or deliberate pause: typography, hierarchy and whitespace can
  lead; do not add decoration just to avoid a no-image page.

theme.render_contract should specify usable hierarchy, grid, motif, image treatment
and deck rhythm, not just adjectives such as “premium”. layout.visual_intent may
describe the page relationship/treatment in one sentence. These are internal design
directions, not body copy and not new mandatory schema fields. Use common fonts.

For image cards specify inset, edge-joined or full-background treatment in those
existing design fields. Native image contours and borders are defined in the
[image syntax](../lark/references/xml/xml-schema-quick-ref.md#img): an edge-joined
image shares the card's outer radius but has square corners at the text seam.
Inset pictures have their own region and clearance; full-background pictures use
one complete contour. The converter does not infer clipping from overlapping
objects or groups, invent crop anchors, or adjust text positions. This adds no
model stage, image quota, rounding-style gate or visual-review requirement.

## Heading hierarchy and information gain

The shared `STYLE_POLICY` in scripts/ppt_contract.py supplies heading and
deduplication guidance to outline/detail planning, targeted planning recovery,
design refinement, rendering and full-page render recovery. It is model guidance, not a
new validator. Keep this policy in one executable source.

For ordinary report pages, define a consistent heading system in the existing
typography/composition fields: primary title, subordinate optional navigation,
shared anchors and sufficient separation from the body. Title height follows its
actual wrapping; the body moves below it. Covers/dividers and explicit user
templates retain their intended design. No new required fields or fixed height.

Planning fields need not become separate visible boxes. A title may already carry
the takeaway; body evidence adds information, and a bottom conclusion is useful
only when it adds an unexpressed implication/action. Preserve distinct qualifiers,
facts and necessary chart/comparison labels when consolidating repetition.
Verbatim locks and scoped-edit permissions still apply. Evaluate these choices
inside existing SOL calls, without another review stage or automatic rejection.

For 56 pages with seven similar KVs and nearby video frames, inventory size does
not establish scene coverage. Use brand/evidence assets where appropriate and plan
useful missing scenes or native diagrams elsewhere. Conversely, a six-page report
may need no generated images. An explicit no-generation request takes precedence.

## Runtime improvement, before production

scripts/design_refinement.py looks for consecutive near-identical multi-text/card
geometries (four or more pages) and the same main visual on four or more pages.
It ignores block list order and small geometry noise (up to 0.01 in normalized
coordinates). Each run compares against its first page, so gradual drift does not
merge meaningfully different layouts indefinitely.
These thresholds select evidence for judgment, not forbidden usage counts. Table
series, single typographic statements and repeated background/brand motifs are not
automatically flagged as repeated visuals. Background/decorative images and simple
divider blocks do not exempt a repeated text/card run. Byte hashes merge known file
aliases; visually similar crops and semantic repetition with substantially different
geometries are not fully detected.

One SOL call receives the shared page contract, compact whole-deck sequence and up
to six evenly sampled affected pages with exact accepted copy. It can keep an
intentional series or return exact layout/images/complexity changes for these pages.
The main quality improvement must already happen in first-pass planning; this small
pass cannot rescue every page in a 200-page monotonous deck. It is not all-page review.

This pass cannot add or rewrite paid image-generation tasks. It may use already
planned images or existing assets. Missing useful generated scenes must be selected
in the ordinary first-pass planning prompts; those prompts no longer prefer existing
assets regardless of suitability. First-pass image demand may still cost more than a
text-only deck: concurrency bounds latency, not the total image fee.

The local executor chooses no layout, imagery, coordinates or wording. It checks
targets/allowed keys, preserves evidence identities and validates the entire candidate.
Each invalid page change is rejected independently. Valid changes update blueprint,
cache and planning checkpoint before image demand is consumed. Top-level business
copy and references cannot be patched. Common text-bearing layout props (including
text/labels/table rows/data) must reuse source-page fragments, with whitespace changes
allowed. Invalid optional rearrangements are skipped, never turned into a deck blocker.
This does not enforce a global verbatim-copy rule on normal planning/rendering or
claim a semantic equivalence proof for every possible custom props encoding.

No signal → no extra call. Keep → no image/geometry churn. Malformed output, transport
failure or an explicit cap → retain the valid plan, record deferred improvement,
continue delivery. No automatic retry or permission question. Exact results are saved
with hashes; resumes do not purchase the opportunity again. Already-started build or
render work and explicit page-repair grants skip automatic design changes.

## Reports and limits

Explicit text/text-card/card/callout blocks with flat text, font size and area receive read-only capacity
estimates using the page linter's font/wrapping helpers. Substantial estimated
space shortages appear as `plan_text_capacity_risk` and in render `layout_advice`.
Unspecified copy allocation and compound chart labels are not guessed. This is not a character budget or
pixel proof: no local content/layout changes, extra repair calls or blocking gate.
SOL can enlarge/recompose the region in its already scheduled render call while
preserving facts, numbers and qualifiers. Advice and measurements are not slide copy.

reports/design_review.json records signals, selected/changed pages, rejected changes,
reason and kept/improved/deferred/no_signals. Deferred improvements are not hidden
as “all requirements verified”. It never reports screenshot acceptance.
No Office/PDF/screenshot or external visual-model quality stage is available.
Structural checks protect correctness; they do not prove the deck looks polished.
Do not represent these checks as rendered visual acceptance.
