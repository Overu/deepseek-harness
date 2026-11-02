> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# 桌面客户端更新与上游管理方案

> 历史设计：版本策略、权限边界与定向采用原则继续保留；早期插件组合和 RC 操作已演进，现行操作以[发布手册](../release-runbook.md)、[v2 操作清单](../releases/update-v2-operator-checklist.md)和[架构](../architecture.md)为准。

## 状态

本文确定因赛AI桌面客户端的整包更新、插件更新归属、版本回退边界，以及本项目与 `dataelement/dsh-desktop` 的长期关系。本文取代“Shell 应定期整体合并 DSH Desktop 主分支”的旧设想。

第一阶段只实现整包更新检查、可信发布元数据、下载、安装、发布产物校验和上游变更筛选。历史版本回退不纳入本阶段；公共插件市场的后续预装决策见 [出厂插件市场设计（历史归档）](../archive/README.md)。

## 产品决策

Insight Desktop 是独立维护的产品分支。`dataelement/dsh-desktop` 只作为参考上游，定期审计其中的修复和设计，不再把其主分支整体合入产品分支。

仓库和 npm 元数据必须使用 Insight 自有地址，不得继续保留上游作者身份。在法定产品主体尚未确认前，删除 `author` 字段比填入未经确认的名称更安全。

该决策不改变 Core 的依赖关系。Insight Harness Core 可以继续通过自身的审查和发布流程吸收 DeepSeek Harness 上游改动；Shell 只消费锁定的 Core Runtime 制品，不会因为 npm 或上游版本变化而自动升级。

```text
DeepSeek Harness 上游
        |
        | Core 仓库审查并适配
        v
Insight Harness Core Runtime Release
        |
        | core-runtime.lock.json + manifest + digest
        v
Insight Desktop Shell Release
        |
        +-- 必需的第一方插件
        +-- Better Sidebar
        +-- 登录与账号隔离
        +-- 未来的画布业务界面
        +-- 整包更新器

dataelement/dsh-desktop
        |
        +-- 参考实现和定向修复来源
            （不再定期整体合并）
```

## 目标

- 把 Shell、锁定的 Core Runtime、必需的第一方插件、默认 Profile 和恢复界面作为一个经过整体测试的发布单元进行更新。
- 启动后经过短暂随机延迟检查更新；运行期间每六小时检查一次；系统长时间休眠恢复后检查；用户也可手动检查。
- 当前阶段不购买 Windows 代码签名证书，仍允许 Windows 安装包下载和安装更新。
- macOS 正式版本继续执行 Developer ID 签名、公证、装订和系统签名验证。
- 使用独立于 Windows Authenticode 的发布签名验证元数据和安装包，避免下载位置被篡改后静默替换安装器。
- 登录前、Core Runtime 启动失败或插件启动失败时，仍可使用更新入口。
- 同时支持可选更新和可信的强制更新。旧版本低于声明的最低支持版本时，允许业务协议或必需插件随整包强制升级。
- 更新后保留账号数据、Harness 会话、用户设置、工作区、资产和用户自行导入的插件。
- 从首个公开版本起使用自有 HTTPS 域名后的 OSS/CDN 更新源；未来替换 Bucket、CDN 或源站时，通过同一域名迁移，不重写客户端更新状态机。
- 继续吸收 DSH Desktop 中有价值的实现，但不恢复其产品身份、Runtime 管理、插件市场、签名硬件或部署服务。

## 第一阶段不做的内容

- Windows Authenticode 或 Microsoft Store 分发。
- 独立于 Shell Release 的 Core Runtime 在线下载。
- 必需第一方插件的独立更新。
- 在整包更新器内实现公共社区插件市场；市场由独立 Profile 插件提供。
- 任意历史版本的自动选择与安装。
- 数据结构降级迁移。
- ModelScope、飞书、`dshdesktop.com` 或 DSH Desktop 的发布基础设施。
- Linux 安装包。

## 发布单元与版本归属

一个桌面版本对应一个不可变发布单元：

```text
桌面版本
  -> Shell commit
  -> Core Runtime tag、commit、平台和摘要
  -> 必需第一方插件版本
  -> 内置 Profile 模板版本
  -> 支持的用户数据结构范围
  -> macOS 与 Windows 发布产物
```

Shell 发布工作流是这组映射的唯一维护者。已安装客户端不得在不替换完整应用的情况下单独替换 Core Runtime 或必需第一方插件。

应用安装目录视为可替换内容。可变业务数据保存在稳定的产品 `userData` 根目录下。应用升级不得删除或重建账号级 Harness Home、会话、用户导入插件、设置、工作区或未来的画布资产。

## 平台与签名矩阵

| 渠道 | macOS | Windows |
| --- | --- | --- |
| 开发版 | 独立 App ID 与 userData；不签名；禁用正式更新源 | 独立 App ID 与 userData；不签名；禁用正式更新源 |
| 候选版 | Developer ID 签名、公证并装订；使用隔离的候选更新源 | 未签名 NSIS；使用隔离的候选更新源；接受 SmartScreen 提示 |
| 正式版 | Developer ID 签名、公证并装订；使用可信正式更新源 | 未签名 NSIS；使用可信正式更新源；接受 SmartScreen 提示 |

macOS 同时使用更新器的平台签名检查和本文定义的产品级发布签名。Windows 在没有 Authenticode 期间设置 `verifyUpdateCodeSignature: false`，但只有产品 Manifest 签名和实际安装包摘要都通过后才能安装。

开发版不得检查、下载或安装候选版和正式版。候选版与正式版使用不同渠道，不能互相发现或覆盖。

## 更新源

Candidate 和 Stable 从首个公开版本起使用自有 HTTPS 域名后的 OSS/CDN。GitHub Releases 只保存相同字节的公开镜像、构建记录和人工灾备下载，不参与客户端自动更新发现或自动回退。

更新管理器继续依赖 `UpdateSource` 接口，不在 UI 或应用生命周期代码中拼接存储供应商 URL。每个渠道只读取一个短缓存 `current.json`，再解析不可变版本目录内的产品 Manifest、签名和平台更新元数据。完整对象布局、信任边界和发布顺序以[桌面客户端 OSS 更新分发设计](2026-09-08-desktop-update-oss-distribution-design.md)为准。

工作流每个平台只构建一次并创建包含已验证制品的 GitHub Draft。首版本地发布器下载并复验 Draft 资产，再上传至不可变 OSS 版本目录；真实安装/更新验收通过后，先公开 GitHub Release，最后更新唯一的渠道 `current.json`。已发布 Tag、OSS 版本目录和 Release 资产不得覆盖；修复必须使用新版本。

客户端不能列举 OSS 对象或依赖 GitHub API 顺序发现版本。`current.json` 只负责定位候选版本，应用内置公钥签名的产品 Manifest 才是发布内容和更新策略的信任根。

## 可信发布 Manifest

每个候选版和正式版包含：

- `insight-update.json`：规范化 UTF-8 JSON Manifest；
- `insight-update.json.sig`：对 Manifest 原始字节生成的 Ed25519 分离签名；
- `latest-mac.yml`、`latest.yml` 等平台更新元数据；
- `electron-updater` 所需的安装包、ZIP 和 blockmap；
- 工作流保留的发布产物校验报告。

Manifest 内容：

```ts
type UpdateChannel = 'candidate' | 'stable'
type UpdatePlatform = 'darwin' | 'win32'
type UpdateArch = 'arm64' | 'x64'

interface SignedReleaseManifest {
  schema: 'insight-desktop-update/v1'
  version: string
  channel: UpdateChannel
  publishedAt: string
  shellCommit: string
  coreRuntime: {
    tag: string
    commit: string
  }
  policy: {
    mode: 'optional' | 'required'
    minimumSupportedVersion: string
  }
  compatibility: {
    profileSchema: number
    accountStorageSchema: number
    minimumReadableDataSchema: number
    maximumReadableDataSchema: number
  }
  artifacts: Array<{
    platform: UpdatePlatform
    arch: UpdateArch
    kind: 'dmg' | 'zip' | 'nsis' | 'blockmap' | 'updater-metadata'
    name: string
    size: number
    sha512: string
  }>
}
```

每次发布必须读取已提交且严格校验的 `build/update-release-policy.json`。该文件声明 `releaseVersion`、`channel`、`mode` 和 `minimumSupportedVersion`。发布脚本不得提供策略默认值；缺少文件、出现未知字段、版本格式错误、渠道不一致、版本不等于本次 Tag，或最低支持版本高于发布版本时，发布失败。强制更新必须先经过明确的策略文件变更和代码审查，不能因为上次配置残留而继续生效。

Ed25519 私钥只在仓库外的系统临时目录生成，随后写入受保护的 GitHub Actions Environment Secret，并保存一份受访问控制的加密恢复副本。确认两个存储位置后立即删除本机明文。私钥不得保存在仓库内，即使路径已被 `.gitignore` 忽略。应用只内置公钥。轮换密钥时，先发布同时信任新旧公钥的版本，后续版本才能移除旧公钥；加密恢复副本用于避免 GitHub Secret 丢失后无法完成该过渡。

下载前，客户端必须校验 Manifest 签名、Schema、渠道、语义版本、更新策略、目标平台、目标架构和兼容性声明。渠道指针、签名 Manifest 和 `electron-updater` 平台 YAML 的版本必须完全一致。`minimumSupportedVersion` 不能高于发布版本。下载后必须用实际文件重新计算大小和 SHA512。Windows 安装器即使没有 Authenticode，也必须能被认证为 Insight 发布的原始文件。

可选更新允许跳过。只有当前版本低于签名 Manifest 中的 `minimumSupportedVersion` 时，更新才属于强制更新。强制更新不可跳过，并持续显示到安装完成。

客户端只缓存已经验证过的 Manifest 原始字节和分离签名，不缓存可直接信任的派生最低版本。每次启动都要使用应用内置公钥和当前渠道/平台重新验证缓存内容，验证成功后才能阻止登录和 Core 启动。伪造、损坏或格式错误的缓存按开放策略处理，只删除该更新缓存文件，不得锁死可用客户端。

## 更新管理器归属

更新器属于 Shell 主进程服务，独立于登录和 Core Runtime 启动。渲染进程只能读取安全状态并调用有限命令。

主进程负责：

- 定时检查与系统恢复检查；
- 访问更新源；
- 验证 Manifest 签名；
- 判断版本和渠道策略；
- 配置 `electron-updater`；
- 下载和校验安装产物；
- 安装前停止业务运行；
- 安装并重启；
- 保存跳过版本偏好；
- 输出结构化更新日志。

Shell 渲染进程负责：

- 登录前和恢复模式都可使用的更新窗口；
- 展示当前版本、新版本、下载进度和错误；
- 检查、下载、安装、跳过、稍后提醒，以及强制更新时的退出操作；
- 在已登录用户入口旁展示更新提示；
- 不接触文件路径、私钥、令牌、URL 拼接或安装器。

macOS 原生菜单和 Windows 自定义菜单都提供“检查更新”，并调用同一个主进程服务。

## 更新状态模型

渲染进程只接收一个判别联合：

```ts
type UpdateStatus =
  | { phase: 'idle'; currentVersion: string; lastCheckedAt?: string }
  | { phase: 'checking'; currentVersion: string; manual: boolean }
  | { phase: 'available'; currentVersion: string; availableVersion: string; required: boolean; manual: boolean }
  | { phase: 'downloading'; currentVersion: string; availableVersion: string; required: boolean; percent: number; manual: boolean }
  | { phase: 'downloaded'; currentVersion: string; availableVersion: string; required: boolean; manual: boolean }
  | { phase: 'installing'; currentVersion: string; availableVersion: string; required: boolean; manual: boolean }
  | { phase: 'up-to-date'; currentVersion: string; manual: true }
  | { phase: 'unsupported'; currentVersion: string; reason: string; manual: boolean }
  | { phase: 'error'; currentVersion: string; availableVersion?: string; required: boolean; message: string; manual: boolean; retryable: boolean }
```

自动检查可以进入 `available`，但短暂的 `checking`、`up-to-date` 和网络错误不打断用户；手动检查要显示这些状态。强制更新会主动打开更新窗口并禁用跳过和稍后提醒。只有缓存 Manifest 与签名在本次启动重新验证成功后，才允许阻止登录或 Core 启动。

强制更新进入错误状态时仍要保留 `required: true` 和目标版本，保证 UI 继续显示“重试”和“退出”，不能意外显示可选更新操作。

更新不会中断正在执行的 Agent 操作；安装仍由用户明确触发。同一时间只能进行一次检查、下载或安装。

客户端在启动 15 至 30 秒后检查更新，之后每六小时检查一次。系统恢复时，如果距离上次成功或失败检查已满六小时，则再次检查。网络失败不影响当前版本继续使用，后续按定时或手动操作重试。

## 安装生命周期

只检查或下载时不停止 Core Runtime。安装前，更新管理器要求工作区生命周期依次完成：

1. 拒绝新的安装请求；
2. 停止接受新的产品操作；
3. 刷新 Shell 管理的可变状态；
4. 分离 Harness View；
5. 使用已有超时策略优雅停止 Core Runtime；
6. 关闭辅助恢复窗口和菜单窗口；
7. 调用 `quitAndInstall`。

准备失败时，客户端保持当前版本并回到可重试错误状态，不得启动安装器，也不得通过删除用户数据恢复。

更新窗口的退出命令只允许该窗口自身的主 Frame 调用，并执行普通 `app.quit()`，不得隐式安装更新。Shell 和 Harness Frame 调用同一 IPC 时必须被拒绝。

## 回退策略

版本回退属于第二阶段。第一阶段先在 Manifest 中记录兼容性字段，避免未来支持回退时再次修改发布格式。

未来的回退目录只展示仍保留签名 Manifest 的版本。安装旧版本前，客户端比较目标版本可读取的数据结构范围与当前数据结构：

- 兼容：允许降级；
- 需要可逆元数据迁移：先快照数据库和配置，再执行降级；
- 不兼容：阻止原地降级，只有业务确有需要时才提供隔离的数据根目录。

回退应用代码时不复制大型媒体资产。可恢复范围只包括元数据、数据库、配置、Profile Patch 和资产引用。

## 插件归属

| 类型 | 安装范围 | 更新负责人 | 删除策略 |
| --- | --- | --- | --- |
| 必需第一方插件 | 随应用打包并安装到托管 Profile | 整包发布 | 不允许独立删除或升级 |
| 可选官方插件 | 设备级安装，声明 Shell/Core 兼容范围 | 未来的官方插件目录 | 用户可删除 |
| 用户或社区插件 | 设备级安装，多账号共享 | 用户或未来社区管理器 | 用户可删除 |

当产品依赖 Better Sidebar、账号集成、未来画布桥接、基础文档或媒体预览时，它们属于必需第一方能力。PDF 或表格预览可以作为插件能力；dshmarket 只是一套插件发现、安装、更新、备份和诊断系统。

当前产品继续支持本地导入插件，并在新 Profile 中预装锁定版本的 `dshmarket`。用户可以卸载或手动升级市场；市场无权更新 Shell、Core Runtime、Better Sidebar 或桌面集成。详细生命周期和验证要求由 [出厂插件市场设计（历史归档）](../archive/README.md) 维护。

## DSH Desktop 上游变更接收策略

保留 `upstream-dsh-desktop` Remote。定期 Fetch 后，将上游变化分为：

- Electron 或操作系统生命周期修复；
- 更新器和发布流程修复；
- 插件恢复或 Profile 安全修复；
- 与锁定 Core 接口有关的 Harness 兼容性变化；
- DSH 专属产品、市场、品牌、分析、移动端或部署功能。

前四类才进入定向采用候选。每次采用必须记录：

- 已审查的上游 Commit 范围；
- 采用的具体文件或行为；
- Insight 产品差异；
- 对应的聚焦测试；
- 构建手册达到的验证阶段；
- 保留来源信息的 Commit 或设计记录。

产品分支不得整体合并上游 `package.json`、Lockfile、Release Workflow、内置 Harness 包、dshmarket 目录、品牌资源、App ID、Profile 或更新域名。

## 失败处理

- Manifest 缺失或签名无效：提示发布无法认证，拒绝下载。
- Tag 与 Manifest 版本不一致：拒绝该 Release，不回退到未明确选择的版本。
- 产物缺失或摘要不一致：只删除对应更新缓存，拒绝安装。
- OSS/CDN 不可用：保留当前版本并允许重试。只有可信 Manifest 已解析时，才显示指向同一不可变版本目录 DMG/NSIS 的整包入口；发现或验签失败时不构造未认证下载地址。
- 下载中断：保留当前版本，之后继续使用更新器缓存重试。
- Core Runtime 无法停止：取消安装，并尽可能保持当前进程继续运行。
- 强制更新无法下载：保留“重试”和“退出”。只有缓存 Manifest 与签名重新验证成功且当前版本确实过低时，后续启动才阻止登录/Core。
- 应用退出后安装器失败：依靠平台安装机制保留旧安装和用户数据；下次启动记录当前实际版本和上次尝试结果。
- CI 原生 DMG、ZIP 或 NSIS 结构校验失败：不得上传对应构建产物。
- CI 发布产物校验失败：不得发布或修改 Release。

## 研发与验证原则

实施按低成本到高成本推进，每个阶段通过后才进入下一阶段：

1. 纯单元测试：签名、发布策略、渠道、目标选择、状态转换、定时规则和跳过版本。
2. IPC 与 Preload 契约测试：证明不可信渲染进程不能接触安装路径或更新内部信息。
3. 发布脚本 Fixture：显式发布策略、Manifest、签名、摘要、macOS 元数据合并、必需产物及截断文件拒绝。
4. 开发模式 Fixture UI：覆盖全部状态，但不接触 OSS/CDN 正式源，也不允许真实安装。
5. 本地未签名 DEV 包：证明开发渠道无法发现正式更新。
6. macOS 候选渠道：完成原生 DMG/ZIP 校验以及 N 到 N+1 安装和数据保留。
7. Windows 候选渠道：完成原生 NSIS 校验、Manifest 验证、N 到 N+1 安装、SmartScreen 预期和数据保留。
8. 两个平台候选路径以及登录、账号隔离、Better Sidebar 和内置 Runtime 验收通过后，才允许发布正式版。

不得为了验证更新窗口、状态机、Manifest 或错误提示而提前构建安装包。不得在本地聚焦测试、Build、Fixture UI 和对应平台本地 Smoke 通过前触发远程安装包任务。

## 文档维护

本方案确认后，所有仍写着“定期合并 DSH Desktop”的文档都要改成“参考上游、定向采用”。构建手册把“整体 Upstream Merge”改为“上游变更审计”的正常路径，同时保留一个仅供明确需求使用的隔离集成分支流程。

新的更新或打包问题，如果会改变以后发布门禁，应追加到 `docs/client-build-runbook.md`；只记录一次性故障时间线时，放入 `docs/incidents/`。
