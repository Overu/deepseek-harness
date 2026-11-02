> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# P6 前 DSH 官方改动审阅清单

日期：2026-11-02（Asia/Shanghai）。状态：仅供进入 P6 前 review，尚未执行 P6 代码退役或报告迁移。用户确认此清单后，才进入 [P6 计划](2026-11-02-dsh-insight-p6-handoff.md#8-本轮补充要求与确认点)。本次提交是现有阶段成果和文档检查点，不新增功能修改。

## 1 比较依据与阅读顺序

- 官方引入基线：`f3803c96974ad4a94195fb97e5c637e9c2a3afe3`，DSH 0.2.2-alpha.2，本地 master/migrate 同指向该提交；已确认是 Insight 源码祖先。不能用当前远端 origin/master 直接代替这个引入点。
- 功能源码审阅终点：`a7088fdb63c0d04499fdf4d50ae31d0e73b40b0f`。其后本轮提交只修改文档，功能差异仍以这个提交固定。
- 已发布 Candidate 1.0.10 的安装包来自 `95c1477d080ef88330ef961f41042cedba627fd5`，不包含其后双协议 Candidate reader 修复。当前源码和已发包不能混称。
- 整体差异为 1,664 个路径：新增 1,521、修改既有 143，无基线文件删除；大部分新增属于 Insight 业务源码、固定快照与技能资产，不能把总文件数当作官方源码修改量。

优先看第 2 节的共享行为及 Main 接入，再看构建/安装；第 3–4 节说明配套改动，第 5 节是完整文件目录。日后同步维护依据为 [官方基线台账](../../../baseline-changes.zh.md)，本页固定本次审阅快照，不替代长期台账。

在当前 DSH 工作区可用以下命令 review 生产源码，或使用 [固定源码比较](https://github.com/Overu/deepseek-harness/compare/f3803c96974ad4a94195fb97e5c637e9c2a3afe3...a7088fdb63c0d04499fdf4d50ae31d0e73b40b0f)。完整比较包含大量新业务文件；后一个命令只展示已存在的官方文件，仍包含配套测试/文档。

```sh
git diff f3803c96974ad4a94195fb97e5c637e9c2a3afe3 a7088fdb63c0d04499fdf4d50ae31d0e73b40b0f -- apps/desktop/src packages/boot/plugin-manager/src packages/client/ui-conversation/src packages/client/ui-chat/src packages/client/ui-plugin-manager/src packages/llm/llm-pi-ai/src
git diff --diff-filter=M f3803c96974ad4a94195fb97e5c637e9c2a3afe3 a7088fdb63c0d04499fdf4d50ae31d0e73b40b0f
```

## 2 直接修改的既有生产实现：31 个文件

此处包含 6 个 Desktop 运行时文件、13 个共享包运行时文件、10 个开发/打包脚本和 2 个安装器文件；测试、声明配置、依赖、生成目录及新增适配器均另列。表中“产品分支”表示设计及现有实现的作用范围，不替代行为验证。

| 责任组 | 既有文件 | 为什么需要修改 | 同步基线时的重点 |
| --- | --- | --- | --- |
| 启动、账号与数据归属 | [apps/desktop/src/main.ts](../../../../../apps/desktop/src/main.ts)<br>[apps/desktop/src/host-process.ts](../../../../../apps/desktop/src/host-process.ts)<br>[apps/desktop/src/preload-app.ts](../../../../../apps/desktop/src/preload-app.ts)<br>[apps/desktop/src/project-manager.ts](../../../../../apps/desktop/src/project-manager.ts)<br>[apps/desktop/src/fatal-recovery.ts](../../../../../apps/desktop/src/fatal-recovery.ts) | 原生 DSH 启动时尚无 Insight 登录、账号 API 和旧账号目录选择。Insight 登录先于 Host；按稳定账号身份选原 harness；Main→当前 Host 提供受控凭据，恢复不绕过登录。 | 产品选择、Host 生命周期和凭据拥有者是同步重点；Main 差异最多。新增业务实现尽量委托 Insight 模块。 |
| 唯一更新协调器 | [apps/desktop/src/update-coordinator.ts](../../../../../apps/desktop/src/update-coordinator.ts) | 复用 DSH 下载/安装器接入已验签 OSS 目标，避免第二个 updater；增加可信 custom provider、串行检查、精确目标绑定和安全 dismiss。 | 共享通用 API 变化；官方无参数路径保留，需重点复核检查竞态、旧确认、provider 切换和 dispose。 |
| 四个必需组件保护 | [packages/boot/plugin-manager/src/index.ts](../../../../../packages/boot/plugin-manager/src/index.ts)<br>[packages/boot/plugin-manager/src/types.ts](../../../../../packages/boot/plugin-manager/src/types.ts)<br>[packages/boot/plugin-manager/src/tools.ts](../../../../../packages/boot/plugin-manager/src/tools.ts)<br>[packages/boot/plugin-manager/src/diagnostic.ts](../../../../../packages/boot/plugin-manager/src/diagnostic.ts) | Integration、Canvas、Memory、Prompt 都必须随客户端存在。配置和 Main 固定策略合并，执行端阻止停用、移除和替换，防止旧 profile 或安装别名绕过。 | 共享插件管理器增加产品能力，默认 requiredBundles 为空；策略解析实际在 index.ts，不存在独立 product-policy.ts。 |
| 必需组件状态展示 | [packages/client/ui-plugin-manager/src/client/presentation.ts](../../../../../packages/client/ui-plugin-manager/src/client/presentation.ts)<br>[packages/client/ui-plugin-manager/src/client/locales.ts](../../../../../packages/client/ui-plugin-manager/src/client/locales.ts) | 管理界面解释 Host 返回的受保护状态，避免只有后端拒绝而用户不知原因。 | 从 Host 派生，只增加受保护组件说明，不改变内部功能开关。 |
| 技能多选输入动作 | [packages/client/ui-conversation/src/client/contract/input.ts](../../../../../packages/client/ui-conversation/src/client/contract/input.ts)<br>[packages/client/ui-conversation/src/client/input/facade.ts](../../../../../packages/client/ui-conversation/src/client/input/facade.ts) | 按旧 Shell 功能恢复 toggleSkill，局部改动技能 token，保留文件/会话引用和 Quote；派生 selectedSkills 供 Picker 使用。 | 公共输入接口变化；新增 selected-skills.ts，核对真实编辑器投影、会话归属、忙碌/释放保护与撤销。 |
| Canvas 历史引用消息行 | [packages/client/ui-chat/src/client/contract/slots.ts](../../../../../packages/client/ui-chat/src/client/contract/slots.ts)<br>[packages/client/ui-chat/src/client/chat/MessageItem.tsx](../../../../../packages/client/ui-chat/src/client/chat/MessageItem.tsx)<br>[packages/client/ui-chat/src/client/chat/register-node-renderers.ts](../../../../../packages/client/ui-chat/src/client/chat/register-node-renderers.ts)<br>[packages/client/ui-chat/src/client/index.ts](../../../../../packages/client/ui-chat/src/client/index.ts) | 原生消息行组合改变后，Canvas 无法仅靠旧插槽保留 node-refs 卡片和完整消息操作。导出完整 user/steering 消息 Factory，Canvas 复用正文、附件、复制和来源显示。 | 公共 Factory 和来源 chain 所有权变化；conversation.chat.user.before 仍保留，装饰由 Factory 拥有。重点 review 普通消息、steering、pending/echo 及来源链不重复。 |
| 托管模型 helper 导出 | [packages/llm/llm-pi-ai/src/index.ts](../../../../../packages/llm/llm-pi-ai/src/index.ts) | Insight 模型 token 在服务端维护，需要 PiAiAdapter 原有认证及 profile helper。只公开 resolveProfiles、credentialStoreFrom、authContextFrom，避免复制解析/认证实现。 | 公共导出增加，原 helper 实现不改；上游提供等价导出即可去掉差异。 |
| 开发启动与旧目录 | [apps/desktop/scripts/dev.ts](../../../../../apps/desktop/scripts/dev.ts)<br>[apps/desktop/scripts/development-app.ts](../../../../../apps/desktop/scripts/development-app.ts) | 开发入口也需选 Insight 产品并使用原 Shell 的 dev userData，保留显式隔离路径；支持 dev:insight。 | 产品分支和运行路径；不改变 DSH 官方默认开发入口。 |
| 打包闭包、身份与资源 | [apps/desktop/scripts/desktop-package-environment.mjs](../../../../../apps/desktop/scripts/desktop-package-environment.mjs)<br>[apps/desktop/scripts/electron-builder-config.mjs](../../../../../apps/desktop/scripts/electron-builder-config.mjs)<br>[apps/desktop/scripts/package-target.ts](../../../../../apps/desktop/scripts/package-target.ts)<br>[apps/desktop/scripts/package-macos.ts](../../../../../apps/desktop/scripts/package-macos.ts)<br>[apps/desktop/scripts/smoke-packaged-runtime.ts](../../../../../apps/desktop/scripts/smoke-packaged-runtime.ts) | 产品版本与 runtime 分离；四包、品牌、bundled-skills 和更新窗口进入 DSH 原生安装包；复用签名公证。Windows 按产品决定不签名，exe 为 insight-desktop，显示名因赛AI。 | Insight 元数据与 appId/GUID、旧目录和资源位置是重点；仅 Insight 豁免 Authenticode，不放宽清单验签或文件摘要。 |
| Windows 品牌与当前用户升级 | [apps/desktop/scripts/prepare-windows-installer.ps1](../../../../../apps/desktop/scripts/prepare-windows-installer.ps1)<br>[apps/desktop/scripts/installer.nsh](../../../../../apps/desktop/scripts/installer.nsh)<br>[apps/desktop/installer/path.nsh](../../../../../apps/desktop/installer/path.nsh)<br>[apps/desktop/installer/extract-report.h](../../../../../apps/desktop/installer/extract-report.h) | 保留 DSH/NSIS，替换名称、图标、安装图片和解压失败报告标题；同一 HKCU 注册目录识别旧因赛AI.exe，避免已安装用户被拒绝覆盖升级。 | 仅 Insight，保留非空目录检查和新旧进程检查；不增加全局安装或资格阶段。 |
| macOS 公证网络恢复 | [apps/desktop/scripts/verify-macos-signature.mjs](../../../../../apps/desktop/scripts/verify-macos-signature.mjs) | 真实 CI 遇到 Apple CloudKit 连接中断。对同一已公证 DMG 严格匹配 status68/NSURLErrorDomain/Code=-1005/api.apple-cloudkit.com 后，只读验证最多三次，间隔2/5秒。 | 影响所有 DSH/Insight 产品；不重签名、不重提交公证、不放宽最终验证。另有 notarize 维护升级见下节。 |

## 3 新增在官方目录内的集成文件

以下是新增的产品适配器，不是对已有 DSH 文件的修改，但会参与基线集成，因此也需要 review。业务实现以 `packages/insight` 为所有者，Electron 原生能力和编译接入留在 Desktop；本页不据此判断这些适配器必须长期维持当前位置。

### Desktop 产品和原生适配（14 个）

- [apps/desktop/src/client/insight-login.css](../../../../../apps/desktop/src/client/insight-login.css)
- [apps/desktop/src/client/insight-login.tsx](../../../../../apps/desktop/src/client/insight-login.tsx)
- [apps/desktop/src/client/insight-update.tsx](../../../../../apps/desktop/src/client/insight-update.tsx)
- [apps/desktop/src/client/raw-html.d.ts](../../../../../apps/desktop/src/client/raw-html.d.ts)
- [apps/desktop/src/insight-account-exit.ts](../../../../../apps/desktop/src/insight-account-exit.ts)
- [apps/desktop/src/insight-native-brand.ts](../../../../../apps/desktop/src/insight-native-brand.ts)
- [apps/desktop/src/insight-permissions.ts](../../../../../apps/desktop/src/insight-permissions.ts)
- [apps/desktop/src/insight-startup.ts](../../../../../apps/desktop/src/insight-startup.ts)
- [apps/desktop/src/insight-update-provider.ts](../../../../../apps/desktop/src/insight-update-provider.ts)
- [apps/desktop/src/insight-update-window.ts](../../../../../apps/desktop/src/insight-update-window.ts)
- [apps/desktop/src/insight-updates.ts](../../../../../apps/desktop/src/insight-updates.ts)
- [apps/desktop/src/preload-insight-login.ts](../../../../../apps/desktop/src/preload-insight-login.ts)
- [apps/desktop/src/preload-insight-update.ts](../../../../../apps/desktop/src/preload-insight-update.ts)
- [apps/desktop/src/product.ts](../../../../../apps/desktop/src/product.ts)

### Desktop 构建辅助（5 个）

- [apps/desktop/scripts/desktop-renderer-source-paths.d.mts](../../../../../apps/desktop/scripts/desktop-renderer-source-paths.d.mts)
- [apps/desktop/scripts/desktop-renderer-source-paths.mjs](../../../../../apps/desktop/scripts/desktop-renderer-source-paths.mjs)
- [apps/desktop/scripts/insight-development-data.ts](../../../../../apps/desktop/scripts/insight-development-data.ts)
- [apps/desktop/scripts/insight-packaging.d.mts](../../../../../apps/desktop/scripts/insight-packaging.d.mts)
- [apps/desktop/scripts/insight-packaging.mjs](../../../../../apps/desktop/scripts/insight-packaging.mjs)

### Desktop 登录/协议/更新 HTML 资源（4 个）

- [apps/desktop/renderer/insight-legal/PrivacyPolicy.html](../../../../../apps/desktop/renderer/insight-legal/PrivacyPolicy.html)
- [apps/desktop/renderer/insight-legal/ServiceAgreement.html](../../../../../apps/desktop/renderer/insight-legal/ServiceAgreement.html)
- [apps/desktop/renderer/insight-login.html](../../../../../apps/desktop/renderer/insight-login.html)
- [apps/desktop/renderer/insight-update.html](../../../../../apps/desktop/renderer/insight-update.html)

另新增共享输入 helper [packages/client/ui-conversation/src/client/input/selected-skills.ts](../../../../../packages/client/ui-conversation/src/client/input/selected-skills.ts)，其归属属于技能输入公共扩展。新的 `packages/insight/`、`scripts/insight-release/`、`scripts/dev-insight.ts`、`scripts/insight-package-policy.ts`、技能标签/源码回放工具、两条 Insight workflow 是产品新增内容，不能据此计为已修改的官方实现；它们对官方构建/发布入口的引用仍需随上游变化检查。

## 4 其他会影响 DSH 维护的改动

### 4.1 依赖、编译和打包配置

| 范围 | 理由与风险 |
| --- | --- |
| `apps/desktop/package.json`、根 `pnpm-lock.yaml` | `@electron/notarize` 从2.5.0升级3.1.2，使用上游对同一制品的 staple 重试，影响所有产品；是用户明确接受的共享默认变化，不应写成仅 Insight 开关 |
| Desktop/desktop-host/plugin-manager manifests、workspace 与根依赖 | 私有包必须进入产品运行时闭包；Canvas iframe 使用保留依赖；ali-oss 只用于发布工具。根锁文件的大量增量来自依赖闭包，不是独立业务改动 |
| `tsconfig.base/host/client.json`、Desktop 两编译面、`apps/web/tsconfig.json` | 私有包源码解析及 Host/Client 分面；Canvas 真实 Host 回放测试只归 Host 程序，避免双重编译 |
| `apps/desktop/tsdown.config.ts`、`electron-builder.config.d.mts` | 登录、更新 renderer/preload 独立构建，明确资源和产品字段；冷构建不依赖旧 lib 输出 |
| `.gitattributes`、`.gitignore`、根 `package.json` | 外部同步技能和 Canvas HTML 保留原字节；生成物不入库；提供 dev:insight、技能标签及固定快照回放入口 |

### 4.2 既有工具源码：12 个文件

工具改动作用于仓库检查和生成，不能按“官方客户端行为不变”略过。理由分别为私有包约束、共享 Host 依赖分类、公开 npm 基线排除、产品使用归属、JS Host 声明兼容、外部技能不被改写、既有 worker/技能脚本入口分类、内置加载 smoke 及目录生成。

| 文件 | 具体理由 |
| --- | --- |
| [scripts/check-workspace-constraints.ts](../../../../../scripts/check-workspace-constraints.ts) | 精确识别私有包名称、根版本和发布元数据，拒绝错误归属。 |
| [scripts/gen-cordis-catalog.ts](../../../../../scripts/gen-cordis-catalog.ts) | 让私有输入参与现有 API 目录生成，不维护另一份手写目录。 |
| [scripts/gen-doc-graphs.ts](../../../../../scripts/gen-doc-graphs.ts) | 生成参考时纳入 Insight 输入和显式源码位置。 |
| [scripts/npm-baseline-packages.ts](../../../../../scripts/npm-baseline-packages.ts) | 私有产品包不进入官方公开 npm 发布成员。 |
| [scripts/package-dependency-policy.ts](../../../../../scripts/package-dependency-policy.ts) | 逐个分类已审阅的 Host 值导出和必须共享的 peer，避免重复服务/错误类。 |
| [scripts/persistence-schema.ts](../../../../../scripts/persistence-schema.ts) | 引用项目保留声明根，避免把允许的 JS Host 输入误当 TypeScript 根文件。 |
| [scripts/product-package-policy.ts](../../../../../scripts/product-package-policy.ts) | 明确 Insight 包产品归属，不挂入官方默认 profile。 |
| [scripts/rescope-vendor.ts](../../../../../scripts/rescope-vendor.ts) | 保留外部同步 bundled-skills 字节，不将其混入本仓库改写。 |
| [scripts/run-gates.ts](../../../../../scripts/run-gates.ts) | 将 Integration 的真实 Loader 检查接入已有 built-smoke lane。 |
| [scripts/translation-pairing.ts](../../../../../scripts/translation-pairing.ts) | 外部同步根技能目录由来源仓库维护，不在本仓生成配对改写。 |
| [scripts/verify-application-entrypoints.ts](../../../../../scripts/verify-application-entrypoints.ts) | 登记保留的 Memory 数据同步 worker 和技能辅助脚本归属；不是独立 dsh CLI 产品支持。 |
| [scripts/verify-product-use.ts](../../../../../scripts/verify-product-use.ts) | 接入明确的私有产品包分类和可达性要求。 |

### 4.3 生成物、测试和文档

[packages/extensions/cordis-client-runner/src/client/slot-catalog.ts](../../../../../packages/extensions/cordis-client-runner/src/client/slot-catalog.ts)<br>[packages/extensions/tool-cordis/src/api-catalog.ts](../../../../../packages/extensions/tool-cordis/src/api-catalog.ts) 为从源码生成的共享 API/插槽目录，不是手写新行为；配置、事件、持久化参考及组合参考同理。Canvas 来源确认记录未修改已发布 Session 世代或写入版本。

官方测试的变化覆盖上述接入，以及新增输入 API 后的强类型 mock 消费者；不代表对应 UI 包的产品行为也被修改。`ui-sidebar-right`、`ui-sidebar-terminal` 等路径只有测试消费者变化；已撤回的 sidebar 位置调整没有残留生产改动。新增 Canvas 历史 recorded-session/Web fixture 属于回归证据，不是数据转换器。完整文件名见下节。

## 5 全量既有文件变更目录：143 个

本目录从固定比较自动提取，不遗漏文档/测试/配置。增删行只辅助定位规模；“最后修改提交”指功能审阅终点之前最后触及该文件的提交，不能单独替代完整 diff，也不是原始授权记录。

<details>
<summary>展开完整目录（文件、增删行、最后修改提交）</summary>

| 文件 | 新增/删除行 | 最后修改提交 |
| --- | --- | --- |
| [.gitattributes](../../../../../.gitattributes) | +5 / -0 | `413ce141be` |
| [.gitignore](../../../../../.gitignore) | +6 / -0 | `ff40a73591` |
| [apps/desktop-host/package.json](../../../../../apps/desktop-host/package.json) | +5 / -1 | `ef5b752aca` |
| [apps/desktop/README.i18n.yaml](../../../../../apps/desktop/README.i18n.yaml) | +8 / -8 | `675192ea4b` |
| [apps/desktop/README.md](../../../../../apps/desktop/README.md) | +10 / -2 | `675192ea4b` |
| [apps/desktop/README.zh.md](../../../../../apps/desktop/README.zh.md) | +10 / -2 | `675192ea4b` |
| [apps/desktop/electron-builder.config.d.mts](../../../../../apps/desktop/electron-builder.config.d.mts) | +12 / -3 | `6e10e22ce8` |
| [apps/desktop/installer/extract-report.h](../../../../../apps/desktop/installer/extract-report.h) | +5 / -1 | `a0fc21925f` |
| [apps/desktop/installer/path.nsh](../../../../../apps/desktop/installer/path.nsh) | +11 / -2 | `95c1477d08` |
| [apps/desktop/package.json](../../../../../apps/desktop/package.json) | +4 / -2 | `c07f6ce838` |
| [apps/desktop/packaging/README.md](../../../../../apps/desktop/packaging/README.md) | +2 / -2 | `ca5283f045` |
| [apps/desktop/packaging/README.zh.md](../../../../../apps/desktop/packaging/README.zh.md) | +2 / -2 | `ca5283f045` |
| [apps/desktop/scripts/desktop-package-environment.mjs](../../../../../apps/desktop/scripts/desktop-package-environment.mjs) | +14 / -7 | `ca5283f045` |
| [apps/desktop/scripts/dev.ts](../../../../../apps/desktop/scripts/dev.ts) | +17 / -2 | `675192ea4b` |
| [apps/desktop/scripts/development-app.ts](../../../../../apps/desktop/scripts/development-app.ts) | +21 / -6 | `ef5b752aca` |
| [apps/desktop/scripts/electron-builder-config.mjs](../../../../../apps/desktop/scripts/electron-builder-config.mjs) | +55 / -19 | `6e10e22ce8` |
| [apps/desktop/scripts/installer.nsh](../../../../../apps/desktop/scripts/installer.nsh) | +23 / -2 | `95c1477d08` |
| [apps/desktop/scripts/package-macos.ts](../../../../../apps/desktop/scripts/package-macos.ts) | +11 / -3 | `44e877f7b5` |
| [apps/desktop/scripts/package-target.ts](../../../../../apps/desktop/scripts/package-target.ts) | +51 / -12 | `44e877f7b5` |
| [apps/desktop/scripts/prepare-windows-installer.ps1](../../../../../apps/desktop/scripts/prepare-windows-installer.ps1) | +19 / -8 | `a0fc21925f` |
| [apps/desktop/scripts/smoke-packaged-runtime.ts](../../../../../apps/desktop/scripts/smoke-packaged-runtime.ts) | +43 / -13 | `6e10e22ce8` |
| [apps/desktop/scripts/verify-macos-signature.mjs](../../../../../apps/desktop/scripts/verify-macos-signature.mjs) | +39 / -2 | `a0fc21925f` |
| [apps/desktop/src/fatal-recovery.ts](../../../../../apps/desktop/src/fatal-recovery.ts) | +18 / -6 | `ef5b752aca` |
| [apps/desktop/src/host-process.ts](../../../../../apps/desktop/src/host-process.ts) | +101 / -0 | `ef5b752aca` |
| [apps/desktop/src/main.ts](../../../../../apps/desktop/src/main.ts) | +224 / -79 | `44e877f7b5` |
| [apps/desktop/src/preload-app.ts](../../../../../apps/desktop/src/preload-app.ts) | +26 / -0 | `ef5b752aca` |
| [apps/desktop/src/project-manager.ts](../../../../../apps/desktop/src/project-manager.ts) | +36 / -6 | `ef5b752aca` |
| [apps/desktop/src/update-coordinator.ts](../../../../../apps/desktop/src/update-coordinator.ts) | +115 / -15 | `44e877f7b5` |
| [apps/desktop/tests/desktop-package-environment.spec.ts](../../../../../apps/desktop/tests/desktop-package-environment.spec.ts) | +23 / -0 | `44e877f7b5` |
| [apps/desktop/tests/development-app.spec.ts](../../../../../apps/desktop/tests/development-app.spec.ts) | +16 / -0 | `ef5b752aca` |
| [apps/desktop/tests/fatal-recovery.spec.ts](../../../../../apps/desktop/tests/fatal-recovery.spec.ts) | +58 / -0 | `ef5b752aca` |
| [apps/desktop/tests/host-process.spec.ts](../../../../../apps/desktop/tests/host-process.spec.ts) | +109 / -0 | `ef5b752aca` |
| [apps/desktop/tests/installer-packaging.spec.ts](../../../../../apps/desktop/tests/installer-packaging.spec.ts) | +43 / -1 | `a0fc21925f` |
| [apps/desktop/tests/macos-disk-image-signature.spec.ts](../../../../../apps/desktop/tests/macos-disk-image-signature.spec.ts) | +119 / -2 | `a0fc21925f` |
| [apps/desktop/tests/main-startup.spec.ts](../../../../../apps/desktop/tests/main-startup.spec.ts) | +421 / -14 | `44e877f7b5` |
| [apps/desktop/tests/package-macos.spec.ts](../../../../../apps/desktop/tests/package-macos.spec.ts) | +22 / -5 | `44e877f7b5` |
| [apps/desktop/tests/package-target-stages.spec.ts](../../../../../apps/desktop/tests/package-target-stages.spec.ts) | +36 / -0 | `44e877f7b5` |
| [apps/desktop/tests/package-target.spec.ts](../../../../../apps/desktop/tests/package-target.spec.ts) | +9 / -0 | `ef5b752aca` |
| [apps/desktop/tests/preload-app.spec.ts](../../../../../apps/desktop/tests/preload-app.spec.ts) | +38 / -0 | `ef5b752aca` |
| [apps/desktop/tests/prepare-package-set.spec.ts](../../../../../apps/desktop/tests/prepare-package-set.spec.ts) | +20 / -0 | `413ce141be` |
| [apps/desktop/tests/project-manager.spec.ts](../../../../../apps/desktop/tests/project-manager.spec.ts) | +27 / -0 | `ef5b752aca` |
| [apps/desktop/tests/update-coordinator.spec.ts](../../../../../apps/desktop/tests/update-coordinator.spec.ts) | +165 / -6 | `44e877f7b5` |
| [apps/desktop/tests/windows-installer-extract-report.cpp](../../../../../apps/desktop/tests/windows-installer-extract-report.cpp) | +1 / -0 | `a0fc21925f` |
| [apps/desktop/tests/windows-package-preset.spec.ts](../../../../../apps/desktop/tests/windows-package-preset.spec.ts) | +23 / -0 | `ca5283f045` |
| [apps/desktop/tsconfig.client.json](../../../../../apps/desktop/tsconfig.client.json) | +3 / -0 | `ef5b752aca` |
| [apps/desktop/tsconfig.host.json](../../../../../apps/desktop/tsconfig.host.json) | +3 / -0 | `ef5b752aca` |
| [apps/desktop/tsdown.config.ts](../../../../../apps/desktop/tsdown.config.ts) | +56 / -1 | `ca5283f045` |
| [apps/web/tsconfig.json](../../../../../apps/web/tsconfig.json) | +1 / -0 | `b6e023585a` |
| [docs/capability-seams.i18n.yaml](../../../../capability-seams.i18n.yaml) | +2 / -2 | `ef5b752aca` |
| [docs/capability-seams.md](../../../../capability-seams.md) | +4 / -0 | `ef5b752aca` |
| [docs/capability-seams.zh.md](../../../../capability-seams.zh.md) | +4 / -0 | `ef5b752aca` |
| [docs/config-catalog.md](../../../../config-catalog.md) | +85 / -1 | `ff40a73591` |
| [docs/config-catalog.zh.md](../../../../config-catalog.zh.md) | +85 / -1 | `ff40a73591` |
| [docs/event-producer-consumer.md](../../../../event-producer-consumer.md) | +2 / -2 | `413ce141be` |
| [docs/event-producer-consumer.zh.md](../../../../event-producer-consumer.zh.md) | +2 / -2 | `413ce141be` |
| [docs/i18n/README.i18n.yaml](../../../../i18n/README.i18n.yaml) | +2 / -2 | `413ce141be` |
| [docs/i18n/README.md](../../../../i18n/README.md) | +2 / -0 | `413ce141be` |
| [docs/i18n/README.zh.md](../../../../i18n/README.zh.md) | +2 / -0 | `413ce141be` |
| [docs/persistence-catalog.i18n.yaml](../../../../persistence-catalog.i18n.yaml) | +66 / -54 | `ff40a73591` |
| [docs/persistence-catalog.md](../../../../persistence-catalog.md) | +87 / -45 | `ff40a73591` |
| [docs/persistence-catalog.zh.md](../../../../persistence-catalog.zh.md) | +87 / -45 | `ff40a73591` |
| [docs/persistence-changes/historical-formats/README.i18n.yaml](../../../../persistence-changes/historical-formats/README.i18n.yaml) | +2 / -2 | `413ce141be` |
| [docs/persistence-changes/historical-formats/README.md](../../../../persistence-changes/historical-formats/README.md) | +1 / -1 | `413ce141be` |
| [docs/persistence-changes/historical-formats/README.zh.md](../../../../persistence-changes/historical-formats/README.zh.md) | +1 / -1 | `413ce141be` |
| [docs/persistence-schema.json](../../../../persistence-schema.json) | +40 / -32 | `ff40a73591` |
| [docs/subsystems/README.i18n.yaml](../../../../subsystems/README.i18n.yaml) | +2 / -2 | `413ce141be` |
| [docs/subsystems/README.md](../../../../subsystems/README.md) | +2 / -0 | `413ce141be` |
| [docs/subsystems/README.zh.md](../../../../subsystems/README.zh.md) | +2 / -0 | `413ce141be` |
| [docs/subsystems/slots.md](../../../../subsystems/slots.md) | +8 / -5 | `6e10e22ce8` |
| [docs/subsystems/slots.zh.md](../../../../subsystems/slots.zh.md) | +8 / -5 | `6e10e22ce8` |
| [package.json](../../../../../package.json) | +7 / -2 | `6e10e22ce8` |
| [packages/README.i18n.yaml](../../../../../packages/README.i18n.yaml) | +4 / -4 | `413ce141be` |
| [packages/README.md](../../../../../packages/README.md) | +2 / -1 | `413ce141be` |
| [packages/README.zh.md](../../../../../packages/README.zh.md) | +2 / -1 | `413ce141be` |
| [packages/boot/plugin-manager/README.i18n.yaml](../../../../../packages/boot/plugin-manager/README.i18n.yaml) | +4 / -4 | `ff40a73591` |
| [packages/boot/plugin-manager/README.md](../../../../../packages/boot/plugin-manager/README.md) | +4 / -1 | `ff40a73591` |
| [packages/boot/plugin-manager/README.zh.md](../../../../../packages/boot/plugin-manager/README.zh.md) | +4 / -1 | `ff40a73591` |
| [packages/boot/plugin-manager/package.json](../../../../../packages/boot/plugin-manager/package.json) | +2 / -1 | `ff40a73591` |
| [packages/boot/plugin-manager/src/diagnostic.ts](../../../../../packages/boot/plugin-manager/src/diagnostic.ts) | +1 / -0 | `ff40a73591` |
| [packages/boot/plugin-manager/src/index.ts](../../../../../packages/boot/plugin-manager/src/index.ts) | +198 / -4 | `ff40a73591` |
| [packages/boot/plugin-manager/src/tools.ts](../../../../../packages/boot/plugin-manager/src/tools.ts) | +1 / -0 | `ff40a73591` |
| [packages/boot/plugin-manager/src/types.ts](../../../../../packages/boot/plugin-manager/src/types.ts) | +1 / -1 | `ff40a73591` |
| [packages/boot/plugin-manager/tests/manager.spec.ts](../../../../../packages/boot/plugin-manager/tests/manager.spec.ts) | +177 / -1 | `ff40a73591` |
| [packages/client/ui-chat/README.i18n.yaml](../../../../../packages/client/ui-chat/README.i18n.yaml) | +2 / -2 | `6e10e22ce8` |
| [packages/client/ui-chat/README.md](../../../../../packages/client/ui-chat/README.md) | +1 / -1 | `6e10e22ce8` |
| [packages/client/ui-chat/README.zh.md](../../../../../packages/client/ui-chat/README.zh.md) | +1 / -1 | `6e10e22ce8` |
| [packages/client/ui-chat/src/client/chat/MessageItem.tsx](../../../../../packages/client/ui-chat/src/client/chat/MessageItem.tsx) | +10 / -13 | `6e10e22ce8` |
| [packages/client/ui-chat/src/client/chat/register-node-renderers.ts](../../../../../packages/client/ui-chat/src/client/chat/register-node-renderers.ts) | +10 / -6 | `6e10e22ce8` |
| [packages/client/ui-chat/src/client/contract/slots.ts](../../../../../packages/client/ui-chat/src/client/contract/slots.ts) | +13 / -1 | `6e10e22ce8` |
| [packages/client/ui-chat/src/client/index.ts](../../../../../packages/client/ui-chat/src/client/index.ts) | +1 / -1 | `6e10e22ce8` |
| [packages/client/ui-chat/tests/chat-apply.client.spec.tsx](../../../../../packages/client/ui-chat/tests/chat-apply.client.spec.tsx) | +6 / -1 | `6e10e22ce8` |
| [packages/client/ui-chat/tests/chat-view.client.spec.tsx](../../../../../packages/client/ui-chat/tests/chat-view.client.spec.tsx) | +1 / -0 | `ff40a73591` |
| [packages/client/ui-conversation/README.i18n.yaml](../../../../../packages/client/ui-conversation/README.i18n.yaml) | +2 / -2 | `ff40a73591` |
| [packages/client/ui-conversation/README.md](../../../../../packages/client/ui-conversation/README.md) | +1 / -1 | `ff40a73591` |
| [packages/client/ui-conversation/README.zh.md](../../../../../packages/client/ui-conversation/README.zh.md) | +1 / -1 | `ff40a73591` |
| [packages/client/ui-conversation/src/client/contract/input.ts](../../../../../packages/client/ui-conversation/src/client/contract/input.ts) | +4 / -0 | `ff40a73591` |
| [packages/client/ui-conversation/src/client/input/facade.ts](../../../../../packages/client/ui-conversation/src/client/input/facade.ts) | +21 / -0 | `ff40a73591` |
| [packages/client/ui-conversation/tests/queue-dock.client.spec.tsx](../../../../../packages/client/ui-conversation/tests/queue-dock.client.spec.tsx) | +1 / -1 | `ff40a73591` |
| [packages/client/ui-plugin-manager/src/client/locales.ts](../../../../../packages/client/ui-plugin-manager/src/client/locales.ts) | +8 / -0 | `ff40a73591` |
| [packages/client/ui-plugin-manager/src/client/presentation.ts](../../../../../packages/client/ui-plugin-manager/src/client/presentation.ts) | +1 / -0 | `ff40a73591` |
| [packages/client/ui-plugin-manager/tests/components.client.spec.tsx](../../../../../packages/client/ui-plugin-manager/tests/components.client.spec.tsx) | +6 / -2 | `ff40a73591` |
| [packages/client/ui-sidebar-right/tests/expand-button.client.spec.tsx](../../../../../packages/client/ui-sidebar-right/tests/expand-button.client.spec.tsx) | +2 / -1 | `ff40a73591` |
| [packages/client/ui-sidebar-right/tests/guide-body.client.spec.tsx](../../../../../packages/client/ui-sidebar-right/tests/guide-body.client.spec.tsx) | +2 / -1 | `ff40a73591` |
| [packages/client/ui-sidebar-terminal/tests/terminal-guide.client.spec.tsx](../../../../../packages/client/ui-sidebar-terminal/tests/terminal-guide.client.spec.tsx) | +2 / -1 | `ff40a73591` |
| [packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx](../../../../../packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx) | +1 / -0 | `ff40a73591` |
| [packages/client/ui-trajectory/tests/views.client.spec.tsx](../../../../../packages/client/ui-trajectory/tests/views.client.spec.tsx) | +4 / -2 | `ff40a73591` |
| [packages/client/ui-user-questions/tests/plan-review-panel.client.spec.tsx](../../../../../packages/client/ui-user-questions/tests/plan-review-panel.client.spec.tsx) | +2 / -0 | `ff40a73591` |
| [packages/client/ui-user-questions/tests/user-questions-composer.client.spec.tsx](../../../../../packages/client/ui-user-questions/tests/user-questions-composer.client.spec.tsx) | +2 / -0 | `ff40a73591` |
| [packages/client/ui-workflow-run/tests/workflow-run.client.spec.tsx](../../../../../packages/client/ui-workflow-run/tests/workflow-run.client.spec.tsx) | +1 / -0 | `ff40a73591` |
| [packages/experimental/client-ui-voice-input/tests/voice-input.client.spec.tsx](../../../../../packages/experimental/client-ui-voice-input/tests/voice-input.client.spec.tsx) | +1 / -1 | `ff40a73591` |
| [packages/extensions/cordis-client-runner/src/client/slot-catalog.ts](../../../../../packages/extensions/cordis-client-runner/src/client/slot-catalog.ts) | +92 / -20 | `6e10e22ce8` |
| [packages/extensions/tool-cordis/src/api-catalog.ts](../../../../../packages/extensions/tool-cordis/src/api-catalog.ts) | +14 / -1 | `ff40a73591` |
| [packages/llm/llm-pi-ai/README.i18n.yaml](../../../../../packages/llm/llm-pi-ai/README.i18n.yaml) | +2 / -2 | `ef5b752aca` |
| [packages/llm/llm-pi-ai/README.md](../../../../../packages/llm/llm-pi-ai/README.md) | +2 / -0 | `ef5b752aca` |
| [packages/llm/llm-pi-ai/README.zh.md](../../../../../packages/llm/llm-pi-ai/README.zh.md) | +2 / -0 | `ef5b752aca` |
| [packages/llm/llm-pi-ai/src/index.ts](../../../../../packages/llm/llm-pi-ai/src/index.ts) | +2 / -2 | `ef5b752aca` |
| [packages/llm/llm-pi-ai/tests/adapter.spec.ts](../../../../../packages/llm/llm-pi-ai/tests/adapter.spec.ts) | +5 / -2 | `ef5b752aca` |
| [packages/preset/agent-preset/skills/cordis-composition-reference/references/packages.md](../../../../../packages/preset/agent-preset/skills/cordis-composition-reference/references/packages.md) | +7 / -0 | `413ce141be` |
| [packages/session-query/session-log-export/tests/header-action.client.spec.tsx](../../../../../packages/session-query/session-log-export/tests/header-action.client.spec.tsx) | +2 / -1 | `ff40a73591` |
| [pnpm-lock.yaml](../../../../../pnpm-lock.yaml) | +5391 / -60 | `c07f6ce838` |
| [pnpm-workspace.yaml](../../../../../pnpm-workspace.yaml) | +10 / -0 | `413ce141be` |
| [scripts/check-workspace-constraints.spec.ts](../../../../../scripts/check-workspace-constraints.spec.ts) | +41 / -0 | `413ce141be` |
| [scripts/check-workspace-constraints.ts](../../../../../scripts/check-workspace-constraints.ts) | +24 / -1 | `413ce141be` |
| [scripts/gen-cordis-catalog.ts](../../../../../scripts/gen-cordis-catalog.ts) | +1 / -0 | `ef5b752aca` |
| [scripts/gen-doc-graphs.ts](../../../../../scripts/gen-doc-graphs.ts) | +7 / -0 | `ef5b752aca` |
| [scripts/npm-baseline-packages.spec.ts](../../../../../scripts/npm-baseline-packages.spec.ts) | +6 / -0 | `413ce141be` |
| [scripts/npm-baseline-packages.ts](../../../../../scripts/npm-baseline-packages.ts) | +3 / -2 | `413ce141be` |
| [scripts/package-dependency-policy.ts](../../../../../scripts/package-dependency-policy.ts) | +8 / -2 | `ef5b752aca` |
| [scripts/persistence-schema.spec.ts](../../../../../scripts/persistence-schema.spec.ts) | +25 / -0 | `413ce141be` |
| [scripts/persistence-schema.ts](../../../../../scripts/persistence-schema.ts) | +6 / -1 | `413ce141be` |
| [scripts/product-package-policy.ts](../../../../../scripts/product-package-policy.ts) | +4 / -1 | `413ce141be` |
| [scripts/rescope-vendor.spec.ts](../../../../../scripts/rescope-vendor.spec.ts) | +5 / -0 | `413ce141be` |
| [scripts/rescope-vendor.ts](../../../../../scripts/rescope-vendor.ts) | +2 / -1 | `413ce141be` |
| [scripts/run-gates.ts](../../../../../scripts/run-gates.ts) | +2 / -0 | `ef5b752aca` |
| [scripts/translation-pairing.spec.ts](../../../../../scripts/translation-pairing.spec.ts) | +3 / -0 | `413ce141be` |
| [scripts/translation-pairing.ts](../../../../../scripts/translation-pairing.ts) | +2 / -0 | `413ce141be` |
| [scripts/verify-application-entrypoints.ts](../../../../../scripts/verify-application-entrypoints.ts) | +2 / -0 | `413ce141be` |
| [scripts/verify-package-dependencies.spec.ts](../../../../../scripts/verify-package-dependencies.spec.ts) | +56 / -0 | `413ce141be` |
| [scripts/verify-product-use.spec.ts](../../../../../scripts/verify-product-use.spec.ts) | +9 / -0 | `413ce141be` |
| [scripts/verify-product-use.ts](../../../../../scripts/verify-product-use.ts) | +2 / -0 | `413ce141be` |
| [tsconfig.base.json](../../../../../tsconfig.base.json) | +13 / -0 | `44e877f7b5` |
| [tsconfig.client.json](../../../../../tsconfig.client.json) | +4 / -0 | `ef5b752aca` |
| [tsconfig.host.json](../../../../../tsconfig.host.json) | +5 / -0 | `b6e023585a` |

</details>

## 6 当前交付和等待确认

本次没有新增官方功能修改，也未删除代码、迁移报告、构建或发布。功能变更已在已有阶段提交中；当前收口文档和本清单作为新的本地提交保存，提交号以本次交付回复及 Git 日志为准。

用户新增的追溯理由、构建/发布成功经验、Shell 报告搬入当前仓库、未完成目标上下文、Insight 独立文档区及按问题查阅方式，已纳入 P6 计划。确认后先盘点和提出具体目录/删除清单，再执行；新增官方范围仍需单独授权。

P5 其余平台、数据和恢复验证后续反馈为 bug，不作为本次入口阻断；未验证不等于通过。下次客户端需交付双协议 Candidate reader，Stable 发布仍未授权。
