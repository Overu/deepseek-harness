---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-06-insight-original-image-file

[English](2026-11-06-insight-original-image-file.md) | 中文

## 概述

为持久化图像内容增加可选的原始文件引用，使 Insight Desktop 上传工具能够传输用户图像的原始字节。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-06-insight-original-image-file
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-28-insight-canvas-attribution"
    after: "7947889c4f1c0e027cea11f6319d554790d479eceb6361fddc9e9a7d44c971a0"
    decision: same-version
  - root: "event:assistant/attempt"
    previous: "2026-09-16-session-format-v4"
    after: "1698df490d8ec68b7750daf55465ea42b9da2bd08a3e5bb07e771c5693d6c56e"
    decision: same-version
  - root: "event:assistant/message"
    previous: "2026-09-16-session-format-v4"
    after: "0b469a61db1325137e7a6b89ee6c08cac5cb8b1b161e6befa08bcea5bcc001ef"
    decision: same-version
  - root: "event:compaction/summary"
    previous: "2026-09-16-session-format-v4"
    after: "9a58d3e2095f1c378b16e5e10f75b8f3eac3beb9ddeb7f2d935f256f39331241"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-28-insight-canvas-attribution"
    after: "807ea6fc6aeaa6340a7476e6b32dcb513f2c09cecb00a1c1f03ee08d1d5e324f"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-28-insight-canvas-attribution"
    after: "5ec1642da03b78a6bf03c47d268403e0ca6901378ba66f145890755a19ef6053"
    decision: same-version
  - root: "event:system/message"
    previous: "2026-09-16-session-format-v4"
    after: "6e9219a04c693130b6a68223eba71516bdaa60290f98d43986c5000f5e247006"
    decision: same-version
  - root: "event:team/message/queued"
    previous: "2026-09-16-session-format-v4"
    after: "304a096ad87515e23c17c1cec14b69a18b4634ae2841f8fabd405ec9c372c97a"
    decision: same-version
  - root: "event:tool/ptc-dispatch"
    previous: "2026-10-05-ptc-operation-metadata"
    after: "64ef95a4d441aa6be3c70fdccce39766b03b97d160cce7e20fc2eaa16017dd0a"
    decision: same-version
  - root: "event:tool/result"
    previous: "2026-09-16-session-format-v4"
    after: "88d8aabe4e5733db80afb04f57b0b5fce41664aa53c997f644c5828843402e81"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-28-insight-canvas-attribution"
    after: "2958652fdd618dafa4008177ddf1cfcf674fa5636d25c9f3a3218d40325bee9a"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

没有 originalFile 的既有图像记录仍有效，并继续使用归一化图像供模型读取。新读取方将缺少 originalFile 解释为上传工具无法取得原件。新增字段不改变图像显示或模型适配器使用的附件。Insight agent-team 读取方现已接受该可选字段。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/insight/media-upload/tests/upload.spec.ts packages/api/session-controller/tests/commands-upload-file.host.spec.ts packages/experimental/agent-team/tests/projection-events.spec.ts apps/desktop/tests/main-startup.spec.ts：224 个测试通过。pnpm run build:artifacts：8 个门禁通过。

<a id="dev-note"></a>
## 开发备注

无。
