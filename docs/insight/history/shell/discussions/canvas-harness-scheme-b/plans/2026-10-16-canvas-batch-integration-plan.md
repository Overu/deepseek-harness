> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../../../README.zh.md)。

# Canvas Batch Integration Implementation Plan

**Goal:** 保留远端9f62992的批量能力，修复已审查的错误状态、回执不一致、预览丢失与指引/验收漂移，形成alpha.21手测候选。

**Architecture:** 沿用稳定Shell/Core与独立Plugin。节点/边ops仍逐项原生保存；单节点node.run和多节点workflow.run保留提交差异，共用Host预检/确认/Job跟踪。Client预提交错误明确not_sent，真正提交未知继续防重。行为规则仅在现有Skill中心，工具保留事实。

**Tech Stack:** 当前TypeScript/Cordis公开SDK、原生Store/guard/barrier、Node测试与Vitest、现有构建及隔离Profile。

## 约束

Core、后端不改；不新增业务工具或DAG/模板运行器。保留新ops[]/nodeIds[]接口；本轮明确迁移而不重新开放旧action/nodeId，重启Harness并使用新工具目录。保留批量部分保存、容量暂停、30图/6视频真实确认、未知不重发、来源绑定和用户编辑保护。预存Windows草稿及已交付alpha.20包保持不变。本轮不推送或实际付费生图。

## 步骤与验收

1. 已快进同步main到9f62992，工作分支codex/canvas-batch-integration；记录改动范围，保留无关文件。
2. 修改canvas-app/src/agent-workflow-runner.ts及agent-generation-integration测试：容量502/超时用例先复现invoke=0却unknown/锁定，再修为rejected/effect:none、tracker释放、可以重预检；实际invoke失联仍unknown。只在需要时改agent-adapter。
3. 修改src/host/canvas-run-tools.ts和test/canvas-run-tools.test.mjs：直接断言公开results回执；单/多使用相同顶层status/version/jobId，零提交拒绝、unknown保留实际null；一套Job订阅/取消/终态/来源；保留单/多提交适配、数量确认与paused续跑。
4. 恢复canvas-app/legacy/src/components/canvasFlow/index.tsx的MultiConnectionPreview渲染，不改变新增侧栏配置及原生拖线逻辑；手测多选拖线预览及两侧菜单。
5. 更新guidance/desktop-canvas-workflow索引和四章：ops保存、独立目标批量、上游产物就绪边界、partial/paused/nextIndex、Job和恢复；manifest描述与工具短事实一致。工具无流程教程，deferContext只JSON事实；维护guidance与契约回归。
6. 更新scripts/verify-isolated.mjs（实际包验证与业务夹具分开）：检查真实ops变体、nodeIds、放置及权限边界；单/双目标操作、边和失败回执在工具/原生集成夹具中验证；实际包安装在未登录隔离Profile，检查目录/Skill/路由并通过官方工具执行验证旧入参在业务前被拒绝，不提交真实保存或生成。若需要提取纯目录断言，只提最小验证模块并测试。
7. package/lock升alpha.21，README/docs/protocol/development/acceptance同步当前边界与迁移。旧alpha.20归档hash不变。
8. 定向回归后运行根全量、native test:agent、插件/实际SDK/未使用项类型、Web9条冻结基线比对；独立review。构建alpha.21、审计包白名单/资源/字节，隔离安装八工具/Skill/章节/来源/卸载。
9. 保存检查摘要和交接，给出自然语言批量创建/修改/连线、双图生成、只搭不生成、拖线和结果入口手测。将自动夹具与真实账号结果区分，本轮不宣称实账已验收。

## 执行结果

上述步骤已完成，形成alpha.21未提交工作树及发行归档。独立review补齐超时Job的逐节点快照后复核关闭；322根测试、340原生测试、实际SDK及未使用项检查通过，Web9条基线一致，实际包隔离安装/卸载通过。手测、客户端安装与推送未执行。详见[研发交接](../implementation/2026-10-16-alpha21-batch-integration.md)。
