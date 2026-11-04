/** GitHub Agent generation cannot inherit publication credentials or execute generated publishing code. */
import { existsSync, readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { load } from 'js-yaml'
import { expect, it } from 'vitest'

interface Step {
  name?: string
  if?: string
  uses?: string
  run?: string
  env?: Record<string, string>
  with?: Record<string, string | number | boolean>
}
interface Job {
  if?: string
  permissions: Record<string, string>
  steps: Step[]
}
const workflowText = readFileSync(new URL('../.github/workflows/github-agent.yml', import.meta.url), 'utf8')
const workflow = load(workflowText) as {
  on: Record<string, { types: string[] }>
  permissions: Record<string, string>
  concurrency: { group: string; 'cancel-in-progress': boolean; queue: string }
  jobs: Record<'prepare' | 'agent' | 'publish' | 'failure', Job>
}

interface EventOptions {
  type?: string
  association?: string
  pr?: boolean
  auto?: boolean
  draft?: boolean
}

function expressionContext(body: string, options: EventOptions = {}) {
  return {
    github: { run_id: 99, event_name: options.auto ? 'pull_request_target' : 'issue_comment', event: {
      issue: { number: 7, pull_request: options.pr ? {} : undefined },
      pull_request: options.auto ? { number: 7, draft: options.draft ?? false } : {},
      comment: { body, user: { type: options.type ?? 'User' }, author_association: options.association ?? 'OWNER' },
    } },
    startsWith: (value: string, prefix: string) => value.startsWith(prefix),
    contains: (values: string[], value: string) => values.includes(value),
    fromJSON: JSON.parse,
    format: (template: string, value: number) => template.replace('{0}', String(value)),
  }
}

it('accepts human commands and non-draft automatic PR reviews without a second reviewer', () => {
  expect(workflow.on).toEqual({
    issue_comment: { types: ['created'] },
    pull_request_target: { types: ['opened', 'reopened', 'ready_for_review'] },
  })
  const eligible = (body: string, options: EventOptions = {}) => Boolean(runInNewContext(workflow.jobs.prepare.if ?? '', expressionContext(body, options)))
  expect(eligible('/agent explain this issue')).toBe(true)
  expect(eligible('/agent explain this PR', { pr: true })).toBe(true)
  expect(eligible('/review', { pr: true })).toBe(true)
  expect(eligible('/review')).toBe(false)
  expect(eligible('/review extra', { pr: true })).toBe(false)
  expect(eligible('/agent explain this issue', { type: 'Bot' })).toBe(false)
  expect(eligible('Please implement this')).toBe(false)
  expect(eligible('/agent explain this issue', { association: 'CONTRIBUTOR' })).toBe(false)
  expect(eligible('', { auto: true })).toBe(true)
  expect(eligible('', { auto: true, draft: true })).toBe(false)
  expect(existsSync(new URL('../.github/workflows/pr-agent.yml', import.meta.url))).toBe(false)
  expect(existsSync(new URL('../.pr_agent.toml', import.meta.url))).toBe(false)
})

it('queues Issue and PR commands with auto reviews without replacing earlier conversations', () => {
  expect(workflow.concurrency).toMatchObject({ 'cancel-in-progress': false, queue: 'max' })
  const expression = workflow.concurrency.group.slice('github-agent-${{'.length, -2)
  const group = (body: string, options: EventOptions = {}) => String(runInNewContext(expression, expressionContext(body, options)))
  expect(group('/agent analyze this')).toBe('target-7')
  expect(group('/agent analyze this', { pr: true })).toBe('target-7')
  expect(group('/review', { pr: true })).toBe('target-7')
  expect(group('', { auto: true })).toBe('target-7')
  expect(group('ordinary comment')).toBe('ignored-99')
  expect(group('/agent analyze this', { association: 'NONE' })).toBe('ignored-99')
})

it('isolates the model key from publication and repository write permissions', () => {
  expect(workflow.permissions).toEqual({})
  expect(workflow.jobs.agent.permissions).toEqual({ contents: 'read' })
  expect(workflow.jobs.prepare.permissions.contents).toBe('read')
  expect(workflow.jobs.failure.permissions).toEqual({ contents: 'read', issues: 'write', 'pull-requests': 'write' })
  expect(workflow.jobs.publish.permissions).toEqual({ contents: 'write', issues: 'write', 'pull-requests': 'write' })
  for (const [name, job] of Object.entries(workflow.jobs)) {
    for (const step of job.steps) {
      expect(Object.keys(step.env ?? {})).not.toContain('OPENAI_KEY')
      if (step.with?.['openai-api-key']) expect(name).toBe('agent')
    }
  }
  const action = workflow.jobs.agent.steps.find(step => step.uses?.startsWith('openai/codex-action@'))
  expect(action?.with).toMatchObject({
    'openai-api-key': '${{ secrets.OPENAI_KEY }}',
    'safety-strategy': 'unprivileged-user',
    'codex-user': 'issueagent',
    'permission-profile': "${{ needs.prepare.outputs.capability == 'reply_only' && ':read-only' || ':workspace' }}",
    model: "${{ vars.AGENT_MODEL || vars.ISSUE_AGENT_MODEL || vars.PR_AGENT_MODEL || 'gpt-5.4-mini' }}",
    'codex-version': '0.166.0',
    'allow-users': '*',
  })
  expect(action?.with?.['codex-home']).toBeUndefined()
})

it('pins trusted tooling, protects Git metadata, and treats generated files only as data', () => {
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/u)
      if (step.uses?.startsWith('actions/checkout@')) {
        expect(step.with?.['persist-credentials']).toBe(false)
        if (step.with?.path !== 'work') expect(step.with?.ref).toBe('${{ github.workflow_sha }}')
        else expect(step.with?.ref).toContain('needs.prepare.outputs.work_sha')
      }
      if (step.run) expect(step.run).not.toContain('${{ github.event.')
    }
  }
  const setup = workflow.jobs.agent.steps.find(step => step.name === 'Prepare isolated agent account')?.run
  expect(setup).toContain('chmod 1770 "$GITHUB_WORKSPACE/work"')
  expect(setup).toContain('chown -hR runner:runner "$GITHUB_WORKSPACE/work/.git"')
  expect(setup).toContain('trust_level = "untrusted"')
  expect(setup).toContain('chmodSync(serverInfo, 0o666)')
  expect(setup).toContain('sudo -u issueagent test -w /home/issueagent')
  expect(setup).toContain('sudo -u issueagent test ! -w /home/issueagent/.codex/config.toml')
  expect(setup).toContain('install -d -o runner -g runner -m 1775')
  const stop = workflow.jobs.agent.steps.findIndex(step => step.name === 'Stop remaining agent processes')
  const collect = workflow.jobs.agent.steps.findIndex(step => step.name === 'Collect validated response and file changes')
  expect(stop).toBeGreaterThan(-1)
  expect(collect).toBeGreaterThan(stop)
  const workCheckout = workflow.jobs.publish.steps.find(step => step.with?.path === 'work')
  expect(workCheckout?.if).toBe("needs.prepare.outputs.capability != 'reply_only'")
  const publisher = workflow.jobs.publish.steps.filter(step => step.run)
  expect(publisher).toHaveLength(1)
  expect(publisher[0]?.run).toBe('node trusted/.github/issue-agent/run.mjs publish')
  expect(workflow.jobs.agent.steps.some(step => step.run?.includes('pnpm install'))).toBe(false)
})

it('keeps PR-head executables and instructions out of read-only model checkouts', () => {
  const checkout = workflow.jobs.agent.steps.find(step => step.with?.path === 'work')
  const select = (value: string, capability: string) => String(runInNewContext(value.slice(3, -2), {
    needs: { prepare: { outputs: { capability, base_sha: 'trusted-base', work_sha: 'attacker-head', work_repository: 'attacker/fork' } } },
    github: { repository: 'owner/repo' },
  }))
  expect(select(String(checkout?.with?.ref), 'reply_only')).toBe('trusted-base')
  expect(select(String(checkout?.with?.repository), 'reply_only')).toBe('owner/repo')
  expect(select(String(checkout?.with?.ref), 'pr_update')).toBe('attacker-head')
  expect(select(String(checkout?.with?.ref), 'issue_change')).toBe('attacker-head')
})
