---
description: "Insight Desktop tools for OSS attachment uploads and authenticated image-layer generation."
kind: "package-bundle"
---

# @insight-ai/desktop-media-upload-plugin

English | [中文](README.zh.md)

## Summary

Insight Desktop loads this bundle to register a general OSS upload tool and image-layering source, submission, query, and result-link tools. General upload accepts a direct user attachment from the current turn: Full access proceeds without a separate approval prompt; other permission presets retain their approval behavior. Image layering selects an image from the last three user-message turns, uploads its stored bytes as part of submission, and tracks the enterprise task in a Session Job. The plugin saves result URLs in a workspace JSON manifest and renders grouped PSD and image cards; clicking Download immediately fetches that file without another confirmation.

## Table of Contents

- [Use this package](#use-this-package)
- [Implementation](#implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The package is loaded only by the Insight Desktop product bundle. Ordinary image messages retain the normalized image used for model input; this plugin reads that stored version when an image is selected for upload. File attachments retain their exact bytes. `serviceEnvironment` selects the fixed test or production upload center; `requestTimeoutMs` and `ossTimeoutMs` bound external requests. An empty `generationResultHosts` uses the fixed test OSS result host in the test environment; production requires a nonempty list at plugin startup. The bundled production configuration allows `game-ai-editor-videoassets-test.oss-cn-guangzhou.aliyuncs.com`, the result host used by the production service.

The package carries [image-layering instructions](guidance/image-layering/SKILL.md), [display metadata](guidance/image-layering/ui.json), and a legacy PSD helper script that is not used by the current delivery flow. At Host startup it registers the skill through Insight Skill center, making it available in conversations and under Expert skills → Platform presets. An account-installed skill with the same invocation name takes precedence, while a legacy copy has lower priority.

The model may provide `attachmentIndex`, a one-based position among direct-user file and image attachments in the current turn. It must provide the index when there are multiple candidates. Text pasted in a prompt, local paths, Canvas assets, inherited messages, and older turns provide no upload authority. An image uses its verified normalized bytes and a filename matching that encoding; the plugin does not reconstruct its original file. The upload center receives a filename and routing type, but no file size or MIME type. Its accepted extensions, write permissions, and size limits are not established by an STS success response; the former enterprise attachment policy no longer applies.

<a id="implementation"></a>
## Implementation

`src/image-layering.ts` submits through the authenticated proxy and starts a Session Job after receiving a task handle. It does not persist a task reservation or binding; a repeated submit can create another paid task. A non-timeout query error stops that image's Job after one read; a request-deadline timeout permits one further read under the same handle. Confirmed remote failure or incomplete output is not automatically queried again or recreated. `job_kill`, shutdown, or restart stops local tracking without cancelling the remote task; a known handle can be queried again while valid. After the Job settles, `cache_image_layering_result` re-queries the known handle and `src/result-cache.ts` writes the validated service URLs to `generated/image-layering/` in the current workspace through the Session sandboxed text filesystem. No PSD or image bytes are fetched during manifest creation. The client derives grouped file cards from the recorded tool result; `src/result-download.ts` checks the recorded Session result, current account scope, fresh task result, allowed OSS host, file size, and signature before streaming a clicked file. The authenticated download route accepts a Session coordinate and file index, never a caller-provided URL.

`src/upload-source.ts` folds committed Session events into a Host-only current-turn list for ordinary uploads and a separate three-user-turn image list for layering. It reads and verifies a selected normalized image only when a tool needs it, then stores those same bytes as a file with an encoding-matched extension for the existing OSS path. `src/index.ts` checks the root Agent; ordinary upload requests one-time approval except under the effective Full access preset, while layering upload follows the user's request to process the selected image. `src/upload-center.ts` validates the fixed gateway's STS response without exposing credentials. `src/oss-put.ts` streams stored bytes with SDK retries disabled. The general tool returns an OSS URL only after confirmed HTTP 200 and complete source consumption; uncertain PUT results are not repeated automatically.

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

`prepare_image_layering_source` lists eligible stored images; several distinct images require selection. `submit_image_layering` accepts `sourceRef`, optional `prompt`, and optional nonnegative `numLayers` (default `0`), then uploads and submits without a separate general-upload approval. A same-turn `imageUrl` from the older general upload path remains accepted for compatibility. `get_image_layering` accepts `taskHandle` and optional `watch`; a failed query returns `query_unavailable` with a structured reason, optional business code and proxy request ID, and `remoteOutcome: "unknown"`. Proxy creation HTTP 5xx is treated as an unknown outcome and is never automatically resubmitted. `cache_image_layering_result` accepts a known handle and a short original-image label, writes the URL manifest in the current workspace, and returns the manifest path, completeness flag, account scope, and PSD/image descriptors used by the client cards. A card click triggers a fresh same-handle query and downloads only the selected remote file; no paid creation or confirmation prompt occurs. Result diagnostics name the invalid field and reason without logging signed URLs.

#### Token effect

The four image-layering tool definitions add fixed request tokens while loaded. Task IDs, status, manifest paths, URLs, and Job notices add retained tokens when produced.

#### KV Cache effect

Results and Job messages append to the conversation without rewriting the earlier request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A private bucket may reject direct reads of the returned URL. Real STS permissions, object-key uniqueness, bucket versioning, and cleanup of objects without enterprise registration require an isolated environment check before production rollout.
- Image normalization may resize or re-encode a source; the uploaded OSS object and reported size describe the stored normalized image. The plugin stores a file copy only after a selected image reaches an upload tool.
- The proxy task handle expires after about 24 hours. The deployed Gateway must include the `call-insight-api` connection; local service code does not prove deployment. Upstream runs may return PNG-only results, so successful generation does not guarantee a PSD. A card proves only that a result URL was recorded; download may fail if the remote file has expired or access is denied. The JSON manifest contains full URLs, including any signed query parameters, and is visible to readers of the workspace. Production result OSS hosts must be configured with `generationResultHosts`.

<a id="dev-note"></a>
### Dev Note

None.
