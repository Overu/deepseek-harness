# Insight historical evidence

English | [中文](history.zh.md)

## Summary

Read an original report when a migration decision, acceptance result, or failure needs its recorded context. Start with the topic table; these frozen records are not current operating instructions. [Current guidance](README.md) owns the maintained product description.

## Evidence by question

| Question | Frozen source |
| --- | --- |
| Why migrate from Shell/Core, and which capabilities mattered? | [Capability inventory](history/shell/analysis/2026-10-08-business-capability-inventory.md), [execution design](history/shell/analysis/2026-10-28-dsh-insight-execution-report.md) |
| How were fixed source, required components, and skills agreed? | [P0](history/shell/analysis/2026-10-28-dsh-insight-p0-design.md), [P1 delivery](history/shell/analysis/2026-10-28-dsh-insight-p1-delivery.md) |
| What was implemented for login, managed models, and native UI? | [P2 delivery](history/shell/analysis/2026-10-29-dsh-insight-p2-delivery.md), [P3 acceptance](history/shell/analysis/2026-10-30-dsh-insight-p3-acceptance.md) |
| Why were specific permissions, skills, and message rendering changed? | [Permission matrix](history/shell/analysis/2026-10-29-dsh-insight-permission-design.md), [skill design](history/shell/analysis/2026-10-29-dsh-insight-toggle-skill-design.md), [Canvas historical references](history/shell/analysis/2026-11-02-dsh-insight-canvas-history-rendering.md) |
| How was old account history retained? | [P4 delivery](history/shell/analysis/2026-10-30-dsh-insight-p4-delivery.md), [read-only inventory](history/shell/analysis/2026-10-30-dsh-insight-p4-readonly-inventory.md) |
| Which build, Candidate upload, and old-client checks succeeded? | [P5 delivery](history/shell/analysis/2026-10-30-dsh-insight-p5-delivery.md), [publication execution](history/shell/analysis/2026-11-02-dsh-insight-stable-release.md) |
| What official changes were reviewed before P6? | [Per-file preflight](history/shell/analysis/2026-11-02-dsh-insight-p6-preflight-review.md), [P6 handoff](history/shell/analysis/2026-11-02-dsh-insight-p6-handoff.md) |
| What did the original Shell release protocol do? | [Old release runbook](history/shell/release-runbook.md), [V2 checklist](history/shell/releases/update-v2-operator-checklist.md), [1.0.9 evidence](history/shell/releases/1.0.9.md) |

## Import scope and traceability

The snapshot contains 201 files, including 96 Markdown documents, from the Shell docs tree. It includes analysis, acceptance, release evidence, old operator notes, Canvas discussion records, and the pre-existing historical ZIP. The signature evidence’s original .gitattributes file is retained; the imported file set matches the source commit docs tree. [The import manifest](history/import-manifest.json) records the source repository and commit, old/new paths, original/imported SHA-256 values, byte counts, and every relocated link.

JSON, signatures, text evidence, and the existing ZIP retain their bytes. Markdown has a frozen-status notice, relocated navigation, prose line reflow, and normalized trailing whitespace. Original conclusions and failed checks are retained; old Shell TypeScript fragments are explicitly unchecked historical examples, not current DSH compilation inputs. History-specific Git attributes disable newline normalization, and an executed check verifies the imported file set, sizes, and digests. A reference to old source code or a local build log that was not imported links to an explicit historical source-location entry; the original target is also in the manifest. No old runtime source is copied merely to make a historical link clickable.

The current baseline record explains the rationale and maintenance impact; the frozen preflight preserves the reviewed file/commit comparison. Source hashes identify what was imported, not what an installed client contains. The published 1.0.10 artifact source and the later dual-reader source remain distinct in their original release records.

## P6 verification record

| Check | Observed result for this stage |
| --- | --- |
| Documentation-check unit tests | 187 passed across four files, including modified/missing/extra/traversal/duplicate/symlink rejection, ignored local metadata, and adjacent-path rejection |
| Aggregate type checks | Both Host and Client build:check lanes passed against existing artifacts; no package rebuild |
| Documents and navigation | Links, anchors, wrapping, and endings passed for 121 Markdown files; 14 named bilingual pairs passed; Mermaid parsing passed |
| Source and bytes | All 201 source-file hashes matched the recorded Shell commit; imported and staged digests matched without rewriting signatures |
| Old entry points | URL form and local targets passed for 34 Shell pages and 101 cross-repository URLs; remote availability follows pushing the documentation commits |
| Full doc-sync | 41 passed, two failed: the existing Python uv.lock commit reference and terminology in synchronized skills/fixed source/patches; their business content was not changed |
| Product evidence limits | Native installation, paid generation, and remote build/publication were not repeated; documentation checks are not full product regression |

The history-only pairing, commit-evidence, old-package-path, and original-field exceptions were each explicitly approved; file-set and digest verification still runs. This stage closed the old Desktop packaging README pairing record, explicitly marked old Shell-only code examples, and restored the subsystem API navigation. The two remaining full-repository failures stay recorded in [follow-ups](follow-ups.md), without a new global waiver.

## P6 decisions and limits

The P6 read-only consumer audit retained Canvas legacy UI, source patches, required components, installer compatibility tests, and official DSH update tools because they remain in use. No extra tracked runtime deletion was justified. The active architecture and baseline pages are centralized here; package READMEs remain beside code, and the generated account API remains at its generator-owned subsystem path. Old subsystem URLs are small navigation entries.

The user explicitly approved the history-only pairing and commit-evidence exception, and its allow/refuse tests passed; adjacent paths and organization URLs remain checked. Other historical or baseline check failures are recorded from actual results; this exception is not a full-suite pass. No build, publication, user-data change, or newer DSH baseline merge was performed for this documentation work.

## Dev Note

None.
