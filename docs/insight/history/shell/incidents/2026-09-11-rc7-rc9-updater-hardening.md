> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# 2026-09-11 RC7 至 RC9 跨平台更新故障与加固

## 状态与验收边界

- `v1.0.0-rc.9` 已完成全平台构建、OIDC/STS 暂存和 Candidate 推广；截至 2026-09-14，公开 CDN 的 `candidate/current.json` 返回 `1.0.0-rc.9`。
- RC9 是首个同时包含 Windows 旧进程清理、macOS 临时挂载拦截和更新忙碌状态防重入的全平台 Candidate。
- 自动测试、原生构建、签名、公证、OSS 不可变目录与指针推广已经通过；Windows 旧版到 RC9 的真实覆盖更新，以及 `/Applications` 中 RC7 到 RC9 的 macOS 安装过渡仍需人工验收。
- 因此 RC9 可以作为 1.0 的统一工程基线，但在上述两项人工验收完成前，不能写成三平台更新已经达到 Stable 放行标准。

## 事件时间线

1. macOS Apple Silicon 已从安装的 RC3 完成客户端内检查、下载、安装和重启到 RC4，证明 `app-update.yml` 修复后的基本自动更新链路可用。
2. RC5 到 RC7 的 macOS 更新能够完成，但点击“安装并重启”后仍经历较长空白和原生替换等待。RC7 已包含“保持更新窗口到平台更新器接管”的修复，但这次升级的安装准备阶段由旧的 RC5 进程执行，不能用于评价 RC7 中的新过渡逻辑。
3. Windows 从 RC5 检查并安装 RC7 时，NSIS 反复提示“因赛AI 无法关闭”；重试后又出现 `Failed to uninstall old application files. Please try running the installer again.: 2`。诊断时可见安装器位于 `insight-desktop-updater\pending`，升级始终无法完成。
4. RC8 增加 Windows 辅助窗口装饰隔离和旧卸载器非原子清理回退，并只生成 Windows Candidate artifact。直接覆盖安装 RC8 后仍出现同一“因赛AI 无法关闭”提示，说明仅在旧卸载失败后回退不足以解除安装目录中的存活进程与文件占用。RC8 未创建公开 Release，也未推进 Candidate 指针。
5. RC9 在调用旧卸载器前主动终止注册安装目录内的旧版本进程，并让 Shell 停止 Windows Harness 时终止完整进程树；同时修复 macOS 临时位置更新和安装中重复检查的状态冲突。
6. RC9 以 `target=all` 完成全平台发布并把 Candidate 指针从 RC7 单调推进到 RC9。该动作向所有低于 RC9 的 Candidate 客户端开放发现，但不等于完成了 Windows 和 macOS 的人工安装验收。

## Windows 根因与修复

### 观察到的失败

- 主窗口退出不代表随包 Node/Electron 子孙进程已经退出。
- 旧卸载器在删除安装目录前仍可能检测到存活进程，先弹出“无法关闭”并等待人工重试。
- RC8 的回退位于旧卸载器原子清理失败之后；如果旧卸载器先被进程检测阻塞，回退无法解决前置占用。

### RC9 处理

- `HarnessRuntime.stopChild()` 在 Windows 上对已知 Harness PID 执行 `taskkill /pid <pid> /t /f`，终止完整进程树；失败时才退回直接强制结束子进程。
- NSIS 在调用旧卸载器前，从注册表解析旧安装目录，只停止 `ExecutablePath` 位于该目录下的进程。最多尝试三次，并在每次后重新检查；不按产品名宽泛结束其他进程。
- 旧版本原子卸载返回非零或仍残留文件时，继续保留 RC8 的普通删除路径重试；失败则明确以错误码 2 停止，不静默安装成混合版本。
- 用户数据位于安装目录之外，且安装器继续使用 `KEEP_APP_DATA`/`deleteAppDataOnUninstall=false`，进程清理与旧应用删除不应删除账号、会话、工作区或插件数据。

### Windows 人工验收

在保留真实旧版数据的 Windows x64 机器上，从已安装且正在运行的 RC5 或 RC7 直接更新到 RC9：

1. 不预先用任务管理器或 PowerShell 结束因赛AI、Harness 或 Node 进程。
2. 在客户端内完成检查、下载并点击安装重启。
3. 安装器不得再次出现“因赛AI 无法关闭”或错误码 2；版本最终为 `1.0.0-rc.9`。
4. 重启后登录、会话、工作区、设置和用户插件保持不变，且不存在旧安装目录进程或孤儿 Harness。
5. 另做一次 RC9 干净安装和卸载。当前 Windows 安装器未签名，SmartScreen/未知发布者提示属于已知风险，但卡死、无法继续或删除用户数据均不允许接受。

## macOS 临时位置与安装状态

### 观察到的失败

一台 Apple Silicon 机器运行 RC5 时，错误堆栈中的应用路径位于 `/private/var/.../AppTranslocation/.../因赛AI.app`。在平台更新器已经进入 `installing` 状态后，再从菜单触发检查更新，会发生 `不允许从 installing 状态转换到 check`。

`AppTranslocation` 或 `/Volumes` 中的应用不是可安全原地替换的正式安装位置。即使下载和签名均正确，也不应让平台更新器尝试修改临时、只读或系统随机化路径。

### RC9 处理

- 打包后的 macOS 应用仅在持久安装路径支持真实更新；可执行路径包含 `/AppTranslocation/` 或位于 `/Volumes/` 时，更新策略返回不支持，并提示先把应用移到“应用程序”。
- `checking`、`downloading`、`downloaded`、`installing` 都视为忙碌阶段；此时无论自动还是菜单手动检查都直接复用当前状态，不再触发非法状态转换。
- 验收时必须从 `/Applications/因赛AI.app` 启动，并先退出、推出 DMG，不能把已打开窗口或版本号当作安装路径证据。

## macOS 安装等待的真实边界

RC7 的过渡修复只覆盖 Electron 仍存活的准备阶段：工作区停止时保留更新窗口、显示准确文案和不确定进度，直到平台更新器接管退出。是否生效必须由“安装了 RC7，再升级到 RC9 或更高版本”验证，不能用 RC5 到 RC7 的体验倒推。

平台更新器接管后，Squirrel.Mac 仍需校验、解包并替换约 1GB 的完整签名应用。blockmap 只减少网络下载量，不把本地安装变成热更新；Electron 进程退出后也不能继续渲染动画。1.0 不增加独立签名安装助手，因此允许存在短暂的原生无窗口间隔，但不允许 Electron 仍运行时长时间暴露空白主窗口，也不允许安装失败后没有错误或整包兜底。

## RC9 发布证据

- Shell commit：`f08e9e58c7f3e68797835dfe87e31cdafeabd284`。
- Core Runtime：`insight-runtime-v0.1.1-rc.10` / `833f4246abaf3ce5fcf39c3f81a8be2499e7f434`。
- 本地门禁：96 个测试文件、612 项测试，TypeScript、Electron build、发布 workflow 契约和 release preflight 通过。
- [Release Run 34594554994](https://github.com/Boxser567/insight-desktop-shell/actions/runs/34594554994)：preflight、macOS Apple Silicon、macOS Intel、Windows x64、Sonoma 分发兼容和签名 Draft 六个 Job 全部成功。
- [Stage Run 34619316086](https://github.com/Boxser567/insight-desktop-shell/actions/runs/34619316086)：通过 GitHub OIDC、测试 Gateway 和目录级 STS 首次写入 `desktop/releases/v1.0.0-rc.9/`，`reusedImmutablePrefix=false`。
- [Promote Run 34619580638](https://github.com/Boxser567/insight-desktop-shell/actions/runs/34619580638)：公开 [v1.0.0-rc.9 Pre-release](https://github.com/Boxser567/insight-desktop-shell/releases/tag/v1.0.0-rc.9)，并把 Candidate 指针从 RC7 推进到 RC9。
- Release 含 12 项资产，共 `1,426,393,392` 字节；Manifest 记录相同 Shell/Core 身份和三个目标平台。
- 2026-09-14 中国大陆公网复验 `candidate/current.json` 为 HTTP 200、`1.0.0-rc.9`、`Cache-Control: public,max-age=60,must-revalidate` 和 `X-Swift-CacheTime: 60`。

## 1.0 放行结论

- macOS 基本应用内更新能力从 RC3 到 RC4 已人工证明；安装过渡优化与临时路径保护以 RC7 到 RC9 为最终验证组合。
- Windows 的 RC7/RC8 失败已经形成回归场景；只有真实旧版本到 RC9 不经人工杀进程完成更新，才能关闭该阻断项。
- RC9 是当前最完整且唯一应继续验收的 Candidate。RC6 保持未推广，RC8 只保留为失败修复过程证据，不再向 OSS 或公开渠道补资产。
- Stable 发布前还需完成两平台 N→N+1、同源完整安装包兜底、数据连续性，以及 Windows 未签名风险的最终接受记录。
