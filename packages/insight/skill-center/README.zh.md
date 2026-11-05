---
description: "从侧边栏打开 Insight 技能中心。"
kind: "package-bundle"
---

# @insight-ai/skill-center

[English](README.md) | 中文

## 概述

点击 Insight 侧边栏中**插件**下面的**技能中心**，浏览 OSS 中已发布的技能目录。可以按名称、ID 或简介搜索、查看技能详情，并复制演示安装请求。Insight Desktop 默认包含此包；下载和安装仍为演示。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

点击**技能中心**，在主内容区域浏览技能卡片。打开页面时会读取 [OSS 目录](https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/skills.json)。输入搜索词或提交搜索表单可筛选已读取的目录。读取失败时显示**重试**；已发布目录为空时显示独立空状态。**查看详情**展示完整描述。**复制安装指令**将演示请求写入剪贴板，并报告成功或失败。**下载 ZIP**仅显示演示提示，不下载文件。点击**插件**或会话可离开该页面。此包提供中文和英文文案；其他语言使用语言注册表的回退机制。

目录请求默认在 15 秒后超时，包含 JSON 正文读取。可在 `cordis.yml` 的插件配置中通过 `catalogRequestTimeoutMs` 修改这一正数毫秒预算；页面重新加载后生效。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

[包补丁](cordis.patch.yml)挂载 Host 配置和浏览器插件。[浏览器入口](src/client/index.ts)向现有侧边栏面板列表和带键主面板注册内容，并等待各插槽声明。侧边栏负责选中状态和折叠导航。插件注册可取消的 Client 资源提供方来读取 OSS 目录，校验 JSON，仅保留已启用且有技能 ID 的记录，并按 `sort` 排序。页面通过 `useResource` 读取，搜索和选中状态由组件持有；手动重试发起新请求，离开页面会取消未完成的请求。输入框、按钮、弹窗行为和反馈使用 DSH 基础组件；语义主题变量跟随应用外观，包括通过 portal 渲染到 body 的浮层。Shell 浮层独立于页面承载临时反馈。卸载插件会释放注册和字典。布局根据主面板宽度适配，并避让 macOS 标题栏。

</details>

<a id="model-experience"></a>
## 模型体验

### 技能中心页面

#### 模型看到什么

`@insight-ai/skill-center` 包显示已发布的技能目录，不增加工具、模型请求或 Session 事件。复制请求只写入剪贴板，不会发送给模型。

#### Token 影响

打开页面不会增加模型输入 token。

#### KV Cache 影响

打开页面不会改变模型请求或缓存前缀。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- 目录读取依赖网络及 OSS 对应用来源的 CORS 授权。技能名称和描述使用目录中的语言；切换应用语言只翻译控件。
- 下载、安装和管理技能尚未接入。复制的请求仅用于演示，无法安装技能包。
- 此私有包随 Insight Desktop 分发；标准 DSH Web 配置不启用它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护工作上下文——点击展开</summary>

没有额外的维护约束。

</details>
