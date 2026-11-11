# Insight 图像分层

[English](image-layering.md) | 中文

## 摘要

Insight 图像分层由专业技能、Host 媒体工具、已认证的企业技能代理、会话后台 Job 和本地文件交付共同完成。用户可选择同一会话最近三个用户轮次直接上传的图片，并提供可选要求与层数。远端 PSD URL 不等于交付完成：Host 须下载并校验 PSD 与分层图片，技能再于开放轮次展示本地文件。

## 目录

- [模块与职责](#modules-and-ownership)
- [调用与数据流程](#call-and-data-flow)
- [异步任务状态](#asynchronous-task-states)
- [会话交付](#conversation-delivery)
- [失败与恢复](#failures-and-recovery)
- [佐证与限制](#evidence-and-limits)

-----

<a id="modules-and-ownership"></a>
## 模块与职责

技能规定 Agent 的执行顺序；工具强制执行上传与任务规则；交付子系统负责最终文件声明。这些是独立的执行步骤。

| 模块 | 职责 | 源码 |
| --- | --- | --- |
| 专业技能 | 规定选图、有限恢复、本地缓存与 `present` 调用；`ui.json` 提供展示名称与简介。 | [技能指令](../../bundled-skills/image-layering/SKILL.md)、[展示元数据](../../bundled-skills/image-layering/ui.json) |
| Insight media-upload Host 插件 | 注册通用上传及分层来源、提交、查询、重建、缓存工具；维护最近三个用户轮次的图片候选并轮询生成状态。 | [包说明](../../packages/insight/media-upload/README.zh.md)、[Desktop 产品组合](../../apps/desktop/src/product.ts) |
| Desktop 账号与代理传输 | 仅在 Host 请求中提供当前账号令牌、发送已认证的代理调用；提交结果不明时不重放付费创建。 | [代理传输](../../packages/insight/desktop-integration/src/host/skill-proxy-request.ts) |
| Session Jobs | 将轮询和成功后的缓存与 Agent 轮次分开，向任务所属 Agent 投递完成通知，或供其通过 `job_output` 读取结果。 | [Job 控制说明](../../packages/jobs/tool-jobs/README.zh.md) |
| 本地结果与交付 | Host 通过沙箱文件系统下载并验证 PSD 和分层图像；`present` 登记可访问文件；客户端在轮次结束时渲染交付卡片。 | [结果缓存](../../packages/insight/media-upload/src/result-cache.ts)、[present 工具](../../packages/deliverables/tool-present/README.zh.md)、[客户端交付 UI](../../packages/client/ui-deliverables/README.zh.md) |

Insight 技能中心可将共享 `bundled-skills` 目录作为旧版技能来源读取；同名调用技能若已安装到账号目录，则账号安装版本优先。工具是否可用取决于 Insight Host 组合，技能是否被发现则取决于当前 Desktop 配置。安装与优先级详见[技能中心](../../packages/insight/skill-center/README.zh.md)。

<a id="call-and-data-flow"></a>
## 调用与数据流程

流程分为五个阶段：Host 工具完成选图、上传、提交、查询和缓存；会话 Job 跟踪远端任务；技能对已验证的本地文件调用 `present`。客户端不调用 `/api/files/sts`、`/api/generation/submit` 或 `/api/generation/{generation_id}`；后续转发由企业服务负责。

1. **选择原图。** `prepare_image_layering_source` 列出同一 Session 最近三个含用户消息的轮次中用户直接上传的原图；多张不同图片时须明确选定。普通 `upload_attachment` 仍仅接受本轮附件，只有有效“完全权限”预设可免其单独审批。分层提交会直接上传选中原图，不再重复申请普通上传审批。详见[来源选择](../../packages/insight/media-upload/src/upload-source.ts)、[STS 请求](../../packages/insight/media-upload/src/upload-center.ts)和[OSS PUT](../../packages/insight/media-upload/src/oss-put.ts)。
2. **提交一次生成任务。** `submit_image_layering` 接收选定的 `sourceRef`、可选 `prompt`（默认 `""`）与非负 `numLayers`（默认 `0`），预检工作区，在上传和代理 POST 前将创建名额写入 Session。已认证的 `POST /api/skill-proxy/call-insight-api` 携带 `path: "/v1/proxy_async_create"`、固定 `model_id: "decompose-1.0-flash"`、`task_type: "async_tencent_multi_layer_create"` 及 `data: { prompt, image_url_list: [imageUrl], image_params: { num_layers: numLayers } }`。`data.task_id_list` 中唯一的有效项成为 `taskHandle`；任务记录绑定原图、参数、账号范围及初始交付目录。详见[生成工具](../../packages/insight/media-upload/src/image-layering.ts)。
3. **启动本地跟踪。** 获得 `taskHandle` 后，工具尽可能启动会话所属的 `image-layering` Job，并返回 `status: "running"`、`jobId` 与 `monitoring: "running"`。若 Job 无法启动，仍返回句柄及 `monitoring: "unavailable"`。`proxyRequestId` 是审计标识，不是任务句柄。
4. **读取与恢复。** Job 用绑定的 `taskHandle` 轮询 `path: "/v1/proxy_async_get_result"`；`get_image_layering` 可恢复跟踪。确定失败或终态结果不完整时，用同一句柄额外查询一次；若成功结果含图片但缺少 PSD，先缓存可用图片，缓存失败时不开放重建资格。只有初次任务两次确认无法提供完整结果，且其中的可用图片已缓存（若有）时才成为 `retry_eligible`，允许 `retry_image_layering` 最多创建最后一个任务；第二次任务失败时报告失败，不出现第三次创建资格。创建返回 HTTP 5xx、创建或查询结果不明、账号切换、任务取消时不重新创建付费任务。代理 HTTP 200 或 NDJSON `accepted` 不等于生成成功。
5. **缓存与交付。** Job 在成功查询后下载所有合法 PSD 与图片；`cache_image_layering_result` 可按句柄恢复本地缓存。两者均校验内容和本地字节，通过 Session 沙箱文件系统写入初始目录。下载地址失效时用同一句柄刷新一次，只补下载对象路径尚未验证的文件。若工作区后来切换，则尝试把已验证的整组文件复制到当前目录；失败时保留原目录文件。技能对每个已验证本地文件调用 `present`，每批最多八个，PSD 排在前面。完整交付的最终回复仅说明处理完成并指向文件卡片，不列远端 URL 或任务内部信息。

<a id="asynchronous-task-states"></a>
## 异步任务状态

远端句柄、代理审计 ID 和本地 Job ID 用途不同。绑定用户的 `taskHandle` 用于查询远端任务；`proxyRequestId` 用于服务端代理审计定位；`jobId` 标识当前 Session 内的轮询。恢复时保留句柄，不能用另外两个 ID 代替。

| 工具状态 | 含义 | 后续动作 |
| --- | --- | --- |
| `running` | 远端任务等待中或运行中。 | 确实需要等待时读取 `job_output`，或等待完成通知、调用 `get_image_layering`；保留 `taskHandle`。 |
| `succeeded` | 远端成功结果的 `image_list` 或 `psd_url` 中至少有一个 HTTPS PSD URL。 | 缓存并校验每张分层图及 PSD，再展示所有本地文件；仅有 URL 不等于已交付。 |
| `missing_psd` | 远端报告成功，但未找到 PSD URL；可能仍有其他 `imageUrls`。 | 明确报告未返回 PSD，不把 PNG 或其他图片称为 PSD。 |
| `failed`、`cancelled`、`retry_eligible` | 远端任务失败、被取消，或两次查询确认结果不完整。 | 仅初次任务的 `retry_eligible` 可重建；第二次创建失败或取消后停止。 |

Job 的单次请求、轮询间隔和跟踪时长均受插件配置限制。`job_kill`、插件卸载、客户端重启以及本地跟踪超时只停止本地监控，不取消远端生成。本地跟踪失败不等于远端 `failed`。服务仍接受句柄时，可用 `get_image_layering({ taskHandle, watch: true })` 恢复跟踪；技能中记录的服务句柄约 24 小时有效，这不是客户端保证。

<a id="conversation-delivery"></a>
## 会话交付

生成工具渲染通用卡片并把状态返回给 Agent；Job 和恢复缓存工具获取并校验文件，但不会自行创建交付卡片。技能须在开放轮次调用 `present`。

Host 缓存只接受允许的结果主机上的 HTTPS PSD、PNG、JPEG 与 WebP URL；主机列表为空时，测试环境使用固定测试主机，生产环境拒绝下载。缓存拒绝重定向、限制接收字节、检查文件头，并在 `generated/image-layering/` 下原子保存；返回路径前重新读取文件并核对大小。缓存失败时，技能报告故障并保留任务句柄，不改用脚本下载或关闭 TLS 证书校验。

`present({ files: [{ path, description }] })` 要求 Agent 轮次仍开放，且文件是该 Session 文件系统可访问的普通文件。成功调用会把绝对路径写入 `deliverables/presented` Session 事件；不会复制或永久保存文件字节。客户端在轮次结束后把声明的文件显示为交付卡片；卡片标识 PSD，并在可用时提供文件操作，但不承诺在聊天框内直接预览可编辑图层。源文件移动或删除后，再次打开可能失败。若 Job 完成后唤醒的是后续轮次，应在该轮次下载并调用 `present`。

每批 `present` 成功后，最终回复简要说明处理完成，以本地文件卡片交付，不列远端 URL、绝对路径或内部 ID。缓存或展示失败时报告对应阶段，并保留任务句柄以恢复本地步骤，不重新创建付费任务。

<a id="failures-and-recovery"></a>
## 失败与恢复

OSS PUT 前的失败、OSS 写入结果不明、远端提交结果不明、状态查询失败以及本地交付失败的责任阶段不同。Agent 应准确报告阶段，不因本地查询或下载失败就重复发起付费创建。

| 阶段 | 可观察结果 | 恢复规则 |
| --- | --- | --- |
| 上传授权 | 没有确认成功的 OSS URL。 | 处理登录或 STS 错误；分层提交不单独申请普通上传审批。 |
| OSS PUT | 被拒绝或写入结果不明时，不返回成功上传结果。 | 结果不明时不自动重试写入。 |
| 代理创建 | `AUTH_REQUIRED`、`SUBMISSION_REJECTED` 或 `SUBMISSION_UNKNOWN`；句柄缺失或无效也视为结果不明。 | 对 `SUBMISSION_UNKNOWN`，若有 `proxyRequestId` 则先查代理审计，再考虑重新创建。 |
| 代理查询或本地 Job | `STATUS_UNAVAILABLE`、`INVALID_RESPONSE` 或本地 `monitoring_unknown`。 | 保留 `taskHandle`，条件允许时重新查询；不要把本地跟踪失败当成远端失败。 |
| PSD 下载或文件声明 | 远端可能已有 `succeeded` 和 URL，但没有本地文件卡片。 | 报告准确的本地失败，保留远端 URL 和句柄；合适时只重试交付步骤。 |

<a id="evidence-and-limits"></a>
## 佐证与限制

[上传工具实现](../../packages/insight/media-upload/src/index.ts)、[生成工具实现](../../packages/insight/media-upload/src/image-layering.ts)、[技能指令](../../bundled-skills/image-layering/SKILL.md)和 [present 实现](../../packages/deliverables/tool-present/src/index.ts)支撑本文所述行为。各包说明负责完整的配置和错误细节；本文负责跨模块流程与会话交付规则。

本文说明的是源码行为及 PSD 文件卡片出现的条件，不断言所有部署环境都有代理路由、结果 OSS 主机白名单、可读取的 PSD URL 或已成功渲染的卡片。这些结果需要实际环境和可观察的 Session 结果验证。

## 开发备注

无。
