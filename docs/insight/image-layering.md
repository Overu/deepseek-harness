# Insight image layering

English | [中文](image-layering.zh.md)

## Summary

Insight image layering combines an expert skill, Host media tools, an authenticated enterprise skill proxy, a Session background Job, and plugin-owned result cards. The skill selects up to five directly uploaded images from the last three user-message turns. Ordinary image messages use their stored normalized bytes for OSS submission; image file attachments retain their file bytes. The Host saves result URLs in a JSON manifest in the current workspace. Each generated PSD or image appears in a card under its original image's heading and is downloaded only when the user clicks Download, without another confirmation.

## Contents

- [Modules and ownership](#modules-and-ownership)
- [Call and data flow](#call-and-data-flow)
- [Asynchronous task states](#asynchronous-task-states)
- [Conversation delivery](#conversation-delivery)
- [Failures and recovery](#failures-and-recovery)
- [Evidence and limits](#evidence-and-limits)

-----

<a id="modules-and-ownership"></a>
## Modules and ownership

| Module | Responsibility | Source |
| --- | --- | --- |
| Expert skill | Selects up to five stored images, resolves each layer mode or count, waits for independent results, and calls the URL-manifest tool. | [Skill instructions](../../packages/insight/media-upload/guidance/image-layering/SKILL.md) |
| Media-upload Host plugin | Registers upload and layering tools, polls enterprise tasks, writes URL manifests, and serves authenticated file downloads. | [Package reference](../../packages/insight/media-upload/README.md), [Host entry](../../packages/insight/media-upload/src/index.ts) |
| Media-upload client plugin | Rebuilds grouped cards from recorded tool results and starts one file download per click. | [Client entry](../../packages/insight/media-upload/src/client/index.ts) |
| Desktop account and proxy transport | Supplies the current account token to Host-only requests; an uncertain paid submission is not replayed automatically. | [Proxy transport](../../packages/insight/desktop-integration/src/host/skill-proxy-request.ts) |
| Session Jobs | Tracks each task outside the agent turn and reports completion through `job_output`; it does not write result files. | [Job control reference](../../packages/jobs/tool-jobs/README.md) |

The media-upload Host plugin registers its packaged skill with Insight Skill center at startup, so Expert skills lists it under Platform presets. An account-installed skill with the same invocation name takes precedence; a legacy copy has lower priority.

<a id="call-and-data-flow"></a>
## Call and data flow

1. **Select images and layer counts.** `prepare_image_layering_source` lists eligible images from the last three user-message turns. The skill resolves an ambiguous selection before submission and asks the user to reduce a selection above five. It accepts smart layering or an integer from 2–17; when no count is given, it offers smart layering and the inclusive ranges 2–4, 5–8, 9–12, and 13–17. More layers may cost more. Ordinary `upload_attachment` is limited to the current turn and skips its separate approval only under effective Full access; layering uploads the selected images as part of the user's processing request.
2. **Submit a generation task per image.** `submit_image_layering` accepts `sourceRef`, optional `prompt`, and `numLayers` (`0` for smart layering). It checks workspace text-write access, uploads the stored image, and sends the authenticated `/v1/proxy_async_create` request through `POST /api/skill-proxy/call-insight-api`. A confirmed `taskHandle` identifies one paid task. There is no durable creation reservation; a repeated submit may create and charge for another task.
3. **Track independent tasks.** Each confirmed handle starts an `image-layering` Session Job when available. The Job queries `/v1/proxy_async_get_result`. A non-timeout query error stops that image after one read; an explicit request timeout permits one more read under the same handle. `get_image_layering` can resume tracking when no Job is active. Failure of one image does not stop the others.
4. **Save and present result links.** After each successful or partly successful remote result, the skill calls `cache_image_layering_result({taskHandle,imageLabel})`. The Host re-queries the same handle, validates allowed HTTPS result hosts and extensions, and writes PSD/image URLs to `generated/image-layering/<handle-hash>.json` in the current workspace through the Session sandboxed text filesystem. The returned tool result also records the account scope, original-image label, completeness flag, and ordered file descriptors. The client replays that result as grouped file cards. No generated binary is fetched at this stage; the skill does not call `present` with an OSS URL.
5. **Download on click.** The authenticated client route receives only a Session ID, result event sequence, and file index. The Host checks the recorded tool call and result, current account scope, fresh task response, allowed OSS URL, size, and file signature. It streams the selected file as an attachment. Clicking Download begins this request immediately, without a second confirmation or a new paid generation request. A final agent reply summarizes per-image outcomes after all unaffected tasks settle.

<a id="asynchronous-task-states"></a>
## Asynchronous task states

`taskHandle` identifies the remote task, `proxyRequestId` identifies a proxy audit operation, and `jobId` identifies local polling. These identifiers are not interchangeable. `job_kill`, shutdown, restart, or a local tracking deadline stops local monitoring without proving remote failure or cancelling remote generation.

| Tool status | Meaning | Next action |
| --- | --- | --- |
| `running` | Remote task is pending or running. | Await its Job; query the same handle only when no Job is active. |
| `succeeded` | Remote result contains PSD and image URLs. | Save the URL manifest and show file cards. |
| `missing_psd` | Remote success lacks a PSD, though images may exist. | Save available image URLs as incomplete and report the missing PSD. |
| `failed`, `cancelled` | Remote task failed or was cancelled. | Stop automatic calls for that image; continue other images. |
| `query_unavailable` | Status read failed; remote outcome is unknown. | Stop after one non-timeout failure or the permitted timeout retry; do not resubmit. |

<a id="conversation-delivery"></a>
## Conversation delivery

The URL manifest is a text file, not a downloaded PSD or image. It contains the full service URLs, including any signed query parameters, and is readable by anyone with access to the workspace. A result card reflects a recorded URL, not proof that the remote bytes remain accessible. The plugin-owned client derives cards from durable tool events when the conversation reopens; it groups files by original image, puts the PSD before layer images, and labels an incomplete result. Download errors appear on the affected card, where the user can click again. The client never sends an arbitrary URL to the Host route.

The Host accepts only configured result hosts; an empty `generationResultHosts` uses the fixed test host in the test environment and rejects result downloads in production. Download rejects redirects, oversized or invalid content, and unrecorded file coordinates. No account token, OSS credential, or signed URL is sent to the browser as a route argument. The browser's download destination is governed by its normal download settings.

<a id="failures-and-recovery"></a>
## Failures and recovery

| Stage | Observable result | Recovery rule |
| --- | --- | --- |
| Upload authorization or OSS PUT | No confirmed source OSS URL. | Resolve login or service errors; do not repeat an unknown write automatically. |
| Paid proxy creation | `SUBMISSION_UNKNOWN` or no confirmed handle. | Use the proxy audit ID when available; do not submit again without resolving the uncertain outcome. |
| Status query or local Job | `query_unavailable`, `monitoring_unknown`, or account failure. | Preserve the handle; stop this image according to the skill's bounded retry rule while other images continue. |
| Manifest write | Remote URL exists, but no local manifest or result card was recorded. | Correct workspace access or host configuration, then retry saving under the same handle. |
| User download | Card exists, but the remote file cannot be fetched or verified. | Show the card error and allow another click; never recreate a paid generation task for a download failure. |

<a id="evidence-and-limits"></a>
## Evidence and limits

The [media-upload implementation](../../packages/insight/media-upload/src/index.ts), [download route](../../packages/insight/media-upload/src/result-download.ts), [client cards](../../packages/insight/media-upload/src/client/LayeringResultCards.tsx), and [skill instructions](../../packages/insight/media-upload/guidance/image-layering/SKILL.md) define the current flow. Source and focused tests establish the behavior; a readable remote file, deployed proxy route, and final browser download still require live-environment verification. The remote task handle has an approximate 24-hour service lifetime, not a client guarantee.

## Dev Note

None.
