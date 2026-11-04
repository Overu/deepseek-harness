import type { AuthorizedRequest } from './context.mjs'
import type { GitHubApi } from './github.mjs'

/** Failure that retains publication progress for operator inspection. */
export class PublishError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: ErrorOptions)
}

/**
 * Recheck live permission and comment freshness before publication.
 * @param request Prepared snapshot.
 * @param api Scoped GitHub transport.
 * @returns Resolves after authorization succeeds.
 */
export function authorizeRequest(
  request: Pick<AuthorizedRequest, 'targetType' | 'trigger' | 'issueNumber' | 'commentId' | 'actor' | 'request' | 'commentUpdatedAt'> & { repository: string, capability: 'reply_only' | 'issue_change' | 'pr_update' },
  api: GitHubApi,
): Promise<void>

/**
 * Publish a reply or an owned draft PR using exact remote-head checks.
 * @param options Verified snapshot, untrusted result, and job-scoped publisher dependencies.
 * @returns Publication result.
 */
export function publishResult(options: {
  request: Record<string, unknown>
  outcome: { result: unknown; changes: unknown }
  api: GitHubApi
  workdir: string
  token: string
  git?: (args: string[], options: { env: Record<string, string> }) => unknown
}): Promise<{ status: 'published' | 'duplicate'; pullRequest?: string }>
