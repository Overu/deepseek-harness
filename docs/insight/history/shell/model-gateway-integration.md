> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../README.zh.md)。

# Desktop 模型 Gateway 接入与验收

更新日期：2026-09-09。状态：独立分支 `codex/enterprise-gateway-analysis` 已通过合并提交 `d7b36d8` 进入本地 `main`，身份规范提交为 `e18e6bc`。自动化、DEV 打包和正式身份 Candidate 目录包验证已完成，尚未使用真实账号请求模型，也未推送、打 tag 或发布安装资产。

2026-10-08 本地 Core 升级补充：官方直连 DeepSeekAdapter 已移除 Chat Completions，本地 0.2.1 集成分支改用官方 PiAiAdapter 的 `openai-completions`，继续使用原 Gateway URL、用户中心 token、历史模型 ID 与推理档位；图片通过 inline 传输。该升级后来进入1.0.6的Runtime锁；本节仍保留当日实施证据，现行交付见[1.0.6记录](releases/1.0.6.md)，当日提交和验证见[升级结果](analysis/2026-10-08-core-upgrade-result.md)。下文保留原接入版本的验收记录。

## 1.0 最小实现

普通用户只需完成当前 Shell 的手机号/密码登录，不需要输入模型 API Key。保留锁定的 Core Runtime，扩展既有 `@insight-ai/desktop-integration`，不新增企业业务包、不迁入画布。

```text
Shell 用户中心登录（现有安全存储及 Cookie）
  → Host 发起模型请求，通过父子 IPC 请求凭证
  → Main 校验当前 Harness 实例、账号目录和登录会话
  → currentUser；仅过期时 refresh 一次，再校验 currentUser
  → 短期 access token 经 IPC 返回 Host
  → 原生 DeepSeekAdapter 发送 Bearer + /chat/completions
  → Dev 测试 Gateway / 编译版生产 Gateway → 原有 SSE、工具和会话 UI
```

| 项目 | 1.0 固定值 |
| --- | --- |
| 用户中心 | Dev：`https://gapi-test.insight-aigc.com`；编译版：`https://gapi.insight-aigc.com` |
| 登录 / 刷新 | `/user-server/loginV3`；GET `/user-server/refresh`，沿用隔离 Electron Session Cookie |
| Cookie 分区 | DEV：`insight-auth-test`（非持久）；Candidate / Stable：`persist:insight-auth-production` |
| 模型接口 | Dev：`https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1/chat/completions`；编译版：`https://gapi.insight-aigc.com/insight-harness-llm-gateway/v1/chat/completions` |
| Provider / Model | `yinsai-gateway` / `deepseek-v4-flash-vision-exp` |
| 用户中心 / 模型鉴权 | `token` header / `Authorization: Bearer <用户中心 access token>` |

DEV 使用测试登录环境，Candidate / Stable 使用生产登录环境；登录、Cookie 分区、模型地址和 Skill 代理保持同一环境。测试与生产账号目录隔离，已有生产账号不会被改写或迁入测试账号目录。

更新上传仍使用 GitHub OIDC → 目录级 OSS STS。模型会话使用用户中心 token，二者不得混用，不增加 OSS AccessKey 或用户自填模型 Key。

## 已实现的边界

- Main 是唯一登录/刷新所有者；并发模型鉴权共享一次校验，不让 Host 再维护一套登录。
- Main 绑定当前子进程和账号目录；登录状态变化立即撤销旧通道。校验/刷新完成前复查会话 revision，已开始的凭证保存与退出清理串行执行。
- Host 按操作取 token，不持久缓存；token 不进入 renderer、环境变量、Profile 配置、日志或明文镜像。不复制 refresh token。
- 用户中心单请求超时 10 秒；Host 等待最长 35 秒，覆盖校验→刷新→再校验。离线保留登录，明确过期才清除会话并返回登录流程。
- Gateway 模型 401/403 不透明重发整轮会话，不将它误当 STS 失败；可提示用户重试/重新登录，后台需核查模型授权。用户中心有效不等于 Gateway 必然授权成功。
- 原生 DeepSeekAdapter 继续处理 SSE、工具参数、取消、模型上下文与错误。出厂默认模型改为 Gateway，禁用 `llm-deepseek`、`llm-pi-ai` 与 `ui-settings-models` 的模型密钥页；插件市场和 Agent 模式保留。
- 普通 Profile 的第一方包沿用现有安装方刷新机制，不需要升级 Profile schema。安全模式仍只加载隔离的 Core 恢复组件，不加载此 Gateway 插件；仅用于诊断/恢复，不是免密钥会话验收入口，应修复后回到普通模式。
- 未增加动态模型管理、后台配置同步、工具/技能同步或凭证轮换系统。已有内部测试会话若记住了旧 Provider，可新建会话或选择 Gateway；首发不迁移未对外发布的旧模型配置。

## 自动化证据（2026-09-09，macOS arm64）

- 最新本地 `main` 执行 `npm test`：89 个测试文件、565 项通过。包含鉴权刷新、离线、并发、过期退出、旧请求撤销、保存期间退出、IPC 关联及超时，以及新正式/DEV Bundle ID、打包元数据和 Release Runtime 测试门禁契约。
- 全新 checkout 先执行 `npm run prepare:core-runtime` 再跑上述完整验证；没有准备 Core 时，真实 Adapter/进程集成测试会明确跳过，不能作为发布验收。Release workflow 已在各平台打包准备锁定 Runtime 后执行 `npm test`，并由静态契约阻止该门禁被移除；macOS UtilityProcess 测试仅在 macOS 执行。
- 真实锁定 Core Adapter 的 `prepareCall().stream()` + 真实 Node IPC：4 种情形通过（成功、用户中心过期、Gateway 401、取消）。HTTP 使用本地响应替身；验证完整 URL、Bearer、默认模型、工具参数、SSE 和下一请求重新取凭证，不代表真实工具执行闭环。
- 真实 Electron `utilityProcess` + 同一 Core Adapter：macOS 凭证通道成功通过。Windows 的 IPC 代码路径使用 Node 测试覆盖，Windows 安装包仍需实机验收。
- `npm run typecheck`、`npm run build:prepared`、`npm run prepare:bundled-profile` 通过；Core lock 未修改。合并提交完成后已执行过锁定 Runtime 的完整下载、摘要校验和 DEV 打包；身份规范提交未改变 Runtime 锁，最新 Candidate 复用了同一已验证 Runtime。
- 使用当前打包 Runtime 和临时 Profile 执行 `smokePackagedHarness` 通过：Gateway 注册、模型目录、创建工作区/会话、稳定运行 20 秒且无 stderr。该检查已加入现有打包冒烟脚本。
- 最新本地 Candidate 目录包的 Bundle ID 为 `com.insight-aigc.desktop`，版本 `1.0.0-rc.1`，渠道 `candidate`；Developer ID 深度严格签名、必需更新资源和包内 Harness Gateway 烟测均通过。该目录包未公证、未启动，不能替代 GitHub Candidate 的 notarize/staple、quarantine 启动和真实账号验收。
- 隔离身份 DEV 目录包已由用户人工确认启动时不再弹出钥匙串授权框。未读取用户真实凭证、未请求真实模型、未产生模型额度消耗；STS 实现未改动，本地 `main` 尚未推送，也未打 tag、触发远程 workflow 或发布 OSS 资产。

## 正式发布前人工门禁

使用隔离身份 `因赛AI Dev`，随后对正式签名 Candidate 重做关键流程。记录 Shell commit、Core commit、确切安装资产、系统版本和结果；截图/日志必须脱敏，不附 token、Cookie 或手机号明文。

- [ ] 测试账号在空白普通 Profile 完成 Shell 登录，直接新建会话，未填写 Key 即收到真实流式回复；确认模型服务接受用户中心 token。
- [ ] 模型触发一个无破坏性的工具（例如读取测试工作区文件），工具执行后模型能继续回答；取消生成能停止，不产生重复整轮请求。
- [ ] 重启恢复登录后继续会话；退出后不能继续调用，重新登录/切换账号不访问上一账号会话和凭证。
- [ ] 后台协助使 access token 过期，验证一次 Cookie 刷新成功；刷新会话也失效时回到 Shell 登录，而不是 API Key 设置页。
- [ ] 断网或用户中心超时后提示可重试，恢复网络后可继续；Gateway 401/403/429/5xx 不循环重发、不要求用户补模型 Key。
- [ ] 如果 1.0 宣称支持图片，实测图像输入及 Files API/inline fallback。静态模型目录的 image 标识和文本测试不能作为图像功能通过证据。
- [ ] macOS arm64、macOS x64、Windows x64 的实际 Candidate 均重复“登录→回复→退出→重启”关键链路，无凭证明文日志和 Key 必填引导。

以上真实链路未完成前，不得把“免 API Key 会话已验收”写入 1.0 发布结论。
