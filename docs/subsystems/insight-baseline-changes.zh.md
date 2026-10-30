# Insight 基线集成记录

[English](insight-baseline-changes.md) | 中文

## 范围

本记录标明私有 Insight 源码接入与 Desktop 集成修改的既有 DSH 文件，不重复列出未变更上游源码或新增私有包内部实现。官方 Desktop 保持为默认产品，并保留既有启动、profile、账号、窗口和更新行为；Insight 路径在 Electron 读取产品状态前通过显式选择启用。

## 既有文件变化

| 文件 | 目的 | 保留条件 |
| --- | --- | --- |
| `apps/desktop-host/package.json`、`apps/desktop/package.json` | 让四个私有 Insight 包进入既有递归运行时与 Main 进程依赖闭包 | Insight 组件随桌面运行时交付期间保留 |
| `apps/desktop/src/main.ts` 及其测试 | 在 `userData` 前选择产品，要求 Insight 登录先于 Host 启动，把一个账号 Home 与凭据回调绑定到 Host，暴露渲染器安全账号操作，应用品牌，并且只在账号关停后重启 | 保持 Insight 生命周期分支显式，同时让官方路径不变 |
| `apps/desktop/src/product.ts`、`insight-startup.ts`、`insight-account-exit.ts`、`insight-native-brand.ts` 及其测试 | 在上游 Main 流程外负责经校验的产品/运行时标识、隔离认证、native Home 准入、有序账号拆除与产品原生标签 | 保持为产品模块，避免把 Insight 状态分散到通用 Desktop 服务中 |
| `apps/desktop/src/host-process.ts` 及其测试 | 只在当前 Host 子进程与 Desktop Main 之间承载有界、经校验且可取消的账号令牌请求 | 为每个 Host 消费方保留令牌隔离、当前子进程校验与拆除取消 |
| `apps/desktop/src/preload-app.ts`、`preload-insight-login.ts`、`client/insight-login.tsx`、其测试与 `tsdown.config.ts` | 构建登录渲染器桥接，并且只向已认证顶层 Insight 工作区暴露账号摘要与退出 | 让两个渲染器上下文都无法获得令牌或不受限 Main IPC |
| `apps/desktop/src/project-manager.ts`、`fatal-recovery.ts` 及其测试 | 在 profile 创建、已有 profile 准备和插件恢复时保留产品必需的四个 bundle；只在登录后安装账号范围恢复 | 绝不让认证前恢复打开官方 Home 或其他账号 Home |
| `apps/desktop/scripts/dev.ts`、`development-app.ts`、`electron-builder-config.mjs`、其声明及测试 | 应用 Insight 应用 id、名称、图标、隔离开发数据、包元数据和产品/运行时版本拆分；将根内置技能目录复制为 Insight 专属资源 | 保持构建标识和资源复制为条件行为，让官方制品和签名输入不变 |
| `apps/desktop/scripts/package-target.ts` 及其测试 | 在桌面闭包选择前打入精确私有组件，并把 Insight 产品版本与 DSH 运行时版本分别记录 | 保持私有桌面打包和发布标识与公开发布成员独立 |
| `apps/desktop/electron-builder.config.d.mts`、`apps/desktop/scripts/smoke-packaged-runtime.ts`、其测试与 `scripts/run-gates.ts` | 校验产品专属打包元数据，并在 built-smoke 清单中运行 Integration 真实 Loader 测试 | 保持打包检查与 Insight 产品制品及私有 bundle 运行时入口一致 |
| `apps/desktop/tsconfig.host.json`、`tsconfig.client.json` | 从 Desktop 构建引用可移植 Integration Host 与 Client 编译面 | 保持 Electron 导入属于 Desktop 适配层，并显式区分可移植包编译面 |
| `apps/desktop/src/insight-permissions.ts`、`main.ts`、`product.ts` 及其测试 | 执行已批准的 Insight 专属剪贴板、全屏及主 frame 音频权限矩阵；接入原生重启、日志、缩放和全屏菜单；在登录 shell 解析后传入固定必需 bundle 策略、随包 Node 路径及存在的内置技能目录 | 保留官方产品路径；每次同步基线复核两类权限回调、原生 frame 所有权、OS 音频授权、primary-runtime 布局和产品资源路径 |
| `packages/boot/plugin-manager/src/{index,types,tools,diagnostic,product-policy}.ts`、测试及包元数据 | 将默认空的必需 bundle 配置与可信产品策略合并，在执行端拒绝停用、移除、更新和替换，并检查安装别名与归档 | 保留执行端校验、manifest 事务恢复、有界归档解析及用户 registry；基线提供等价保护后才移除本地策略 |
| `packages/client/ui-plugin-manager/src/client/{presentation,locales}.ts` 及组件测试 | 为产品必需组件解释已有只读状态 | 展示状态从 Host 策略派生，保留组件内部功能开关 |
| `packages/client/ui-conversation/src/client/contract/input.ts`、`input/facade.ts`、`input/selected-skills.ts`、README 及强类型 Client 测试消费者 | 在实时编辑器文本上恢复已批准的 `toggleSkill`，派生 `selectedSkills`，不扫描引用、Quote 或命令内容 | 保留可见草稿语义、Session 所有权、忙碌/释放保护与局部编辑回归；同步基线后复核编辑器投影与动作签名 |
| `packages/llm/llm-pi-ai/src/index.ts` 与 `tests/adapter.spec.ts` | 公开托管网关构建所需的既有 `resolveProfiles`、`credentialStoreFrom` 与 `authContextFrom` helper | 用户明确授权的增量导出；保留上游实现，基线提供这些导出后移除本地差异 |
| `pnpm-workspace.yaml`、`pnpm-lock.yaml` | 在根依赖锁和构建策略下解析 iframe 及其保留的 Motion 依赖边 | iframe 有其他明确受支持的构建拥有者后再调整 |
| `tsconfig.base.json`、`tsconfig.host.json`、`tsconfig.client.json` | 将保留的外部插件名（包括 Integration 入口）解析到源码，并显式编译各面 | 这些标识仍不属于生成的 DSH alias 时保留 |
| `scripts/check-workspace-constraints.ts` 及测试 | 强制精确私有标识、根版本、发布元数据和唯一拥有者 | 仅在上游提供同等严格产品输入规则后替换 |
| `scripts/package-dependency-policy.ts` 及其测试 | 精确分类 Host 值导出、保留工具共享 peer，并拒绝未审查的导出 | 保留共享服务 peer，不扩大为整包安全声明 |
| `scripts/npm-baseline-packages.ts` 及测试 | 从公开 npm 基线精确排除私有输入 | 发现方式变化时仍需保留发布拒绝 |
| `scripts/product-package-policy.ts`、`scripts/verify-product-use.ts` 及测试 | 标明 Insight 必需组件，不挂载到官方默认 profile | 实际产品可达性覆盖该声明后才能移除 |
| `.gitattributes` | 在 Git 暂存与检出时保留同步技能和两份上游 Canvas HTML 的原始字节 | 防止换行转换破坏源码回放 |
| `package.json`、`.gitignore` | 提供技能标签生成和源码回放，保留公开画布路由配置并忽略生成物 | 客户端仍读取根同步目录标签时保留 |
| `scripts/translation-pairing.ts` 及其测试、`docs/i18n/README.md` 及其配对 | 将外部同步的根技能目录排除于本地文档改写之外 | 该目录由来源仓库维护时保留 |
| `scripts/rescope-vendor.ts` 及其测试 | 保留同步的根技能资产，并容纳增加后的文件清单 | 外部技能资产持续排除于本仓库改写之外 |
| `scripts/verify-application-entrypoints.ts` | 按原有归属分类保留的 Memory 数据同步 worker 与技能辅助脚本 | 对应脚本退役时再移除分类 |
| `scripts/persistence-schema.ts` 及其测试 | 保留引用 Host 项目的 TypeScript 声明根，不把允许引入的 JS 当成 TypeScript 根文件 | 引用包可能包含 JS Host 输入时保留 |
| `docs/config-catalog*`、`docs/event-producer-consumer*`、Client 插槽目录及组合参考包清单 | 为私有输入重新生成声明和参考 | 从源码生成，不手改生成内容 |
| `docs/persistence-catalog*`、`docs/persistence-schema.json` | 描述两个仅含信息的画布消息来源新增 | 保留新增确认记录，不改接受的历史记录与写入版本 |
| `packages/README.md` 及配对文档、`docs/subsystems/README.md` 及配对文档 | 链接新组并说明私有产品归属 | 随包组一起维护 |

## 新增集成的拥有者

精确私有包清单位于 [insight-package-policy.ts](../../scripts/insight-package-policy.ts)。[Insight 产品集成](insight.zh.md) 说明运行时归属、源码快照与同步技能。[Desktop Integration 包](../../packages/insight/desktop-integration/README.zh.md) 负责认证与账号进程行为。每个固定业务包的 `upstream.json` 和 `patches/insight` 下可回放差异记录引入源码及本地适配。

`bundled-skills` 保持来源仓库的内部结构。引入的标签生成器保留原有目录到客户端元数据流程；测试使用合成文件，不评价内置技能内容或业务结果。

[画布来源确认记录](../persistence-changes/2026-10-28-insight-canvas-attribution.zh.md) 记录读者兼容性，不改变 Session 写入版本，也不迁移用户数据。

## 基线同步

逐项对照引入的基线，只有替代实现保留表中的产品选择、登录顺序、账号隔离、凭据限制、发布标识与发布保证后才删除本地改动。既有官方文件变化时更新本记录，私有包内部改动由包文档、来源记录和 Git 历史追踪。

## Host 值依赖分类

`createUserMessage`、`BlockAssembler` 和 `domainTable` 是精确的安全 Host 导出，返回结构值或持有调用方局部状态，不要求消费者共享服务构造器或模块状态。Canvas 与 Prompt 声明对应的运行时依赖边，`defineTool` 保持共享 peer，因为它的参数失败必须保留 Host pipeline 识别的错误类身份；这些 provider 的其他导出保留现有分类。包含这些新增项的 PR 必须按 `scripts/package-dependency-policy.ts` 要求，在醒目的 Host 依赖分类专节披露。

托管网关从 `dsh-llm` 导入 `LlmAdapter`、`LlmError` 与 `resolveImageAttachmentAccess`，从 `dsh-llm-deepseek` 导入 `resolveAdapterOptions`，从 `dsh-llm-pi-ai` 导入 `PiAiAdapter`、`resolveProfiles`、`credentialStoreFrom` 与 `authContextFrom`。这八个精确导出均要求共享 peer：私有 bundle 使用 Host 的适配器、错误、profile 和认证实现，避免再安装一份提供方。没有增加允许重复安装的安全例外。

## 开发备注

无。
