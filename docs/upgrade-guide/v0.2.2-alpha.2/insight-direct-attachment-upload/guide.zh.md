---
kind: upgrade-guide
description: "因赛 Desktop 的 upload_attachment 工具改为直接上传 OSS，不再返回企业附件 ID。"
---

# 因赛附件改为直接上传 OSS

[English](guide.md) | 中文

## 变更

因赛 Desktop 的 `upload_attachment` 工具现在从 `/game-ai-editor-center/upload/sts/token` 取得临时凭证，并把选中的原始文件写入 OSS。它不再调用 `/insight-harness-service/api/files/sts` 或 `/api/files/oss-complete`。成功结果包含 `url`、`urlAccess`、`filename` 和 `sizeBytes`；`attachmentId` 已移除。对象不会登记到企业附件列表，URL 的读取权限也未验证。

## 迁移

1. 将 `upload_attachment` 结果的消费方改为把 `url` 作为 OSS 对象地址。移除对 `attachmentId` 的读取，以及结果会出现在 `/insight-harness-service/api/files` 的假设。
2. 如果流程需要企业附件 ID，应另外使用企业 STS 与完成登记接口。上传中心的直连 STS 响应无法提供完成登记所需的企业 `uploadTicket`。
3. 在测试环境验证上传结果包含四个字段、OSS 已确认写入，并确认流程不要求企业附件登记。
