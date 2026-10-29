import { describe, expect, it } from 'vitest'

const insightEnvironment = {
  DSH_DESKTOP_PRODUCT: 'insight',
  INSIGHT_DESKTOP_VERSION: '1.3.0-beta.2',
  DSH_DESKTOP_TARGET_PLATFORM: 'darwin',
  DSH_DESKTOP_TARGET_ARCH: 'arm64',
  DSH_DESKTOP_UNSIGNED: '1',
}

describe('Insight electron-builder product', () => {
  it('brands an unsigned local package without inheriting an upstream update feed', async () => {
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    const config = createElectronBuilderConfig(insightEnvironment, 'darwin', 'arm64')

    expect(config).toMatchObject({
      appId: 'com.insight-aigc.desktop',
      productName: '因赛AI',
      protocols: [{ name: '因赛AI', schemes: ['dsh'] }],
      artifactName: 'insight-${version}-${os}-${arch}-unsigned.${ext}',
      extraMetadata: {
        version: '1.3.0-beta.2',
        dshDesktopProduct: 'insight',
        dshDesktopProductVersion: '1.3.0-beta.2',
      },
      publish: null,
    })
    expect(config.extraMetadata.dshDesktopRuntimeVersion).toMatch(/^0\.2\./u)
    expect(config.extraResources).toContainEqual(expect.objectContaining({ to: 'branding' }))
    expect(config.files).toEqual(expect.arrayContaining(['lib/preload-insight-login.cjs', 'lib/insight-login/**/*', 'renderer/**/*']))
    expect(config.mac.icon).toMatch(/packages[\\/]insight[\\/]desktop-integration[\\/]resources[\\/]branding[\\/]icon\.icns$/u)
    expect(config.win.icon).toMatch(/packages[\\/]insight[\\/]desktop-integration[\\/]resources[\\/]branding[\\/]icon\.ico$/u)
    expect(config.mac.extendInfo.NSMicrophoneUsageDescription).toBe('因赛AI 使用您的麦克风将语音转录为消息草稿。')
  })

  it('keeps Insight login files out of the official product package', async () => {
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    const config = createElectronBuilderConfig({ DSH_DESKTOP_APP_ID: 'com.deepseek.dsh', DSH_DESKTOP_UNSIGNED: '1' }, 'darwin', 'arm64')

    expect(config.files).not.toEqual(expect.arrayContaining(['lib/preload-insight-login.cjs', 'lib/insight-login/**/*']))
    expect(config.protocols).toEqual([{ name: 'DeepSeek Harness', schemes: ['dsh'] }])
    expect(config.mac.extendInfo.NSMicrophoneUsageDescription)
      .toBe('DeepSeek Harness uses your microphone to transcribe speech into message drafts.')
  })

  it.each(['', '0.2.2', '2.0.0', '1.3.0+local'])('requires an explicit 1.x product version: %j', async (version) => {
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    expect(() => createElectronBuilderConfig({ ...insightEnvironment, INSIGHT_DESKTOP_VERSION: version }, 'darwin', 'arm64'))
      .toThrow(/INSIGHT_DESKTOP_VERSION/u)
  })

  it('rejects a signed Insight package until its own update release flow exists', async () => {
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    expect(() => createElectronBuilderConfig({ ...insightEnvironment, DSH_DESKTOP_UNSIGNED: '0' }, 'darwin', 'arm64'))
      .toThrow(/unsigned local artifacts/u)
  })
})
