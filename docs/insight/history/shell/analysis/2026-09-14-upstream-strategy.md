> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# Insight Desktop 上游升级决策与定向接收

审计日期：2026-09-14。结论：**继续以 Insight Shell 为产品基线，分批接收上游修复；Core Runtime 单独升级。不在当前 RC9 验收周期整体替换为 DSH Desktop。** 在最初三项 Windows 修复之后，已按用户确认继续完成 Shell 稳定性适配与 Core 0.1.5-rc.2 隔离合并实验。Shell 构建与测试通过，Core 候选包及升级插件组合的 Host 冒烟通过；尚未切换正式 Runtime lock 或发布新版本，不能称为全量兼容验收完成。

## 证据范围

| 输入 | 精确身份 |
| --- | --- |
| Insight Shell 起点 | `aeb8444b6465c67e93bac274fb005806f186756b`，`1.0.0-rc.9` |
| 共同祖先 | `e589bf688624871d953f8c58418f913c407dfc7e`，2026-08-26 |
| 本轮拉取并核对的 upstream main | `6a9c6687c14f9d4183d6907935024f9dd804043e`，2026-09-13，提交题为 `V0.9.0 (#412)`，本地标签 `0.9.0-rc1` |
| 公开 Latest Release | [v0.8.2](https://github.com/dataelement/dsh-desktop/releases/tag/v0.8.2)，2026-09-12 发布，对应 `c7e6a59` |
| 最新预发布 | [0.9.0-rc1](https://github.com/dataelement/dsh-desktop/releases/tag/0.9.0-rc1)，GitHub API 核实 `prerelease=true`，北京时间 2026-09-14 07:56:59 发布，对应 `6a9c668` |
| 上游运行时 | v0.8.2 为 `0.1.2-rc.1`；main 为 npm 精确锁定的 `0.1.5-rc.2` |
| Insight Core | `insight-runtime-v0.1.1-rc.10`，Core `833f4246abaf3ce5fcf39c3f81a8be2499e7f434`，包版本 `0.1.1-rc.2` |
| 工具链 | 两边均为 Electron `43.4.0`、electron-updater 范围 `^6.8.9`；Shell 本轮使用 Node `24.4.1` |
| 执行分支 | `codex/upstream-intake-20260914` |

先执行 `git fetch upstream-dsh-desktop --prune`，另以 GitHub API / `ls-remote` 核实 main。原本缓存的 `7cb9e04` 只到 9 月 2 日，不能作为本轮最新基准。Release、main、Runtime 版本是三种不同身份，不以 Shell 的 `1.0` 和上游 `0.8/0.9` 比较能力新旧。

`git rev-list --left-right --count HEAD...6a9c668` 在起点得到 **211 / 190**。上游相对共同祖先改动 **1060 个文件、348381 行增加、15920 行删除**，包含市场源码、资源、构建产物等，不能将行数直接当工程量。main/preload 子集为 43 文件、11532 行增加、601 行删除。

只读 `git merge-tree --write-tree aeb8444 6a9c668` 得到 **82 条冲突记录**（不是 82 个独立功能或 82 个唯一文件）。主进程、Runtime、插件恢复、更新器、preload、品牌、package/lockfile、发布 workflow 均在冲突范围。没有对工作区执行整体 merge。

本轮对提交历史做了清单级筛选，对下表的关键变更阅读了源码与差异；这不是对全部上游代码、开放 PR 或服务端实现完成了逐行安全审计。

## 为什么保留现有产品基线

| 方案 | 收益 | 代价与判断 |
| --- | --- | --- |
| 在 Insight 上定向移植 Shell 修复，Core 独立升级 | 保留现有产品契约、发布资产和数据目录；每批能独立验证 | 需要维护接收记录。**当前推荐** |
| 整体 merge/rebase 最新 upstream | 表面上一次拿到所有改动 | 合并冲突之外还有自动合入的语义变化，会同时替换运行时、市场和更新策略。当前风险最高 |
| 从最新 DSH 重建，再接入 Insight 登录/Gateway | 长期可减少一部分老代码维护 | 需要重新证明账号隔离、刷新撤销、Safe Mode、存量数据和更新连续性。适合作为未来有明确收益门槛的迁移实验，不宜直接替换 RC9 |

当前自研能力远不止登录页面：

- `src/main/auth/`：Main 持有会话、safeStorage、Cookie 刷新和认证状态；未认证不能启动工作区。
- `state/account-scope.ts` 与 `workspace/`：环境/账号目录、账号独立的 `persist:insight-harness-<scope>` Electron Session、串行退出与切换生命周期。
- `runtime/model-credential-bridge.ts`：凭证仅向当前有效的 Harness 进程按需提供，退出或换账号使旧请求失效。
- `packages/insight-desktop-integration/`：`yinsai-gateway` 通过 `DeepSeekAdapter.resolveApiKey()` 获取登录 access token，用户不填模型 Key；第一方插件还承担品牌、单侧栏、账号和设置入口。
- `state/safe-mode-profile.ts`：Safe Mode 必须保留第一方 Gateway，不能退回原生 API Key 引导；Market 可卸载，核心集成和 Sidebar 受保护。
- `core-runtime.lock.json`、`src/main/update/`、发布脚本：锁定自研 Runtime，使用 Insight 身份、签名 Release 和自己的分发域名。

因此“API Key 接入拦截”应准确理解为第一方 Provider 的令牌接入和产品默认配置。隐藏密钥设置并不等于操作系统级的全局网络拦截，也不能单凭客户端配置证明所有第三方插件都无法直连外部模型。后端鉴权、配额和模型访问权限仍属于 Gateway。

## 更新机制：采用什么，保留什么

上游 [灰度与诊断变更 af628f6](https://github.com/dataelement/dsh-desktop/commit/af628f6d1a4d3597e7e625cd5bd4982d7068c76b) 引入安装 UUID、版本/平台条件、服务端更新决策和逐次同意的故障报告。上游 `docs/desktop-rollout-diagnostics.md` 明确：无匹配规则不更新，决策失败不回退全量源；历史版本安装保留绕过灰度与降级行为；尚未统计安装器/下载失败和升级成功关联。

| 能力 | Insight 现状 | 决策 |
| --- | --- | --- |
| 自动检查、用户确认下载/安装、跳过版本 | 已有启动延迟、6 小时间隔、恢复检查和状态机 | 保留，不复制另一套管理器 |
| 候选/正式隔离、发布预检 | 已有显式 channel、独立指针、同源完整资产与发布验证 | 已覆盖核心目的，不采用 ModelScope/飞书/上游域名 workflow |
| 签名与可信发布 | Manifest 验签、目标检查、平台元数据版本绑定、下载文件哈希；不可变目录和指针推广 | 保留。指针本身不是签名 Manifest，不能把两者混称 |
| 最低版本/强制升级 | 已有签名策略、缓存强制状态和禁止正常降级 | 保留；兼容元数据存在不等于已有经过验证的数据降级迁移 |
| 灰度分发 | 当前 `candidate/current.json`、`stable/current.json` 为渠道级指针；没有安装级比例选择 | 下一轮更新机制首选。先补自有发布服务契约，再接到 `UpdateSource` 前的版本选择；后续仍走签名与哈希验证 |
| 历史版本选择/回退 | 正常客户端禁止降级，指针推广单调前进 | 当前不引入任意版本回退 UI。优先发布更高版本、内容回退到已知良好代码的修复包；它仍需要数据兼容验证 |
| 故障报告 | 本地诊断与事故文档；未接上游上传服务 | 可借鉴逐次同意与脱敏，但只接自有接收端，先定义内容范围和升级关联 ID |
| 下载/安装真实成功率 | RC9 平台升级人工门禁尚未关闭 | 优先闭环旧版本→新版本、进程清理、重新启动后的版本确认，不以新灰度能力替代这些验收 |

灰度接入建议：安装随机 ID + 显式 channel/platform/arch/currentVersion 请求自有决策；服务端只返回“不提供”或具体 release version，客户端自行拼接受信任的不可变目录，再验 Manifest。禁止接受任意 feed URL。普通手动检查也应遵守灰度；强制最低版本如何覆盖灰度必须先定义，不能让“未命中”解除已经缓存的强制策略。灰度比例扩大与停止扩大发生在决策层，不修改同版本资产。服务端当前没有经本轮核实可用的此类接口，因此未臆造域名或上线调用。

历史回退要另外证明：目标包仍受信任、允许目标范围、最低支持版本、Profile/账号/会话 schema 可读写、备份/恢复与取消行为。直接打开 electron-updater 的 `allowDowngrade` 无法完成这些要求。

## 上游采用矩阵

| 优先级 / 状态 | 上游变更 | 当前适用性与处理 |
| --- | --- | --- |
| 本轮已适配 | `a6ffac7` Windows PATH 大小写 | 两个环境构建入口仍只认部分拼写；新增统一读取，并让所有 Windows PATH 拼写携带同一个最终值 |
| 本轮已适配 | `c52f450` Windows Harness process group | 当前缺少 `detached`；补 Windows 专用隔离，保留 RC9 `taskkill /t /f` 清理与凭证 IPC |
| 本轮已适配 | `1454ea3` Windows titlebar inset | URL 缺少 36px inset；传给现有插件，保留其他 query 与 hash |
| 已适配，待原生验收 | `e26e5e8`、`36f93fb`、`ec99e47` renderer/GPU 恢复 | 已接主窗口和当前账号 WebContentsView，限制 reload 次数与间隔；Windows GPU 降级状态落盘后才重启，稳定启动后可探测恢复。默认不关闭 GPU sandbox |
| 已适配 | `a804301` 稳定 loopback origin/HTTP cache | 优先端口 43129，端口占用/访问拒绝时回退；只清当前账号 Session 的 HTTP cache，origin 状态按账号保存，Cookie/storage 保留。异步加载期间退出账号会废弃旧 view |
| 不原样采用 | `df9cfcc` localStorage 全量代理落盘 | 上游修改 Storage 原型并以设备级 Profile 管理存储；我们有账号分区。先选择明确的偏好持久化边界，避免全量页面状态横跨账号 |
| 已适配现有 Profile 失败行为 | `272fcaa`、`ef0fa46`、`ce289c6`、`c7faa1e` 恢复失败关闭/移除破坏性 rollback | 修复安装失败后不再继续启动，也不再自动 prune 缺失 bundle 声明；转入恢复界面。未引入 Insight 不具备的 generation journal/rollback 系统 |
| 已部分适配 | `b7e15f7`、`1bbc211`、`b0c1807` 多插件识别与兼容升级 | 已接 pending-service、duplicate-route 栈定位和多个直接失败插件候选，保护受管插件；尚未移植 b7e15f7 的完整结构化 loader owner 协议。新版插件组合仅在隔离候选验证 |
| 架构不同，暂不采用 | `d34eacc`、`9daf078`、`f7aebb5`、`b854c29` generation 清理/peer/registry/市场卸载 | Insight 已移除旧 desktop-market-installer，当前 Market 为锁定 1.44.0 + 宿主适配。先审查市场升级，不能把 1.45.1/generation 的修复套到不存在的实现上 |
| 目的已覆盖，需保持回归 | `6eb83c1` Safe Mode 排除可选桌面插件 | Insight 已隔离第三方组合并显式保留 Gateway。原样采用仅 core 的 Safe Mode 会损坏免 Key 能力 |
| 暂不单独采用 | `d06b5bc` 取消 clone-or-copy / 单并发 | 上游依赖其锁恢复 runner；Insight 已移除该 runner。先证明 Windows 锁冲突恢复策略，再调整 pnpm 性能参数 |
| P1，Core/打包批次 | `fb168ef`、`9802964`、`4d34d8d` Windows hidden-console/helper | 属于真实 Windows 工具运行兼容，涉及 helper 与原生依赖闭包，不能只拷入口代码而遗漏包资源；必须经 Core 原生制品验证 |
| 已适配启动扫描部分 | `dedb25a` 空闲 CPU | boot MutationObserver 合并触发并在启动页消失后停止。手机轮询/WebSocket 不在 Insight 产品内，未引入 |
| 隔离合并与 Host 验证通过 | `6a9c668` Harness 0.1.5、启动性能、CLI `runCli` | Core 已合入精确 tag 并保留 Insight settingsDialog/slots 与发行工作流。Shell 同时兼容旧 CLI 自执行、新 CLI runCli 和新启动 token/cookie；产品仍锁定旧 Core，见下方候选证据 |
| Core 单独评估 | `a631a43`、`f13001b` 删除会话，`c8c33c4` 交付文件链接，`12b0905` 推理强度 | 对应 Core/插件功能，当前 Shell 不维护这些 npm patch。先在 Core 源码确认缺陷，再生成新锁定 Runtime |
| 不纳入本轮产品 | 手机/Pinggy、PPT、托盘行为、上游品牌和部署服务 | 不能因为 upstream 增加就默认为 Insight 产品需求；托盘尤其改变“关闭/退出/更新”的语义 |

## 企业登录分支也不能直接替换

另检查了 `upstream-dsh-desktop/merge/dsh-gateway-auth` 的 `327afa6`。它包含 BiSheng 企业登录、凭证 broker/vault、多模型与用量，确实在接近最新 main 上实现了企业接入。但其协议为 `/api/dsh/authorizations`、`/api/dsh/token`、`/api/v1/dsh/models`、`/api/v1/dsh/chat/completions`，使用 PKCE 和 BiSheng `0.4/0.5` 契约；我们是用户中心登录/Cookie 刷新和 Insight Gateway。它不是“已有我们业务能力的新上游”，也不是已发布稳定基线。可作未来多模型、浏览器回调设计参考，不能替代现有会话、账号目录和免 Key 验收。

## 分阶段执行与完成标准（最初路线，执行进展见下节）

1. **当前批次：** 完成三项可独立验证的 Windows 修复和接收记录。仅 3 个源码文件；不更新 Core、不改变发布通道。
2. **下一平台稳定性批次：** 在 Windows 实机先关闭 RC9 旧安装升级阻断，验证本轮 console/PATH/inset，再处理可复现的 GPU/renderer/hidden-console 问题。退出或更新不得留下 Harness 树，登录状态不得被恢复机制绕过。
3. **下一更新机制批次：** 自有灰度决策接口 + 可信 Release 选择；补充下载/安装结果闭环。需要服务端契约和三个目标包的 N→N+1 验收。历史降级另立数据方案。
4. **Core 升级实验：** 在隔离 worktree/测试 Profile 中比较新 Core 与 `833f4246ab` 的实际差异，验证 `DeepSeekAdapter`、slots/settingsDialog、凭证 IPC、Safe Mode、Better Sidebar、Market peer、旧会话读写及 CLI/Utility Process。继续用 `insight-harness-core` 生成三平台 Runtime，九项资产与哈希齐全后才改 Shell lock。旧 Profile 先复制备份，不能直接用新 Core 打开唯一的用户数据。
5. **重建基线的重新决策门槛：** 仅当隔离实验能同时证明业务行为等价、存量数据可迁移、签名更新路径连续，并且反复维护的 Shell 适配成本明显高于重新接入成本，才考虑以新版 DSH 重建。文件冲突少本身不是充分依据。

运行时升级是下一项有较大长期收益的工作，不应永久冻结在 0.1.1；但它和当前 RC9 的安装故障、Shell 修复属于不同验证批次。

## 第一批实现与验证（历史记录）

实施步骤见 [执行计划（历史归档）](../archive/README.md)，接收入口见 [upstream intake](../upstream-intake.md)。

- 新测试在旧实现上 10 项失败，包含 PATH 丢失、缺少 Windows detach 与缺少/过时 titlebar inset；修复后相关 5 文件 **85 项通过**。
- 全量运行 96 文件、625 项：95 文件 / 623 项首次通过；Feishu 的 2 项因 `/opt/homebrew/bin/python3` 是空文件而报 `ENOEXEC`。使用 `PATH="/usr/bin:/bin:$PATH" npm test -- test/feishu-release-notes.test.ts` 后该文件 4 项全通过。因此全部测试已获通过证据，但不是一次原环境下全绿。未修改 Python 或无关发布测试。
- `npm run typecheck`、普通 `npm run build` 通过；构建重新下载并校验 darwin-arm64 锁定 Runtime，`runtime.json` 仍为 `833f4246ab` / Node `24.9.0` / pnpm `11.7.0`。第一方集成类型检查与构建、Electron main/preload/renderer 构建均完成；sandbox preload 无相对共享 chunk 引用。`git diff --check` 通过。
- 本轮不修改版本号、Core lock、package/lockfile、更新 Manifest 策略、签名密钥、分发域名、用户数据或登录代码。已有未跟踪的 `2026-09-09-open-design-dsh-runtime-analysis.md` 保持原样。
- Windows console 隔离是真实 OS 行为，本机模拟参数测试不能替代实机；插件 PATH 测试模拟 Windows 大小写，实际路径分隔符/进程启动仍要在 Windows 验证。标题栏信号传递已测，按钮点击效果仍需实机。
- 本轮未提交/推送、未发包、未推广指针；不是“已更新到最新 DSH”，也不是“上游所有问题已解决”。RC9 的 Windows 旧版→RC9 与 macOS `/Applications` 安装过渡门禁仍见 [RC7–RC9 事故记录](../incidents/2026-09-11-rc7-rc9-updater-hardening.md)。

## 用户确认后的第二阶段执行结果

本阶段已实施，未宣称全部 190 个上游提交已逐项采用。继续保留 Insight Shell，配套升级 Core 和社区插件的方向得到独立部署验证支持；直接替换 upstream Desktop 仍无必要。

### 已完成的 Shell 适配

| 类别 | 实际行为及验证边界 |
| --- | --- |
| Renderer / Windows GPU | 主窗口与当前账号 view 的主 frame 故障有限重试；忽略取消/正常退出，销毁时取消定时器。GPU 降级有持久状态和上限，不在无法保存状态时反复重启。原生 Windows 驱动行为未验收 |
| Origin / HTTP 缓存 | 首选稳定 loopback 端口，冲突时回退；按账号清 HTTP cache，加载等待期间注销不会重新显示旧 view |
| Profile 恢复 | 依赖修复失败保留 bundle 清单与未完成标记，进入恢复流程；安装成功才标记完成。不再靠删除缺失插件声明来掩盖失败 |
| 多插件故障 | 接收直接失败的多个插件、等待 service 与 duplicate-route 定位线索，排除第一方受管插件 |
| 界面与启动开销 | 原生菜单作用于活动 Harness view；启动 DOM 检查合并触发并在启动完成后停止 |
| 更新请求 | Release pointer、manifest、签名的请求和正文消费统一有 30 秒超时，失败不改变可信源与验签策略 |
| 新旧 Core 兼容 | CLI 有 runCli 导出才显式调用；新版本等待本次子进程发布的同源 token，再供 Main 导航交换 Cookie。token 不进入 Runtime 快照/日志；停止进程清除 token |
| 第一方 Gateway / UI | 适配新 DeepSeekAdapter prepareExtensions；移除已删除的 client-runtime 注入依赖，保留 settingsDialog、品牌、账号入口和免填 Key 行为 |
| 回归设施 | 打包冒烟支持旧 RPC 和新 Typert Remote/Cookie 协议；真实 Gateway IPC 测试可指定隔离候选 Runtime |

Shell 全量测试 **107 文件 / 686 项一次通过**（`PATH="/usr/bin:/bin:$PATH" npm test`）；Shell 类型检查、第一方集成的新旧 Runtime 类型检查、`npm run build` 均通过。系统 PATH 用于避开机器上已有的空 Python 可执行文件。原本的 Windows PATH、process group、titlebar inset 修复包括在本轮结果中。

### Core 隔离合并与制品验证

- 原 Core 目录 `/Users/boxser.shi/Documents/harness/insight-harness-core` 仍在 `833f4246ab`，保持干净。
- 隔离工作树 `/private/tmp/insight-core-upgrade-20260914`，分支 `codex/core-0.1.5-rc.2`。
- 合入 upstream `dsh-v0.1.5-rc.2`，精确提交 `fb2c4b9e698e30edb738bca4cf0618587db7d203`。
- 本地提交：`3ef71e2d8a`（上游合并并保留 Insight 设置入口/工作流）、`abcf8ddf6e`（补齐必需 peers、部署清单原子替换）、`33a669535c2f073be753cbf297f5baf1e6507c3c`（修复 pnpm 部署位置）。分支干净，尚未推送。
- 相对原 Core 基线，Git 默认统计为 **10,461 个变更路径**（包含大量上游重构、文档、生成文件，默认 rename 检测触及上限），不是只改 Shell 中看到的几个文件，也不能把此数直接当功能数量。
- `build:official` 通过；聚焦设置入口、Runtime 发行和会话 v0→v1→v2→v3 迁移/拒绝路径的 **26 文件 / 871 项**通过。部署脚本新增修复后的聚焦套件 **9 项**通过。未运行整个 Core 全量测试或三平台 CI。
- 真实打包复现并修复：缺失必需 peer（例如 attachment）导致 import 失败；pnpm 硬链接写回源码 manifest；pnpm 11 legacy hoisted deploy 将部分包放在源 importer 下。部署时补齐记录中的包并排除其源码 node_modules 链接，再校验 required peers。候选目录链接检查：15 个链接，无断链或指向目录外的链接。
- 最终 darwin-arm64 候选 `/private/tmp/insight-core-candidate-runtime-final-20260914`，runtime.json 为 `33a669535c…` / Core `0.1.5-rc.2` / Node `24.9.0` / pnpm `11.7.0`。临时制品用于实验，尚无公开不可变 Release 资产与三平台哈希。

### 真实兼容结果与仍缺的门禁

| 验证对象 | 结果 | 证明范围 |
| --- | --- | --- |
| 新 Core + 第一方 Gateway | 5 项真实 Node / Electron utilityProcess IPC 测试通过 | 免填 Key、令牌失效、401、取消及日志无凭证；HTTP 模型响应为测试 fixture，未调用真实账号后端 |
| 新 Core + 第一方最小 Profile | Host 打包冒烟通过 | 新 token/Cookie 交换、默认 Gateway、工作区/会话创建与 20 秒稳定运行；不是 Renderer/UI 全流程 |
| 新 Core + 当前 Sidebar 0.16.1 / Market 1.44.0 | **失败** | Sidebar 导入已删除的 `settingsNamespace`，直接阻断插件树启动 |
| 新 Core + Sidebar 0.19.1 / Market 1.46.1 + 其他现有内置插件 | 隔离候选 Host 冒烟通过 | npm 固定发布包替换到临时资源，沿用现有依赖树；不是重新解析并锁定全部生产依赖，也没有证明 Market 的 Insight 管理策略补丁已适配 |
| Shell 原锁定 Runtime | 全量测试、类型检查和生产构建通过 | 当前交付基线的源码/构建回归；不等于旧安装器→新安装器升级成功 |

因此 **Core 与 Sidebar/Market 必须配套升级**。不能只更新 core-runtime.lock.json，也不能为了让测试启动而永久移除受保护的 Sidebar。下一次切换正式 Core 前必须完成：新版插件的精确依赖锁与 Insight Market 管理策略适配；Renderer 模块加载/单侧栏/账号菜单/设置/编辑器/终端/插件安装卸载验收；Safe Mode 与注销换账号端到端；复制的存量 Profile/会话迁移；darwin-arm64、darwin-x64、win32-x64 原生制品和旧安装→新安装更新。

灰度分发仍缺自有服务端协议；上游结构化 loader owner、generation 数据恢复与单独的永久删除会话功能没有以“全量移植”名义引入。发布版本、签名信任、分发域名、产品 Core lock 和当前 Sidebar/Market 锁定版本保持原值。没有发布、指针推广或修改用户 Profile。

### 本地验证证据

临时日志（不纳入仓库，环境清理后可能消失）：

- Shell：`/private/tmp/insight-intake-all-tests.log`、`/private/tmp/insight-intake-types.log`、`/private/tmp/insight-intake-shell-build.log`。
- Core：`/private/tmp/insight-core-build.log`、`/private/tmp/insight-core-compatibility-tests.log`、`/private/tmp/insight-core-layout-tests.log`、`/private/tmp/insight-core-candidate-final-assemble.log`。
- 兼容：`/private/tmp/insight-candidate-final-gateway-tests.log`、`/private/tmp/insight-candidate-firstparty-smoke.log`、`/private/tmp/insight-candidate-profile-smoke.log`（旧 Sidebar 失败）、`/private/tmp/insight-candidate-final-profile-smoke.log`（升级组合）。
