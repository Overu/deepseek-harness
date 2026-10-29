import assert from 'node:assert/strict'
import test from 'node:test'
import { desktopServiceProfile } from '../src/host/service-environment.ts'
import { desktopGatewayProfile } from '../src/host/canvas-api.ts'

test('API, Web origin and model CDN share one desktop-owned environment', () => {
  const previous = process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT
  try {
    for (const [environment, api, web, modelHost] of [
      [undefined, 'https://gapi-test.insight-aigc.com', 'https://dynsight-test.insight-aigc.com', 'game-ai-admin-test-cdn.idealead.com'],
      ['production', 'https://gapi.insight-aigc.com', 'https://dynsight.insight-aigc.com', 'game-ai-admin-prod-cdn.idealead.com'],
    ]) {
      if (environment === undefined) delete process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT
      else process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT = environment
      const profile = desktopServiceProfile()
      assert.equal(profile.api, api); assert.equal(profile.web, web)
      assert.equal(new URL(profile.modelParams).hostname, modelHost)
      assert.deepEqual(desktopGatewayProfile(), { api, web })
    }
    process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT = 'unexpected'
    assert.throws(() => desktopServiceProfile(), /invalid desktop/)
    assert.throws(() => desktopGatewayProfile(), { code: 'CONFIGURATION_ERROR', requestPhase: 'not_sent' })
  } finally {
    if (previous === undefined) delete process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT
    else process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT = previous
  }
})
