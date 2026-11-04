/** Publishes a validated Issue Agent result after re-checking GitHub state. */

import { spawnSync } from 'node:child_process'
import { applyChanges, validateChanges, validateOutcome, validateResult } from './artifacts.mjs'

const BOT_LOGIN = 'github-actions[bot]'
const MAX_PAGES = 20

/** A failure whose code identifies whether any remote change may have happened. */
export class PublishError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message)
    this.name = 'PublishError'
    this.code = code
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** @param {unknown} value */
function text(value) {
  return typeof value === 'string' ? value : ''
}

/** @param {string} body */
function commandRequest(body) {
  const lines = body.split(/\r?\n/u)
  const match = /^\/agent[ \t]+(.+)$/u.exec(lines[0] ?? '')
  return match && match[1].trim() !== '' ? [match[1], ...lines.slice(1)].join('\n').trim() : undefined
}

/** @param {string} value */
function marker(value) {
  return `<!-- issue-agent:comment=${value} -->`
}

/** @param {string} branch */
function refPath(branch) {
  return encodeURIComponent(branch)
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+*?.]/gu, '\\$&')
}

/** @param {(path: string, options?: {method?: string, body?: unknown, allow404?: boolean}) => Promise<unknown>} api @param {string} path @param {string} subject */
async function pages(api, path, subject) {
  const entries = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const value = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, { method: 'GET' })
    if (!Array.isArray(value)) throw new PublishError('invalid-response', `Issue Agent: ${subject} page ${page} is not an array.`)
    entries.push(...value)
    if (value.length < 100) return entries
  }
  throw new PublishError('too-many-pages', `Issue Agent: ${subject} exceeds ${MAX_PAGES} pages.`)
}

/**
 * Confirms that the comment still authorizes this publication.
 *
 * @param {{ repository: string, issueNumber: number, commentId: number, actor: string, request: string, commentUpdatedAt?: string }} request Trusted request record.
 * @param {(path: string, options?: {method?: string, body?: unknown, allow404?: boolean}) => Promise<unknown>} api GitHub transport.
 * @returns {Promise<void>}
 */
export async function authorizeRequest(request, api) {
  const base = `/repos/${request.repository}`
  const comment = await api(`${base}/issues/comments/${request.commentId}`, { method: 'GET', allow404: true })
  if (!record(comment)
    || text(comment.user && record(comment.user) ? comment.user.login : '') !== request.actor
    || text(comment.user && record(comment.user) ? comment.user.type : '') !== 'User'
    || commandRequest(text(comment.body)) !== request.request
    || text(comment.created_at) !== text(comment.updated_at)
    || (request.commentUpdatedAt !== undefined && text(comment.updated_at) !== request.commentUpdatedAt)) {
    throw new PublishError('authorization-stale', 'Issue Agent: the request comment changed or is no longer available.')
  }
  const issue = await api(`${base}/issues/${request.issueNumber}`, { method: 'GET', allow404: true })
  if (!record(issue) || record(issue.pull_request)) {
    throw new PublishError('authorization-stale', 'Issue Agent: publication is allowed only for an open Issue, not a pull request.')
  }
  const permission = await api(`${base}/collaborators/${encodeURIComponent(request.actor)}/permission`, { method: 'GET', allow404: true })
  if (!record(permission) || !['write', 'maintain', 'admin'].includes(text(permission.permission))) {
    throw new PublishError('authorization-revoked', 'Issue Agent: the requester no longer has write permission.')
  }
}

/** @param {Record<string, unknown>} request @param {(path: string, options?: {method?: string, body?: unknown, allow404?: boolean}) => Promise<unknown>} api */
async function completed(request, api) {
  const comments = await pages(api, `/repos/${request.repository}/issues/${request.issueNumber}/comments`, `issue ${request.issueNumber} comments`)
  return comments.some(comment => record(comment)
    && text(comment.user && record(comment.user) ? comment.user.login : '') === BOT_LOGIN
    && text(comment.body).includes(marker(String(request.commentId))))
}

/** @param {Record<string, unknown>} request */
function verifyBranch(request) {
  const issue = String(request.issueNumber)
  const branch = text(request.branch)
  if (branch === text(request.defaultBranch)) throw new PublishError('invalid-branch', 'Issue Agent: refusing to publish to the default branch.')
  if (request.existingPrNumber === null) {
    if (branch !== `codex/issue-${issue}-${request.commentId}`) throw new PublishError('invalid-branch', 'Issue Agent: new branch does not belong to this comment.')
    return branch
  }
  if (!new RegExp(`^codex/issue-${issue}-\\d+$`, 'u').test(branch)) {
    throw new PublishError('invalid-branch', 'Issue Agent: reusable branch does not belong to this issue.')
  }
  return branch
}

/** @param {Record<string, unknown>} request @param {(path: string, options?: {method?: string, body?: unknown, allow404?: boolean}) => Promise<unknown>} api */
async function currentRef(request, api) {
  const ref = await api(`/repos/${request.repository}/git/ref/heads/${refPath(text(request.branch))}`, { method: 'GET', allow404: true })
  if (ref === null) return undefined
  if (!record(ref) || !record(ref.object) || text(ref.object.sha) === '') throw new PublishError('invalid-response', 'Issue Agent: branch reference is invalid.')
  return text(ref.object.sha)
}

/** @param {Record<string, unknown>} request @param {(path: string, options?: {method?: string, body?: unknown, allow404?: boolean}) => Promise<unknown>} api */
async function reusablePullRequest(request, api) {
  if (request.existingPrNumber === null) return undefined
  const pr = await api(`/repos/${request.repository}/pulls/${request.existingPrNumber}`, { method: 'GET', allow404: true })
  const head = record(pr) && record(pr.head) ? pr.head : undefined
  const base = record(pr) && record(pr.base) ? pr.base : undefined
  if (!record(pr)
    || text(pr.state) !== 'open'
    || pr.draft !== true
    || text(pr.user && record(pr.user) ? pr.user.login : '') !== BOT_LOGIN
    || !head || !base
    || !record(head.repo) || text(head.repo.full_name) !== request.repository
    || text(head.ref) !== request.branch || text(head.sha) !== request.workSha
    || text(base.ref) !== request.defaultBranch
    || !text(pr.body).includes(`<!-- issue-agent:issue=${request.issueNumber} -->`)) {
    throw new PublishError('invalid-pr', 'Issue Agent: the reusable draft pull request no longer matches this Issue.')
  }
  return pr
}

/** @param {string} workdir @param {string[]} args @param {Record<string, string>} env */
function defaultGit(workdir, args, env) {
  const result = spawnSync('git', args, {
    cwd: workdir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 16 * 1024 * 1024,
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** @param {unknown} result @param {string} operation */
function requireGit(result, operation) {
  if (!record(result) || result.status !== 0) throw new PublishError('git-failed', `Issue Agent: git ${operation} failed.`)
  return text(result.stdout).trim()
}

/** @param {Record<string, unknown>} request @param {string} workdir @param {string} token @param {(args: string[], options: {env: Record<string, string>}) => unknown | undefined} injected */
async function commitAndPush(request, workdir, token, injected) {
  const safeEnv = {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  }
  const run = (args, env = safeEnv) => requireGit(injected ? injected(args, { env }) : defaultGit(workdir, args, env), args[0] ?? 'command')
  if (run(['rev-parse', 'HEAD']) !== request.workSha) throw new PublishError('worktree-mismatch', 'Issue Agent: checkout is not at the trusted work commit.')
  const remote = run(['remote', 'get-url', 'origin'])
  if (!new RegExp(`^https://github\\.com/${escapeRegExp(request.repository)}(?:\\.git)?/?$`, 'u').test(remote)) {
    throw new PublishError('invalid-remote', 'Issue Agent: origin is not the expected GitHub repository.')
  }
  await applyChanges(workdir, request.outcome.changes)
  run(['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', 'add', '--all'])
  run([
    '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false',
    '-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit', '-m', `Issue #${request.issueNumber}: ${request.outcome.result.pr_title}`,
  ])
  if (run(['rev-parse', 'HEAD^']) !== request.workSha) throw new PublishError('commit-parent', 'Issue Agent: commit does not extend the trusted work commit.')
  const header = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')
  const pushEnv = {
    ...safeEnv,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${header}`,
  }
  const expected = request.expectedSha ?? ''
  try {
    run(['push', 'origin', `HEAD:refs/heads/${request.branch}`, `--force-with-lease=refs/heads/${request.branch}:${expected}`], pushEnv)
  } catch (error) {
    if (error instanceof PublishError) throw new PublishError('push-unknown', `Issue Agent: push failed; branch ${request.branch} may have changed remotely.`)
    throw error
  }
}

/** @param {string} body @param {string} report */
function replaceReport(body, report) {
  const start = '<!-- issue-agent:report:start -->'
  const end = '<!-- issue-agent:report:end -->'
  const first = body.indexOf(start)
  const last = body.indexOf(end)
  if (first < 0 || last < first || body.indexOf(start, first + start.length) >= 0 || body.indexOf(end, last + end.length) >= 0) {
    throw new PublishError('invalid-pr-body', 'Issue Agent: reusable draft pull request has no unambiguous report region.')
  }
  return `${body.slice(0, first + start.length)}\n${report}\n${body.slice(last)}`
}

/** @param {Record<string, unknown>} request @param {Record<string, unknown>} result */
function formatReport(request, result) {
  const heading = /^## Motivation[ \t]*\r?$/mu.exec(result.pr_body)
  if (!heading || heading.index === undefined) throw new PublishError('invalid-result', 'Issue Agent: PR body has no Motivation heading.')
  const afterHeading = heading.index + heading[0].length
  return `${result.pr_body.slice(0, afterHeading)}\n\nRefs #${request.issueNumber}${result.pr_body.slice(afterHeading)}`
}

/** @param {Record<string, unknown>} request @param {Record<string, unknown>} result */
function initialBody(request, result) {
  return `<!-- issue-agent:issue=${request.issueNumber} -->\n<!-- issue-agent:report:start -->\n${formatReport(request, result)}\n<!-- issue-agent:report:end -->`
}

/** @param {Record<string, unknown>} request @param {Record<string, unknown>} result @param {Record<string, unknown> | undefined} existing @param {(path: string, options?: {method?: string, body?: unknown, allow404?: boolean}) => Promise<unknown>} api */
async function publishPullRequest(request, result, existing, api) {
  if (existing) {
    const body = replaceReport(text(existing.body), formatReport(request, result))
    const updated = await api(`/repos/${request.repository}/pulls/${request.existingPrNumber}`, { method: 'PATCH', body: { body } })
    if (!record(updated) || text(updated.html_url) === '') throw new PublishError('invalid-response', 'Issue Agent: updated pull request is invalid.')
    return updated
  }
  const created = await api(`/repos/${request.repository}/pulls`, {
    method: 'POST',
    body: { title: result.pr_title, head: request.branch, base: request.defaultBranch, body: initialBody(request, result), draft: true },
  })
  if (!record(created) || text(created.html_url) === '') throw new PublishError('invalid-response', 'Issue Agent: created pull request is invalid.')
  return created
}

/** @param {Record<string, unknown>} request @param {Record<string, unknown>} result @param {(path: string, options?: {method?: string, body?: unknown, allow404?: boolean}) => Promise<unknown>} api */
async function verifyLabels(request, result, api) {
  for (const name of [result.kind, ...result.areas]) {
    const label = await api(`/repos/${request.repository}/labels/${encodeURIComponent(name)}`, { method: 'GET', allow404: true })
    if (label === null) throw new PublishError('missing-label', `Issue Agent: required label ${name} does not exist.`)
    if (!record(label) || text(label.name) !== name) throw new PublishError('invalid-response', `Issue Agent: label ${name} is invalid.`)
  }
}

/** @param {Record<string, unknown>} request @param {Record<string, unknown>} result @param {number} pullNumber @param {(path: string, options?: {method?: string, body?: unknown, allow404?: boolean}) => Promise<unknown>} api */
async function labels(request, result, pullNumber, api) {
  const current = await api(`/repos/${request.repository}/issues/${pullNumber}/labels`, { method: 'GET' })
  if (!Array.isArray(current)) throw new PublishError('invalid-response', 'Issue Agent: pull request labels are invalid.')
  const names = current.filter(record).map(label => text(label.name)).filter(Boolean)
  const desired = [...new Set([...names.filter(name => !name.startsWith('kind/')), result.kind, ...result.areas])]
  await api(`/repos/${request.repository}/issues/${pullNumber}/labels`, { method: 'POST', body: { labels: desired } })
}

/**
 * Publishes a validated model response. After a successful push, later errors
 * describe partial state because the branch is already externally visible.
 *
 * @param {{request: Record<string, unknown>, outcome: {result: Record<string, unknown>, changes: unknown}, api: (path: string, options?: {method?: string, body?: unknown, allow404?: boolean}) => Promise<unknown>, workdir: string, token: string, git?: (args: string[], options: {env: Record<string, string>}) => unknown}} input Publication dependencies.
 * @returns {Promise<{status: 'published' | 'duplicate', pullRequest?: string}>}
 */
export async function publishResult({ request, outcome, api, workdir, token, git }) {
  validateResult(outcome.result)
  validateChanges(outcome.changes)
  const valid = validateOutcome(outcome.result, outcome.changes)
  await authorizeRequest(request, api)
  if (await completed(request, api)) return { status: 'duplicate' }
  if (valid.result.mode === 'reply') {
    await api(`/repos/${request.repository}/issues/${request.issueNumber}/comments`, { method: 'POST', body: { body: `${valid.result.reply}\n\n${marker(String(request.commentId))}\n[Actions 日志](${request.runUrl})` } })
    return { status: 'published' }
  }
  if (!token) throw new PublishError('missing-token', 'Issue Agent: GitHub token is missing.')
  const branch = verifyBranch(request)
  const existing = await reusablePullRequest(request, api)
  if (existing) replaceReport(text(existing.body), formatReport(request, valid.result))
  const expectedSha = await currentRef(request, api)
  if (request.existingPrNumber === null ? expectedSha !== undefined : expectedSha !== request.workSha) {
    throw new PublishError('remote-moved', `Issue Agent: branch ${branch} moved before publication.`)
  }
  await verifyLabels(request, valid.result, api)
  const enriched = { ...request, branch, expectedSha, outcome: valid }
  await commitAndPush(enriched, workdir, token, git)
  let pull
  try {
    pull = await publishPullRequest(enriched, valid.result, existing, api)
    const pullNumber = typeof pull.number === 'number' && Number.isSafeInteger(pull.number) ? pull.number : undefined
    if (pullNumber === undefined) throw new PublishError('invalid-response', 'Issue Agent: published pull request has no number.')
    await labels(enriched, valid.result, pullNumber, api)
    await api(`/repos/${request.repository}/issues/${request.issueNumber}/comments`, {
      method: 'POST',
      body: { body: `${valid.result.reply}\n\n草稿 PR：${text(pull.html_url)}\n\n${marker(String(request.commentId))}\n[Actions 日志](${request.runUrl})` },
    })
  } catch (error) {
    const url = pull && text(pull.html_url) ? `; PR ${text(pull.html_url)}` : ''
    throw new PublishError('partial-publication', `Issue Agent: branch ${branch} was pushed but publication is incomplete${url}. Check the branch and run log before retrying.`)
  }
  return { status: 'published', pullRequest: text(pull.html_url) }
}
