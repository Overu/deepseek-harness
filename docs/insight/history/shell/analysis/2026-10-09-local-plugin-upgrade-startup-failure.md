> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# 1.0.4 升级后本地插件安装源缺失导致启动失败

## 结论与证据

本次机器从 Stable 1.0.3 升级至 1.0.4 后，依赖修复在读取历史本地插件 `.tgz` 时报 `ENOENT`，尚未进入 Harness 运行阶段。Profile 中的 `file:` 依赖仍指向原开发目录，原压缩包已不存在。先后涉及 `@insight-ai/desktop-canvas-plugin` 和 `@insight-ai/social-publisher`。

故障页面没有指出对应插件，是因为依赖修复错误通过 `message` 传入，而原故障识别主要读取运行时日志中的插件加载证据，没有将缺失安装源映射回 Profile 依赖。

用户在安全模式主动卸载相关插件后，普通启动日志记录依赖修复成功，并于 2486ms 进入主界面；下一次启动无需重新修复，于 1891ms 进入主界面。没有恢复用户已卸载的插件。这些证据支持本机历史安装源问题，不足以推断全部 1.0.4 客户端均无法启动。

## 修复范围

- 桌面导入 `.tgz` 时，先将原始字节保存至当前 Profile 的 `.insight-local-plugins`，再通过原有官方 `dsh plugin add` 命令安装。每次使用独立文件，避免同名导入覆盖旧源。原下载文件删除后，依赖重装仍可读取内部安装源。
- 将启动修复错误传入故障识别，仅在 `ENOENT` 的完整引号路径与声明的 `file:*.tgz` 安装源一致时，识别对应插件。继续使用现有过滤，避免将 Core、宿主内置包或无关依赖作为可卸载目标。
- 保持开发目录导入的原有链接行为。不改变 Core、依赖修复完成标记、发布渠道及已发布安装包。

历史记录中已丢失的安装源不会凭空恢复；仍需卸载对应插件，或从可信原包重新导入。此次修复针对后续桌面压缩包导入及旧故障的准确识别，不自动重建已删除包。已发布的 1.0.4/1.0.5 安装包尚不包含本次源码修复。

## 验证

- 修复前新增回归测试复现安装源未保存和无法识别对应插件；修复后通过。
- 完整测试：129 个文件通过，944 项通过、2 项跳过；需要 localhost/Electron 的测试在允许本机端口的环境运行。
- 类型检查、桌面集成构建、Electron 主进程/预加载/渲染构建及 About 沙箱预加载检查通过。
- 真实 `.tgz` 离线验证：先保存内部安装源，再删除原下载目录；使用两个全新的 pnpm 缓存，首次安装与删除 `node_modules` 后的模拟升级重装均成功。复用现有 Runtime，没有重新下载 Core 产物。

## 1.0.6 本地验收发现的另一类插件启动失败

2026-10-09 13:30（上海时间）的普通启动并非安装源缺失。日志显示 Profile 中的 `@deepseek-ai/dsh-tools@0.1.6-alpha.2` 被新版 `0.2.1-alpha.1` 的兼容性预检拒绝，必需的 `agent-loop` 因等待 `tools` 服务无法激活。进入安全模式时使用独立 Profile，因此可以启动。

该旧包由已安装的 `@insight-ai/desktop-canvas-plugin@0.3.0-alpha.7` 的普通固定依赖带入，并被 pnpm hoist 到 Profile 根 `node_modules`。官方模块解析规则保留最近安装包优先，故这份旧工具包遮蔽了 Runtime 提供的工具实现。官方集成指南要求此类共享 Core 服务通过 `peerDependencies` 使用宿主实例，Profile 的 `autoInstallPeers: false` 则阻止额外安装一份 Core。不是钥匙串授权引起，也不是会话历史迁移错误；没有依据认定历史或配置已被删除。

修复分为两部分：

- 画布插件生成独立 `0.3.0-alpha.8`，将 `dsh-tools` 改为宿主 peer，开发依赖保留在插件开发仓库。兼容声明限制为本次验证的 `0.1.6-alpha.2` / `0.2.1-alpha.1`，不授予版本豁免、不关闭官方兼容检查。
- Shell 收集官方兼容性拒绝日志中的包名，再复用现有归属识别映射至声明该依赖的第三方插件。只提供第三方根插件作为恢复目标；没有可证明的插件归属时，不提供卸载 Core 的操作。

验收证据：在原账户 Profile 的副本中复现同一错误；通过官方 `dsh plugin add` 离线升级画布插件后，hoist 的旧 `dsh-tools` 已由包管理器移除，**原安装的 1.0.6 Runtime（Core `c3aaab2` / `insight.3`）正常启动，会话 API 和因赛模型目录就绪**。副本中其他插件声明、bundle 列表、用户 patch 不变；原账户的 manifest、patch、锁文件 SHA-256 前后相同。画布插件 41 项测试及类型检查、生产构建通过；在新旧两版 Core 的独立 Profile 中，官方安装、页面及资源鉴权、桌面登录保护、卸载验证均通过。Shell 完整测试 955 项通过、2 项跳过，类型检查及 Electron 构建通过。新故障识别用实际复现日志确认仅归因到画布插件。

这次暴露了原本只验证干净 Profile 的启动冒烟覆盖缺口，不能把“干净 Profile 可启动”当作“所有旧插件组合升级兼容”。本次没有修改实际账户的安装状态，没有恢复用户主动卸载的 `social-publisher`。Shell 三平台 Candidate 构建仍等待用户本地验收通过，不改写既有 Core tag，也不重新发布 Stable 更新。

官方规则参考：Core 仓库 `.agents/notes/implemented/architecture/2026-09-19-profile-resolution-lookup-order.md` 的正常安装指南与解析表；实现为 `packages/boot/app-boot/src/profile-resolution/resolver.ts`、`compatibility-preflight.ts`。
