> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# P5 签名与公证构建最小接入

> 历史阶段记录：下文的阶段状态、待授权描述和运行结果保留当次背景，不代表当前进度。当前状态见 [P5 收口](2026-10-30-dsh-insight-p5-delivery.md)，下一阶段见 [P6 交接](2026-11-02-dsh-insight-p6-handoff.md)。历史失败保留，不将未复验项记为通过。

日期：2026-10-31。状态：本轮构建完成。commit `a0fc21925f1e213c2a9bc06fe7c57ec6659a97ab` 的 [run 41150548471](https://github.com/Overu/deepseek-harness/actions/runs/41150548471) 已通过两个 macOS 架构、Windows x64 和 Release 汇总；[`insight-v1.0.10-rc.1`](https://github.com/Overu/deepseek-harness/releases/tag/insight-v1.0.10-rc.1) 已公开为 prerelease。OSS 未发布，当前交付状态见 [P5 交付报告](2026-10-30-dsh-insight-p5-delivery.md)。

签名与公证所需六项 Secret 及签名身份 Variable 已在 GitHub `desktop-release` 环境配置完成。发布更新另需的 `DESKTOP_UPDATE_SIGNING_PRIVATE_KEY` 也已通过用户授权的一次性密文迁移写入，因此新仓该 Environment 现有七项 Secret。`DESKTOP_CSC_LINK` 已在验证证书叶子、私钥和 Team ID 后更新为同一叶子/私钥并补齐公开 Apple G2 中间链的副本，用户提供的原始 P12 文件未修改。目标为 `1.0.10-rc.1` 完整签名、公证的 GitHub Release 制品；仅显式调试模式允许跳过公证，调试产物不具备渠道发布资格。真实 App 与 DMG 公证分别在 299.83 秒和 303.94 秒完成，没有出现 Apple 协议拒绝。

## 已授权的具体改动范围

| 文件 | 必要改动 |
| --- | --- |
| `apps/desktop/scripts/electron-builder-config.mjs` | 允许完整签名、公证的 Insight macOS 包；为 Insight 写入 OSS generic updater 载体与所需产品资源，不携带官方 COS feed 或官方强更配置；Windows 继续使用 DSH/NSIS，并只在 Insight 产品分支选择专用品牌资源与产品名 |
| `apps/desktop/scripts/desktop-package-environment.mjs` | 校验 Insight 固定 appId 和独立更新来源，不再要求官方 COS/强更服务；证书、公证凭据、Team ID、目标平台及其他打包检查仍执行 |
| `apps/desktop/scripts/package-target.ts` | 使用产品解析结果定位 `因赛AI.app`、生成正确制品路径；Insight 的完成记录与官方发布记录分开，维持独立产品/runtime 版本 |
| `apps/desktop/scripts/package-macos.ts` | 在现有并行公证链中使用产品应用名、Insight 文件名前缀和已验证 updater 配置；复用原有复制、公证、签名验证与两条 lane 的收尾 |
| 对应声明、测试与基线记录 | 同步受影响配置声明；覆盖完整签名和调试模式、错误 appId/公证配置拒绝、官方行为、产品路径及资源校验 |

新增 Insight CI 适配负责向现有文件配置传入 `DSH_DESKTOP_APP_ID=com.insight-aigc.desktop`，与 builder 的外层身份一致。现有 `prepare-dsh.ts` 会用该值签名随包运行时，不必为此修改签名缓存或原生签名执行器；增加配置一致性验证。

## 不修改的路径

不改变临时 Keychain、原生签名缓存、签名校验和 bundled-skills。未公证包继续进入 DSH 既有 `unnotarized-artifacts` 输出，不写 distribution 完成记录；产物清单明确为 debug-signed，发布端拒绝。Insight 业务版本和 OSS 解析放在新增产品模块，官方文件只接入必要选择点，不修改官方工作流或把官方产品改为 OSS。

## Apple stapler 维护依赖升级（已实施并通过三平台 CI）

`@electron/notarize` `2.5.0` 的 staple 路径虽然使用 `promiseRetry`，但回调没有调用 `retry`，因此实际只执行一次。上游已在 [PR 306](https://github.com/electron/notarize/pull/306) 修复，并随 [`v3.1.2`](https://github.com/electron/notarize/releases/tag/v3.1.2) 发布。官方 `apps/desktop/package.json` 已把依赖升级到 `3.1.2`，`pnpm-lock.yaml` 已同步；没有新增 Insight wrapper 或 hook，也没有修改官方 notary executor。

上游继续按签名、提交并取得 `Accepted`、staple 的顺序执行。`3.1.2` 对同一 artifact 先执行一次 staple，失败后最多再执行三次，默认间隔为 1、2、4 秒；公证 submission 仍只有一次。恢复保留在原 `packagingStep` 内，因此既有执行与审计归属不变，不重新提交公证、重新编译或重跑整条 lane。

`3.x` 要求 Node `>=22.12`、只提供 ESM 并移除 `altool`；当前仓库使用 Node 24、`.mjs` 配置和 P8/notarytool 调用，与这些要求兼容。自定义 logged notarytool path 和根级 `NotarizeOptions` 仍保留。

该升级会改变所有 DSH 与 Insight macOS 打包的默认 stapler 行为：任意 staple 失败都最多再尝试三次，默认退避为 1、2、4 秒；不新增独立硬墙钟预算，继续受既有外层约束。全部尝试最终失败时，原 lane 仍失败；签名、公证提交、完整 `codesign`、`stapler validate`、`spctl` 与生成 ZIP 的顺序和门禁均不放宽。

真实 installed-dependency 回归共五项，覆盖 App 与 DMG 调用、自定义 logged notarytool path、一次 submission 最多四次 staple、`Rejected` 不进入 staple 重试、cleanup，以及最终验证与 ZIP 顺序不变。最终独立复审无阻断；精简工作流的两个 macOS 架构均已完成签名、公证与最终验证，Windows 和 Release 汇总也全部成功。

## 已实施的官方接入

用户授权的 Windows 品牌和 DMG 后置验证恢复严格限制在四个官方文件，现已实现并通过本地定向测试与最终独立审查。DSH 基线记录登记了精确范围与保留条件；三平台真实 CI 已由 run `41150548471` 验证通过。

| 官方文件 | 已实施改动 |
| --- | --- |
| `apps/desktop/scripts/electron-builder-config.mjs` | 仅在 Insight 产品分支向 PowerShell 传入专用 assets 目录；对 `readInstallerLocales` 的字符串映射把固定的 `DeepSeek Harness` 替换为已解析 `productName`，再交给既有 `renderInstallerStrings` 完成 NSIS 转义 |
| `apps/desktop/scripts/prepare-windows-installer.ps1` | 增加可选 `AssetDirectory`，未提供时继续使用官方 assets；不改变 DSH/NSIS 执行路径 |
| `apps/desktop/installer/extract-report.h` | 让 Insight 构建把已解析产品名注入 `Compose` 报告首行；默认 DSH 标题不变，解压和安装逻辑不变，不修改 C++ 调用方 |
| `apps/desktop/scripts/verify-macos-signature.mjs` | 只对满足精确 CloudKit `-1005` 条件的 DMG 后置只读 `stapler validate` 做有界重试 |

Windows 不修改 `installer-locales.mjs` 或其 API，也不改变 appId、GUID、per-user 安装、许可文本和官方默认路径。Integration 已从既有 app icon 生成并检查五张固定 PNG：600×196 的浅色与深色品牌图、1200×392 的对应 2x 图，以及 164×314 的卸载侧栏图；资源位于 `packages/insight/desktop-integration/resources/installer-assets`，不增加新的构建期图片生成步骤。定向测试覆盖 Insight 资产、产品名和解压报告标题生效，以及官方默认资产、字符串和标题保持不变；现有 NSIS 转义继续执行。

### DMG 后置验证瞬断重试

run `41101445899` 的 ZIP App 公证链成功；DMG 的 `notarizeMacOS` 已返回，随后 DSH 在 `verifyMacOSDiskImage` 中额外执行的只读 `xcrun stapler validate` 遇到 status 68、`NSURLErrorDomain`、`Code=-1005` 和 `api.apple-cloudkit.com`，整条 job 因此失败。这是公证完成后的 DSH 验证命令瞬断，不是 `@electron/notarize` `3.1.2` 内部 staple 重试失效。重跑整条约 30 分钟的 job 可以重新触发验证，但恢复范围远大于失败命令。

生产实现只修改 `apps/desktop/scripts/verify-macos-signature.mjs`。正常非零退出错误在私有结构中保留 `message`、`status` 和 `diagnostic`；spawn 失败和 signal 退出保持不同错误类型，不参与本重试。`verifyMacOSDiskImage` 仅在同一个 DMG 路径的 `xcrun stapler validate` 同时满足 status 68、诊断含 `NSURLErrorDomain`、精确 `Code=-1005` 和 `api.apple-cloudkit.com` 时重试。总计最多三次验证，前两次失败后分别用 `Atomics.wait` 同步等待 2 秒和 5 秒，以保持现有同步 API；任一次成功后继续原有 `spctl`，三次均失败时直接抛出最后一个原始错误，不包装或提升错误。

该实现不重新提交公证、不签名、不 staple，不重跑 App 验证、`codesign`、`spctl` 或整条 lane，也不增加配置、框架或命令级 timeout。App 的 `stapler validate` 不重试。默认行为会同时影响 DSH 与 Insight 的 DMG 后置验证，而不只影响 Insight。两段等待最多新增 7 秒；两次额外命令本身仍由既有外层 job timeout 约束，因此不能把总额外耗时表述为 7 秒硬上限。已经失败的 run 不会被修复；当前实现已通过 run `41150548471` 的两个 macOS 架构构建。

测试只扩展现有 `apps/desktop/tests/macos-disk-image-signature.spec.ts`。覆盖第一次、第二次和第三次成功；三次耗尽时不执行 `spctl` 并抛最后错误；四个匹配条件分别缺失时不重试；spawn 与 signal 错误不重试；App 验证不重试；既有错误文案保持；等待 mock 精确收到 `[2000, 5000]`。不新增独立重试模块或测试框架。

本节的架构、实现和最终独立关键审查均已完成，范围严格限于表内四个官方文件及其必要测试。本地检查与新的三平台真实 CI 均已通过。

## 验证

真实 macOS arm64 完整打包命令退出码为 0。Developer ID 应用签名、App 公证与 staple、DMG 公证与 staple 全部通过；最终产物为 276 MiB DMG、383 MiB ZIP、407 KiB blockmap 和 369 B nightly metadata。collector 对四个附件完成摘要及 metadata 精确绑定校验。

从 ZIP 独立解压的 `.app` 通过 `codesign --verify --deep --strict`、`stapler validate` 和 `spctl --assess --type execute`，系统结论为已接受的 Notarized Developer ID；DMG 也通过 `stapler validate` 和 `spctl --assess --type open`，所有命令退出码均为 0。产物 `ProductInfo.plist` 的 application id 为 `com.insight-aigc.desktop`，版本为 `1.0.10rc1`。

notarize installed-dependency 兼容检查与既有本地 arm64 完整打包证据只说明签名材料和接入路径可用，不代替当前源码的三平台 CI。`build:artifacts` 八项后接 `build:check` 两个聚合通过；七个范围文件的六十七项测试和独立文件的十项 stable publisher 测试全部通过，共七十七项。scoped lint、pre-commit 两个文档配对检查、pre-push 五个类型门禁和四文件最终独立审查也通过。精简后的 workflow 已让 macOS arm64、macOS x64 和 Windows x64 执行 DSH 原生 package 命令、collect，并由 finalizer 完成附件回读校验后创建 GitHub Release。

Windows 按产品决定不使用 Authenticode，并继续复用 DSH runtime smoke 与 NSIS 打包。最小 Insight 品牌接入和精确 DMG 后置验证重试已实现并通过本地检查；Windows 的真实 MSVC、System.Drawing 和 NSIS 路径，以及两个 macOS 架构，均已由 run `41150548471` 验证通过。OSS 发布器源码保留，但本轮不调用、不写入 OSS，也不切换渠道指针。

## 当前提交的 CI 结果

| 目标 | Job 结果 | Job 总耗时 | 公证与制品结果 |
| --- | --- | --- | --- |
| macOS arm64 | success | 23 分 49 秒 | Developer ID 签名通过；App 公证与 ZIP lane 316.34 秒，DMG lane 373.53 秒；两条 lane 并行且均通过最终验证 |
| macOS x64 | success | 26 分 13 秒 | Developer ID 签名通过；App 公证与 ZIP lane 391.42 秒，DMG lane 444.46 秒；两条 lane 并行且均通过最终验证 |
| Windows x64 | success | 15 分 9 秒 | Insight 品牌资源通过实际 MSVC、System.Drawing 与 NSIS 打包；runtime smoke、collect、上传通过 |
| Release 汇总 | success | 2 分 48 秒 | 十五个附件经回读校验后公开，目标提交为 `a0fc219…`；未运行 OSS 发布 |

Job 总耗时包含依赖安装、打包、上传和收尾；公证 lane 的耗时也包含各自的制品生成和验证。此次 CI 没有恢复 Windows 覆盖安装资格阶段、Office 观察器或临时诊断脚本。原生安装器界面与更新安装端到端实测未执行，不将构建成功表述为这些实测已经通过。
