/** Trusted GitHub Agent entrypoints; this file runs outside the editable checkout. */

import { appendFileSync, constants, fstatSync, mkdirSync, openSync, readFileSync, closeSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { collectChanges, validateChanges, validateOutcome, validateResult } from './artifacts.mjs'
import { authorizeEvent, prepareRequest, renderPrompt } from './context.mjs'
import { createApi } from './github.mjs'
import { publishResult } from './publish.mjs'

function readJson(file, maxBytes = 8 * 1024 * 1024) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('Issue Agent JSON file is not a bounded regular file')
    return JSON.parse(readFileSync(fd, 'utf8'))
  } finally {
    closeSync(fd)
  }
}

function output(name, value) {
  if (String(value).includes('\n') || String(value).includes('\r')) throw new Error('Invalid workflow output')
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

/**
 * Match a trusted input artifact to the webhook that owns this workflow run.
 * @param {Record<string, unknown>} request Prepared request.
 * @param {object} event GitHub webhook payload.
 * @param {string} repository Current workflow repository.
 * @param {string} eventName GitHub event name.
 * @returns {boolean} Whether the request belongs to this event and target.
 */
export function matchesEventRequest(request, event, repository, eventName) {
  const target = event.issue ?? event.pull_request
  if (request.repository !== repository || request.issueNumber !== target?.number) return false
  if (request.trigger === 'comment') {
    return eventName === 'issue_comment' && event.action === 'created'
      && typeof request.commentId === 'number' && request.commentId === event.comment?.id
      && (request.targetType === 'pull_request') === Boolean(event.issue?.pull_request)
      && ['issue', 'pull_request'].includes(request.targetType)
  }
  return eventName === 'pull_request_target' && request.trigger === 'review'
    && request.targetType === 'pull_request' && request.capability === 'reply_only'
    && request.commentId === null && request.workSha === event.pull_request?.head?.sha
    && request.baseSha === event.pull_request?.base?.sha
    && ['opened', 'reopened', 'ready_for_review'].includes(event.action)
}

async function prepare(api, directory) {
  const event = readJson(process.env.GITHUB_EVENT_PATH)
  const request = await prepareRequest({
    event,
    repository: process.env.GITHUB_REPOSITORY,
    api,
    runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  })
  output('run', request !== null)
  if (request === null) return
  mkdirSync(directory, { recursive: true })
  writeFileSync(resolve(directory, 'request.json'), `${JSON.stringify(request)}\n`)
  const policy = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8')
  writeFileSync(resolve(directory, 'prompt.md'), renderPrompt(request, policy))
  for (const [name, value] of Object.entries({
    default_sha: request.defaultSha,
    base_sha: request.baseSha ?? request.defaultSha,
    work_sha: request.workSha,
    work_repository: request.headRepository ?? request.repository,
    capability: request.capability,
  })) output(name, value)
}

async function collect(directory, workdir) {
  const result = validateResult(readJson('/home/issueagent/result.json', 1024 * 1024))
  const changes = await collectChanges(workdir)
  validateOutcome(result, changes)
  mkdirSync(directory, { recursive: true })
  writeFileSync(resolve(directory, 'outcome.json'), `${JSON.stringify({ result, changes })}\n`)
}

async function reportFailure(api) {
  const event = readJson(process.env.GITHUB_EVENT_PATH)
  const request = await authorizeEvent({
    event,
    repository: process.env.GITHUB_REPOSITORY,
    api,
  })
  if (request === null) return
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  await api(`/repos/${process.env.GITHUB_REPOSITORY}/issues/${request.issueNumber}/comments`, {
    method: 'POST',
    body: {
      body: `GitHub Agent 未能完成这次请求。请检查 [Actions 日志](${runUrl}) 后重新发送指令；如果发布阶段失败，分支或 PR 可能已更新，请先核对仓库状态。`,
    },
  })
}

async function main(command) {
  const directory = process.env.ISSUE_AGENT_STATE
  if (!directory) throw new Error('ISSUE_AGENT_STATE is missing')
  if (command === 'collect') return collect(directory, process.env.ISSUE_AGENT_WORKDIR)
  const api = createApi({ token: process.env.GITHUB_TOKEN, baseUrl: process.env.GITHUB_API_URL })
  if (command === 'prepare') return prepare(api, directory)
  if (command === 'failure') return reportFailure(api)
  if (command !== 'publish') throw new Error('Unknown Issue Agent command')
  const request = readJson(resolve(directory, 'input', 'request.json'))
  const event = readJson(process.env.GITHUB_EVENT_PATH)
  if (!matchesEventRequest(request, event, process.env.GITHUB_REPOSITORY, process.env.GITHUB_EVENT_NAME)) {
    throw new Error('Issue Agent input does not belong to this workflow event')
  }
  const outcome = readJson(resolve(directory, 'output', 'outcome.json'))
  validateResult(outcome.result)
  validateChanges(outcome.changes)
  validateOutcome(outcome.result, outcome.changes)
  await publishResult({ request, outcome, api, workdir: process.env.ISSUE_AGENT_WORKDIR, token: process.env.GITHUB_TOKEN })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv[2]).catch(error => {
    console.error(error instanceof Error ? error.message : 'Issue Agent failed')
    process.exitCode = 1
  })
}
