---
description: "Insight 桌面发行版使用的私有产品组件与固定社区源码。"
kind: "package-group"
---

# insight/ — Insight 桌面组件

[English](README.md) | 中文

## 摘要

本组维护随 Insight profile 交付的私有 Insight Desktop 组件。Desktop 在启动时加载产品组合，恢复时保留这些组合。各组件负责自己的内部功能开关。

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
| [media-upload](media-upload/README.zh.md) | 经审批将当前轮次附件上传至 OSS，并提供登录态图像分层工具 |
| [memory-evolve](memory-evolve/README.zh.md) | 固定的记忆、技能和任务管理源码 |
| [prompt-enhance](prompt-enhance/README.zh.md) | 输入区提示词增强 |
| [skill-center](skill-center/README.zh.md) | 账号平台技能的安装与发现 |
| [builtin-skill-extensions](builtin-skill-extensions/README.zh.md) | 内置 Office 工作流的补充指引 |

<a id="related-documentation"></a>
## 相关文档

- [Insight 架构](../../docs/insight/architecture.zh.md) — 产品归属与源码同步
- [基线集成记录](../../docs/insight/baseline-changes.zh.md) — 既有官方文件变化
- [应用架构](../../docs/architecture.zh.md) — profile 和 bundle 组合

- [生成账号 API](../../docs/subsystems/insight.zh.md) — 由生成器维护的服务参考

<a id="dev-note"></a>
## 开发备注

无。
