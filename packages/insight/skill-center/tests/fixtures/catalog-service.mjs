/** External account and catalogue fixtures for the real skill-center Host route. */
export function apply(ctx) {
  const previousEnvironment = process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT
  const transport = globalThis.fetch
  const skill = {
    id: 1, skillId: 'influencer-integration', name: 'Account catalog skill', enabled: 1, sort: 1,
    summary: 'Read through the skill-center Host route.', packageVersion: '1.2.0',
    packageUrl: 'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/identity-fixture.zip',
    description_markdown: 'Account-authenticated catalogue fixture.',
  }
  ctx.effect(() => {
    process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT = 'test'
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const base = 'https://gapi-test.insight-aigc.com/game-ai-editor-center/api/skills'
      if (!url.startsWith(`${base}?`)) return transport(input, init)
      if (new Headers(init?.headers).get('token') !== 'catalog-fixture-token') throw new Error('Missing Host account credential')
      return Response.json({ code: 'SUCCESS', data: { records: [skill], total: 1, emptyFallback: [] } })
    }
    return () => {
      globalThis.fetch = transport
      if (previousEnvironment === undefined) delete process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT
      else process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT = previousEnvironment
    }
  })
  ctx.provide('insightAccount', { getAccessToken: async () => 'catalog-fixture-token' })
}
