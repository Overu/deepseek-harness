# Insight desktop release pipeline

English | [中文](README.zh.md)

## Summary

These scripts build a verifiable handoff between DSH desktop packaging, an immutable GitHub Release, and the existing Insight OSS/CDN. They keep product version `1.0.9` as the migration baseline. Candidate and Stable are publication channels; Candidate accepts final and prerelease versions. Packaging and publication are separate operations: publication consumes only bytes and the source record from a completed package workflow and never rebuilds or re-signs them.

## Table of Contents

- [Release flow](#release-flow)
- [Package workflow](#package-workflow)
- [Publish workflow](#publish-workflow)
- [Signed update formats](#signed-update-formats)
- [Trust and failure rules](#trust-and-failure-rules)
- [Build completion](#build-completion)

-----

<a id="release-flow"></a>
## Release flow

The package workflow pins one `insight` branch commit, builds selected platform packages with DSH, collects target-unique attachments, and records the build run and asset hashes in a source record attachment. The record binds the repository, workflow path, trusted ref, event, head commit, run id, targets, and manifest hashes. It then creates the immutable `insight-v<version>` GitHub Release. The publish workflow downloads the Release and the original workflow artifacts, verifies both against that source record, signs update documents, writes immutable OSS objects, verifies their remote bytes, and conditionally changes the channel pointer last.

The application product version and embedded DSH runtime version remain separate. Candidate accepts canonical final or prerelease 1.x versions. Stable accepts final versions and requires all three targets: `darwin-arm64`, `darwin-x64`, and `win32-x64`. A final version tested through Candidate can be promoted to Stable using the same GitHub Release, application bytes, and signed target manifests.

-----

<a id="package-workflow"></a>
## Package workflow

`.github/workflows/insight-package.yml` is a manual workflow restricted to the `insight` branch. Its three target jobs package macOS arm64, macOS x64, and Windows x64 with the DSH desktop entry points. Each job runs the platform's existing DSH package command, then collects and uploads the selected target. Windows continues to use the DSH NSIS path; additional Insight branding changes require separate authorization.

The signing setup step receives the P12 password and Apple API values, writes private files below `RUNNER_TEMP`, exports only their paths to later steps, and removes that private directory in an `always()` cleanup step. A normal build must complete DSH signing, notarization, and package checks before the collector records `distribution`. The explicit debug option records `debug-signed`, creates only a draft debug Release, and cannot pass the OSS publisher.

The Windows job is product-gated and intentionally omits Authenticode under the Insight product decision. It still runs the existing DSH runtime and package checks and emits the exact target manifest, size, and SHA-512 inputs later covered by signed update documents. A normal stable Release requires successful artifacts from all three jobs; the workflow does not synthesize a missing Windows target.

A normal single-target run stops after its architecture-specific Actions artifact; only a normal all-target run can create the public Release. The finalizer first creates or reuses a draft, uploads every expected attachment, permits retry only for a matching GitHub `starter` attachment, downloads each attachment to verify its size and SHA-512, and then makes the verified draft public. The finalize job uses the isolated release runtime and does not repeat the repository-wide dependency installation.

The source record does not bind GitHub's rerun-attempt counter. A legacy record may contain a positive attempt number for audit display, but readers do not use it as source authorization. If final attachment readback or the final Release update fails, rerunning the failed job can reuse the same native bytes under the same run id after the current run is completed successfully; it does not rebuild, re-sign, or re-notarize the application. The record's `qualification` field remains `distribution` or `debug-signed`; it classifies package output and is not a Windows upgrade result.

-----

<a id="publish-workflow"></a>
## Publish workflow

`.github/workflows/insight-publish.yml` is a separate manual workflow. It checks the fixed repository id, `insight` ref, current commit, workflow identity, requested version, and requested source commit. Its isolated runtime under `scripts/insight-release/runtime/` installs only the publisher dependencies and copies the reviewed publisher sources plus the checked-in public verification key into a temporary loader root. The loader uses an explicit isolated TypeScript configuration so repository source aliases cannot bypass the lightweight runtime dependencies.

Only the final publish step receives `DESKTOP_UPDATE_SIGNING_PRIVATE_KEY`. The OSS client accepts only the approved GitHub workflow OIDC identity and requests short-lived STS credentials from the existing Insight backend. It does not use a long-lived OSS access key. OIDC and STS requests use the Shell-compatible JSON Accept header. Failures report the HTTP status and a bounded machine code without logging tokens or response bodies.

The publish workflow target input selects the channel: a platform target publishes Candidate; `stable` publishes Stable for all three targets. Candidate accepts final or prerelease versions. Stable requires a final version and three verified distribution targets with the same version, source commit, and DSH runtime version.

Stage two rejects a draft Release before it reads or publishes attachments. Its lightweight runtime does not rebuild, package, notarize, or install the application. Actions artifact downloads request GitHub JSON media for the archive redirect; Release asset downloads request octet-stream bytes.

-----

<a id="signed-update-formats"></a>
## Signed update formats

Candidate V2 publishes final versions through `desktop/candidate-v2/<target>/current.json`. It shares signed target manifests and application objects under `desktop/releases/v<version>/targets/<target>/` with Stable V2, including the legacy `latest-mac.yml` and `latest.yml` names. Candidate publication does not write a Stable pointer or release index.

Candidate V3 uses `desktop/candidate-v3/<target>/current.json` and target-local immutable objects under `desktop/native/releases/v<version>/targets/<target>/`. It accepts rc versions for new clients. The released Shell V2 reader rejects prerelease versions, so candidate V3 does not claim to update an old Shell directly to `1.0.10-rc.1`.

Stable V2 uses `desktop/stable/current.json`, one signed release index, and all three signed target manifests under `desktop/releases/v<version>/`. It retains the `latest-mac.yml` and `latest.yml` asset names required by the old Shell-compatible stable reader. Stable publication accepts final versions only; old Shell clients can discover final Candidate versions through their manual candidate check.

Both formats bind the version, target, source commit, runtime version, compatibility fields, artifact name, byte size, and SHA-512. The channel pointer is an Ed25519-signed envelope that refers to the exact manifest or release-index bytes.

New clients authenticate both Candidate pointers and select the highest version; only HTTP 404 means a pointer is absent. A rejected highest version remains withdrawn rather than falling back to an older active version. Both protocols share the Candidate version floor.

The V2 index and target readers accept trailing whitespace for compatibility with the released Shell parser. Signatures still authenticate the complete original bytes, including that whitespace, so a publisher or CDN cannot change it after signing.

-----

<a id="trust-and-failure-rules"></a>
## Trust and failure rules

The publisher rejects debug artifacts, missing targets, unexpected Release attachments, expired workflow artifacts, a run that is not currently completed successfully, repository, workflow, ref, event, head, run-id, tag, or attachment-byte mismatch, metadata that selects another payload, an existing immutable key with different bytes, a version rollback, and a signing key that does not match the packaged public key. It streams large objects to files instead of loading installers into memory. In-memory manifest, signature, and pointer bytes are converted to Node buffers when passed to the OSS SDK.

Immutable objects use create-without-overwrite semantics. The publisher downloads every object again and checks its size and SHA-512 before changing a pointer with `If-Match` or `If-None-Match`. A failed write has an unknown outcome: the operation stops and a later attempt must reconcile remote state instead of overwriting it. Pointer readback must equal the signed bytes before publication reports success.

-----

<a id="build-completion"></a>
## Build completion

The package workflow runs the DSH package command for macOS arm64, macOS x64, and Windows x64, collects each target, and uploads its Actions artifact. A normal all-target build completes only when all three target jobs succeed and the finalizer creates the verified public GitHub Release.

OSS publication is a separate manual workflow. The package workflow does not invoke the publisher and does not change OSS objects or channel pointers.
