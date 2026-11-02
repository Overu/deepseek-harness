> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../../README.zh.md)。

# 画布与 Harness 专题

当前基础：独立画布Plugin的核心能力已完成初步人工验收，alpha.20已初步验收；最新alpha.22下载兼容候选已通过自动回归、隔离Electron保存与实际包安装，真实账号与界面手测待进行。业务执行由Plugin常驻Client服务复用原生Store/保存队列；Core和后端业务不改，Agent无需打开画布即可操作。历史方案不作为当前接口说明。

## 当前交接

- [alpha.22客户端下载修复](implementation/2026-10-16-alpha22-download-compatibility.md)：修复CSP阻断后外开浏览器的问题；单资源、ZIP及分镜下载，含真实隔离Electron字节验证和无需生成的手测。

- [alpha.21批量整合交接](implementation/2026-10-16-alpha21-batch-integration.md)：同步最新main，修复提交前错误、统一单/多回执与超时终态、恢复拖线预览；含包与自然语言手测。

- [alpha.20真实素材导入修复](implementation/2026-10-15-alpha20-fake-ip-import-fix.md)：定位并修复Fake-IP导致的下载拦截；原图只读下载及字节比对通过，含最短原对话复验步骤。

- [alpha.19指引与素材复用交接](implementation/2026-10-15-alpha19-guidance-and-media-reuse.md)：八工具指引收敛、远端图片来源、自动关联与单节点生成；含自然语言手测。候选包通过隔离验证，实账对话验收待进行。

- [首版桥梁审核与清理](implementation/2026-10-15-plugin-first-submit-review.md)：职责、生命周期修复、冗余清理与本地提交范围。
- [alpha.18验证摘要](implementation/2026-10-15-alpha18-checks.json)：261/330回归、类型、隔离安装与实际归档；人工验收和自动化证据分开。
- [成果卡片手测](implementation/2026-10-14-alpha17-manual-acceptance.md)：该展示/导航步骤继续适用于alpha.18，无需重复生成素材；完整工具验收以Plugin当前 `docs/acceptance.md` 为准。
- 当前模块/公开契约/开发规范由独立 `desktop-canvas-plugin` 仓库README及docs维护，本专题不重复维护一套API。

## 仍有效的后续方向

- [指引中心与对话素材复用计划](plans/2026-10-15-canvas-guidance-center-design-and-plan.md)：统一行为指引、按需加载、复用现有八工具；研发已形成alpha.19手测候选；该计划保留alpha.19阶段范围；现行批量能力以alpha.21交接为准，模板仍暂缓。

- [模板与Skill下一步](next-steps.md)：继续暂缓，未自动进入研发。
- [业务调研输入](research/2026-10-09-canvas-harness-integration-research.md)、[旧潮流视频模板参考](plans/2026-10-10-canvas-skill-3c-trendy-design.md)：保留场景和素材参考，参数/旧方法不作当前实现承诺。
- [插件优先的设计依据](research/2026-10-14-canvas-result-entry-plugin-first.md)：保留Core频繁升级与将来平台迁移的取舍来源；实施状态以首版审核为准。

任务1–4及alpha.12–17已完成阶段的计划、逐版手测、重复patch/日志/源码快照、旧可视化和插件旧文档备份已集中至 [历史归档](../../archive/README.md)。所有清理前未提交原始内容按hash保留，可按manifest恢复；旧记录中的“尚未接入生成”或“当前验收入口”不覆盖此页。
