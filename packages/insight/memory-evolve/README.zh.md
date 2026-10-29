---
description: "Memory Evolve 为 Insight DSH 组合提供分层本地记忆、技能与待办管理及其工作区界面。"
kind: "package-bundle"
---

# dsh-memory-evolve

[English](README.md) | 中文

## 概述

本包承载 Insight 使用的固定 Memory Evolve 源码快照。其宿主端保存分层本地记忆并提供既有管理路由，浏览器端提供相应的工作区视图。本迁移步骤不在任何随包 DSH profile 中启用它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

bundle patch 插入保留的 `dsh-memory-evolve` 插件标识符。profile 组合和产品启用由 Insight integration 包负责。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

上游 Host 仅以 JavaScript 分发，因此固定快照位于 [`src/host/`](src/host/) 而非生成的 `lib/`。构建会复制该模块树而不将其打包，从而保留包相对运行时资源。每条浏览器路由在读取或修改本地状态前均执行 DSH connection rejection。Client 使用 DSH 工作区导航完成会话跳转。Memory Evolve 仅随 Insight 客户端更新，不会读取或修改 DSH Git checkout。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 分层记忆上下文

#### 模型看到什么

启用记忆注入时，Host 通过 `ctx.systemPrompt.context` 注册渲染后的记忆快照；`memory` 和 `memory_suggest` 工具是否可用仍由插件运行时配置决定。

#### Token 影响

快照只在渲染后的记忆非空时贡献上下文；已注册工具只在其运行时开关启用时贡献 schema。

#### KV Cache 影响

Host 从本地记忆状态重新计算渲染快照，因此变更后的快照可能替换该段上下文，未变化的值会保留周围请求前缀。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- **组合归属** — 本包不会自行启用；Insight integration profile 必须决定其必需行和默认值。
- **上游兼容性** — 固定源码快照保留更广泛的旧 API 使用；P1 只验证打包及保留的 Client/鉴权适配，不验证付费云工作流。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

[来源记录](upstream.json) 固定上游提交与归档摘要。刷新该快照时应用 [Memory Evolve 补丁](../../../patches/insight/memory-evolve.patch)。

</details>
