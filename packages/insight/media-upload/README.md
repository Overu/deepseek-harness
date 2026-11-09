---
description: "Insight Desktop tool for approved uploads of current-turn user attachments directly to OSS."
kind: "package-bundle"
---

# @insight-ai/desktop-media-upload-plugin

English | [中文](README.zh.md)

## Summary

The Insight Desktop bundle registers `upload_attachment` for one file attached by the user in the open turn. The Host asks for upload approval, requests temporary credentials directly from `POST /game-ai-editor-center/upload/sts/token` with the signed-in account, and PUTs the exact stored file bytes to OSS. Successful output contains the object `url`, `urlAccess: "unverified"`, the filename, and the original byte count. This path does not create an enterprise attachment ID or check read access to the URL.

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

`src/upload-source.ts` folds committed Session events into a Host-only current-turn source list. `src/index.ts` registers the one tool, checks the root Agent, and asks for a one-time transfer approval. `src/upload-center.ts` calls the fixed upload-center gateway path and checks the returned credentials, object name, and HTTPS OSS destination without exposing the login token or temporary credentials. An STS rejection reports its HTTP status and a validated service code when present, without returning the response message. `src/oss-put.ts` streams the attachment through `ali-oss` with SDK retries disabled. The tool returns the URL only after an explicit OSS HTTP 200 and complete source-stream consumption; an unconfirmed PUT is not automatically repeated and produces a Host diagnostic with the call ID and error code.

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

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A private bucket may reject direct reads of the returned URL. Real STS permissions, object-key uniqueness, bucket versioning, and cleanup of objects without enterprise registration require an isolated environment check before production rollout.
- The local image original is content-addressed and remains stored even if the staged prompt is later discarded.

<a id="dev-note"></a>
### Dev Note

None.
