import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAuthEnvironment } from '@insight-ai/desktop-integration/desktop'
import { desktopServiceProfile } from '../src/host/service-environment.ts'
import { desktopGatewayProfile } from '../src/host/canvas-api.ts'

test('Canvas uses the login gateway and pairs its own destinations with the desktop environment', () => {
  const previous = process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT
  try {
    for (const [environment, api, web, modelHost] of [
      ['test', 'https://gapi-test.insight-aigc.com', 'https://dynsight-test.insight-aigc.com', 'game-ai-admin-test-cdn.idealead.com'],
      ['production', 'https://gapi-dsh.idealead.com', 'https://dynsight.insight-aigc.com', 'game-ai-admin-prod-cdn.idealead.com'],
    ]) {
      if (environment === undefined) delete process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT
      else process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT = environment
      const profile = desktopServiceProfile()
      assert.equal(profile.api, resolveAuthEnvironment({ packaged: environment === 'production' }).baseUrl)
      assert.equal(profile.api, api); assert.equal(profile.web, web)
      assert.equal(new URL(profile.modelParams).hostname, modelHost)
      assert.deepEqual(desktopGatewayProfile(), { api, web })
    }
    delete process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT
    assert.throws(() => desktopServiceProfile(), /invalid desktop/)
    process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT = 'unexpected'
    assert.throws(() => desktopServiceProfile(), /invalid desktop/)
    assert.throws(() => desktopGatewayProfile(), { code: 'CONFIGURATION_ERROR', requestPhase: 'not_sent' })
  } finally {
    if (previous === undefined) delete process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT
    else process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT = previous
  }
})
