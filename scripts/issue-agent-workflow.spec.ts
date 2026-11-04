/** Issue Agent generation cannot inherit publication credentials or execute generated publishing code. */
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { load } from 'js-yaml'
import { expect, it } from 'vitest'

interface Step {
  name?: string
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
const workflowText = readFileSync(new URL('../.github/workflows/issue-agent.yml', import.meta.url), 'utf8')
const workflow = load(workflowText) as {
  on: Record<string, { types: string[] }>
  permissions: Record<string, string>
  concurrency: { group: string; 'cancel-in-progress': boolean; queue: string }
  jobs: Record<'prepare' | 'agent' | 'publish' | 'failure', Job>
}

it('accepts only new human Issue commands before checking live write permission', () => {
  expect(workflow.on).toEqual({ issue_comment: { types: ['created'] } })
  const eligible = (body: string, type = 'User', isPr = false, association = 'OWNER') => Boolean(runInNewContext(workflow.jobs.prepare.if ?? '', {
    github: { event: {
      issue: { pull_request: isPr ? {} : undefined },
      comment: { body, user: { type }, author_association: association },
    } },
    startsWith: (value: string, prefix: string) => value.startsWith(prefix),
    contains: (values: string[], value: string) => values.includes(value),
    fromJSON: JSON.parse,
  }))
  expect(eligible('/agent explain this issue')).toBe(true)
  expect(eligible('/agent explain this issue', 'Bot')).toBe(false)
  expect(eligible('/agent explain this issue', 'User', true)).toBe(false)
  expect(eligible('/review')).toBe(false)
  expect(eligible('Please implement this')).toBe(false)
  expect(eligible('/agent explain this issue', 'User', false, 'CONTRIBUTOR')).toBe(false)
  expect(workflow.jobs.prepare.steps.some(step => step.run === 'node .github/issue-agent/run.mjs prepare')).toBe(true)
})

it('queues Issue requests without canceling running or earlier pending conversations', () => {
  expect(workflow.concurrency).toMatchObject({
    'cancel-in-progress': false,
    queue: 'max',
  })
  const expression = workflow.concurrency.group.slice('issue-agent-${{'.length, -2)
  const group = (body: string, association = 'OWNER') => String(runInNewContext(expression, {
    github: { run_id: 99, event: { issue: { number: 7 }, comment: { body, user: { type: 'User' }, author_association: association } } },
    startsWith: (value: string, prefix: string) => value.startsWith(prefix),
    contains: (values: string[], value: string) => values.includes(value),
    fromJSON: JSON.parse,
    format: (template: string, value: number) => template.replace('{0}', String(value)),
  }))
  expect(group('/agent analyze this')).toBe('issue-7')
  expect(group('ordinary comment')).toBe('ignored-99')
  expect(group('/agent analyze this', 'NONE')).toBe('ignored-99')
})

it('isolates the model key from publication and repository write permissions', () => {
  expect(workflow.permissions).toEqual({})
  expect(workflow.jobs.agent.permissions).toEqual({ contents: 'read' })
  expect(workflow.jobs.prepare.permissions.contents).toBe('read')
  expect(workflow.jobs.failure.permissions).toEqual({ contents: 'read', issues: 'write' })
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
    'permission-profile': ':workspace',
    model: "${{ vars.ISSUE_AGENT_MODEL || 'gpt-5.4-mini' }}",
    'codex-version': '0.166.0',
  })
  expect(action?.with?.['codex-home']).toBeUndefined()
})

it('pins trusted tooling, protects Git metadata, and treats generated files only as data', () => {
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/u)
      if (step.uses?.startsWith('actions/checkout@')) expect(step.with?.['persist-credentials']).toBe(false)
      if (step.run) expect(step.run).not.toContain('${{ github.event.')
    }
  }
  const setup = workflow.jobs.agent.steps.find(step => step.name === 'Prepare isolated agent account')?.run
  expect(setup).toContain('chmod 1770 "$GITHUB_WORKSPACE/work"')
  expect(setup).toContain('chown -hR runner:runner "$GITHUB_WORKSPACE/work/.git"')
  const stop = workflow.jobs.agent.steps.findIndex(step => step.name === 'Stop remaining agent processes')
  const collect = workflow.jobs.agent.steps.findIndex(step => step.name === 'Collect validated response and file changes')
  expect(stop).toBeGreaterThan(-1)
  expect(collect).toBeGreaterThan(stop)
  const publisher = workflow.jobs.publish.steps.filter(step => step.run)
  expect(publisher).toHaveLength(1)
  expect(publisher[0]?.run).toBe('node trusted/.github/issue-agent/run.mjs publish')
  expect(workflow.jobs.agent.steps.some(step => step.run?.includes('pnpm install'))).toBe(false)
})
