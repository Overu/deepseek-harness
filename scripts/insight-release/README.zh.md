# Insight 桌面发布流水线

[English](README.md) | 中文

## 概述

这些脚本在 DSH 桌面打包、不可变 GitHub Release 和既有 Insight OSS/CDN 之间建立可校验交接。它们以产品版本 `1.0.9` 作为迁移基线，并接受 `1.0.10-rc.1` 作为首个内测版本。打包和发布是相互独立的操作：发布只消费已完成打包工作流的字节与来源记录，绝不重新构建或签名。

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

打包工作流固定 `insight` 分支的一个提交，使用 DSH 构建选定平台包，收集目标唯一的附件，并在来源记录附件中记录构建运行和产物摘要。该记录绑定仓库、workflow path、可信 ref、事件、head 提交、run id、目标和 manifest 摘要；随后创建不可变的 `insight-v<version>` GitHub Release。发布工作流下载该 Release 和原始工作流产物，按来源记录校验两者，签名更新文档，写入 OSS 不可变对象，校验远端字节，最后才条件更新渠道指针。

应用产品版本和内嵌 DSH 运行时版本保持独立。内测版本必须是规范的 1.x prerelease，正式版本必须是规范的 1.x final release，并且需要 `darwin-arm64`、`darwin-x64` 和 `win32-x64` 三个目标。

-----

<a id="package-workflow"></a>
## 打包工作流

`.github/workflows/insight-package.yml` 是仅允许 `insight` 分支使用的手动工作流。它的三个目标 job 使用 DSH 桌面入口打包 macOS arm64、macOS x64 和 Windows x64。每个 job 执行对应平台既有的 DSH 打包命令，然后收集并上传所选目标。Windows 继续使用 DSH NSIS 路径；额外的 Insight 品牌改动需要另行授权。

签名准备步骤接收 P12 密码和 Apple API 值，在 `RUNNER_TEMP` 下写入私有文件，只向后续步骤导出文件路径，并在 `always()` 清理步骤删除该私有目录。正常构建必须完成 DSH 签名、公证和打包检查，收集器之后才能记录 `distribution`。显式调试选项记录 `debug-signed`，只创建 draft 调试 Release，不能通过 OSS 发布器。

Windows job 受产品门控，并按 Insight 产品决定不使用 Authenticode。它仍执行既有 DSH runtime 与打包检查，并生成精确目标 manifest、大小和 SHA-512 输入，后续由已签名更新文档覆盖。正常正式版 Release 要求三个 job 都成功产生制品，工作流不会伪造缺失的 Windows 目标。

正常单目标运行只生成对应架构的 Actions artifact；只有正常全目标运行才可创建公开 Release。finalizer 先创建或复用 draft，上传全部预期附件，只允许重试同名 GitHub `starter` 附件，重新下载每个附件校验大小和 SHA-512，最后才公开已校验 draft。finalize job 使用隔离发布运行时，不重复安装全仓依赖。

来源记录不绑定 GitHub 的 rerun attempt 计数。旧记录可以包含用于审计展示的正整数 attempt，但读取器不把它用于来源授权。最终附件回读或 Release 最后更新失败时，可以在当前 run 已成功完成后重跑失败 job，并在相同 run id 下复用相同 native 字节；不会重新构建、签名或公证应用。记录中的 `qualification` 字段仍为 `distribution` 或 `debug-signed`；它用于区分打包产物类型，不代表 Windows 升级结果。

-----

<a id="publish-workflow"></a>
## 发布工作流

`.github/workflows/insight-publish.yml` 是独立的手动工作流。它校验固定仓库 id、`insight` ref、当前提交、工作流身份、请求版本和请求源码提交。`scripts/insight-release/runtime/` 下的隔离运行时只安装发布器依赖，并将已审查的发布器源码和随包公钥复制到临时 loader 根目录。

只有最终发布步骤接收 `DESKTOP_UPDATE_SIGNING_PRIVATE_KEY`。OSS 客户端只接受已批准的 GitHub 工作流 OIDC 身份，并向既有 Insight 后端申请短期 STS 凭据，不使用长期 OSS access key。

内测发布从 prerelease GitHub Release 中选择一个目标。正式发布不接受目标输入，要求三个经过校验的 `distribution` 目标具有相同版本、源码提交和 DSH 运行时版本。

第二阶段在读取或发布附件前拒绝 draft Release。其轻量运行时不会重新构建、打包、公证或安装应用。

-----

<a id="signed-update-formats"></a>
## 已签名更新格式

内测 V3 使用 `desktop/candidate-v3/<target>/current.json` 和 `desktop/native/releases/v<version>/targets/<target>/` 下的目标专属不可变对象，并为新客户端接受 rc 版本。已发布 Shell V2 读取器拒绝 prerelease，因此内测 V3 不承诺把旧 Shell 直接更新到 `1.0.10-rc.1`。

正式 V2 使用 `desktop/stable/current.json`、一份已签名 release 索引和 `desktop/releases/v<version>/` 下全部三个已签名目标 manifest。它保留旧 Shell 兼容正式版读取器所需的 `latest-mac.yml` 和 `latest.yml` 产物名。正式发布只接受 final 版本；首个旧客户端自动升级目标仍是 `1.0.10`，不是 rc 包。

两种格式都绑定版本、目标、源码提交、运行时版本、兼容字段、产物名称、字节大小和 SHA-512。渠道指针是引用精确 manifest 或 release 索引字节的 Ed25519 签名 envelope。

正式 V2 index 和目标读取器为兼容已发布 Shell 解析器而接受尾随空白。签名仍认证包含该空白的完整原始字节，因此发布器或 CDN 不能在签名后修改它。

-----

<a id="trust-and-failure-rules"></a>
## 信任与失败规则

发布器拒绝调试产物、缺失目标、意外 Release 附件、过期工作流产物、当前未成功完成的 run、仓库、workflow、ref、事件、head、run id、tag 或附件字节不匹配、选择其他 payload 的元数据、不同字节占用已有不可变键、版本回退，以及与随包公钥不匹配的签名密钥。它以文件流处理大对象，不把安装器整体载入内存。

不可变对象采用禁止覆盖的创建语义。发布器重新下载每个对象并检查大小与 SHA-512，然后才使用 `If-Match` 或 `If-None-Match` 更新指针。失败写入的结果未知：操作停止，后续尝试必须先核对远端状态，不能覆盖重试。只有指针回读字节与已签名字节一致时，发布才能报告成功。

-----

<a id="build-completion"></a>
## 构建验收

打包工作流分别为 macOS arm64、macOS x64 和 Windows x64 执行 DSH 打包命令，收集每个目标并上传 Actions artifact。只有三个目标 job 全部成功且 finalizer 创建经过校验的公开 GitHub Release 后，正常全目标构建才完成。

OSS 发布使用独立的手动工作流。打包工作流不调用发布器，也不修改 OSS 对象或渠道指针。
