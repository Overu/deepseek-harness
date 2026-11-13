---
kind: upgrade-guide
description: "Insight 图像消息不再提供可选的 originalFile 引用。"
---

# Insight 原图文件

[English](guide.md) | 中文

## 变更

`ImageBlock.originalFile` 已移除。Insight 对普通图片消息上传已保存的归一化图片字节；文件附件仍保留原始字节。旧 Agent Teams 排队消息若包含 `originalFile`，严格解析图像内容时可能无法恢复。参见[持久化变更记录](../../../persistence-changes/2026-11-13-insight-original-image-file-retired.zh.md)。

## 迁移

1. 停止读写 `ImageBlock.originalFile`；归一化图片使用 `ImageBlock.attachment`。
2. 如需精确保留原始字节，请让用户在新会话中以文件附件形式上传图片。
3. 对无法恢复的旧 Agent Teams 会话创建新会话，并确认新上传图片可通过 `prepare_image_layering_source` 选择。
