# Insight 迁移总结

[English](migration-summary.md) | 中文

## 摘要

P6 已于 2026-11-03 完成收口，迁移任务暂告一段落。Insight 已将产品能力接入 DSH 原生 Desktop 工作区，退出旧 Shell/Core 运行链。当前功能源码与已发布 1.0.11 安装包存在已记录差异；[交付状态](operations.zh.md#current-delivery-state)区分两者，[后续清单](follow-ups.zh.md)承接下一版本、bug、验证反馈和产品决策。阶段结束不表示遗留问题全部修复或所有平台完成原生验收。

## 阅读指引

- [结果与产品范围](#result-and-product-scope)
- [数据和发布证据](#data-and-release-evidence)
- [退役取舍](#retirement-decisions)
- [维护交接](#maintenance-handoff)

<a id="result-and-product-scope"></a>
## 结果与产品范围

| 范围 | 结果 |
| --- | --- |
| 客户端 | Insight 品牌、登录、协议弹窗、账号菜单和设置；采用 DSH 原生工作区和标题栏策略 |
| 认证和模型 | Main 持有认证和账号 Home；Host 受控请求凭据；托管模型路由不要求用户配置 token |
| 必需组件 | Integration、Canvas、Memory、Prompt 均作为产品必需，随客户端统一更新；保留内部功能开关 |
| 业务源码 | Canvas 放入 packages/insight；Memory、Prompt 使用固定快照和父仓可回放补丁，不用 submodule 或独立 git 更新 |
| 技能 | 保留根 bundled-skills 结构和同步形式，接入运行时发现及打包目录资源；未评估技能业务正确性 |
| 历史数据 | 复用 Shell userData 和账号 harness 目录，不导入、转换、合并或另建迁移状态机 |
| 打包与发布 | DSH 打包和唯一 updater；GitHub Release 构建与 OSS/CDN 发布分开；支持 final 和 rc Candidate |

随包独立 dsh CLI 不属产品。这不排除 Agent shell、Memory 外部 CLI、技能脚本及其 Node 运行时。其他明确排除项为 Insight 界面国际化、Windows 全局安装兼容、旧定时任务兼容、未归属会话修补、独立任意历史文件导出工具。已撤回的 sidebar 位置调整继续保持撤回。

<a id="data-and-release-evidence"></a>
## 数据和发布证据

P4 使用旧账号数据隔离副本：22 个会话可读取，两个工作区及选定历史消息在首次登录和重启后仍可见，记录的原始日志摘要不变。这些证据覆盖测试副本，不等于每个生产账号或全部旧记录继续生成都已验证。

最终 1.0.10 制品完成三平台 CI、macOS 签名/公证和 Candidate 发布。已发布 Shell reader 对三个 CDN 目标验证通过。用户报告 macOS arm64 从 1.0.8 升至 1.0.10 成功；其他平台待第三方反馈，生产数据保留未逐项确认。该次投放仅使用 Candidate；当前渠道状态由操作手册维护。

已发布的 1.0.11 Candidate 完成旧 Shell V2、当前双协议 reader 及隔离 Electron/MacUpdater 的发现检查；后续用户反馈更新已恢复可用，未形成新的全平台或数据逐项验收矩阵。更晚提交的更新确认体验修复尚未进入安装包。精确源码、制品与证据边界见[交付状态](operations.zh.md#current-delivery-state)和[收口记录](history/p6-closeout.md)，V3 CDN 等未关闭问题见[后续清单](follow-ups.zh.md)。

<a id="retirement-decisions"></a>
## 退役取舍

消费者盘点未发现当前运行时仍依赖 insight-desktop-shell、insight-harness-core 或 insight-workflow-op。旧 workflow 执行方案由 Canvas 替代。P6 没有发现可进一步安全删除的受版本控制运行实现，因此本阶段不为清理而制造代码删除。

| 项目 | 决定与理由 |
| --- | --- |
| Canvas canvas-app/legacy | 保留：当前入口、alias、编译输入及测试直接消费这些源码 |
| 固定快照、upstream.json 和父仓补丁 | 保留：用于重建已审阅业务源码及适配 |
| Windows 旧安装器回归 | 保留：覆盖旧注册目录中因赛AI.exe 的升级 |
| 官方 DSH installed-update 工具 | 保留：属于上游工具，不是已移除的 Insight Windows qualification 阶段 |
| 发布记录中的 qualification | 保留：它区分 distribution/debug-signed 制品，不是安装测试 job |
| 本机 .desktop-build 输出 | 保持为构建输出：已忽略且可能保存验收证据，不属于受版本控制的废弃实现 |

不删除旧 Shell/Core 仓库或用户目录。新仓作为唯一发布者期间，旧发布入口保持停用。文档退役集中现行说明，将旧迁移报告入口改为链接；历史结论保留为可追溯证据。

<a id="maintenance-handoff"></a>
## 维护交接

[基线记录](baseline-changes.zh.md)说明必要产品接入、共享 API 变化、同步成本和实现取舍。[操作手册](operations.zh.md)记录成功恢复方式，不增加打包阶段。[后续事项](follow-ups.zh.md)保留未决策略和验证债务及其原始上下文。

P6 的消费者盘点、退役取舍、201 份 Shell 文档迁入、按问题查阅入口、官方差异理由及构建/发布经验已交付。现行基线记录包含最近的安装确认修复，未验证、暂缓及排除项已明确移交。[收口记录](history/p6-closeout.md)确认阶段结束；后续源码修改、基线同步、打包或发布按独立任务授权，不作为未结束的 P6 工作继续扩展。

## 开发备注

无。
