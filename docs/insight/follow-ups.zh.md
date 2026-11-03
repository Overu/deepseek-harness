# Insight 后续事项

[English](follow-ups.md) | 中文

## 摘要

安排客户端版本、收到缺陷反馈或更新 DSH 基线时查阅此表。事项分为未决产品取舍、验证反馈和明确排除项。阶段收口不会把未观察到的结果改成通过。

## 导航

- [更新检查修复交付](#update-check-fix-delivery)
- [插件安装策略](#plugin-installation-policy)
- [用户与平台反馈](#user-and-platform-feedback)
- [历史检查](#historical-checks)
- [打包流程优化](#packaging-optimization)
- [暂缓产品取舍](#deferred-product-choices)
- [范围排除](#excluded-scope)

<a id="update-check-fix-delivery"></a>
## 更新检查修复交付

1.0.11 已完成三平台构建及 Candidate V2 发布，旧 Shell reader、新双协议 reader 和隔离原生发现通过，未下载安装。V3 原站仍为 rc.2；用户确认已配置并刷新后，公开 CDN 仍返回 rc.1，响应头显示部分旧缓存期限和部分负缓存时间，尚未验收成功。需核对 `/desktop/candidate-v3/` 的目录缓存规则优先级及三个 `current.json` 完整 URL 的刷新任务状态，再用固定 CDN 域名复测。未访问私有控制台。执行证据见[1.0.11 记录](history/releases/1.0.11.md)。

过渡包为真实 1.0.11，仅投 Candidate V2，兼容旧 Shell V2 与新双协议 reader；Stable/V3 原站指针逐字节保持不变。后续 rc 从 1.0.12-rc.1 起，final 应用仍通过五连击手动检查内测。本地签名序列测试验证后续 V3 选择与防回放，生产下载安装仍待真实版本反馈。既有新 DSH 1.0.10／rc.1 的传输缺陷仍需一次手动安装。

<a id="plugin-installation-policy"></a>
## 插件安装策略

四个产品组件必须在执行端保护。当前管理器会拒绝安装前无法确定真实包名的来源，本地归档预检上限为 10 MiB。这保护了必需组件，同时限制部分无关第三方插件来源。

未决目标是既保留普通插件选择，又阻止替换必需组件。当前未批准绕过或放宽检查。后续需要明确接受支持来源限制，或设计不修改当前 profile 的隔离包身份识别。完整替代方案审阅前保留现有保护；理由由[基线改动](baseline-changes.zh.md)维护。

<a id="user-and-platform-feedback"></a>
## 用户与平台反馈

用户报告 macOS arm64 从 1.0.8 升级到 1.0.10 成功。macOS x64 和 Windows x64 交第三方验证。该次生产升级后的账号数据、会话、工作区、插件和设置未逐项确认；P4 副本数据验收属于另一组证据。

用户选择后续跟进，发现问题作为 bug。新客户端再次更新、下载/安装取消、网络恢复及在途任务处理仍有未观察的原生场景。收到反馈时记录平台、当前/目标版本、账号环境、复现步骤和受影响数据。不为关闭清单而恢复 qualification 阶段或要求新建测试环境。

<a id="historical-checks"></a>
## 历史检查

P1/P3/P4 历史报告中保留 Canvas 前端 fixture、额外 standalone TypeScript、固定源码 lint/路由/断言及全仓 GUI/文档检查失败。后续构建和定向测试成功不会逐项关闭它们。部分依赖分类随后已加入基线记录，旧失败次数也不能冒充当前复测结果。

当代码涉及对应范围或 CI 失败时，在当前源码复现那项具名检查，保留预期行为并修复拥有者。不得删除有效测试、放宽全局检查，或把打包成功解释为全套检查通过。Insight 界面国际化与内置技能业务正确性仍在已确认迁移范围外。

<a id="packaging-optimization"></a>
## 打包流程优化

[既有 CI 提速分析](history/shell/analysis/2026-11-02-dsh-insight-client-followups.md#提速建议与边界)保留为优化依据；随正常构建对照耗时，不为采集数据额外触发 CI。

- [ ] App 最终票据验证的 CloudKit 瞬断恢复：App 的 `stapler validate` 访问 `api.apple-cloudkit.com` 时，可能以 `NSURLErrorDomain Code=-1005`、退出码 68 失败；目前该路径没有 DMG 验证器的有界重试，导致整个 macOS job 重跑。评估复用现有的精确错误匹配和只读有界重试，不重新签名、提交公证或放宽最终验证。

- [ ] App 已被 Apple 接受但 CI 未取得结果：1.0.11 x64 第二次在 notarytool 结果获取阶段失败，随后只读 Apple 历史及详细日志确认该 x86_64 提交为 Accepted。评估保留 submission ID 与脱敏失败 journal；仅在同一制品仍存在时查询原提交并恢复等待和附票，runner 清理后仍需重跑任务。不得据此跳过附票和最终验证；[1.0.11 记录](history/releases/1.0.11.md)保存证据，本项未实施。

[rc.2 执行记录](history/releases/1.0.11-rc.2.md#源码与原-run)保留 arm64 首轮 27m33s 失败、重试 23m31s 成功的证据。当前仍按[运维恢复流程](operations.zh.md#known-failure-recovery)在原 run 重跑失败 job，复用其他平台成功产物。后续验收需覆盖目标网络错误恢复、非匹配错误立即失败及重试耗尽仍失败；涉及官方验证脚本的实现须另行明确授权，本项尚未实施。

<a id="deferred-product-choices"></a>
## 暂缓产品取舍

| 目标 | 上下文和当前结果 | 为什么未完成及触发条件 |
| --- | --- | --- |
| 友好的插件名称与简介 | 本地入口可能显示绝对路径，package-meta 方案曾被保留但未批准实施 | 出现明确显示缺陷时重议，不自动实施此前未授权的官方扩展 |
| 营销灵感库 | 用户选择保留旧测试接口和静态 fallback | 后端归属/连接仍有争议，单独决策后再改 |
| 更快恢复登录 | 隐藏窗口消除登录页闪现，凭据校验和 Home 准备仍需时间 | 有可复现耗时或失败反馈时优化，不跳过校验或新建空 Home |
| 更小的 Main 接入 | 当前产品接线分布在多个生命周期位置 | 实际同步产生冲突后评估，不提前另建客户端或框架 |
| 共享公证改动 | 跨主版本依赖升级和严格 DMG 验证重试解决不同构建失败 | 对照下一基线，等价能力已覆盖时删除本地差异 |
| Stable 投放 | Candidate 可复用 final 制品晋升 | 属于单独发布决策，授权前保持当前 Stable 指针不变 |

<a id="excluded-scope"></a>
## 范围排除

随包独立 dsh CLI 适配、Windows 全局安装兼容、旧定时任务迁移、未归属会话修补、任意旧文件导出、Insight 界面翻译、已撤回的 sidebar 位置调整和内置技能内容验证都属于范围排除，不是 P6 未完成任务。Host、Agent shell、Memory 外部 CLI、技能脚本、历史读取和 Node 仍保留各自集成所需能力。

## 开发备注

无。
