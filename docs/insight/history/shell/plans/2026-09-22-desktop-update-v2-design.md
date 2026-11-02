> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# 因赛AI Desktop 更新机制 v2 设计

## 背景

当前更新协议把应用包身份、版本号和投放渠道绑定在一起：Candidate 使用 `vX.Y.Z-rc.N` 和 `candidate` 包元数据，Stable 使用 `vX.Y.Z` 和 `stable` 包元数据。该模型能够隔离候选与正式用户，但不能把经过验收的 Candidate 安装包原样转为 Stable，也使 `v1.0.0-rc.17` 无法发现 `v1.0.0`。

v2 将“制品是什么”与“向谁投放”分离。开发验证仍可按单个平台快速构建， 最终通过验收的三平台制品不重新构建，只通过签名投放记录进入 Stable。

## 目标

- Stable 用户默认只接收正式更新，不接触 Candidate。
- Candidate 只能由用户显式加入，并且只在用户主动操作时检查。
- Candidate 使用唯一的正式 SemVer；失败版本废弃并允许跳号。
- 单个平台可以独立构建、发布和验收。
- 同一版本的不同平台可以从同一提交分批补齐。
- Stable 只接受三个目标齐全且全部通过验收的版本。
- Candidate 转正时复用完全相同的安装包、更新元数据和 blockmap。
- 保留签名、摘要、不可覆盖目录、单调指针和强制更新离线缓存等安全属性。
- 用 `v1.0.0-rc.19` 将现有 rc.17 用户迁移到 v2；rc.18 因打包后的 About preload 不可用而被废弃。

## 非目标

- v2 首期不提供自动降级。
- v2 首期不允许 Candidate 写入当前 Stable 无法读取的数据 Schema。
- v2 不把 GitHub Releases 变为客户端自动更新源。
- v2 不增加新的桌面应用身份、Bundle ID 或 userData 目录。

## 核心概念

### 版本

Candidate 从一开始使用最终格式版本号，例如 `1.0.1`。该版本一经创建即不可 复用。如果验证失败，修复版本使用更高号码，例如 `1.0.2`。Stable 版本允许跳号。

首次创建版本时，新版本必须严格高于以下版本的最大值：

- 当前 Stable；
- macOS arm64 Candidate；
- macOS x64 Candidate；
- Windows x64 Candidate。

同一版本只允许从同一 Shell Commit、Core Runtime 锁、兼容声明和构建配置补充 尚缺目标，不允许重新构建或覆盖已存在的目标。

### 目标

v2 固定支持三个目标：

- `darwin-arm64`
- `darwin-x64`
- `win32-x64`

每个目标独立构建、签名、公证、上传、验收和推进 Candidate 指针。

### Track

Track 只描述投放受众，不再描述安装包身份：

- `stable`：所有正式客户端，允许后台检查；
- `candidate`：显式加入内测的用户，只允许手动检查。

所有 v2 安装包都携带 Stable/中性的默认身份。Candidate 偏好保存在共享 userData 中，因此通过验收的同一安装包无需改变字节即可转正。

## 客户端体验

### Stable

- 新安装默认关闭“接收内测更新”。
- 启动、每六小时和系统恢复时只检查 Stable。
- Stable 可按现有规则显示更新入口、下载、安装、跳过或执行强制更新。

### Candidate

- “关于因赛AI”窗口直接展示“接收内测更新”开关。
- 开启前展示一次明确风险确认。
- 开启后展示“检查内测更新”按钮。
- Candidate 不执行启动检查、定时检查、恢复检查、红点提示或主动弹窗。
- Candidate 更新窗口复用正式更新窗口的布局、进度和操作逻辑，并适配明暗主题； 仅增加“内测版本”标识和风险说明。
- Candidate 投放策略固定为 `optional`。
- 关闭开关只影响未来检查，不删除数据、不卸载、不降级。

如果当前 Candidate 后续转正，客户端通过签名 Stable 投放记录和本地 Candidate 安装 标记确认当前版本确实由 Candidate 安装，再显示“当前版本已转为正式版”，不重新下载。 仅加入过内测或仅检查过 Candidate 不足以显示该状态。

## 本地偏好

内测偏好原子写入：

```text
<userData>/updates/preferences.json
```

结构为：

```json
{
  "schema": 1,
  "candidateOptIn": true
}
```

文件权限为 `0600`，解析失败时安全回退为关闭并记录脱敏警告。修改只能来自受信任 About 窗口 main frame。

## v2 分发结构

### 目标目录

```text
desktop/releases/v1.0.1/targets/darwin-arm64/
desktop/releases/v1.0.1/targets/darwin-x64/
desktop/releases/v1.0.1/targets/win32-x64/
```

目录包含该目标的安装包、更新元数据、blockmap、Target Manifest 和签名。对象设置 一年 immutable，并使用 OSS 禁止覆盖语义。

### Target Manifest

Target Manifest 不包含 Track 或更新策略：

```json
{
  "schema": "insight-desktop-target/v2",
  "version": "1.0.1",
  "target": { "platform": "darwin", "arch": "arm64" },
  "shellCommit": "<40-hex>",
  "coreRuntime": { "tag": "<tag>", "commit": "<40-hex>" },
  "compatibility": {
    "profileSchema": 1,
    "accountStorageSchema": 1,
    "readsDataSchema": { "minimum": 1, "maximum": 1 },
    "writesDataSchema": 1
  },
  "artifacts": []
}
```

Manifest 使用现有产品更新密钥签名。客户端必须先验证签名和 Manifest 摘要，再使用 其中的 updater metadata 和安装资产。

### Release Index

三个目标全部存在后生成一次不可变 Release Index：

```json
{
  "schema": "insight-desktop-release/v2",
  "version": "1.0.1",
  "shellCommit": "<40-hex>",
  "coreRuntime": { "tag": "<tag>", "commit": "<40-hex>" },
  "targets": [
    { "id": "darwin-arm64", "manifestSha512": "<base64>" },
    { "id": "darwin-x64", "manifestSha512": "<base64>" },
    { "id": "win32-x64", "manifestSha512": "<base64>" }
  ]
}
```

Index 只有在三个 Target Manifest 的版本、Commit、Runtime 和兼容声明完全一致时才 能生成，并独立签名。

### 签名投放信封

`current.json` 是一个单对象签名信封，避免 pointer 与 `.sig` 在 CDN 上短暂不同步：

```json
{
  "schema": "insight-desktop-rollout-envelope/v2",
  "payloadBase64": "<canonical-json-base64>",
  "signatureBase64": "<signature-base64>"
}
```

Candidate active payload 引用一个目标 Manifest；Stable payload 引用完整 Release Index。 payload 同时携带 `active|rejected` 状态、Track、版本、目标（Candidate）、被引用对象摘要、 `optional|required` 策略和最低支持版本。Candidate 构建器只允许 `optional`，Stable 只允许 `active`。

Candidate 路径：

```text
desktop/candidate-v2/darwin-arm64/current.json
desktop/candidate-v2/darwin-x64/current.json
desktop/candidate-v2/win32-x64/current.json
```

Stable 路径保持：

```text
desktop/stable/current.json
```

legacy schema 1 指针只允许出现在 `desktop/candidate/current.json`。v2 Stable 信封必须 声明 `track=stable` 且不能携带目标；每个平台的 Candidate 信封必须声明 `track=candidate` 并与 URL 中的目标完全一致，防止把合法签名信封跨路径重放。

## 检查与安装流程

### 自动检查

自动检查永远解析 Stable 信封。客户端验证：信封签名、版本单调性、Release Index 签名与摘要、目标 Manifest 签名与摘要、目标资产集合以及本机系统版本。 设备从未验证过 Stable 指针且首个 Stable 尚未创建时，HTTP 404 表示“暂无正式更新”；设备 一旦验证过 Stable 指针，后续 404 必须安全失败，不能把指针删除伪装成“没有更新”。

客户端在 `<userData>/updates/rollout-history.json` 记录每个 Stable/Candidate 目标已验证的 最高版本、状态和信封摘要。同一路径回到更低版本，或同一状态、同一版本出现不同信封字节 时安全失败；唯一允许的同版本变更是由签名 `active` 单向进入签名 `rejected`，禁止重新激活。 网络元数据响应限制为 4 MiB，并在流式读取期间受统一请求超时约束。

### 手动 Candidate 检查

只有 `candidateOptIn=true` 时允许调用 Candidate 检查。客户端根据本机目标读取对应 Candidate v2 信封；Candidate 状态带 `track: candidate`，不会触发全局更新 Badge。

### 安装

下载和安装继续使用 electron-updater，但 Feed URL 指向已验证目标目录。安装前停止 工作区和 Runtime，保留现有下载文件摘要校验和整包兜底。

## 强制更新缓存

v2 把策略从 Target Manifest 分离后，强制更新缓存必须保存完整可信链：

- Stable rollout payload 与签名；
- Release Index 与签名；
- 当前目标 Manifest 与签名。

重启后重新验证整个链和最低支持版本。Candidate rollout 不能进入强制策略缓存。

## 单平台构建与制品汇集

受保护 `desktop-release` Environment 批准后，先运行类型检查、全量测试、桌面 bundle 构建和 沙箱 preload 自包含校验，再创建不可移动的 `vX.Y.Z` Tag，并把 Commit 记录到 Draft Release。 构建失败或版本被拒绝时 Tag 仍保留，版本视为已消耗。

后续补建目标必须：

1. 从该 Tag 的 Commit checkout；
2. 验证 package version、Runtime 锁和兼容配置；
3. 验证 Draft Release 的 Tag target；
4. 验证已有目标资产摘要；
5. 只上传此前不存在的目标资产，禁止 `--clobber`。

GitHub Release 在 Candidate 阶段保持 Draft。Candidate 客户端只从 OSS/CDN 获取更新， 不依赖 GitHub Draft 权限。

## 发布状态机

```text
Draft → Target Staged → Candidate Published → Target Accepted
  ↘ Rejected                                  ↓
                     Complete Release → Stable
```

- `Target Staged`：目标字节已进入不可变 OSS 目录，但没有移动 Candidate 指针。
- `Candidate Published`：对应平台 Candidate v2 指针已更新。
- `Target Accepted`：人工完成该目标安装和升级验收。
- `Complete Release`：三个目标均已验收，生成并验证 Release Index。
- `Stable`：GitHub Release 公开，最后提交 Stable 投放信封。
- `Rejected`：版本不可重新使用；已发布 Candidate 指针原位切换为同版本签名 tombstone， 客户端拒绝安装，后续修复只能使用更高版本。

验收记录和拒绝记录都由产品更新密钥签名并写入不可变版本目录；缺少签名、签名无效或 内容冲突时不能验收或转正。拒绝记录一经写入，后续 stage、Candidate 投放、验收和 Stable 推广全部终止。即使 GitHub Release 已公开，只要 Stable 指针尚未提交，仍允许执行拒绝流程并 把 Release 标记为 prerelease/REJECTED；Stable 指针已经指向该版本后则禁止撤回。

Stable 推广要求三个 Candidate 指针均指向同一版本。该版本在首次创建时必须严格 高于当时的 Stable、旧版 Candidate 和三个 v2 Candidate 指针；推广时允许三个当前 Candidate 指针与待转正版本相等。推广重新下载并校验每个远端对象，禁止重新构建。

## Candidate 故障恢复

Candidate 发布前必须证明其 `writesDataSchema` 可由恢复基线的读取范围覆盖。恢复基线 通常是当前 Stable；首个 Stable 尚未发布时，恢复基线是已验证的 rc.19 桥接版。 发布器除校验签名链和 Schema 范围外，还必须从 OSS 和 CDN 校验当前目标恢复 DMG/NSIS 的存在、HEAD 长度、Range 响应和流式 SHA-512。不满足任一条件的不可逆迁移不进入 v2 首期发布范围。

内测确认文案明确说明：

- 版本可能损坏功能或无法启动；
- 关闭内测不会自动降级；
- 失败版本需要等待更高 Candidate 或 Stable；
- 当前恢复基线的完整安装包始终可从公开恢复入口下载。

恢复安装保留 userData。因为 Candidate 的写入 Schema 必须保持恢复基线可读，使用 当前 Stable（首发前使用已验证桥接版）整包覆盖安装不会要求删除用户数据。macOS 和 Windows 都必须把该路径纳入人工验收。

## rc.19 桥接

`v1.0.0-rc.18` 已因沙箱 About preload 的生产打包缺陷被消耗。`v1.0.0-rc.19` 是新的 最终 v1 Candidate；只有三平台桥接验收通过后才冻结旧指针。如果 rc.19 被拒绝，必须 继续消耗该版本并用更高的 legacy RC 重新验证：

1. 继续使用 Candidate 包元数据和 v1 `candidate/current.json`；
2. 包含 v2 协议、内测偏好和手动 Candidate 检查能力；
3. 首次启动时，如果偏好不存在，自动写入 `candidateOptIn=true`；
4. 安装后停止 Candidate 后台检查；
5. 允许手动从 Candidate v2 目标指针升级到正式编号版本；
6. 旧 `candidate/current.json` 永久保持指向最终通过验收的桥接版本，预期为 rc.19。

因此仍停留在 rc.17 的用户以后启动时仍能取得已验证桥接版，不会因 v2 指针改为 正式版本号而被遗留。

## 安全失败语义

- 任一签名、摘要、目标、版本或 Commit 不匹配时不下载、不移动指针。
- updater YAML 必须把文件名、大小和 SHA-512 精确绑定到 Target Manifest 中的 zip/NSIS。
- Candidate 指针按目标严格递增；Stable 指针全局严格递增。
- 发布器对所有指针执行 compare-and-check；指针并发变化时停止。
- Stable 推广先公开已验证 GitHub Release，最后原子写入 Stable 信封；中断后可用相同 参数幂等重跑。
- CDN 返回重定向、错误 Origin、错误缓存对象或不一致摘要时安全失败。
- 日志不得包含签名私钥、STS、下载凭证、用户路径或完整异常响应。

## 验收矩阵

- rc.17 自动发现、下载、安装 rc.19。
- rc.18 内部测试机人工安装 rc.19；rc.18 不会通过 Stable-only 后台任务发现 legacy rc.19。
- rc.19 没有 Candidate 后台检查，但能手动发现 `1.0.0` Candidate v2。
- 新 Stable 安装默认关闭内测。
- 开启内测后只有主动点击才产生 Candidate 网络请求。
- 单平台 Candidate 不影响另外两个平台。
- 同版本补建目标时来源 Commit 不一致必须失败。
- 三平台完整版本可从 Candidate 原样转为 Stable。
- 已安装被转正 Candidate 的用户不重新下载。
- Stable 用户只在 Stable 信封提交后发现更新。
- Candidate 签名、Index、Manifest、资产或 CDN 响应被篡改时安全失败。
- Candidate 无法启动时可以用当前 Stable 整包保留数据恢复。
- 强制 Stable 更新在离线重启后仍能恢复可信策略。
