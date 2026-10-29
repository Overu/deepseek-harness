---
description: "Insight 桌面发行版使用的私有产品组件与固定社区源码。"
kind: "package-group"
---

# insight/ — Insight 桌面组件

[English](README.md) | 中文

## 摘要

本组集中维护 Insight 的 Canvas、记忆和提示词增强源码及其构建输入。各组件保留已有加载标识，并记录上游版本。私有组件随桌面发行版交付，不进入公开 npm 基线。官方 Desktop profile 不启用这些组件。

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
