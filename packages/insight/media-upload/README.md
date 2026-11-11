---
description: "Insight Desktop tools for OSS attachment uploads and authenticated image-layer generation."
kind: "package-bundle"
---

# @insight-ai/desktop-media-upload-plugin

English | [中文](README.zh.md)

## Summary

Insight Desktop loads this bundle to register a general OSS upload tool and image-layering source, submission, query, retry, and cache tools. General upload accepts a direct user attachment from the current turn: Full access proceeds without a separate approval prompt; other permission presets retain their approval behavior. Image layering selects an original image from the last three user-message turns, uploads it as part of submission, and tracks the enterprise task in a Session Job. A completed result is delivered only after PSD and image files are downloaded, verified, and presented locally.

## Table of Contents

- [Use this package](#use-this-package)
- [Implementation](#implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The package is loaded only by the Insight Desktop product bundle. Its patch also enables `file-upload.retainOriginalImage` for that product, so image prompts retain a private original-file reference in addition to their normalized model image. Other product profiles keep the existing default of `false`. `serviceEnvironment` selects the fixed test or production upload center; `requestTimeoutMs` and `ossTimeoutMs` bound external requests. An empty `generationResultHosts` uses the fixed test OSS result host in the test environment and denies result downloads in production; a nonempty list selects the allowed hosts explicitly.

The model may provide `attachmentIndex`, a one-based position among direct-user file and image attachments in the current turn. It must provide the index when there are multiple candidates. Text pasted in a prompt, local paths, Canvas assets, inherited messages, and older turns provide no upload authority. Images without an original-file reference cannot be uploaded. The upload center receives a filename and routing type, but no file size or MIME type. Its accepted extensions, write permissions, and size limits are not established by an STS success response; the former enterprise attachment policy no longer applies.

<a id="implementation"></a>
## Implementation

`src/image-layering.ts` reserves each creation attempt in Session data before the authenticated proxy POST, records its task handle, and starts a Session Job. A confirmed failed or incomplete result is queried once more through the same handle; only the first task can become eligible for one further creation with its bound image and parameters. Unknown submission or status outcomes never trigger another paid creation. The account scope and initial delivery directory are bound to the task. `job_kill`, shutdown, or restart stops local tracking without cancelling the remote task; a confirmed handle can resume tracking while valid. `src/result-cache.ts` downloads each allowed PSD and image, verifies its bytes, and writes through the Session sandboxed filesystem. A later directory change copies the verified group to the current workspace before delivery, retaining the original files if relocation fails.

`src/upload-source.ts` folds committed Session events into a Host-only current-turn list for ordinary uploads and a separate three-user-turn image list for layering. `src/index.ts` checks the root Agent; ordinary upload requests one-time approval except under the effective Full access preset, while layering upload follows the user's request to process the selected image. `src/upload-center.ts` validates the fixed gateway's STS response without exposing credentials. `src/oss-put.ts` streams the original bytes with SDK retries disabled. The general tool returns an OSS URL only after confirmed HTTP 200 and complete source consumption; uncertain PUT results are not repeated automatically.

<a id="model-experience"></a>
## Model Experience

### Attachment upload tool

#### What the model sees

The mounted plugin contributes `upload_attachment` with an optional one-based `attachmentIndex`. Its description limits use to current-turn user attachments and explains that the returned OSS address has unverified read access.

#### Token effect

The tool schema has a fixed request cost while the plugin is mounted. Each successful four-field result or error adds retained conversation tokens.

#### KV Cache effect

An unchanged tool definition preserves the existing request prefix. Loading or unloading the plugin changes the tool set and may invalidate reuse from the changed schema token.

### Upload result

#### What the model sees

A confirmed OSS PUT returns `url`, `urlAccess: "unverified"`, `filename`, and `sizeBytes`. It does not register an enterprise attachment or a Canvas asset. Rejected approval, failed authorization, and uncertain transfer produce an error result without credentials or a success URL.

#### Token effect

Result tokens vary with the filename and URL length.

#### KV Cache effect

The result appends to the conversation; it does not rewrite the preceding request prefix.

### Image-layer generation tools

#### What the model sees

`prepare_image_layering_source` lists eligible originals; several distinct images require selection. `submit_image_layering` accepts `sourceRef`, optional `prompt`, and optional nonnegative `numLayers` (default `0`), then uploads and submits without a separate general-upload approval. A same-turn `imageUrl` from the older general upload path remains accepted for compatibility. `get_image_layering` accepts the bound `taskHandle` and optional `watch`; only the first task reports `retry_eligible` after two confirmed incomplete reads, while a failed second task stops. Proxy creation HTTP 5xx is treated as an unknown outcome and is never automatically resubmitted. `retry_image_layering` creates at most one additional task from the saved original and parameters. The Job caches results after a successful query; `cache_image_layering_result` resumes caching and returns verified local file paths, a completeness flag, and a relocation flag for the skill to present. An expired result address triggers one refresh under the same handle, reusing verified files with the same object path. Result diagnostics name the invalid field and reason without logging signed URLs.

#### Token effect

The five image-layering tool definitions add fixed request tokens while loaded. Task IDs, status, local paths, URLs, and Job notices add retained tokens when produced.

#### KV Cache effect

Results and Job messages append to the conversation without rewriting the earlier request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A private bucket may reject direct reads of the returned URL. Real STS permissions, object-key uniqueness, bucket versioning, and cleanup of objects without enterprise registration require an isolated environment check before production rollout.
- The local image original is content-addressed and remains stored even if the staged prompt is later discarded.
- The proxy task handle expires after about 24 hours. The deployed Gateway must include the `call-insight-api` connection; local service code does not prove deployment. Upstream runs may return PNG-only results, so successful generation does not guarantee a PSD. The skill calls `present` only for verified local files. Production result OSS hosts must be configured with `generationResultHosts`.

<a id="dev-note"></a>
### Dev Note

None.
