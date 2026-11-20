import { describe, expect, it } from 'vitest'
import { resolveInsightPackaging } from '../scripts/insight-packaging.mjs'

const environment = {
  DSH_DESKTOP_PRODUCT: 'insight',
  DSH_DESKTOP_APP_ID: 'com.insight-aigc.desktop',
  INSIGHT_DESKTOP_VERSION: '1.0.10-rc.1',
}

describe('Insight packaging settings', () => {
  it.each([
    ['1.0.14-rc.4', undefined, true, 'insight'],
    ['1.0.14-rc.0', undefined, true, 'insight'],
    ['1.0.14-rc.9007199254740992', undefined, true, 'insight'],
    ['1.0.14', undefined, false, 'insight'],
    ['1.0.14-beta.1', undefined, false, 'insight'],
    ['1.0.14-rc.candidate', undefined, false, 'insight'],
    ['v1.0.14-rc.4', undefined, false, 'insight'],
    ['1.0.14', '1', true, 'insight-internal-rc'],
  ] as const)('selects developer controls for %s with explicit mode %s', (version, internal, developerControls, artifactPrefix) => {
    expect(resolveInsightPackaging({ ...environment, INSIGHT_DESKTOP_VERSION: version, DSH_INSIGHT_RC_BUILD: internal }, 'win32', 'x64'))
      .toMatchObject({ developerControls, artifactPrefix })
  })

  it('maps prereleases to the immutable nightly macOS target', () => {
    expect(resolveInsightPackaging(environment, 'darwin', 'arm64', { requireAppId: true, requireNativeTarget: true }))
      .toMatchObject({
        appId: 'com.insight-aigc.desktop', productName: '因赛AI', artifactPrefix: 'insight',
        productVersion: '1.0.10-rc.1', target: 'darwin-arm64',
        update: {
          channel: 'nightly',
          publicUrl: 'https://updates.insight-aigc.com/desktop/native/releases/v1.0.10-rc.1/targets/darwin-arm64/',
        },
      })
  })

  it('maps stable versions to latest metadata', () => {
    expect(resolveInsightPackaging({ ...environment, INSIGHT_DESKTOP_VERSION: '1.0.10' }, 'darwin', 'x64', {
      requireAppId: true, requireNativeTarget: true,
    })?.update).toEqual({
      channel: 'latest',
      publicUrl: 'https://updates.insight-aigc.com/desktop/releases/v1.0.10/targets/darwin-x64/',
    })
  })

  it('rejects a split application identity and resolves the Windows distribution target', () => {
    expect(() => resolveInsightPackaging({ ...environment, DSH_DESKTOP_APP_ID: 'com.example.other' }, 'darwin', 'arm64', {
      requireAppId: true,
    })).toThrow(/DSH_DESKTOP_APP_ID/u)
    expect(resolveInsightPackaging(environment, 'win32', 'x64', { requireNativeTarget: true }))
      .toMatchObject({
        target: 'win32-x64',
        update: {
          channel: 'nightly',
          publicUrl: 'https://updates.insight-aigc.com/desktop/native/releases/v1.0.10-rc.1/targets/win32-x64/',
        },
      })
  })
})
