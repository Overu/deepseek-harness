---
description: "供私有桌面发行版维护者使用的 Insight Desktop 认证、账号隔离 DSH Home 选择、安全 Main-to-Host 凭据、工作区品牌与退出生命周期。"
kind: "package-bundle"
---

# @insight-ai/desktop-integration

[English](README.md) | 中文

## 概述

Insight Desktop 使用此私有 bundle 提供产品品牌、Host 启动前认证、逐账号 DSH Home、仅 Host 可用的凭据服务、托管模型网关和已登录账号设置。Insight profile 在启动和 profile 升级时加入本 bundle，并在插件恢复时保留。官方 Desktop profile 不包含本包。Insight 应用负责此私有 bundle 的版本和初始激活。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 产品自有激活

Insight 应用在认证选出安全 Home 后，将 `@insight-ai/desktop-integration` 加入账号 profile。Profile 准备会给已有账号 profile 补上缺失声明，插件恢复则在禁用其他第三方 bundle 时保留本 bundle。本包为私有包，没有独立安装路径；官方 Desktop 组合保持不变。

### 你得到什么

在 Host 存在之前，原生登录窗口保留 Insight 品牌面板、交互点阵和短信/密码表单，并提供协议链接、凭据恢复和逐账号 Home 选择。Desktop Main 在已打包构建中把凭据保存在 Electron 加密存储中，只暴露渲染器安全的登录状态。

工作区打开后，本 bundle 使用 Insight 图稿填充侧边栏和会话首屏品牌 occupant，在侧边栏页脚加入头像与账号菜单，提供使用手册、设置和退出操作，并在 Host 中挂载 `ctx.insightAccount`。可信 Host 插件可通过有界且可取消的子进程 IPC 请求当前访问令牌。浏览器只接收显示名、脱敏手机号、头像 URL、产品/运行时信息和退出操作，绝不接收访问令牌。

设置统一从账号菜单进入。`settings.launcher` occupant 只把请求转发给既有设置面板，不渲染独立的侧边栏按钮。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Desktop Main 在 Electron 读取 `userData` 前选择 Insight 产品，完成登录、校验账号 Home，再以不可变账号上下文启动一个 Host。独立登录界面导出为 `@insight-ai/desktop-integration/client/login`，其样式表导出在 `@insight-ai/desktop-integration/client/*.css` 下；两者都保持在 Client 编译面。Bundle patch 只在 Insight profile 中禁用上游账号路径和官方品牌 occupant。官方产品仍以其既有 profile 和账号组合启动。

本包既是被选中的 profile bundle，也是其 Host 插件的所有者。`cordis.patch.yml` 必须以 `./lib/index.js` 挂载该插件；bundle patch 解析会把相对路径锚定到 patch 文件旁。DSH 运行时包查找会排除被选中的 bundle 包本身，因此该条目绝不能使用自身包名 `@insight-ai/desktop-integration`。这是包解析要求，不是 Loader 排序要求。

Host 服务校验请求与响应字段、限制并发令牌请求、应用截止时间，并在调用方取消或 IPC 通道关闭时取消待处理请求。Desktop Main 只接受当前 Host 子进程的请求，关停或替换后丢弃迟到响应。退出会撤销新的账号访问、隐藏工作区、停止账号自有资源、清除认证，并且只在关停完成后重启回登录门。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 仅 Insight 使用的 Host 与 Client 组合变化 |
| [`src/desktop.ts`](src/desktop.ts) | Main 进程认证、凭据存储、账号 scope 和 Home 准备导出 |
| [`src/protocol.ts`](src/protocol.ts) | 渲染器安全 Desktop API 与经校验的父进程/Host IPC 消息 |
| [`src/host/`](src/host/) | 仅 Host 使用的 `ctx.insightAccount` 提供方与托管网关适配器 |
| [`src/client/`](src/client/) | 工作区品牌与账号页脚 occupant |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Insight 子系统](../../../docs/subsystems/insight.zh.md) — 产品标识、启动顺序、账号存储、进程数据流和阶段边界。
- [Insight 基线集成记录](../../../docs/subsystems/insight-baseline-changes.zh.md) — 私有发行版修改的官方 DSH 文件。
- [Insight 包索引](../README.zh.md) — 相邻私有产品组件及其激活状态。
- [Desktop 应用架构](../../../docs/architecture.zh.md) — 上游 Desktop profile、Host 与 Client 组合。

-----

<a id="model-experience"></a>
## 模型体验

### 账号凭据

#### 模型看到什么

没有直接内容。`insightAccount` 服务只向可信 Host 消费方提供访问令牌，不增加提示词章节、工具 schema、消息或 Session 事件。

#### Token 影响

固定的 `yinsai-gateway/deepseek-flash` 提供方使用正常 Agent 请求的 token；账号服务不增加提示词文字。用户无需配置模型凭据，产品组合禁用模型设置页。

#### KV Cache 影响

没有直接影响。账号呈现与认证状态不进入模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **此处不迁移旧账号数据**——已有 `harness` Home、非空且无标记的 `harness-native` Home 或不匹配的标记会返回 `migration-required`；本包不读取或改写这些数据。
- **Insight 产品界面仅支持中文**——P2 不为登录、账号页脚或 Insight 原生标签增加语言选择或翻译。
- **尚未接入 Insight 更新交付**——Insight 产品不运行官方自动更新计划，手动检查会报告暂时无法检查；OSS/CDN 交付不属于本包。
- **未激活业务组件**——Canvas、Memory 和 Prompt 源码进入依赖闭包，但不会加入 P2 Insight profile。
- **运行期插件管理尚未强制必需组件策略**——P2 会在受管理的生命周期节点加入并恢复 Integration，但 Plugin Manager 仍可将其停用；P3 负责用统一策略阻止停用或卸载 Integration、Canvas、Memory 和 Prompt。
- **Host 凭据服务没有浏览器或 Remote API**——只有同进程 Host 插件可以使用它，并且它们获得结构化失败原因，而不是 Main 进程诊断信息。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
