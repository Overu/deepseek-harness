> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# Desktop Bundle ID 首发规范

2026-09-09：用户已确认按自有域名 `insight-aigc.com` 统一应用身份；本次仅修改 Bundle ID，不改签名机制。

| 用途 | Bundle ID / electron-builder appId | 产品名 | userData 目录名 |
| --- | --- | --- | --- |
| Candidate / Stable | `com.insight-aigc.desktop` | `因赛AI` | `insight-desktop` |
| DEV | `com.insight-aigc.desktop.dev` | `因赛AI Dev` | `insight-desktop-dev` |

## 决策与边界

- 选择首发前一次性规范命名，而不是保留旧前缀或给 Candidate 再增加第三套身份；Candidate/Stable 仍由构建元数据区分更新渠道。
- Bundle ID 不是网络域名，不新增 DNS，不改变登录 Gateway、模型 Gateway、更新 Origin 或 OSS 路径。
- 修改三个打包配置的 `appId` 与包内 `insightDesktopAppId`。Helper 的 Bundle ID 由 electron-builder 从主 App ID 派生，不直接改生成包的 Info.plist。
- 保留产品名、npm 包名、安装包命名、数据路径和 DEV 的临时认证行为。签名证书、Team ID、公证和系统钥匙串均不在本次修改范围。
- 现有运行时代码对缺少渠道字段的旧内部包有 `com.insight.desktop` 兼容识别；保留这段既有行为并明确标为历史兼容，它不会使新包继续使用旧 ID，也不代表支持跨 ID 自动升级。
- 旧内部测试包、签名和验收记录保留原值，注明已被新身份规范取代。不修改已生成或已安装的 `.app`，不重用或覆盖已发布 tag/资产。
- 首次对外发布前必须重新生成新身份 Candidate，验证主 App/Helper IDs、签名、登录连续性和新身份下 N→N+1。旧 Bundle ID 的包不能充当该升级起点；已有钥匙串条目不会因为改 ID 自动修复，不删除任何用户数据。
- `appId` 同时影响 Windows NSIS 默认安装 GUID（当前 electron-builder 由 `appInfo.id` 派生）；Windows 旧内部包也不能直接视作同一安装身份。本次不增加跨 ID 迁移或自动卸载逻辑。

## 验证

自动测试加载实际三个构建配置，验证正式/Candidate ID 相同、DEV 隔离、打包 ID 与元数据一致、名称及签名策略不变；验证两套新 ID 的显式渠道路由及旧兼容行为。执行定向测试、全量测试、类型检查与生产代码构建。

本次不签名、不公证、不启动候选包；包内身份和真实系统行为保留为下一次 Candidate 构建的人工门禁。当前规范同时写入发布/构建 Runbook，历史方案只增加时间顺序说明。
