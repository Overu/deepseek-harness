---
description: "供私有桌面发行版维护者使用的 Insight Desktop 认证、账号隔离 DSH Home 选择、安全 Main-to-Host 凭据、工作区品牌与退出生命周期。"
kind: "package-bundle"
---

# @insight-ai/desktop-integration

[English](README.md) | 中文

## 概述

Insight Desktop 使用此私有 bundle 提供产品品牌、Host 启动前认证、逐账号 DSH Home、仅 Host 可用的凭据服务、托管模型网关、已登录账号设置和已签名更新策略。Insight profile 在启动和 profile 升级时加入本 bundle，并在插件恢复时保留。官方 Desktop profile 不包含本包。Insight 应用负责此私有 bundle 的版本和初始激活。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [业务服务](#business-services)
- [桌面更新](#desktop-updates)
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

在 Host 存在之前，原生登录窗口保留 Insight 品牌面板、交互点阵和短信/密码表单，并提供协议链接、凭据恢复和逐账号 Home 选择。窗口在恢复已保存凭据期间保持隐藏；认证及 Home 准备成功后直接进入工作区，凭据不可用或 Home 准入失败时才显示现有登录或恢复页面。Desktop Main 在已打包构建中把凭据保存在 Electron 加密存储中，只暴露渲染器安全的登录状态。 随包服务协议和隐私政策在登录窗口内打开，标题与页脚控件固定、正文独立滚动，支持 Escape 关闭并恢复焦点。阅读或关闭协议不会自动同意协议或提交登录。

工作区打开后，本 bundle 使用 Insight 图稿填充侧边栏和会话首屏品牌 occupant，在侧边栏页脚加入头像与账号菜单，提供使用手册、设置和退出操作，并在 Host 中挂载 `ctx.insightAccount`。可信 Host 插件可通过有界且可取消的子进程 IPC 请求当前访问令牌。浏览器只接收显示名、脱敏手机号、头像 URL、产品/运行时信息和退出操作，绝不接收访问令牌。

侧边栏、会话首屏、登录和更新窗口共用 `src/client/assets/brand-mark.svg`：圆角蓝底上的白色 Insight 标志，在浅深主题中保持固定颜色和留白。`resources/branding/` 中的桌面应用图标使用同一图稿。专家技能入口复用 Shell 的四芒星描边标志。账号入口保留已有头像；未提供头像时使用蓝底首字，取去除两端空白后的显示名首字符，空值回退为“因”。侧边栏收起时仍提供同一账号菜单。

设置统一从账号菜单进入。`settings.launcher` occupant 只把请求转发给既有设置面板，不渲染独立的侧边栏按钮。

原生更新窗口与后台计划采用相同的常规检查策略：正式版应用检查已签名正式版，预发布应用在没有可用正式版更新时继续检查内测版。在三秒内连续点击 Insight 标志五次会打开原生风险确认，批准后执行一次显式内测检查。发现更新不会下载，下载也不授权安装。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Desktop Main 在 Electron 读取 `userData` 前选择 Insight 产品，完成登录、校验账号 Home，再以不可变账号上下文启动一个 Host。独立登录界面导出为 `@insight-ai/desktop-integration/client/login`，其样式表导出在 `@insight-ai/desktop-integration/client/*.css` 下；两者都保持在 Client 编译面。Bundle patch 只在 Insight profile 中禁用上游账号路径和官方品牌 occupant。官方产品仍以其既有 profile 和账号组合启动。

本包既是被选中的 profile bundle，也是其 Host 插件的所有者。`cordis.patch.yml` 必须以 `./lib/index.js` 挂载该插件；bundle patch 解析会把相对路径锚定到 patch 文件旁。DSH 运行时包查找会排除被选中的 bundle 包本身，因此该条目绝不能使用自身包名 `@insight-ai/desktop-integration`。这是包解析要求，不是 Loader 排序要求。

Client 激活时先挂载本包生成的 Remote contribution，再安装产品插槽。技能 namespace 由此次挂载创建，并随 Client 插件卸载。

Host 服务校验请求与响应字段、限制并发令牌请求、应用截止时间，并在调用方取消或 IPC 通道关闭时取消待处理请求。Desktop Main 只接受当前 Host 子进程的请求，关停或替换后丢弃迟到响应。退出会撤销新的账号访问、隐藏工作区、停止账号自有资源、清除认证，并且只在关停完成后重启回登录门。

未取消的 Gateway 失败会在既有、可被 Session 查看的 LLM 失败消息中保留脱敏诊断。该诊断区分 Main 账号令牌获取失败与模型请求或流失败，并且只在可得时包含结构化的 source、错误码、errno、syscall 或 HTTP 状态；不包含凭据、请求头、提示词、请求和响应正文、URL 或 Session 标识。PiAi 可能丢弃上游原因，因此通用传输失败不一定能进一步定位。

更新发现先校验 Ed25519 签名的投放指针、release 或目标 manifest、updater 元数据、目标身份、版本、大小和 SHA-512，然后 Desktop 适配器才创建 electron-updater custom provider。Desktop Main 在登录与工作区启动期间始终拥有唯一 updater 实例。渲染器只接收状态和固定操作，不接收 feed URL、本地路径、签名密钥或可信产物身份。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 仅 Insight 使用的 Host 与 Client 组合变化 |
| [`src/desktop.ts`](src/desktop.ts) | Main 进程认证、凭据存储、账号 scope 和 Home 准备导出 |
| [`src/protocol.ts`](src/protocol.ts) | 渲染器安全 Desktop API 与经校验的父进程/Host IPC 消息 |
| [`src/host/`](src/host/) | 仅 Host 使用的 `ctx.insightAccount` 提供方与托管网关适配器 |
| [`src/client/`](src/client/) | 工作区品牌、账号页脚 occupant 与分类技能选择器 |
| [`src/desktop/update/`](src/desktop/update/) | 已签名投放校验、来源解析、持久化本地选择和产品更新策略 |
| [`src/client/update/`](src/client/update/) | 渲染器安全的原生更新窗口呈现 |

</details>

<a id="business-services"></a>
## 业务服务

Host 通过 DSH 的公开 Web 注册表挂载 Insight 企业搜索提供方。每次搜索均创建独立的上游提供方，并将该次搜索的取消信号传给令牌请求。停机时先注销提供方，再中止并等待已接收工作结束，最后才释放账号服务。

内置技能通过 `$DSH_HOME/skill-proxy/connection.json` 中账号隔离的回环代理描述文件调用服务。该描述文件带有单次启动能力令牌，不包含账号令牌。代理仅接受携带能力令牌的 JSON POST 请求，只能转发到固定的 Insight 技能服务路由，以背压方式流式转发 NDJSON，并且停机时只删除自身创建的描述文件。它使用 Desktop Main 选定的主运行时内置 Node 二进制文件；准入上限为 8 个活动请求、16 MiB 请求体缓冲和 1,250 秒请求截止时间。转发后的传输或流失败会报告为结果未知，绝不自动重试。

Insight 技能选择器读取三个受支持位置：内置目录、`$DSH_HOME/skills` 和 `$DSH_AGENTS_HOME/skills`。它把优先级交给 DSH 当前 Session 的技能注册表，因此被覆盖、禁用、未启用和暂时失效的条目仍会显示，但不可选择。菜单打开期间和浏览器重新获得焦点后会刷新；刷新失败时只保留当前 Session 最近成功的目录，并将保留条目标为未确认且不可选择。选择会调用原生输入动作，以普通草稿中可见的 `/name` 写入或移除，不替换引用、quote、command 或附件状态，也不创建隐藏提示词上下文。原生斜杠选择器继续支持项目本地技能。

选择器将内置技能归入“平台预置”，将账号和共享技能归入“用户自定义”。紧凑触发器打开搜索框、两个来源标签和独立滚动的列表，展示技能名称、短简介及选中标记。每个已安装技能说明旁可选的 `ui.json` 提供 `displayName` 和 `shortDescription`；展示信息缺失或不可读时回退到原生名称与描述，不改变调用名称或技能内容。

技能目录 Remote 由带装饰器的 `InsightSkillInventory` 服务生成，并经由本包的 `./remote` 入口供客户端使用；不得改用手写 Typert 描述符。

-----

<a id="desktop-updates"></a>
## 桌面更新

Insight 使用产品版本 `1.0.9` 作为迁移基线。产品版本与内嵌 DSH 运行时版本相互独立。Candidate 和 Stable 是渠道：两者均通过 Shell 兼容的 V2 格式接受 final 版本；Candidate 额外通过 V3 接受 prerelease 版本。已发布 Shell 读取器拒绝 rc 版本。

打包应用内含固定 HTTPS 分发源和 Ed25519 公钥。正式版发现会校验包含全部三个目标的一份已签名索引，当前源码中的内测版发现认证 V2 和 V3 两个目标指针，选择最高版本并校验对应目标专属 manifest。只有 HTTP 404 表示指针不存在；无效指针或已撤回的最高版本不会触发回退到较旧版本。两条路径都会先把 updater 元数据绑定到一个 payload 文件名、字节大小和 SHA-512 摘要，原生协调器之后才能检查或下载。首次原生交付关闭差分下载，避免 blockmap 命名把已认证完整 payload 重定向到其他内容。`1.0.11-rc.1` 已包含双协议读取器；已发布客户端的兼容关系见[操作手册](../../../docs/insight/operations.zh.md#current-delivery-state)。

Desktop Main 提供 Electron fetch 适配，在 `redirect: error` 下仅补齐未发生重定向响应的空 URL。读取器仍拒绝非预期 URL、重定向、无效签名及不匹配的 payload 元数据。

常规检查优先正式版。预发布应用只有在正式版检查报告无更新时才继续检查内测版，正式版应用不会自动检查内测版。五连击内测操作在原生确认后记录用户 opt-in，但只执行当前一次手动检查。用户跳过的可选版本在后续后台检查中保持隐藏。强制正式版会阻止内测检查。安装复用 DSH 的任务检查、关停和重启协调，不创建第二套产品 updater。

更新窗口内依次显示下载进度和“安装并重启”操作。该按钮仅授权本次安装的选定版本，尝试结束或失败后即清除授权。没有活动任务时不再弹出普通二次确认；有任务时仍需确认停止任务，直接协调器入口、目标版本变化和强制更新保留确认。任务检查、锁定、新任务出现时中止及安全关停均保留。macOS 需要确认时使用同一个仍存活的更新窗口，窗口已关闭则回退到工作区。Windows 原生标题栏遮罩适配暂缓，保留原确认宿主。仅下载完成不代表安装授权。

未打包的源码开发模式不检查、下载或安装客户端更新。打开更新入口时显示原生信息提示，引导开发者使用已安装的发布版本；打包应用仍保留更新来源校验。

投放历史、内测 opt-in 和跳过版本选择属于安装级 Desktop 状态。内测协议共享 `candidate/<target>` 历史；此前的 `candidate-v3/<target>` 历史继续作为只读兼容输入。它们在账号登录前即可使用，不属于账号 Home 或 Session 历史。

GitHub Release 构建和 OSS 发布是相互独立的操作，详见 [Insight 发布脚本](../../../scripts/insight-release/README.zh.md)。本包不读取发布凭据、Apple 签名材料或更新签名私钥。

-----

<a id="further-exploration"></a>
## 进一步探索

- [Insight 架构](../../../docs/insight/architecture.zh.md) — 产品标识、启动顺序、账号存储、进程数据流和阶段边界。
- [Insight 基线集成记录](../../../docs/insight/baseline-changes.zh.md) — 私有发行版修改的官方 DSH 文件。
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

- **账号 Home 复用而不由选择逻辑转换**——Insight 从账号既有的 `harness` 目录启动 Host，之后正常 DSH profile、storage 和 Session 写入仍在该目录进行。仅有 `harness-native` 而没有 `harness` 时会报告 `pre-release-data`，不创建空的后备 Home，需由产品维护人员决定恢复方式。
- **Insight 产品界面仅支持中文**——登录、账号页脚、更新窗口和 Insight 原生标签不提供语言选择或翻译。
- **随包 DSH CLI 不属于 Insight 产品界面**——Insight 不支持、不适配也不提供随包 `dsh` 安装或命令入口的兼容性。这不移除既有产品集成使用的 Host、Agent shell、Memory 外部 CLI、专家技能脚本或随包 Node 运行时。
- **发布与迁移证据范围有限**——`1.0.11-rc.1` 已完成三平台 CI、macOS 签名/公证及 Candidate 发布。已发布的 `1.0.10` reader 与当前 reader 均已验证三个 CDN 目标。原生升级和数据连续性反馈仍见[后续事项](../../../docs/insight/follow-ups.zh.md#user-and-platform-feedback)。Insight Windows 包按决定不使用 Authenticode，更新文档与 payload 身份仍须经过 Ed25519 验签、大小和 SHA-512 校验。
- **Host 凭据服务没有浏览器或 Remote API**——只有同进程 Host 插件可以使用它，并且它们获得结构化失败原因，而不是 Main 进程诊断信息。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
