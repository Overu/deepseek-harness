# Insight 历史证据

[English](history.md) | 中文

## 摘要

P6 已于 2026-11-03 结束。[收口记录](history/p6-closeout.md)固定本次交付和移交状态。需要了解某次迁移决策、验收或故障的原始背景时，再按下表读取对应记录；历史不是现行操作指引，[当前文档](README.zh.md)维护产品说明。

## 按问题定位证据

| 问题 | 冻结来源 |
| --- | --- |
| P6 何时结束，源码与安装包以什么为准，遗留项如何移交？ | [P6 收口记录](history/p6-closeout.md) |
| 为什么从 Shell/Core 迁移，当时看重哪些能力？ | [能力盘点](history/shell/analysis/2026-10-08-business-capability-inventory.md)、[执行设计](history/shell/analysis/2026-10-28-dsh-insight-execution-report.md) |
| 固定源码、必需组件和技能如何确定？ | [P0](history/shell/analysis/2026-10-28-dsh-insight-p0-design.md)、[P1 交付](history/shell/analysis/2026-10-28-dsh-insight-p1-delivery.md) |
| 登录、托管模型和原生界面实现到哪？ | [P2 交付](history/shell/analysis/2026-10-29-dsh-insight-p2-delivery.md)、[P3 验收](history/shell/analysis/2026-10-30-dsh-insight-p3-acceptance.md) |
| 为什么改这些权限、技能和消息渲染？ | [权限矩阵](history/shell/analysis/2026-10-29-dsh-insight-permission-design.md)、[技能设计](history/shell/analysis/2026-10-29-dsh-insight-toggle-skill-design.md)、[Canvas 历史引用](history/shell/analysis/2026-11-02-dsh-insight-canvas-history-rendering.md) |
| 旧账号历史如何保留？ | [P4 交付](history/shell/analysis/2026-10-30-dsh-insight-p4-delivery.md)、[只读盘点](history/shell/analysis/2026-10-30-dsh-insight-p4-readonly-inventory.md) |
| 哪次构建、Candidate 上传和旧客户端检查成功？ | [P5 交付](history/shell/analysis/2026-10-30-dsh-insight-p5-delivery.md)、[发布执行记录](history/shell/analysis/2026-11-02-dsh-insight-stable-release.md) |
| 1.0.11-rc.1 的源码、构建结果和剩余发布工作是什么？ | [Candidate 执行记录](history/releases/1.0.11-rc.1.md) |
| 为什么 rc.2 已打包发布，CDN 更新发现仍被阻塞？ | [rc.2 发布与缓存诊断](history/releases/1.0.11-rc.2.md) |
| 1.0.11 内测过渡如何覆盖旧 V2 和后续 V3 更新？ | [1.0.11 过渡记录](history/releases/1.0.11.md) |
| 进入 P6 前审阅了哪些官方改动？ | [逐文件清单](history/shell/analysis/2026-11-02-dsh-insight-p6-preflight-review.md)、[P6 交接](history/shell/analysis/2026-11-02-dsh-insight-p6-handoff.md) |
| 原 Shell 发布协议是怎么做的？ | [旧发布手册](history/shell/release-runbook.md)、[V2 操作清单](history/shell/releases/update-v2-operator-checklist.md)、[1.0.9 证据](history/shell/releases/1.0.9.md) |

## 迁入范围与追溯

快照包含 Shell docs 树的 201 份文件，其中 96 份 Markdown，覆盖分析、验收、发布证据、旧操作说明、Canvas 讨论和已有历史 ZIP。保留签名证据原有的 .gitattributes，迁入文件集合与来源提交 docs 树一致。[导入清单](history/import-manifest.json)记录来源仓库和提交、新旧路径、原始/迁入 SHA-256、字节数及全部链接调整。

JSON、签名、文本证据和原 ZIP 保持原字节。Markdown 增加冻结状态说明，调整导航、段落换行和尾空白；原结论及失败记录保留；旧 Shell 的 TypeScript 片段明确标为历史未检查示例，不要求在当前 DSH 上编译。历史目录的 Git 属性禁止换行归一化，执行中的检查逐项核对导入文件集合、大小与摘要。未迁入的旧源码或本机构建日志改为链接到明确的历史源码位置，原目标同时保留在清单中，不为让历史链接可点击而复制旧运行时源码。

当前基线记录维护理由和同步影响，冻结的审阅清单保留当时逐文件/提交比较。来源摘要用于确认迁入内容，不代表安装包内容；已发 1.0.10 制品源码和更晚的双 reader 源码仍在原发布记录中分开说明。

## P6 检查记录

下表保留原文档迁移时的检查范围和次数；本次阶段收口及功能源码证据见[收口记录](history/p6-closeout.md)，不混用不同阶段的测试统计。

| 检查 | 本阶段实际结果 |
| --- | --- |
| 文档检查单元测试 | 4 文件、187 项通过，含历史篡改/缺失/新增/越界/重复/软链接拒绝、忽略本地元数据和相邻目录拒绝 |
| 汇总类型检查 | build:check 的 Host/Client 两项通过，使用现有产物，未重新打包 |
| 文档与导航 | 121 份 Markdown 的链接、锚点、换行与结尾检查通过；14 组具名双语配对通过；Mermaid 解析通过 |
| 来源与字节 | 201/201 份文件对照原 Shell 提交摘要一致；迁入及暂存摘要一致，原始签名不改写 |
| 旧入口 | Shell 的 34 页导航、101 个跨仓 URL 形式及本地目标核对通过；远端可用性以文档提交推送后为准 |
| 完整 doc-sync | 41 项通过、2 项未通过；仍为 Python uv.lock 提交引用和同步技能/固定源码/补丁的既有用词问题，本次未修改相关业务内容 |
| 产品验证边界 | 未重复原生安装、真实付费生成或远端构建/发布，不把本阶段文档检查当作产品全量回归 |

历史目录的配对、提交证据、旧包路径和原字段规则例外均已逐项获得授权；文件集合/摘要验证仍执行。此前 Desktop 打包 README 的旧配对记录已重新确认，旧 Shell 专属代码片段使用明确的历史示例标记，子系统 API 导航已恢复；这些本阶段发现已关闭。剩余两项全仓失败按[后续事项](follow-ups.zh.md)保留事实，不新增全局豁免。

## P6 决定与限度

P6 只读消费者盘点确认 Canvas legacy UI、源码补丁、必需组件、安装兼容测试和官方 DSH 更新工具仍在使用，全部保留；没有依据追加删除受版本控制的运行代码。现行架构和基线页面集中到本目录，包 README 保留在代码旁，生成账号 API 保留在生成器拥有的子系统路径。旧子系统 URL 只保留简短导航。

用户已明确批准仅历史目录的配对及提交证据规则例外，允许/拒绝矩阵测试已通过；相邻目录和组织 URL 仍受检查。其他历史或基线检查失败按实际检查结果记录，不能以该例外视作全部门禁通过。本次文档工作未构建、发布、改动用户数据或合并新版 DSH 基线。

## 开发备注

无。
