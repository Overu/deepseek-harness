> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# Canvas 历史引用渲染修复设计

日期：2026-11-02。状态：用户已授权可控的官方修改；完整消息行 Factory 与 Canvas 接入已实现，定向注册回归、构建及记录会话 Web 回放均已通过。开发模式更新误报已修复并完成本机复核。范围：恢复历史用户/追问消息中 `<node-refs version="1">` 的原 Canvas 引用展示；修复源码开发模式的更新检查误报。不修改会话格式或原始数据，不恢复已撤回的 sidebar 位置调整。

## 已确认的问题

版本追溯：DSH `635d9c88f6`（2026-10-28，Liveshare #6749）引入消息来源 chain；提交时源码版本为 `0.2.2-alpha.1`，首个包含它的现有标签是 `dsh-v0.2.2-alpha.2`。Core 本地与远端 master 均为 `90e7d68e54`（2026-10-23），DSH 基线为 `0.2.1-rc.2`，尚无该变化。因此原包装方案在 Core 中成立，故障是迁入新基线时的兼容适配遗漏。

迁入的 Canvas 已保留原有标签解析、缩略图、悬停预览和点击定位代码。问题在渲染接入：它从 `conversation.chat.node` 取得原生 user/steering component，再用新注册的 wrapper 直接调用该 component。当前 DSH 原生用户消息依赖由自己的 entry 声明的 `conversation.chat.user.before` 子插槽，wrapper 不拥有该声明，因而没有对应 `renderSlotChain`。调用失败后，DSH 将 wrapper 退位并使用原生 renderer，原始标签随后作为普通正文显示。

已用真实 `SlotTestRuntime` 临时探针复现：native renderer 声明 before chain，Canvas wrapper 调用它时发生 `renderSlotChain is not a function`，最终 winner 回到原 native entry。该探针测试已通过并清理；它验证注册与回退机制，不替代真实用户样本的完整历史验收。P4 隔离副本中的 26 个历史日志未找到 node-refs 样本，没有读取或改写真实来源会话。

现有纯组件测试用假的 NativeMessage 和手工 props 调用 wrapper，没有经过真实插槽绑定，因此未暴露这个问题。

## 已实施方案

把现有原生完整用户消息行提供为 session-scoped Factory：`conversation.chat.user.message`。它复用原有正文、附件、时间、复制和消息来源展示，不新写一套消息 UI。Factory 拥有原来的 before chain；官方 user/steering entry 及 Canvas wrapper 都通过框架调用它。

```text
历史 user/message → DSH 当前会话视图
  → Canvas user/steering wrapper
      → 原有 splitNodeRefs 校验并提取有效标签
      → 原有附件、节点缩略图、悬停预览、点击画布定位
      → conversation.chat.user.message Factory（过滤后的显示副本）
          → DSH 原生消息正文/来源/时间/复制操作
```

仅显示副本去除合法协议段，原日志和模型可见原文不改写。保留未知版本、损坏或无效协议的原文，避免误吞普通文本。沿用原 Canvas 标签规则与校验，不顺带放宽协议。steering 仍不显示 user before chain，pending/echo 不进入这个新 Factory。

## 已授权的官方源码

| 文件 | 最小改动 |
| --- | --- |
| `packages/client/ui-chat/src/client/contract/slots.ts` | 增加 Factory 定义与只包含 node/loadImage 的消息行输入类型 |
| `packages/client/ui-chat/src/client/chat/MessageItem.tsx` | 由内部 Factory component 复用完整 durable 消息行；现有 keyed component 改为薄委托 |
| `packages/client/ui-chat/src/client/chat/register-node-renderers.ts` | 注册 Factory，把既有 before chain 的声明归属移入 Factory，保留 user/steering 入口 |
| `packages/client/ui-chat/src/client/index.ts` | 仅导出新增输入类型，不公开业务 component |

更新官方注册结构测试，新增 Canvas 真实注册回归，并同步 ui-chat 与 Slots 的现有双语文档、生成 slot catalog 和 Insight 基线轨迹。既有消息组件测试保持原调用方式。Canvas 自有修改留在 `packages/insight/canvas`，同步父仓补丁与源码回放。无需修改 ui-slots、ui-renderer、Session、Agent loop、Assistant 或 sidebar。

Canvas 直接以优先级 -1 注册 user/steering 包装层，不查找或调用原生 component，避免插件先后加载顺序导致注册失败。卸载后由框架恢复原生 entry。

现成的正文 Factory 没有整行的来源、时间和操作，行内文本扩展不能保持原布局及复制行为；当前 keyed slot 没有“下一个 renderer”接口。不会通过空 before callback 丢掉原能力，也不会放宽插槽所有权或增加通用 wrapper 框架。新增一个可复用 Factory 是本方案的持续维护成本。

## 验证要求

- 使用真实原生注册与 renderer，验证旧历史 user/steering、有效标签缩略图/预览/定位、普通正文、附件和复制行为。
- 断言 wrapper 不报错或退位、原消息内容不变、无重复附件/操作，before contributor 和卸载恢复保持正常。
- 保留无效/未知标签原文；不把构建、替身测试或截图视为已经完成云端业务验收。
- 同步类型、源码回放、生成目录、定向测试、构建和最终独立审查；不触发 CI、打包或 OSS 发布。

## 开发模式更新误报

已在 Insight 自有 `insight-updates.ts` 修正：unpackaged 模式跳过自动检查；菜单或工作区入口手动打开更新时，显示“开发模式不检查客户端更新，请使用已安装版本”的原生信息提示。开发模式不打开更新窗口、不下载或安装更新。正式包仍执行原有检查，缺少更新源仍是错误，不捕获或放宽其校验。

开发模式更新修复只涉及 Insight 适配文件及其现有测试，不修改官方 coordinator。Canvas 的后续授权实施严格限定于上述四个官方源码；引用解析协议、Session 格式及记录数据均不变，原 Canvas 仓库未修改。

## 本轮完成验证

开发模式更新适配的现有测试扩展后共 9 项通过，覆盖自动检查跳过、两种更新入口、提示、释放和正式包缺来源错误继续暴露。产物构建八项通过，补正测试 mock 类型后，Host/Client aggregate check 两项通过。两份改动源码/测试的 scoped oxlint、README 具名配对与 `git diff --check` 通过。

以独立 `/private/tmp/insight-dev-update-check-20261102` userData 执行 `pnpm dev:insight --skip-build`，客户端成功启动；启动及菜单检查后没有出现所报 `Insight update failed`。原生“检查更新”显示“开发模式不检查客户端更新，请使用已安装的发布版本检查更新”，关闭后仍为未登录页面。未填写账号或接受协议，测试进程已关闭。

## Canvas 修复验证

- 最新 `pnpm run build`：10/10 通过，包括 Host/Client 编译、bundle、Web build 与聚合类型检查。
- 定向真实注册回归：Canvas 6 项及官方 Factory 注册/释放结构 2 项通过。覆盖 Canvas-first 与 Chat-first、有效引用预览和定位、原生复制、来源装饰、steering、文件、授权图片加载、无效标签及卸载重挂；消息对象序列化前后相同。
- 原有 Canvas 标签、消息注入及 SDK 兼容测试：23 项通过。
- 修改文件 scoped oxlint、导出 JSDoc、Agent Note 格式、5 组具名文档配对及 `git diff --check` 通过；Client catalog 已重新生成，父仓 Canvas 补丁从固定归档回放通过。
- 全量 `test:gui` 未通过：700 个文件中 505 通过、195 失败；存在 React 18/19 混用异常及空 DOM。用未修改的 HEAD `MessageItem` 与原 `user-origin-slot` 测试运行临时探针，同样 3/3 失败，探针已清理。本轮不调整全仓 React 依赖，不能宣称全量 GUI 门禁通过。
- keyless recorded-session Web replay：新增 `apps/web/tests/canvas-history.e2e.ts` 与 `snapshots/web/canvas-history` 合成 Session fixture，真实 Web profile 挂载 Canvas Host/Client，仅账号凭证由测试插件提供。refresh 与只读 replay 各 2 项通过；有效引用显示卡片，损坏标签保持原文，打开界面前后的原始持久化事件前缀逐项全等；只允许框架独立追加 `session/end-seed` 标记，原消息不变。无需真实登录或模型 Key。
- 独立审查已完成，加载顺序、测试隔离及单一清理所有权问题均已关闭，无剩余实质发现。
- 未在用户真实旧会话上完成原生界面复核；隔离旧样本未包含该标签，自动化使用合成样本，不改写用户目录。

官方修改轨迹位于 DSH `docs/subsystems/insight-baseline-changes.md`；持久设计依据位于 `.agents/notes/implemented/architecture/2026-11-02-durable-user-message-factory.md`。当前消息行复用是公共 Factory，后续同步基线需复核其输入、来源链所有权和真实注册/记录会话回归。

该段修复实施时未改写历史会话。随后已提交，并随 `95c1477d080ef88330ef961f41042cedba627fd5` 构建的 1.0.10 完成三平台 CI 和 Candidate 投放；当前发布状态见 [P5 收口](2026-10-30-dsh-insight-p5-delivery.md)，真实用户旧引用消息的原生复核仍待反馈。
