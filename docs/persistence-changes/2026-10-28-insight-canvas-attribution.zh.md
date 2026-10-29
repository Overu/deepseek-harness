---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-28-insight-canvas-attribution

[English](2026-10-28-insight-canvas-attribution.md) | 中文

## 概述

将 canvas-run 和 canvas-process 声明为画布完成消息的信息性来源标签。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-28-insight-canvas-attribution
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "a20547272f8b6ad27a58866ed36b62770a0afcb63d67f8de211880be1b3ddcb4"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "16b0c54d30a26bcc8a08071b14d38640e175ccf0716e48cc816f24e78a4cfff0"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "52710cace6e8e49a67fb69b59f762772932e0cb92d74629da429670caa606453"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "e1c99ce1ed85572999116212c492760ff0584d5ef4facbce476dd9b30f24aa46"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新增标签保留所有既有来源分支和当前 Session 写入版本。已发布的 V4 读者接受非空且不是已退役 plugin 包装的来源 kind，保留其 JSON 元数据，并在没有来源插件时继续派生消息内容。新标签不授予校验、执行、回放或授权能力。新读者继续接受历史标签；消息位于收件箱、开发者消息或标题请求记录中时也适用。

<a id="verification"></a>
## 验证

Node24 Vitest：packages/session/session-format-v3-to-v4/tests/attribution.spec.ts 与 packages/session/session-persistence-jsonl/tests/native-source-admission.spec.ts 共 34 项通过；Canvas 回归 417 项通过。

<a id="dev-note"></a>
## 开发备注

无。
