---
name: image-layering
description: 将用户在同一会话最近三个用户轮次上传的一张原图按要求分层，异步生成并交付 PSD 与分层图像。用户要求图片分层、拆图层、提取图层或图像解构时使用。
---

# 图像分层

`image-layering` 是技能名，不是可调用的工具名。仅询问技能作用时，用一两句说明“选择图片，交给图像分层模型处理，然后交付 PSD 和分层图像”；必要时说明图片会上传用于处理。仅问功能或模型名称时，不调用来源、上传或生成工具；对外只称“图像分层模型”。

## 处理图片

1. 调用 `prepare_image_layering_source` 查看本 Session 最近三个含用户直接消息的轮次中的原图。若没有原图，请用户重新上传；只有一张时可直接继续。若多张且用户未明确指出哪一张，按文件名和轮次询问；在选定前不要上传或创建任务。用户本轮明确说“这张图”且本轮仅有一张时，选本轮图。不得读取其他 Session、文本路径或模型猜测的 URL。
2. 调用 `submit_image_layering`，用选中的 `sourceRef`；恰好只有一张候选时可省略。`prompt` 使用用户原话，无要求时为 `""`；`numLayers` 使用用户指定的非负整数，未指定为 `0`。该工具在 Host 内上传选中的原图并创建任务，不调用普通 `upload_attachment`，也不要求用户再次同意 OSS 上传。不要将技能名当工具名调用。
3. 保存 `taskHandle`，通过 Job 结果或 `get_image_layering({taskHandle,watch:true})` 跟踪。`job_kill` 只停止本地跟踪，不取消远端生成。`proxyRequestId` 和 `jobId` 不能替代 `taskHandle`。
4. 对同一句柄的第一次确定失败、缺失 PSD 或不完整结果再查询一次。有可用分层图片但缺少 PSD 时先缓存图片；缓存失败时先恢复本地缓存，不重建。Job 返回 `retry_eligible` 时，仅对第一次创建的任务调用一次 `retry_image_layering({taskHandle})`；它沿用绑定的原图和参数。第二次创建仍失败即停止。创建结果未知、查询结果未知、账号变化、远端取消、用户要求停止时不得重新创建付费任务。
5. Job 成功结果若带 `cache.complete: true`，直接使用其已验证本地文件；否则调用 `cache_image_layering_result({taskHandle})` 恢复缓存。Job 和缓存工具均需下载并验证全部合法 PSD 与分层图片。只有 `complete` 为 `true` 才能称为完整交付；缓存失败只重试缓存或查询原句柄，不重新创建。`relocationFailed` 为 `true` 时，本地文件仍保留在最初工作区，应简要告知用户目录切换后的搬迁未完成。
6. 将返回的全部本地文件按 PSD 在前、其他图片在后的顺序调用 `present`，每次最多 8 个文件，文件说明使用“分层 PSD”或“分层图像 1”等简短文字。确认每批 `present` 成功后，最终仅回复“处理完成，文件见下方”。不要在普通完成回复中列远端 URL、绝对路径、任务句柄、内部状态或未经验证的图层数。

## 停止与错误

- 上传、付费创建、查询、缓存、交付是不同阶段。失败时只报告实际失败阶段及可执行的下一步；HTTP 200、Job 结束或 Shell 的 `isError: false` 均不单独证明文件已交付。
- 结果诊断中的 `field`、`reason`、`valueType`、`queryAttempt` 和 `proxyRequestId` 可用于排障，不要把 `psd_url` 错误说成 `image_list` 错误；不要在普通回复中输出带签名参数的 URL。
- Host 缓存因主机配置、TLS、下载、校验或沙箱失败时，保留 `taskHandle` 并报告缓存失败；不得改用 Shell、PowerShell、curl、Python 或本技能的兼容脚本下载结果，不得编写下载脚本或关闭证书校验。Windows 或 macOS 的工作区不可写时，向用户说明需要调整的目录权限并等待确认；不自行修改 ACL、owner 或执行权限修复命令。
