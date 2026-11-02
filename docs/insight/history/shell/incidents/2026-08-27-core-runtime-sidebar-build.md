> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# 2026-08-27 Core Runtime 与 Better Sidebar 构建复盘

## 摘要

2026-08-27 的 Core Runtime 升级暴露了 Electron Utility Process 模块解析缺口、默认 Profile 安装状态不明确和本地到 CI 的验证门禁不足。`dsh-better-sidebar` 虽已进入默认 Profile 模板，但在实际启动进程中无法从用户 Profile 加载，导致启动恢复窗口、启动页停滞以及 Markdown/HTML 退回系统应用打开。排查过程先后发布了 `insight-runtime-v0.1.1-rc.8` 和 `insight-runtime-v0.1.1-rc.9`，并多次构建 Shell；Core 加载器与 Shell Profile 安装标记已经修复，分层验证也建立了从源码到 Release 的证据链，最终安装包验收仍作为独立发布门禁保留。

本次事件说明：测试、编译和安装包生成成功只能证明对应阶段完成，不能证明内置 Sidebar 的真实运行行为。Core、默认 Profile 或插件加载路径变化后，必须先完成独立本地应用和人工功能验收，再进入 GitHub 安装包构建。

## 变更背景

Shell 已从 npm registry 直接安装 `@deepseek-ai/dsh`，迁移为锁定并嵌入可独立发布的 Core Runtime。Shell 通过 `core-runtime.lock.json` 自主决定采用哪个 Runtime Release，不随 upstream Core 或 registry 包自动升级。`dsh-better-sidebar@0.16.1` 则作为默认 Profile 的内置能力，随 Shell 构建进入 `Resources/bundled-profile`，首次启动时复制到独立的用户 Profile。

同步近期 upstream Shell 更新后，需要同时恢复并守住以下本产品约束：Core Runtime 归 Shell 锁控制、默认 Profile 自带 Better Sidebar、用户数据与 upstream 应用隔离、产品标识保持为因赛AI，以及构建命令继续生成可独立安装的应用。本次 rc.8 升级正是在该交叉区域触发了问题。

## 影响

- 新构建的 macOS 应用可能停留在“正在启动”，或进入“发现导致启动失败的插件”恢复窗口。
- 恢复窗口能够识别 `dsh-better-sidebar`；卸载插件后客户端可以进入主界面，但失去内置 Sidebar，Markdown 和 HTML 文件改由系统应用打开。
- Runtime、Shell、本地 DEV 应用和 GitHub 制品之间的证据链一度不完整，造成重复发布和重复打包。
- macOS 签名、zip/blockmap、Windows 测试夹具、pnpm 非交互行为及 GitHub Release 上传故障混入同一轮排查，增加了定位成本。
- 业务层登录体系的开发被构建稳定性排查延后。

## 事件时间线

1. Shell 同步 upstream 后，先恢复 Core Runtime 所有权、默认 Sidebar Profile 和既有 Profile 迁移逻辑。
2. Core 提交 `b580d6f4ce` 增加首版 Profile 目录回退：只有内部 loader 存在且返回 `ERR_MODULE_NOT_FOUND` 时，才从 Profile 目录解析裸插件。该版本发布为 `insight-runtime-v0.1.1-rc.8`，Shell 提交 `44c7768` 随后锁定 rc.8。
3. 构建过程陆续处理默认 Profile 的 `node-pty` 原生构建许可（Shell `adba104`）、Intel macOS Rollup 二进制锁定（Shell `52469f3`）以及复制 Profile 后缺少安装完成状态（Shell `caf47f9`）。`.install-complete` 被写入复制后的用户 Profile，而不是只读的应用内模板。
4. 安装/启动验证仍出现 `dsh-better-sidebar` 恢复窗口。卸载插件可恢复启动，但 Markdown/HTML 不再进入 Sidebar。这证明模板“包含插件”与 Utility Process “能加载插件”是两件事。
5. 本地复现发现 Electron Utility Process 没有内部 loader。rc.8 的回退分支因此根本不会执行，裸插件继续相对已打包 Runtime 解析，而 `dsh-better-sidebar` 实际位于用户 Profile。
6. Core 提交 `85e67608ff` 抽出从 Profile `baseUrl` 解析的统一路径：有内部 loader 时仅在 `ERR_MODULE_NOT_FOUND` 后回退；没有内部 loader 时直接回退；并将 `require.resolve()` 返回值通过 `pathToFileURL()` 转为 ESM `import()` 可接受的 URL，覆盖 Windows 盘符路径。
7. 在发布 rc.9 前，本地把修复后的 loader 覆盖到 Runtime，启动独立的因赛AI DEV，并由人工确认会话中的 Markdown 和 HTML 均能在 Sidebar 打开。该结果证明修复代码有效，但当时还不是对正式 rc.9 压缩包的最终安装验收。
8. Core Runtime workflow run `33059565058` 构建 `darwin-arm64`、`darwin-x64` 和 `win32-x64`。第一次执行中 ARM64 的 archive 与 JSON 已上传，SHA-256 sidecar 上传收到 GitHub Unicorn 响应；只重跑失败 job 后，第二次执行完成，Release 最终包含三平台各 `.tar.gz`、`.json` 和 `.sha256` 共九个资产。
9. 正式 `insight-runtime-v0.1.1-rc.9` 中的 loader 与本地已验证构建进行字节等价核对。Shell 随后验证 Release 资产、哈希和元数据，并以提交 `a346076` 锁定 rc.9。
10. Shell 的测试、类型检查、普通 build 与独立 DEV 目录构建通过。由于 macOS 单实例锁仍指向较旧的运行中 DEV 应用，不能把该进程当作新 rc.9 应用的运行证据；最终安装包仍需在明确退出旧实例后单独验收。
11. 人工确认 `dist-rc9-validation/mac-arm64/因赛AI Dev.app` 携带 rc.9 且 Sidebar 可用后，Shell run `33062909634` 以 `target: all` 进入安装包阶段。两个 macOS job 的测试、类型检查、DEV 安装包和上传均通过；Windows 在 `npm test` 启动 Vitest 前报告缺少 `@rollup/rollup-win32-x64-msvc`。
12. Shell 先前只把 Intel macOS Rollup 二进制声明为根 `optionalDependencies`。npm 在 macOS 生成的 lockfile 虽列出 Rollup 的 Windows 可选依赖关系，却没有保留对应 Windows package 节点，Windows 干净 runner 的 `npm ci` 因此无法安装它。提交 `033b264` 显式锁定 Windows x64 Rollup 包并增加 release 回归测试；本地定向测试和 Windows x64 dry-run 通过。
13. 没有重跑已成功的 macOS job。基于 `033b264` 仅触发 `target: windows` run `33064050963`，Windows 的干净 `npm ci`、完整测试、类型检查、DEV 安装包、打包后 Harness smoke 和约 255 MB artifact 上传全部通过，耗时 8 分 18 秒。
14. 从 run `33062909634` 下载 Apple Silicon DEV artifact 后，macOS 报“因赛AI Dev 已损坏”。`hdiutil verify` 证明 DMG 校验有效；DMG 内和 ZIP 内应用均只有 Electron 可执行文件的 linker ad-hoc 签名，`codesign --verify --deep --strict` 报 `code has no resources but signature indicates they must be present`，Gatekeeper 在下载 quarantine 下拒绝启动。原因是手动 workflow 明确禁用签名发现，并跳过只对 `v*` 标签执行的证书导入、签名、公证、stapling 和验收。仓库没有 Apple 签名 secrets，本机也只有 `Apple Development` 而没有 `Developer ID Application`，因此该 DEV artifact 只能证明构建和上传，不能作为阶段 10 可安装候选包。
15. 对该 DEV 应用执行 `/usr/bin/xattr -d -r com.apple.quarantine` 时，命令在 `runtime/node_modules/.bin/node` 报 `No such file`。检查确认应用根目录及普通文件的 quarantine 已清除；报错来自唯一一个失效链接，该链接保留了 GitHub Runner 工作区的绝对路径。包内真实的 `runtime/node_modules/node/bin/node` 存在且为 arm64 可执行文件，应用随后正常启动。后续 Candidate 目录包进一步证明自动 codesign 会直接在该失效链接终止；Shell 因而在 Runtime 提取校验后移除绝对或失效的 `.bin/node`，不再把它带入 builder。
16. 登录门禁接入后的 Windows-only run `33163897155` 已完成 `npm ci`、完整测试、类型检查和 DEV 安装包构建，但旧 smoke 在 75 秒内只看到 Runtime manifest，没有 Harness endpoint。应用进程始终存活且没有 stderr；干净用户目录按新产品要求停留在登录页，登录前不再启动 Harness，因此旧检查条件已经失效。Shell 启动稳定性与包内 Runtime/RPC 随后拆成两个无账号检查：前者明确要求登录前无 endpoint，后者由跨平台脚本直接使用包内 Node、Runtime、默认 Profile 和桌面 patch 创建 Unicode 路径工作区与会话，不增加 CI 登录绕过能力。
17. Shell 提交 `1363ed1` 完成上述拆分并在本地已验收的 macOS 包内 Runtime 上通过同一 RPC smoke。随后只重跑 Windows 的 run `33164951219`：`npm ci`、完整测试、类型检查、DEV 安装包、未登录 Shell smoke、包内 Harness Runtime smoke 和 `windows-x64-dev` artifact 上传全部通过，没有重复构建 macOS。
18. `v0.1.2-rc.1` 在 `macos-15-arm64` 上完成完整签名、公证与 stapling，但安装到 macOS 14.5 后每次启动都会重复请求访问 Safe Storage。目标机的严格 codesign 拒绝应用；进一步检查显示 CodeDirectory 的代码页与特殊槽哈希、CMS 密码学签名及 Developer ID 证书链分别可以验证，因此不能把问题简化为“文件被修改”或“证书无效”，具体的旧目标系统签名策略差异仍待最终制品验证。Shell 在发布链增加临时 `macos-14` 最终 DMG 检查，并继续保留真实 macOS 14.5 quarantine 启动门禁。

## 症状、根因与修复

| 症状 | 真正根因 | 确认方法 | 修复位置 |
| --- | --- | --- | --- |
| 启动时出现 `dsh-better-sidebar` 插件恢复窗口 | rc.8 只在内部 loader 抛出 `ERR_MODULE_NOT_FOUND` 后回退；Electron Utility Process 没有内部 loader，因而没有从用户 Profile 解析插件 | 保留用户 Profile，读取 Utility Process/恢复日志，并以无 internal loader 的 Core 回归测试复现 | Core `85e67608ff` 的 `vendor/loader/src/config/tree.ts`；rc.9 发布 |
| 会话内 Markdown 和 HTML 唤起 macOS 外部应用 | 卸载失败插件虽然解除启动阻塞，也一并移除了提供文件预览与 Sidebar 路由的内置能力 | 比较卸载前后的 Profile 包与 bundle 注册，并在独立 DEV 应用中实际点击 Markdown/HTML | 恢复可加载的默认 Sidebar，而不是以卸载作为产品修复；Core rc.9 与 Shell 默认 Profile |
| 应用长期停留在启动页 | Harness Utility Process 未成功完成启动，主窗口持续等待 Runtime 就绪；本次主要触发点是 Sidebar 模块解析失败，Profile 安装状态缺失会进一步引发不必要的安装流程 | 检查子进程日志、恢复窗口识别结果、用户 Profile 的 `.install-complete`，而不是只刷新 renderer | Core `85e67608ff`；Shell `caf47f9` |
| Windows 测试报告缺少 `build/core-runtime/runtime.json` | manifest 单元测试调用了完整构建脚本，隐式依赖本地已准备的 Runtime，CI 干净工作区没有该文件 | 在 Windows runner 的干净 checkout 重现，检查测试是否越过单元边界读取 `build/` | Shell `c73b2c2` 将 manifest 构造与写入放入临时夹具 |
| Windows `npm ci` 成功后 Vitest 启动时报缺少 `@rollup/rollup-win32-x64-msvc` | npm 的跨平台可选依赖 lockfile 行为没有保留非当前 macOS 主机的 Windows Rollup package 节点；只显式锁定了 Intel macOS 包 | 检查根 `optionalDependencies`、lockfile 的具体 `node_modules/@rollup/...` 节点，并在 Windows 干净 runner 执行 `npm ci` 和测试 | Shell `033b264` 显式锁定 `@rollup/rollup-win32-x64-msvc@4.62.4` 并扩充 release 测试 |
| Windows DEV 安装包已生成，但打包后 Harness smoke 等待 endpoint 超时 | smoke 使用了登录体系接入前的启动顺序；干净用户目录现在必须先显示登录页，未认证时 Harness 按设计保持停止 | 应用进程持续存活、日志只有 Runtime manifest 且无 stderr；对本地已验收 DMG 的包内 Runtime 独立执行相同 RPC smoke | workflow 拆分未登录 Shell 稳定性检查和 `scripts/smoke-packaged-harness.mjs` Runtime/RPC 检查；不增加认证绕过 |
| 下载 macOS DEV DMG 后提示应用“已损坏” | DMG 本身完整，但手动 workflow 产物未使用 `Developer ID Application` 对完整 bundle 签名，也未公证和 stapling；quarantine 使 Gatekeeper 执行分发检查 | `hdiutil verify` 检查镜像；对 DMG 内应用执行严格 `codesign`、`spctl` 和 `stapler` 检查；核对 workflow 条件与仓库 secrets | 现有 DEV artifact 不作阶段 10 候选包；配置 Developer ID 与公证 secrets 后，通过 `v*` 签名发布链重新生成 |
| 已签名、公证的 Candidate 在 macOS 14.5 每次启动重复请求 Safe Storage 授权 | 目标机严格 codesign 拒绝应用，导致 Keychain 的代码签名访问控制不能稳定识别进程；代码页/资源槽、CMS 和证书链分别验证通过，尚无证据把原因归于单一损坏文件或单一 Xcode 版本 | 在构建 runner 记录系统/Xcode/签名工具路径；在 `macos-14` 重新挂载最终 DMG 并运行 codesign、`syspolicy_check`、stapler；目标机保留 quarantine 连续启动三次 | 发布前新增 Sonoma 兼容阻断任务；在目标 macOS 14.5 人工通过前不宣称修复完成，也不发布 Stable |
| codesign 或递归清除 quarantine 时在 Runtime `.bin/node` 报 `No such file` | Runtime 归档保留了指向 Core Runner 工作区的绝对符号链接，安装后目标不存在；真实 Node 二进制仍位于包内标准路径 | 检查失效链接目标、包内真实 Node 文件及架构；在 Shell 的 Runtime 准备测试中覆盖绝对、失效和有效相对链接 | Shell 在提取并校验真实 Node 后移除绝对或失效的 `.bin/node`；Core 发布流程仍应避免生成主机绝对链接 |
| macOS codesign 拒绝 Profile 依赖中的 `.DS_Store`，提示 resource fork/Finder information | 默认 Profile 复制进应用资源时带入 Finder 元数据；codesign 会遍历并拒绝这些内容 | 对报错的完整资源路径执行元数据/文件检查，确认不是签名证书本身失败 | Shell 打包资源过滤 `!**/.DS_Store`、`!**/__MACOSX/**`；打包前保持模板清洁 |
| DMG 已可用，但 zip 命令失败或 blockmap 阶段找不到预期 zip | zip 是独立的分发格式步骤；其命令/产物命名或生成失败不代表同一应用目录和 DMG 的运行行为失败 | 分别核对 `.app`、DMG、zip 和 blockmap 的存在与日志，不用后一阶段错误否定已人工验收的 DMG | 尚未作为本次 Sidebar 根因处理；经人工验收的 DMG 可继续用于 macOS 功能验收，zip 问题单独跟踪 |
| GitHub Release 最终缺少一个 SHA-256 sidecar，其他资产已上传 | GitHub 上传端返回 Unicorn，属于单资产上传基础设施故障，不是 Runtime 重新编译失败 | 查看 run 中各 job/step 和 Release 资产列表，确认 archive 与 JSON 已存在、失败仅在 sidecar 上传 | 只重跑失败的 `darwin-arm64` job；run `33059565058` attempt 2 补齐资产 |
| pnpm 在非 TTY 环境清理模块、安装被中断，或 tsx 报 IPC/权限错误 | pnpm 发现与当前 store/包管理状态不一致时需要清理确认，非交互环境无法回答；tsx 的 IPC 也可能被宿主 sandbox 阻止。这些是安装/执行环境问题，不等同于产品代码失败 | 保留完整命令、TTY/`CI=1`、Node/pnpm 版本和 sandbox 错误；在相同源码上用允许的宿主环境复核 | 在 CI 使用明确的非交互参数并保持单一 pnpm workspace/store；sandbox IPC 失败时以最小权限宿主重试，不修改产品逻辑掩盖环境错误 |

## 无效或证据不足的做法

| 证据不足的做法 | 为什么不足 | 更强的替代证据 |
| --- | --- | --- |
| 把 `npm test`、typecheck 或 `electron-builder` 成功当作 Sidebar 正常 | 它们没有启动真实 Utility Process，也没有点击会话文件 | 在独立 DEV 应用中使用全新/既有 Profile 启动，人工点击 Markdown 和 HTML，并确认没有恢复窗口 |
| 本地 Profile 尚未启动成功就触发 GitHub 安装包 | 远程打包成本高，但不会提供本地即可获得的模块解析和交互证据 | 先完成目录应用、包内资源检查、本地启动和人工功能门禁，再运行 installer workflow |
| 只验证覆盖过 loader 的本地 Runtime | 能证明代码方向正确，但不能证明已发布压缩包包含同一代码 | 发布后核对九项资产、SHA-256、`runtime.json`，并比较归档 loader 与已验证本地构建的字节内容 |
| 看到 Rollup 的平台包出现在传递依赖列表，就认为各平台 `npm ci` 都会安装 | macOS 生成的 lockfile 可以保留依赖名称，却缺少 Windows 包节点，只有目标 runner 才暴露问题 | 每个发布 runner 所需的 Rollup 原生包都作为根可选依赖精确锁定，release 测试同时检查 manifest 和 lockfile package 节点 |
| 把手动 macOS DEV job 成功和 artifact 上传成功当作可分发安装包 | 该路径有意禁用签名，既没有完整 bundle 签名，也没有 notarization/stapling；本地无 quarantine 启动不能代替 Gatekeeper | 先检查 workflow 身份，再对下载 DMG 内应用执行 `codesign`、`spctl`、`stapler`；只有签名发布链产物进入阶段 10 |
| 单个 sidecar 上传失败后重跑所有平台 | 已成功的平台会重复安装、编译、打包和上传 | 先区分编译失败与上传失败；对上传基础设施故障只重跑失败 job |
| 未命名用户数据目录就恢复、覆盖或删除 Profile | 可能破坏会话、工作区、设置和用户插件，也会污染验证结论 | 先记录应用标识与精确目录，制作可识别备份，只对明确的测试 Profile 执行最小操作 |
| 新应用已构建就默认当前窗口运行的是它 | Electron 单实例机制可能把启动请求交给旧进程 | 验收前记录应用绝对路径和 Runtime tag，退出旧实例，再由进程路径或应用内清单确认身份 |

## 最终验证证据

- Core `85e67608ff` 增加无 internal loader 的 Profile 插件回退、Windows `file:` URL 转换和对应回归测试；Core 定向 app-boot 测试通过。
- 本地覆盖修复 loader 的因赛AI DEV 完成真实启动，人工确认 Markdown/HTML 在 Sidebar 内打开。这是修复代码的功能证明。
- 正式 rc.9 归档中的 loader 与该本地已验证构建字节等价；Release `insight-runtime-v0.1.1-rc.9` 发布于 run `33059565058`，最终有三平台、三类文件共九个资产。
- Shell `core-runtime.lock.json` 由 `a346076` 锁定 rc.9，并记录各平台归档 URL、SHA-256、Core commit、Node 与 pnpm 身份。
- Shell rc.9 周期中，38 个测试文件、269 个测试、typecheck、普通 build 和独立 DEV 目录打包通过；应用内静态检查确认 Runtime 与默认 Sidebar 文件存在。
- `caf47f9` 的测试证明全新或受管迁移 Profile 被复制后会写入 `.install-complete`，避免把已随包安装的依赖再次当作未完成安装。
- 初始 installer run `33062909634` 的 Apple Silicon 和 Intel job 分别通过；Windows Rollup 修复后的 Windows-only run `33064050963` 完整通过，并上传 `windows-x64-dev` artifact。
- 登录门禁兼容修复后的 Windows-only run `33164951219` 完整通过；未登录 Shell 与包内 Harness Runtime 分别获得独立证据，并上传新的 `windows-x64-dev` artifact。
- run `33062909634` 的 macOS DEV DMG 校验有效，但严格签名与 Gatekeeper 检查失败；它不构成最终安装验收证据。
- 尚未把运行中的旧 DEV 实例当作正式 rc.9 应用证据。最终 DMG/Windows 安装包的首次安装、覆盖安装和 Sidebar 行为仍属于发布阶段人工门禁。

## 可复用经验

- “应用内有插件文件”“用户 Profile 有插件”“Utility Process 能解析插件”“文件点击进入 Sidebar”是四个独立验证点，不能相互替代。
- Core 修复必须先由源码定向测试证明，再由目标平台 Runtime 归档证明，最后由 Shell 中真实应用行为证明。
- Runtime Release 的 archive、JSON 和 SHA-256 sidecar 是一个完整单元；Shell 只在资产齐全、哈希和清单一致后更新锁。
- Profile 模板是只读种子，`.install-complete` 等可变安装状态属于复制后的用户 Profile。
- 构建故障应按源码、Runtime 归档、Shell 资源、应用启动、安装包格式和上传基础设施分层，失败只回退到被修复影响的最便宜阶段。
- 平台原生可选依赖不能只依赖传递 lockfile 推断；非当前开发主机的 release runner 入口包必须显式锁定并由静态测试守住。
- macOS “构建成功”“DMG 完整”“应用可分发”是三项不同结论；下载候选包必须用 Gatekeeper 实际执行的签名、公证与 stapling 证据证明。
- 单实例应用验收必须先确认进程身份。看到新窗口不等于正在运行新构建。
- 对用户数据只做精确、可恢复的操作。清理构建目录和清理用户 Profile 是两类风险完全不同的操作。

## 后续改进

- 以 [`../client-build-runbook.md`](../client-build-runbook.md) 维护当前有效的分阶段验证曲线；本复盘只保留历史事实。
- 为目录应用增加可复用的启动身份输出，至少显示 Shell commit、Core Runtime tag/commit、应用路径和用户数据目录，降低单实例误判。
- 为默认 Sidebar 增加尽可能接近真实 Utility Process 的无密钥启动冒烟；人工 Markdown/HTML 验收仍保留。
- 将 Runtime 九项资产完整性、锁与 `runtime.json` 一致性、关键 loader 内容和默认 Profile 文件检查固化为进入 installer workflow 前的门禁。
- 单独跟踪 macOS zip/blockmap 产物问题，不把它与已通过的 DMG 功能验收或 Sidebar 根因合并处理。
- 配置 GitHub 的 Developer ID 证书与 Apple notarization secrets，并让可供阶段 10 验收的 macOS 候选包只来自签名发布链；未签名 DEV artifact 在 workflow 与文档中保持明确标识。
- 构建记录统一保留各阶段耗时、缓存命中、失败层级和重跑范围，用数据识别重复下载及重复全量构建。
