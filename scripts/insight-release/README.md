# Insight desktop release pipeline

English | [中文](README.zh.md)

## Summary

These scripts build a verifiable handoff between DSH desktop packaging, an immutable GitHub Release, and the existing Insight OSS/CDN. They keep product version `1.0.9` as the migration baseline and accept `1.0.10-rc.1` as the first candidate version. Packaging and publication are separate operations: publication consumes only bytes and the source record from a completed package workflow and never rebuilds or re-signs them.

## Table of Contents

- [Release flow](#release-flow)
- [Package workflow](#package-workflow)
- [Publish workflow](#publish-workflow)
- [Signed update formats](#signed-update-formats)
- [Trust and failure rules](#trust-and-failure-rules)
- [Qualification status](#qualification-status)

-----

<a id="release-flow"></a>
## Release flow

The package workflow pins one `insight` branch commit, builds selected platform packages with DSH, collects target-unique attachments, and records the build run and asset hashes in a source record attachment. It then creates the immutable `insight-v<version>` GitHub Release. The publish workflow downloads the Release and the original workflow artifacts, verifies both against that source record, signs update documents, writes immutable OSS objects, verifies their remote bytes, and conditionally changes the channel pointer last.

The application product version and embedded DSH runtime version remain separate. A candidate version is a canonical 1.x prerelease. A stable version is a canonical final 1.x release and requires all three targets: `darwin-arm64`, `darwin-x64`, and `win32-x64`.

-----

<a id="package-workflow"></a>
## Package workflow

`.github/workflows/insight-package.yml` is a manual workflow restricted to the `insight` branch. Its three target jobs package macOS arm64, macOS x64, and Windows x64 with the DSH desktop entry points. Each job selects the Insight application id, name, artifact prefix, product version, update resource, and platform target without changing the official Desktop packaging defaults.

The signing setup step receives the P12 password and Apple API values, writes private files below `RUNNER_TEMP`, exports only their paths to later steps, and removes that private directory in an `always()` cleanup step. A normal build must complete DSH signing, notarization, and package checks before the collector records `distribution`. The explicit debug option records `debug-signed`, creates only a draft debug Release, and cannot pass the OSS publisher.

The Windows job is product-gated and intentionally omits Authenticode under the Insight product decision. It still emits the exact target manifest, size, and SHA-512 inputs later covered by signed update documents. A normal stable Release requires successful artifacts from all three jobs; the workflow does not synthesize a missing Windows target.

A normal single-target run stops after its architecture-specific Actions artifact; only a normal all-target run can create the public Release. The finalizer first creates or reuses a draft, uploads every expected attachment, permits retry only for a matching GitHub `starter` attachment, downloads each attachment to verify its size and SHA-512, and then makes the verified draft public. The finalize job uses the isolated release runtime and does not repeat the repository-wide dependency installation.

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

The publisher rejects debug artifacts, missing targets, unexpected Release attachments, expired workflow artifacts, tag or workflow identity mismatch, metadata that selects another payload, an existing immutable key with different bytes, a version rollback, and a signing key that does not match the packaged public key. It streams large objects to files instead of loading installers into memory.

Immutable objects use create-without-overwrite semantics. The publisher downloads every object again and checks its size and SHA-512 before changing a pointer with `If-Match` or `If-None-Match`. A failed write has an unknown outcome: the operation stops and a later attempt must reconcile remote state instead of overwriting it. Pointer readback must equal the signed bytes before publication reports success.

-----

<a id="qualification-status"></a>
## Qualification status

The focused implementation run passed 437 tests across 25 files, and an independent release-path run passed 118 tests across 15 files. After a small Node stream typing fixture fix, the affected coordinator suite passed 27 tests; the post-fix full 437-test log is not yet archived. Export JSDoc and the final P5 type-aware scoped lint passed with zero findings. The latest official build completed all compile aggregates, and an earlier `build:artifacts` run passed all eight gates. The public stable `1.0.9` live check passed; six source tests also pass against a frozen offline fixture containing the ten public update documents. These results leave no known P5 code blocker, but they do not qualify a production channel.

The local macOS arm64 package command exited successfully. Developer ID signing, App and DMG notarization and staple passed; the parallel notarization lanes took 299.83 and 303.94 seconds. Independent checks accepted the extracted application and DMG as Notarized Developer ID content. The output contains a 276 MiB DMG, 383 MiB ZIP, 407 KiB blockmap, and 369-byte nightly metadata; the collector verified four assets and the exact metadata binding. `ProductInfo.plist` records `com.insight-aigc.desktop` and `1.0.10rc1`. The new-repository `DESKTOP_CSC_LINK` now contains a validated copy with the same leaf certificate and private key plus the public Apple G2 chain; the original user file is unchanged.

That package came from dirty local HEAD `675192ea4b`, not CI. P5 commit `44e877f7b5fa6a2ef98d13ffc0e91b99f132884f` is on the remote, `insight` is the default branch, and both workflows are active. The first all-target package run failed before it created a Release; its clean-environment fixes pass local focused checks, and a replacement run is pending. No OSS publish run has occurred. Native checks showed the update window before login, no confirmation after four clicks, and the native candidate confirmation after the fifth click within three seconds; confirmation wrote schema 1 preferences with `candidateOptIn: true` and mode 600. A development build without a downloadable feed correctly could not install. Native automatic candidate suppression has only unit coverage, and the production-feed download and installation path remains pending.

With explicit user authorization, the existing `DESKTOP_UPDATE_SIGNING_PRIVATE_KEY` was transferred once as encrypted GitHub data into the new `Overu/deepseek-harness` `desktop-release` environment. All seven required secrets are present; the temporary transfer branch and artifact were removed, and the legacy secret and repository `main` branch remain unchanged. The secret value was not exposed. The OIDC-to-STS backend's acceptance of the new repository id, `insight` ref, `insight-publish.yml`, and environment still needs a real publish request. The product does not require Windows Authenticode, but a real `win32-x64` CI artifact and native install/upgrade result remain pending. Stable publication and every production pointer remain unchanged until the required executions pass and the user separately starts publication.
