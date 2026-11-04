import type { GitHubApi } from './github.mjs'

/** A verified command and its Issue text. */
export interface AuthorizedRequest {
  targetType: 'issue' | 'pull_request'
  trigger: 'comment' | 'review'
  issueNumber: number
  commentId: number | null
  commentUpdatedAt: string | null
  actor: string
  request: string
}

/** Snapshot used by generation and compare-and-swap publication. */
export interface IssueRequest extends AuthorizedRequest {
  capability: 'issue_change'
  issueTitle: string
  issueBody: string
  repository: string
  defaultBranch: string
  defaultSha: string
  workSha: string
  branch: string
  existingPrNumber: number | null
  existingPrBody: string | null
  runUrl: string
  context: Array<{ id: number; author: string; createdAt: string; body: string }>
  availableLabels: Array<{ name: string; description: string }>
}

/** Pull-request snapshot with complete read-only review material. */
export interface PullRequestRequest extends Omit<IssueRequest, 'context' | 'availableLabels' | 'capability'> {
  targetType: 'pull_request'
  trigger: 'comment' | 'review'
  capability: 'reply_only' | 'pr_update'
  headRepository: string
  baseSha: string
  baseBranch: string
  requestKey: string
  context: { comments: unknown[]; reviews: unknown[]; inlineComments: unknown[]; files: unknown[]; commits: unknown[] }
  availableLabels: []
}

/**
 * Verify the event, comment freshness, actor permission, and Issue identity.
 * @param input Event and scoped GitHub transport.
 * @returns Authorized command, or null for an ineligible event.
 */
export function authorizeEvent(input: { event: unknown; repository: string; api: GitHubApi }): Promise<AuthorizedRequest | null>

/** Parse the exact static Pull Request review command. */
export function parseReview(body: string): string | undefined

/**
 * Read complete discussion and select an owned draft or a new branch.
 * @param input Event, scoped GitHub transport, and run URL.
 * @returns Verified snapshot, or null for an ineligible or completed command.
 */
export function prepareRequest(input: {
  event: unknown
  repository: string
  api: GitHubApi
  runUrl: string
}): Promise<IssueRequest | PullRequestRequest | null>

/**
 * Separate current instructions from quoted Issue context.
 * @param request Verified request snapshot.
 * @param policy Trusted agent instructions.
 * @returns Complete model input.
 */
export function renderPrompt(request: Record<string, unknown>, policy: string): string
