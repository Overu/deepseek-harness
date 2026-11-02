> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# Insight P3：恢复旧式 toggleSkill 的设计

> 历史设计记录：旧式 toggleSkill 随后已获授权并实现；下文的“未实现”和阶段状态仅描述设计时背景。当前状态以 [Integration README](../../../../../packages/insight/desktop-integration/README.zh.md)、[基线台账](../../../baseline-changes.zh.md) 和 [P6 交接](2026-11-02-dsh-insight-p6-handoff.md) 为准。

日期：2026-10-29。状态：用户已确认采用旧式 toggleSkill，进入 P3 实施；必要的当前编辑器适配与回归随本阶段完成，此前通用普通文本区间与批量编辑接口方案不实施。存在整段 setDraft 问题的自定义 Picker 不在当前产品运行入口注册，原生 `/` 技能入口继续保留。

## 旧客户端确实依赖 Core 扩展

Shell `packages/insight-desktop-integration/src/client/SkillPicker.tsx:44` 调用 `inputActions.toggleSkill(name)`。其选择状态从可见草稿推导，并屏蔽 reference occurrence 区间，不另外保存一份随下一条消息隐式发送的技能集合。

Core `packages/client/ui-conversation/src/client/contract/input.ts` 为 InputActions 增加 `toggleSkill(name: string): void`；`src/client/input/facade.ts:382` 在当前编辑器的 `projection.detectText` 上识别技能 token，再通过 `draftEditor.replaceText` / `appendText` 局部增删。旧 Core 的 reference、command chip 在 detectText 中是原子占位符，局部编辑会保留这些节点；当前 DSH 还将 Quote 映射为原子占位符，迁入时可复用这一保护。旧 `tests/selected-skills.client.spec.ts` 的断言覆盖多选、成功清空、失败保留、文件引用保留、重复 token 和 busy 拒绝，未覆盖 Quote、已释放或整次 Undo。

当前官方 DSH 没有这个扩展。新迁入 Picker 曾用 `setDraft()` 替代；该 API 明确会删除结构化引用，不是等价替代。本轮不启用该路径，也不以源码能编译来宣称专家技能多选完成。

## 建议恢复的产品行为

- 选择一个未选技能：在当前草稿末尾增加可见 `/${name} `，保留原文、空白、附件和全部原子节点。
- 再次选择：只删除普通文本中该名称的完整 token；不删除路径片段、其他技能名、reference 标签、Quote 内容或 command chip。
- 名称规则复用旧 Core helper 与现有 tool-skill 显式调用规则；不把技能内容隐藏注入模型上下文。
- 发送成功由原生提交事务清空；失败继续保留草稿。此扩展不接管提交、附件、认证或会话持久化。
- 输入非 plain 阶段或非法技能名：不修改草稿。已释放检查列入下文单独建议的安全补足。

## 最小实现方案

恢复 `InputActions.toggleSkill(name: string): void`，保持旧 Shell 的调用形式。动作在执行时同步读取当前编辑器，在 live detectText 中识别完整技能 token；不使用 Picker 先前读到的整段字符串。因此菜单显示后发生的其他输入不会被旧字符串覆盖，不需要另建异步修改协议。

恢复小型 `skillTokenSpans` helper 与 SessionInputShell 的 toggle 动作，复用当前 DSH 的 editor projection 和现有范围替换原语。对多个重复 token 按倒序删除；未选名称则在文末局部追加。旧实现逐个调用 replaceText，并未承诺整次 toggle 只占一个 Undo 步骤。

如要增加“一次 toggle、一次 Undo”的保证，需要将匹配和全部局部编辑放入包内部的一次编辑事务，并增加真实编辑器测试。这属于单独的增强建议，不纳入精确恢复旧式设计的默认范围，也不需要新增通用公开范围编辑 API。

旧 Shell 从 `InputState.draft` 识别已选名称，先屏蔽 `occurrences` 中的 reference 区间。这个读法没有完整排除 Quote；原样恢复时，技能增删可以保留 Quote，但引文里的 `/name` 可能被错误显示为已选。当前公开 InputState 也没有可供 Picker 使用的 Quote 区间，不能声称简单复制旧筛选逻辑已经解决这一点。

建议补充 `InputState.selectedSkills: readonly string[]`：它从同一次 editor projection 的 detectText 派生，不持久化、不独立存储选择状态。这个只读列表使 Picker 无需猜测坐标，也不会把引文里的 `/name` 显示为已选。它是相较旧 Core 方案的一项额外建议，不属于“原样恢复”的既有接口，尚未批准。

| 类别 | 设计 |
| --- | --- |
| 恢复旧接口和行为 | `InputActions.toggleSkill(name: string): void`；可见 token；当前编辑器局部增删；plain 阶段及名称校验 |
| 单独建议，尚未批准 | 已释放检查；一次 toggle 的重复删除作为一次 Undo；相应真实编辑器回归 |
| 额外建议，单独标明 | `InputState.selectedSkills` 派生列表，用于统一选择状态与实际编辑目标 |
| 本方案不引入 | 公开普通文本区间、通用批量编辑 API、草稿版本修改协议、隐藏技能状态 |

若采纳派生列表，Integration Picker 只读取 selectedSkills 并调用 toggleSkill。技能库存、来源分类、可调用状态、搜索、菜单和失败反馈均保留在 Insight 包，官方编辑器不接入账号服务或目录扫描。

## 预计修改范围

| 位置 | 改动 |
|---|---|
| `packages/client/ui-conversation/src/client/contract/input.ts` | 增加旧式 toggleSkill 动作 |
| `.../input/facade.ts` | 当前 projection 上同步执行、plain 阶段与名称检查 |
| `.../input/selected-skills.ts` | 保留必要的纯 token 匹配 helper，不复制旧 Core 其他输入逻辑 |
| ui-conversation tests / README | 对应语义与真实编辑器回归 |
| 强类型 InputActions 测试夹具 | 机械补齐动作，不改运行行为 |
| `packages/insight/desktop-integration/src/client/InsightSkillPicker.tsx` 及测试 | 删除 setDraft toggle，调用恢复的动作，再注册产品入口 |
| Insight 基线修改记录 | 记录官方具体文件、目的、消费者、同步基线时的复核项 |

只有另外采纳增强建议时，才增加以下范围：

| 条件 | 额外改动 |
| --- | --- |
| 采纳已释放保护 | toggle 动作增加 disposed 检查及对应测试 |
| 采纳整次 Undo | editor/runtime 增加内部事务包装及撤销测试 |
| 采纳 selectedSkills | InputState 增加派生列表，facade 发布列表，Picker 消费列表，补齐 InputState 夹具与 Quote/command 选择状态测试 |

不修改 Host、服务协议、会话格式、历史数据、标题栏、官方原生 `/` 技能入口或技能加载优先级。官方产品新增的动作只有显式调用时才发生编辑；不用这个动作的产品保留现有输入行为。

## 实施前后验证

基础恢复使用真实 SessionInputShell / Lexical editor 验证：多选与不同会话隔离；添加/移除保留文件、会话、Canvas 引用、Quote 节点及附件；重复普通 token 一次移除；保留路径片段、其他技能名和多空格；菜单打开后继续输入不会丢字；非 plain 阶段和非法名称不改稿；成功发送清空、失败保留。

若采纳对应增强，再分别验证已释放后不改稿、一次 Undo 恢复全部重复 token，以及 Quote/command 内同名文本不计为已选。仅恢复旧行为时，仍需记录 Quote 选择显示的已知限制，不能将节点保留等同于选择显示准确。

补一个真实产品组合测试，验证新 Picker 使用的是已恢复动作，完全没有 setDraft fallback。最后在 Insight 原生窗口实际操作引用加技能、取消技能及撤销，不把独立组件替身测试作为数据语义验证。

以上旧实现结论来自源码和测试断言核对，本次未在新 DSH 上运行尚未实现的 toggleSkill 回归。用户已确认进入官方输入框实现。P3 当前仍保留“专家技能分类多选尚未完成”的明确未通过项；不进入 P4。
