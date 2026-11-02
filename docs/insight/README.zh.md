# Insight Desktop 文档

[English](README.md) | 中文

## 摘要

维护 Insight Desktop、理解 DSH 接入或排查迁移问题时，从这里开始。按当前问题选择一篇文档；冻结的 Shell 报告用于追溯证据，不要求按时间顺序全部阅读。

## 按问题查阅

| 你遇到的问题 | 从这里开始 |
| --- | --- |
| 迁移了什么、保留了什么、哪些不在范围内？ | [迁移总结](migration-summary.zh.md) |
| 登录、账号数据、Host 和插件如何连接？ | [架构](architecture.zh.md) |
| 为什么修改官方 DSH 文件，更新基线时要保住什么？ | [基线改动](baseline-changes.zh.md) |
| 如何开发、构建、发布，或处理踩过的坑？ | [操作手册](operations.zh.md) |
| 还有什么没完成，为什么留下，何时再处理？ | [后续事项](follow-ups.zh.md) |
| 哪份原始报告或验收记录支撑这个决定？ | [历史证据](history.zh.md) |

## 文档归属

本目录维护 Insight 产品决策、迁移结果和维护说明。包 README 维护各包行为与配置；[发布脚本](../../scripts/insight-release/README.zh.md)维护发布协议；[生成的子系统 API](../subsystems/insight.zh.md)维护账号服务 API。文档之间用链接连接这些所有者，不复制实现明细。

现行页面保持双语维护。冻结历史保留记录日期时的原始语言、决策和测试结果。历史失败只有在后续记录关闭后才算关闭；待验证不等于缺少实现。

## 开发备注

无。
