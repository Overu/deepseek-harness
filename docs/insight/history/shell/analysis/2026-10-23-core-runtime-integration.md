> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# 2026-10-23 Core Runtime 集成与启动修复

## 当前结果与范围

用户已授权修改 Core Runtime 打包逻辑；随后明确选择不修改 Canvas 插件。Core 打包和 Shell 自有集成刷新已修复，隔离默认 Profile 的原生 Electron 完整启动已通过。后续按“恢复历史”要求，原账号现已显示历史列表，并在原生界面打开旧会话正文；全部 19 个历史归档与修复前哈希一致。过程及 Canvas 当前状态见文末“原账号历史恢复”；前文阻塞记录保留为当时的验证边界。

最新状态：用户进一步授权适配 Canvas，现已安装兼容 rc.2 的 `0.3.0-alpha.32`，旧画布、历史与成果卡正常显示。详见文末“Canvas 后续适配”；历史恢复时的卸载状态不是当前安装状态。

本次没有提交、推送或发布新 Runtime，也没有修改 `desktop-canvas-plugin` 仓库、用户插件兼容性豁免或会话格式。保留已有未跟踪文档 `docs/plans/2026-10-20-skill-backend-design.md`。

## 输入身份与发布限制

- Shell 起点：`efc455e`，分支 `feature/windows`。
- 原 Runtime：`insight-runtime-v0.2.1-alpha.1-insight.3` / `c3aaab2e76ddfad6163478687287774ad7233374`。
- 候选 [insight.4 Release](https://github.com/Boxser567/insight-harness-core/releases/tag/insight-runtime-v0.2.1-alpha.1-insight.4)：tag 保留 alpha 名称，实际 package version 为 `0.2.1-rc.2`，Core commit 为 `f3b8406d32cf5f5187f66ae1f575ff0b2b012e8d`。
- 工具链：Runtime Node `24.9.0`、pnpm `11.28.5`；本机开发 Node `22.23.1`，目标 `darwin-arm64`。Electron utilityProcess 自带 Node `24.18.1`，与独立 bundled Node 分别验证。
- 三平台 Release sidecar、目标、共同 commit 和 GitHub 资产摘要已核对；[原生 CI run](https://github.com/Boxser567/insight-harness-core/actions/runs/39920502292) 曾成功，但原打包检查没有覆盖仓库外的真实解析。

| 候选 Release 目标 | SHA-256 |
| --- | --- |
| darwin-arm64 | `b14c4f75759224842f65415da8762a030f277b97fedf2c9d6ec52f7d1a8968c0` |
| darwin-x64 | `6b234adf8a28e9521ec76c0921ebba594e9343c3a1f3ed607f18ea448c296961` |
| win32-x64 | `b4d860cb371863723f7e373d04baeb9ae8bac1bb6f055833ac498957bc668a01` |

这些是既有 Release 的摘要，不能当作修复包摘要。当前锁文件仍是此前更新的未提交候选输入；修复包只通过本地 Runtime 方式接入，manifest 标记 `source: local`、`releaseTag: local-development`。Core 工作树存在未提交的打包修改，归档 metadata 中的 HEAD 不代表这些修改已经发布。发布前必须以新不可变 tag 在三个原生平台重新打包、验证，再更新 Shell 锁文件。普通 `npm run dev` 会重新准备锁定的旧归档；验证修复版应使用 `npm run dev:local -- /absolute/path/to/fixed/runtime`。

## 根因与改动

旧版 `pnpm deploy --legacy` 配合 hoisted 布局，把指向源码 workspace 的软链接带进 Runtime。发布归档根命名空间存在 92 个断链；`dsh-agent`、`dsh-session-title`、`dsh-tools` 等内部原生导入失败，导致会话 Host 服务缺失，随后 28 个前端插件等待服务。公开包映射可帮助 Shell 找到嵌套包，但不能修复 Core 安装包内部的原生导入。

Core 改用共享锁文件 deploy，删除旧复制补丁。先部署再按同一批准清单执行安装脚本，只将已审核 subprocess postinstall 的相对 file 身份转换成部署所用的绝对 file URL；重建后拒绝未审批脚本。Node 安装器生成的绝对 `.bin/node` 链接改成相对链接。发布流程在仓库外解压归档，使用包内 Node、清除源码解析 hook 环境，拒绝断链和外部链接，并导入启动所需 Host 模块；成功后才写发布 sidecar。构建说明位于 Core `runtime/desktop/README.md`。

现有 Profile 为第 9 代，Shell 模板为第 8 代。原初始化逻辑没有刷新该 Profile 中的桌面集成，使旧 alpha peer 约束被 rc.2 拒绝。Shell 现在对高代次 Profile 只刷新已声明的两份自有桌面集成，不降代，不重写 manifest、锁文件、patch 或插件组合。

Shell 的类型生成和独立运行 fixture 使用 Core 公开 `createRuntimeResolution` 包映射及各包的 `exports.types`，避免依赖平铺布局。桌面集成四项 peer 同步 rc.2；会话恢复 fixture 适配具名 `apply` 和 Fiber 就绪，保留历史默认导出支持；模型列表凭证检查计数按新 Core 行为更新。

## 数据保留

修改原 Profile 前，已完整复制 Harness 到 `/private/tmp/insight-runtime-fix-20261023/harness-before`，并核对备份与源目录的全部普通文件 SHA-256、大小及软链接目标一致。刷新后再次逐项比较：4237 个原始条目变为 4241 个，仅 Shell 自有集成两个目录内的 7 个条目变化；其余 Profile 配置、会话、插件包、插件数据和软链接目标全部保持不变。具体报告：`/private/tmp/insight-runtime-fix-20261023/preservation-report.json`。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| Core 打包及发布单元回归 | 2 个文件、14 项通过；覆盖缺 peer、断链、越界链接、审批保留及未审批脚本拒绝 |
| Core `build:check` | Host、Client 聚合检查通过；复用现有构建产物，未运行 `pnpm build` |
| Core 原生 Runtime 打包 | `darwin-arm64` 成功；归档独立解压后，包内 Node 及关键 Host 导入通过 |
| Shell Profile、公开解析及集成契约定向回归 | 4 个文件、30 项通过 |
| Shell 类型检查及桌面集成构建 | 通过 |
| 修复 Runtime 下 `npm test` | 1013 项通过、2 项失败、2 项跳过；132 个文件通过、1 个文件失败 |
| 原生 Electron 隔离默认 Profile | 69 个前端插件完成启动，桌面集成在清单内；启动页移除、界面挂载、会话创建及查询成功；稳定 20 秒，Host 与前端无启动错误 |
| 现有 Profile 副本 | 仍被 Canvas 的旧 `storage-domain` 依赖阻塞；不宣称通过 |

Electron 隔离验证使用测试凭证通道，不读取真实凭证、不调用真实模型；它验证完整插件启动和会话服务，不等同于真实账号登录或生成验收。报告及截图位于 `/private/tmp/insight-runtime-fix-20261023/native-startup-report.json` 和 `native-startup.png`。最终原生归档位于同目录的 `final-release/`，SHA-256 为 `02ac5e3e38b22e6669f130ccee7c2437bf4c511f348beb3b4b3c214b037394e1`。已验证的本地 Runtime 已接入 Shell 开发缓存，随后执行 `npm run prepare:bundled-profile` 和 `npx electron-vite build` 均通过。

全量测试剩余两项是未改动的 `test/runtime.test.ts` Windows 标题栏断言：期望 inset 为 `0`，当前实现返回 `36`。两项历史 Runtime 测试因未提供旧 Runtime 而跳过。未为使测试变绿而改变标题栏行为或断言。

## 保留的阻塞项

现有 Canvas `0.3.0-alpha.31` 只声明兼容 Core alpha.1，并将 `@deepseek-ai/dsh-storage-domain@0.2.1-alpha.1` 安装进 Profile。Core rc.2 拒绝 Canvas；该旧依赖又遮蔽 Runtime 的 rc.2 storage-domain，导致 workspaceRegistry、sessionController 等服务等待。按用户选择，没有升级、卸载、改写或豁免 Canvas，也没有通过重置 Profile 或删除其依赖来绕开冲突。原账号的完整启动需要后续单独处理这项兼容升级。

尚未发布修复 Runtime，也未验证 macOS Intel、Windows 安装包、真实登录/账号切换和真实模型生成。锁文件在新三平台发布完成前不可用于推广此修复。

## 本机重新构建与临时接入

按用户后续要求，重新执行完整官方 Core 构建和 `darwin-arm64` 打包，本次未使用 `--skip-build`。9 项构建检查全部通过，产物在 Core `dist/runtime-local-darwin-arm64/`，归档 SHA-256 为 `ef6b4753d5cfc27408de2e021d8a98a14d1b0276e8bee0bb4011d1441ff5ca77`。打包的仓库外解压、断链检查和包内 Node 原生 Host 导入验证通过，14 项打包回归通过。

随后使用 `npm run dev:local -- /Users/jian.feng/dev/insight/insight-harness-core/dist/runtime-local-darwin-arm64/runtime` 完成 Shell 临时接入，桌面集成类型检查、集成构建、内置 Profile 准备和 Electron 开发构建均成功，Shell 开发进程保持运行。本次未修改正式 Runtime 锁，也未重置现有账号 Profile、会话或用户插件数据。

使用 Shell 实际缓存中的新 Runtime，再以隔离 Profile 运行原生 Electron：69 个前端插件启动，桌面集成在清单中，会话创建与查询成功，稳定 20 秒且没有 Host 或前端启动错误。新报告位于 `/private/tmp/insight-core-native-20261023/native-startup-report.json`，构建日志位于 `/private/tmp/insight-runtime-fix-20261023/core-native-build.log`。测试凭证通道及 Canvas 阻塞的验收边界不变。

## 目录选择桥接修复

用户反馈“无法打开文件夹：directoryPickerController is unavailable”。Shell preload 暴露的是旧名称 `dshDesktopDirectoryPicker`，而当前 Core 原生目录流程读取公开 Hook `__DSH_DIRECTORY_PICKER__`；未命中桌面桥后，流程调用 Host `directoryPicker/pick`。现有 Profile 的 workspaceController 因旧 storage-domain 冲突等待 workspaceRegistry，其子 DirectoryPickerController 也未挂载，因此返回 service-unavailable。

Shell 仅将桥名称对齐为 `__DSH_DIRECTORY_PICKER__`，保留同一个 `directory-picker:open` IPC 和 Main 来源 frame 校验，不修改 Core 或 Canvas。新增真实 preload 导入测试，覆盖目录返回、取消和 IPC 拒绝；5 项目录回归、类型检查、Electron 构建均通过。全量测试 1014 项通过、2 项既有 Windows 标题栏断言失败、2 项跳过。

在现有 Profile 的备份副本中，将旧 storage-domain 嵌套到 Canvas 自己的依赖目录后，68 个前端插件完成启动。点击实际“添加工作区”按钮完成选目录及工作区创建，再次点击取消；捕获到 2 次 Shell picker IPC、0 次 Host picker 请求、1 次 workspace/create，稳定 20 秒无前端启动错误。原生 Electron 测试的目录对话框返回由测试 IPC 提供，不是原账号的人工选择验收。证据位于 `/private/tmp/insight-directory-picker-fix-20261023/native-startup-report.json`。

用户明确选择“不调整，只保留 Shell 桥接修复”，因此没有将副本的依赖位置调整应用到原 Profile；旧 Canvas 及其依赖、配置和数据保持原样。原 Profile 的 workspaceController 仍受该冲突阻塞，桥接修复不代表后续工作区创建已恢复。Shell 已用原本地 Runtime 开发入口重新启动以载入新 preload，需要重新登录。数据备份及比较报告位于 `/private/tmp/insight-directory-picker-fix-20261023/`。

重启后的逐项比较仅发现运行时生成的 `skill-proxy/connection.json` 连接描述文件更新；Profile manifest、会话、Canvas 包及其旧依赖、用户插件文件均未变化。该运行时描述会随代理端口和能力凭证的生命周期更新，不作为用户内容恢复或回滚。

## 原账号历史恢复

用户后续明确要求恢复历史。保留 Shell Main 与登录状态，仅停止确认属于该 Main 的 Harness 子进程。先将原 Harness 完整备份至 `/private/tmp/insight-history-restore-20261023/harness-before`，核对全部 4241 个文件/链接条目一致，再将根级旧 `storage-domain` 原样移入 Canvas 私有 `node_modules`。迁移后逐项验证：全部文件内容不变，唯一差异为该依赖的路径，67 个既有会话及存储文件保持一致。

Harness 停止后弹出恢复窗口。随后原生操作工具报告应用已被用户更改；重新观察时恢复窗口已关闭、Harness 已重启，Canvas 已从当前 Profile 的已安装列表及物理目录移除。自动化没有执行“卸载此插件”动作，未将其恢复安装，也没有修改 Canvas 仓库或授予兼容性豁免。完整备份保留原 Canvas 包及依赖；插件用户存储仍保留。不要把最终安装状态描述为“Canvas 仍安装但停用”。

原账号启动于同一个数据目录，最新启动日志无先前六项服务等待错误。原生 Electron 侧栏已显示旧工作区与历史会话；打开 `hello` 后，10 月 15 日的用户消息、助手回复、工具记录和用量正常显示，Main 登录状态保留。没有发送模型请求。全部 19 个归档通过现有只读 `readHistoryExport` 解析，共 4683 行，格式版本为 v0 × 1、v3 × 5、v4 × 13；归档 SHA-256 全部与本次备份一致。19 是物理归档数，不等同于侧栏顶层会话数。Core 正常启动重建了部分会话投影缓存；其余既有用户存储文件哈希未变。

证据位于 `/private/tmp/insight-history-restore-20261023/restore-report.json` 和 `archive-read-report.json`。尝试通过本地 RPC 进一步核对数量时，自动审批拒绝了从日志读取启动 token 的方式，未执行该命令，改用已登录原生界面与离线归档检查。未将 RPC 校验记为通过，未重新运行源码测试或真实模型生成。本节只记录原账号数据修复与只读验收，没有新增 Core/Shell 功能代码。

## Canvas 后续适配

按用户“适配 canvas 插件”的后续要求，同级仓库已产出并安装 `0.3.0-alpha.32`：Core SDK/peer 对齐 rc.2，旧 storage-domain 普通依赖改为 peer + dev，LLM 显式 peer，Zod 对齐 Domain SDK 4.4.3；引用消息附件改用公开用户内容 Factory。没有修改 Core 或画布业务 Store/Context，未开启兼容性豁免。417 项根测试、SDK 类型检查、实际归档隔离安装/卸载及工具/存储/鉴权/桥接验证通过。

真实账号通过 Shell 原生“导入本地插件”安装并自动重启 Harness，登录保留；安装的 66 个文件与验证归档一致。启动无兼容性拒绝或服务等待，原生界面已显示旧画布、节点、连线、媒体及成果卡。安装前另存完整备份 `/private/tmp/insight-canvas-rc2-account/harness-before`。19 个归档原有内容全部逐字保留：18 个归档字节不变，活动会话仅由 Core 追加一个 `session/end-seed`；其余用户存储文件哈希不变。未触发真实生成。

归档 SHA-256：`6c56a3444354a5dbe3e93a70ea08a22fef7ee31583293cb466c619b04fa5c695`。完整适配说明在同级 Canvas 仓库 `docs/verification/2026-10-23-core-rc2.md`；安装与数据比较报告在 `/private/tmp/insight-canvas-rc2-account/installation-report.json`。

## 源码提交与标签操作范围

用户选择仅提交代码并更新 Core 的 `insight-runtime-v0.2.1-alpha.1-insight.4` 标签，暂不替换 Release 资产。Core 打包修复提交为 `5ff83ca5b9142f812ce0016a37b90bb72dad6ea9`，标签从 `f3b8406d32cf5f5187f66ae1f575ff0b2b012e8d` 移到该修复提交。源码分支为 Core `merged/061023`、Shell `feature/windows`、Canvas `fix/fengjian`；Canvas 适配提交为 `7b9e1af609bdc01bd248ae8b4ed1a879527bbbd2`。本节不表示已经发布新的 Runtime 归档。

既有 Release 的下载包和 sidecar 仍含原 Core commit 与旧字节；移动 Git tag 不会更新这些资产。本地 `core-runtime.lock.json` 的此前候选变更保留为未提交文件，不混入本次源码提交。远端 Shell 锁维持其原基线，本分支的新 Core 联调继续使用文中的 `dev:local` 入口；正式升级须先完成三平台修复归档与摘要验证，再单独提交锁更新。无关技能设计草稿也保留在本地。

推送前 Core 14 项打包回归、预提交检查及全语料双语配对通过。`doc-sync` 的其余 41 项原已通过；补齐双语记录后，该失败项单独重验通过。唯一未消除的是 `python/sdk/uv.lock` 的 repository-reference 检查：该文件内容与 origin 基线 blob 完全相同，本次没有修改。未通过绕过 Git 钩子来发布。
