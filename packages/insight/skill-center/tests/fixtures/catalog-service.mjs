/** External account and catalogue fixtures for the real skill-center Host route. */
import { CATEGORY_FIXTURE } from './catalog.ts'

export function apply(ctx) {
  const previousEnvironment = process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT
  const transport = globalThis.fetch
  const skill = {
    id: 1, skillId: 'influencer-integration', name: 'Account catalog skill', enabled: 1, sort: 1,
    summary: 'Read through the skill-center Host route.', packageVersion: '1.2.0',
    packageUrl: 'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/identity-fixture.zip',
    skill_desc: 'Account-authenticated catalogue fixture.',
    source: 'OFFICIAL', sceneCodes: ['INFLUENCER'],
  }
  ctx.effect(() => {
    process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT = 'test'
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const parsed = new URL(url)
      const base = '/game-ai-editor-center/api/'
      if (parsed.origin !== 'https://gapi-test.insight-aigc.com'
        || ![`${base}skills`, `${base}skill-categories`].includes(parsed.pathname)) return transport(input, init)
      if (new Headers(init?.headers).get('token') !== 'catalog-fixture-token') throw new Error('Missing Host account credential')
      if (parsed.pathname === `${base}skill-categories`) {
        if (parsed.search !== '?businessChannels=A') throw new Error('Expected only A-line category configuration')
        return Response.json({ code: 'SUCCESS', data: { records: CATEGORY_FIXTURE } })
      }
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
