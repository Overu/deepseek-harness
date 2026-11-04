# PR-Agent code review

English | [中文](README.zh.md)

## Summary

[PR-Agent](https://github.com/The-PR-Agent/pr-agent) posts AI code reviews on pull requests through the [review workflow](../workflows/pr-agent.yml). Reviews use your OpenAI API account; API usage and any applicable GitHub Actions charges belong to that account and repository. The workflow does not replace required CI checks or human approval.

## Table of Contents

- [Setup](#setup)
- [Review behavior](#review-behavior)
- [Model configuration](#model-configuration)
- [Maintenance and verification](#maintenance-and-verification)

<a id="setup"></a>

## Setup

1. In the repository that receives pull requests, open **Settings > Secrets and variables > Actions > Secrets** and create `OPENAI_KEY` with an OpenAI API key. The key needs access to the selected model and available API credit or billing. Do not commit it or put a ChatGPT login token here.
2. Merge the workflow and [`.pr_agent.toml`](../../.pr_agent.toml) into the repository's default branch. The integration uses GitHub's job token automatically; no personal GitHub token or Qodo subscription is needed.
3. Open a non-draft pull request or post `/review` on an existing PR as an eligible commenter. Check **PR Agent / Code review** in Actions and the review comment. A missing `OPENAI_KEY` fails with a setup instruction before PR-Agent runs.

<a id="review-behavior"></a>

## Review behavior

Non-draft PRs are reviewed when opened, reopened, or marked ready for review, including fork PRs and PRs targeting a stack parent. Drafts and pushes do not automatically invoke review. GitHub's job permissions allow posting reviews and comments, with read-only repository contents.

For an on-demand review, post exactly `/review` as a new PR comment. The workflow accepts only GitHub `OWNER`, `MEMBER`, or `COLLABORATOR` associations. Other comments, issue comments outside PRs, command parameters, `/describe`, and `/improve` do not start PR-Agent. An explicit `/review` can review a draft.

Only code review is enabled. PR-Agent uses a persistent summary comment, responds in Chinese, and receives repository review instructions from the default branch. It does not automatically rewrite PR descriptions, publish review labels, apply code changes, or approve PRs. New runs cancel older in-progress jobs for the same PR.

The workflow reads PR data through the GitHub API and never checks out, installs, or executes PR code. Repository settings come from the default branch. Treat PR content as untrusted input even though it is sent to the model for review.

<a id="model-configuration"></a>

## Model configuration

The default model is [`gpt-5.4-mini`](https://developers.openai.com/api/docs/models/gpt-5.4-mini). To change it, open **Settings > Secrets and variables > Actions > Variables**, create the repository variable `PR_AGENT_MODEL`, and set it to an OpenAI model ID supported by PR-Agent and accessible to your key. No workflow edit is needed. An absent or empty variable selects the default model.

The workflow passes this value as `CONFIG__MODEL` and disables fallback models, so a model-access error does not silently select another model. The API provider's response and Actions logs identify authentication, quota, or model-access failures; correct the key, billing, or variable before retrying.

[`.pr_agent.toml`](../../.pr_agent.toml) owns review instructions and presentation. Workflow environment variables own model selection and review-only execution and take precedence over repository settings. PR-Agent's [`configuration.toml`](https://github.com/The-PR-Agent/pr-agent/blob/v0.49.0/pr_agent/settings/configuration.toml) documents the supported settings for the pinned release.

<a id="maintenance-and-verification"></a>

## Maintenance and verification

The workflow pins PR-Agent v0.49.0 by Docker image digest. When updating, verify the official release image digest and review its configuration and credential-handling changes before replacing the pin. Follow the upstream [security guidance](https://github.com/The-PR-Agent/pr-agent/blob/v0.49.0/SECURITY.md). Disable **PR Agent** in the repository's Actions page to stop automatic and comment-triggered reviews.

The [workflow tests](../../scripts/pr-agent-workflow.spec.ts), included in the repository unit-test suite, verify review-only execution, permissions, the pinned image, and accepted and rejected trigger cases. A maintainer must verify the first live review after configuring `OPENAI_KEY`; local static checks cannot establish account access, API billing, or successful comment publication.
