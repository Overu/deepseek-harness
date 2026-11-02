> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# Core 0.2.1-alpha.1 本地合并与桌面集成结果

日期：2026-10-08。官方 `dsh-v0.2.1-alpha.1` 已合入因赛 Core，Shell 已完成兼容适配和 macOS arm64 隔离桌面验收。版本仍属于预发行；当前结果是本地候选，三平台发布资产和正式 Runtime lock 更新尚未完成。

## 提交与运行基线

| 项目 | 确定值 |
| --- | --- |
| 官方目标 | `dsh-v0.2.1-alpha.1`，提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc` |
| 因赛原基线 | `insight-runtime-v0.1.6-alpha.2-insight.4`，提交 `5f668026071a5c2f2a0796aff1900be62b0aebe4` |
| Core 合并提交 | `dbe72fa8491e3b491ffb68a38915a2193156fdc4`，两个父提交分别为上述因赛基线和官方目标 |
| Core 最终提交 | `25a49c53c4e0c003a8469ee243aa5d1365df80cd`，补充官方 PiAiAdapter 的公开构造接口 |
| Core 分支 | `codex/core-0.2.1-alpha.1-20261008` |
| Shell 分支 | `codex/core-0.2.1-alpha.1-integration-20261008` |
| 本地 Runtime | `/Users/boxser.shi/Documents/harness/insight-harness-core/dist/runtime-0.2.1-alpha.1` |
| 构建与 Runtime 工具链 | 构建 Node 24.21.0 / pnpm 11.7.0；Runtime 独立 Node 24.9.0；真实 Electron utilityProcess 使用 Electron 自带 Node 24.18.1 |

沿用 Shell + Core + Plugin 架构。9 月 30 日的[桌面平台调研](2026-09-30-official-desktop-platform-assessment.md)原文保持不变，SHA-256 为 `07655228f50bf2894f093a9178d0bed89c2ca6061cec2b6245d05190999de44d`。[升级预检](2026-10-08-core-upgrade-preflight.md)保留分支清理记录和当时的冲突清单。

## 合并和兼容处理

28 个冲突路径全部解决。主要涉及设置页及其共享状态、输入区技能扩展、极简预设迁移、品牌侧边栏、Remote 事件和文档配对记录。多处测试同时提供输入区或设置接口的模拟对象，因此一个接口变化会扩散到多个测试文件；冲突路径数不能当作独立定制功能数。

| 位置 | 升级后的行为 |
| --- | --- |
| Core 设置页 | 采用官方新版共享设置状态，保留因赛 `settingsDialog.open(section?)`；Shell 改用完整 `settings.launcher` 插槽隐藏官方启动按钮 |
| Core 输入区与技能 | 保留 `toggleSkill` 和共享技能目录；极简预设迁入新版 web-app 预设，桌面技能读取仅在桌面环境与技能目录均存在时启用 |
| Core 侧边栏与进程 | 保留因赛品牌插槽、macOS 拖动区域、Windows 进程补丁和 Remote 技能更新事件 |
| Runtime | 移除上游已删除的 invariant 依赖，补齐新必需 peers；修复 pnpm deploy 预建空目录造成的 workspace 包漏装，实际依赖闭包与布局检查通过 |
| Shell 模型 Gateway | 官方直连 DeepSeekAdapter 已仅支持 Messages；企业 Gateway 改用官方 PiAiAdapter 的 `openai-completions`，保持 `/v1/chat/completions`、按请求获取用户中心 token、历史模型 ID 和推理档位 |
| Shell 图片 | 使用 Chat Completions inline 图片传输，不请求 Messages Files API；沿用官方模型容量、请求图片字节上限与重试策略。PiAiAdapter 不提供直连适配器的精确 `imageRequestPricing`，按其标准图片处理与压缩机制运行 |
| Shell 技能展示 | 新版 workspace `readBytes` 使用 `range` 参数和原始 Uint8Array；保留 8 KiB 限制、完整窗口检查、UTF-8 严格解码及失败回退 |
| 内置提示词增强 | 实际启动暴露旧 `settingsScope` 注入阻塞前端。现有兼容脚本将固定 0.2.1 插件迁到 `configForms.get(NS)`，每次更新仍调用原插件 decoder；安装时和托管版本修复时验证补丁，用户移除或自选版本沿用原策略 |
| 账号归属 | 禁用新增官方账号适配器和账号设置页，继续由 Shell 用户中心管理身份和 Gateway 凭据 |

Core 仅公开已有的 `resolveProfiles`、`credentialStoreFrom`、`authContextFrom` 三个构造辅助函数，未复制网络传输实现。其严格 profile 校验和鉴权语义在英文、中文 README 中同步记录；序列化和流转换辅助函数仍不公开。

## 已完成的验证

| 检查 | 实际结果 |
| --- | --- |
| Core 官方完整构建 | 通过；Host、Client、native system 和 Web 构建完成，记录 357 个 Client 产物 |
| Core 文档同步 | 最终 42 项检查全部通过，含双语配对、类型等价、目录、链接和文档构建 |
| Core 桌面相关回归 | 一轮覆盖 820 个文件，19,948 项通过、2 项失败、19 项跳过；图片投影的超时测试所在 24 项文件单独通过，轨迹构建产物测试补齐 locale 初始化等待后所在 3 项文件通过。不能把这轮表述为一次全量全绿 |
| Core 通用模型适配器 | 最终 14 个文件、345 项全部通过 |
| Core 其他定向检查 | 技能极简预设 2 项、bundle roster/manager 97 项、提交钩子后的轨迹/声音/notices 85 项通过；持久类型检查匹配 62 个根与 8 条历史记录 |
| Core 真实浏览器 | 新版设置外观 replay 快照通过 |
| Runtime 装配 | 最终提交的 darwin-arm64 Runtime 成功装配；实际必需 peers、Node 可执行文件和目录布局检查通过；装配后恢复 frozen 开发依赖，Core 工作目录干净 |
| Shell 完整测试 | 最终 126 个文件、914 项全部通过，实际选中新版 Runtime，未跳过 Gateway/技能进程测试 |
| Shell 编译 | 集成包类型检查与构建、Main/Renderer 类型检查、electron-vite 桌面构建均通过 |
| 实际 Runtime 启动 | 临时 Profile 中 Gateway 默认路由、模型目录、工作区/会话创建和持续运行 20 秒检查通过 |
| 实际正常桌面 | 真实 Main/preload/Renderer，测试登录响应与隔离用户目录：单侧边栏、设置、主题同步、关于/更新窗口、工作区、退出销毁旧视图、第二账号分区隔离全部通过 |
| 实际技能菜单 | 12 个内置技能完整显示；选择“达人推荐”插入原生草稿 `/creator-recommendation`，选中状态更新，再次选择移除成功 |
| 实际安全模式 | 独立用户目录下登录、恢复设置、主题、工作区、账号切换及安全模式标识检查通过 |

真实桌面验收使用测试登录响应，模型请求测试使用 HTTP 响应替身；上述结果不等同于真实企业服务可用性、真实模型额度请求或生产用户数据迁移验收。正常桌面的关键证据在 `/private/tmp/insight-desktop-core-0.2.1-skills-final-20261008`，安全模式在 `/private/tmp/insight-desktop-core-0.2.1-safe-smoke-20261008`。测试观察到的开发态 Electron CSP 提示不作为安装包 CSP 验收。

## 未完成的发布资格与限制

- 当前未执行 push、发布新 Runtime tag、上传安装资产或更新 Stable/Candidate 指针。`core-runtime.lock.json` 仍锁定现行三平台 `insight.4` 发布资产；本地 `build/core-runtime` 和 `build/runtime-manifest.json` 已切到最终新 Core，manifest 明确标记 `source: local`。
- 普通 `npm run build` 会按旧正式 lock 准备 Runtime，因此此集成分支应使用下方 `dev:local` 入口。待同一个 Core 提交的三平台 Runtime 构建与验收完成，再更新正式 lock、摘要和发布元数据。
- Windows x64、macOS Intel 的原生构建、实际启动、安装升级与回滚，以及 macOS 签名、公证仍需相应发布环境；本机 arm64 成功不能替代这些检查。
- Core 默认全量测试曾受本机 CLI/真实外部服务环境影响，未取得一次全部通过的结果。已改为覆盖桌面、Host、Session、启动和迁移的回归；不能宣称所有 Core 项目均已通过。
- 使用独立 Python 3.12 运行实验性 Python PTC：283 项通过、1 项失败、2 项跳过。失败为 Darwin 下 fork 子进程 CPU 预算测试 `charges a forked descendant against the run CPU budget`，该实验包源文件未在本轮修改；此项仍须单独调查，未通过跳过或修改预算规则规避。

## 本地复现

Core 构建需要符合仓库 engines 的 Node 和 pnpm 11.7.0。已装配 Runtime 可直接启动；命令在 Shell 仓库执行：

```sh
npm run dev:local -- /Users/boxser.shi/Documents/harness/insight-harness-core/dist/runtime-0.2.1-alpha.1
```

该入口检查 Runtime 平台、提交元数据和因赛技能接口，再准备集成包与桌面 Profile。它不会生成新的三平台正式 lock。

重新装配时，在 Core 仓库执行：

```sh
pnpm install --frozen-lockfile
pnpm run build:official
pnpm run runtime:assemble --target darwin-arm64 --output dist/runtime-0.2.1-alpha.1 --skip-build
pnpm install --frozen-lockfile --force
```

Shell 回归需显式选择实际新 Runtime：

```sh
INSIGHT_TEST_CORE_RUNTIME=/Users/boxser.shi/Documents/harness/insight-harness-core/dist/runtime-0.2.1-alpha.1 npm test
```
