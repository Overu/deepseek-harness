import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PublishError, publishResult } from '../.github/issue-agent/publish.mjs'

const roots: string[] = []
const prBody = (await readFile(new URL('./fixtures/issue-agent/pr-body.md', import.meta.url), 'utf8')).trimEnd()

const change = {
  mode: 'change',
  reply: '已完成修改。',
  pr_title: 'Fix the reported behavior',
  pr_body: prBody,
  kind: 'kind/bug-fix',
  areas: ['area/core'],
}
const reply = { mode: 'reply', reply: '我已分析问题。', pr_title: '', pr_body: '', kind: '', areas: [] }

function run(root: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-issue-agent-publish-'))
  roots.push(root)
  for (const args of [['init'], ['config', 'user.name', 'test'], ['config', 'user.email', 'test@example.test']]) expect(run(root, args).status).toBe(0)
  await writeFile(join(root, 'file.txt'), 'before\n')
  expect(run(root, ['add', '.']).status).toBe(0)
  expect(run(root, ['commit', '-m', 'baseline']).status).toBe(0)
  const sha = run(root, ['rev-parse', 'HEAD']).stdout.trim()
  return { root, sha }
}

function request(sha: string, overrides: Record<string, unknown> = {}) {
  return {
    repository: 'owner/repo', issueNumber: 7, commentId: 31, actor: 'alice', request: '修复 file.txt',
    defaultBranch: 'insight', defaultSha: sha, workSha: sha, branch: 'codex/issue-7-31',
    existingPrNumber: null, existingPrBody: null, runUrl: 'https://github.com/owner/repo/actions/runs/1', commentUpdatedAt: '2026-11-04T00:00:00Z', context: [],
    ...overrides,
  }
}

function outcome(result = change, changes = result.mode === 'reply' ? [] : [{ path: 'file.txt', content: Buffer.from('after\n').toString('base64'), mode: '100644' as const }]) {
  return { result, changes }
}

function apiFixture(state: {
  permission?: string
  edited?: boolean
  actorType?: string
  duplicate?: boolean
  ref?: string | null
  existing?: unknown
  failPull?: boolean
  missingLabel?: string
} = {}) {
  const calls: Array<{ path: string; options?: { method?: string; body?: unknown } }> = []
  const api = async (path: string, options: { method?: string; body?: unknown; allow404?: boolean } = {}) => {
    calls.push({ path, options })
    if (path.includes('/issues/comments/31')) return {
      id: 31, body: state.edited ? '/agent 已编辑' : '/agent 修复 file.txt', created_at: '2026-11-04T00:00:00Z', updated_at: state.edited ? '2026-11-04T00:01:00Z' : '2026-11-04T00:00:00Z', user: { login: 'alice', type: state.actorType ?? 'User' },
    }
    if (path.endsWith('/issues/7')) return { number: 7 }
    if (path.includes('/collaborators/alice/permission')) return { permission: state.permission ?? 'write' }
    if (path.includes('/issues/7/comments?')) return state.duplicate ? [{ user: { login: 'github-actions[bot]' }, body: '<!-- issue-agent:comment=31 -->' }] : []
    if (path.includes('/git/ref/heads/')) return state.ref === null || state.ref === undefined ? null : { object: { sha: state.ref } }
    if (path.includes('/pulls/9')) return state.existing
    if (path.endsWith('/pulls') && options.method === 'POST') {
      if (state.failPull) throw new Error('pull creation failed')
      return { number: 9, html_url: 'https://github.com/owner/repo/pull/9' }
    }
    if (path.includes('/labels/') && options.method === 'GET') {
      const name = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
      return name === state.missingLabel ? null : { name }
    }
    if (path.endsWith('/labels') && options.method === 'GET') return [{ name: 'area/existing' }, { name: 'kind/feature' }]
    if (path.endsWith('/labels')) return {}
    if (path.endsWith('/comments') && options.method === 'POST') return { id: 99 }
    throw new Error(`Unexpected API call ${options.method ?? 'GET'} ${path}`)
  }
  return { api, calls }
}

function gitWithPush(root: string, pushes: string[][] = []) {
  return (args: string[], { env }: { env: Record<string, string> }) => {
    if (args[0] === 'remote') return { status: 0, stdout: 'https://github.com/owner/repo.git\n', stderr: '' }
    if (args[0] === 'push') { pushes.push(args); return { status: 0, stdout: '', stderr: '' } }
    return run(root, args, env)
  }
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

// The trusted publisher runs only in the Ubuntu Actions helper; artifacts use /usr/bin/git.
describe.skipIf(process.platform === 'win32')('Issue Agent publisher', () => {
  it('rejects revoked permission and an edited request before writes', async () => {
    const { root, sha } = await fixture()
    for (const options of [{ permission: 'read' }, { edited: true }, { actorType: 'Bot' }]) {
      const { api, calls } = apiFixture(options)
      await expect(publishResult({ request: request(sha), outcome: outcome(reply), api, workdir: root, token: 'token' })).rejects.toBeInstanceOf(PublishError)
      expect(calls.some(call => call.options?.method === 'POST')).toBe(false)
    }
  })

  it('is idempotent when the bot completion marker already exists', async () => {
    const { root, sha } = await fixture()
    const { api, calls } = apiFixture({ duplicate: true })
    await expect(publishResult({ request: request(sha), outcome: outcome(reply), api, workdir: root, token: 'token' })).resolves.toEqual({ status: 'duplicate' })
    expect(calls.filter(call => call.options?.method === 'POST')).toEqual([])
  })

  it('rejects reply artifacts and a draft PR that no longer matches', async () => {
    const { root, sha } = await fixture()
    const { api } = apiFixture()
    await expect(publishResult({ request: request(sha), outcome: outcome(reply, [{ path: 'file.txt', content: '', mode: '100644' }]), api, workdir: root, token: 'token' })).rejects.toThrow(/reply/u)
    const existing = { state: 'open', draft: true, user: { login: 'not-the-bot' }, head: { repo: { full_name: 'owner/repo' }, ref: 'codex/issue-7-1', sha }, base: { ref: 'insight' }, body: '<!-- issue-agent:issue=7 -->' }
    const stale = apiFixture({ existing })
    await expect(publishResult({ request: request(sha, { existingPrNumber: 9, branch: 'codex/issue-7-1', existingPrBody: existing.body }), outcome: outcome(), api: stale.api, workdir: root, token: 'token' })).rejects.toThrow(/reusable draft/u)
  })

  it('refuses arbitrary or default branches and remote movement', async () => {
    const { root, sha } = await fixture()
    for (const branch of ['insight', 'other']) {
      const fixtureApi = apiFixture()
      await expect(publishResult({ request: request(sha, { branch }), outcome: outcome(), api: fixtureApi.api, workdir: root, token: 'token' })).rejects.toThrow(/branch/u)
    }
    const reusable = { state: 'open', draft: true, user: { login: 'github-actions[bot]' }, head: { repo: { full_name: 'owner/repo' }, ref: 'codex/issue-7-1', sha }, base: { ref: 'insight' }, body: '<!-- issue-agent:issue=7 -->\n<!-- issue-agent:report:start -->\nold\n<!-- issue-agent:report:end -->' }
    const moving = apiFixture({ ref: 'different', existing: reusable })
    await expect(publishResult({ request: request(sha, { existingPrNumber: 9, branch: 'codex/issue-7-1', existingPrBody: reusable.body }), outcome: outcome(), api: moving.api, workdir: root, token: 'token' })).rejects.toThrow(/moved/u)
  })

  it('does not create a pull request after an unknown push result', async () => {
    const { root, sha } = await fixture()
    const fixtureApi = apiFixture()
    const git = gitWithPush(root)
    const failing = (args: string[], options: { env: Record<string, string> }) => args[0] === 'push' ? { status: 1, stdout: '', stderr: 'network' } : git(args, options)
    await expect(publishResult({ request: request(sha), outcome: outcome(), api: fixtureApi.api, workdir: root, token: 'token', git: failing })).rejects.toThrow(/may have changed/u)
    expect(fixtureApi.calls.some(call => call.path.endsWith('/pulls') && call.options?.method === 'POST')).toBe(false)
  })

  it('refuses an unavailable result label before modifying or pushing', async () => {
    const { root, sha } = await fixture()
    const fixtureApi = apiFixture({ missingLabel: 'area/missing' })
    const pushes: string[][] = []
    await expect(publishResult({ request: request(sha), outcome: outcome({ ...change, areas: ['area/missing'] }), api: fixtureApi.api, workdir: root, token: 'token', git: gitWithPush(root, pushes) })).rejects.toMatchObject({ code: 'missing-label' })
    expect(pushes).toEqual([])
    expect(fixtureApi.calls.some(call => call.path.endsWith('/pulls') && call.options?.method === 'POST')).toBe(false)
    expect(fixtureApi.calls.some(call => call.path === '/repos/owner/repo/labels' && call.options?.method === 'POST')).toBe(false)
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('before\n')
  })

  it('refuses a reusable PR without a bounded report before pushing', async () => {
    const { root, sha } = await fixture()
    const existing = { state: 'open', draft: true, user: { login: 'github-actions[bot]' }, head: { repo: { full_name: 'owner/repo' }, ref: 'codex/issue-7-1', sha }, base: { ref: 'insight' }, body: '<!-- issue-agent:issue=7 --> user notes' }
    const fixtureApi = apiFixture({ existing, ref: sha })
    const pushes: string[][] = []
    await expect(publishResult({ request: request(sha, { existingPrNumber: 9, branch: 'codex/issue-7-1', existingPrBody: existing.body }), outcome: outcome(), api: fixtureApi.api, workdir: root, token: 'token', git: gitWithPush(root, pushes) })).rejects.toThrow(/report region/u)
    expect(pushes).toEqual([])
  })

  it('commits without running a repository hook and pushes only its CAS branch', async () => {
    const { root, sha } = await fixture()
    const hookRoot = await mkdtemp(join(tmpdir(), 'dsh-issue-agent-hook-'))
    roots.push(hookRoot)
    const marker = join(hookRoot, 'hook-ran')
    const hook = join(hookRoot, 'pre-commit')
    await writeFile(hook, `#!/bin/sh\nprintf hook > ${marker}\n`)
    await chmod(hook, 0o755)
    expect(run(root, ['config', 'core.hooksPath', hookRoot]).status).toBe(0)
    const pushes: string[][] = []
    const fixtureApi = apiFixture()
    await expect(publishResult({ request: request(sha), outcome: outcome(), api: fixtureApi.api, workdir: root, token: 'token', git: gitWithPush(root, pushes) })).resolves.toMatchObject({ status: 'published' })
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(run(root, ['log', '-1', '--format=%ae']).stdout.trim()).toBe('41898282+github-actions[bot]@users.noreply.github.com')
    expect(pushes).toEqual([['push', 'origin', 'HEAD:refs/heads/codex/issue-7-31', '--force-with-lease=refs/heads/codex/issue-7-31:']])
    const labels = fixtureApi.calls.filter(call => call.path.endsWith('/labels') && call.options?.method !== undefined)
    expect(labels.some(call => call.path.includes('/issues/7/labels'))).toBe(false)
    expect(labels).toContainEqual({ path: '/repos/owner/repo/issues/9/labels', options: { method: 'POST', body: { labels: ['area/existing', 'kind/bug-fix', 'area/core'] } } })
    const pull = fixtureApi.calls.find(call => call.path === '/repos/owner/repo/pulls' && call.options?.method === 'POST')
    const pullBody = pull?.options?.body as { body: string } | undefined
    expect(pullBody?.body).toContain('## Motivation\n\nRefs #7\n\nFix the behavior described in the Issue.')
  })
})
