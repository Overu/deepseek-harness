---
kind: upgrade-guide
description: "移除 present.groupTitle 可选参数和通用交付卡片的分组展示。"
---

# present 分组标题

[English](guide.md) | 中文

## 变更

通用 `present` 工具不再接受 `groupTitle`，新写入的 `deliverables/presented` 事件也不含此字段。通用交付文件恢复原有的平铺卡片。因赛图像分层结果改由 media-upload 插件自有卡片和点击下载入口处理。含分组标题的旧 Session 事件仍可读取，但当前通用卡片忽略该标题。详见[持久化变更记录](../../../persistence-changes/2026-11-13-delivery-group-title-retired.zh.md)。

## 迁移

1. 从 `present` 调用中移除 `groupTitle`；本地文件仍放在 `files` 中，若只需文字说明可在普通回复中使用标题。
2. 图像分层任务完成后，调用 `cache_image_layering_result({taskHandle,imageLabel})`。其结果卡片按原图分组，用户点击后下载选中的文件；不要把 OSS URL 传给 `present`。
3. 确认新的通用文件交付以平铺列表展示，图像分层结果则有独立标题和“下载”按钮。
