> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# Insight P5 发布与更新补充计划

日期：2026-10-30（Asia/Shanghai）。状态：本页是 P5 实施前的历史计划，仅用于核对原始要求，不代表当前实现或验收进度。最新状态与待办以 [2026-11-02 Candidate 执行记录](2026-10-30-dsh-insight-p5-delivery.md) 为准。计划基线为 DSH insight `675192ea4b`，当时报告归档为 Shell `85dccff`。

## 1 已确认要求

| 项目 | 决定 |
| --- | --- |
| 版本 | 对齐 Shell 当前产品基线 `1.0.9`；首个新客户端内测包为 `1.0.10-rc.1`；DSH runtime 保持独立版本 |
| 构建依据 | 以 DSH 构建、runtime 装配、打包及平台签名实现为主，不迁入旧 Core 发布链 |
| 发布依据 | 参考 Shell 的 GitHub Release 取包、签名元数据、OSS 上传及渠道发布；保留必要验证，简化操作步骤 |
| Workflow | 两个用户入口：构建并保存 GitHub Release；从该 Release 发布到阿里 OSS，不重新构建 |
| 仓库 | `Overu/deepseek-harness`，产品源码为 `insight` 分支；不改官方默认产品发布行为 |
| 内测入口 | 沿用 Shell：更新窗口内的产品图标在 3 秒内点击 5 次，确认后发起一次内测检查 |
| 后台检查 | 只自动检查正式版；不因保存 candidate opt-in 就自动轮询内测。此决定替代此前“开启后自动发现内测”的要求 |
| rc 支持 | 新客户端及新发布适配支持 rc；不继承 Shell V2 只允许 final SemVer 的限制 |

五连击只触发检查，不代表同意下载或安装。保留原来的内测风险确认和 candidate opt-in 记录；正式版及内测版保持相同安装身份和账号目录，避免产生两份用户数据。

## 2 两阶段 workflow

建议新增 Insight 专属 `insight-package.yml` 与 `insight-publish.yml`，不改官方 workflow 的默认分支、COS 发布策略或自托管 runner 配置。文件名是待实现方案，不表示当前仓库已有这些工作流。

```text
固定 insight 源码提交 + 产品版本
       ↓
构建 workflow：DSH 构建与打包 → 平台签名/公证 → 校验
       ↓
GitHub Release：安装包、更新附件、版本/来源/摘要清单
       ↓
发布 workflow：下载同一批附件 → 验证 → OSS 不可变对象
       ↓
核对下载内容 → 最后更新正式/内测渠道指针 → CDN 可见性检查
```

### 2.1 构建阶段

输入尽量只保留产品版本和目标平台；来源固定为可信 `insight` 提交。构建开始记录完整 commit，后续 job 不重新解析会移动的分支。首个版本为 `1.0.10-rc.1`，建议 Release tag 使用 `insight-v1.0.10-rc.1`，与官方 DSH tag 隔离。

macOS arm64、macOS x64、Windows x64 分目标构建，允许仅构建所需目标。默认使用托管 runner；如果现有 Windows 签名方式必须使用指定机器，先核对后接入，不把官方自托管 runner 标签照搬到 Insight。macOS 复用 DSH 原有签名、公证和资源校验；签名信息来自 GitHub Secrets，经适配写成运行期间的文件路径。

Release 保存签名后的原始安装包、DSH updater 所需附件及摘要/来源清单。macOS 的 DMG 用于手动安装，ZIP 等更新附件按 DSH 当前实际输出保留；Windows 保留安装器及其更新附件。`rc` 标记为 GitHub prerelease，不成为 latest 正式版本。缺失目标不得冒充完整三平台发布。

构建 workflow 不访问 OSS，不切线上更新指针。签名、公证和产物验证均在保存 Release 前完成。

### 2.2 发布阶段

用户选择已完成的 Release 与正式/内测渠道。下载并验证对应提交、版本、平台、签名和摘要后，参考 Shell 的发布顺序上传：不可变对象 → 核对远端内容 → 签名元数据 → 渠道指针。同一渠道发布串行，重试同一版本不得覆盖不同字节。

发布阶段不构建源码、不重新安装整个 DSH workspace、不再次签名安装包或提交 Apple 公证；只安装发布脚本实际使用的依赖。新客户端的下载、进度、安装和重启协调继续由 DSH 拥有，避免再迁入 Shell UpdateManager。

`rc` 只进入内测渠道，正式渠道仅接受正式版本。相同版本只改变发布归属时复用已有制品；`1.0.10-rc.1` 到 `1.0.10` 是版本变化，需要正式版构建，不能把 rc 包改名当作正式包。发布环境与用户渠道分别管理，内测不意味着切换登录或业务 API 环境。

## 3 rc 和旧客户端兼容限制

新客户端及新发布适配使用完整 SemVer，验证 `1.0.9 < 1.0.10-rc.1 < 1.0.10`，并按渠道限制版本选择。不能将 rc 的显示版本、清单版本和包内版本分别伪装成不同值绕过校验。

已安装旧 Shell 的 `v2-release-contract.ts` 在 rollout、index、target manifest 上调用 `assertFinalVersion()`，明确拒绝 prerelease；旧构建/发布脚本也有限制。因此“新客户端支持 rc”和“旧 Shell 能自动识别 rc”是不同事项，不能通过修改新仓修复已发出的旧二进制。用户已明确不沿用该限制，新实现不得把它复制进来。

首个 rc 可用于手动覆盖安装及新客户端之间更新验证。旧 Shell 自动原地升级的正式路径按 `1.0.10` 验证；若要求旧 Shell 直接自动升级到 `1.0.10-rc.1`，仍需另行确定旧客户端过渡方案，不能作为当前已保证的能力。现有 OSS 的旧 V2 命名空间不发布旧读取器无法理解的 rc 元数据；新客户端的 rc 来源通过 Insight 发布适配与旧协议区分，具体接入文件范围在实现前核对。

## 4 macOS 签名配置

配置仓库是 [Overu/deepseek-harness](https://github.com/Overu/deepseek-harness)。建议在 `Settings → Environments → New environment` 创建 `desktop-release`，在其 Environment secrets 中添加下表；新工作流相应 job 显式声明 `environment: desktop-release`。也可以放在 `Settings → Secrets and variables → Actions → New repository secret`，两处择一，避免同名旧值相互遮盖。Shell 仓库已有的 Secret 不会自动继承到新仓。

| 类型与名称 | 用户准备的值 |
| --- | --- |
| Secret `DESKTOP_CSC_LINK` | 原 Insight 使用的有效 Developer ID Application 身份，证书与私钥一起导出为 `.p12`，填写整个文件的单行 Base64 |
| Secret `DESKTOP_CSC_KEY_PASSWORD` | 导出该 `.p12` 时设置的密码 |
| Secret `DESKTOP_APPLE_API_KEY` | App Store Connect 公证 API Key `.p8` 文件原文，保留 PEM 首尾行和换行；与现有 Shell 的输入形式一致 |
| Secret `DESKTOP_APPLE_API_KEY_ID` | `.p8` 对应的 Key ID |
| Secret `DESKTOP_APPLE_API_ISSUER` | 对应的 Issuer ID |
| Secret `DESKTOP_APPLE_TEAM_ID` | 原 Insight 签名所属的 10 位 Team ID |
| Variable `DSH_DESKTOP_MACOS_SIGNING_IDENTITY` | 证书名称去掉 `Developer ID Application:` 前缀后的部分，例如 `Company Name (ABCDEFGHIJ)`；与证书和 Team ID 一致 |

环境变量可以放在 `desktop-release` 的 Environment variables；若使用仓库级配置，则位于 `Settings → Secrets and variables → Actions → Variables`。

准备 `.p12` 的 Base64 可在自己的 Mac 执行 `base64 -i /path/to/developer-id.p12 | tr -d '\n' | pbcopy`，再粘贴到 Secret；不要将证书、私钥或密码提交到仓库、Release 或聊天。仅有 `.cer` 且不含私钥不能完成签名。优先复用原 Insight 的有效签名身份，保持 Team ID、应用 ID 及嵌套 Helper 身份的升级连续性。

工作流负责将证书解码为临时 `.p12`，将 `.p8` 原文写到临时文件，分别传给 DSH 的 `CSC_LINK` 和 `APPLE_API_KEY` 路径输入；Team ID 映射到 `DSH_DESKTOP_MACOS_TEAM_ID`，身份变量按 DSH 要求不带前缀。临时 keychain 密码由构建生成，清理文件和 keychain 复用 DSH 实现。用户无需为此准备独立 keychain 文件。

当前计划是 Developer ID 的 DMG/ZIP 分发，不做 Mac App Store 上传或新增 PKG；不照搬 iOS 的 provisioning profile 清单。若实际 entitlement 需要额外 profile，再根据 DSH 打包配置具体核对。签名和公证覆盖主应用、Helper、随包运行时和安装介质的实际输出。

## 5 OSS 和更新签名配置

保留当前 OSS/CDN，不改为官方 COS。Shell 的 `github-oss-client.mjs` 同时校验仓库名、数字仓库 ID、分支、事件和 workflow ref，目前固定为 `Boxser567/insight-desktop-shell`。迁入新仓除了修改客户端声明，还必须请后端维护者在现有 OIDC→STS 服务中允许新仓库 ID、`insight` 可信 ref、发布 workflow ref 和对应 environment。只在 GitHub 填 Secret 不能解除这项限制；不通过关闭身份校验解决。

OSS 继续使用短期 STS，不要求新增长期 OSS AccessKey Secret。渠道签名如沿用旧公钥验证，需要在同一环境准备现有 `DESKTOP_UPDATE_SIGNING_PRIVATE_KEY`，只由发布 job 读取；它与 Apple 签名证书、`.p8` 公证 Key 是三种不同用途的材料，不能互相替代。不得未经旧客户端兼容设计就生成新密钥覆盖旧信任。

## 6 构建耗时控制

- 每个目标只调用一次 DSH 打包入口；入口已包含构建时，不在 workflow 外再跑一遍完整 build。
- 去掉旧 Shell initialize 中重复的安装、构建和 Core runtime 准备；初始化仅做轻量版本/来源检查。
- 复用 pnpm store、Electron 下载及 DSH 已有运行时缓存；缓存键包含平台、架构、依赖锁、工具版本及必要源码输入，不跨架构复用原生产物。
- 目标平台并行，保留单平台重试；不为了失败的一个平台重建成功平台。
- 压缩过的安装包上传 GitHub 时关闭重复压缩；优先采用 DSH 已有较快 ZIP 压缩配置，并记录包体与耗时。
- 发布和正式/内测指针变更只复用 Release 字节；不再打包、公证。
- 按本次发布改动选择必要检查；不在每个目标重复全仓测试。保留产物、签名、公证、版本和来源校验，不以跳过它们换速度。

首轮记录依赖安装、构建、runtime 装配、签名、公证、压缩和上传的耗时，再针对瓶颈优化；目前没有真实 workflow 耗时证据，不预先承诺分钟数。

## 7 P5 实施与验收顺序

1. 冻结产品版本来源、rc/正式渠道和 Release 清单；列出必要官方 Desktop 接入范围，按既定规则先取得具体修改授权。
2. 接通两阶段工作流与签名配置，先完成单平台签名 rc 制品，再补齐其余目标。
3. 实现 Insight 来源与 OSS 发布适配，验证 rc 手动发现、签名/摘要/目标绑定，以及新客户端的后续更新。
4. 保留五连击行为和旧 opt-in 数据，验证普通后台不会检查内测，检查不自动下载/安装。
5. 验证正式版本从旧 Shell 原地升级、再升级到下一版；检查旧进程退出、账号 Home、工作区、历史、插件及设置不被安装器清理。
6. 验证失败、取消、未知安装结果及恢复，记录各平台实际结果；真实线上投放单独由用户决定。

本计划不关闭 P3 的既有功能验收项。打包或发布适配通过，也不代表未验功能可以随包投放。

## 8 源码和官方配置依据

- Shell：[五连击入口](#historical-source-1)、[主进程确认和 opt-in](#historical-source-2)、[内测仅手动检查](#historical-source-3)、[旧 V2 final 限制](#historical-source-4)。
- Shell：[构建 workflow](#historical-source-5)、[发布 workflow](#historical-source-6)、[OSS OIDC 客户端](#historical-source-7)。
- DSH：[macOS 打包入口](../../../../../apps/desktop/scripts/package-target.ts)、[临时签名 keychain](../../../../../apps/desktop/scripts/macos-signing-keychain.mjs)、[签名/公证参数](../../../../../apps/desktop/scripts/desktop-release-environment.mjs)。
- 官方：[GitHub Secrets 配置](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)、[GitHub macOS 证书配置](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)、[Apple Developer ID 证书](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)、[electron-builder 公证配置](https://www.electron.build/docs/notarization/)。


## 迁入时保留的历史源码位置

以下是原报告引用的旧仓源码或当时本机构建证据，不是当前安装包依赖；未将旧仓业务源码复制到文档目录。原始目标同时记录在导入清单中。

<a id="historical-source-1"></a>

- `insight-desktop-shell:src/renderer/src/UpdateApp.tsx`

<a id="historical-source-2"></a>

- `insight-desktop-shell:src/main/index.ts`

<a id="historical-source-3"></a>

- `insight-desktop-shell:src/main/update/update-manager.ts`

<a id="historical-source-4"></a>

- `insight-desktop-shell:src/main/update/v2-release-contract.ts`

<a id="historical-source-5"></a>

- `insight-desktop-shell:.github/workflows/release-v2.yml`

<a id="historical-source-6"></a>

- `insight-desktop-shell:.github/workflows/publish-update-v2.yml`

<a id="historical-source-7"></a>

- `insight-desktop-shell:scripts/github-oss-client.mjs`
