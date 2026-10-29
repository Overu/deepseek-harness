/**
 * Reject a browser request that does not belong to the authenticated DSH
 * connection before a Memory Evolve route reads or changes local state.
 *
 * A route without the connection service is unsafe: reject it instead of
 * exposing local state to an unauthenticated browser.
 */
export function authorizeMemoryRequest(ctx, req, res) {
  const connection = ctx.get('connection')
  const rejection = connection === undefined ? 401 : connection.requestRejection(req)
  if (rejection === undefined) return true
  res.writeHead(rejection)
  res.end()
  return false
}
