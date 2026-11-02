> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../../../README.zh.md)。

# 1.0.6 发布证据索引

这些小型 JSON 和签名复制自本轮已经核验的 CI/发布器证据，归档时保持原字节。目录没有安装器、Core 归档、用户历史、账户资料、访问令牌或完整对话。复核公钥为仓库的 `build/update-signing-public.pem`。

| 文件 | 用途与时间范围 |
| --- | --- |
| `stable-publication-proof.json` | 最终 1.0.6 正式发布结论；核实时间 2026-10-09 08:55:44 UTC |
| `stable-publisher-report.json` | promote-stable-all 成功报告、三个目标接受记录与 Stable 1.0.4→1.0.6 |
| `stable-detection-proof.json` | v1.0.3 原更新实现对公网三目标的签名链及五项 HEAD/Range 证据 |
| `candidate-detection-proof.json` | 同一旧实现检测 Candidate 1.0.6 的既有证据，从已保留临时副本取得 |
| `publisher-report.json` | 原 Candidate 发布 artifact 11602984958 的只读补存报告；没有重跑投放 |
| `stable-current-1.0.6.json` | 签名 Stable 信封；payload 中的 publishedAt 是生成时刻，不等于整轮完成时刻 |
| `stable-release-index.json` / `.sig` | 三目标正式 Release Index 及签名 |
| `<target>-stable-target.json` / `.json.sig` | 三目标不可变 Manifest 及签名 |
| `build-acceptance-proof.json` | 安装包构建完成阶段证明；当时 GitHub 为 Draft、Stable 为 1.0.4、Candidate 尚未投放。这些历史字段按原样保留 |
| `<target>-session-recovery.json` | 原生实际包启动及 V3→V4→恢复续写→重启读取证明；Candidate/recovery 均为 c3aaab2，不是旧 1.0.4 全应用 GUI 回退 |

原源证据目录为 `dist-candidate/ci-1.0.6`，被 Git 忽略且归档期间已不可用；16 项小型证据在目录消失前已复制，另外保留 Candidate 检测副本并从原 CI artifact 补存发布报告。此处保留可独立阅读的小型证据；大制品继续由 GitHub Release 和原不可变更新目录持有。历史阶段证明不进行“更新为当前状态”的改写。用户 macOS ARM64 人工验收与三平台 CI 分别记录，不互相替代。
