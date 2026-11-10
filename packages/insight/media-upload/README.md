---
description: "Insight Desktop tools for approved OSS attachment uploads and authenticated image-layer generation."
kind: "package-bundle"
---

# @insight-ai/desktop-media-upload-plugin

English | [中文](README.zh.md)

## Summary

Insight Desktop loads this bundle to register `upload_attachment`, `submit_image_layering`, and `get_image_layering`. Upload requires one current-turn user attachment and approval, then obtains temporary credentials from the upload center and writes the original bytes to OSS; its URL has unverified read access. Image layering submits a successfully uploaded image URL from the same turn through `POST /api/skill-proxy/call-insight-api`, returns a user-bound task handle, and tracks status in a session Job. Status can be checked again by handle without repeating submission. The requested PSD is available only when the upstream result's `image_list` includes a PSD URL.

## Table of Contents

- [Use this package](#use-this-package)
- [Implementation](#implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The package is loaded only by the Insight Desktop product bundle. Its patch also enables `file-upload.retainOriginalImage` for that product, so image prompts retain a private original-file reference in addition to their normalized model image. Other product profiles keep the existing default of `false`. `serviceEnvironment` selects the fixed test or production upload center; `requestTimeoutMs` and `ossTimeoutMs` bound external requests.

The model may provide `attachmentIndex`, a one-based position among direct-user file and image attachments in the current turn. It must provide the index when there are multiple candidates. Text pasted in a prompt, local paths, Canvas assets, inherited messages, and older turns provide no upload authority. Images without an original-file reference cannot be uploaded. The upload center receives a filename and routing type, but no file size or MIME type. Its accepted extensions, write permissions, and size limits are not established by an STS success response; the former enterprise attachment policy no longer applies.

<a id="implementation"></a>
## Implementation

`src/image-layering.ts` sends one authenticated proxy creation request, reads its terminal NDJSON event, and registers a session-owned Job that queries the same proxy. `job_kill`, plugin shutdown, or client restart stops local tracking but does not cancel remote generation. The tool result retains `taskHandle` for `get_image_layering({ taskHandle, watch: true })` recovery while the service handle remains valid. A submission transport failure may leave remote status unknown; POST is never retried automatically. Request, polling, and tracking durations are validated plugin configuration fields.

`src/upload-source.ts` folds committed Session events into a Host-only current-turn source list. `src/index.ts` registers the upload tool, checks the root Agent, and asks for a one-time transfer approval. `src/upload-center.ts` calls the fixed upload-center gateway path and checks the returned credentials, object name, and HTTPS OSS destination without exposing the login token or temporary credentials. An STS rejection reports its HTTP status and a validated service code when present, without returning the response message. `src/oss-put.ts` streams the attachment through `ali-oss` with SDK retries disabled. The tool returns the URL only after an explicit OSS HTTP 200 and complete source-stream consumption; an unconfirmed PUT is not automatically repeated and produces a Host diagnostic with the call ID and error code.

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

`submit_image_layering` accepts an `imageUrl` from a successful current-turn image upload, optional `prompt`, and optional nonnegative integer `numLayers`; absent values become an empty prompt and zero layers. It returns `taskHandle`, current status, and a `jobId` when tracking starts. `get_image_layering` accepts `taskHandle` and optional `watch`; success returns validated `psdUrls` and `imageUrls`. A completed task without PSD reports `missing_psd`. If the Job is unavailable, `monitoring: "unavailable"` preserves the handle. Account tokens and upstream credentials never enter tool results.

#### Token effect

The two tool definitions add fixed request tokens while loaded. Task IDs, status, URLs, and the Job notice add retained tokens when produced.

#### KV Cache effect

Results and Job messages append to the conversation without rewriting the earlier request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A private bucket may reject direct reads of the returned URL. Real STS permissions, object-key uniqueness, bucket versioning, and cleanup of objects without enterprise registration require an isolated environment check before production rollout.
- The local image original is content-addressed and remains stored even if the staged prompt is later discarded.
- The proxy task handle expires after about 24 hours. The deployed Gateway must include the `call-insight-api` connection; the test-environment service repository alone does not prove deployment. Upstream runs have returned PNG-only results as well as a PSD, so successful generation does not guarantee a PSD. The skill package downloads PSD files and calls `present`; production result OSS hosts require deployment configuration.

<a id="dev-note"></a>
### Dev Note

None.
