---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-13-insight-image-layering-task-retired

[English](2026-11-13-insight-image-layering-task-retired.md) | 中文

## 概述

移除 Insight 图像分层任务的持久化事件，同时停用创建预留和任务投影。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-13-insight-image-layering-task-retired
baseline: false
changes:
  - root: "event:insight/image-layering/task"
    previous: "2026-11-11-insight-image-layering-task"
    after: null
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

旧读取器能够读取新 Session，因为新版本不再写入该事件。新读取器遇到含必需 insight/image-layering/task 事件的旧 Session 时，会在接管或修改日志前拒绝读取；日志仍保存在磁盘，但本版本无法重新打开。这项历史可读性损失已作为清理任务机制的取舍获得用户接受。事件类型不会复用作其他含义，恢复过程也不会自动创建远端任务。

<a id="verification"></a>
## 验证

图像分层代理测试套件通过（15 项）。存储读取测试覆盖未知必需事件的拒绝行为；生成的已知事件清单不再包含 insight/image-layering/task。

<a id="dev-note"></a>
## 开发备注

无。
