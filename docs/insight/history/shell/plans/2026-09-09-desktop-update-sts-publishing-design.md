> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# 桌面更新 STS 发布设计

## 状态与目标

- 状态：已确认，按方案 A 实施。
- 目标：1.0 版本使用 GitHub OIDC 向测试 Gateway 换取目录级 OSS STS，再由独立发布工作流把更新资产同步到 `insight-desktop-updates`。
- 更新源固定为 `https://updates.insight-aigc.com`。
- 测试 Gateway 固定为 `https://gapi-test.insight-aigc.com/insight-harness-llm-gateway`；1.0 不接入尚未上线的生产 Gateway。
- 保留既有 GitHub Draft、签名 Manifest、不可变版本目录以及最后更新 `current.json` 的发布语义。
- 200～600 MB 安装资产先使用普通 `PutObject`。上传前刷新临期 STS，令牌失效时整文件重试一次；1.0 暂不引入分片上传与断点续传。
- STS 仅存在于 GitHub Actions 运行内存，客户端和仓库均不保存 AccessKey Secret。

## 已确认事实

1. `upload_oss_test` 的 Run #5 已使用旧的文件级请求体取得 STS，并向目标桶完成真实 `PutObject`，OSS 返回 HTTP 200。这证明当前 RAM 角色已经具备 `oss:PutObject` 能力。
2. 2026-09-09 的 [`upload_oss_test` Run #7](https://github.com/BreezeWind889988/upload_oss_test/actions/runs/34319570470) 已在最新 `main` 上以请求体 `{}` 取得目录级 STS；OIDC 与 STS 接口均返回 HTTP 200，响应不含 `fileName` 或 `userId`。
3. Run #7 使用签发的 900 秒 STS 将 `1788935604227.txt` 写入 `insight-desktop-updates` 桶根目录，OSS `PutObject` 返回 HTTP 200，request ID 为 `6AA0FDB567B311333387BD1EB`。测试 Gateway 的目录级 STS 前置门槛已通过。
4. 改造前的发布器使用本地 `ossutil` 与长期 AccessKey 配置；现已替换为 GitHub OIDC + STS，客户端更新读取链路和签名校验链路未改写。

## 总体决策

1. 新增独立的 `.github/workflows/publish-update.yml`，只通过 `workflow_dispatch` 执行 `stage` 或 `promote`。
2. 现有 `.github/workflows/release.yml` 继续只负责构建、签名并创建 GitHub Draft，不授予 `id-token: write`。
3. 发布工作流使用 `permissions: contents: write, id-token: write`；OIDC audience 固定为 `insight-harness-oss-upload`。
4. 上传实现固定使用 `ali-oss@6.23.0`，不再依赖本地 `ossutil`、AccessKey 环境变量或 OSS profile。
5. 发布器保持两阶段语义：
   - `stage`：校验并上传版本化资产，不修改 `current.json`。
   - `promote`：确认版本、发布 GitHub Release，随后最后写入 `current.json`。
6. 1.0 不在桌面仓库新增长期 `probe` 动作。后台契约由 `upload_oss_test` 验证，桌面集成由首个 RC 的 `stage` 验证。

## 后台 AI 必改项

### 1. 请求契约

`POST /v1/upload/sts/token` 必须在 GitHub OIDC Bearer Token 鉴权成功后接受以下两种请求：

```json
{}
```

```json
{
  "fileType": "file"
}
```

具体要求：

- 删除 `fileName` 必填校验；不得再返回 `INVALID_FILE_NAME`。
- `fileType` 可选，缺省值为 `file`。
- 请求方不得覆盖 `bucket`、`region`、`endPoint`、`dir`、RAM role、权限或有效期。
- 不要求登录用户，不读取 `userId`；身份信任来自 GitHub OIDC claims。
- `{}` 不代表匿名调用。缺少、无效或不符合 claims 白名单的 Bearer Token 仍必须拒绝。

### 2. 目录级 STS 语义

- 后台配置更新桶为 `insight-desktop-updates`。
- 区域为 `oss-cn-guangzhou`，endpoint 为 `oss-cn-guangzhou.aliyuncs.com`。
- 当前发布目录配置为桶根目录时，响应 `dir` 必须为 `""`。
- 同一份 900 秒左右的 STS 必须允许工作流在授权目录内上传多个对象，而不是绑定到单个 `fileName`。
- 前端实际写入的 key 仍受 OSS 临时策略约束，目标范围为 `desktop/**`。
- 临时策略不得授予跨桶或授权目录以外的对象权限。

### 3. 响应契约

成功响应的 `data` 至少包含：

```json
{
  "accessKeyId": "STS...",
  "accessKeySecret": "...",
  "securityToken": "...",
  "expiration": "2026-09-09T00:00:00Z",
  "durationSeconds": 900,
  "bucket": "insight-desktop-updates",
  "region": "oss-cn-guangzhou",
  "endPoint": "oss-cn-guangzhou.aliyuncs.com",
  "dir": "",
  "fileType": "file",
  "url": null,
  "repositoryId": "1344679131",
  "runId": "<当前 GitHub Actions run id>"
}
```

具体要求：

- 顶层成功码保持稳定，例如 `code: "SUCCESS"`。
- 不返回或依赖 `fileName`、`userId`。
- `repositoryId`、`runId` 必须来自已验证的 OIDC claims，不能信任请求体。
- 错误响应保留稳定的 HTTP 状态码和机器可读错误码。
- 应用日志、审计日志和错误响应不得输出 `accessKeySecret`、`securityToken` 或完整 Authorization header。

### 4. GitHub OIDC 白名单

1.0 至少允许以下仓库 ID：

- 桌面仓库 `Boxser567/insight-desktop-shell`：`1344679131`
- 验证仓库 `BreezeWind889988/upload_oss_test`：`1362006344`

若后台启用了 workflow/ref/event 精确约束，还必须允许：

- `BreezeWind889988/upload_oss_test/.github/workflows/test-sts.yml@refs/heads/main`
- `Boxser567/insight-desktop-shell/.github/workflows/publish-update.yml@refs/heads/main`
- `ref=refs/heads/main`
- `event_name=workflow_dispatch`
- `audience=insight-harness-oss-upload`

桌面发布 job 使用受保护的 GitHub Environment `desktop-release`。若后台校验 OIDC `sub`，必须允许 `repo:Boxser567/insight-desktop-shell:environment:desktop-release`；测试仓库没有 Environment 时，其 `sub` 仍是 `repo:BreezeWind889988/upload_oss_test:ref:refs/heads/main`。不要把两种 subject 形态误当作仓库身份不一致。

### 5. RAM 与 OSS 权限核对

- 确认 Gateway 实际 AssumeRole 的角色已绑定管理员配置的 `insight-desktop-update-oss` 策略，而不只是控制台中存在同名策略。
- 1.0 发布器必需的最小操作为：
  - 桶级 `oss:ListObjects`
  - 对象级 `oss:GetObject`
  - 对象级 `oss:PutObject`
- 前端发布器不会调用 `DeleteObject`、`ListBuckets`、`GetBucketAcl` 或 `GetBucketInfo`；这些不是 1.0 必需权限。
- Bucket Versioning 作为上线前一次性控制台验收项，不在每次发布时通过 API 查询。

### 6. 后台验收门槛

部署后必须从 `upload_oss_test` 最新 `main` 重新运行现有 workflow，并同时满足：

1. GitHub OIDC 验证成功。
2. 请求体 `{}` 获取 STS 成功。
3. STS 响应不要求 `fileName` 或 `userId`。
4. 测试脚本自行生成对象名并上传成功，OSS `PutObject` 返回 HTTP 200。
5. 日志对 Secret、Token 做脱敏。
6. 后台 AI 回传 workflow run URL、object key、OSS request ID 和响应契约样例，供前端接入验收。

## 前端接入设计

### 文件职责

- `scripts/github-oss-client.mjs`
  - 校验 GitHub Actions/OIDC 运行环境。
  - 获取 GitHub OIDC Token。
  - 使用 `{}` 向 Gateway 换取目录级 STS。
  - 校验 Gateway 响应中的桶、区域、endpoint、目录和 claims 回显。
  - 创建 `ali-oss` 客户端，提供 list/get/put 能力。
  - 在异常中只暴露安全的 status、code、requestId。
- `scripts/publish-update-to-oss.mjs`
  - 删除 `ossutil`、本地 profile 和长期 AccessKey 接入。
  - 保留 GitHub Release 下载、资产清单校验、签名 Manifest 校验、版本化发布、CDN 回读验证、`current.json` 最后提交和发布报告。
- `.github/workflows/publish-update.yml`
  - 输入 `command`、`tag` 和 `confirm_version`。
  - 只允许 `main` 的手动运行。
  - 使用 Node 22 和 `npm ci --ignore-scripts`。
  - 无论成功失败都上传脱敏后的发布报告。
  - 对发布操作使用固定 concurrency，避免并发修改 `current.json`。

### 大文件与 STS 过期

1. 200～600 MB 文件直接调用 `client.put(key, absolutePath, options)`。
2. 每个文件上传前检查 STS `expiration`；剩余时间少于 180 秒时重新获取 OIDC Token 和 STS。
3. 上传若返回 `SecurityTokenExpired` 或 `InvalidSecurityToken`，废弃当前客户端，刷新 OIDC/STS，并从头重试当前文件一次。
4. 第二次仍失败则终止 `stage`。版本化目录允许保留已成功上传的不可变对象，但 `current.json` 不会改变，客户端不会看到半发布版本。
5. 版本化对象上传携带 `x-oss-forbid-overwrite: true`。若对象已存在，发布器必须按既有资产与 CDN 校验规则确认内容，不能无条件视为成功。
6. 只有在真实 RC 证明普通 `PutObject` 不可靠时，才升级为 multipart/checkpoint；不在 1.0 预先实现。

## 两阶段数据流

### Stage

1. 操作者从 GitHub Actions 手动选择 `stage` 和 tag。
2. 工作流下载对应 GitHub Draft 的所有发布资产。
3. 发布器验证资产集合、YAML、blockmap、签名 Manifest 和版本一致性。
4. 获取目录级 STS，并将资产写入 `desktop/releases/<version>/`。
5. 从 `updates.insight-aigc.com` 回读版本化资产并校验。
6. 生成脱敏发布报告；不写 `desktop/current.json`。

### Promote

1. 操作者从 GitHub Actions 手动选择 `promote`，同时输入 tag 和完全相同的 `confirm_version`。
2. 发布器重新验证 GitHub/OSS/CDN 上的版本化资产。
3. 将 GitHub Draft 发布为正式 Release。
4. 获取新的 STS，把签名后的 pointer 最后写入 `desktop/current.json`。
5. 轮询更新域名，确认 `current.json` 已指向目标版本。
6. 生成脱敏发布报告。

## 失败语义

- OIDC、STS、资产校验、上传、CDN 校验或版本确认任一步失败，workflow 必须失败退出。
- `stage` 失败不会影响线上 `current.json`。
- `promote` 在写 pointer 前失败不会切换客户端更新版本。
- 日志和报告不得记录临时密钥；只记录 tag、version、object key、HTTP 状态、OSS 错误码和 request ID。
- 桶内已写入的不可变版本资产不自动删除，允许后续同版本恢复性重跑并校验。

## 前端验收标准

1. 仓库不再要求 OSS 长期 AccessKey、ossutil profile 或本地发布命令。
2. `release.yml` 仍没有 `id-token: write`；只有 `publish-update.yml` 能获取 OIDC Token。
3. `stage` 能上传约 200～600 MB 的真实 RC 资产并通过更新域名回读。
4. STS 临期会在下一个文件上传前刷新；令牌失效会整文件重试一次。
5. `stage` 不改变 `current.json`。
6. `promote` 只有在显式版本确认后才能更新 `current.json`。
7. 已安装客户端只在真实 `current.json` 指向更高版本时展示更新入口，并能下载、校验和安装整包。

## 1.0 暂缓项

- 生产 Gateway 切换。
- multipart/checkpoint、断点续传和跨 run 上传恢复。
- 自动定时发布、自动回滚和多发布通道。
- 客户端直接获取 STS 或直接写 OSS。
- 在发布 workflow 中动态查询 Bucket Versioning、ACL 等控制面配置。
