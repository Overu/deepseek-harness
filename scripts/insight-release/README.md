# Insight desktop release pipeline

English | [中文](README.zh.md)

## Summary

These scripts build a verifiable handoff between DSH desktop packaging, an immutable GitHub Release, and the existing Insight OSS/CDN. They keep product version `1.0.9` as the migration baseline and accept `1.0.10-rc.1` as the first candidate version. Packaging and publication are separate operations: publication consumes only bytes and the source record from a completed package workflow and never rebuilds or re-signs them.

## Table of Contents

- [Release flow](#release-flow)
- [Package workflow](#package-workflow)
- [Windows current-user qualification](#windows-current-user-qualification)
- [Publish workflow](#publish-workflow)
- [Signed update formats](#signed-update-formats)
- [Trust and failure rules](#trust-and-failure-rules)
- [Failure diagnosis](#failure-diagnosis)
- [Qualification status](#qualification-status)

-----

<a id="release-flow"></a>
## Release flow

The package workflow pins one `insight` branch commit, builds selected platform packages with DSH, collects target-unique attachments, and records the build run and asset hashes in a source record attachment. The record binds the repository, workflow path, trusted ref, event, head commit, run id, targets, and manifest hashes. It then creates the immutable `insight-v<version>` GitHub Release. The publish workflow downloads the Release and the original workflow artifacts, verifies both against that source record, signs update documents, writes immutable OSS objects, verifies their remote bytes, and conditionally changes the channel pointer last.

The application product version and embedded DSH runtime version remain separate. A candidate version is a canonical 1.x prerelease. A stable version is a canonical final 1.x release and requires all three targets: `darwin-arm64`, `darwin-x64`, and `win32-x64`.

-----

<a id="package-workflow"></a>
## Package workflow

`.github/workflows/insight-package.yml` is a manual workflow restricted to the `insight` branch. Its three target jobs package macOS arm64, macOS x64, and Windows x64 with the DSH desktop entry points. Each job selects the Insight application id, name, artifact prefix, product version, update resource, and platform target without changing the official Desktop packaging defaults.

The signing setup step receives the P12 password and Apple API values, writes private files below `RUNNER_TEMP`, exports only their paths to later steps, and removes that private directory in an `always()` cleanup step. A normal build must complete DSH signing, notarization, and package checks before the collector records `distribution`. The explicit debug option records `debug-signed`, creates only a draft debug Release, and cannot pass the OSS publisher.

The Windows job is product-gated and intentionally omits Authenticode under the Insight product decision. It still emits the exact target manifest, size, and SHA-512 inputs later covered by signed update documents. A normal stable Release requires successful artifacts from all three jobs; the workflow does not synthesize a missing Windows target.

A normal single-target run stops after its architecture-specific Actions artifact; only a normal all-target run can create the public Release. The finalizer first creates or reuses a draft, uploads every expected attachment, permits retry only for a matching GitHub `starter` attachment, downloads each attachment to verify its size and SHA-512, and then makes the verified draft public. The finalize job uses the isolated release runtime and does not repeat the repository-wide dependency installation.

The source record does not bind GitHub's rerun-attempt counter. A legacy record may contain a positive attempt number for audit display, but readers do not use it as source authorization. If final attachment readback or the final Release update fails, rerunning the failed job can reuse the same native bytes under the same run id after the current run is completed successfully; it does not rebuild, re-sign, or re-notarize the application.

-----

<a id="windows-current-user-qualification"></a>
## Windows current-user qualification

The Windows job runs current-user upgrade qualification after build and collection but before artifact upload. In the same GitHub-hosted administrative job, it installs and upgrades two isolated cases: the default current-user path and an independent custom path containing spaces. It downloads the frozen signed `1.0.9` installer selected by the production trust resolver and verifies its size and SHA-512, then selects the new RC installer only through the collected build manifest. It verifies the real old raw `resources/app/package.json` payload and the new ASAR payload, registry identity, retained installation path, PE identity, installed payload version, and unchanged hashes for four synthetic files under Harness-owned directories. Cache paths are isolated and cleaned between cases but are not seeded or hash-qualified.

After the source check and before dependency installation, the same Windows job runs a two-minute real-HKCU smoke with a random registry key. The smoke contains no secrets and performs no native build. It does not add a workflow, job, or target selector; the existing four target choices remain unchanged.

This qualification uses the hosted administrator context without a UAC claim. It qualifies installer continuity only: application restart, update UI, a real account, and automatic old-client discovery of an rc version remain outside its result. The inner qualification has a 20-minute overall deadline inside a 25-minute workflow step. Cleanup failure or an unknown cleanup outcome fails the job before upload, so unqualified artifacts are not retained as Actions artifacts.

-----

<a id="publish-workflow"></a>
## Publish workflow

`.github/workflows/insight-publish.yml` is a separate manual workflow. It checks the fixed repository id, `insight` ref, current commit, workflow identity, requested version, and requested source commit. Its isolated runtime under `scripts/insight-release/runtime/` installs only the publisher dependencies and copies the reviewed publisher sources plus the checked-in public verification key into a temporary loader root.

Only the final publish step receives `DESKTOP_UPDATE_SIGNING_PRIVATE_KEY`. The OSS client accepts only the approved GitHub workflow OIDC identity and requests short-lived STS credentials from the existing Insight backend. It does not use a long-lived OSS access key.

Candidate publication selects one target from a prerelease GitHub Release. Stable publication accepts no target input and requires all three verified distribution targets with the same version, source commit, and DSH runtime version.

Stage two rejects a draft Release before it reads or publishes attachments. Its lightweight runtime does not rebuild, package, notarize, or install the application.

-----

<a id="signed-update-formats"></a>
## Signed update formats

Candidate V3 uses `desktop/candidate-v3/<target>/current.json` and target-local immutable objects under `desktop/native/releases/v<version>/targets/<target>/`. It accepts rc versions for new clients. The released Shell V2 reader rejects prerelease versions, so candidate V3 does not claim to update an old Shell directly to `1.0.10-rc.1`.

Stable V2 uses `desktop/stable/current.json`, one signed release index, and all three signed target manifests under `desktop/releases/v<version>/`. It retains the `latest-mac.yml` and `latest.yml` asset names required by the old Shell-compatible stable reader. Stable publication accepts final versions only; the first old-client automatic upgrade target remains `1.0.10`, not the rc package.

Both formats bind the version, target, source commit, runtime version, compatibility fields, artifact name, byte size, and SHA-512. The channel pointer is an Ed25519-signed envelope that refers to the exact manifest or release-index bytes.

The stable V2 index and target readers accept trailing whitespace for compatibility with the released Shell parser. Signatures still authenticate the complete original bytes, including that whitespace, so a publisher or CDN cannot change it after signing.

-----

<a id="trust-and-failure-rules"></a>
## Trust and failure rules

The publisher rejects debug artifacts, missing targets, unexpected Release attachments, expired workflow artifacts, a run that is not currently completed successfully, repository, workflow, ref, event, head, run-id, tag, or attachment-byte mismatch, metadata that selects another payload, an existing immutable key with different bytes, a version rollback, and a signing key that does not match the packaged public key. It streams large objects to files instead of loading installers into memory.

Immutable objects use create-without-overwrite semantics. The publisher downloads every object again and checks its size and SHA-512 before changing a pointer with `If-Match` or `If-None-Match`. A failed write has an unknown outcome: the operation stops and a later attempt must reconcile remote state instead of overwriting it. Pointer readback must equal the signed bytes before publication reports success.

-----

<a id="failure-diagnosis"></a>
## Failure diagnosis

After an original macOS x64 package job fails, the non-gating Office diagnostic invokes `node --import tsx scripts/insight-release/office-diagnostics.ts` with the selected macOS target and the absolute artifact directory. It requires the existing JavaScript Office resolver emitted by `build:official`; it does not copy the product resolver or provide an application fallback. When a signed application is available, the adaptive matrix observes the signed ASAR path first, then the signed application with the byte-verified raw runtime, then the packaged Resources Node with that raw runtime, and stops after the first passing observation. Without a signed application, a prepared-runtime observation can aid diagnosis but cannot replace application qualification.

Each observation runs the same `docx` then `xlsx` conversion with the product converter limits: the engine has a 60-second conversion limit and the diagnostic controller has a 150-second process budget. Every observation receives separate `HOME`, XDG, temporary, and NARB cache directories. Logs accept only allowlisted phase, timing, backend, failure-kind, exit, signal, byte-count, truncation, and result fields, cap captured output at 32 KiB, and report stderr only as a byte count. They do not expose environment values, arguments, local paths, URLs, tokens, or document contents. The current implementation records timing differences, not process samples.

The workflow runs this matrix only after the original job has failed and marks the step `continue-on-error`. Its final record always has `qualification: false`: a passing observation neither changes the failed job result nor qualifies CI, and no raw mode substitutes for the packaged application smoke. If an owned process group or its streams do not quiesce within the bounded termination and close grace periods, the controller records `cleanupFailed`, rejects that observation, stops the remaining matrix, and exits nonzero. The tool can be removed after the source of the packaged-runtime difference is resolved.

-----

<a id="qualification-status"></a>
## Qualification status

The local registry correction replaces dynamic PowerShell `PSObject` property access with the existing private typed `RegistryKey.GetValue` helper. The latest focused run passed 25 tests across three files and skipped the one real-Windows smoke on macOS; both `build:check` aggregates and the scoped lint passed. The `@electron/notarize` `3.1.2` implementation remains hook-free and keeps the existing notary executor. These local results do not qualify CI or a Release.

The Windows current-user qualifier and its review are complete locally, but no real NSIS upgrade has yet passed the workflow. Its installer-only result does not cover restart, update UI, a real account, or old-Shell automatic rc discovery. The supported old-Shell automatic path remains the stable `1.0.10` release.

Run `41089684008` completed the macOS arm64 build, signing, notarization, collection, and artifact upload, so `@electron/notarize` `3.1.2` is verified on that architecture. The macOS x64 job timed out during the prepared DOCX smoke before notarization began. The Windows build and collector passed, but qualification failed on the dynamic registry-property bug before installer upgrade. The post-failure Office diagnostic found its runtime unavailable because the failed preparation removed it, so it produced no probe evidence. Office investigation continues independently without raising the timeout. The Release was skipped and OSS remains unchanged; the arm64 result does not qualify Intel.

Native checks showed the update window before login, no confirmation after four clicks, and the candidate confirmation after the fifth click within three seconds; confirmation stored schema 1 preferences with `candidateOptIn: true` and mode 600. All seven required GitHub secrets are present, including the authorized encrypted transfer of `DESKTOP_UPDATE_SIGNING_PRIVATE_KEY`. Production-feed download and installation, the real Windows current-user upgrade, old-Shell stable upgrade, and the OIDC-to-STS identity remain unverified. Stable publication and every production pointer remain unchanged until P5 completes and the user separately starts publication.
