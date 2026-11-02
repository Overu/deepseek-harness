> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# 专家技能双页签与全局发现设计

日期：2026-10-26。最终方案为 Shell 公开 API 实现。分支 codex/skill-catalog-design-review，基线 f6c0ff6。

## 已确认范围

- 搜索下增加“平台预置”（每次打开默认）与“用户自定义”。
- 产品继续提供 ui.json，平台索引从实际包生成。
- 用户范围为共享 agentsHome/skills 与当前账号 DSH_HOME/skills。
- 对话或外部安装后无需重启；项目级及其他工具专属根不纳入。
- 不增加市场、云同步、安装/卸载中心。
- Core 源码、Runtime lock、其他插件与服务端不改。

## 最终架构

```text
平台包 / 两个用户根
  → 公开 FileSystemSkillProvider（只读，不注册执行）
  → Shell 安装观测 + 有界 ui.json 读取
当前 session / preset → 原生 skills.snapshot（真实胜出结果）
  → desktopSkills.list({sessionId}) Remote
  → 来源页签 → 原生 toggleSkill(name)
```

此前将新增 Core 接口视作前提的方案已撤回。公开 API 与真实夹具证明本期无需维护 Core。Shell 不访问私有字段、不为清缓存注册 provider、不复刻执行优先级。

ui.json 的交付校验、索引、来源与刷新细则见 [技能展示](../skill-display.md)。

## 覆盖与异常

| 情况 | 行为 |
| --- | --- |
| filesystem 定义胜出且允许手动调用 | 可选 |
| 用户覆盖平台 | 平台保留禁用项，用户有效项可选 |
| 两个用户根同名 | 合并一行，优先真实胜出者 |
| 项目/插件/未知 provider 胜出 | 全局候选禁用 |
| preset 不挂载全局根 | 仍显示安装项，当前模式不可用 |
| userInvocable=false | 可见、不可手动选择 |
| 读取不完整或失败 | 保留旧数据、未确认、禁用 |
| 已知入口更新中/无效 | 保留禁用项，恢复后可选 |
| 原入口删除 | 两次确认、间隔至少 500ms 后移除 |

origin 来自 Host 观测根，不采信包内自报。符号链接按原入口分类和确认删除；规范路径只用于匹配真实胜出者。Remote 不传路径。

## 交互与边界

页签使用 tablist/tab/tabpanel。搜索只过滤当前来源，切换保留关键词，重开清空。支持方向键/Home/End、搜索上下/Enter、Esc，不拦截 IME。弹层适应视口，列表滚动，轮询不抢焦点。

打开、skills/change、focus 刷新；可见期间每 2 秒读取；关闭停止轮询。合并并发，丢弃旧会话结果，sidecar 单独变化也生效。

跨页签只计可用项，不改草稿；菜单选中的项失效时提示。按执行时当前定义调用，不锁定包版本；原生失效指令跳过注入继续消息，不声称拦截提交。

实施见 [计划](../superpowers/plans/2026-10-26-shell-skill-tabs.md)，证据与操作见 [验收](../acceptance/insight-skill-picker.md)。真实 Agent/模型业务、Windows/macOS Intel 和安装包仍需独立验收。
