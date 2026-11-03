# Insight 基线集成记录

[English](baseline-changes.md) | 中文

## 范围

本记录标明私有 Insight 源码接入与 Desktop 集成修改的既有 DSH 文件，不重复列出未变更上游源码或新增私有包内部实现。官方 Desktop 保持为默认产品，并保留既有启动、profile、账号、窗口和更新行为；Insight 路径在 Electron 读取产品状态前通过显式选择启用。

## 既有文件变化

| 文件 | 目的 | 保留条件 |
| --- | --- | --- |
| `packages/client/ui-conversation/src/client/locales.ts`、`skeleton/EmptyHero.tsx`、`skeleton/HeroShell.module.css` 及测试/快照 | 直接在共享字典使用 Insight 中文欢迎语，并移除预览标签及无用样式；不新增标题插槽 API | 用户明确接受共享 Web/Desktop 品牌变化。同步基线时保留中文标题与标签移除，其他语言的标题翻译继续沿用上游 |
| `apps/desktop-host/package.json`、`apps/desktop/package.json` | 让四个私有 Insight 包进入既有递归运行时与 Main 进程依赖闭包 | Insight 组件随桌面运行时交付期间保留 |
| `apps/desktop/src/main.ts` 及其测试 | 在 `userData` 前选择产品，要求 Insight 登录先于 Host 启动，把一个账号 Home 与凭据回调绑定到 Host，暴露渲染器安全账号操作，应用品牌，并且只在账号关停后重启 | 保持 Insight 生命周期分支显式，同时让官方路径不变 |
| `apps/desktop/src/product.ts`、`insight-startup.ts`、`insight-account-exit.ts`、`insight-native-brand.ts` 及其测试 | 在上游 Main 流程外负责经校验的产品/运行时标识、隔离认证、隐藏的已保存登录态恢复、native Home 准入、有序账号拆除与产品原生标签 | 保持为产品模块，避免把 Insight 状态分散到通用 Desktop 服务中 |
| `apps/desktop/src/host-process.ts` 及其测试 | 只在当前 Host 子进程与 Desktop Main 之间承载有界、经校验且可取消的账号令牌请求 | 为每个 Host 消费方保留令牌隔离、当前子进程校验与拆除取消 |
| `apps/desktop/src/preload-app.ts`、`preload-insight-login.ts`、`client/insight-login.tsx`、其测试与 `tsdown.config.ts` | 构建登录渲染器桥接，并且只向已认证顶层 Insight 工作区暴露账号摘要与退出；通过仓库源码 alias 解析渲染器工作区导入 | 让两个渲染器上下文都无法获得令牌或不受限 Main IPC，并使冷 Desktop 构建不依赖预构建工作区 `lib/` 输出 |
| `apps/desktop/src/project-manager.ts`、`fatal-recovery.ts` 及其测试 | 在 profile 创建、已有 profile 准备和插件恢复时保留产品必需的四个 bundle；只在登录后安装账号范围恢复 | 绝不让认证前恢复打开官方 Home 或其他账号 Home |
| `apps/desktop/scripts/dev.ts`、`development-app.ts`、`electron-builder-config.mjs`、其声明及测试 | 应用 Insight 应用 id、名称、图标、与 Shell 兼容的开发 userData、包元数据和产品/运行时版本拆分；将根内置技能目录复制为 Insight 专属资源 | 保持构建标识和资源复制为条件行为，让官方制品和签名输入不变 |
| `apps/desktop/scripts/installer.nsh`、`apps/desktop/installer/path.nsh` 及定向安装器测试 | 仅 Insight appId 在相同 HKCU 已登记目录内识别旧 Windows 程序名，并在替换前检查新旧完整程序路径 | 保留路径校验、当前用户安装、appId/GUID、旧安装目录及未登记非空目录拒绝；不终止进程，不增加全局安装支持 |
| `apps/desktop/scripts/package-target.ts` 及其测试 | 在桌面闭包选择前打入精确私有组件，并把 Insight 产品版本与 DSH 运行时版本分别记录 | 保持私有桌面打包和发布标识与公开发布成员独立 |
| `apps/desktop/electron-builder.config.d.mts`、`apps/desktop/scripts/smoke-packaged-runtime.ts`、其测试与 `scripts/run-gates.ts` | 校验产品专属打包元数据，在 built-smoke 清单中运行 Integration 真实 Loader 测试，并按产品决定对受门控的 Insight Windows 包跳过官方 Authenticode 检查 | 保持打包检查与 Insight 产品制品及私有 bundle 运行时入口一致；产品豁免仅适用于 Authenticode，仍须保留 Ed25519 更新文档验签以及 payload 大小和 SHA-512 绑定 |
| `apps/desktop/tsconfig.host.json`、`tsconfig.client.json` | 从 Desktop 构建引用可移植 Integration Host 与 Client 编译面 | 保持 Electron 导入属于 Desktop 适配层，并显式区分可移植包编译面 |
| `apps/desktop/src/insight-permissions.ts`、`main.ts`、`product.ts` 及其测试 | 执行已批准的 Insight 专属剪贴板、全屏及主 frame 音频权限矩阵；接入原生重启、日志、缩放和全屏菜单；在登录 shell 解析后传入固定必需 bundle 策略、随包 Node 路径及存在的内置技能目录 | 保留官方产品路径；每次同步基线复核两类权限回调、原生 frame 所有权、OS 音频授权、primary-runtime 布局和产品资源路径 |
| `apps/desktop/src/update-coordinator.ts` 及其测试 | 允许可信 Main 进程调用方在既有检查锁内配置一个自定义提供方，将可用版本绑定到提供方和精确 updater 产物，在活动检查后串行执行不同的手动来源，并且只清除匹配且尚未使用的目标 | 保持官方无参数来源行为不变；保留单一协调器、独立下载与安装授权、陈旧确认拒绝、监听器清理，以及候选在清除或下载前的所有权 |
| `apps/desktop/src/main.ts`、`insight-updates.ts`、`insight-update-provider.ts`、`insight-update-window.ts`、`preload-insight-update.ts`、Insight 更新渲染器、`tsdown.config.ts` 及其测试 | 在登录前创建 Insight 更新拥有者，将同一个协调器交接给已认证工作区，通过 electron-updater 公开 custom-provider API 适配已验证元数据，并构建隔离更新窗口与 preload | 正式版应用只检查正式版，预发布应用仅在没有正式版更新时继续检查内测版；保留显式内测操作的原生确认，移除更新子窗口菜单；渲染器输入不含 URL 和可信身份，官方 Desktop 更新路径不变 |
| `apps/desktop/scripts/{desktop-package-environment,electron-builder-config}.mjs`、`package-macos.ts`、`package-target.ts`、`insight-packaging.mjs`、其声明及测试 | 在复用 DSH macOS 签名、公证、打包校验和目标编排时，选择 Insight 应用名称、产物前缀、产品版本、固定更新资源与 generic updater 配置 | 保持产品选择显式；绝不让 Insight 包满足官方发布器完成记录或改变官方 COS 与强更输入；Windows Authenticode 豁免只作用于 Insight 产品 |
| `apps/desktop/scripts/electron-builder-config.mjs`、`apps/desktop/scripts/prepare-windows-installer.ps1`、`apps/desktop/installer/extract-report.h` 及其测试 | 只为 Insight 包传入专用安装器资源目录，在既有 NSIS 转义前把 locale 字符串中固定的 `DeepSeek Harness` 替换为已解析产品名；PowerShell 准备脚本接受该可选目录，并把产品名注入 `Compose` 报告首行 | 官方资源、locale 字符串和解压报告标题保持 DSH 默认值；不修改 locale helper API、应用 id、GUID、per-user 安装、许可文本、解压或安装逻辑、C++ 调用方或 DSH/NSIS 执行路径 |
| `apps/desktop/scripts/electron-builder-config.mjs`、`smoke-packaged-runtime.ts`、`insight-packaging.mjs`、其声明与测试 | 为 Insight 选择 `win.executableName=insight-desktop`，runtime smoke 定位同一个 Windows 主程序；assisted NSIS 通过既有产品文件名机制推导新装默认目录 | 保留显示名称、macOS 应用名称、应用 id、GUID、既有安装目录发现和官方产品主程序，不增加安装路径覆盖逻辑 |
| `apps/desktop/scripts/verify-macos-signature.mjs` 与 `apps/desktop/tests/macos-disk-image-signature.spec.ts` | 仅当同一个公证后 DMG 只读 `stapler validate` 失败同时包含 status 68、`NSURLErrorDomain`、精确 `Code=-1005` 和 `api.apple-cloudkit.com` 时重试；总计最多三次，间隔 2 秒和 5 秒 | 精确恢复默认作用于所有产品，但不重新签名、重新提交公证、staple、重试 App 验证或 `spctl`，不新增命令 timeout，也不放宽最终检查；耗尽后保留最后一次验证错误 |
| `apps/desktop/package.json`、`pnpm-lock.yaml` | 将 `@electron/notarize` 从 `2.5.0` 升级到 `3.1.2`，使用包含 [PR 306](https://github.com/electron/notarize/pull/306) staple 重试修复的上游版本。上游流程只提交一次，对同一 artifact 先执行 staple，并为所有产品最多重试三次；不增加私有 hook，也不修改 notary executor | 持续覆盖自定义 notarytool path、单次提交、staple 最多四次、非 staple 失败行为、cleanup 与原验证顺序。保留既有签名、提交、完整 `codesign`、`stapler validate`、`spctl`、ZIP 与审计顺序；平台验证由打包工作流负责 |
| `.github/workflows/insight-package.yml`、`.github/workflows/insight-publish.yml`、`scripts/insight-release/`、根发布工具依赖及锁文件 | 分离已签名 GitHub Release 构建与绑定来源的 OSS 发布；隔离发布器运行时依赖和私有签名材料；先发布不可变对象，再在单发布者串行约束下核对、替换并回读渠道指针 | 端到端绑定源码提交、仓库、工作流运行、目标、版本、摘要和签名身份；调试包不得发布，结果未知的写入必须先核对，不能覆盖重试 |
| `packages/boot/plugin-manager/src/{index,types,tools,diagnostic}.ts`、测试及包元数据 | 将默认空的必需 bundle 配置与可信产品策略合并，在执行端拒绝停用、移除、更新和替换，并检查安装别名与归档 | 保留执行端校验、manifest 事务恢复、有界归档解析及用户 registry；基线提供等价保护后才移除本地策略 |
| `packages/client/ui-plugin-manager/src/client/{presentation,locales}.ts` 及组件测试 | 为产品必需组件解释已有只读状态 | 展示状态从 Host 策略派生，保留组件内部功能开关 |
| `packages/client/ui-conversation/src/client/contract/input.ts`、`input/facade.ts`、`input/selected-skills.ts`、README 及强类型 Client 测试消费者 | 在实时编辑器文本上恢复已批准的 `toggleSkill`，派生 `selectedSkills`，不扫描引用、Quote 或命令内容 | 保留可见草稿语义、Session 所有权、忙碌/释放保护与局部编辑回归；同步基线后复核编辑器投影与动作签名 |
| `packages/client/ui-chat/src/client/{contract/slots.ts,chat/MessageItem.tsx,chat/register-node-renderers.ts,index.ts}`、局部测试及生成的 Client 目录 | 提供完整的 session-scoped `conversation.chat.user.message` Factory，供原生及 Canvas user/steering 行复用；既有来源装饰 chain 由 Factory 拥有 | 复用原生正文及消息操作，保持 steering、pending/echo 和记录数据语义；上游消息渲染变化后重跑真实注册的 Canvas 历史回归 |
| `packages/llm/llm-pi-ai/src/index.ts` 与 `tests/adapter.spec.ts` | 公开托管网关构建所需的既有 `resolveProfiles`、`credentialStoreFrom` 与 `authContextFrom` helper | 用户明确授权的增量导出；保留上游实现，基线提供这些导出后移除本地差异 |
| `pnpm-workspace.yaml`、`pnpm-lock.yaml` | 在根依赖锁和构建策略下解析 iframe 及其保留的 Motion 依赖边 | iframe 有其他明确受支持的构建拥有者后再调整 |
| `tsconfig.base.json`、`tsconfig.host.json`、`tsconfig.client.json`、`apps/web/tsconfig.json` | 将保留的插件名与 Integration Client 入口解析到源码，显式编译各面；Canvas 记录会话 Web 测试只归属 Host 程序 | 这些标识仍不属于生成的 DSH alias 时保留 |
| `scripts/check-workspace-constraints.ts` 及测试 | 强制精确私有标识、根版本、发布元数据和唯一拥有者 | 仅在上游提供同等严格产品输入规则后替换 |
| `scripts/package-dependency-policy.ts` 及其测试 | 精确分类 Host 值导出、保留工具共享 peer，并拒绝未审查的导出 | 保留共享服务 peer，不扩大为整包安全声明 |
| `scripts/npm-baseline-packages.ts` 及测试 | 从公开 npm 基线精确排除私有输入 | 发现方式变化时仍需保留发布拒绝 |
| `scripts/product-package-policy.ts`、`scripts/verify-product-use.ts` 及测试 | 标明 Insight 必需组件，不挂载到官方默认 profile | 实际产品可达性覆盖该声明后才能移除 |
| `.gitattributes` | 在 Git 暂存与检出时保留同步技能和两份上游 Canvas HTML 的原始字节 | 防止换行转换破坏源码回放 |
| `package.json`、`.gitignore` | 提供技能标签生成、源码回放和 `dev:insight` 快捷入口，保留公开画布路由配置并忽略生成物 | 客户端仍读取根同步目录标签时保留 |
| `scripts/translation-pairing.ts` 及其测试、`docs/i18n/README.md` 及其配对 | 将外部同步的根技能目录排除于本地文档改写之外 | 该目录由来源仓库维护时保留 |
| `scripts/rescope-vendor.ts` 及其测试 | 保留同步的根技能资产，并容纳增加后的文件清单 | 外部技能资产持续排除于本仓库改写之外 |
| `scripts/verify-application-entrypoints.ts` | 按原有归属分类保留的 Memory 数据同步 worker 与技能辅助脚本 | 对应脚本退役时再移除分类 |
| `scripts/persistence-schema.ts` 及其测试 | 保留引用 Host 项目的 TypeScript 声明根，不把允许引入的 JS 当成 TypeScript 根文件 | 引用包可能包含 JS Host 输入时保留 |
| `docs/config-catalog*`、`docs/event-producer-consumer*`、Client 插槽目录及组合参考包清单 | 为私有输入重新生成声明和参考 | 从源码生成，不手改生成内容 |
| `docs/persistence-catalog*`、`docs/persistence-schema.json` | 描述两个仅含信息的画布消息来源新增 | 保留新增确认记录，不改接受的历史记录与写入版本 |
| `packages/README.md` 及配对文档、`docs/subsystems/README.md` 及配对文档 | 链接新组并说明私有产品归属 | 随包组一起维护 |
| `scripts/translation-pairing.manifest.json`、`scripts/verify-repository-references.ts` 及其测试 | 仅冻结的 `docs/insight/history/` 保留原始语言和提交证据；相邻目录及组织 URL 限制继续检查 | 用户明确批准的 P6 文档接入；现行文档仍双语维护，目录只存历史，原始及迁入摘要记录在导入清单中 |
| `scripts/verify-package-paths.ts`、`scripts/verify-concrete-terms.ts` 及其测试 | 仅已封存的 Shell 快照保留旧仓路径和原始字段名，不将历史证据当作当前 DSH 源码 | 用户单独批准的补充；相邻目录和现行文档继续检查，快照文件集合与字节由引用门禁验证 |

## 新增集成的拥有者

更新协调器扩展、Main 单 updater 适配、更新窗口编译入口和产品打包扩展是 P5 已获明确授权的四组官方 hook。`tsconfig` alias 属于编译入口。表中的三个 Windows 品牌文件与 DMG 验证恢复是另外四个已授权官方文件；该范围不包含 locale helper、C++ 调用方或 notary executor 改动。

精确私有包清单位于 [insight-package-policy.ts](../../scripts/insight-package-policy.ts)。[Insight 产品集成](architecture.zh.md) 说明运行时归属、源码快照与同步技能。[Desktop Integration 包](../../packages/insight/desktop-integration/README.zh.md) 负责认证与账号进程行为。每个固定业务包的 `upstream.json` 和 `patches/insight` 下可回放差异记录引入源码及本地适配。

Desktop Integration 包也负责已签名更新发现、本地投放状态、内测确认和渲染器安全更新操作。Desktop Main 拥有唯一的 electron-updater 实例和原生窗口适配器。[Insight 发布脚本](../../scripts/insight-release/README.zh.md)负责产物 manifest、GitHub 来源验证、签名、单一发布者的写前核对与写后回读，以及相互独立的正式版和内测版发布格式。

`bundled-skills` 保持来源仓库的内部结构。引入的标签生成器保留原有目录到客户端元数据流程；测试使用合成文件，不评价内置技能内容或业务结果。

[画布来源确认记录](../persistence-changes/2026-10-28-insight-canvas-attribution.zh.md) 记录读者兼容性，不改变 Session 写入版本，也不迁移用户数据。

## 基线同步

逐项对照引入的基线，只有替代实现保留表中的产品选择、登录顺序、账号隔离、凭据限制、发布标识与发布保证后才删除本地改动。既有官方文件变化时更新本记录，私有包内部改动由包文档、来源记录和 Git 历史追踪。

更新工作不改变 P4 的账号 Home 决定或四个必需组件。Insight 仍打开账号既有的 `harness` 目录，Integration、Canvas、Memory 和 Prompt 仍是随客户端更新的受保护产品组件。

## Host 值依赖分类

`createUserMessage`、`BlockAssembler` 和 `domainTable` 是精确的安全 Host 导出，返回结构值或持有调用方局部状态，不要求消费者共享服务构造器或模块状态。Canvas 与 Prompt 声明对应的运行时依赖边，`defineTool` 保持共享 peer，因为它的参数失败必须保留 Host pipeline 识别的错误类身份；这些 provider 的其他导出保留现有分类。包含这些新增项的 PR 必须按 `scripts/package-dependency-policy.ts` 要求，在醒目的 Host 依赖分类专节披露。

托管网关从 `dsh-llm` 导入 `LlmAdapter`、`LlmError` 与 `resolveImageAttachmentAccess`，从 `dsh-llm-deepseek` 导入 `resolveAdapterOptions`，从 `dsh-llm-pi-ai` 导入 `PiAiAdapter`、`resolveProfiles`、`credentialStoreFrom` 与 `authContextFrom`。这八个精确导出均要求共享 peer：私有 bundle 使用 Host 的适配器、错误、profile 和认证实现，避免再安装一份提供方。没有增加允许重复安装的安全例外。

## 必要性与实现选择

产品要求已经确认，具体实现仍是维护取舍。下表区分必须保留的行为和当前共享扩展。固定比较与逐文件提交证据保留在[进入 P6 前的审阅清单](history/shell/analysis/2026-11-02-dsh-insight-p6-preflight-review.md)，当前文件变化仍以实际 Git diff 为准。

| 要求 | 原有扩展点为什么不够 | 决定及代价 |
| --- | --- | --- |
| 业务 Host 前登录并复用旧账号 Home | Host 插件无法控制 Host 启动前的 Electron 生命周期，也不能拥有原生加密凭据 | 保留 Main/Host 接入，不另建 launcher 或客户端。Main 接线是实际同步后再评估的维护成本，不据此提前建立框架 |
| 托管模型认证 | 引入基线中的 Pi AI 包未公开网关所需的既有 profile/认证 helper | 公开三个 helper，避免复制实现；上游提供等价导出后删除本地差异 |
| 四个必需组件 | 默认安装或界面禁用无法阻止 Host/工具/API 删除和替换，旧 profile 配置可能覆盖普通 bundle config | 保留执行端保护和 Main 固定策略。当前拒绝无法识别包身份的安装来源，包括超限本地归档，属于需单独取舍的产品限制 |
| 与 Shell 一致的技能选择 | 整段替换草稿会丢失原子引用、引文或摘录，既有公开动作无法安全切换任意位置技能 token | 保留已批准的 toggleSkill/selectedSkills 扩展；代价是共享输入 API 引入技能概念，上游改变编辑器投影时需复核 |
| Canvas 历史节点引用 | 来源装饰链只能增加呈现，无法在保留完整原生消息行的同时替换带标签的正文 | 保留完整消息 Factory，避免 Canvas 复制原生消息行。来源链拥有者变化属于共享语义变化，需要回归覆盖 |
| 签名 OSS 发现与唯一 updater | 内置来源选择无法将 Insight 已验证 metadata 和渠道决定绑定到现有更新候选 | 在串行协调器中保留 custom provider 和目标绑定，保持下载/安装分别授权及生命周期归属 |
| 品牌、随包技能与旧安装连续性 | 产品身份、原生资源、运行时闭包和 NSIS 路径检查由 Desktop 打包拥有 | 保留产品输入和当前用户兼容，不恢复全局安装支持或已删除的 qualification 阶段 |
| macOS 构建稳定性 | 实际遇到的 staple 与公证后 ticket 验证失败属于不同阶段 | 保留已验证的依赖升级和有界只读验证重试。两者不属于 Insight 业务功能，也会影响官方构建 |

## 基线更新的影响

产品开关只能限制运行行为，不能消除源码、依赖或语义耦合。上游改变 Main、Host 启停、更新协调器、消息 Factory 或编辑器投影时，需要人工对齐行为；其次关注插件安装和打包运行时布局。三个 helper 导出及精确包分类属于较小的增量差异。Git 合并无冲突不等于验收通过。

公证依赖从 2.5.0 到 3.1.2 属于 SemVer 跨主版本升级，应按共享构建依赖升级处理，不能只称为补丁维护。它处理 staple 重试，本地 CloudKit 规则处理更晚的 DMG 只读验证；替代能力保留对应阶段行为后，才移除各自本地差异。

合并基线前保留已知可用的提交点。阅读上游对相关所有者的变化，不覆盖共享历史；用包管理器协调锁文件，从源码重新生成目录，不手工拼接生成结果。按受影响消费者执行定向行为/记录会话检查；运行时布局或安装器变化才需要真实制品。仅文档合并不要求重新打包。本次 P6 审阅未实际合并新版基线，上述相对成本不构成实测工时。

[后续事项](follow-ups.zh.md)保留插件来源策略、平台反馈和历史检查债务。必要行为的证据继续保留；上游替代及其实际消费者验证后，再移除本地接入和专属测试。

## 开发备注

无。
