/** Prepared artifacts can only publish for their original webhook target. */
import { expect, it } from 'vitest'
import { matchesEventRequest } from '../.github/issue-agent/run.mjs'

const repository = 'owner/repo'
const comment = { repository, issueNumber: 7, commentId: 12, trigger: 'comment', targetType: 'issue' }
const issueEvent = { action: 'created', issue: { number: 7 }, comment: { id: 12 } }
const pullEvent = { ...issueEvent, issue: { number: 7, pull_request: {} } }
const review = { repository, issueNumber: 7, commentId: null, trigger: 'review', targetType: 'pull_request', capability: 'reply_only', workSha: 'head', baseSha: 'base' }
const reviewEvent = { action: 'opened', pull_request: { number: 7, head: { sha: 'head' }, base: { sha: 'base' } } }

it('matches Issue and PR comments only to their exact target and delivery', () => {
  expect(matchesEventRequest(comment, issueEvent, repository, 'issue_comment')).toBe(true)
  expect(matchesEventRequest({ ...comment, targetType: 'pull_request' }, pullEvent, repository, 'issue_comment')).toBe(true)
  for (const overrides of [{ repository: 'other/repo' }, { issueNumber: 8 }, { commentId: 13 }, { targetType: 'pull_request' }, { trigger: 'review' }]) {
    expect(matchesEventRequest({ ...comment, ...overrides }, issueEvent, repository, 'issue_comment')).toBe(false)
  }
  expect(matchesEventRequest(comment, { ...issueEvent, action: 'edited' }, repository, 'issue_comment')).toBe(false)
  expect(matchesEventRequest(comment, issueEvent, repository, 'pull_request_target')).toBe(false)
})

it('matches automatic review snapshots without assuming a comment exists', () => {
  for (const action of ['opened', 'reopened', 'ready_for_review']) {
    expect(matchesEventRequest(review, { ...reviewEvent, action }, repository, 'pull_request_target')).toBe(true)
  }
  for (const overrides of [{ workSha: 'stale' }, { baseSha: 'stale' }, { capability: 'pr_update' }, { targetType: 'issue' }, { commentId: 12 }]) {
    expect(matchesEventRequest({ ...review, ...overrides }, reviewEvent, repository, 'pull_request_target')).toBe(false)
  }
  expect(matchesEventRequest(review, reviewEvent, repository, 'issue_comment')).toBe(false)
  expect(matchesEventRequest(review, { ...reviewEvent, action: 'synchronize' }, repository, 'pull_request_target')).toBe(false)
})
