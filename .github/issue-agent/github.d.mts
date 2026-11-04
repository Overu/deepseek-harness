/** GitHub JSON requests made by trusted orchestration. */
export type GitHubApi = (path: string, options?: {
  method?: string
  body?: unknown
  allow404?: boolean
}) => Promise<unknown>

/**
 * Bind one job's token to the GitHub JSON transport.
 * @param options Trusted API configuration and optional test transport.
 * @returns Credential-scoped request function.
 */
export function createApi(options: { token: string; baseUrl?: string; fetchImpl?: typeof fetch }): GitHubApi
