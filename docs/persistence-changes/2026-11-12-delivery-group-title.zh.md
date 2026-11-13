---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-12-delivery-group-title

[English](2026-11-12-delivery-group-title.md) | 中文

## 概述

为 deliverables/presented 事件增加可选 groupTitle，供客户端按原图分开展示文件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-12-delivery-group-title
baseline: false
changes:
  - root: "event:deliverables/presented"
    previous: "2026-09-11-initial"
    after: "feb57edc04d55e088816e46f52e4ccc3cad8e77fa51a012d61efe3ea75f292b6"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

既有事件没有此字段，仍以平铺布局显示。新读取端校验非空白标题，仅将标题相同的连续声明归为一组。旧读取端忽略新增的可选字段，继续读取文件列表。Session 格式版本保持不变。

<a id="verification"></a>
## 验证

present 工具的标题记录和空白标题拒绝聚焦测试通过。使用临时 Vitest 别名指向已安装且兼容 React 18 的测试库后，ui-deliverables 的 73 个测试全部通过；默认本地别名将 React DOM 19 与 React 18 混用。Web Session 快照通过无密钥 Chromium 重放，快照语料检查通过。build:artifacts 与 build:check 通过。

<a id="dev-note"></a>
## 开发备注

无。
