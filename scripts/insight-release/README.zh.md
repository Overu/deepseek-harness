# Insight 桌面发布流水线

[English](README.md) | 中文

## 概述

这些脚本在 DSH 桌面打包、不可变 GitHub Release 和既有 Insight OSS/CDN 之间建立可校验交接。它们以产品版本 `1.0.9` 作为迁移基线。Candidate 和 Stable 是发布渠道；Candidate 接受 final 和 prerelease 版本。打包和发布是相互独立的操作：发布只消费已完成打包工作流的字节与来源记录，绝不重新构建或签名。

## 目录

- [发布流程](#release-flow)
- [打包工作流](#package-workflow)
- [发布工作流](#publish-workflow)
- [已签名更新格式](#signed-update-formats)
- [信任与失败规则](#trust-and-failure-rules)
- [构建验收](#build-completion)

-----

<a id="release-flow"></a>
## 发布流程

打包工作流固定来源分支的一个提交，使用 DSH 构建选定平台包，收集目标唯一的附件，并在来源记录附件中记录构建运行和产物摘要。该记录绑定仓库、workflow path、可信 ref、事件、head 提交、run id、目标和 manifest 摘要；随后创建不可变的 `insight-v<version>` GitHub Release。发布工作流下载该 Release 和原始工作流产物，按来源记录校验两者，签名更新文档，写入 OSS 不可变对象并校验远端字节，随后由单一发布者在替换前核对指针，并在写入后回读。

应用产品版本和内嵌 DSH 运行时版本保持独立。Candidate 接受规范的 1.x final 或 prerelease 版本。Stable 接受 final 版本，并需要 `darwin-arm64`、`darwin-x64` 和 `win32-x64` 三个目标。经过 Candidate 验证的 final 版本可以使用相同 GitHub Release、应用字节和已签名目标 manifest 晋升 Stable。

-----

<a id="package-workflow"></a>
## 打包工作流

`.github/workflows/insight-package.yml` 是手动工作流。规范的 `1.x.y-rc.N` 版本可从任意分支打包；其他版本必须来自 `insight` 分支。标签不能作为打包来源。来源校验先于平台构建和 Release 创建执行；每次 checkout 仍固定为工作流提交。它的三个目标 job 使用 DSH 桌面入口打包 macOS arm64、macOS x64 和 Windows x64。每个 job 执行对应平台既有的 DSH 打包命令，然后收集并上传所选目标。Windows 通过既有 DSH NSIS 路径使用 Insight 品牌。

GitHub 的 `desktop-release` environment 必须允许 RC 打包使用的来源分支；这些分支会接收既有 macOS 签名和公证凭据。签名准备步骤接收 P12 密码和 Apple API 值，在 `RUNNER_TEMP` 下写入私有文件，只向后续步骤导出文件路径，并在 `always()` 清理步骤删除该私有目录。正常构建必须完成 DSH 签名、公证和打包检查，收集器之后才能记录 `distribution`。显式调试选项记录 `debug-signed`，只创建 draft 调试 Release，不能通过 OSS 发布器。

Windows job 受产品门控，并按 Insight 产品决定不使用 Authenticode。它仍执行既有 DSH runtime 与打包检查，并生成精确目标 manifest、大小和 SHA-512 输入，后续由已签名更新文档覆盖。正常正式版 Release 要求三个 job 都成功产生制品，工作流不会伪造缺失的 Windows 目标。

正常单目标运行只生成对应架构的 Actions artifact；只有正常全目标运行才可创建公开 Release。finalizer 先创建或复用 draft，上传全部预期附件，只允许重试同名 GitHub `starter` 附件，重新下载每个附件校验大小和 SHA-512，最后才公开已校验 draft。finalize job 使用隔离发布运行时，不重复安装全仓依赖。

来源记录不绑定 GitHub 的 rerun attempt 计数。旧记录可以包含用于审计展示的正整数 attempt，但读取器不把它用于来源授权。最终附件回读或 Release 最后更新失败时，可以在当前 run 已成功完成后重跑失败 job，并在相同 run id 下复用相同 native 字节；不会重新构建、签名或公证应用。记录中的 `qualification` 字段仍为 `distribution` 或 `debug-signed`；它用于区分打包产物类型，不代表 Windows 升级结果。

-----

<a id="publish-workflow"></a>
## 发布工作流

`.github/workflows/insight-publish.yml` 是独立的手动工作流。它校验固定仓库 id、`insight` ref、当前提交、工作流身份、请求版本和请求源码提交。`scripts/insight-release/runtime/` 下的隔离运行时只安装发布器依赖，并将已审查的发布器源码和随包公钥复制到临时 loader 根目录。loader 使用显式隔离的 TypeScript 配置，防止仓库源码别名绕过轻量运行时依赖。

只有最终发布步骤接收 `DESKTOP_UPDATE_SIGNING_PRIVATE_KEY`。OSS 客户端只接受已批准的 GitHub 工作流 OIDC 身份，并向既有 Insight 后端申请短期 STS 凭据，不使用长期 OSS access key。OIDC 或 STS 请求发送与 Shell 一致的 JSON Accept header，失败时报告 HTTP 状态与限定长度的机器码，不记录 token 或响应正文。

发布工作流的 target 输入决定渠道：平台目标发布 Candidate；`all` 并行发布全部三个目标的 Candidate；`stable` 为全部三个目标发布 Stable。Candidate 接受 final 或 prerelease 版本；只有规范的 `1.x.y-rc.N` 构建可来自 `insight` 以外的分支。发布器自身始终从 `insight` 运行。Stable 要求从 `insight` 构建的 final 版本，且三个经过校验的 `distribution` 目标具有相同版本、源码提交和 DSH 运行时版本。

使用 `target=all` 时，某个平台失败不会取消其余平台。工作流等待三个发布 job 全部结束后，向飞书发送一条汇总消息，包含版本、源码提交、整体结果、本次运行尝试的操作人和链接。版本和提交输入不能插入额外的消息行。它通过 GitHub jobs API 读取每个平台截至当前运行尝试的最新结果，包括仅重跑失败任务时沿用的成功平台；缺失、取消或未结束的平台不能产生全部成功的通知。单平台与 Stable 发布不发送此通知。配置仓库 Actions secrets `FEISHU_BOT_WEBHOOK`（自定义机器人 Webhook URL）和 `FEISHU_BOT_SIGNING_SECRET`（机器人签名密钥），并在机器人中启用签名校验。通知 job 不接收更新签名私钥或 OIDC 写入权限。通知被拒绝或未获确认时，其 job 失败，但不撤销发布；请求不会自动重试，因为消息可能已经送达。重新运行通知 job 会再次发送请求，因此应先核对群消息。

第二阶段在读取或发布附件前拒绝 draft Release。其轻量运行时不会重新构建、打包、公证或安装应用。Actions artifact 下载请求 GitHub JSON 媒体类型以获取归档重定向；Release 附件下载请求 octet-stream 字节。

-----

<a id="signed-update-formats"></a>
## 已签名更新格式

内测 V2 通过 `desktop/candidate-v2/<target>/current.json` 发布 final 版本。它与正式 V2 共用 `desktop/releases/v<version>/targets/<target>/` 下的已签名目标 manifest 和应用对象，包括旧版的 `latest-mac.yml` 与 `latest.yml` 名称。内测发布不写入 Stable 指针或 release 索引。

内测 V3 使用 `desktop/candidate-v3/<target>/current.json` 和 `desktop/native/releases/v<version>/targets/<target>/` 下的目标专属不可变对象，并为新客户端接受 rc 版本。已发布 Shell V2 读取器拒绝 prerelease，因此内测 V3 不承诺把旧 Shell 直接更新到 `1.0.10-rc.1`。

正式 V2 使用 `desktop/stable/current.json`、一份已签名 release 索引和 `desktop/releases/v<version>/` 下全部三个已签名目标 manifest。它保留旧 Shell 兼容正式版读取器所需的 `latest-mac.yml` 和 `latest.yml` 产物名。正式发布只接受 final 版本；旧 Shell 客户端可以通过手动内测检查发现 final Candidate 版本。

两种格式都绑定版本、目标、源码提交、运行时版本、兼容字段、产物名称、字节大小和 SHA-512。渠道指针是引用精确 manifest 或 release 索引字节的 Ed25519 签名 envelope。

当前源码客户端认证两个 Candidate 指针并选择最高版本；只有 HTTP 404 表示指针不存在。最高版本若已撤回，不会回退到较旧的 active 版本。两种协议共享 Candidate 版本下限。`1.0.11-rc.1` 已随包交付该 reader；已发布版本的兼容关系和发现证据由[操作手册](../../docs/insight/operations.zh.md#current-delivery-state)维护。

V2 index 和目标读取器为兼容已发布 Shell 解析器而接受尾随空白。签名仍认证包含该空白的完整原始字节，因此发布器或 CDN 不能在签名后修改它。

-----

<a id="trust-and-failure-rules"></a>
## 信任与失败规则

发布器拒绝调试产物、缺失目标、意外 Release 附件、过期工作流产物、当前未成功完成的 run、仓库、workflow、ref、事件、head、run id、tag 或附件字节不匹配、选择其他 payload 的元数据、不同字节占用已有不可变键、版本回退，以及与随包公钥不匹配的签名密钥。它以文件流处理大对象，不把安装器整体载入内存。OSS 操作的 30 分钟超时上限覆盖安装包完整回读校验。内存中的 manifest、签名和指针字节在传给 OSS SDK 时转换为 Node Buffer。

不可变对象使用 OSS 的 `x-oss-forbid-overwrite` 创建保护。每次替换指针前，发布器重新读取其字节和 revision；若自初次读取后发生变化或新出现则停止。OSS 不能让替换原子化，因此发布环境必须保证每个指针只有一个发布者；GitHub Actions 按目标串行化发布。失败写入的结果未知：操作停止，后续尝试必须先核对远端状态，不能覆盖重试。只有指针回读字节与已签名字节一致时，发布才能报告成功。

-----

<a id="build-completion"></a>
## 构建验收

打包工作流分别为 macOS arm64、macOS x64 和 Windows x64 执行 DSH 打包命令，收集每个目标并上传 Actions artifact。只有三个目标 job 全部成功且 finalizer 创建经过校验的公开 GitHub Release 后，正常全目标构建才完成。

OSS 发布使用独立的手动工作流。打包工作流不调用发布器，也不修改 OSS 对象或渠道指针。
