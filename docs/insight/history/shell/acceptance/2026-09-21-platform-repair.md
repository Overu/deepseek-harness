> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# 平台修复验证记录

## 代码状态

- Shell：`codex/rc15-platform-repair-20260921`，功能提交 `84e0c07`。
- Core：`codex/windows-console-repair-20260921`，功能提交 `14fbe92786`，测试启动目录修正 `be346c8169`；从已发布 Runtime 提交创建隔离 worktree，没有合并其它开发分支。
- 保持 Electron 44.0.0，最低支持 macOS 13。没有修改生产更新指针。RC16 构建准备阶段已发布独立 Runtime `insight-runtime-v0.1.6-alpha.2-insight.2`，Shell 锁提交 `76f0cee` 已统一接入三平台修复产物；RC15 资产保持不变。

## 已完成验证

Shell 类型检查、Desktop Integration 类型检查、`npm run build:prepared`、`npm run prepare:bundled-profile` 和 `git diff --check` 通过。认证、更新源及管理器、签名发布清单、macOS 元数据合并、Profile 迁移、安装修复、Windows 打包与现有 NSIS 兼容卸载路径的专项测试通过。

Profile 测试覆盖第 2–7 代升级到第 8 代、归一化版本依赖、包清单缺失、过期锁文件、重复执行及无关插件保留。迁移使用已有 Windows 中文路径清理实现，清理配置与包后再启动 Harness。

认证测试覆盖离线重置无需远程注销、重置抢占在途恢复、凭据读取失败、清理失败后可重试、IPC 来源校验，以及诊断文本不泄露令牌或异常原文。重置范围仅限认证凭据和认证分区，不是删除整个用户目录。

Core 本地 112 项专项测试通过，12 项 Windows 专属测试在 macOS 跳过。Core 提交和推送 hooks 的 lint、Host 构建及 Host/Client 类型检查通过。

[Windows 原生测试运行 35571053449](https://github.com/Boxser567/insight-harness-core/actions/runs/35571053449) 全部通过：9 个文件、84 项测试。三种权限模式各执行 20 次全新 PowerShell；普通后代及两种受限子进程的控制台窗口句柄均为空；输出、二进制管道、取消、进程树回收和 ACL 拒绝行为通过。首轮测试的两项失败来自测试以临时目录为 cwd 加载源码模块，修正 cwd 后重跑通过，未放宽断言。

## 已知基线检查问题

Core `pnpm run doc-sync`：40 项通过，1 项失败。失败为 `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` 的生成目录过期，在未修改的已发布 Core worktree 执行 `pnpm run verify-client-catalog` 同样复现。此项没有在平台修复中顺带重写；不得将完整 doc-sync 描述为通过。

## 下一阶段：安装包验收

1. 从上述 Core 提交构建独立候选 Runtime，验证产物架构、提交和摘要，再接入 Shell 测试构建。不得复用旧 Runtime 并宣称包含 Windows 修复。
2. Windows 10/11 使用实际安装器分别覆盖旧版和全新安装，三种权限模式各执行 20 次 Pwsh；观察任务栏无频繁新增/移除条目、无黑窗口、无 App 退出。自动化服务会话不能替代桌面视觉验收。
3. 使用带旧 GenUI/Market 依赖和缺失包的用户数据覆盖升级，验证登录后直接进入 Harness，不出现插件启动修复页。无需手动卸载或删除 APPDATA。
4. Mac Intel/Apple Silicon、macOS 13+ 完成覆盖安装、登录及离线重置。确认 Info.plist 最低版本为 13.0、latest-mac.yml 为 Darwin 22.0.0，两个架构元数据一致。macOS 12 已无法打开的安装只能升级系统或手动恢复兼容旧包。
5. 受影响 Mac 的网络问题尚缺原始错误码。恢复入口及脱敏诊断已实现；若清理认证状态后仍无法登录，使用新增 origin/endpoint/错误码定位网络原因，不能宣称所有网络故障已修复。

上述验收通过后，再选择发布版本、生成正式资产和推广更新指针。

## RC16 构建准备

用户已确认创建独立 Runtime 预发布资产并构建 RC16 测试包，不修改 RC15 资产或生产更新指针。Shell 版本、发布策略及日期已更新到 `1.0.0-rc.16` / `2026-09-21`，类型检查通过；使用系统 Python 的全量测试通过 116 个文件、785 项测试。本机 `/opt/homebrew/bin/python3` 是空文件，首次全量测试的两个 Python 启动失败通过仅调整该次命令 PATH 解决，没有修改 Python 安装或放宽测试。

[Runtime 校验构建 35572186446](https://github.com/Boxser567/insight-harness-core/actions/runs/35572186446) 的三个目标均已完成编译和归档。Windows、Apple Silicon 资产上传成功，Intel 的 GitHub Artifact CreateArtifact 接口重试五次后超时。因本机 Actions 归档下载速度极低，停止本机大文件中转及重复校验任务，改用现有 Runtime 发布流程由云端直接生成独立预发布资产。

Runtime tag `insight-runtime-v0.1.6-alpha.2-insight.2` 固定到 `be346c81694e14091bc4021cac78d3cad5dd6090`；[预发布构建 35573491012](https://github.com/Boxser567/insight-harness-core/actions/runs/35573491012) 的三个目标均成功，九项资产完整。三个目标的 metadata、checksum sidecar 与 GitHub 资产 SHA-256 记录一致，Node 24.9.0、pnpm 11.7.0 保持不变。

| Runtime 目标 | 归档 SHA-256 |
| --- | --- |
| darwin-arm64 | `a26dd782cf24e84ecf031ffecd551c82c0225b90e52feac39677c6dc8d107b05` |
| darwin-x64 | `8013217edaf9768a5ec442c091f3fea3497980e94bfdd6b734a08f2e6f9a15aa` |
| win32-x64 | `535a7bf08ff661f8b79a5767bf63ab3050d71be1a6d14a4478f64b5860352b70` |

ARM64 Release 归档已完整下载并计算 SHA-256，解压后的 runtime.json 与锁一致。编译后的 `dsh-win32-process/lib/index.js` 普通 CreateProcessW flags 为 `134218756`（CREATE_NO_WINDOW | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT），确认修复已进入归档。复用该已验证归档生成 Runtime manifest、执行 `npm run build:prepared` 和 Profile 8 准备均成功；Runtime 锁与发布 preflight 相关 20 项测试通过。

独立本地目录应用为 `/Users/boxser.shi/Documents/harness/insight-desktop-shell/dist-rc16-validation/mac-arm64/因赛AI Dev.app`，未覆盖 `/Applications` 的正式应用。目录应用的 RC16 版本、Runtime 身份、Profile 8、退役插件未注册以及 Info.plist 最低 macOS 13 均已检查；该未签名 DEV 目录应用不替代最终签名 DMG 的人工验收。

`scripts/smoke-packaged-harness.mjs` 对该目录应用的实际资源运行通过：Harness 启动、认证 RPC、模型 Gateway 默认路由及目录、中文路径工作区与会话创建、20 秒稳定期均成功，测试进程已退出。该自动检查没有调用生产模型，不代表真实账号登录或 Windows 交互桌面问题已人工验收。
