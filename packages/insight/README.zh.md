---
description: "Insight 桌面发行版使用的私有产品组件与固定社区源码。"
kind: "package-group"
---

# insight/ — Insight 桌面组件

[English](README.md) | 中文

## 摘要

本组集中维护 Insight Desktop 集成以及固定的 Canvas、记忆和提示词增强源码。私有组件随桌面发行版交付，不进入公开 npm 基线。Insight profile 将 Integration、Canvas、Memory 和 Prompt 作为必需组件，保留组件内部功能开关。官方 Desktop profile 不激活其中任何组件。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

这些组件归属于同一 Insight 产品发行版。

| 包 | 职责 |
| --- | --- |
| [desktop-integration](desktop-integration/README.zh.md) | 登录、账号隔离 Home、托管模型、产品设置与工作区品牌 |
| [canvas](canvas/README.zh.md) | 画布工具、结果呈现与嵌入业务页面 |
| [memory-evolve](memory-evolve/README.zh.md) | 固定的记忆、技能和任务管理源码 |
| [prompt-enhance](prompt-enhance/README.zh.md) | 输入区提示词增强 |

<a id="related-documentation"></a>
## 相关文档

- [Insight 子系统](../../docs/subsystems/insight.zh.md) — 产品归属与源码同步
- [基线集成记录](../../docs/subsystems/insight-baseline-changes.zh.md) — 既有官方文件变化
- [应用架构](../../docs/architecture.zh.md) — profile 和 bundle 组合

<a id="dev-note"></a>
## 开发备注

无。
