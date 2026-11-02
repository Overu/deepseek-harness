> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../README.zh.md)。

# 因赛AI Desktop 本地组合开发架构

状态：后续架构决策已批准；当前已实现 `dev` 和显式本地 Runtime 的 `dev:local`，本文额外的分层命令尚未实现。

本文是 Shell、Core 和独立插件协同开发的权威说明。它定义开发者应看到的命令、各仓库的职责、开发覆盖与正式制品的隔离，以及从快速验证进入发布验证的条件。实现脚本、修改开发流程或排查跨仓问题时，应先遵守本文；若实际实现需要改变这里的边界，应先更新并评审本文，不得让临时调试方式反向成为正式架构。

当前 `package.json` 提供完整准备锁定 Runtime/Profile 的 `npm run dev`，以及指定本地 Runtime 的 `npm run dev:local`。本文中的 `dev:shell`、`dev:core`、`dev:plugin`、`dev:reset` 和 `verify:release` 是下一阶段要实现的目标接口。在对应 script 出现在 `package.json` 且通过本文验收前，不得在操作记录中声称它们已经可用。

## 目标与非目标

目标是把频繁修改的反馈周期从“发布 Core、更新 Runtime 锁、重新构建 Shell”缩短为“只构建变化的包并刷新必要进程”，同时保持正式安装包可重复、可追溯且不依赖本机源码路径。

本方案不把三个仓库合并为 monorepo，不让 Shell 直接编译整个 Core，不让插件源码依赖 Shell 源码，也不以全局 `npm link`、手工修改正式 Profile 或修改锁定 Runtime 缓存作为开发接口。首版也不建设通用开发守护进程、自动推导跨仓依赖图、任意 Core 包 HMR 或图形化开发控制台。

## 开发者心智模型

开发者只需要判断正在修改哪一层，所有模式都从 Shell 仓库启动，因为 Shell 是最终组合和展示客户端窗口的一方。

```text
Shell：桌面宿主、登录、窗口、IPC、产品装配
  │
  ├── Core：Harness 运行引擎和基础模块
  │
  └── Plugin：由 Core 加载、在 Shell 客户端中呈现的扩展
```

对应的本地组合为：

```text
修改 Shell   = 当前 Shell + 锁定 Core + 默认插件
修改 Core    = 当前 Shell + 锁定 Core（指定包使用本地制品）+ 默认插件
修改插件     = 当前 Shell + 锁定 Core + 本地插件制品
Core + 插件  = 当前 Shell + 锁定 Core（指定包使用本地制品）+ 本地插件制品
```

第一方 `@insight-ai/desktop-integration` 虽然使用 Core 插件机制，但由 Shell 仓库拥有并随客户端交付，因此归入 Shell 调试，不要求开发者把它当作独立插件仓库。

## 开发者命令

目标接口只保留三类日常启动命令、一个恢复命令和一个阶段收尾命令。所有命令从 Shell 仓库执行，并以前台单进程编排子进程；`Ctrl+C` 必须停止本轮创建的 watcher、Harness 和 Electron，不留下后台常驻服务。

### 调试 Shell

适用于登录页面、Shell Renderer、Electron Main、preload、窗口、账号 IPC、产品装配和 Shell 第一方集成插件。

```bash
npm run dev:shell
```

Shell Renderer 使用 Vite HMR；第一方集成插件纯 UI 变化优先刷新 Harness View；Main 或 preload 变化重启 Electron。锁定 Core 和默认插件保持不变。

### 调试 Core 模块

例如调试设置模块：

```bash
npm run dev:core -- ui-settings-general
```

命令只 watch 和投影指定 Core package，其他 Core package 继续来自锁定 Runtime。开发者不需要先发布 Runtime、创建 tag、更新 `core-runtime.lock.json` 或构建 DMG。多个 Core package 只有在同一行为确实跨包时才显式列出：

```bash
npm run dev:core -- ui-settings-general ui-settings
```

### 调试独立插件

```bash
npm run dev:plugin -- ../plugin-project
```

本地插件制品只覆盖 DEV Profile 中的同名插件，不修改正式用户 Profile、出厂插件源码或正式 lockfile。插件依赖尚未发布的本地 Core 能力时，使用组合模式：

```bash
npm run dev:plugin -- ../plugin-project --core ui-settings-general
```

### 恢复与发布验证

```bash
npm run dev:reset
npm run verify:release
```

`dev:reset` 只删除并重建派生 DEV Runtime、生成的 Profile 模板和覆盖状态，不删除任何 composition 的 Electron `userData`、账号范围 Harness 数据、源码、Runtime 下载缓存、正式用户数据或正式安装包。需要清理测试账号数据时必须使用独立、显式且可恢复的流程，不能扩大 `dev:reset`。`verify:release` 禁用所有开发覆盖，从空目录按锁重新构建正式输入；它通过后才进入目录应用、DMG 和 GitHub Actions。

## 内部组合边界

开发者不直接操作以下内部结构，但实现必须保持它们可诊断。

```text
只读 Runtime 缓存 ──首次派生或锁变化──> build/dev-runtime
                                              ▲
Core 单包 watch ──成功制品──> staging ──原子投影─┘

默认 Profile 模板 ───────────────> build/dev-profile
                                              ▲
Shell 第一方插件 watch ──制品───────────────┤
独立插件 watch ──成功制品──> staging ──原子投影─┘

build/dev-runtime + build/dev-profile + Shell 当前构建
                         │
                         └──> Electron + Harness View
```

Runtime 下载缓存必须只读。开发覆盖只能进入可删除的派生目录，不能直接修改 `build/core-runtime` 的权威缓存，也不能更新 `core-runtime.lock.json`。投影只消费 package 的构建输出，不允许 Runtime、Profile 或插件直接导入另一个仓库的 `src`。

Core 和插件同步采用“构建到 staging、校验、原子替换”的制品投影。编译失败时继续保留上一次成功制品，不能把半成品复制到正在运行的 Runtime。复制白名单只包括 `package.json`、`lib/`、必要的 `cordis.patch.yml` 和显式静态资源；不得复制 `.git`、测试、缓存、`.DS_Store` 或整个源码目录。

软链接只可用于已证明不会进入安装包的 DEV workspace 位置。Runtime `node_modules` 默认不使用裸软链接，避免 Node/Electron 真实路径差异、pnpm 链接嵌套、文件监听遗漏、React 单例重复以及 macOS 打包签名污染。不得使用全局 `npm link` 作为团队开发流程。

### Core 覆盖兼容性

局部覆盖不是任意文件替换。`dev:core` 启动前必须比较本地 package 与 Runtime 基座中的 package manifest，确认其 runtime dependencies、peer dependencies、client inject、exports 和必要入口都能从当前基座解析。package 版本不同可以用于开发，但本地 Core commit、基座 commit 和差异必须显示在启动摘要中。

如果本地 package 新增了基座不存在的运行依赖或公开入口，命令不得带着缺失闭包继续启动，也不得静默从 registry 安装。它应明确列出缺失项，并采用以下顺序处理：

1. 缺失项本身也是本轮修改的一部分时，要求将它显式加入同一次 `--core` 覆盖；
2. 多个基础依赖或 Runtime 启动结构已变化时，由同一个 `dev:core` 流程重建一次派生 DEV Runtime，并说明已从“局部覆盖”升级为“本地 Runtime 组合”；
3. 无法证明闭包完整时停止，不用完整 Shell 打包或 GitHub Actions碰运气。

常规 UI、文案和局部 service 修改应保持单包反馈路径；依赖图变化本身就具有更大影响，允许触发一次较慢的派生 Runtime 更新，但仍不发布 tag 或修改正式锁。

### 插件开发输入契约

`dev:plugin` 只接受具有有效 `package.json`、DSH bundle/client metadata、构建入口和本地 watch script 的插件目录。首版使用明确约定的 `build` 与 `watch` scripts，不猜测任意仓库命令，也不根据源码目录结构生成临时插件。插件 watcher 只负责生成 package 制品，Shell 负责校验和投影。

独立插件接入属于第二阶段。在首个实际插件项目确定通用约定前，不新增复杂 plugin descriptor；若现有插件无法满足约定，应先记录其真实构建接口，再决定扩展一个最小显式配置，而不是为所有潜在工具链设计通用执行器。

## 仓库职责

| 仓库 | 必须负责 | 不得负责 |
| --- | --- | --- |
| Core | 单 package build/watch、公开类型和 exports、可释放的插件生命周期 | 感知 Shell 绝对路径、启动 Electron、修改 Shell Profile |
| 独立插件 | 自身 build/watch、完整 package 制品、公开 Core 接口消费 | 导入 Shell/Core 源码、修改 Shell lock、直接写正式 Profile |
| Shell | 选择 Runtime 基座、创建 DEV 投影、编排 watcher、选择刷新级别、启动客户端、执行发布门禁 | 把本地覆盖写入正式制品、隐式升级 Core、代替 Core 全仓构建 |

插件必须针对 DEV Runtime 暴露的公开类型进行类型检查。若插件需要一个未发布 Core 接口，组合命令必须同时覆盖提供该接口的 Core package；不得通过 TypeScript 路径直接指向 Core `src` 规避制品接口。

## 刷新级别

HMR 仅用于能安全替换的 UI 模块。编排器根据变更范围选择最低但可靠的刷新级别，并在 HMR 失败时向更高一级降级。

| 变化 | 默认动作 |
| --- | --- |
| Shell Renderer React/CSS | Vite HMR |
| 第一方或独立插件的纯组件、文案、局部样式 | Harness client HMR；不可靠时 reload Harness View |
| slot 注册、Cordis service、订阅和插件生命周期 | reload Harness View |
| Core host、CLI、Harness 启动路径 | 重启 Harness 子进程 |
| Electron Main 或 preload | 重启 Electron |
| package dependencies 或 bundle patch | 重建 DEV Profile 后重启 |
| Runtime Node/pnpm、loader 或生产依赖闭包 | 重建派生 DEV Runtime 后重启 |

任何支持 HMR 的插件注册都必须通过 disposer 释放 slot、service、事件和账号订阅。重复注册、重复菜单动作或旧 service 实例残留时，不得继续扩大 HMR 范围，应降级到 Harness View reload 并补回归测试。

开发 CSP 只可为 loopback 开发服务器开放所需的 WebSocket 和样式更新能力；生产 CSP 不得包含开发端口、WebSocket token 或宽泛例外。构建门禁应分别测试开发策略可工作、生产策略不泄漏开发权限。

## 自动准备与可见状态

日常命令自动完成准备，不要求开发者记忆 `prepare`、`refresh-profile` 或 `status`。只有以下输入变化才重建相应派生环境：

- `core-runtime.lock.json` 或 Runtime metadata 改变：重建 DEV Runtime；
- package dependencies、exports、bundle patch 或 workspace 结构改变：重建 DEV Profile；
- 只有 `src`、样式、文案或测试改变：局部 build、投影和刷新。

每次启动必须打印当前事实，而不是只显示“开发服务已启动”：

```text
模式：Core 模块调试
Shell：<commit 或 dirty>
Core 基座：<Runtime tag / commit>
Core 本地覆盖：ui-settings-general
本地插件：无
用户数据：<DEV userData 绝对路径>
刷新策略：Harness View reload
```

每个开发组合必须具有稳定且互相隔离的 composition ID。至少把 Shell 模式、Runtime 基座、Core 覆盖列表和本地插件身份纳入 ID，并为该组合选择独立 DEV Runtime、DEV Profile 和 `userData`。同一 composition 后续启动复用自己的登录和测试数据；退出某个插件调试模式后，不能让该插件继续残留在 Shell-only 或另一个插件的 Profile 中。启动摘要必须打印 composition ID 和 `userData` 绝对路径，防止 Electron 单实例或旧 Profile 冒充当前验证结果。首版禁止同时运行两个 composition，以免窗口单实例和本地服务端口互相争用。

派生环境至少具有 `UNINITIALIZED`、`READY`、`RUNNING`、`PROFILE_STALE`、`RUNTIME_STALE` 和 `DEGRADED` 状态。watcher 退出、基座身份不一致或依赖变化不能被静默忽略；命令必须说明自动执行了什么，或给出唯一恢复动作。

## 故障处理

| 故障 | 必须行为 |
| --- | --- |
| 单包编译失败 | 保留上一次成功制品，报告 package 和错误，不同步半成品 |
| watcher 意外退出 | 标记 `DEGRADED`，停止声称热更新正常 |
| Runtime 基座与 lock 不一致 | 拒绝启动并重新派生，不在原目录继续覆盖 |
| package manifest 改变 | 明确重建 DEV Profile，不沿用旧依赖图 |
| HMR 后出现重复注册 | reload Harness View，修复 disposer 并增加测试 |
| CSP 阻断开发 WebSocket | 修复仅限开发 CSP，不放宽生产策略 |
| 本地插件路径失效 | 停止该覆盖并报告路径，不回退到同名正式插件冒充验证成功 |
| 本地 Core package 的依赖闭包不完整 | 列出缺失 package；显式扩大覆盖或重建派生 Runtime，不从 registry 补齐 |
| 上一个开发组合残留插件或账号状态 | 使用当前 composition 的隔离 Profile/userData，不复用被其他组合修改的目录 |
| DEV 环境无法解释 | 使用 `dev:reset`，不删除正式用户 Profile |

## 验证曲线

```text
每次保存
  └── 单包测试 / watch / 最低级刷新

一个功能完成
  └── 定向测试 / 类型检查 / DEV 组合人工验证

一个阶段完成
  └── verify:release / 干净目录应用

发布候选
  └── 本地 DMG / 覆盖安装人工验收

正式发布
  └── GitHub 原生平台安装包
```

建议的反馈预算是：Renderer HMR 2 秒内、第一方插件重建 3 秒内、Core 单客户端包构建与投影 10 秒内、Harness View reload 5 秒内、Electron restart 15 秒内。预算不是测试成功条件，但超过后应报告最慢阶段，不能用默认全量 Runtime/Profile 重建掩盖性能退化。

## 正式发布收口

`verify:release` 和所有 package 命令必须从新目录产生正式 Runtime/Profile，不得复用 DEV 派生目录。发现以下任一情况立即失败：

- 指向 Core、Shell 或插件源码仓库的软链接；
- 本机绝对路径或 `file:` 本地依赖；
- DEV overlay/state 标记；
- Runtime metadata 与 `core-runtime.lock.json` 不一致；
- 未锁定或未完整构建的 Core package；
- Profile 缺少第一方集成插件或 Better Sidebar；
- `.DS_Store`、`__MACOSX`、资源 fork 或不在复制白名单内的源码文件。

干净 build、目录应用和安装包成功仍不能替代人工行为验收。涉及 Core、Profile 或插件加载时，继续按 [客户端构建 Runbook](client-build-runbook.md) 验证启动恢复、账号隔离、统一侧栏以及 Markdown/HTML 在 Better Sidebar 中打开。

## 分阶段实现

第一阶段只实现：只读 Runtime 基座与派生 DEV Runtime、一个 Core UI package 的 watch/原子投影、Shell 第一方插件 watch、Harness View reload 降级，以及正式构建拒绝 DEV 覆盖。它必须先用 `ui-settings-general` 和 `@insight-ai/desktop-integration` 证明链路。

第二阶段再接入一个独立插件仓库，验证插件 package、patch、静态资源和 Core 联合覆盖。第一阶段没有稳定前，不实现插件自动发现、跨仓依赖推导或更多常驻基础设施。

## AI 托管决策规则

后续 AI 在修改或执行开发流程时必须遵循：

1. 先按变更所有权选择 `dev:shell`、`dev:core` 或 `dev:plugin`，不从完整 Runtime 发布开始。
2. 只覆盖实际修改的 Core package 或插件；不要把整个 Core 工作区挂进 Shell。
3. 日常开发不创建 Runtime tag、不更新 Runtime lock、不构建 DMG、不触发 GitHub installer。
4. 开发覆盖只消费构建制品，不建立 Shell、Core、插件源码之间的代码依赖。
5. 无法安全 HMR 时选择 reload 或 restart，不以减少刷新次数为由牺牲生命周期正确性。
6. 新问题优先归类为构建、投影、Profile、Runtime、刷新或正式收口问题，再修改对应层；不新增另一个平行开发入口。
7. 新的构建或调试陷阱应更新本文的开发边界，并将正式构建经验追加到 [客户端构建 Runbook](client-build-runbook.md)。
8. 若实现与本文不一致，先说明差异、风险和迁移方式，再修改本文；不得静默改变开发者命令含义。

## 实现验收

命令实现完成需要同时证明：

- `dev:shell` 修改登录 UI 后无需重新准备 Runtime/Profile 即可看到变化；
- `dev:core -- ui-settings-general` 只重建该 package，并能在客户端打开设置验证；
- `dev:plugin -- <path>` 能加载本地插件，不修改正式 Profile；
- Core 与插件联合模式能消费未发布接口且不直接引用 Core `src`；
- Core package 新增未覆盖依赖时启动会明确失败或升级派生 Runtime，不产生半完整组合；
- Shell-only、Core 和两个不同插件组合使用可识别的隔离 Profile/userData，互不残留插件状态；
- 编译失败不会破坏上一次可运行环境；
- `Ctrl+C` 后没有本轮遗留进程；
- `verify:release` 能发现人为放入的源码软链接、绝对路径和 DEV 标记；
- 不启用任何覆盖的干净目录应用仍通过客户端构建 Runbook 的人工门禁。
