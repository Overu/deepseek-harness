/** Web replay account seam. Canvas history rendering never requests this token. */
export function apply(ctx) {
  ctx.provide('insightAccount', {
    getAccessToken: async () => 'fixture-canvas-history-token',
  })
}
