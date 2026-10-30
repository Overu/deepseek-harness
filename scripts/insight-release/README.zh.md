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
- [验证状态](#qualification-status)

-----

<a id="release-flow"></a>
## 发布流程

打包工作流固定 `insight` 分支的一个提交，使用 DSH 构建选定平台包，收集目标唯一的附件，并在来源记录附件中记录构建运行和产物摘要；随后创建不可变的 `insight-v<version>` GitHub Release。发布工作流下载该 Release 和原始工作流产物，按来源记录校验两者，签名更新文档，写入 OSS 不可变对象，校验远端字节，最后才条件更新渠道指针。

应用产品版本和内嵌 DSH 运行时版本保持独立。内测版本必须是规范的 1.x prerelease，正式版本必须是规范的 1.x final release，并且需要 `darwin-arm64`、`darwin-x64` 和 `win32-x64` 三个目标。

-----

<a id="package-workflow"></a>
## 打包工作流

`.github/workflows/insight-package.yml` 是仅允许 `insight` 分支使用的手动工作流。它的三个目标 job 使用 DSH 桌面入口打包 macOS arm64、macOS x64 和 Windows x64。每个 job 选择 Insight 应用 id、名称、产物前缀、产品版本、更新资源和平台目标，但不改变官方 Desktop 打包默认值。

签名准备步骤接收 P12 密码和 Apple API 值，在 `RUNNER_TEMP` 下写入私有文件，只向后续步骤导出文件路径，并在 `always()` 清理步骤删除该私有目录。正常构建必须完成 DSH 签名、公证和打包检查，收集器之后才能记录 `distribution`。显式调试选项记录 `debug-signed`，只创建 draft 调试 Release，不能通过 OSS 发布器。

Windows job 受产品门控，并按 Insight 产品决定不使用 Authenticode。它仍生成精确目标 manifest、大小和 SHA-512 输入，后续由已签名更新文档覆盖。正常正式版 Release 要求三个 job 都成功产生制品，工作流不会伪造缺失的 Windows 目标。

正常单目标运行只生成对应架构的 Actions artifact；只有正常全目标运行才可创建公开 Release。finalizer 先创建或复用 draft，上传全部预期附件，只允许重试同名 GitHub `starter` 附件，重新下载每个附件校验大小和 SHA-512，最后才公开已校验 draft。finalize job 使用隔离发布运行时，不重复安装全仓依赖。

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

发布器拒绝调试产物、缺失目标、意外 Release 附件、过期工作流产物、tag 或工作流身份不匹配、选择其他 payload 的元数据、不同字节占用已有不可变键、版本回退，以及与随包公钥不匹配的签名密钥。它以文件流处理大对象，不把安装器整体载入内存。

不可变对象采用禁止覆盖的创建语义。发布器重新下载每个对象并检查大小与 SHA-512，然后才使用 `If-Match` 或 `If-None-Match` 更新指针。失败写入的结果未知：操作停止，后续尝试必须先核对远端状态，不能覆盖重试。只有指针回读字节与已签名字节一致时，发布才能报告成功。

-----

<a id="qualification-status"></a>
## 验证状态

聚焦实现检查通过 25 个文件中的 437 项测试，独立发布路径检查通过 15 个文件中的 118 项测试。完成一个小型 Node stream 类型 fixture 修复后，受影响的 coordinator suite 通过 27 项测试；修复后的完整 437 项日志尚未归档。导出 JSDoc 与最终 P5 type-aware scoped lint 通过，lint 为零项。最新官方构建已通过全部编译聚合，较早一次 `build:artifacts` 也通过全部八项门禁。公开正式版 `1.0.9` 在线检查通过；另有六项源码测试通过包含十份公开更新文档的冻结离线 fixture。这些结果表示当前没有已知 P5 代码阻塞，但不代表生产渠道已经合格。

本地 macOS arm64 完整打包命令成功退出。Developer ID 签名、App 与 DMG 公证和 staple 已通过，并行两条公证 lane 分别耗时 299.83 秒与 303.94 秒。独立检查确认解压应用和 DMG 均为系统接受的 Notarized Developer ID 内容。产物包含 276 MiB DMG、383 MiB ZIP、407 KiB blockmap 和 369 B nightly metadata；collector 校验了四个附件及精确 metadata 绑定。`ProductInfo.plist` 记录 `com.insight-aigc.desktop` 和 `1.0.10rc1`。新仓 `DESKTOP_CSC_LINK` 现为经过验证、使用相同叶子证书和私钥并补齐公开 Apple G2 链的副本；用户原始文件未修改。

该包来自本地脏工作树 HEAD `675192ea4b`，不是 CI。P5 提交 `44e877f7b5fa6a2ef98d13ffc0e91b99f132884f` 已在远端，`insight` 已成为默认分支，两个 workflow 均已激活。首次全目标打包在创建 Release 前失败；对应冷环境修正已通过本地聚焦检查，替代 run 尚待执行。OSS 发布尚未运行。原生检查确认更新窗口可在登录前显示，四击不出现确认，三秒内第五击显示原生内测确认；确认后写入 schema 1、`candidateOptIn: true` 且 mode 600 的 preferences。没有可下载 feed 的开发构建按预期无法安装。原生自动检查不轮询 candidate 目前只有单元测试覆盖，生产 feed 下载和安装路径仍待验证。

经用户明确授权，既有 `DESKTOP_UPDATE_SIGNING_PRIVATE_KEY` 已作为 GitHub 密文一次性迁移到新 `Overu/deepseek-harness` 的 `desktop-release` Environment。七项必需 Secret 均已存在；临时迁移分支与 artifact 已删除，旧 Secret 和旧仓 `main` 保持不变，Secret 值没有暴露。OIDC-to-STS 后端是否接受新仓库数字 id、`insight` ref、`insight-publish.yml` 和 Environment，仍需真实发布请求验证。产品不要求 Windows Authenticode，但真实 `win32-x64` CI 制品和原生安装/升级结果仍待完成。在所需执行通过且用户另行启动发布前，正式发布和所有生产指针保持不变。
