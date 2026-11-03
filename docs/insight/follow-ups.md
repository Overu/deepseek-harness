# Insight follow-ups

English | [中文](follow-ups.zh.md)

## Summary

P6 is closed and migration work is now at rest. This list owns later releases, bugs, verification feedback, product decisions, and check debt, with context, current decisions, and closure criteria. It is not a continuing P6 execution plan, and stage closure does not turn unobserved results into passes.

## Navigation

- [Handoff policy](#handoff-policy)
- [Update check fix delivery](#update-check-fix-delivery)
- [Plugin installation policy](#plugin-installation-policy)
- [User and platform feedback](#user-and-platform-feedback)
- [Historical checks](#historical-checks)
- [Packaging optimization](#packaging-optimization)
- [Deferred product choices](#deferred-product-choices)
- [Excluded scope](#excluded-scope)

## Handoff policy

[Delivery state](operations.md#current-delivery-state) owns the difference between source and published installers; the [closure record](history/p6-closeout.md) pins the stage-end baselines. Route later work through this table instead of accumulating unfinished migration steps. New official DSH edits or Stable publication still require the explicit authorization already required by the project rules.

| Category | Entry | Handling |
| --- | --- | --- |
| Later release | Update fix delivery, packaging optimization | Schedule separately, use a new version and its validation, and retain published artifact bytes |
| Known bug | V3 CDN, obscured necessary Windows confirmation | Retain reproduction context and closure evidence; deferral is not a fix |
| Verification feedback | User and platform feedback | Record actual reports, and handle observed problems as bugs |
| Product decision | Plugin installation policy, deferred choices | Keep approved scope until a decision permits implementation |
| Check debt | Historical checks | Reproduce and fix when touching the owning area; add no global waiver |
| Explicit exclusion | Excluded scope | Do not restore these as mandatory P6 or next-release features |

## Update check fix delivery

Version 1.0.11 completed three-platform Candidate V2 publication. Old Shell, new dual-protocol, and isolated native discovery checks passed; stage closure again verified signed V2 CDN/origin pointers at 1.0.11. This supports the old-client transition without claiming every native download, installation, or data-continuity scenario. The [1.0.11 record](history/releases/1.0.11.md) owns evidence.

| Category and goal | Context and current state | Later action and closure criteria |
| --- | --- | --- |
| Later release: deliver installation-confirmation changes | Source contains exact-target approval from the install-and-restart button, no repeated idle-task prompt, and necessary macOS confirmation in the update window; published 1.0.11 installers exclude these changes | Build a new version for Candidate and verify download, cancellation, idle-task restart, and active-task confirmation in the actual package. Source tests are not artifact acceptance; this work performs no packaging or publication |
| Bug: V3 CDN serves a stale pointer | All three origin targets are rc.2 while the public CDN is rc.1, with valid signatures. Public results have not converged after the reported configuration and refresh. Discovering 1.0.11 through V2 does not accept the V3 refresh | Check cache-rule priority for `/desktop/candidate-v3/` and refresh tasks for all three full `current.json` URLs. Verify signatures and the origin version on the fixed CDN domain, then check native discovery. No private console was accessed |

Subsequent rc releases start at 1.0.12-rc.1 or higher. Final applications check Candidate through the five-click manual action. Local signed sequences cover later V3 selection and replay rejection; actual future upgrades await real delivery. [Operations](operations.md#current-delivery-state) owns the one-time manual repair instructions for installed new DSH 1.0.10/rc.1. Stable remains 1.0.9; promotion is a separate publication decision.

## Plugin installation policy

Handoff category: product decision. The four product components require execution-layer protection. The manager currently rejects sources whose canonical package name cannot be established before installation, and local archive inspection is bounded at 10 MiB. This protects required bundles while restricting some unrelated third-party sources.

A later decision must explicitly accept the supported-source restriction or design isolated package identification without changing the current profile, preserving ordinary plugin choice while preventing required-bundle replacement. No bypass or relaxed check is approved. Retain the current protection until a complete alternative is reviewed. [Baseline changes](baseline-changes.md) owns the rationale; close this item only after the decision and corresponding allow/refuse regressions are explicit.

## User and platform feedback

The user reported a successful macOS arm64 upgrade from 1.0.8 to 1.0.10 and later reported that updating worked again, without a new complete platform, version-path, or account-data matrix. P4's copied-data acceptance is separate evidence and does not establish itemized production-data acceptance.

| Category and goal | Context and current decision | Later action and closure criteria |
| --- | --- | --- |
| Verification feedback: platforms, data, and failure recovery | macOS x64 and Windows x64 are assigned to third parties. Account data, sessions, workspaces, plugins, settings, repeated updates, cancellation, network recovery, and in-flight tasks still have unobserved native scenarios | Follow up as agreed and turn observed problems into bugs. Record platform, installed/target versions, account environment, reproduction, and affected data. Do not restore a qualification stage or require a new environment merely to close this list |
| Deferred bug: necessary Windows confirmation is obscured | The shared Windows overlay reserves 40 content pixels for a custom caption; attaching it directly to the native update window exposes underlying content. The user deferred shared-component edits. Current source keeps the original owner when confirmation is still required, so that prompt can remain obscured | Retain the deferral. If native-caption inset work is authorized later, add full-coverage, input-isolation, and cancellation regressions, then verify Windows natively. Removing idle-task repetition does not fix this branch |

## Historical checks

Handoff category: check debt. P6 retains these existing failures without changing code, external synchronized content, or global rules.

| Item | Known result and context | Later handling |
| --- | --- | --- |
| Repository references | The Python SDK `python/sdk/uv.lock` commit reference violates the current reference rule | Reproduce and fix within lockfile/reference-rule maintenance; do not rewrite unrelated dependencies for documentation closure |
| Concrete terms | Synchronized skills, fixed source, and patches retain existing terminology; the check fails | Follow source ownership and explicit scope; do not rewrite skill bodies in this work or add a global waiver |
| Current full lint | The closure run fails on unchanged Canvas source, including long lines and semicolons; this documentation task changes no code | Reproduce and fix in the owning source area, without treating untested historical fixtures as passed |
| Historical lint/fixture debt | P1/P3/P4 retain Canvas frontend fixtures, extra standalone TypeScript, fixed-source lint/routes/assertions, and full GUI/documentation failures; they were not all retested | Reproduce the named check when its area is touched or CI reproduces it, then fix its owner. Later builds and focused tests do not close old records in bulk |

Do not delete valid tests or treat packaging success as full-suite success. Some dependency classifications have later records, but old failure counts are not current measurements. Insight UI translations and built-in skill business correctness remain explicit exclusions.

## Packaging optimization

Handoff category: later-release optimization. The [existing CI speed analysis](history/shell/analysis/2026-11-02-dsh-insight-client-followups.md#提速建议与边界) remains the reference. Compare timings during natural builds rather than triggering extra CI for measurement.

- [ ] Deliver the separate App ticket-retry maintenance: its working-tree implementation reuses the DMG verifier’s bounded read-only retry for the exact CloudKit failure. That task reports local recovery, unrelated-error, and exhaustion regressions passing, but the changes are uncommitted at P6 closure and have no real-package validation. Its owner must commit source, tests, packaging guidance, and baseline rationale separately, then verify a later package; do not count it as shipped or part of the committed P6 baseline.
- [ ] Deliver and measure the separate macOS preparation optimization: the working-tree change runs pack and runtime preparation concurrently, as on Windows. Its owner reports local checks passing; commit it separately with rationale and measure the next natural build. No measured speedup or newly published package is claimed.
- [ ] Recover when Apple accepts an App but CI cannot obtain the result: the second 1.0.11 x64 attempt failed while obtaining the notarytool result; read-only Apple history and detailed logs confirmed that x86_64 submission was Accepted. Evaluate retaining the submission ID and redacted failure journal. Query the original submission and resume waiting and stapling only while the same artifact remains available; runner cleanup still requires rerunning the failed job. Do not skip stapling or final verification.

The [rc.2 record](history/releases/1.0.11-rc.2.md#源码与原-run) and [1.0.11 record](history/releases/1.0.11.md) retain failure, retry, and recovery evidence. If bounded validation retries fail or the runner loses its artifacts, [operational recovery](operations.md#known-failure-recovery) reruns failed jobs in the original run and retains successful artifacts from other platforms. Recovering an accepted submission remains unimplemented and requires separate authorization and same-artifact verification.

## Deferred product choices

These are independent product or maintenance decisions, not unfinished P6 code tasks to advance automatically.

| Goal | Context and current result | Later trigger |
| --- | --- | --- |
| Friendly plugin names and descriptions | Local entries can show absolute paths; the package-meta design is retained without approval | Revisit a concrete display defect, and obtain approval before an official extension |
| Marketing inspiration library | The user retained the old test endpoint and static fallback; backend ownership/connection remains disputed | Decide ownership and integration before implementation |
| Faster login restoration | A hidden window avoids the login-page flash, while credential validation and Home preparation still take time | Optimize reproducible latency or failures without bypassing validation or creating an empty Home |
| Smaller Main integration | Product wiring touches several lifecycle locations | Evaluate after a real upstream merge reveals conflicts, rather than creating a client or framework early |
| Shared notarization changes | A cross-major dependency upgrade and strict DMG validation retry solved distinct build failures | Compare with the next baseline; remove local differences after equivalent capability and consumer verification are complete |
| Stable rollout | Candidate can reuse final artifacts for promotion | Separate authorization is required; this work leaves the Stable pointer unchanged |

## Excluded scope

Standalone bundled dsh CLI adaptation, Windows all-users install compatibility, old scheduled-task migration, orphan-session repair, arbitrary old-file export, Insight UI translations, the withdrawn sidebar relocation, and built-in skill content verification are excluded decisions. They are not P6 debt or default next-release requirements. Host, Agent shell, Memory external CLIs, skill scripts, history readers, and Node retain the capabilities their product integrations need.

## Dev Note

None.
