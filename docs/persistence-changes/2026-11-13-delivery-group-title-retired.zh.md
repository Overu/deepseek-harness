---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-13-delivery-group-title-retired

[English](2026-11-13-delivery-group-title-retired.md) | 中文

## 概述

图像分层卡片迁入 media-upload 插件后，新写入的 deliverables/presented 事件不再包含可选的 groupTitle。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-13-delivery-group-title-retired
baseline: false
changes:
  - root: "event:deliverables/presented"
    previous: "2026-11-12-delivery-group-title"
    after: "13d3d180f977bf78081d487ffa0ecb75857349bcab29a5a3fb48189fca2a6176"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新读取器仍能读取含 groupTitle 的旧 deliverables/presented 事件，因为 Session 接纳逻辑不会因这一额外载荷字段拒绝事件；当前客户端读取文件列表并忽略已停用的标题。旧读取器可读取不含该可选字段的新事件。事件判别值未复用，Session 格式版本不变。

<a id="verification"></a>
## 验证

已检查 Session 事件接纳逻辑和当前交付模块读取代码。media-upload 测试套件通过；present 的八项聚焦测试通过。另两项 present 符号链接用例在此 Windows 设备因无法创建链接（EPERM）未通过。已重新生成持久化目录与已知事件清单。

<a id="dev-note"></a>
## 开发备注

无。
