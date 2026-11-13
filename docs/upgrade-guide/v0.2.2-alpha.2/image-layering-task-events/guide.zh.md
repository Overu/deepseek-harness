---
kind: upgrade-guide
description: "图像分层任务事件不再写入，含旧事件的 Session 也无法重新打开。"
---

# 图像分层任务事件

[English](guide.md) | 中文

## 变更

Insight 媒体插件不再写入 `insight/image-layering/task` 事件，也不再注册任务投影。重复调用 `submit_image_layering` 可能创建另一个付费任务。本版本拒绝重新打开含有旧版必需任务事件且未标记 `ignorable: true` 的 Session；已存储日志不会被删除或改写。`retry_image_layering` 已移除。已知的 `taskHandle` 仍可用于查询任务并将结果缓存到当前工作区。

## 迁移

1. 升级前，在包含 `insight/image-layering/task` 的 Session 中完成分层工作；如需查看旧会话，保留旧版客户端。将需要继续查询的 `taskHandle` 记录在受影响 Session 之外。
2. 升级后，新建 Session 处理图像分层。使用已知句柄调用 `get_image_layering` 查询现有远端任务，再用 `cache_image_layering_result({taskHandle,imageLabel})` 将结果 URL 保存到当前工作区并显示下载卡片；不要通过重复提交来查询状态。
3. 确认新 Session 可以打开，且单次提交返回 `taskHandle`。读取行为详见[持久化变更记录](../../../persistence-changes/2026-11-13-insight-image-layering-task-retired.zh.md)。
