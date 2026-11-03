# Insight follow-ups

English | [中文](follow-ups.zh.md)

## Summary

Use this list when scheduling a client release, receiving a defect report, or updating the DSH baseline. Items distinguish unresolved product choices, verification feedback, and explicit exclusions. Stage closure does not turn an unobserved result into a pass.

## Navigation

- [Update check fix delivery](#update-check-fix-delivery)
- [Plugin installation policy](#plugin-installation-policy)
- [User and platform feedback](#user-and-platform-feedback)
- [Historical checks](#historical-checks)
- [Packaging optimization](#packaging-optimization)
- [Deferred product choices](#deferred-product-choices)
- [Excluded scope](#excluded-scope)

## Update check fix delivery

Version 1.0.11 completed three-platform packaging and Candidate V2 publication. Old Shell, new dual-protocol, and isolated native discovery checks passed without downloading or installing. The V3 origin remains rc.2; after the user reported configuration and refresh, the public CDN still returns rc.1, with some old cache lifetimes and some negative cache times. V3 discovery is not accepted yet. Check the directory-rule priority for `/desktop/candidate-v3/` and the refresh task status for all three full `current.json` URLs, then retest the fixed CDN domain. No private console was accessed. The [1.0.11 record](history/releases/1.0.11.md) owns execution evidence.

The transition package is a real 1.0.11, published only to Candidate V2 for old Shell V2 and new dual-protocol readers; Stable/V3 origin pointers remain byte-identical. Subsequent rc releases start at 1.0.12-rc.1; final applications retain the five-click manual Candidate check. Local signed-sequence tests cover later V3 selection and replay rejection; production download and installation await feedback on real releases. Existing new DSH 1.0.10/rc.1 transport defects still require one manual installation.

## Plugin installation policy

The four product components must be protected at the execution layer. The current manager rejects sources whose canonical package name cannot be established before installation; local archive inspection is bounded at 10 MiB. This protects required bundles but also restricts some unrelated third-party plugin sources.

The unresolved goal is to preserve ordinary plugin choice while preventing required-component replacement. No bypass or relaxed check is approved. A later decision must either accept the supported-source restriction explicitly or design isolated package identification before changing the current profile. Retain the present protection until a complete replacement is reviewed; [baseline changes](baseline-changes.md) owns its rationale.

## User and platform feedback

The user reported that macOS arm64 upgraded from 1.0.8 to 1.0.10 successfully. macOS x64 and Windows x64 are assigned to third-party validation. Account data, sessions, workspaces, plugins, and settings were not individually confirmed after that production upgrade. P4's copied-data acceptance is separate evidence.

The user chose to follow up later and treat observed failures as bugs. New-client-to-new-client installation, download/installation cancellation, network recovery, and in-flight task handling remain unobserved native scenarios. Record the platform, installed and target versions, account environment, reproduction, and affected data when a report arrives. Do not recreate a qualification stage or require a new test environment merely to close this list.

## Historical checks

Historical P1/P3/P4 reports contain failing Canvas frontend fixtures, extra standalone TypeScript checks, fixed-source lint/routes/assertions, and full GUI/documentation checks. Later successful builds and targeted tests do not close each failure. Some dependency classifications were subsequently added to the baseline record; a stale failure count is not a current retest result.

When a touched area or CI failure makes one relevant, reproduce that named check against the current source, preserve the expected behavior, and fix the owner. Do not delete valid tests, weaken global checks, or treat packaging success as full-suite success. Insight UI internationalization and built-in skill business correctness remain outside the agreed migration scope.

## Packaging optimization

The [existing CI speed analysis](history/shell/analysis/2026-11-02-dsh-insight-client-followups.md#提速建议与边界) remains the optimization reference. Compare timings during normal builds rather than triggering extra CI to collect data.

- [ ] Recover from transient CloudKit failures during final App ticket validation: App `stapler validate` requests to `api.apple-cloudkit.com` can fail with `NSURLErrorDomain Code=-1005` and exit status 68. This path lacks the DMG verifier’s bounded retry and requires rerunning the whole macOS job. Evaluate reusing exact error matching and bounded read-only retries without signing again, resubmitting notarization, or weakening final validation.

- [ ] Recover when Apple accepts an App but CI cannot obtain the result: the second 1.0.11 x64 attempt failed while obtaining the notarytool result; read-only Apple history and detailed logs confirmed that x86_64 submission was Accepted. Evaluate retaining the submission ID and redacted failure journal. Query the original submission and resume waiting and stapling only while the same artifact remains available; runner cleanup still requires rerunning the failed job. Do not skip stapling or final verification. The [1.0.11 record](history/releases/1.0.11.md) retains the evidence; this item is not implemented.

The [rc.2 execution record](history/releases/1.0.11-rc.2.md#源码与原-run) retains the arm64 failure after 27m33s and successful retry in 23m31s. The current [operational recovery](operations.md#known-failure-recovery) reruns failed jobs in the original run and retains successful artifacts from other platforms. Acceptance must cover recovery from the target network error, immediate failure for unrelated errors, and failure after retries are exhausted. Implementation in the official verifier requires separate explicit authorization; this item is not implemented.

## Deferred product choices

| Goal | Context and current result | Why open and when to act |
| --- | --- | --- |
| Friendly plugin names and descriptions | Local-entry display can show absolute paths; a package-meta design was retained without implementation approval | Revisit on a concrete display defect; do not implement the previously unapproved official extension automatically |
| Marketing inspiration library | User chose to keep the old test endpoint and static fallback | Backend ownership/connection remains disputed; change only after a separate decision |
| Faster login restoration | A hidden window avoids the login-page flash, but credential validation and Home preparation still take time | Optimize on reproducible latency or failure feedback; do not bypass validation or create an empty Home |
| Smaller Main integration | Current product wiring touches several lifecycle locations | Evaluate after a real upstream merge shows conflicts; do not create a new client or framework preemptively |
| Shared notarization changes | A cross-major dependency upgrade and strict DMG validation retry solved separate build failures | Compare with the next upstream baseline; remove local differences once equivalent behavior is supplied |
| Stable rollout | Candidate can reuse final artifacts for promotion | Separate release decision; keep the current Stable pointer unchanged until authorized |

## Excluded scope

Standalone bundled dsh CLI adaptation, Windows all-users install compatibility, old scheduled-task migration, orphan-session repair, arbitrary old-file export, Insight UI translations, the withdrawn sidebar relocation, and built-in skill content verification are excluded decisions, not unfinished P6 tasks. Retained Host, Agent shell, Memory external CLIs, skill scripts, history readers, and Node remain supported parts of their existing integrations.

## Dev Note

None.
