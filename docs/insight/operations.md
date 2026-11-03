# Insight Desktop operations

English | [中文](operations.zh.md)

## Summary

Use this reference when an Insight build, publication, signing step, or local development launch needs diagnosis. It records the release practices that succeeded during the migration and their limits. Product behavior and release-format details remain owned by [the Insight release scripts](../../scripts/insight-release/README.md); architecture and baseline changes remain owned by [the Insight subsystem](architecture.md) and [baseline record](baseline-changes.md).

## Contents

- [Current delivery state](#current-delivery-state)
- [Developing locally](#developing-locally)
- [Building GitHub Release artifacts](#building-github-release-artifacts)
- [Publishing a verified release](#publishing-a-verified-release)
- [Signing and notarization](#signing-and-notarization)
- [Known failure recovery](#known-failure-recovery)
- [Limits and follow-up](#limits-and-follow-up)

-----

## Current delivery state

The current Candidate V3 is version 1.0.11-rc.1 for macOS arm64, macOS x64, and Windows x64. The legacy final Candidate V2 remains 1.0.10 and Stable remains 1.0.9. Candidate and Stable are publication channels; a final semantic version can be validated in Candidate before the same verified artifacts are promoted to Stable.

The packaged 1.0.11-rc.1 contains the dual Candidate V2/V3 reader. Node-based metadata probes of it and 1.0.10 passed, but both published applications have an Electron transport defect: `net.fetch` returns an empty response URL, which their strict resolver rejects before version comparison. The current source adapter fixes that mismatch; the fix has not been packaged. Existing installations need a manual fixed-version installation before updater recovery. [Follow-ups](follow-ups.md#update-check-fix-delivery) owns that delivery step. Stable publication requires separate authorization.

The migration evidence is retained under [Insight history](history/shell/analysis/2026-11-02-dsh-insight-stable-release.md). Read the delivery record when a decision depends on the exact source, platform, or channel evidence rather than this operational summary.

The [1.0.11-rc.1 execution record](history/releases/1.0.11-rc.1.md) identifies the packaged source, successful three-platform run, Candidate publication runs, public-reader verification, and unchanged Stable/V2 pointer digests.

## Developing locally

Run `npm run dev:insight` from the repository root. The launcher selects the Insight product and defaults the development product version to 1.0.11-rc.2. It reuses the Desktop development launcher and uses the Shell-compatible Insight development user-data location.

The development login flow does not persist credentials. The packaged application restores and validates saved credentials in a hidden window; a valid account and account Home open the workspace, while an invalid credential, offline request, or Home protection failure shows the login or recovery page. Do not treat a local token file as authorization to skip server validation.

Development mode intentionally does not check packaged application updates. Its update entry shows a development-mode notice because a source launch has no packaged update source. Use an installed release to test update discovery, download, or installation.

## Building GitHub Release artifacts

The package workflow creates signed, notarized macOS artifacts and the Windows NSIS artifact. It produces one GitHub Release whose attachments and source record are the only inputs that the publish workflow may use. The publish workflow does not rebuild, sign, notarize, or install the application.

Run all targets when preparing a release that could later become Stable. A single-target package run creates only its Actions artifact and cannot publish directly to OSS; Candidate publication selects a target from a fully verified public Release. The package workflow keeps platform jobs parallel and keeps macOS app and DMG notarization paths parallel; do not add a qualification stage or repeat a full build in the publisher.

When a finalizer or artifact readback fails after successful platform jobs, rerun failed jobs in the same workflow run and reuse the successful native jobs’ recorded artifacts; the complete run must ultimately succeed before OSS publication. Rebuilding or rerunning a different source changes the build identity the publisher verifies. A rerun must still pass the workflow identity, source, release attachment, manifest, size, and SHA-512 checks.

## Publishing a verified release

Configure the six Apple packaging inputs and the Ed25519 publication private key under GitHub repository `Settings → Environments → desktop-release → Environment secrets`. The `secrets` references in the [package workflow](../../.github/workflows/insight-package.yml) and [publish workflow](../../.github/workflows/insight-publish.yml) own the names. The Apple `.p8` key and update-manifest private key serve different purposes and cannot replace each other. Keep their contents out of documentation and logs.

The publisher downloads the existing GitHub Release attachments and the original workflow artifacts, then verifies their identity and bytes before it requests OSS credentials. It uses an isolated runtime so publication does not install the workspace or repeat Desktop packaging.

The existing STS service receives a GitHub OIDC token with audience `insight-harness-oss-upload`, JSON Accept and Content-Type headers, and an empty JSON body. It issues short-lived OSS credentials only to the trusted repository, branch, workflow, and release environment. Do not add long-lived OSS credentials to GitHub Secrets or local configuration.

The STS request goes to `https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1/upload/sts/token` with body `{}`. The audience is a fixed protocol value in the [existing code](../../scripts/insight-release/oss.ts), not a missing Shell GitHub Secret. For HTTP 403 `GITHUB_REPOSITORY_FORBIDDEN`, check the repository identity allowlist in the actual gateway environment; do not replace certificates or impersonate old repository claims.

OSS accepts Node `Buffer` values for in-memory metadata and pointer bytes. It does not provide the conditional pointer replacement required for atomic compare-and-swap. The supported procedure is one publisher per pointer, serialized by the workflow target: read the pointer before publication, verify it has not changed immediately before replacement, write once, then read back the exact bytes. A failed pointer write has an unknown result; stop and reconcile remote state before any later attempt.

Candidate publication must not modify the Stable pointer. Stable requires a separate authorized all-target release. Keep the prior Shell publishers disabled while the new repository is the sole writer; enabling two writers reintroduces an unresolved pointer race.

## Signing and notarization

macOS signing configuration is written under the runner temporary directory, passed to later steps by path, and removed in an `always()` cleanup step. The normal package path signs, notarizes, staples, and verifies the application and DMG. A debug package that skips notarization is not publishable.

Two retry mechanisms address different Apple failures. The notarization dependency retries stapling after a completed submission. The Desktop DMG verifier retries only a read-only `stapler validate` failure with status 68, `NSURLErrorDomain`, `Code=-1005`, and `api.apple-cloudkit.com`, waiting two then five seconds. It does not submit, sign, staple, or relax final validation again.

The notarization dependency changed from major version 2 to 3 to obtain the stapling recovery behavior. It affects both Insight and the official product, so treat it as a shared build-stability change during upstream synchronization, not as an Insight-only feature.

## Known failure recovery

A cancelled arm64 job with no executed steps and the annotation “The job was not acquired by Runner of type hosted even after multiple attempts” indicates runner capacity failure. Retain successful target artifacts and rerun unsuccessful jobs in the same run after it finishes. Rerunning does not guarantee capacity; publication remains blocked until every target and the finalizer succeed.

| Symptom | Cause observed during migration | Successful response | Do not do |
| --- | --- | --- | --- |
| A rerun still uses the old publisher after a source fix | GitHub reruns retain the original workflow commit | Start a new workflow_dispatch with the fixed publisher while retaining the original package source | Do not rebuild or replace same-version app assets for a publisher-only fix |
| Artifact download returns HTTP 415 | GitHub Actions artifact archives need the JSON media type before redirect handling | Request the artifact archive with the GitHub JSON Accept value; request Release assets as octet-stream bytes | Do not use one Accept value for both endpoints |
| Publisher resolves workspace imports or misses isolated dependencies | A root TypeScript path configuration can make the lightweight publisher load workspace source | Run the prepared publisher loader with its emitted isolated TypeScript configuration | Do not install the full workspace in the publisher job |
| STS request is rejected | The gateway checks the OIDC identity and request format | Verify the repository, branch, workflow, environment, audience, headers, and empty body against the publish workflow | Do not expose the OIDC token or gateway response body in logs |
| OSS rejects in-memory metadata | The OSS SDK does not accept the typed-array input used by browser APIs | Convert small manifest, signature, and pointer values to Node `Buffer` values | Do not load installer files into memory; upload them as files |
| Pointer write result is unknown | OSS lacks atomic pointer compare-and-swap | Stop, read the remote pointer, and compare it with the intended signed bytes before deciding the next action | Do not blindly retry or overwrite the pointer |
| macOS DMG validation reports the exact CloudKit interruption | Apple ticket validation can lose its CloudKit connection after notarization | Let the bounded read-only verifier retry its two scheduled delays | Do not retry unrelated signing, notarization, or Gatekeeper failures |
| App validation reports CloudKit network loss with status 68 and Code=-1005 | The App validation path has no DMG verifier retry | Rerunning unsuccessful jobs in the original run recovered x64 while retaining the successful Windows artifact | Do not disable final validation or treat DMG success as App success |

## Limits and follow-up

This reference records successful build and Candidate-publication practice, not a platform qualification result. A macOS arm64 user reported an old-client upgrade to Candidate 1.0.10; data retention was not checked item by item. Other platform feedback, update failure recovery, and data continuity remain follow-up work and become bugs when reproduced.

The bundled `dsh` command-line launcher is outside the Insight product scope. This does not remove the Host, Agent shell, Memory external CLI, skill scripts, or the Node runtime used by those product integrations.

## Dev Note

None.
