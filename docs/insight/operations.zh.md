# Insight Desktop 运维参考

[English](operations.md) | 中文

## 摘要

当 Insight 构建、发布、签名或本地开发启动需要排查时，使用本参考。它记录迁移中已经成功的发布实践及其边界。产品行为和发布格式细节由 [Insight 发布脚本](../../scripts/insight-release/README.zh.md)维护；架构和基线改动由 [Insight 架构](architecture.zh.md)和[基线记录](baseline-changes.zh.md)维护。

## 目录

- [当前交付状态](#current-delivery-state)
- [本地开发](#developing-locally)
- [构建 GitHub Release 制品](#building-github-release-artifacts)
- [发布已验证制品](#publishing-a-verified-release)
- [签名与公证](#signing-and-notarization)
- [已知故障恢复](#known-failure-recovery)
- [限制与后续事项](#limits-and-follow-up)

-----

<a id="current-delivery-state"></a>

## 当前交付状态

当前公开 Candidate 为 macOS arm64、macOS x64 和 Windows x64 的 1.0.10。Stable 仍为 1.0.9。Candidate 和 Stable 是发布渠道，因此 final 语义版本可以先在 Candidate 验证，之后将同一份已验证制品提升到 Stable。

已发布的 1.0.10 应用早于同时读取 final Candidate V2 指针和 prerelease Candidate V3 指针的源码改动。后续安装包必须带上该 reader 改动。不要覆盖现有 1.0.10 制品交付它；应使用新版本。Stable 发布仍需单独授权。

迁移证据保留在 [Insight 历史记录](history/shell/analysis/2026-11-02-dsh-insight-stable-release.md)。当决定依赖精确源码、平台或渠道证据时，读取交付记录，而非只依赖本运维摘要。

<a id="developing-locally"></a>

## 本地开发

在仓库根目录运行 `npm run dev:insight`。启动器选择 Insight 产品，并默认将开发产品版本设为 1.0.11-rc.1。它复用 Desktop 开发启动器，并使用与 Shell 兼容的 Insight 开发 userData 位置。

开发登录流程不持久化凭据。已打包应用在隐藏窗口恢复并校验保存的凭据；有效账号和账号 Home 会打开工作区，无效凭据、离线请求或 Home 保护失败会显示登录或恢复页面。不要因为本地存在 token 文件而跳过服务端校验。

开发模式刻意不检查已打包应用更新。它的更新入口会显示开发模式提示，因为源码启动没有已打包更新来源。使用已安装的发布版本验证更新发现、下载或安装。

<a id="building-github-release-artifacts"></a>

## 构建 GitHub Release 制品

打包工作流创建已签名、已公证的 macOS 制品和 Windows NSIS 制品。它生成一个 GitHub Release，其附件和来源记录是发布工作流唯一可使用的输入。发布工作流不会重新构建、签名、公证或安装应用。

准备可能以后成为 Stable 的版本时运行全部目标。单目标打包只生成对应 Actions artifact，不能直接用于 OSS 发布；Candidate 发布从已完整校验并公开的 Release 选择目标。打包工作流保持平台 job 并行，也保持 macOS App 与 DMG 公证路径并行；不要在发布器中增加 qualification 阶段或重复完整构建。

平台 job 成功后，如果 finalizer 或附件回读失败，应在同一 workflow run 重跑失败 job，复用成功 native job 的已记录制品；OSS 投放前要求整个 run 最终成功。重新构建或从不同源码 rerun 会改变发布器验证的来源。rerun 仍必须通过 workflow 身份、源码、Release 附件、manifest、大小和 SHA-512 检查。

<a id="publishing-a-verified-release"></a>

## 发布已验证制品

打包的 Apple 六项材料和发布的 Ed25519 私钥配置在 GitHub 仓库 `Settings → Environments → desktop-release → Environment secrets`。名称以[打包 workflow](../../.github/workflows/insight-package.yml)和[发布 workflow](../../.github/workflows/insight-publish.yml)的 `secrets` 引用为准；Apple `.p8` 与更新清单私钥用途不同，不互相替代。材料内容不进入文档或日志。

发布器下载已有 GitHub Release 附件和原始 workflow artifact，在申请 OSS 凭据前校验它们的身份和字节。它使用隔离 runtime，因此发布不安装 workspace，也不重复 Desktop 打包。

既有 STS 服务接收 audience 为 `insight-harness-oss-upload` 的 GitHub OIDC token、JSON Accept 与 Content-Type header，以及空 JSON body。它只向受信任的仓库、分支、workflow 和 release environment 签发短期 OSS 凭据。不要在 GitHub Secrets 或本地配置中加入长期 OSS 凭据。

STS 请求实际发往 `https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1/upload/sts/token`，请求体为 `{}`。audience 是[现有代码](../../scripts/insight-release/oss.ts)里的固定协议值，不是 Shell 漏配的 GitHub Secret；403 的 `GITHUB_REPOSITORY_FORBIDDEN` 应核对网关实际环境的仓库身份放行，不用更换证书或伪造旧仓 claims。

OSS 对内存中的 metadata 和指针字节接受 Node `Buffer`。它不提供原子 compare-and-swap 所需的条件指针替换。支持的流程是每个指针只有一个发布者，并按 workflow target 串行：发布前读取指针，在替换前确认未变化，只写入一次，然后回读完整字节。指针写入失败的结果未知；后续尝试前停止并核对远端状态。

Candidate 发布不得修改 Stable 指针。Stable 需要独立授权的全目标 Release。新仓仍为唯一写入方期间，保持旧 Shell 发布器停用；同时启用两个写入方会重新引入未解决的指针竞争。

<a id="signing-and-notarization"></a>

## 签名与公证

macOS 签名配置写入 runner 临时目录，通过路径传给后续步骤，并在 `always()` 清理步骤移除。正常打包路径会签名、公证、staple 并验证应用和 DMG。跳过公证的 debug 包不能发布。

两种重试机制处理不同 Apple 故障。公证依赖会在已完成提交后重试 staple。Desktop DMG 验证器只在只读 `stapler validate` 失败同时包含 status 68、`NSURLErrorDomain`、`Code=-1005` 和 `api.apple-cloudkit.com` 时重试，等待两秒后五秒。它不会再次提交、签名、staple 或放宽最终验证。

为获得 staple 恢复行为，公证依赖从主版本 2 升级到主版本 3。它同时影响 Insight 和官方产品，因此同步上游时应按共享构建稳定性改动处理，而不能看作 Insight 专有功能。

<a id="known-failure-recovery"></a>

## 已知故障恢复

| 症状 | 迁移中观察到的原因 | 已成功的处理 | 不要做 |
| --- | --- | --- | --- |
| 修复发布器后 rerun 仍报原错误 | GitHub rerun 固定原 workflow 提交，不会加载后来修复 | 以新 workflow_dispatch 加载新发布器，同时固定并复用原打包来源 | 不要为发布脚本修复重建或替换同版本安装包 |
| artifact 下载返回 HTTP 415 | GitHub Actions artifact archive 在重定向前需要 JSON 媒体类型 | artifact archive 请求 GitHub JSON Accept 值；Release 附件请求 octet-stream 字节 | 不要对两个端点使用同一个 Accept 值 |
| 发布器解析到 workspace import 或缺少隔离依赖 | 根 TypeScript path 配置可能让轻量发布器加载 workspace 源码 | 使用准备好的发布器 loader 及其输出的隔离 TypeScript 配置 | 不要在发布 job 安装完整 workspace |
| STS 请求被拒绝 | 网关检查 OIDC 身份和请求格式 | 依据发布 workflow 核对仓库、分支、workflow、environment、audience、header 和空 body | 不要在日志中输出 OIDC token 或网关响应正文 |
| OSS 拒绝内存 metadata | OSS SDK 不接受浏览器 API 使用的 typed-array 输入 | 将小型 manifest、签名和指针值转换为 Node `Buffer` | 不要把安装器文件读入内存；按文件上传 |
| 指针写入结果未知 | OSS 缺少原子指针 compare-and-swap | 停止，读取远端指针，并与目标已签名字节比较后再决定下一步 | 不要盲目重试或覆盖指针 |
| macOS DMG 验证报告精确 CloudKit 中断 | Apple 在公证后验证 ticket 时可能丢失 CloudKit 连接 | 让有界只读验证器完成两次预定等待后的重试 | 不要重试无关的签名、公证或 Gatekeeper 失败 |

<a id="limits-and-follow-up"></a>

## 限制与后续事项

本参考记录成功的构建和 Candidate 发布实践，不是平台 qualification 结论。一名 macOS arm64 用户报告旧客户端升级到 Candidate 1.0.10 成功；数据保留尚未逐项检查。其他平台反馈、更新失败恢复、数据连续性和下一版本双 Candidate reader 交付仍是后续工作，复现后作为 bug 处理。

随包 `dsh` 命令行启动器不属 Insight 产品范围。这不移除 Host、Agent shell、Memory 外部 CLI、技能脚本或这些产品集成使用的 Node runtime。

## 开发备注

无。
