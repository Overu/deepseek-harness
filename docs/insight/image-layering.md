# Insight image layering

English | [中文](image-layering.zh.md)

## Summary

Insight image layering combines an expert skill, Host media tools, an authenticated enterprise skill proxy, a Session background Job, and local file delivery. The skill can select up to five distinct images directly uploaded in the last three user-message turns; each image gets an automatic mode or a supported layer count. A remote PSD URL alone does not complete delivery: the Host must download and verify the PSD and images, and the skill must present the local files in an open turn.

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

The skill defines the agent's sequence; the tools enforce upload and task rules; the deliverables subsystem owns the final file declaration. These are separate execution steps.

| Module | Responsibility | Source |
| --- | --- | --- |
| Expert skill | Selects up to five sources, resolves each image's layer mode or count, and directs bounded task recovery, local caching, and `present` invocation; `ui.json` supplies its display name and summary. | [Skill instructions](../../bundled-skills/image-layering/SKILL.md), [presentation metadata](../../bundled-skills/image-layering/ui.json) |
| Insight media-upload Host plugin | Registers ordinary upload plus image-layering source, submission, query, retry, and cache tools; owns three-user-turn image selection and generation polling. | [Package reference](../../packages/insight/media-upload/README.md), [Desktop product composition](../../apps/desktop/src/product.ts) |
| Desktop account and proxy transport | Supplies the current account token to Host-only requests, sends authenticated proxy calls, and does not replay a paid submission after an uncertain transport result. | [Proxy transport](../../packages/insight/desktop-integration/src/host/skill-proxy-request.ts) |
| Session Jobs | Keeps polling and post-success caching separate from the agent turn and delivers completion to the owning agent, or lets it read the outcome through `job_output`. | [Job control reference](../../packages/jobs/tool-jobs/README.md) |
| Local results and deliverables | Host downloads and verifies PSD and image files through the sandboxed filesystem; `present` records accessible files; the client renders delivery cards at the end of the turn. | [Result cache](../../packages/insight/media-upload/src/result-cache.ts), [present tool](../../packages/deliverables/tool-present/README.md), [client delivery UI](../../packages/client/ui-deliverables/README.md) |

Insight Skill center can read the shared `bundled-skills` directory as a legacy skill source; an account-installed skill with the same invocation name takes precedence. Tool availability comes from the Insight Host bundle, whereas skill discovery depends on the active Desktop configuration. See [Skill center](../../packages/insight/skill-center/README.md) for installation and precedence.

<a id="call-and-data-flow"></a>
## Call and data flow

The path has five phases. Host tools select, upload, submit, query, and cache; a Session Job tracks the remote task; the skill calls `present` for verified local files. The client does not call `/api/files/sts`, `/api/generation/submit`, or `/api/generation/{generation_id}` in this path; downstream forwarding belongs to the enterprise service.

1. **Select originals and layer counts.** `prepare_image_layering_source` lists original images directly uploaded by the user in the Session's last three user-message turns. When multiple images are available, the skill resolves which to process before asking for a layer strategy per selected image. It asks the user to reselect if more than five distinct images are chosen. For an image without an explicit count or mode, it offers smart layering or the inclusive ranges 2–4, 5–8, 9–12, and 13–17; the agent chooses the lowest count that serves the editing goal within the selected range. More layers can cost more, while automatic mode has no price estimate. For an explicit count outside 2–17, the skill instructs the agent to ask for correction before submission. Ordinary `upload_attachment` remains limited to this turn and skips its own approval only under effective Full access. The layering submission uploads each selected original without a separate ordinary-upload approval. See [skill instructions](../../bundled-skills/image-layering/SKILL.md), [source selection](../../packages/insight/media-upload/src/upload-source.ts), [STS request](../../packages/insight/media-upload/src/upload-center.ts), and [OSS PUT](../../packages/insight/media-upload/src/oss-put.ts).
2. **Submit a generation task per image.** Each `submit_image_layering` call accepts one selected `sourceRef`, optional `prompt` (default `""`), and nonnegative `numLayers` (default `0`); the skill passes `0` only for automatic mode and an explicit integer from 2–17 otherwise. The tool prechecks the workspace and durably reserves a creation attempt before upload and proxy POST. The authenticated `POST /api/skill-proxy/call-insight-api` carries `path: "/v1/proxy_async_create"`, fixed `model_id: "decompose-1.0-flash"`, `task_type: "async_tencent_multi_layer_create"`, and `data: { prompt, image_url_list: [imageUrl], image_params: { num_layers: numLayers } }`. A single valid `data.task_id_list` entry becomes `taskHandle`; the task record binds its original, parameters, account scope, and initial delivery directory. Independent Jobs can overlap after their submissions. See [generation tools](../../packages/insight/media-upload/src/image-layering.ts).
3. **Start local tracking.** After receiving `taskHandle`, the tool starts a Session-owned `image-layering` Job when possible and returns `status: "running"`, `jobId`, and `monitoring: "running"`. If Job startup is unavailable, it still returns the handle with `monitoring: "unavailable"`. `proxyRequestId` is an audit identifier, not a task handle.
4. **Read and recover.** The Job polls `path: "/v1/proxy_async_get_result"` using the bound `taskHandle`; `get_image_layering` can resume tracking when no Job is active. A non-timeout query error ends tracking for that image after one read and returns `query_unavailable`; an explicit request-deadline timeout permits one more query with the same handle. A confirmed failed, cancelled, or incomplete terminal result is not automatically queried again or recreated. A successful result with images but no PSD can retain verified images as incomplete output. Previously eligible Session tasks retain the `retry_image_layering` tool, while new tasks do not become eligible. Unknown submission or query outcomes, account change, and cancellation do not permit a new paid creation. A proxy HTTP 200 or NDJSON `accepted` is not generation success.
5. **Cache and deliver.** The Job downloads every allowed PSD and image after a successful query; `cache_image_layering_result` can resume local caching by handle. Both verify content and local bytes and write through the Session sandboxed filesystem in the task's initial directory. An inaccessible result address triggers one refresh under the same handle; verified files with the same object path are reused. If the workspace changed, it attempts to copy the verified group to the current directory and retains originals if relocation fails. After unaffected images finish or stop tracking, the skill calls `present` for every verified local file, at most eight per call, with each image's PSD before its other files. Every batch from one image uses the same `groupTitle`, which the client displays above that image's cards; one final reply reports per-image outcomes. A complete final reply only says that processing finished and points to the file cards; it omits remote URLs and task internals.

<a id="asynchronous-task-states"></a>
## Asynchronous task states

The remote handle, proxy audit ID, and local Job ID serve different purposes. The user-bound `taskHandle` identifies the remote task for status queries; `proxyRequestId` helps locate a proxy operation in service audit; `jobId` identifies local polling in the current Session. Retain the handle for recovery, and never substitute either other ID for it.

| Tool status | Meaning | Next action |
| --- | --- | --- |
| `running` | Remote task is pending or running. | Await its Job through `job_output`; use `get_image_layering` only when no Job is active, and preserve `taskHandle`. |
| `succeeded` | A successful remote result contains at least one HTTPS PSD URL in `image_list` or `psd_url`. | Cache and verify every returned image and PSD, then present all local files; a URL alone is not a deliverable. |
| `missing_psd` | Remote task reports success, but no PSD URL was found; other `imageUrls` may exist. | Report that no PSD was returned. Do not label PNG or other images as a PSD. |
| `failed`, `cancelled` | Remote task failed or was cancelled. | Stop this image's automatic remote calls; retain any verified partial files as incomplete. |
| `query_unavailable` | Status query failed; `reason`, optional `businessCode` and `proxyRequestId` describe the query, while `remoteOutcome` remains `unknown`. | Stop this image after one non-timeout failure or the one permitted timeout retry; continue other images. |
| `retry_eligible` | A previously recorded Session task has retry eligibility. | The retry tool remains available for that historical task; current tasks do not enter this state. |

The Job has bounded request, polling, and tracking durations configured by the plugin. `job_kill`, plugin teardown, client restart, and local tracking timeout stop local monitoring without cancelling the remote generation. A tracking failure is not a remote `failed` status. While the service accepts the handle, `get_image_layering({ taskHandle, watch: true })` can resume tracking; the skill records an approximate 24-hour service-handle lifetime, not a client guarantee.

<a id="conversation-delivery"></a>
## Conversation delivery

Generation tools render generic cards and return status to the agent; the Job and recovery cache tool fetch and verify files but do not create delivery cards. The skill must call `present` in an open turn.

The Host cache accepts HTTPS PSD, PNG, JPEG, and WebP URLs only from the configured result hosts; an empty list selects the fixed test host in the test environment and denies downloads in production. It rejects redirects, limits received size, checks file signatures, and atomically writes under `generated/image-layering/`. It restats and rereads each file before returning paths. If caching fails, the skill reports the failure and retains the task handle rather than downloading through a script or disabling TLS verification.

`present({ groupTitle, files: [{ path, description }] })` requires an open Agent turn and a regular file accessible through that Session's filesystem. A successful call records the absolute path and optional group heading in a `deliverables/presented` Session event; it does not copy or preserve the file bytes. The client shows the declared file beneath its image heading after the turn ends. The card identifies the PSD file and offers file actions where available; it does not promise an inline, editable layer preview. Moving or deleting the source file can break a later open. If Job completion wakes a later turn, download and call `present` in that turn.

After every `present` call succeeds, the final answer briefly says processing finished and relies on the local file cards; it does not list remote URLs, absolute paths, or internal IDs. If caching or presentation fails, report that stage and retain the task handle for local recovery without another paid creation.

<a id="failures-and-recovery"></a>
## Failures and recovery

Failures before OSS PUT, unknown OSS write outcomes, remote submission uncertainty, status-read failures, and local delivery failures have different owners. The agent must report the stage accurately and avoid repeating a paid remote create merely because a local read or download failed.

| Stage | Observable result | Recovery rule |
| --- | --- | --- |
| Upload authorization | No confirmed OSS URL. | Resolve login or STS errors; the layering submission does not ask for a separate ordinary-upload approval. |
| OSS PUT | A rejected or unconfirmed write returns no successful upload result. | Do not automatically retry an unknown write outcome. |
| Proxy create | `AUTH_REQUIRED`, `SUBMISSION_REJECTED`, or `SUBMISSION_UNKNOWN`; a missing/invalid handle is also uncertain. | For `SUBMISSION_UNKNOWN`, use `proxyRequestId` if available for service audit before any new create. |
| Proxy query or local Job | `query_unavailable`, local `monitoring_unknown`, or `auth_unavailable`. | Preserve `taskHandle`; stop automatic reads for the affected image, except one retry of an explicit query timeout. Authentication failures also stop new image submissions. Do not treat local monitoring failure as confirmed remote failure. |
| PSD download or file declaration | Remote `succeeded` and URL may exist without a local file card. | Report the exact local failure, keep the remote URL and handle, and retry only the delivery step when appropriate. |

<a id="evidence-and-limits"></a>
## Evidence and limits

The [media-upload implementation](../../packages/insight/media-upload/src/index.ts), [generation implementation](../../packages/insight/media-upload/src/image-layering.ts), [skill instructions](../../bundled-skills/image-layering/SKILL.md), and [present implementation](../../packages/deliverables/tool-present/src/index.ts) establish the behavior described here. Package references own exhaustive configuration and failure details; this page owns the cross-module flow and conversation delivery rules.

This page describes source behavior and the conditions for a PSD file card. It does not assert that every deployment has the proxy route, the result OSS host allowlist, a readable PSD URL, or a successfully rendered card. Those outcomes require a live environment and an observed Session result.

## Dev Note

None.
