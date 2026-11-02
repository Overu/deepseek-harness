> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../README.zh.md)。

# Shell 文档入口

本目录保留现行维护资料、必要发布/故障证据及仍有效的后续设计。版本与依赖以 `package.json`、`core-runtime.lock.json` 和实际脚本为准；日期记录描述当时事实，不代表当前在线渠道状态。

## 日常开发与交付

| 需要了解 | 入口 |
|---|---|
| Shell / Core / 第一方插件职责 | [架构](architecture.md) |
| 当前可执行开发命令与平台约束 | [开发说明](development.md) |
| 变更应验证到什么阶段 | [客户端构建 Runbook](client-build-runbook.md) |
| Candidate、恢复验收和 Stable | [发布说明](release-runbook.md) · [v2 操作清单](releases/update-v2-operator-checklist.md) |
| 参考上游的定向采用 | [上游接收规范](upstream-intake.md) |
| 当前交付基线 | [1.0.9 正式发布记录](releases/1.0.9.md) |
| Core rc.2 接入进度与验证边界 | [2026-10-23 Runtime 集成记录](analysis/2026-10-23-core-runtime-integration.md) |

## 能力与专题

- [业务能力盘点](analysis/2026-10-08-business-capability-inventory.md)：源码证据与验证边界，区分客户端整包和独立插件。
- [登录及账号隔离基线](authenticated-client-baseline.md)：已实施认证约束及历史提交证据。
- [登录白名单 dev 验收](acceptance/desktop-login-whitelist.md)：测试环境启动、白名单拒绝/放行、密码兼容和请求核对。
- [模型 Gateway](model-gateway-integration.md)、[技能代理](skill-proxy.md)、[技能展示](skill-display.md)、[FE 技能代理交接](技能请求转发-FE开发交接.md)。
- [画布与 Harness 专题](discussions/canvas-harness-scheme-b/README.md)：最新插件交接、产品手测和后续模板/Skill。已完成阶段资料不再与当前计划混排。
- [本地组合开发设计](local-composed-development.md)：获批的后续命令设计；当前已实现的是 `dev` 和 `dev:local`，其他命令只有进入 `package.json` 后才可执行。
- [官方 Desktop 平台评估](analysis/2026-09-30-official-desktop-platform-assessment.md)：保留迁移研究，不代表已决定切换架构。

## 留存规则

`releases/` 保留稳定版与必要升级/恢复证据，`incidents/` 保留防止复发的故障说明，`acceptance/` 保留有效验收清单。`plans/` 仅保留尚需遵守的协议/身份/安全约束，不作为当前发布操作的替代。

已完成实施计划、重复 patch/测试日志、旧示意页面和临时源码快照已移入 [历史归档](archive/README.md)。包含清理前未提交内容的原始字节，按 manifest 可恢复；不要把旧阶段“待实现/待验收”当成当前状态。

随产品分发的 `bundled-skills` 文档属于业务资产，独立维护，不纳入此次工程文档裁剪。新增记录优先更新现有入口，避免重复创建长期维护说明。
