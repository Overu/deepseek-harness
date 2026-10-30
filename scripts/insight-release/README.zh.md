# Insight 桌面发布流水线

[English](README.md) | 中文

## 概述

这些脚本在 DSH 桌面打包、不可变 GitHub Release 和既有 Insight OSS/CDN 之间建立可校验交接。它们以产品版本 `1.0.9` 作为迁移基线，并接受 `1.0.10-rc.1` 作为首个内测版本。打包和发布是相互独立的操作：发布只消费已完成打包工作流的字节与来源记录，绝不重新构建或签名。

## 目录

- [发布流程](#release-flow)
- [打包工作流](#package-workflow)
- [Windows 当前用户升级资格](#windows-current-user-qualification)
- [发布工作流](#publish-workflow)
- [已签名更新格式](#signed-update-formats)
- [信任与失败规则](#trust-and-failure-rules)
- [失败诊断](#failure-diagnosis)
- [验证状态](#qualification-status)

-----

<a id="release-flow"></a>
## 发布流程

打包工作流固定 `insight` 分支的一个提交，使用 DSH 构建选定平台包，收集目标唯一的附件，并在来源记录附件中记录构建运行和产物摘要。该记录绑定仓库、workflow path、可信 ref、事件、head 提交、run id、目标和 manifest 摘要；随后创建不可变的 `insight-v<version>` GitHub Release。发布工作流下载该 Release 和原始工作流产物，按来源记录校验两者，签名更新文档，写入 OSS 不可变对象，校验远端字节，最后才条件更新渠道指针。

应用产品版本和内嵌 DSH 运行时版本保持独立。内测版本必须是规范的 1.x prerelease，正式版本必须是规范的 1.x final release，并且需要 `darwin-arm64`、`darwin-x64` 和 `win32-x64` 三个目标。

-----

<a id="package-workflow"></a>
## 打包工作流

`.github/workflows/insight-package.yml` 是仅允许 `insight` 分支使用的手动工作流。它的三个目标 job 使用 DSH 桌面入口打包 macOS arm64、macOS x64 和 Windows x64。每个 job 选择 Insight 应用 id、名称、产物前缀、产品版本、更新资源和平台目标，但不改变官方 Desktop 打包默认值。

签名准备步骤接收 P12 密码和 Apple API 值，在 `RUNNER_TEMP` 下写入私有文件，只向后续步骤导出文件路径，并在 `always()` 清理步骤删除该私有目录。正常构建必须完成 DSH 签名、公证和打包检查，收集器之后才能记录 `distribution`。显式调试选项记录 `debug-signed`，只创建 draft 调试 Release，不能通过 OSS 发布器。

Windows job 受产品门控，并按 Insight 产品决定不使用 Authenticode。它仍生成精确目标 manifest、大小和 SHA-512 输入，后续由已签名更新文档覆盖。正常正式版 Release 要求三个 job 都成功产生制品，工作流不会伪造缺失的 Windows 目标。

正常单目标运行只生成对应架构的 Actions artifact；只有正常全目标运行才可创建公开 Release。finalizer 先创建或复用 draft，上传全部预期附件，只允许重试同名 GitHub `starter` 附件，重新下载每个附件校验大小和 SHA-512，最后才公开已校验 draft。finalize job 使用隔离发布运行时，不重复安装全仓依赖。

来源记录不绑定 GitHub 的 rerun attempt 计数。旧记录可以包含用于审计展示的正整数 attempt，但读取器不把它用于来源授权。最终附件回读或 Release 最后更新失败时，可以在当前 run 已成功完成后重跑失败 job，并在相同 run id 下复用相同 native 字节；不会重新构建、签名或公证应用。

-----

<a id="windows-current-user-qualification"></a>
## Windows 当前用户升级资格

Windows job 在构建和收集之后、上传 artifact 之前运行当前用户升级资格检查。它在同一个 GitHub-hosted 管理员 job 中安装并升级两个隔离用例：默认当前用户路径，以及一个包含空格的独立自定义路径。它下载由生产信任解析器选中的冻结签名 `1.0.9` 安装器并校验大小与 SHA-512，再只通过已收集 build manifest 选择新的 RC 安装器。检查覆盖真实旧 raw `resources/app/package.json` payload 与新 ASAR payload、registry 身份、安装路径保留、PE 身份、已安装 payload 版本，以及 Harness 所有目录下四个合成文件的 hash 不变。cache 路径只在用例间隔离和清理，不写入 sentinel，也不校验 hash。

同一 Windows job 在源码检查之后、依赖安装之前运行两分钟的真实 HKCU smoke，使用随机 registry key。该 smoke 不含 Secret，不执行 native build。它不新增 workflow、job 或 target 选择，保持原有四个 target 选项不变。

该资格检查使用 hosted administrator 上下文，不声称经过 UAC。它只确认安装器连续性：应用重启、更新 UI、真实账号和旧客户端自动发现 rc 版本均不属于结果。内部资格检查的整体期限为 20 分钟，所在 workflow step 为 25 分钟。cleanup 失败或 cleanup 结果未知会在上传前使 job 失败，因此不合格产物不会保留为 Actions artifact。

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

<a id="failure-diagnosis"></a>
## 失败诊断

原始 macOS x64 打包 job 失败后，非门禁 Office 诊断通过所选 macOS 目标和绝对制品目录调用 `node --import tsx scripts/insight-release/office-diagnostics.ts`。它依赖 `build:official` 已生成的 JavaScript Office resolver，不复制产品 resolver，也不提供应用 fallback。有已签名应用时，自适应矩阵依次观测已签名 ASAR 路径、已签名应用与经过字节校验的 raw runtime、打包 Resources Node 与该 raw runtime，并在首个观测通过后停止。没有已签名应用时，prepared-runtime 观测只能辅助诊断，不能代替应用资格。

每项观测都按 `docx`、`xlsx` 顺序使用产品 converter 限制执行相同转换：engine 转换期限为 60 秒，诊断 controller 进程预算为 150 秒。每项观测使用独立的 `HOME`、XDG、临时目录和 NARB cache 目录。日志只接受阶段、耗时、backend、失败类型、退出、signal、字节数、截断和结果白名单字段，捕获输出上限为 32 KiB，stderr 只报告字节数；不会输出环境值、参数、本地路径、URL、token 或文档内容。

Insight 专用的只读 `/bin/ps` observer 在原 macOS x64 构建旁运行，每秒采样精确的 libreoffice-kit 后代。它在内部用 PID 与启动时间识别进程，但不输出 PID、路径、参数、环境、完整错误或栈采样。固定事件只包含 UTC 时间、相对时间、`seen`、`gone`、45 秒标记和 summary，最多 64 行。每次进程列表调用共享两秒、1 MiB 与强制 kill 上限；取消时等待子进程 `close`。EXIT trap 只停止 observer，保留 pnpm 原退出状态。observer 始终为 `qualification: false`，不修改 Office 60 秒期限、不重试、不放宽任何门禁，也不需要官方保留接口。它补充 preparation 失败清理 runtime 后的观测缺口；某次采样未观测到进程，不代表进程从未启动。

工作流只在原始 job 已失败后运行自适应矩阵，并将步骤标记为 `continue-on-error`。最终记录始终包含 `qualification: false`：观测通过既不改变失败 job 的结果，也不使 CI 合格，任何 raw 模式都不能代替 packaged application smoke。如果受控进程组或其 stream 未能在有界终止和关闭宽限期内静止，controller 会记录 `cleanupFailed`、拒绝该项观测、停止后续矩阵并以非零状态退出。定位并解决 packaged-runtime 差异的源码问题后，可以移除这些工具。

-----

<a id="qualification-status"></a>
## 验证状态

本地 registry 修正用既有私有 typed `RegistryKey.GetValue` helper 替换动态 PowerShell `PSObject` 属性访问。最新聚焦运行通过三个文件中的 25 项测试，并在 macOS 上跳过一项真实 Windows smoke；`build:check` 的两个聚合和 scoped lint 均通过。observer 通过两个文件中的 14 项测试、`build:check` 两聚合、scoped lint 和独立复审，包含真实 Node 24 事件顺序检查：只能在子进程 `close` 时结算，不能在更早的 `execFile` callback 时结算；尚未执行真实 x64 observer 采样。`@electron/notarize` `3.1.2` 实现仍不含 hook，并保留既有 notary executor。这些本地结果不代表 CI 或 Release 合格。

Windows-only run `41096365005` 已通过早期真实 HKCU smoke、native 构建和 collector，随后在旧安装完成后停止：fixture 的 registry 查询被过滤为零条记录，upgrade 尚未开始。NSIS 模板把 `InstallLocation` 写在独立的 `Software\APP_GUID` 安装 key 下，uninstall key 不承诺包含该值。fixture 正在修正为跟随独立指针，不放宽应用身份或路径检查。该失败不能证明生产安装器失败。资格只验证安装器，不覆盖重启、更新 UI、真实账号或旧 Shell 自动发现 rc。旧 Shell 自动更新仍使用 stable `1.0.10` 路径。

Run `41089684008` 已完成 macOS arm64 构建、签名、公证、收集和 artifact 上传，因此 `@electron/notarize` `3.1.2` 已在该架构通过验证。macOS x64 job 在公证开始前的 prepared DOCX smoke 中超时。Windows 构建与 collector 通过，但资格检查在 installer upgrade 前因动态 registry 属性缺陷失败。失败后 Office 诊断因 preparation 失败已删除 runtime 而只得到 unavailable，没有产生 probe 证据。Office 调查独立继续，不提高 timeout。Release 已跳过，OSS 保持不变；arm64 结果不代表 Intel 合格。

原生检查确认更新窗口可在登录前显示，四击不出现确认，三秒内第五击显示内测确认；确认后写入 schema 1、`candidateOptIn: true` 且 mode 600 的 preferences。七项必需 GitHub Secret 均已存在，包括经授权密文迁移的 `DESKTOP_UPDATE_SIGNING_PRIVATE_KEY`。生产 feed 下载与安装、真实 Windows 当前用户升级、旧 Shell 正式版升级，以及 OIDC-to-STS 身份仍未验证。在 P5 完成且用户另行启动发布前，正式发布和所有生产指针保持不变。
