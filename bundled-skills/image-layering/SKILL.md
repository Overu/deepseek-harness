---
name: image-layering
description: 将用户在当前对话上传的一张图片按要求分层，异步生成并交付 PSD 文件。当用户要求图片分层、拆图层、提取图层或图像解构时使用。
---

# 图像分层

将当前轮次上传的图片送入 `decompose-1.0-flash`。使用 Desktop 的 `upload_attachment`、`submit_image_layering`、`get_image_layering`、Jobs、Shell 和 `present`；不要自行读取账号凭据或直接调用企业接口。

## 操作顺序

1. 当前轮次须有一张用户原始图片。调用 `upload_attachment`；有多个附件时选择相应的 `attachmentIndex`。等待审批和 OSS 上传成功，只取结果中的 `url`。
2. 调用 `submit_image_layering`，`imageUrl` 使用刚才的 URL，`prompt` 使用用户的处理要求，未提供时填 `""`；`numLayers` 使用用户指定的非负整数，未指定时填 `0`。工具固定模型与任务类型。
3. 保存结果中的 `taskHandle`，不要把 `proxyRequestId` 或 `jobId` 当作上游任务句柄。已有 `jobId` 时用 `job_output` 等待或读取；不要重复提交付费创建。Job 停止、客户端重启或本地跟踪超时后，调用 `get_image_layering({taskHandle,watch:true})` 恢复查询，服务句柄约 24 小时有效。
4. 查询结果为 `succeeded` 且 `psdUrls` 非空时，逐个运行本技能的 `scripts/download_psd.mjs`，参数是对应 PSD URL；按当前 Shell 的规则完整引用 URL 参数，不能把未引用的 URL 拼入命令。用当前 Session 的 Shell 工具执行，工作目录保持当前 Session 工作区；优先使用已配置的 `DSH_SKILL_PROXY_NODE`，否则使用可用的 `node`。脚本把真实 PSD 写入 `generated/image-layering/` 并输出 JSON `path`、`sizeBytes`。
5. 对每个下载成功的文件，调用 `present({files:[{path:"<脚本返回的绝对路径>",description:"图像分层 PSD"}]})`。在最终回复中给出本地文件链接、相应远端 PSD URL 和任务状态。PSD 作为文件卡片交付；不承诺聊天框内直接预览可编辑图层。

## 结果与失败

- `running` 继续等待 Job 或按需查询；`missing_psd` 表示上游已完成但只有其他图片，明确报告未获得 PSD，可说明 PNG 数量，不把 PNG 当成 PSD。
- `failed`、业务错误和未知状态需分别说明。上传成功、代理 HTTP 200、`accepted`、Job 结束，都不是 PSD 成功的充分证据。
- `SUBMISSION_UNKNOWN` 时不要自动重发创建；保留 `proxyRequestId` 供代理审计定位。查询失败或本地 Job 停止时保留 `taskHandle`，不能写成远端失败。
- PSD 下载失败时保留已获得的远端 URL 和 `taskHandle`，说明本地交付失败，不重新创建任务。下载脚本默认只允许已验证的测试 OSS 主机；生产部署须通过 `INSIGHT_LAYERING_PSD_HOSTS` 配置实际结果主机。此变量仅列主机名，不能放入令牌。
- 结果 URL 若带访问参数，只在当前对话中交付，不写入技能文件或公共日志。若 Job 完成时没有开放轮次，待完成通知唤起下一轮后再下载并调用 `present`。