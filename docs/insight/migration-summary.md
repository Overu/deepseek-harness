# Insight migration summary

English | [中文](migration-summary.zh.md)

## Summary

Insight now runs its product features on the native DSH Desktop workspace instead of launching the old Shell/Core runtime. The delivered Candidate V3 is 1.0.11-rc.1 on macOS arm64, macOS x64, and Windows x64. This report separates implementation, observed acceptance, exclusions, and remaining work.

## Reading guide

- [Result and product scope](#result-and-product-scope)
- [Data and release evidence](#data-and-release-evidence)
- [Retirement decisions](#retirement-decisions)
- [Maintenance handoff](#maintenance-handoff)

## Result and product scope

| Area | Result |
| --- | --- |
| Desktop | Insight brand, login, legal dialogs, account menu and settings; native DSH workspace and title-bar policy |
| Authentication and models | Main-owned authentication and account Home; controlled Host credential requests; managed model route without user token configuration |
| Required components | Integration, Canvas, Memory, and Prompt are product-required and update with the client; internal feature switches remain available |
| Business source | Canvas is inside packages/insight; Memory and Prompt use pinned snapshots with replayable parent-repository patches, without submodules or independent git updates |
| Skills | Root bundled-skills structure and synchronization remain; runtime discovery and packaged directory delivery are integrated; skill business correctness was not assessed |
| Historical data | Reuse the Shell userData and account harness directory; no import, conversion, merge, or separate migration state machine |
| Packaging and publishing | DSH packaging and one updater; separate GitHub Release construction and OSS/CDN publication; final and rc Candidate support |

The standalone bundled dsh CLI is outside the product. This does not exclude Agent shell, Memory external CLIs, skill scripts, or their Node runtime. Other explicit exclusions are Insight UI internationalization, Windows all-users installation compatibility, old scheduled-task compatibility, orphan-session repair, and the independent arbitrary-history-file exporter. The withdrawn sidebar positioning change remains withdrawn.

## Data and release evidence

P4 used an isolated copy of old account data: 22 sessions were readable, two workspaces and selected historical messages remained visible after initial login and restart, and the recorded original log digests were unchanged. This evidence covers the tested copy, not every production account or continued generation from every old record.

The final 1.0.10 package completed three-platform CI, macOS signing/notarization, and Candidate publication. The released Shell reader verified all three CDN targets. A user reported a successful macOS arm64 upgrade from 1.0.8 to 1.0.10; the other platforms remain for third-party feedback, and production data preservation was not confirmed item by item. Stable remains 1.0.9; only Candidate was published.

The published 1.0.11-rc.1 delivers the dual-protocol Candidate reader. Both its current reader and the published 1.0.10 reader verified the three public rc targets; the Stable and final Candidate V2 pointers remained unchanged. [Operations](operations.md) owns current channel compatibility, [follow-ups](follow-ups.md) retains native verification limits, and the [execution record](history/releases/1.0.11-rc.1.md) binds the exact source and runs.

## Retirement decisions

A consumer audit found no remaining runtime dependency on insight-desktop-shell, insight-harness-core, or insight-workflow-op. The old workflow execution scheme is replaced by Canvas. No additional tracked runtime implementation was shown to be safely removable in P6, so this stage does not manufacture code deletions.

| Item | Decision and reason |
| --- | --- |
| Canvas canvas-app/legacy | Retain: the current entry, aliases, compiler inputs, and tests directly consume this source |
| Pinned snapshots, upstream.json, and parent patches | Retain: they reconstruct the reviewed business source and adaptations |
| Windows legacy installer regression | Retain: it covers upgrading the old registered 因赛AI.exe installation |
| Official DSH installed-update tools | Retain: these are upstream utilities, not the removed Insight Windows qualification stage |
| qualification in release records | Retain: it identifies distribution/debug-signed artifacts and is not an installation test job |
| Local .desktop-build output | Leave as build output: it is ignored and can contain acceptance evidence; it is not tracked obsolete implementation |

Old Shell/Core repositories and user directories are not deleted. Old publishing entry points remain disabled while the new repository is the sole publisher. Documentation retirement consolidates current guidance and replaces old migration-report entry points with links; historical conclusions remain available as evidence.

## Maintenance handoff

The [baseline record](baseline-changes.md) explains necessary product integrations, shared API changes, sync costs, and implementation trade-offs. [Operations](operations.md) records successful recovery paths without adding build stages. [Follow-ups](follow-ups.md) carries unresolved policy choices, and verification debt with their original context.

P6 documentation migration and its checks are recorded in the historical index. Product behavior changes, new official DSH edits, and Stable publication still require their own explicit scope; entering P6 is not blanket authorization for them.

## Dev Note

None.
