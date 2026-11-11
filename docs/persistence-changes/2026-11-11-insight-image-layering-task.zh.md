---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-11-insight-image-layering-task

[English](2026-11-11-insight-image-layering-task.md) | 中文

## 概述

新增 Session 事件，将因赛图像分层任务的创建名额及原图、参数、账号范围、交付目录绑定并持久化。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-11-insight-image-layering-task
baseline: false
changes:
  - root: "event:insight/image-layering/task"
    previous: null
    after: "0daa9aecdd7c2dd04fe926bf8cbb1a969ab91db4b1901eb755b2a8b6066f47dd"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

没有该事件的旧 Session 仍可读取，并沿用此前仅查询的恢复路径。新事件具有独立判别标记；旧读取方遇到不认识的必需事件时拒绝使用较新的 Session，不会把它误解为旧任务状态。新读取方要求先有绑定记录才允许付费重建或本地缓存，缺失记录不会被解释为重建授权。

<a id="verification"></a>
## 验证

node node_modules/vitest/vitest.mjs run packages/insight/media-upload/tests/image-layering.spec.ts：9 个测试通过，包含持久名额和一次确认重建。node node_modules/typescript/bin/tsc -b packages/insight/media-upload/tsconfig.json --pretty false：通过。

<a id="dev-note"></a>
## 开发备注

无。
