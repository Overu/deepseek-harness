# 因赛图像分层

[English](image-layering.md) | 中文

## 概述

因赛图像分层由专家技能、Host 媒体工具、已认证的企业技能代理、会话后台 Job 和插件自有的结果卡片组成。技能可从最近三个用户消息轮次中选择最多五张直接上传的图片。普通图片消息使用已存储的归一化字节提交 OSS；图片文件附件保留文件字节。Host 把结果 URL 写入当前工作区的 JSON 清单。每个 PSD 或分层图片按原图标题显示为卡片，用户点击“下载”时才获取该文件，无需二次确认。

## 目录

- [模块与职责](#modules-and-ownership)
- [调用与数据流程](#call-and-data-flow)
- [异步任务状态](#asynchronous-task-states)
- [会话交付](#conversation-delivery)
- [失败与恢复](#failures-and-recovery)
- [证据与限制](#evidence-and-limits)

-----

<a id="modules-and-ownership"></a>
## 模块与职责

| 模块 | 职责 | 源码 |
| --- | --- | --- |
| 专家技能 | 选择最多五张已存储图片，确定各图的层数策略，等待独立结果并调用 URL 清单工具。 | [技能指令](../../packages/insight/media-upload/guidance/image-layering/SKILL.md) |
| media-upload Host 插件 | 注册上传及分层工具，轮询企业任务，写入 URL 清单，提供认证文件下载入口。 | [包说明](../../packages/insight/media-upload/README.zh.md)、[Host 入口](../../packages/insight/media-upload/src/index.ts) |
| media-upload 客户端插件 | 从已记录的工具结果恢复分组卡片，并在每次点击时启动一个文件下载。 | [客户端入口](../../packages/insight/media-upload/src/client/index.ts) |
| Desktop 账号与代理传输 | 为 Host 请求提供当前账号令牌；提交结果不明时不自动重复创建付费任务。 | [代理传输](../../packages/insight/desktop-integration/src/host/skill-proxy-request.ts) |
| 会话 Job | 在智能体轮次外跟踪任务，通过 `job_output` 报告完成；不写入结果文件。 | [Job 说明](../../packages/jobs/tool-jobs/README.zh.md) |

media-upload Host 插件启动时通过因赛技能中心注册包内技能，因此“专家技能”的平台预置列表可显示它。同名账号安装技能优先于插件版；旧目录副本优先级更低。

<a id="call-and-data-flow"></a>
## 调用与数据流程

1. **选择图片和层数。** `prepare_image_layering_source` 列出最近三个用户消息轮次的合格图片。多图选择不明时先确认；超过五张时请用户缩减。可选智能分层或 2–17 的整数；未指定时展示智能分层和四个闭区间：2–4、5–8、9–12、13–17。更多层可能产生更高费用。普通 `upload_attachment` 只处理当前轮次附件，且只有有效“完全权限”免单独审批；分层上传依据用户对已选图片的处理请求执行。
2. **逐图提交生成。** `submit_image_layering` 接收 `sourceRef`、可选 `prompt` 及 `numLayers`（智能分层为 `0`）。工具先检查工作区文本写入权限，再上传已存储图片，通过已认证的 `POST /api/skill-proxy/call-insight-api` 转发 `/v1/proxy_async_create`。确认返回的 `taskHandle` 标识一个付费任务。插件不再持久保存创建预留；重复提交可能再次创建并计费。
3. **独立跟踪任务。** 每个已确认句柄尽可能启动一个 `image-layering` 会话 Job。Job 查询 `/v1/proxy_async_get_result`。非超时查询错误在一次读取后停止该图；明确的请求超时仅允许同一句柄再查一次。没有活跃 Job 时可用 `get_image_layering` 恢复跟踪。一张图失败不会中断其他图。
4. **保存并展示结果地址。** 每张图片取得完整或部分成功的远端结果后，技能调用 `cache_image_layering_result({taskHandle,imageLabel})`。Host 重新查询同一句柄，校验 HTTPS 结果主机和扩展名，通过会话沙箱文本文件系统把 PSD/图片 URL 写入当前工作区 `generated/image-layering/<句柄哈希>.json`。工具结果同时记录账号范围、原图标签、完整标志及有序文件信息。客户端从工具事件恢复分组文件卡片。此时不下载生成的二进制文件；技能不会把 OSS URL 传给 `present`。
5. **点击后下载。** 已认证的客户端路由只接收会话 ID、结果事件序号和文件序号。Host 核对已记录的工具调用与结果、当前账号范围、最新任务结果、允许的 OSS 地址、文件大小和签名，然后以附件形式流式返回选中的文件。点击“下载”立即开始请求，无二次确认，也不重新创建付费生成任务。所有未受影响的任务结束后，智能体统一汇总逐图结果。

<a id="asynchronous-task-states"></a>
## 异步任务状态

`taskHandle` 标识远端任务，`proxyRequestId` 标识代理审计操作，`jobId` 标识本地轮询；三者不能互换。`job_kill`、关闭、重启或本地跟踪超时只停止本地监控，不证明远端失败，也不取消远端生成。

| 工具状态 | 含义 | 后续操作 |
| --- | --- | --- |
| `running` | 远端任务仍待执行或正在运行。 | 等待 Job；没有活跃 Job 时才查询同一句柄。 |
| `succeeded` | 远端结果包含 PSD 和图片 URL。 | 保存 URL 清单并显示文件卡片。 |
| `missing_psd` | 远端成功，但没有 PSD，可能仍有图片。 | 把已有图片 URL 保存为不完整结果，并说明缺少 PSD。 |
| `failed`、`cancelled` | 远端任务失败或取消。 | 停止该图的自动调用，继续其他图。 |
| `query_unavailable` | 状态查询失败，远端结果未知。 | 非超时错误一次后停止；超时仅允许所述补查；不重新提交。 |

<a id="conversation-delivery"></a>
## 会话交付

URL 清单是文本文件，不是已下载的 PSD 或图片。它包含完整服务 URL 及可能的签名查询参数，拥有工作区读取权限的人可以查看。结果卡片只表示已记录地址，不证明远端字节仍然可读。会话重新打开时，插件客户端从持久工具事件恢复卡片；按原图分组，PSD 排在分层图片前，并标记不完整结果。下载失败显示在对应卡片上，用户可再次点击。客户端不会向 Host 路由提交任意 URL。

Host 只接受配置允许的结果主机；`generationResultHosts` 为空时，测试环境采用固定主机，生产环境拒绝结果下载。下载拒绝重定向、超大或无效内容，以及未记录的文件定位信息。路由参数不含账号令牌、OSS 凭据或签名 URL。实际保存位置由浏览器的常规下载设置决定。

<a id="failures-and-recovery"></a>
## 失败与恢复

| 阶段 | 可观察结果 | 恢复规则 |
| --- | --- | --- |
| 上传授权或 OSS PUT | 没有确认的源图 OSS URL。 | 排查登录或服务错误；结果不明的写入不自动重复。 |
| 付费代理创建 | `SUBMISSION_UNKNOWN` 或没有确认的句柄。 | 有代理审计 ID 时先用它排查；未查明前不重新提交。 |
| 状态查询或本地 Job | `query_unavailable`、`monitoring_unknown` 或账号失败。 | 保留句柄，按技能的有限重试规则停止该图；其他图片继续。 |
| 清单写入 | 远端 URL 已有，但本地清单或结果卡片未记录。 | 修复工作区权限或主机配置后，使用同一句柄重新保存。 |
| 用户下载 | 卡片已有，但远端文件无法获取或校验。 | 在卡片显示失败并允许再次点击；下载失败不会触发新的付费生成。 |

<a id="evidence-and-limits"></a>
## 证据与限制

[media-upload 实现](../../packages/insight/media-upload/src/index.ts)、[下载路由](../../packages/insight/media-upload/src/result-download.ts)、[客户端卡片](../../packages/insight/media-upload/src/client/LayeringResultCards.tsx)和[技能指令](../../packages/insight/media-upload/guidance/image-layering/SKILL.md)定义当前流程。源码和聚焦测试覆盖本地行为；远端文件可读、代理路由已部署及最终浏览器下载仍需实机验证。远端任务句柄的服务有效期约 24 小时，不是客户端保证。

## 开发备注

无。
