> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# Insight 客户端体验与构建复核

> 历史阶段记录：下文的阶段状态、待授权描述和运行结果保留当次背景，不代表当前进度。当前状态见 [P5 收口](2026-10-30-dsh-insight-p5-delivery.md)，下一阶段见 [P6 交接](2026-11-02-dsh-insight-p6-handoff.md)。历史失败保留，不将未复验项记为通过。

日期：2026-11-02。状态：本次五项客户端/开发入口修改已实现，通过定向测试、构建和独立审查；CI 提速分析已完成，未修改工作流。改动尚未提交、未重新打包、未发布 OSS，已经公开的 `1.0.10-rc.1` 安装包没有变化。

## 需求与最小处理

| 问题 | 处理 |
| --- | --- |
| 更新窗口出现 Toggle Dev Tools | 仅为 Insight 更新子窗口执行 `setMenu(null)`，保留系统标题栏及主应用开发能力 |
| 有登录态时闪现登录页 | 先在隐藏窗口恢复凭据；认证和账号 Home 都成功后进入工作区。仅无凭据、凭据失效、离线或数据准备失败时显示现有页面 |
| 重试更新与 profile 的位置 | 按用户最新决定撤回侧边栏调整，保留原位置；不新增 sidebar 插槽 |
| Windows 默认目录 | 新装默认使用 `%LOCALAPPDATA%\Programs\insight-desktop`，显示名保持“因赛AI”，主程序为 `insight-desktop.exe`；已有安装仍优先沿用注册路径，macOS 仍为 `因赛AI.app` |
| 快捷开发启动 | 新增 `npm run dev:insight`，设置 Insight 产品和默认版本后直接调用 DSH 既有开发启动器；不新增打包或运行时准备链 |
| rc 常规检查 | 当前为 rc 时先查正式版，没有可升级正式版再查较新 rc；正式版客户端保持正式渠道，五连击手动内测入口保留 |

## 登录恢复

```text
隐藏的 Insight 登录窗口
  → 原有加密凭据恢复与账号校验
  → 原有账号 Home 准备
      → 成功：启动工作区，销毁未展示的登录窗口
      → 认证失败/离线：显示原登录页
      → Home 保护或准备失败：显示已有数据保护/错误页
```

不依据“本地存在 token”绕过后端校验，不修改凭据格式、历史目录、会话日志或 Host 的认证门控。恢复期间的应用 activate 事件也不能提前显示登录窗口；数据准备失败必须能显示页面，避免进程存在但无可操作窗口。实现只调整 `apps/desktop/src/insight-startup.ts` 与现有测试，不修改 `main.ts` 或认证状态机。

## 已确认的 DSH 接入

1. 安装目录：在 `apps/desktop/scripts/electron-builder-config.mjs` 中，仅 Insight Windows 使用现有 `win.executableName=insight-desktop`；`smoke-packaged-runtime.ts` 使用同一产品常量定位 EXE。常量和声明由现有 Insight packaging 模块拥有。补配置和 runtime 路径测试，不修改 NSIS、PowerShell、appId、GUID、用户数据目录和安装升级逻辑。
2. 登录恢复：采用上一节的隐藏恢复方案；保留恢复失败、退出和数据保护路径，补并发关闭与 activate 行为测试。

安装目录与登录恢复已获用户明确授权并完成。侧边栏插槽方案按用户最新要求撤回：源码、账号注册、测试、快照、README 和生成目录均恢复到原实现，基线记录移除该条目。保留的修改已同步基线轨迹与三组双语文档。CI 仅分析，未修改打包检查、锁文件或触发新构建。

## CI 实际耗时

证据来自成功的 [run 41150548471](https://github.com/Overu/deepseek-harness/actions/runs/41150548471)。三个目标已并行，macOS 各自的 ZIP/App 和 DMG 公证也已并行。

| 阶段 | macOS arm64 | macOS x64 | Windows x64 |
| --- | --- | --- | --- |
| Job 总耗时 | 23 分 49 秒 | 26 分 13 秒 | 15 分 9 秒 |
| 打包主步骤 | 21 分 32 秒 | 21 分 45 秒 | 12 分 13 秒 |
| `build:official` | 616.68 秒 | 287.13 秒 | 尚未单独提取 |
| App 公证和 ZIP lane | 316.34 秒 | 391.42 秒 | 不适用 |
| DMG 生成、公证和验证 lane | 373.53 秒 | 444.46 秒 | 不适用 |

两条公证 lane 的时间不可相加。Release 汇总共 2 分 48 秒，其中三个 artifact 下载约 32 秒，上传/回读/公开约 118 秒；没有重复编译客户端。

arm64 的 `build:official` 中，Host aggregate check 为 492.41 秒，Client bundle 为 354.30 秒，Client aggregate check 为 371.53 秒；x64 对应为 117.55、50.37、67.51 秒。这些任务重叠执行，不能相加。arm64 外层 Electron/Desktop runtime cache 已命中约 400 MB，但两个架构的签名缓存均未命中；不能把整个构建称为冷缓存，也不能把所有等待都归于 Apple。

## 提速建议与边界

- 维持平台并行、公证 lane 并行、锁定依赖和既有缓存。没有证据支持继续增加打包层、观察器或资格阶段。
- 可选的小改是仅让 Insight 打包使用已有 `build:artifacts --profile official`，避免每个平台重复执行测试/脚本的两个 aggregate typecheck。源码与既有 build DAG 测试确认，两种 scope 生成相同的八项产物并写入相同 profile/digest 记录；产物 compiler、签名、公证和 runtime smoke 保留。但单独手动 dispatch 将不再检查 aggregate 消费者，不能将本地检查或 PR CI 尚未运行的提交视为已经检查。本次只提出方案，不实施，也不新增检查 job。
- 本次完整 build 的产物最后完成到 aggregate 最后完成，仅差 arm64 约 7 秒、x64 约 5 秒。直接删检查的尾部收益有限；减少并行检查对 CPU/内存的争用可能缓解 arm64 波动，但没有对照实测，不能承诺分钟级改善。后续可在自然发生的构建中比较，不为数据额外触发 CI。
- 并行下载 Release artifact 最多只节省几十秒，收益低，本轮不增加专用逻辑。
- 保留签名、公证、runtime smoke、payload 摘要和 Release 回读；不缓存可变制品来绕过它们。

本轮本地实现不会改变已发布 Release；任何新安装包需要后续用新版本构建，OSS 更新发现仍取决于后续正式投放。

## 验证结果与未覆盖项

- 撤回前的十一份定向测试曾有 79 项通过；侧边栏新增的两项顺序测试随方案一起撤回。撤回后重新验证结果见文末。
- `build:artifacts` 八项产物检查通过，随后 `build:check` 两项聚合类型检查通过；生产改动的 scoped oxlint、Client catalog freshness、三组具名双语配对和 `git diff --check` 通过。
- 使用独立 `/private/tmp/insight-followups-dev-20261102` userData 实际执行 `npm run dev:insight -- --skip-build`，primary-runtime/Office 准备完成并成功打开“因赛AI Dev”登录窗口；未填写账号、接受协议或修改旧数据。通过原生菜单打开更新窗口，确认默认标题栏及无 Toggle Dev Tools；测试进程随后关闭。
- 源码开发模式按既有策略没有 packaged update source，因此本机开发窗口的“暂时中断”不代表完成了线上 rc 发现。签名源解析、版本策略与下载绑定由定向测试覆盖；本次未执行 OSS 投放、新包原生更新或 Windows 安装实测。
- 全仓 `test:docs` 为 18/21：失败为既有的 packaging README 配对记录、`python/sdk/uv.lock` 仓库引用，以及具体术语扫描命中的旧源码/外部同步目录。相关文件与 HEAD 一致。没有修复或评价 bundled-skills 内容，也没有为这些失败扩大本次范围；本次三组具名配对全部通过。
- 原 `sidebar-root.client.spec.tsx` 仍有依赖问题：HEAD 锁文件中的根 testing-library 组合为 React 18 与 React DOM 19，而产品使用 React 18。已用未修改的 HEAD 组件和 HEAD 测试临时副本复现“New session 不存在、空 DOM”的同一失败，探针文件已清理。本次不修改该原测试、根依赖或共享运行器；侧边栏新增验证与实现已一并撤回，原有 slot/品牌测试保留。
- 最终独立审查未发现本次新增的实质阻断。它另确认既有的随包 CLI 缺口：`apps/desktop/cli/dsh.cmd` 与 `cli/dsh` 仍写死 DeepSeek Harness 可执行文件名，Insight 既有版本已经无法通过这套 launcher 启动。该问题不是本次改名回归，需另行授权按产品生成 CLI，不在本次官方文件范围内。

后续新包应使用新版本（例如 `1.0.10-rc.2`），不覆盖已公开 `rc.1`。本次没有增加或恢复 Windows qualification、观察器、诊断脚本或新的发布阶段。

## 侧边栏撤回验证

按用户最新决定，官方 `ui-sidebar`、Insight 账号注册/类型/测试、Client slot catalog 与 HEAD 精确一致，`sidebar.footer.trailing-action` 已移除。原账号和更新状态位置保留；登录恢复、更新窗口菜单、rc 检查、Windows 默认目录和 `dev:insight` 修改继续保留。

撤回后十一份定向测试 77 项通过；本地产物构建 8/8、后续聚合类型检查 2/2、两组受影响文档配对与 diff whitespace 检查通过。新增布局测试、快照、README 和基线条目已随实现撤回。本次未重新打包、提交或发布。

## 后续开发模式更新修复

源码开发模式的更新误报已单独修复：启动不再自动检查安装包更新，菜单与工作区更新入口改为原生开发模式提示；正式包缺失更新来源仍报告错误，不放宽校验。该项 9 个测试、本地构建、聚合类型检查和本机原生提示复核通过。此前记录的开发态“更新暂时中断”已被该提示替代。Canvas node-refs 历史渲染问题按用户决定先保留设计，见 [独立修复设计](2026-11-02-dsh-insight-canvas-history-rendering.md)，本轮未修改官方 Chat 或 Canvas 渲染源码。
