/** PR-Agent credentials and review-only execution remain isolated from pull-request code. */
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { load } from 'js-yaml'
import { parse } from 'smol-toml'
import { describe, expect, it } from 'vitest'

const workflow = load(readFileSync(new URL('../.github/workflows/pr-agent.yml', import.meta.url), 'utf8')) as {
  on: Record<string, { types: string[] }>
  permissions: Record<string, string>
  jobs: { review: {
    if: string
    steps: Array<{ uses?: string; run?: string; env?: Record<string, string> }>
  } }
}
const settings = parse(readFileSync(new URL('../.pr_agent.toml', import.meta.url), 'utf8'))

function eligible(eventName: string, event: object): boolean {
  return Boolean(runInNewContext(workflow.jobs.review.if, {
    github: { event_name: eventName, event },
    contains: (values: string[], value: string) => values.includes(value),
    fromJSON: JSON.parse,
  }))
}

describe('PR-Agent review execution', () => {
  it('reviews published PRs without spending API calls on drafts or every push', () => {
    expect(workflow.on).toEqual({
      pull_request_target: { types: ['opened', 'reopened', 'ready_for_review'] },
      issue_comment: { types: ['created'] },
    })
    expect(eligible('pull_request_target', { pull_request: { draft: false } })).toBe(true)
    expect(eligible('pull_request_target', { pull_request: { draft: true } })).toBe(false)
  })

  it('accepts only a trusted exact /review comment on a pull request', () => {
    const event = (body: string, association: string, pullRequest = true) => ({
      issue: { pull_request: pullRequest ? {} : undefined },
      comment: { body, author_association: association },
    })
    for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
      expect(eligible('issue_comment', event('/review', association))).toBe(true)
    }
    for (const association of ['NONE', 'CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR']) {
      expect(eligible('issue_comment', event('/review', association))).toBe(false)
    }
    for (const body of ['/describe', '/improve', '/review --config.model=other', '/review\n/improve']) {
      expect(eligible('issue_comment', event(body, 'OWNER'))).toBe(false)
    }
    expect(eligible('issue_comment', event('/review', 'OWNER', false))).toBe(false)
  })

  it('pins the runtime and exposes credentials only to fixed steps without executing PR code', () => {
    expect(workflow.permissions).toEqual({ contents: 'read', issues: 'write', 'pull-requests': 'write' })
    const steps = workflow.jobs.review.steps
    expect(steps).toHaveLength(2)
    expect(steps[0]?.run).toContain('if [ -z "$OPENAI_KEY" ]')
    expect(steps[0]?.run).not.toContain('${{')
    expect(steps[1]?.uses).toMatch(/^docker:\/\/pragent\/pr-agent@sha256:[a-f0-9]{64}$/u)
    expect(steps[1]?.run).toBeUndefined()
    expect(steps[1]?.env).toMatchObject({
      OPENAI_KEY: '${{ secrets.OPENAI_KEY }}',
      GITHUB_TOKEN: '${{ github.token }}',
      CONFIG__MODEL: "${{ vars.PR_AGENT_MODEL || 'gpt-5.4-mini' }}",
      CONFIG__FALLBACK_MODELS: '[]',
      CONFIG__ENABLE_AUTO_APPROVAL: 'false',
      CONFIG__RESTRICTED_MODE: 'true',
      GITHUB_ACTION_CONFIG__AUTO_REVIEW: 'true',
      GITHUB_ACTION_CONFIG__AUTO_DESCRIBE: 'false',
      GITHUB_ACTION_CONFIG__AUTO_IMPROVE: 'false',
    })
  })

  it('keeps review feedback separate from repository labels and PR descriptions', () => {
    expect(settings.pr_reviewer).toMatchObject({
      enable_review_labels_security: false,
      enable_review_labels_effort: false,
      persistent_comment: true,
    })
  })
})
