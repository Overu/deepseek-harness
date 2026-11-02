> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../README.zh.md)。

# 因赛AI Desktop 客户端构建 Runbook

## 适用范围

本 Runbook 是因赛AI Desktop 在 Core Runtime、Shell、默认 Profile、原生侧栏集成、Electron/Node/pnpm、原生依赖、签名流程或 upstream Shell 更新后的当前构建规范。2026-08-27 的完整故障过程见 [Core Runtime 与 Better Sidebar 构建复盘](incidents/2026-08-27-core-runtime-sidebar-build.md)。当历史复盘与当前脚本不一致时，以本 Runbook、当前 `package.json` 及当前 v2 工作流、[发布手册](release-runbook.md)为准。

目标不是一次性跨过所有构建步骤，而是用从低成本到高成本的证据尽早发现错误。任一阶段失败即停止；修复后从该修复所影响的最便宜阶段恢复，不用重复已经成立且未被变更影响的阶段。

## 核心原则

- Shell 自主锁定 Core Runtime。升级只通过审核后的 `core-runtime.lock.json` 发生，不因 `@deepseek-ai/dsh` registry 或 Core upstream 更新而自动发生。
- Core Runtime 提供可执行 Harness、Node、pnpm 和生产依赖闭包；Shell 提供产品身份、Electron 生命周期、用户数据隔离、默认 Profile、插件恢复和安装包。
- 当前文件浏览/预览由 Core 原生侧栏提供。Profile 资源完整、Runtime 能启动、集成能加载和真实文件能打开是独立证据；不按早期 Better Sidebar 插件验收。
- Shell 默认 Profile 不再声明 `dshmarket`、`dsh-genui` 或 Better Sidebar。当前 Core 原生能力按实际 Runtime 验收；Shell 只固定交付仍由其负责的集成与社区插件，并移除退休的内置声明/安装锁，不恢复用户主动卸载的插件。
- 登录后产品界面必须遵守 [单侧栏集成设计](plans/2026-08-28-authenticated-sidebar-integration-design.md)：Harness 侧栏是唯一导航，产品入口只依赖正式扩展槽和受限账号桥接。
- 日常跨仓调试遵守 [本地组合开发架构](local-composed-development.md)：允许在派生 DEV Runtime/Profile 中投影局部制品，但正式 build 和 package 必须从锁定输入重新生成并拒绝所有 DEV 覆盖。
- 桌面更新以一个经过产品签名的完整 Release 为单位。macOS Apple Silicon、macOS Intel、Windows x64、平台更新元数据、`insight-update.json` 和 `insight-update.json.sig` 缺一不可；v2 源码与制品身份冻结后按平台补齐，不能用不同字节覆盖同名资产；渠道指针仅按受控推广流程前进。
- GitHub Actions 成功只证明 job 和产物生成完成，不能替代本地行为或最终安装包验收。
- 每轮验收必须说明 Shell commit、Core Runtime tag/commit、应用绝对路径、目标平台/架构和用户数据目录。Electron 单实例机制不得把旧进程冒充为新构建。
- 用户数据操作必须精确、可恢复。不得用宽泛删除命令清理会话、工作区、设置或插件；任何测试 Profile 变更前先记录并备份确切目录。

## 变更分类与验证起点

阶段 1 的范围与身份审计对所有变更必做。下表“最低起点”表示阶段 1 之后最早必须执行的阶段；一次变更同时属于多类时，采用成本更低、覆盖面更大的起点，并合并所有必需目标。

| 变更类别 | 最低起点 | 必需目标与说明 |
| --- | --- | --- |
| 仅文档 | 阶段 2 | 文档链接、命令存在性和 `git diff --check`；不构建应用 |
| 不涉及 Runtime 或打包的 Shell UI | 阶段 2 | 当前开发平台；定向 UI 测试后执行受影响的普通 build/DEV 行为 |
| Shell main/preload 或用户数据行为 | 阶段 2 | 当前开发平台，并覆盖受影响的 macOS/Windows 路径；必须验证既有用户数据不丢失 |
| 默认 Profile、Core-owned 插件或原生侧栏集成 | 阶段 2 | macOS 本地 DEV 功能门禁；发布前再覆盖 darwin-arm64、darwin-x64、win32-x64 的包内结构 |
| Core Runtime 依赖、启动或 loader | 阶段 3 | 先在 Core 源码证明，再由三个原生 target runner 生成 Runtime；Shell 从阶段 5 接入 |
| Electron、Node、pnpm、原生依赖、签名或 workflow | 阶段 1 | 先审计平台与工具链；只在对应原生 runner 验证平台特性，发布范围决定是否扩到三平台 |
| upstream Shell 变更审计或定向采用 | 阶段 1 | 先完成差异审计，再按被触及类别选择后续阶段，不直接从安装包开始 |

upstream Shell 变更的差异审计必须明确保护：Core Runtime 的锁定与资源路径、默认 Profile 和原生侧栏集成初始化、用户数据隔离、App ID、产品名/安装包命名、未登录全屏 Shell、登录后全窗口 Harness View、第一方集成插件及其受限账号桥接，以及 `package.json` 中 build、DEV 与各平台 package scripts。任何一项会被候选变更覆盖，都先完成本地适配并测试，再进入打包。

Core Runtime 锁更新和 Shell upstream 定向采用必须拆成两个独立提交与验证批次。Core 侧栏扩展槽或设置控制服务发生变化时，先通过集成契约测试和本地 DEV 单侧栏验收，再更新 Runtime 锁；不得用 DOM 注入、模拟点击或修改 Harness 布局源码临时兼容。

Core 模块或独立插件的开发覆盖只能证明待发布组合的本地行为，不能替代阶段 3–5 的 Core 源码证明、原生 Runtime Release 和锁更新。覆盖验证通过后，正式收口必须关闭 watcher、从新目录重新准备锁定 Runtime/Profile，并确认没有源码软链接、本机绝对路径或 DEV 状态文件，再继续阶段 6。

## 分阶段验证曲线

### 阶段 1：范围与身份审计

**输入：** 待验证提交、工作树、目标平台和预期 Core Runtime。

**执行：**

- 查看 `git status --short --branch`、目标提交范围和相关 diff。
- 新构建固定身份：Candidate/Stable 使用 `com.insight-aigc.desktop`，DEV 使用 `com.insight-aigc.desktop.dev`；同时核对包内 `insightDesktopAppId`，不按服务域名或更新渠道临时生成 ID。产品名和数据目录保持原值，详见 [Bundle ID 首发规范](plans/2026-09-09-desktop-bundle-identity-design.md)。
- 记录 Shell commit、`core-runtime.lock.json` 的 tag/commit/平台哈希、Node/pnpm 版本和构建目标。
- 区分用户修改、构建输出、缓存和本轮允许修改的文件；不得为获得“干净工作树”清理不属于本轮的内容。
- upstream 变更按 [上游接收规范](upstream-intake.md) 审计，并核对单侧栏设计中的升级决策矩阵。

**通过条件：** 变更类别、验证起点、必需平台、应用身份和用户数据目录均已明确，未跟踪文件所有权清楚。

**失败时：** 停止。先缩小范围或确认文件所有权，不运行安装、构建或清理命令。

### 阶段 2：定向测试与静态检查

**输入：** 已确认范围的 Shell 或文档变更。

**执行：**

- 先运行最贴近变更的单个测试文件、配置检查或文档检查。
- 源码变更运行 `npm run typecheck`；进入发布链前运行 `npm test`。
- Electron/Vite/Rollup 或 lockfile 变更必须检查每个 release runner 所需的平台原生包既在根 `optionalDependencies` 中精确锁定，也在 `package-lock.json` 中具有具体 package 节点；不能只依赖 Rollup 的传递可选依赖列表。
- 文档变更检查链接、当前脚本名和 `git diff --check`，不为文档单独构建应用。

**通过条件：** 定向断言覆盖实际失败条件，类型与静态配置一致，失败不是被跳过或被环境错误掩盖。

**失败时：** 留在本阶段修复并只重跑受影响检查。没有相关源码变化时，不重复全量测试。

### 阶段 3：Core 源码证明

**输入：** Core Runtime 依赖、loader、启动、Profile 解析或打包脚本变更。

**执行：**

- 在 Core 仓库运行能复现问题的最小测试，并让回归测试先覆盖真实失败分支。
- 执行 Core 受影响包的 build/typecheck/发布脚本静态检查；需要目标平台语义时使用对应原生 runner。
- 对 loader 变更同时验证：internal loader 成功、`ERR_MODULE_NOT_FOUND` 回退、无 internal loader、非解析错误透传和 Windows 路径。

**通过条件：** 原始失败可复现，修复后定向测试通过，构建产物包含预期代码；没有靠 Shell 覆盖文件才能工作。

**失败时：** 不发布 Runtime，不更新 Shell 锁。先在 Core 缩小根因。

### 阶段 4：目标原生 Core Runtime Release

**输入：** 已通过源码证明的 Core commit 和新的不可变 Runtime tag。

**执行：**

- 在 `darwin-arm64`、`darwin-x64`、`win32-x64` 原生 runner 生成 Runtime。
- Release 必须具有每个平台的 `.tar.gz`、`.tar.gz.json` 和 `.tar.gz.sha256`，共九项资产。
- 核对 JSON/`runtime.json` 中 Core repository、version、commit、Node、pnpm、platform 和 architecture。
- 若仅上传失败，先确认 archive 是否已经正确构建；只重跑失败 job。

**通过条件：** 九项资产齐全，哈希可验证，三个 target 的元数据对应同一预期 Core commit。

**失败时：** 编译/打包失败回到阶段 3；纯上传故障停留在阶段 4，不重跑已成功平台。

### 阶段 5：Shell 更新锁与归档证明

**输入：** 完整、不可变且已核验的 Core Runtime Release。

**执行：**

- 更新 `core-runtime.lock.json` 中 tag、URL、SHA-256、Core、Node 和 pnpm 身份。
- 运行 `npm run build`。该命令已经执行 `prepare:core-runtime`、校验锁定归档并生成 Runtime manifest，除非单独隔离下载步骤，不要立即在它之前重复运行 `npm run prepare:core-runtime`。
- 核对解压后的 `build/core-runtime/runtime.json` 与锁一致；Core loader 修复需确认归档内容包含预期变更，或与阶段 3 已验证产物字节等价。
- 第一方集成类型检查通过 Core 公开的 `createRuntimeResolution` 包目录映射和各包的类型导出生成 `build/core-runtime-types.json`，不要求 Runtime 的传递依赖平铺到根 `node_modules`。生成文件只供本地编译，不进入安装包；独立运行测试也按该公开映射定位模块。

**通过条件：** 下载归档哈希匹配，Runtime 元数据与目标完全一致，关键入口、Node 和 pnpm 文件存在。

**失败时：** 哈希/元数据/内容不一致则拒绝该 Release，回到阶段 4；Shell 选择错误则只修复锁和对应测试。

### 阶段 6：Shell 全量检查与普通 build

**输入：** 已验证的 Runtime 锁和通过定向测试的 Shell 变更。

**执行：**

```bash
npm test
npm run typecheck
npm run build
```

默认 Profile 变更需要时单独运行：

```bash
npm run prepare:bundled-profile
```

`npm run build` 已准备 Core Runtime；`prepare:bundled-profile` 会复用满足 Profile 版本 8、第一方集成和当前插件归档校验的 Profile。每次完整启动客户端后，每个账号首次启动 Harness 时，均以打包 Profile 的依赖清单安装内置插件，包括 `@insight-ai/desktop-canvas-plugin@0.3.0-alpha.32`；已有的其他版本或安装来源会强制恢复为客户端自带的包，包括降级和同版本不同来源。原有停用状态、插件配置、会话和业务数据保留，非内置插件不受影响。本次客户端运行期间，手动导入的本地包、卸载和替换会保留，Harness 重启不会再次恢复内置版本；完全退出客户端后再启动，才恢复随包版本或补装缺失插件。Dev 的 Main 重载会重启客户端进程并恢复内置插件，Renderer 热更新不会。已确认兼容的 Profile 版本 9 同样执行内置插件同步，但保留其版本号和已有字段，不执行旧版迁移；未知的更高版本仍受降级保护。插件版本、来源和归档摘要见 [制品清单](#historical-source-1)。它不会下载或重新内置由 Core Runtime 提供的 `dshmarket`、`dsh-genui`。

Shell、Harness 或辅助窗口的 sandbox preload 发生变化时，必须检查每个 preload 构建产物都是自包含文件：

```bash
rg -n 'require\(.+\./chunks/' out/preload/*.cjs
```

预期无输出。多个 preload 复用同一个运行时 helper 时，Rollup 可能生成共享 `chunks/*.cjs`；Electron sandbox preload 无法加载该相对模块，随后会同时出现 preload 加载失败、桥接 API 为 `undefined`、账号入口消失或辅助窗口空白。跨 preload 只共享会在编译后擦除的 TypeScript 类型；少量运行时 IPC bridge 保持在各自入口内，并由契约测试校验一致性。

**通过条件：** 测试、类型检查和普通 build 均通过，生成的 manifest/Runtime/Profile 与锁和默认插件版本一致；所有 sandbox preload 均不依赖相对共享 chunk。

**失败时：** 不生成 DMG、zip、NSIS，也不触发 GitHub installer。按失败属于测试、Runtime 下载、Profile 或 Electron build 回到相应阶段。

### 阶段 7：独立本地 DEV 应用

**输入：** 阶段 6 通过的 Shell 工作树。

**执行：**

需要先验证实时 DEV 行为时，宿主 Node 必须使用 22.x；Vite 7 的开发服务器依赖该版本提供的 `crypto.hash()`。本地 Core 覆盖已经准备完成时直接启动 Electron Vite，不能运行会重新下载锁定 Runtime 的 `npm run dev`：

```bash
node --version
npm exec electron-vite -- dev
```

退出时使用 `Ctrl+C`，并确认 Electron 与 Vite 一同结束、开发端口已经释放。macOS 上为读取 `.zprofile` 和 `.zshrc` 启动的交互式 Shell 必须位于独立进程会话；否则它退出后可能把终端前台进程组留在失效 PID，表现为终端只打印 `^C` 而 Dev 客户端继续运行。

先构建成本较低的目录应用：

```bash
npm run package:dev:dir
```

macOS DEV 没有稳定代码签名，必须在 Chromium 初始化前启用 `use-mock-keychain`；DEV 认证必须同时使用非持久 Session 且不调用 `safeStorage`。因此登录只在当前 Main 进程内有效，退出后需要重新登录。该限制只属于 `development` 通道，Candidate/Stable 仍使用系统安全存储。不得为恢复 DEV 登录而改回真实钥匙串、保存明文 token，或删除用户钥匙串/Profile。

需要 macOS 安装介质时再运行：

```bash
npm run package:dev:mac:arm64
```

若现有 `dist-dev` 应用正在运行或已被人工验收，使用独立输出目录，避免覆盖证据：

```bash
npm run build
npm run prepare:bundled-profile
npm exec electron-builder -- --dir --config electron-builder.dev.cjs --config.directories.output=dist-dev-validation
```

检查目标应用内：

- `Resources/runtime/runtime.json` 与锁中的 Core commit、包版本、Node、pnpm、平台和架构一致；
- Runtime loader 包含预期修复或与已验证 Core 产物字节等价；
- Profile 不含 `dsh-better-sidebar` 的依赖、bundle 或安装目录；Runtime 提供原生 Sidebar、文件浏览和预览；
- `Resources/bundled-profile/web/package.json` 的 `insightDesktop.defaultProfileVersion` 为 `8`，且默认依赖只包含 Shell 负责交付的社区插件与桌面集成；
- `Resources/bundled-profile/web/package.json` 和 lockfile 不包含 `dshmarket`、`@changfenhuang/dsh-genui`；实际 Core 原生能力应通过 Harness 启动与 UI 验收确认；
- 应用名、App ID/channel、绝对路径和输出目录正确。
- macOS 包内主 App 的 `CFBundleIdentifier` 与上述固定身份一致，所有 Helper 使用相同主 ID 派生的 `.helper*` 前缀，且与包内 `insightDesktopAppId` 一致；旧 ID 包的签名/安装证据不得作为新身份的验收结果。

**通过条件：** 独立目录应用资源完整，未覆盖当前已安装/运行应用，具备进入真实启动验证的身份记录。

**失败时：** 包内资源错误回到阶段 5 或 6；仅 DMG/zip 格式失败时保留已验证目录应用，单独诊断格式层。

### 阶段 8：人工功能验收

**输入：** 阶段 7 的明确应用绝对路径、Runtime tag/commit 和专用 DEV 用户数据目录。

**执行：**

- 退出同 App ID/channel 的旧实例；启动指定路径，确认进程没有被单实例机制转交给旧应用。
- 使用全新 Profile 验证首次启动；使用既有 Profile 验证升级，不得丢失会话、工作区、设置和用户插件。
- 检查复制后的新用户 Profile：模板版本 8、第一方集成、Shell 负责的社区插件归档以及 `.install-complete` 均存在；升级旧 Profile 后 Better Sidebar、旧版 `dshmarket` 和旧版 GenUI 不再由 Shell 注册或恢复。
- 按当前 Runtime 确认原生文件预览、技能入口和插件管理可用；对旧 Profile 验证用户自装的其他版本插件不被 Shell 误删，用户会话、工作区、设置和社区插件选择保持不变。
- 新建或打开会话，实际点击 Markdown 和 HTML 文件，确认均在 Sidebar 内打开。
- 确认没有插件恢复窗口或无限启动页，插件列表中没有内置 Better Sidebar。首页显示因赛 Logo 和“以专业为引擎，让团队与AI共成长”，无预览标签；Windows 任务栏与 Alt+Tab 标题为“因赛 AI”。
- 原生右侧栏提供文件浏览/预览；better-sidebar 独有的编辑器、终端、Git 和嵌入式浏览器面板不再随客户端预装，不按旧插件按钮验收。
- 检查 `harness.log` 中 `[desktop] startup phase` 的单调计时。Shell 的 `ready` 只表示 Harness 视图已接管窗口，不代表所有插件完成初始化；Profile 修复耗时从 `repairing-profile` 到 `auditing-runtime` 计算，连续热启动达到 300ms 才进入 Profile 快速路径优化。

**通过条件：** 人工明确回复上述行为通过，并在记录中写明应用路径、Runtime tag、全新/升级 Profile 类型及用户数据目录。

**失败时：** 立即停止。保留日志和精确 Profile 备份；根据失败落在资源、Profile、Utility Process 或交互层回到阶段 5、6 或 7。不得以卸载内置 Sidebar 作为通过条件。

### 阶段 9：GitHub Desktop 安装包构建

**输入：** 阶段1–8证据、明确的人工通过结论、冻结Shell/Core身份和三平台发布范围。

**执行：** 日常最终SemVer按 [v2操作清单](releases/update-v2-operator-checklist.md) 运行 `Build desktop v2 installers`（`release-v2.yml`，`version`与`platform=all`）和 `Publish desktop v2 updates`（`publish-update-v2.yml`）。先冻结tag/源代码、验证各目标Draft资产，再以同一批字节投放Candidate；三平台安装和恢复人工通过后才推广Stable。单平台补救不得变更已冻结输入或覆盖同名不同摘要资产。

发布只能使用实际目标平台构建、签名/公证和摘要验证。Core锁、版本、数据schema与打包输入必须明确，DEV实例或workflow成功不能替代安装/恢复证据。权限、OIDC/STS、CDN、不可变资产和渠道最后提交规则按 [发布说明](release-runbook.md) 与当前脚本执行；旧RC流程只用于明确的legacy桥接，不以2026-09的渠道指针作为当前状态。

**通过条件：** 三平台确切制品与Manifest可追溯，进入阶段10验收；尚未取得人工结果时不推广Stable、不重新构建已验收字节。

### 阶段 10：最终安装包验收

**输入：** 完整发布验收使用阶段 9 对应 GitHub Release 中的确切安装包、`insight-update.json` 和 `insight-update.json.sig`；单平台候选验收可使用该次 workflow 的确切 Actions artifact，但只关闭对应平台门禁。macOS 必须是使用 `Developer ID Application` 完整签名并已 notarize/staple 的 Candidate 或 Stable DMG；未签名 DEV artifact 不是本阶段输入，`Apple Development` 身份不能替代外部分发身份。Windows 当前为未签名 installer。

**执行：**

- 记录 workflow URL、tag、target、channel、Shell commit、Core Runtime tag/commit、Actions artifact 或 Release URL、资产文件名、文件大小和 SHA-256。完整发布的实际文件必须与产品签名的 release manifest 一致；单平台 artifact 没有完整 manifest 时，以 workflow job 校验、run/commit 和 artifact 身份作为该平台候选证据，不得扩写为完整 Release 通过。
- macOS 先运行 `hdiutil verify <dmg>`，挂载后对其中应用执行 `codesign --verify --deep --strict --verbose=4` 和 `syspolicy_check distribution --verbose`，再用 `xcrun stapler validate` 检查应用与 DMG；DMG 继续使用 `spctl --assess --type open --context context:primary-signature --verbose=4`，任一失败即停止安装验收。
- 保留下载文件的 quarantine；如果必须运行 `xattr` 才能启动，签名候选包验收失败。
- 分别完成干净安装与覆盖安装；启动前确认没有旧实例占用单实例锁。
- macOS 更新验收必须从 `/Applications/因赛AI.app` 启动并推出 DMG；`/Volumes` 或 `/AppTranslocation/` 只能验证拒绝更新提示，不能作为真实更新输入。
- Candidate 的确切安装包完成干净安装和静态验证后，允许执行 Candidate `promote` 使其指针生效；随后立即从已安装的前一个 Candidate 完成 N→N+1 客户端内更新。在可信 Manifest 已解析后人为让自动下载失败，确认“下载完整安装包”能打开同一不可变版本目录内适配架构的 DMG/NSIS 并完成覆盖安装。完全禁用更新 Origin 时应安全失败且不显示虚假的可下载状态。
- 安装过渡由正在运行的旧版本执行。验证某版本新增的准备文案、窗口持续显示或进程清理时，必须先安装该版本，再更新到更高版本；不能用“旧版本更新到修复版本”的过程判定修复是否生效。
- 重复阶段 8 的 Sidebar Markdown/HTML、恢复窗口、启动页、会话、工作区、单侧栏、统一设置入口、账号退出和插件清单检查。
- macOS 验证首次安装和覆盖安装、签名、公证及 stapling。Windows 接受预期的 SmartScreen/未知发布者提醒，继续后必须能完成首次安装、覆盖安装、启动和卸载；提示本身不算失败，无法继续、安装包损坏或更新后版本/数据错误才算失败。
- Windows 旧版到新 Candidate 的更新回归不得预先人工结束因赛AI、Harness 或 Node 进程。安装器必须自行关闭旧进程树；出现“因赛AI 无法关闭”、反复重试或 `Failed to uninstall old application files: 2` 即判定失败，并保留安装器、旧安装目录和进程路径证据。
- Candidate 在确切安装包验收后从 `main` 手动运行 `Publish desktop updates` 的 `promote`，再完成 N→N+1 canary；失败时不得回写低版本，只能停止并修复到更高 RC。Stable 只有在 Candidate 升级、同源整包兜底和 Stable 确切安装包全部通过后才执行 `promote`。发布器先公开 GitHub Release，再直接从 OSS 读取并确认目标渠道版本严格递增，最后上传唯一的 `stable/current.json` 或 `candidate/current.json`，并在约定 TTL 内确认收敛。

- `command=promote`
- `tag=<vX.Y.Z 或 vX.Y.Z-rc.N>`
- `confirm_version=<X.Y.Z 或 X.Y.Z-rc.N>`

正式 macOS 本地打包命令为：

```bash
npm run package:mac:arm64
```

**通过条件：** 单平台候选由人工明确确认该 target 的安装、启动和本轮回归行为，仅关闭对应平台门禁。完整 Candidate 或 Stable 仍要求 macOS 与 Windows 最终安装包均完成首次安装、覆盖安装和核心行为，Candidate 的 N→N+1、自动下载失败后的同源整包兜底和推广后 canary 通过；更新后版本正确且登录、会话、工作区、账号隔离、设置、用户插件和内置 Sidebar 数据不丢失；发布记录完整。

**失败时：** 保留安装包和日志，标记失败格式与平台。一个已验收 DMG 可用于 macOS 功能结论，但 zip/blockmap 故障必须作为独立未解决项记录，不能宣称整个发布完全通过。

## 人工验收点

有两个不可跳过的人工门禁：

1. 阶段 8 的独立本地 DEV 应用。执行者必须先报告应用绝对路径、Shell commit、Core Runtime tag/commit、用户数据目录以及全新或升级 Profile，再等待人工操作结果。
2. 阶段 10 的最终 DMG/Windows installer。必须从具体 OSS 版本目录或 GitHub Draft 下载并报告文件名和校验信息。Candidate 收到确切安装包验收后才可推广，指针生效后再等待 N→N+1 和同源整包兜底结果；Stable 收到全部 Candidate 证据及 Stable 首次/覆盖安装结论前不得推广。

人工回复只对当时明确命名的应用和制品有效。旧版应用仍在运行、只检查插件列表、只看到包内文件或只完成 builder，均不能代替 Markdown/HTML 的实际 Sidebar 行为。

## 常见故障索引

| 症状 | 首查层级 | 停止位置 |
| --- | --- | --- |
| `dsh-better-sidebar` 恢复窗口 | Runtime loader、用户 Profile、Utility Process 日志 | 阶段 8，禁止 installer |
| Markdown/HTML 打开外部应用 | Sidebar 是否真实加载、是否曾被恢复流程卸载 | 阶段 8 |
| 无限启动页 | Harness Utility Process、Profile 安装标记、Runtime 身份 | 阶段 8 |
| `runtime.json` 缺失或不匹配 | Runtime Release、Shell 锁、测试是否错误依赖 `build/` | 阶段 4–6 |
| `release-preflight` 在原生 job 前失败 | tag/channel、`package.json` 与 lockfile 版本、发布策略版本、三个 Runtime target 和共同 Core commit | 阶段 9；只修正元数据并重跑，不下载 Runtime 或启动原生构建 |
| 手动触发 workflow 返回 HTTP 422，提示 `Unrecognized named-value: runner` | job 级配置是否引用 `${{ runner.temp }}`；workflow dispatch 解析时 runner 上下文尚不存在 | 阶段 9；改用步骤运行时提供的 `$RUNNER_TEMP`，并由发布契约测试拒绝 job 级 `runner.temp`，此类失败不会启动或消耗 runner |
| 三平台构建成功，但 Publish 报缺少 `insight-candidate-*` | Candidate 已统一产品名和制品名，但 Manifest 构建器或验证器仍按旧渠道前缀查找文件 | 阶段 9；Candidate 与 Stable 均使用 `insight-*` 制品名，渠道只记录在签名 Manifest 和发布策略中；用 Candidate fixture 同时验证 Manifest 构建与完整资产校验后再触发远程构建 |
| macOS DMG、ZIP 和 blockmap 已生成但缺少 `latest-mac.yml` | `publish: null` 或 `--publish never` 不保证 electron-builder 生成更新元数据；检查架构打包命令是否执行 `finalize-mac-release.mjs` | 阶段 7/9；根据最终 ZIP 重建并校验 YAML，不为生成元数据启用自动发布 |
| Linux preflight 报缺少 Rollup/esbuild 平台二进制 | preflight 是否误运行 `npm ci`、Vitest、Vite 或其他原生构建工具；Vite 内嵌版本可能需要另一套 optional binary | 阶段 9；恢复零安装 Node 门禁，不逐个追加与产品目标无关的 Linux 原生包 |
| macOS Intel 或 Windows Vitest 缺少对应 `@rollup/rollup-<platform>` | 根 `optionalDependencies` 与 lockfile 是否显式包含 `darwin-x64`、`win32-x64-msvc` 的精确版本和具体 package 节点；npm 不保证从其他平台生成完整 optional lock | 阶段 2/9；在原生构建前修复，并先用目标 OS/CPU 的临时 `npm ci` 验证解析 |
| macOS 签名时出现 `EMFILE: too many open files` | `@electron/osx-sign 1.3.3` 会通过 `Promise.all` 递归检查 App 内的文件；当 Runtime 和内置 Profile 合计超过万级文件时，runner 的软文件句柄限制会被耗尽。依次运行 DMG、ZIP 两个 electron-builder 进程还会重建并重复签名同一个 App；实际 Candidate 曾在首次签名、公证和 DMG 成功后，于第二次 ZIP 签名再次耗尽句柄 | 阶段 9；通过 `patch-package` 将 `osx-sign` 文件检查串行化，方案对应上游 [electron/osx-sign#286](https://github.com/electron/osx-sign/pull/286)；单次 electron-builder 同时构建 `dmg zip`，只装配和签名 App 一次；两个 macOS 构建 Shell 同时保留 `ulimit -n 65536`。`10240`、单纯提高上限和仅合并 target 均已在约 4.2 万文件的实际制品上证实不足；`npm ci` 必须成功应用补丁，签名后仍执行完整 bundle 校验 |
| Intel App 已通过 codesign、Apple 公证和 staple，但 `spctl --type execute` 报 `a sealed resource is missing or invalid` | `spctl` 的 App 评估可能与底层签名和公证结果冲突；Apple 在 macOS 14 起将 `syspolicy_check distribution` 作为应用分发检查入口，并将旧 `spctl` App 检查标为准确性较低 | 阶段 9；App 改用 `syspolicy_check distribution --verbose`，DMG 仍用 `spctl --type open`；不得因为替换检查工具而省略 `codesign --strict --deep`、stapler、DMG 公证或安装后的 quarantine 验收 |
| Apple 公证已 Accepted，但 stapler 访问 CloudKit 时以 68 退出并报 NSURLErrorDomain 网络错误 | Apple 票据服务请求连接中断、超时或无法建立连接；与未通过公证或票据缺失区分 | 阶段 9；v2 两个 macOS 目标通过 `scripts/run-stapler.mjs` 执行 staple/validate，仅对明确的 CloudKit 网络错误重试，最多 5 次、间隔 15 秒；其他错误或重试耗尽仍失败，完整签名、公证及票据门禁继续执行 |
| electron-builder 选择 `Apple Development` 或找不到 `Developer ID Application` | `DESKTOP_CSC_LINK` 实际包含的证书类型、Team ID 和私钥是否匹配 | 阶段 9；导入临时钥匙串后、打包前必须精确找到目标 Team 的 `Developer ID Application` 并以哈希传给 `CSC_NAME`，不允许自动选择其他身份 |
| Windows NSIS 已生成且 `7z t` 通过，但被判定“不是 x64” | 是否错误地把 NSIS 安装器外壳的 PE machine 当成应用架构 | 阶段 9；只校验安装器是有效 PE/NSIS，在 `win-unpacked` 中校验主程序为 x64，并让 PowerShell 对任何外部命令非零状态立即停止 |
| Windows 安装时出现 SmartScreen 或“未知发布者” | 确认下载来源、release manifest 哈希和当前 Windows 未签名策略；区分预期信誉提示与文件损坏 | 阶段 10；允许用户明确继续，无法继续或哈希不符立即停止 |
| Windows 客户端更新时反复提示“因赛AI 无法关闭”或旧文件卸载错误码 2 | 主窗口退出后，安装目录内的 Harness/Node/Electron 子孙进程是否仍存活；旧卸载器是否在执行非原子回退前已被进程检测阻塞 | 阶段 10；不得人工杀进程后写成通过。验证 Shell 对 Harness PID 执行完整进程树终止，并验证 NSIS 在旧卸载器前只清理注册安装目录内的进程；详见 RC7 至 RC9 更新复盘 |
| Windows 包已生成，但 Harness smoke 在登录接入后等待 endpoint 超时 | 干净 DEV 用户目录按设计停留在登录界面，登录前不会启动 Harness；旧 smoke 把历史启动顺序当作 Runtime 健康条件 | 阶段 9；先验证未登录 Shell 稳定且无 endpoint，再用 `scripts/smoke-packaged-harness.mjs` 独立验证包内 Runtime/RPC，不得绕过登录 |
| macOS arm64/x64 签名、公证通过，但恢复门禁报 desktop model Gateway 未就绪 | Core 查询模型目录时会请求凭据；独立 smoke 子进程缺少 Main 提供的私有 IPC 通道，导致 `yinsai-gateway` 出现在 catalog failures 中 | 阶段 9；共享 smoke probe 通过私有 IPC 返回固定、无效的测试凭据，只验证离线模型目录和工作区/会话创建，不调用真实模型或读取账号凭据；保留 provider、启动及恢复门禁 |
| macOS 下载 DMG 提示应用“已损坏” | 先验证 DMG，再检查完整 bundle 签名、Gatekeeper、notarization/stapling 与 quarantine；手动 DEV artifact 默认未签名 | 阶段 9，不能移除 quarantine 后宣称阶段 10 通过 |
| macOS 检查更新报 `installing` 不能转换到 `check`，且堆栈路径包含 `/AppTranslocation/` 或 `/Volumes/` | 应用并非从持久安装位置运行，同时菜单在更新忙碌阶段重复发起检查 | 阶段 10；先退出并推出 DMG，把应用安装到 `/Applications`。忙碌阶段的手动检查必须复用当前状态，不得重入状态机 |
| macOS 从旧 Candidate 更新到含过渡修复的新 Candidate 后仍有空白等待 | 安装准备由源版本代码执行；平台更新器接管退出后还要校验、解包和替换完整签名 `.app`，blockmap 只减少下载量 | 阶段 10；先安装含修复的 Candidate，再升级到更高版本验证 Electron 存活阶段。原生退出后的间隔单独计时，1.0 不把它描述为热更新 |
| 云端签名、公证和 stapling 均通过，但 macOS 要求访问 `因赛AI Safe Storage` | 先比较该条目的创建时间并只读检查 ACL：若其 designated requirement 仍绑定历史 `com.insight.desktop`，当前 `com.insight-aigc.desktop` 即使使用同一 Team ID 也不会自动获得访问权；本地构建复用正式产品名也可能创建不兼容条目。拒绝授权会让本地 token 加密失败，不应误报远端认证服务不可用 | 阶段 7 只运行隔离的 `因赛AI Dev`。阶段 10 仅删除已确认由内部构建创建或绑定历史 ID 的精确旧条目，再用云端签名、公证并 staple 的 DMG 登录并连续冷启动三次。流水线必须阻断最终 App 的 `CFBundleIdentifier`、`CFBundleName` 或 `TeamIdentifier` 漂移；正式包保留真实 `safeStorage`，拒绝时只保留当次内存登录，不写明文 token；Sonoma job 和最终 quarantine 验收仍不可省略 |
| codesign 或 `xattr -d -r` 报 Runtime `.bin/node: No such file` | 检查锁定 Runtime 的 `.bin/node` 是否指向 Core 构建机绝对路径，并确认 `node_modules/node/bin/node` 存在；Shell 准备 Runtime 时必须移除该无效 shim | 阶段 6；不得携带失效链接进入 builder，真实 Node 缺失则退回 Core Release |
| codesign 报 `.DS_Store`/resource fork | `Resources` 和默认 Profile 的 Finder 元数据过滤 | 阶段 7 或 9 |
| `iconutil` 对尺寸完整的 iconset 报 `Invalid Iconset` | 先用 `file`/`sips` 核对全部标准尺寸；若 `iconutil` 自己解包的 iconset 也无法重新封装，则属于宿主工具异常 | 阶段 2/7，使用仓库生成器直接写入标准 ICNS PNG entries，并以 `file`、`sips` 和品牌资产测试验证，不进入远程打包调试 |
| DMG 成功、zip/blockmap 失败 | 独立分发格式与 artifact 命名，不先否定应用行为 | 阶段 7/9，格式问题单独跟踪 |
| GitHub 上传 Unicorn/单 sidecar 失败 | Release 资产列表与失败 step | 阶段 4/9，只重跑失败 job |
| pnpm 非 TTY 清理、OOM 或下载失败 | Node/pnpm 版本、store、`CI=1`、并发和网络 | 阶段 3/6，不进入 builder |
| `npm test` 的发布说明测试报 `spawnSync python3 ENOEXEC` | `command -v python3`、`file "$(command -v python3)"`；检查 PATH 首项是否为空文件或损坏的 Homebrew shim | 阶段 2；改用可执行的系统 Python 或修复本机 shim，不修改测试来掩盖宿主环境故障 |
| Vite DEV 报 `crypto.hash is not a function` | 宿主 `node --version`；普通 build 成功不能证明 Vite 7 DEV 可启动 | 阶段 7，切换到 Node 22 后重启，不改产品代码 |
| 新模板已隐藏必需插件，但既有账号 Market 仍显示停用/卸载 | 比较 bundled Profile 与活跃账号 `dshmarket/lib/routes.js` 的 installed/updates 过滤标记；旧 Profile 可能只有 update/uninstall 守卫 | 阶段 8；同版本市场应由 Shell 启动刷新三份宿主适配文件，不得用完整 Profile 覆盖或回填用户已删除的可选插件 |
| 在 Market 卸载插件后点击“立即重启”进入 Harness 恢复页，但新 Harness 仍在后台端口运行 | 检查市场日志是否先记录 `uninstall exit=0` 再记录 `restart scheduled`，同时核对原 Harness 是正常退出而 Shell 仍判为意外失败；这是独立 DSH 自重启绕过 Electron 生命周期所有权，不是插件卸载残留 | 阶段 8，禁止 installer；同版本 `dshmarket/client/client.js` 必须由 Shell 刷新桌面重启能力与委托，重启前等待市场写操作完成，桥接缺失时失败关闭，只允许经过 `harness:restart`，并检查无 PPID 1 的孤儿 Harness |
| Dev 终端按 `Ctrl+C` 只打印 `^C`，客户端或 5173 端口仍存活 | 比较 Dev 进程 `PGID/TPGID`；检查交互式登录 Shell 是否夺走终端控制权，以及 Development 主进程是否处理 `SIGINT/SIGTERM` | 阶段 7；禁止带残留进程继续下一轮验证，先恢复进程组与优雅退出链路 |
| `Unable to load preload script` 同时报 `module not found: ./chunks/*.cjs`，账号入口消失或辅助窗口空白 | `out/preload/*.cjs` 是否引用 Rollup 共享 chunk；多个 sandbox preload 是否导入同一个运行时 helper | 阶段 6；让各 preload 构建为自包含文件并完成真实 Electron 冷启动，禁止仅凭 Vite build 成功继续 |
| tsx IPC/sandbox 权限失败 | 宿主 sandbox 与 IPC 权限 | 在同一阶段用最小宿主权限重试，不改产品代码 |
| 新构建似乎没有变化 | 旧 Electron 单实例、实际进程路径和 channel | 阶段 8/10，先退出旧实例 |

更完整的根因和处理经过见 [2026-08-27 构建复盘](incidents/2026-08-27-core-runtime-sidebar-build.md)；正式签名包的钥匙串访问控制问题见 [2026-09-08 macOS Safe Storage 候选版故障与验收](incidents/2026-09-08-macos-safe-storage-candidate.md)；RC7 至 RC9 的 Windows 进程占用、macOS 临时安装路径和安装过渡边界见 [2026-09-11 RC7 至 RC9 跨平台更新故障与加固](incidents/2026-09-11-rc7-rc9-updater-hardening.md)。

## 构建耗时控制

- 一轮验证内复用已经过哈希验证的 Runtime 和满足版本条件的 `build/bundled-profile`；只有锁、目标或模板输入变化时重新准备。
- 先跑定向测试，再跑一次完整 `npm test`。相关源码没有变化时，不为提交、推送或重跑上传重复执行已通过的全量检查。
- 先生成目录应用，目录应用资源和行为通过后才生成 DMG、zip 或 NSIS。
- 原生 runner 只处理本机不能证明的平台、签名和安装器行为；本地可复现问题先本地解决。
- 同一次 run 的纯基础设施失败可重跑失败 job；若待发布输入未变化，可只重建失败平台并复用同一 Commit 下已验证的平台 manifest。输入发生变化时，按前置校验结果回到全平台构建；不得混用不同 Commit、Runtime lock 或打包输入的产物。
- 编译成功但单个上传失败时只重跑失败 job；先确认是否需要重新编译。
- 把 Runtime 下载、Profile 准备、测试、普通 build、目录应用、安装包和上传分别计时，优化重复最高的阶段，不减少校验项。
- 测试用户数据使用独立 App ID/channel，并保留精确命名的备份。禁止把清理整个应用数据作为常规提速手段。

## 构建记录模板

每次重大 Core、Shell、默认插件、工具链或 upstream 更新复制以下模板：

```markdown
# 客户端构建记录：<日期/变更>

- Shell commit：
- Core Runtime tag / commit：
- 变更类别与验证起点：
- 目标平台/架构：
- Node / npm / pnpm / Electron：
- 应用名、App ID/channel、绝对路径：
- 用户数据目录与备份：

| 阶段 | 命令或操作 | 结果 | 耗时 | 证据/产物路径 |
| --- | --- | --- | --- | --- |
| 1 | | | | |
| 2 | | | | |
| ... | | | | |

## 人工验收

- 全新 Profile：
- 既有 Profile/覆盖安装：
- Markdown/HTML Sidebar：
- 恢复窗口/启动页：
- 会话、工作区、设置、插件清单：
- 单侧栏、品牌、账号入口、统一设置和原生退出逃生路径：

## 未解决项

- 问题：
- 影响的平台/格式：
- 已证明不受影响的范围：
- 下一验证阶段：
```

## 维护规则

- 本文只维护当前有效流程；一次事件的时间线和临时诊断写入 `docs/incidents/`。
- 新故障若改变后续每次构建的操作、门禁或停止条件，就同步更新本文；否则只补充对应复盘。
- 命令和 workflow 名必须以当前 `package.json`、Electron Builder 配置及当前 v2 工作流、[发布手册](release-runbook.md)为准。
- 删除或改名构建命令、资源路径、App ID、用户数据目录、Runtime manifest 字段时，在同一变更中更新本文。
- 文档不得把猜测写成规则，也不得把某一平台、某一格式或某一 job 的通过扩大为整个发布通过。
- 构建优化以减少重复下载、重复全量测试、重复原生构建和无效 CI 为目标，不以取消人工功能门禁换取速度。


## 迁入时保留的历史源码位置

以下是原报告引用的旧仓源码或当时本机构建证据，不是当前安装包依赖；未将旧仓业务源码复制到文档目录。原始目标同时记录在导入清单中。

<a id="historical-source-1"></a>

- `insight-desktop-shell:vendor/plugins/README.md`
