# PR-Agent 代码审查

[English](README.md) | 中文

## 摘要

[PR-Agent](https://github.com/The-PR-Agent/pr-agent) 通过[审查工作流](../workflows/pr-agent.yml) 在拉取请求中发布 AI 代码审查。审查使用你自己的 OpenAI API 账户；API 用量及适用的 GitHub Actions 费用由对应账户和仓库承担。该工作流不替代必需的 CI 检查或人工审批。

## 目录

- [配置接入](#setup)
- [审查行为](#review-behavior)
- [模型配置](#model-configuration)
- [维护与验证](#maintenance-and-verification)

<a id="setup"></a>

## 配置接入

1. 在接收拉取请求的仓库中打开 **Settings > Secrets and variables > Actions > Secrets**，创建 `OPENAI_KEY`，值为 OpenAI API key。该密钥需要所选模型的访问权限，以及可用的 API 额度或计费配置。不要提交密钥，也不要在此填写 ChatGPT 登录 token。
2. 将工作流和 [`.pr_agent.toml`](../../.pr_agent.toml) 合入仓库默认分支。集成自动使用 GitHub 任务令牌，不需要个人 GitHub token 或 Qodo 订阅。
3. 打开一个非草稿拉取请求，或由符合条件的评论者在已有 PR 中发送 `/review`。检查 Actions 中的 **PR Agent / Code review** 和审查评论。缺少 `OPENAI_KEY` 时，任务会在运行 PR-Agent 前失败并提示配置方法。

<a id="review-behavior"></a>

## 审查行为

非草稿 PR 在创建、重新打开或标记为可审查时触发审查，包括来自 fork 的 PR 和以堆栈父分支为目标的 PR。草稿和推送提交不会自动触发审查。GitHub 任务权限允许发布审查和评论，对仓库内容仅有读取权限。

按需审查时，新建一条内容恰好为 `/review` 的 PR 评论。工作流仅接受 GitHub 关联身份为 `OWNER`、`MEMBER` 或 `COLLABORATOR` 的评论者。其他评论、普通 Issue 评论、命令参数、`/describe` 和 `/improve` 均不会启动 PR-Agent。显式发送 `/review` 可以审查草稿。

集成仅启用代码审查。PR-Agent 使用可更新的汇总评论，以中文回复，并从默认分支读取仓库审查指令。它不会自动改写 PR 正文、发布审查标签、应用代码修改或批准 PR。同一个 PR 的新任务会取消仍在运行的旧任务。

工作流通过 GitHub API 读取 PR 数据，不检出、安装或执行 PR 代码。仓库配置来自默认分支。PR 内容虽然会发送给模型审查，仍应视为不可信输入。

<a id="model-configuration"></a>

## 模型配置

默认模型为 [`gpt-5.4-mini`](https://developers.openai.com/api/docs/models/gpt-5.4-mini)。如需更换，打开 **Settings > Secrets and variables > Actions > Variables**，创建仓库变量 `PR_AGENT_MODEL`，值为 PR-Agent 支持且你的密钥有权访问的 OpenAI 模型 ID。无需修改工作流。变量缺失或为空时使用默认模型。

工作流将该值作为 `CONFIG__MODEL` 传入，并禁用备用模型，避免模型访问失败时静默改用其他模型。API 服务的响应和 Actions 日志会指出认证、额度或模型访问错误；重试前应修正密钥、计费配置或变量。

[`.pr_agent.toml`](../../.pr_agent.toml) 管理审查指令和展示方式。工作流环境变量管理模型选择和仅审查执行，并优先于仓库配置。固定发布版的 [`configuration.toml`](https://github.com/The-PR-Agent/pr-agent/blob/v0.49.0/pr_agent/settings/configuration.toml) 说明支持的配置项。

<a id="maintenance-and-verification"></a>

## 维护与验证

工作流通过 Docker 镜像摘要固定 PR-Agent v0.49.0。升级时，应先核验官方发布镜像摘要，并审查其配置及凭据处理变更，再替换固定值。遵循上游[安全说明](https://github.com/The-PR-Agent/pr-agent/blob/v0.49.0/SECURITY.md)。在仓库 Actions 页面禁用 **PR Agent**，即可停止自动和评论触发的审查。

[工作流测试](../../scripts/pr-agent-workflow.spec.ts) 纳入仓库单元测试，验证仅审查执行、权限、镜像固定值及允许和拒绝的触发情况。维护者配置 `OPENAI_KEY` 后必须验证首次真实审查；本地静态检查无法确认账户权限、API 计费或评论发布成功。
