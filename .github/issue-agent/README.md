# Issue Agent

English | [中文](README.zh.md)

## Summary

Use `/agent` in a GitHub Issue to ask questions, investigate code, summarize discussion, or request code changes and a draft PR. The [workflow](../workflows/issue-agent.yml) uses the repository's existing `OPENAI_KEY`. Model calls consume your OpenAI API allowance; GitHub Actions compute is billed according to the repository's plan.

## Table of Contents

- [Setup](#setup)
- [Conversation](#conversation)
- [Code changes](#code-changes)
- [Permissions and limits](#permissions-and-limits)
- [Failures and maintenance](#failures-and-maintenance)

<a id="setup"></a>

## Setup

1. Enable Issues in the target repository and configure the `OPENAI_KEY` Actions secret with an API key that can use the chosen model.
2. Under **Settings > Actions > General > Workflow permissions**, enable **Allow GitHub Actions to create and approve pull requests**. The workflow only creates draft PRs; it never approves or merges them.
3. Merge the workflow and its `.github/issue-agent/` helpers into the default branch. No GitHub App or additional API key is required.
4. Optionally set the Actions repository variable `ISSUE_AGENT_MODEL`. The default is `gpt-5.4-mini`, with medium reasoning effort. The workflow pins the Codex Action and CLI versions.

<a id="conversation"></a>

## Conversation

Post a new Issue comment whose first command is `/agent`, followed by a natural-language request:

```text
/agent Explain the likely cause of this issue and identify the relevant code.
/agent Summarize the discussion and recommend the next step.
/agent Check whether the latest code already fixes this problem.
/agent Implement the agreed fix, add relevant tests, and open a draft PR.
```

The command is case-sensitive. Ordinary comments, comment edits, bots, and PR comments do not invoke this agent. Each request checks the comment author's current repository permission; only users with write, maintain, or admin access may run it.

The agent receives the Issue body and paginated discussion as context. Only the current authorized command directs the new task; quoted text and earlier comments are reference material. The agent replies in Chinese. Follow-up `/agent` comments continue with the discussion and any existing draft PR, without storing a separate conversational database.

Analysis, explanations, and summaries produce an Issue reply. An unclear request should produce a clarification question. Explicit requests to change code may create or update a draft PR; generated changes accompanying a reply-only result are rejected.

<a id="code-changes"></a>

## Code changes

A first code-change request starts from a fixed default-branch commit and creates `codex/issue-<issue>-<comment>`. Follow-up requests can update the single open draft PR that the agent owns for that Issue. Closed, merged, or ready-for-review PRs are not overwritten. A branch without its expected agent-owned draft PR requires manual inspection.

The publisher rechecks authorization, comment edits, PR ownership, and the exact remote commit before writing. It creates a commit whose parent is the prepared commit and uses an exact Git lease; a concurrent update stops publication. User text outside the agent's generated report remains intact. Replies include the resulting PR and Actions links.

PRs use one canonical `kind/*` label and at least one `area/*` label from the repository's existing label catalog. The agent receives that catalog as context and cannot create labels. A missing classification requires a maintainer to configure the appropriate labels first.

The agent can inspect files and run commands available inside its workspace sandbox. The workflow does not install repository dependencies or execute repository setup scripts. Tests that need unavailable dependencies may remain unrun; the PR must state that limitation. Review the actual Actions log and test evidence before accepting a change. PR CI created with the job token may require a maintainer's approval.

<a id="permissions-and-limits"></a>

## Permissions and limits

The coding job has repository read permission. Codex runs as a separate unprivileged account through the official API-key proxy, and it cannot write Git metadata or run GitHub publication calls. A fresh publishing job has repository, Issue, and PR write permissions, receives no OpenAI key, and treats generated files as data. It never installs or executes the generated code.

Publication rejects workflow/action changes, the Issue Agent's own helpers, agent instruction/configuration files, Git attributes/modules configuration, environment files, symbolic links, submodules, path traversal, duplicate paths, and special files. These tasks require a separate human-authored change. The [artifact validator](artifacts.mjs) defines the exact rejected paths and byte/file limits.

Issue context is bounded and must be complete: excessive history or oversized content fails visibly instead of silently dropping discussion. Requests for the same Issue are queued without canceling running work. GitHub's queue holds up to 100 pending runs; ordering follows queue arrival, which can differ from comment creation order. Wait for a reply before sending a dependent instruction.

<a id="failures-and-maintenance"></a>

## Failures and maintenance

An incomplete run posts an Issue notice with its Actions link when GitHub access remains available. If publication fails after a push or PR request, inspect the branch and PR before retrying: a GitHub failure does not establish that no remote change occurred. Completed requests carry a bot-owned reply marker so rerunning the same event does not repeat the task.

Authentication, model access, or quota errors require fixing `OPENAI_KEY`, the model variable, or API billing. Missing PR-creation permission requires the Actions setting above. A remote branch update requires a new command so the agent can inspect the current code. Unauthorized users receive no generated reply and cannot spend the API key.

Disable **Issue Agent** on the repository's Actions page to stop new tasks. Existing replies, branches, and PRs remain available for review. Update the pinned Action and Codex CLI together after checking their credential-isolation and output-schema behavior. The [context tests](../../scripts/issue-agent-context.spec.ts), [artifact tests](../../scripts/issue-agent-artifacts.spec.ts), [publisher tests](../../scripts/issue-agent-publish.spec.ts), and [workflow tests](../../scripts/issue-agent-workflow.spec.ts) cover the key acceptance and rejection paths.

## Dev Note

Natural-language intent is interpreted by the model. Structural validation limits the result to an Issue reply or draft PR; it cannot establish that every generated answer or code change is correct.
