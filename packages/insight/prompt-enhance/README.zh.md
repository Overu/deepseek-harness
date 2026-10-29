---
description: "在不修改 DSH 基础 Profile 的前提下为输入框加入提示词增强。"
kind: "package-bundle"
---

# dsh-prompt-enhance

[English](README.md) | 中文

## 概述

为 DSH 输入框加入增强操作，通过已配置模型改写草稿，并允许用户预览、应用或撤销结果。Insight 集成 Profile 显式应用此 bundle；它不修改 DSH 的已发布 Profile。除非插件配置同时提供 provider 和 model，否则操作使用当前会话路由。原始草稿会一直保留到用户应用结果。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Insight 自己管理的 Profile 应用 [cordis.patch.yml](cordis.patch.yml) 以加入 `prompt-enhance` 行；本包不会自行加入任何 DSH Profile。

### 获得的能力

Host 注册增强请求路由和命令，Web Client 添加输入框操作、结果面板和撤销栏。Client 通过 `configForms` 读取设置，通过 `attachmentIds` 统计草稿附件，并遵从 DSH 文档主题属性。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

[cordis.patch.yml](cordis.patch.yml) 插入一条名为 `prompt-enhance` 的行。Host 验证配置、解析模型路由并流式返回模型结果。Client 负责草稿交互，在用户选择应用前不会改变待提交的对话内容。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [DSH 架构](../../../docs/architecture.zh.md)——Profile、bundle 和客户端插件。
- [Web Client](../../../docs/subsystems/web-client.zh.md)——Host 与浏览器组合。
- [对话界面](../../client/ui-conversation/README.zh.md)——输入框插槽与草稿附件。

<a id="model-experience"></a>
## 模型体验

### 草稿增强请求

#### 模型看到的内容

解析后的模型会收到已配置的增强指令、选中的输入框草稿，以及启用 `contextAware` 时经过上限约束的近期 Session 上下文。此辅助请求不会进入当前对话历史，直到用户应用结果并在之后提交输入框。

#### Token 影响

每次增强都是一个独立模型请求，包含增强指令、封装后的草稿和可选的受限上下文。它不会改变已经组装完成的对话请求 token 数。

#### KV Cache 影响

独立的增强请求不复用当前对话请求的缓存。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- bundle 需要 Insight 管理的 Profile patch；任何 DSH 已发布 Profile 都不会默认挂载它。
- Host 路由在增强草稿前需要可解析的模型路由。

<a id="dev-note"></a>
### 开发备注

导入的源码版本和可复现的本地差异记录在 [upstream.json](upstream.json) 与 [prompt-enhance.patch](../../../patches/insight/prompt-enhance.patch)。
