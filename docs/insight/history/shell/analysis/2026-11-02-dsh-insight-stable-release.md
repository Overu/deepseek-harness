> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# Insight 1.0.10 Candidate 发布执行记录

日期：2026-11-02。目标：提交客户端修复，构建三平台 1.0.10，仅验证并执行 OSS Candidate 发布，确认旧 Shell 手动内测检查可发现升级。用户已明确本次不发布 Stable；迁移基线仍为 1.0.9，DSH runtime 版本独立。

## 当前状态

Candidate 发布完成：macOS arm64、macOS x64、Windows x64 均已投放 1.0.10。旧 Shell v1.0.9 reader 与新版源码 reader 对真实 CDN 三平台验签读取通过，Stable 指针与发布前原始字节完全相同。现有 1.0.10 制品直接复用，没有重建或发布 Stable；随后用户报告 macOS arm64 的 1.0.8 → 1.0.10 Candidate 原地升级成功；其余平台等待第三方实测反馈。

源码首批提交：`6e10e22ce8`；编译登记及候选竞态补正：`b6e023585a`；Windows 兼容修复：`95c1477d080ef88330ef961f41042cedba627fd5`。三项已推送到 `insight`，提交/推送钩子均通过。初次推送暴露 Web 回放测试的编译归属遗漏，用户已授权 `apps/web/tsconfig.json` 排除与 `tsconfig.host.json` 纳入各一行，补正后 typecheck 5/5 通过。独立审查的内测候选被后台正式检查覆盖竞态已在 Insight controller 修复，19 项测试通过。

旧 Shell v1.0.9 tag 中的更新 reader 已隔离运行，对真实 CDN 三平台均验签解析为 1.0.9。新旧内置更新公钥相同；发布后将用同一旧 reader 对三平台断言 1.0.10，不下载或安装大包。

## 已授权的 Windows 最小兼容接入

问题：旧客户端程序名是 `因赛AI.exe`，新程序名与新装默认目录为 `insight-desktop`。DSH 路径预检只认可已登记目录中的新程序名，因而会拒绝旧目录；进程检查也只识别新程序名。

以下两处官方源码已按用户授权实施，并经独立审查关闭阻断：

| 文件 | 限定改动 |
| --- | --- |
| `apps/desktop/scripts/installer.nsh` | 复用 electron-builder 已有 `APP_ID`，仅 `com.insight-aigc.desktop` 声明旧程序名；在同一当前用户注册安装目录中同时检查新旧完整程序路径，沿用既有等待/拒绝逻辑，不终止进程 |
| `apps/desktop/installer/path.nsh` | 路径安全验证通过后，仅当 HKCU 登记的安装目录与选定目录相同，允许其中存在旧程序名作为升级依据；未登记非空目录继续拒绝 |

新装目录和新 exe 保持 `insight-desktop`，应用显示名仍为因赛AI。保留 appId、GUID、旧安装位置和用户数据；不恢复全局安装兼容、Windows qualification job 或额外发布阶段。配套补定向回归、现有测试和基线轨迹，正式安装器由现有 Windows CI 编译验证。

## Candidate 渠道规则与发布顺序

Candidate 和 Stable 是指针渠道，不由版本后缀决定。最终版本 1.0.10 先通过 Candidate 验证，后续经单独授权可复用同一 GitHub Release、打包物和已签名目标 manifest 晋升 Stable，不重建或重签名。旧 Shell 不支持 rc；final Candidate 使用其支持的 V2，rc Candidate 额外使用 V3。

发布工作流沿用原有输入：`target=darwin-arm64`、`darwin-x64` 或 `win32-x64` 分别发布该平台 Candidate；`target=stable` 才发布 Stable，本次禁止触发。final Candidate 复用 `desktop/releases/v1.0.10/targets/<target>/` 的 V2 目标对象，只切换 `desktop/candidate-v2/<target>/current.json`，不写入 Stable 指针或 release 索引。后续 Stable 发布复用全部三个平台的相同目标对象，再增加聚合 release 索引并切换 Stable 指针。

新客户端认证 V2、V3 两条 Candidate 指针后选择最高版本；只有 404 表示不存在，网络或验签失败不能静默回退。最高版本已撤回时保留撤回状态，不改选旧版本。两种协议共享设备上的 Candidate 历史版本下限，保留既有文件和历史键。

发布器复核 GitHub Release 与原始 artifact、签名键配对、OIDC/STS、不可变对象上传及回读，最后 CAS 更新所选 Candidate 指针。生产凭证只留在 GitHub Environment。发布后独立验证三平台 CDN 清单签名，并用旧 v1.0.9 reader 检查 Candidate 为 1.0.10、Stable 仍为 1.0.9；不自动执行安装。

## 复用现有 1.0.10 制品

按用户确认的最小范围，直接复用已完成的三平台 1.0.10 包。更新发布器即可生成旧 Shell 支持的 V2 Candidate 清单，无需重建、替换 tag 或覆盖 Release 附件。发布 workflow 使用修正后的发布器源码，但 `source_commit` 仍固定实际打包来源 `95c1477d080ef88330ef961f41042cedba627fd5`，并保留原 run/artifact/hash 绑定校验。

源码中额外修正了新客户端读取 final Candidate 的能力，该修复不在现有 1.0.10 包内，随下一客户端版本交付。现有 1.0.10 仍可读取 Stable 更新及 V3 rc Candidate；旧 Shell 的 V2 Candidate 检查可发现本次 1.0.10。现有 GitHub Release `insight-v1.0.10` 已标记为 prerelease 且不作为 latest，尚未写入 OSS；应用版本仍为 final 1.0.10。

## 保留的验证限制

慢网或离线时，已有登录态恢复可能等待账号请求重试而暂时不显示窗口（约 10–30 秒）；本轮保留已批准的隐藏恢复方案，不额外增加启动定时器。此前全量 GUI 存在 React 18/19 混用的既有失败，定向行为测试及真实会话回放已通过；不将其表述为全仓 GUI 门禁通过。用户已暂缓 Mac 独立系统用户的原生更新实测，Windows 全局安装不在兼容范围。

## 构建执行

工作流最初为 `disabled_manually`，触发返回 422，没有创建重复run；已为本次已授权构建启用既有手动工作流。正式构建 run：`41398407561`，https://github.com/Overu/deepseek-harness/actions/runs/41398407561 ，源码固定为 `95c1477d080ef88330ef961f41042cedba627fd5`，版本 `1.0.10`、`target=all`、不跳过公证。尚未执行 OSS 发布。

最新本地构建 10/10，通过完整 Host/Client 编译、bundle、Web build 及聚合检查。客户端/打包/发布工具相关 130 项测试通过，安装器与更新控制器补正后另有 58 项定向测试通过。

Windows job `125124710578` 已成功，用时 15m14s，包含现有 DSH runtime smoke、NSIS 构建、collect 与内部 artifact 上传。此项证明安装器真实编译通过，不替代旧 1.0.9 的原生覆盖安装实测。

第一轮 macOS x64 job `125124710599` 成功（31m13s）。ARM64 job `125124710597` 在 ZIP App 的最终 `stapler validate` 遇 Apple CloudKit `NSURLErrorDomain -1005` 断网而失败；同轮 DMG 公证已通过，未放宽验证。已执行同 run `gh run rerun --failed`，复用 Windows/x64 成功 artifact，仅重试 ARM64 及依赖 finalizer，源码与版本保持不变。

第二轮 ARM64 job `125135629256` 成功（29m49s），finalizer 成功（2m21s），同 run attempt 2 最终为 success。已核对 15 个 Release 附件，四份 build JSON 的来源 SHA、平台、版本、runtime 和 manifest 摘要一致。该成功记录保留为构建链验证证据，尚未作为 Candidate 投放。

已用旧 Shell v1.0.9 tag 隔离 reader 对真实 CDN 读取 Stable 与 Candidate；两个渠道当前三个平台均为 1.0.9，并指向相同的原 Shell 包。本次尚无任何 OSS 写入。新仓 OIDC 身份是否被既有 STS 服务放行，将按用户选择在真实 Candidate 发布时验证；不会在拒绝后放宽身份校验。

## 渠道解耦验证与提交

修复提交 `c787c47e78dafdc69d21d8cca93d4a4ef42ccae5` 已正常提交并推送。主线程整体 build 10/10、定向测试 6 文件 78 项、本次修改文件 lint、提交钩子和推送 typecheck 5/5 通过。独立架构复核未发现阻断；额外 critical reviewer 受模型配额限制未完成，主线程继续复核最终实现。修复后源码 reader 对真实 CDN 三平台 Candidate 均验签读取为 1.0.9，每次只提交一份选定指针观测。

全仓 lint 未通过，主要包含固定 Canvas 旧源码及既有测试规则问题；本次修改路径问题已关闭。test:docs 为 18 通过 / 3 失败，doc-sync 为 40 通过 / 3 失败：未改动的 Desktop packaging 翻译配对记录过期、Python uv.lock 的包下载路径被误认成提交哈希、固定快照/同步内置技能的既有术语检查失败。未修改这些无关来源或校验内置技能业务正确性；不把全仓检查表述为通过。

ARM64 Candidate 发布 run：`41409486723`，https://github.com/Overu/deepseek-harness/actions/runs/41409486723 。发布器来源固定为新修复提交，打包来源仍为 `95c1477d080ef88330ef961f41042cedba627fd5`。Stable 发布前公开指针已保存 SHA-512 摘要，之后只读比对。

首轮 Candidate 发布 `41409486723` 在运行时加载时因根 tsconfig alias 绕过隔离依赖而失败，尚未访问 OSS；`f776e236e0` 增加显式隔离 tsconfig。独立临时目录只安装轻量依赖，负对照复现缺少 semver，修正配置成功导入完整发布器。第二次 `41410043205` 到达 GitHub 原 artifact 下载，但因 Actions 下载错误使用 Release octet-stream Accept 而返回 415；同样未访问 OSS。`bed69e8e4f` 按 GitHub API 文档区分两类下载媒体类型，13 项入口回归、定向 lint、build:check 2/2、正常提交/推送钩子通过。两项均为 Insight 自有发布工具修复，不重打客户端、不放宽来源或哈希验证。

## 最终发布阻断与恢复点

`cf074fbe673fd9af8dbc948b25b6230912094122` 增加只含 HTTP 状态、不含 token 或响应正文的诊断，5 项 OSS 测试、定向 lint、build:check 2/2 与正常提交/推送钩子通过。最新 run `41411114860`（https://github.com/Overu/deepseek-harness/actions/runs/41411114860）已经通过全部 GitHub 来源、原 artifact、Release 文件及签名键验证，在首次 OSS metadata 获取之前，网关 STS 接口返回 `HTTP 403`。未启动另外两个平台的相同发布，避免重复触发已知外部拒绝。

旧 Shell `scripts/github-oss-client.mjs` 包含发布调用方，其请求为同一网关、同一 audience、Bearer GitHub OIDC 和空 JSON body；服务端代码不在 Shell 仓库中。旧发布脚本限定原仓 `Boxser567/insight-desktop-shell`、main 分支及旧 workflow；本轮不能据此断言远端一定只缺仓库白名单，仍需查网关授权配置或日志。需要核查新身份：仓库 `Overu/deepseek-harness`、ID `1429559776`、ref `refs/heads/insight`、workflow `Overu/deepseek-harness/.github/workflows/insight-publish.yml@refs/heads/insight`、audience `insight-harness-oss-upload`。

阻断后已从真实 CDN 只读复核：Stable 指针与发布前原始字节完全相同，SHA-512 为 `eO9KA7BjuXusJzuxlwE0OHRwZHN5CN9tyouVDfzg9JzyVxkHdsgV5U9QYYkInvUAQ2G3CN1+NMezOUQhsgFh6w==`；旧 Shell v1.0.9 reader 验签读取三平台 Candidate 全为 1.0.9。无部分 Candidate 或 Stable 投放。

恢复时无需打包：使用当前已修正发布器，`version=1.0.10`、`source_commit=95c1477d080ef88330ef961f41042cedba627fd5`，先执行 `target=darwin-arm64`；成功后执行 `darwin-x64` 与 `win32-x64`。随后旧 Shell reader 以 `--track=candidate --expectedVersion=1.0.10` 验证三平台，并再次比对 Stable 指针。禁止使用 `target=stable`。客户端原生覆盖安装和 macOS 独立用户的真实更新仍按此前决定留待后续验收，不以清单发现验证替代。

## 旧 Shell 网关调用复核与明确原因

旧完整调用链为 `.github/workflows/publish-update-v2.yml` → `scripts/publish-update-v2-to-oss.mjs` → `scripts/github-oss-client.mjs`。发布 job 使用 `id-token: write` 和 `desktop-release` Environment；脚本向 Actions 的 OIDC URL 请求 `audience=insight-harness-oss-upload`，再将返回 Token 作为 Bearer，使用 JSON Accept/Content-Type 与 `{}` 请求同一 Gateway STS 接口。取得目录级临时凭据后才创建 ali-oss 客户端上传对象；签名私钥不用于网关鉴权。

[旧 STS 设计](../plans/2026-09-09-desktop-update-sts-publishing-design.md) 的 GitHub OIDC 白名单明确列出原 Shell 仓库与验证仓库，并要求服务端允许相应 ref/workflow 与 Environment sub。新版迁移时少了显式 JSON Accept，已在 `a0a44f61fbe212359fb9864cc49c7ce9aa64b3ff` 补齐；同时对齐安全机器错误码诊断，5 项 OSS 回归、定向 lint、build:check 2/2 和提交/推送钩子通过。

最终真实复测 [run 41412071589](https://github.com/Overu/deepseek-harness/actions/runs/41412071589) 返回 `HTTP 403; code=GITHUB_REPOSITORY_FORBIDDEN`，明确是网关拒绝当前仓库身份。失败仍在首次 OSS metadata 读取前，无对象上传或指针修改。新仓身份应由网关服务端放行，不得用脚本伪装原仓 claims；环境 sub 为 `repo:Overu@2271569/deepseek-harness@1429559776:environment:desktop-release`。所需仓库 ID、ref、workflow 和 audience 见上一节。等待后端配置位置或服务端完成放行后继续，本次不再重复触发相同拒绝。

## OIDC 配置核对补充

2026-11-02 只读查询新仓 `/actions/oidc/customization/sub` 得到 `use_default=true`、`use_immutable_subject=true`、`sub_claim_prefix=repo:Overu@2271569/deepseek-harness@1429559776`。结合工作流使用的 `desktop-release` Environment，网关 sub 条件应按带 ID 的格式配置，不能套用旧 Shell 的名称格式；本报告此前名称格式已更正。格式规则见 [GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims)。

`insight-harness-oss-upload` 是项目约定的 audience，旧 Shell 在 `scripts/github-oss-client.mjs` 中声明常量并作为 OIDC URL 的 `audience` 参数传给 GitHub；新发布器已使用相同值。它不是仓库 Secret 或阿里云颁发的凭证，无需在 GitHub 控制台另建同名配置。网关应校验 Token 中的 aud 与该约定一致，并在现有身份白名单中追加新仓 ID 与所选 workflow/ref/event/Environment sub。实际服务端配置项名称仍需从网关代码定位，可搜索 `GITHUB_REPOSITORY_FORBIDDEN` 找到拒绝分支。

## 配置调整后的重试

用户告知已配置后，未改代码、未重新打包，重跑 `41412071589` 的失败 job（attempt 2、job `125191322059`）。输入仍为 `1.0.10` / 原打包来源 `95c1477d080ef88330ef961f41042cedba627fd5` / `darwin-arm64` Candidate。耗时 2m37s，2026-11-02 17:20:36（北京时间）仍返回 `HTTP 403; code=GITHUB_REPOSITORY_FORBIDDEN`，发生在取得 STS、访问 OSS 之前。测试域名仍为 `gapi-test.insight-aigc.com`，已请求核对实际配置项及生效环境；未盲目重试或启动另外两平台发布。

## STS 放行后的 OSS SDK 适配修复

用户手动 rerun 的 attempt 5（job `125200399014`）于 2026-11-02 17:42:27（北京时间）在 `desktop/releases/v1.0.10/targets/darwin-arm64/insight-target.json.sig` 报 `TypeError: Must provide String/Buffer/ReadableStream for put.`。此时已通过网关和 STS，错误来自 ali-oss 6.23.0 的 put 入参：签名字节为普通 Uint8Array，而 SDK 只接受 Buffer、文件路径或可读流。旧 Shell 小文件以文件路径上传，因此没有该类型差异。

`40a6a602bf7666667161b121d0ec266c8cc8bdbf` 仅在 Insight OSS 适配层将内存对象和指针字节转换为 Buffer，并收紧私有 SDK 方法类型；文件路径/大包分片、签名内容、不可变对象校验和 CAS 保持原规则。先将回归 mock 按真实 SDK 拒绝 Uint8Array，观察原代码同样失败；修复后 4 文件 42 项发布回归、定向 lint、build:check 2/2 和正常提交/推送钩子通过。未重新打包或修改官方 DSH 文件。

新 [ARM64 Candidate run 41423530950](https://github.com/Overu/deepseek-harness/actions/runs/41423530950) 使用修复后的发布器，仍固定原打包来源 SHA。既有不可变对象需逐一回读校验后复用，不覆盖或删除；只有全部对象校验通过才切换 Candidate 指针。旧 run 的 rerun 固定旧提交，无法加载此修复，因此使用新 workflow_dispatch。

## OSS 指针条件覆盖限制：待确认单发布入口

`41423530950` 中 Buffer 修复通过，ARM64 全部不可变对象完成上传或复用并回读校验，最后 `desktop/candidate-v2/darwin-arm64/current.json` 的 PUT 被 OSS 返回 `NotImplementedError: A header you provided implies functionality that is not implemented.`。阿里[官方说明](https://www.alibabacloud.com/help/en/oss/user-guide/0017-00000245)明确 PutObject 不支持 If-Match/If-None-Match；此前迁入发布器的 CAS 假设不成立。独立架构复核同样确认 CopyObject 条件只约束源对象，不能替代目标 CAS。

最小待确认方案按旧 Shell commitPointer：保持同 target 的工作流串行，实际写入前重读并精确核对最初指针、单次替换、写后从 OSS 回读校验；首次创建可以使用 OSS 支持的 x-oss-forbid-overwrite。该方案并非原子 CAS，必须确认同一指针只有新仓发布，旧仓同通道发布工作流停用，不能把跨仓 GitHub concurrency 当成共享锁。本次自动审批拒绝先行移除条件写保护，理由是用户尚未确认单一发布者或接受并发风险；主线程已停止相关修改和远端写入，等待具体确认。部分方案草稿保留在未提交工作树，未推送；OSS 适配层删除条件头的编辑没有执行。

失败后只读核对：Stable 指针仍与原始字节相同，旧 Shell reader 验签读取三个 Candidate 全部仍为 1.0.9。1.0.10 ARM64 不可变对象已暂存，但尚未通过通道投放；未构建新包、未发布 Stable。用户确认后再完成最小方案、回归和独立审查，并使用新发布 run 续发。

## 单发布入口确认与实施

用户已明确选择“采用 Shell 方案，新仓唯一发布”，并允许停用旧 Shell 的 publish-update.yml、publish-update-v2.yml，保留构建。此前自动审批所指出的缺失授权已补齐。

实际停用并回读确认：`Boxser567/insight-desktop-shell` 的 workflow `353770282`、`364446777`，以及 `Overu/insight-desktop-shell` fork 的 `398953699`、`398953698` 均为 disabled_manually。两仓构建、签名、CI workflow 保持 active；查询最新 100 条记录未发现未完成的旧发布。此次仅改变 workflow 启停状态，未修改旧仓构建源码或删除已有制品，后端旧仓 STS 授权未作撤销。

`a7088fdb63c0d04499fdf4d50ae31d0e73b40b0f` 已正常提交/推送：publisher在实际指针写入前重读存在性、完整 bytes 与 ETag，不一致即中止；覆盖只做一次 PUT，首次创建使用 x-oss-forbid-overwrite，异常不重试，成功后必须从 OSS 回读字节相同。文档明确该替换非原子，依赖单发布者与按目标串行。不可变对象及 SHA-512、来源绑定不变。独立高风险审查通过，5 文件 48 项测试、定向 lint、build:check 2/2、提交钩子与推送 typecheck 5/5 通过；没有重新构建客户端。

新 [ARM64 Candidate run 41425978182](https://github.com/Overu/deepseek-harness/actions/runs/41425978182) 使用该发布器，仍固定原打包源码 `95c1477d080ef88330ef961f41042cedba627fd5`。成功后再发布另外两平台；本次禁止 Stable。

## Candidate 实际投放

ARM64 [run 41425978182](https://github.com/Overu/deepseek-harness/actions/runs/41425978182) 成功，耗时 4m23s。旧 Shell v1.0.9 tag reader 对公开 CDN 验签并解析 Candidate 为 `1.0.10`，payload 为 `insight-1.0.10-mac-arm64.zip`，`semver.gt(version, '1.0.9')` 为 true。其余两平台当时仍为 1.0.9。

随后沿用相同发布器及原打包 SHA，分别触发 macOS x64 [run 41426684691](https://github.com/Overu/deepseek-harness/actions/runs/41426684691) 和 Windows x64 [run 41426716208](https://github.com/Overu/deepseek-harness/actions/runs/41426716208)，目标均为 Candidate，互不写入相同指针。待两者完成后统一复核三平台可发现升级及 Stable 未变。

## 最终交付结果

| 平台 | Candidate 发布 run | 结果 | 旧 Shell 1.0.9 reader |
| --- | --- | --- | --- |
| macOS arm64 | [41425978182](https://github.com/Overu/deepseek-harness/actions/runs/41425978182) | success | 验签并发现 1.0.10，版本比较为可升级 |
| macOS x64 | [41426684691](https://github.com/Overu/deepseek-harness/actions/runs/41426684691) | success | 验签并发现 1.0.10，版本比较为可升级 |
| Windows x64 | [41426716208](https://github.com/Overu/deepseek-harness/actions/runs/41426716208) | success | 验签并发现 1.0.10，版本比较为可升级 |

最终三平台发布器均为 `a7088fdb63c0d04499fdf4d50ae31d0e73b40b0f`，打包来源仍为 `95c1477d080ef88330ef961f41042cedba627fd5`，复用 [insight-v1.0.10](https://github.com/Overu/deepseek-harness/releases/tag/insight-v1.0.10) 的原始制品与来源记录。没有替换 tag、覆盖 GitHub Release 附件或重签名。更新源只推进 Candidate V2 三个平台指针，未写 Stable 指针或 release 索引。

最终旧 Shell tag reader 使用 `--track=candidate --expectedVersion=1.0.10` 全部通过；所选 payload 为 `insight-1.0.10-mac-arm64.zip`、`insight-1.0.10-mac-x64.zip`、`insight-1.0.10-win-x64.exe`，三者相对 1.0.9 均为更新。新版源码 reader 也对相同公开 CDN 的签名、目标 manifest、metadata 与 payload 绑定验证通过，每个平台仅接受一次选定指针观测。Stable 指针再次回读与原始快照字节完全相同，仍为原 1.0.9 投放。

上述证据覆盖发布、制品来源和完整性、清单验签及版本发现；没有运行真实客户端下载安装或跨系统覆盖升级，也未访问现有账号数据。当前 1.0.10 包内仍是原构建时的 Candidate reader；源码中的 final Candidate 双协议读取修复将随下一客户端版本交付，本轮按用户决定不重建。旧 Shell 的手动五连击 Candidate 检查读取 V2；普通自动检查继续读取未改变的 Stable。

旧 Shell 原仓和 fork 的两个发布 workflow 保持停用，构建/签名 workflow 保持启用。后续维护必须保持新仓为唯一通道发布入口，不能同时恢复旧仓发布。后续若转 Stable，可以在另行授权后复用本次相同制品，不需重建；本轮止于 Candidate。

## P5 收口决定与 P6 转交

用户报告 macOS arm64 从旧版 1.0.8 升级到 Candidate 1.0.10，目前看起来成功。历史会话、工作区、插件及配置未逐项确认；macOS x64、Windows x64 交第三方验证。按最新决定，这些验证后续跟进，有问题作为 bug，不再阻断进入 P6，不将未验证改写为通过。

随包 `dsh` CLI 的安装/命令入口不属 Insight 产品，不适配；本轮不删除官方 CLI，Agent shell、Memory 外部 CLI、技能脚本和随包 Node 能力仍保留。P5 文档已收口，当前交付结论见 [P5 交付报告](2026-10-30-dsh-insight-p5-delivery.md)，结构、数据流、风险和后续步骤见 [P6 交接依据](2026-11-02-dsh-insight-p6-handoff.md)。可以进入 P6，代码退役尚未开始。

下一个自然客户端版本仍需交付已完成的 Candidate 双协议 reader；现有 1.0.10 包不包含，不能覆盖同版本制品。其 Candidate 读取仅 V3，交付修复时可走 rc 通路或手动安装，不能假定它会发现 final V2 Candidate。新客户端再次升级、数据核对和更新失败/取消/恢复的人机验证作为后续反馈项，不新建资格阶段。

Stable 实际投放仍需另行授权，用户当前范围明确只发 Candidate。CI 进一步提速是可选优化，不为此额外打包；Windows 全局安装兼容、旧定时任务、Insight i18n、已撤回的 sidebar 调整和内置技能内容校验保持范围外。历史未通过的检查保留原记录，不随阶段收口改成通过。
