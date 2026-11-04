# GitHub Agent

[English](README.md) | 中文

## 摘要

在 GitHub Issue 或 PR 中使用 `/agent` 提问、调查代码、总结讨论或要求修改代码。Issue 可以生成草稿 PR；已有 PR 支持代码审查和按要求修复。[工作流](../workflows/github-agent.yml) 复用仓库已有的 `OPENAI_KEY`。模型调用消耗你的 OpenAI API 额度；GitHub Actions 计算按仓库套餐计费。

## 目录

- [配置接入](#setup)
- [对话](#conversation)
- [PR 审查](#pr-reviews)
- [代码修改](#code-changes)
- [权限与限制](#permissions-and-limits)
- [失败处理与维护](#failures-and-maintenance)

<a id="setup"></a>

## 配置接入

1. 在目标仓库开启 Issues，并为 Actions 的 `OPENAI_KEY` secret 配置有权使用所选模型的 API key。
2. 在 **Settings > Actions > General > Workflow permissions** 中开启 **Allow GitHub Actions to create and approve pull requests**。工作流只创建草稿 PR，不批准或合并 PR。
3. 将工作流及其 `.github/issue-agent/` 辅助文件合入默认分支。不需要 GitHub App 或额外 API key。
4. 可选配置 Actions 仓库变量 `AGENT_MODEL`。模型依次选取 `AGENT_MODEL`、`ISSUE_AGENT_MODEL`、`PR_AGENT_MODEL`、`gpt-5.4-mini`。所有请求共用此选择和 medium 推理强度。工作流固定 Codex Action 和 CLI 的版本。

<a id="conversation"></a>

## 对话

新建一条 Issue 或 PR Conversation 评论，以 `/agent` 开头并跟随自然语言指令：

```text
/agent Explain the likely cause of this issue and identify the relevant code.
/agent Summarize the discussion and recommend the next step.
/agent Check whether the latest code already fixes this problem.
/agent Implement the agreed fix, add relevant tests, and open a draft PR.
/agent Review this PR for concurrency bugs.
/agent Fix the confirmed defect and update this PR.
```

命令区分大小写。普通评论、评论编辑、机器人和行内审查评论不会调用此助手。每次请求都会检查评论者当前的仓库权限，仅允许有 write、maintain 或 admin 权限的用户执行。

助手接收 Issue 正文和分页读取的讨论作为上下文。对于 PR，还会读取变更文件的 patch、提交、已提交的审查和行内评论。评论触发的任务仅由当前经过授权的命令指挥；引用内容和旧评论仅作为资料。助手以中文回复。后续 `/agent` 评论会结合讨论和当前 PR 继续工作，不另建对话数据库。

分析、解释和总结会生成 Issue 回复。不明确的请求应得到澄清问题。明确要求修改代码时可以创建或更新 Issue 草稿 PR，或向已有 PR 追加提交。如果仅回复的结果附带了文件变更，发布器会拒绝它。

<a id="pr-reviews"></a>

## PR 审查

非草稿 PR 在打开、重新打开或标记为可审查时自动审查，包括 fork PR。推送不会自动请求再次审查。在 PR Conversation 中发送精确的 `/review` 可显式请求只读审查，包括草稿；`/agent` 支持自然语言审查要求和讨论。审查以中文 Conversation 回复发布，不批准或合并 PR。

自动审查使用固定的可信审查指令和包含 base/head 的完成标记。评论触发的请求检查评论者当前的写权限。PR 描述、patch 和讨论仍属于参考资料。PR 请求要求静态检查：提示禁止执行仓库程序、测试、依赖安装、hook 和初始化脚本。

仅回复的 PR 请求检出 PR 的基准提交，并通过 patch 数据接收 head 改动，因此工作区不会放入 PR head 的可执行文件和指令。基准文件提供周边上下文。GitHub 可能省略或截断 patch，包括二进制文件；回复必须说明受影响文件及审查限制。

<a id="code-changes"></a>

## 代码修改

首次代码修改从默认分支的固定提交开始，创建 `codex/issue-<issue>-<comment>`。后续请求可更新该 Issue 唯一打开、由助手拥有的草稿 PR。已关闭、已合并或已标记可审查的 PR 不会被覆盖。分支存在但缺少预期的助手草稿 PR 时，需要人工检查。

直接在 PR 中发送的请求，仅能更新属于本仓库且既非默认分支、PR 基准分支，也非受保护分支的已有 head 分支。fork、已关闭或已合并的 PR 不接收代码更新。更新保留已有 PR 的标题、描述、标签和草稿状态。

发布器在写入前重新检查授权、评论编辑、PR 身份、base/head 提交及分支保护。它创建以准备阶段提交为父节点的提交，并使用精确 Git lease；并发更新会阻止发布。更新 PR 分支后，它对滞后的 PR 记录最多重查四次，同时确认分支仍指向自身提交；遇到不同提交或 PR 身份变化时停止确认，未确认的更新会报告为未完成。助手生成报告之外的用户文字会保留。回复包含生成的 PR 和 Actions 链接。

Issue 生成的 PR 从仓库现有标签目录中选用一个规范的 `kind/*` 标签及至少一个 `area/*` 标签。助手会收到该目录作为上下文，不能创建标签。缺少合适分类时，需要维护者先配置相应标签。

对于 Issue 任务，助手可以检查文件，并在工作区沙箱内运行已有命令。工作流不安装仓库依赖，也不执行仓库初始化脚本。需要尚未提供的依赖的测试可能无法运行；PR 必须说明这一限制。接受修改前应检查实际 Actions 日志和测试证据。任务令牌创建的 PR，其 CI 可能需要维护者批准运行。

<a id="permissions-and-limits"></a>

## 权限与限制

可信编排代码从工作流提交检出；代码更新请求使用准备阶段确定的仓库和精确 head 提交。编码任务仅有仓库读取权限。Codex 通过官方 API key 代理，以独立低权限账户运行，无法写入 Git 元数据或调用 GitHub 发布操作。全新的发布任务拥有仓库、Issue 和 PR 写权限，不接收 OpenAI key，并将生成文件视为数据；它不安装或执行生成的代码。

可信用户配置将工作区标记为不可信，禁用项目本地 Codex 设置、hook 及其配置的 MCP 服务器。助手不能替换该配置。仅回复的请求使用只读沙箱；符合条件的代码请求使用工作区沙箱。仓库指令和技能仍是不可信文本，不能扩大发布权限。

发布器拒绝修改 workflow/action、GitHub Agent 自身辅助文件、Agent 指令和配置文件、Git attributes/modules 配置、环境文件，以及符号链接、子模块、路径穿越、重复路径和特殊文件。这些任务需要单独由人工提交。[产物验证器](artifacts.mjs) 定义精确的拒绝路径及字节和文件数量限制。

Issue 上下文有明确上限且必须完整：讨论过长或内容过大时，任务会显式失败，不会静默丢弃讨论。同一 Issue 或 PR 的请求排队运行，不取消正在执行的任务。GitHub 队列最多容纳 100 个待处理运行；顺序取决于进入队列的时间，可能与评论创建顺序不同。发送依赖上一轮结果的指令前，应等待上一轮回复。

<a id="failures-and-maintenance"></a>

## 失败处理与维护

运行未完成时，只要 GitHub 访问仍可用，就会在 Issue 发布包含 Actions 链接的通知。如果推送或 PR 请求之后发布失败，重试前应检查分支和 PR：GitHub 报错不代表远端没有发生变更。已完成的请求带有由机器人拥有的回复标记，重跑同一事件不会重复执行任务。

认证、模型权限或额度错误需要修正 `OPENAI_KEY`、模型变量或 API 计费配置。缺少创建 PR 权限时，需要开启上面的 Actions 设置。远端分支更新时，需要发送新指令，让助手读取当前代码。未授权的评论指令不会收到模型生成的回复，也不能消耗 API key；自动 PR 审查由仓库工作流启用。

在仓库 Actions 页面禁用 **GitHub Agent** 可停止新任务。已有回复、分支和 PR 会保留供审阅。检查凭据隔离和输出 schema 行为后，再一起升级固定的 Action 和 Codex CLI。[上下文测试](../../scripts/issue-agent-context.spec.ts)、[产物测试](../../scripts/issue-agent-artifacts.spec.ts)、[发布器测试](../../scripts/issue-agent-publish.spec.ts)和[工作流测试](../../scripts/issue-agent-workflow.spec.ts)覆盖主要的允许和拒绝路径。

## 开发备注

自然语言意图由模型解释。结构验证将发布限制为评论、Issue 草稿 PR 或符合条件的 PR 分支上的提交，无法保证生成的每个回答或代码修改都正确。
