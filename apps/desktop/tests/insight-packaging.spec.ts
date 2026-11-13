import { describe, expect, it } from 'vitest'
import { resolveInsightPackaging } from '../scripts/insight-packaging.mjs'

const environment = {
  DSH_DESKTOP_PRODUCT: 'insight',
  DSH_DESKTOP_APP_ID: 'com.insight-aigc.desktop',
  INSIGHT_DESKTOP_VERSION: '1.0.10-rc.1',
}

describe('Insight packaging settings', () => {
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
