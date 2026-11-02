> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../README.zh.md)。

# 技能请求转发接入

完整开发步骤、浏览器适配边界和验收清单见 [技能请求转发 FE 开发交接](技能请求转发-FE开发交接.md)。

## 范围与运行链路

本次仅在现有 `@insight-ai/desktop-integration` Host 插件中增加技能代理能力。 不迁移旧仓库的企业插件、画布、技能库、管理界面；不修改 DSH Core、登录界面或 DeepSeek 模型转发逻辑。

技能 JS → 127.0.0.1 私有代理 → 公网 Gateway → insight-harness-service → 厂商。

代理每次复用现有 `createModelCredentialClient().getToken()`，经父子进程 IPC 获取当前账号 Token， 由主进程原有会话管理器校验/刷新。Token 不进入技能、命令行参数、环境变量或描述文件。 发往 Gateway 时设置 `token` 和 `Authorization: Bearer ...`，后端负责添加厂商凭据及计算签名。 收到鉴权失败、超时或网络错误不自动重放请求，避免付费操作重复执行。

## 技能如何使用

登录并启动新版客户端后，DSH 原生 shell-env 提供：

- `DSH_HOME`：当前账号的 Harness 数据目录（原生提供）。
- `DSH_SKILL_PROXY_NODE`：客户端内置 Node.js 绝对路径。
- `DSH_SKILL_PROXY_CLIENT`：随插件安装的 JavaScript 代理脚本路径。

不依赖系统 Node.js 或 Python；变量缺失应检查插件启动，不要自行寻找 Token 或读取其他账号目录。 macOS Harness 在 Electron utility process 内运行，不能把 `process.execPath` 当作 Node； 桌面主进程将真实内置 Node 路径通过 `INSIGHT_BUNDLED_NODE_PATH` 传给 Host，再通过 shell-env 提供给技能。

### Bash

```bash
"$DSH_SKILL_PROXY_NODE" "$DSH_SKILL_PROXY_CLIENT" tikhub POST \
  /api/v1/douyin/search/fetch_general_search_v2 --body '{"keyword":"家居","cursor":0}'
```

### PowerShell

```powershell
& $env:DSH_SKILL_PROXY_NODE $env:DSH_SKILL_PROXY_CLIENT media-generator POST /v1/proxy --body-file request.json
```

`request.json` 只放原业务请求体，例如：

```json
{"model_id":"gpt-image-2","task_type":"text_to_image","data":{"prompt":"一只小狗"}}
```

示例会调用真实计费接口，仅在用户明确要求生成/查询时运行。 CLI 还支持 `--query '{...}'`、`--timeout 80`，或 `--stdin` 输入完整 JSON：

```json
{"connection":"media-generator","method":"POST","path":"/v1/proxy","query":{},"body":{"model_id":"gpt-image-2","task_type":"text_to_image","data":{"prompt":"一只小狗"}},"timeout":1250}
```

成功：exit 0，stdout 为上游 JSON body。失败：exit 1，stderr 为 `{"error":{"code":"...","status":502,"message":"...","body":null}}`。 SDK 自动处理 accepted/heartbeat/result NDJSON。同步代理不是持久化任务系统，断开不代表上游已撤销。

## 后台协议与配置

后端地址与 `build/client-service-environment.json` 选择的 `authOrigin` 同域，固定服务前缀： `/insight-harness-service`。Dev 使用测试地址，编译版使用生产地址：

`POST https://gapi.insight-aigc.com/insight-harness-service/api/skill-proxy/{connection_id}`

请求：`{"method":"POST","path":"/v1/proxy","query":{},"body":{...}}`。 本地代理只接受 connection_id，不允许指定其他后端 URL；上游地址和方法/path 白名单由后台控制。

| connection_id | 后台凭据 | 用途 |
| --- | --- | --- |
| tikhub | TIKHUB_API_KEY | TikHub 数据查询 |
| ppt-text | TX_CLOUD_API_KEY | PPT 文本模型调用 |
| media-generator | MG_API_AK / MG_API_SK | 媒体网关签名请求 |
| call-insight-api | INSIGHT_API_AK / INSIGHT_API_SK | API Manager 同步与异步请求 |

这些凭据仅配置到后端选中的 `config/application-*.json`，由 `APP_ENV=local/test/prod` 选择环境；当前后端不再读取同名业务环境变量或 `.env`。连接表中的引用字段指向该配置文件的字段名。此仓库不提供密钥，也不新增/部署后台接口。 需要先部署已实现的 Python skill-proxy 接口；旧后台返回 404、缺少密钥返回配置错误，禁止回退直连厂商。

## 安全与生命周期

本地 HTTP 仅监听 127.0.0.1 随机端口；描述文件 `DSH_HOME/skill-proxy/connection.json` 只有本地 capability，不含用户 Token/厂商 Key。POSIX 目录 0700、文件 0600。 Windows 使用账号目录原有 ACL；这些权限不防护同一 OS 用户运行的恶意程序。 拒绝错误 Host、缺少 capability、Origin/Sec-Fetch-Site 浏览器请求，无 CORS。 限制请求 2 MiB，SDK 响应 9 MiB，默认总等待 1250 秒，禁止重定向和自动重试。 退出/切换账号沿用原有 Harness 进程生命周期；插件卸载关闭端口、取消请求、清理自己的描述文件。

## 构建与验证

`resources/skill-proxy-client.mjs` 与插件一起由现有 bundled-profile 复制、随客户端发布。 原有账号启动时会刷新托管的 desktop-integration 包，不需要新增技能库或迁移用户数据。

```bash
npm run typecheck
npm run build:desktop-integration
npm run prepare:bundled-profile
npm test -- --dir test
```

旧技能不会被透明拦截：只有改为调用上面的 JS 客户端才会走代理。 本次不复制任何技能包，也不移植 Python 兼容层；原来的 Python 业务脚本若继续使用，仍需自己的运行环境及调用适配。
