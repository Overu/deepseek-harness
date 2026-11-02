> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# RC16 后的 Shell 分支整理与上游初审

日期：2026-09-21。本文记录代码审计事实和建议，不代表 Windows 缺陷已修复。

## 分支基线

- 已获取 origin 与 upstream-dsh-desktop 的最新引用。
- 本地 main 从 a45e8e9 快进到 5e0197b97f3e3ea73963cdb8e86394a43f2fae82，与 v1.0.0-rc.16 标签源码完全一致；没有重新合并功能或修改发行资产。
- 已删除本地 codex/rc15-release-20260920（5b1eea0）与 codex/rc15-platform-repair-20260921（5e0197b）。两者均为 main 祖先，提交由 main、发布标签、远端引用保留。
- 整理前没有未提交文件。两个 detached worktree（rc12、web-search）均无已跟踪改动，目录和未跟踪构建产物没有删除。
- origin/main 仍为 a45e8e9；本次仅整理本地分支，不推送、不修改生产更新指针。
- 后续工作使用从 main 新建的 codex/upstream-audit-20260921。
- main 到 RC16 的 64 条提交作者/提交者检查未发现 duzhimeng；没有引入新的 dzm/ 来源。身份检查不能单独证明历史代码来源，现有 Demo 禁止接收规范继续生效。

## 上游范围与版本差异

本地参考仓库 dsh-desktop 的 HEAD 与获取到的 upstream-dsh-desktop/main 均为 f4874631f783ca9871e1ed0c53ed0bf1ae793c7d。

上次审计端点 6a9c6687c14f9d4183d6907935024f9dd804043e 到当前 main 新增 22 条提交，涉及 119 文件（8018 行新增、1928 行删除）。这是差异清单初审，不是对所有文件的完整审查。此前选择性未接收的修改也需纳入本轮，不能只看这 22 条提交。

| 项目 | 因赛AI RC16 | 上游当前源码 |
| --- | --- | --- |
| Electron | 44.0.0 | 43.4.0 |
| Core | 0.1.6-alpha.2，自有 runtime insight.2 | 0.1.5-rc.2，配合源码仓库内补丁 |
| Runtime 交付 | 独立构建、校验、锁定发布资产 | Shell 依赖及 patch-package |
| 账号/Profile | 企业登录、按账号隔离 | 不可直接代替因赛AI契约 |

用户测试正常的上游安装包版本尚待确认；源码 main 不等于用户实际安装包。

## 与 Windows 反馈有关的差异

### 1. pwsh 任务栏闪烁和焦点丢失

上游存在而当前 Shell 入口缺少的机制：

- fb168ef：build/windows-hidden-console.mjs，在 Harness 入口调用 AllocConsole 与 ShowWindow(SW_HIDE)。上游将其用于 console-less Harness 的控制台子进程闪烁问题。
- c7faa1e 中的独立 helper：build/windows-child-process-hide.mjs，给 Node child_process 方法默认补 windowsHide，并同步 ESM 内建导出，保留调用者显式选择。
- 4d34d8d：修正安装包中 koffi 的解析位置，依赖不可用时不阻断启动。

当前 Shell 的 build/harness-node-entry.mjs 没有上述入口处理；src/main/runtime/harness-runtime.ts 仅在启动 Harness 等路径设置 windowsHide/detached。RC16 Core 的原生进程修复不能据此证明覆盖所有 Node、插件或后代进程调用。

这是高相关差异，不是已经复现的根因。上游 Node 方法包装不覆盖原生 Win32 调用，也不自动注入每一个后代进程；不要照抄上游注释而声称全面覆盖。隐藏控制台的创建时序本身也需要在 Windows 10/11 观察任务栏与焦点。

移植需要适配因赛AI resources/runtime 的依赖布局，而不是照搬上游 resources/app；覆盖真实打包路径、缺失原生依赖、同步/异步与各重载调用、受限与完全权限两类路径。保留 detached 进程隔离和现有 Core 修复，先做可独立回退的对照实验。

### 2. 切换完全权限后输入卡死/闪退

目前没有日志、退出码或转储可以证明属于 Shell、Core、GPU 或旧数据。旧环境污染只是待验证假设，不默认清理用户数据。

- 上游 32fc9ec 修复的是新会话复用旧空白会话导致默认 Agent preset 不一致；不是已证实的权限切换输入闪退修复。
- 因赛AI已包含 GPU/renderer 有限恢复机制，不能再将“添加 GPU 恢复”当作缺失能力。
- 上游近期 GPU 差异会排除 crashed + exitCode 34 的设备丢失事件，避免误降级；可独立评估，但不能承诺解决本次闪退。
- 应区分 Electron 主进程退出、renderer gone、Harness 退出和只是焦点被抢。采集时间、PID/退出码、GPU 状态、权限切换前后日志，并对日志脱敏。

最小对照：同机同工作区，正常上游发行包与 RC16；全新隔离 Profile 与旧 Profile 副本；工作区修改与完全权限；仅输入、切换权限后输入、持续 pwsh 三种操作。不要一次改变 Electron、Core、Profile 和 Shell，避免丢失因果关系。

## 采用建议（尚未实施）

推荐“锁定最新上游端点，按模块定向同步”，沿用 docs/upstream-intake.md：

1. 先补进程/渲染器诊断和 Windows 真实验收记录，再隔离适配隐藏控制台与 Node 子进程处理。
2. 逐项检查启动诊断、插件恢复、非系统盘资源 URL、GPU 设备丢失处理；按账号隔离适配，分别测试与提交。
3. Core 层补丁单独审查 alpha.2 是否已有等价修复；确需修改时在 Core 源码维护并重新构建 Runtime，不在 Shell 粘贴旧版编译产物补丁。
4. 保持因赛AI品牌、企业鉴权、技能代理、联网搜索、生产环境路由、签名更新和当前发布渠道不变。

不推荐整体 merge 上游：会同时混入市场、修复 Agent、网页数据导入、发布服务及不同 Core 依赖。也不推荐只修单一 windowsHide 标志：无法覆盖已发现的入口差异。

不接收自动 Defender 排除项、静默降低沙箱安全性或全量清空数据作为快捷方案。上游新增写入锁清理等恢复操作必须先验证当前 Core 锁协议及并发安全，不直接采用。

## 验证门槛

- 本次完成：引用获取、祖先检查、分支安全删除、main 与发布标签零差异；无产品代码变更，不将历史测试结果冒充本次测试。
- 后续代码：针对性回归、typecheck、完整测试、安装包资源检查。
- Windows：干净安装及老版本增量升级，两种权限模式，连续 pwsh 时任务栏和输入焦点稳定，取消/退出后无孤儿进程；记录 OS、终端宿主、GPU 与退出原因。
- macOS：保持 RC16 已验证能力，覆盖登录、技能、搜索、主题与更新冒烟。
- Windows 行为必须在真实 Windows 验证；Mac 单元测试不能证明闪烁/闪退解决。

目前未修改运行行为、未构建新版本、未发布。
