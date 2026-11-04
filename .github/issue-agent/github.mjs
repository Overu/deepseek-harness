/** Scoped GitHub JSON transport for Issue Agent orchestration. */

/**
 * Create a transport whose credential stays in the calling job.
 * @param {object} options Token, trusted API URL, and optional test fetch implementation.
 * @returns {Function} JSON request function; allow404 returns null for absent records.
 */
export function createApi({ token, baseUrl = 'https://api.github.com', fetchImpl = fetch }) {
  if (!token) throw new Error('GitHub job token is missing')
  return async (path, { method = 'GET', body, allow404 = false } = {}) => {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('GitHub API path must be repository-relative')
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    })
    if (allow404 && response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}; check Actions permissions and the run log`)
    return response.status === 204 ? null : response.json()
  }
}
