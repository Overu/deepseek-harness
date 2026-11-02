> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# Insight P5 交付与收口报告

日期：2026-11-02（Asia/Shanghai）。状态：按用户最新范围收口，可以进入 P6。三平台构建、GitHub Release 和 Candidate OSS 投放已完成；macOS arm64 的 1.0.8 → 1.0.10 原地升级已有用户成功反馈。其余平台、数据逐项核对和更新恢复场景由后续验证反馈，有问题按 bug 处理，不作为 P6 入口门槛。未验证不等于已通过。

## 1 交付范围与版本

| 项目 | 交付状态 |
| --- | --- |
| 产品版本 | 原 Shell 1.0.9 为基线；当前投放为最终版本号 1.0.10，渠道为 Candidate；DSH runtime 独立为 0.2.2-alpha.2 |
| 安装包源码 | `95c1477d080ef88330ef961f41042cedba627fd5`；复用已构建制品，没有为发布器修复重建或替换同版本安装包 |
| 发布器及客户端后续源码 | `a7088fdb63c0d04499fdf4d50ae31d0e73b40b0f`；该提交是本次文档收口前的源码基线，不代表已发包包含全部后续改动 |
| GitHub 构建 | [run 41398407561](https://github.com/Overu/deepseek-harness/actions/runs/41398407561)，三个目标成功，Release 十五个附件；macOS 两架构签名、公证及最终验证通过；Windows 按产品决定不签名，runtime smoke 和 NSIS 构建通过 |
| Release | [insight-v1.0.10](https://github.com/Overu/deepseek-harness/releases/tag/insight-v1.0.10)，非 draft，标记 prerelease、非 latest，保持 Candidate 定位 |
| OSS/CDN | 三目标 Candidate 1.0.10 已投放；Stable 指针逐字节保持原 1.0.9，本阶段没有 Stable 发布 |
| 原生升级 | 用户报告 macOS arm64 从 1.0.8 升级到 1.0.10 看起来成功；其他平台交第三方验证，数据保留未逐项确认 |

早期 1.0.10-rc.1 只是构建验证记录，不能替代上述最终 1.0.10 的来源和投放证据。逐次故障、授权、修复和运行链接保留在 [Candidate 执行记录](2026-11-02-dsh-insight-stable-release.md)。

## 2 结构和数据流

DSH 负责原生平台打包、运行时装配、macOS 签名与公证，以及唯一的更新下载、安装和重启协调器。Insight Integration 负责产品身份、登录与账号 Home、模型/业务认证、更新窗口、渠道发现、清单验签和版本策略。没有迁入第二套 Shell UpdateManager。

```text
固定 Insight 源码及产品版本
  → insight-package.yml：DSH 原生三平台构建、打包和验证
  → GitHub Release：不可变安装包、metadata、摘要与来源记录
  → insight-publish.yml：轻量发布 runtime，不重建或重新签名安装包
  → 原有网关：GitHub OIDC → OSS 短期 STS
  → OSS：不可变制品 → 验证 → 最后替换渠道指针 → 回读
  → 原客户端/新客户端：按各自协议验签和选择目标
  → DSH 唯一 coordinator：下载、独立安装确认、Host 停机和重启
```

正式版本号也能先发 Candidate；验证后可另行授权将同一份制品和目标清单转 Stable，无需重新构建。最终版本 Candidate 使用 V2，rc Candidate 使用 V3。正式版常规检查 Stable；rc 版没有可升级 Stable 时也检查 Candidate；五连击和风险确认继续作为手动内测入口。

当前源码能读取 V2 final Candidate 和 V3 rc Candidate，已发布的 1.0.10 未包含这次双协议 reader 修复，仍只读取 V3 Candidate。该修复随下一次自然客户端发版交付；从当前 1.0.10 走 Candidate 交付修复时，需要 rc 通路或手动安装，不能假定它能发现 final V2 Candidate。旧 Shell 可以通过五连击读取本次 final V2 Candidate。

OSS 不支持所需 PutObject 条件替换，因此使用用户批准的 Shell 方式：单一发布入口、同指针串行发布、写前核对、写后完整回读；这不构成原子 CAS。旧 Shell 原仓和 fork 的两条 publish workflow 已停用，构建/签名流程保留。网关旧身份的 STS 权限未撤销，后续不得并行恢复旧发布入口。实现维护以 [发布工具 README](../../../../../scripts/insight-release/README.zh.md) 为准。

## 3 验证证据与限度

| 范围 | 已有证据 | 未覆盖部分 |
| --- | --- | --- |
| 三平台制品 | 同一来源的 GitHub 构建、附件和摘要核对通过 | 不等于每个平台真实覆盖安装通过 |
| 三目标 OSS 投放 | [arm64 41425978182](https://github.com/Overu/deepseek-harness/actions/runs/41425978182)、[x64 41426684691](https://github.com/Overu/deepseek-harness/actions/runs/41426684691)、[Windows 41426716208](https://github.com/Overu/deepseek-harness/actions/runs/41426716208) 全部成功 | Stable 未投放 |
| 旧 Shell 发现 | 使用 v1.0.9 tag 的真实 reader，对三目标公共 CDN 签名和目标绑定检查通过，均发现较新的 1.0.10 | 不外推为另外两平台真实安装通过 |
| 新版源码发现 | 对同一 CDN 验签、metadata、payload 绑定及选定指针观测通过 | 源码能力与现有 1.0.10 安装包必须区分 |
| 发布器修复 | 独立复核的五文件 48 项测试、定向 lint、build:check 2/2；正常提交和推送门禁通过 | 不是全仓 lint、GUI 或 doc-sync 全绿声明 |
| 数据 | P4 隔离副本首启与重启历史可见性验证；本次 arm64 用户升级反馈 | 本次线上升级后的会话、工作区、插件、配置未逐项确认 |

上述功能检查是此前实际执行证据。本次文档收口完成三组 DSH 文档双语配对检查、变更 Markdown 的本地链接/锚点/段落换行/文件结尾检查，以及两仓 `git diff --check`，均通过；未重跑全仓 doc-sync、lint、GUI 或构建，也未运行安装或发布。既有全仓 GUI、固定快照 lint/依赖和文档门禁失败仍保留原记录，不通过删除有效测试来掩盖。

## 4 范围排除和转交

- 随包 `dsh` CLI 的安装/命令入口不属 Insight 产品，不适配；不因此移除官方 CLI，也不影响 Agent shell、Memory 外部 CLI、技能脚本及随包 Node。
- 其他平台、升级后数据和错误恢复的验证反馈后续跟进，发现问题按 bug 处理，不再阻断 P6。
- Candidate 双协议 reader 随下一次自然客户端版本交付，属于明确转交事项，不能因 P5 收口丢失。
- Windows 全局安装兼容、旧定时任务、Insight i18n、已撤回的 sidebar 调整和内置技能内容正确性不在本轮范围；不恢复 qualification 阶段。
- Stable 发布需单独授权；CI 进一步提速是可选优化，不为此增加打包环节。

P6 的范围、架构背景、风险及执行顺序见 [P6 交接依据](2026-11-02-dsh-insight-p6-handoff.md)。本报告关闭 P5 的阶段待办，不声明所有平台与产品场景已验收，也不启动 P6 删除操作。
