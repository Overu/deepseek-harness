import { describe, expect, it, onTestFinished } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { getFileMatchers, type FileMatcher } from 'app-builder-lib/out/fileMatcher.js'

// The installed builder exports this internal operation without a TypeScript declaration.
const builderFiles = createRequire(import.meta.url)('app-builder-lib/out/fileMatcher.js') as {
  copyFiles(matchers: FileMatcher[] | null): Promise<void>
}

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
    expect(config.extraResources).toContainEqual({
      from: fileURLToPath(new URL('../../../bundled-skills/', import.meta.url)), to: 'bundled-skills',
    })
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
    expect(config.extraResources.some(resource => resource.to === 'bundled-skills')).toBe(false)
  })

  it.each(['darwin', 'win32'] as const)('copies the synchronized directory structure through builder extraResources on %s', async (platform) => {
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    const arch = platform === 'win32' ? 'x64' : 'arm64'
    const config = createElectronBuilderConfig({ ...insightEnvironment,
      DSH_DESKTOP_TARGET_PLATFORM: platform, DSH_DESKTOP_TARGET_ARCH: arch,
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production', DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN: 'https://policy.fixture.invalid',
    }, platform, arch)
    const rule = config.extraResources.find(resource => resource.to === 'bundled-skills')
    if (rule === undefined) throw new Error('Insight bundled resource declaration missing')
    const root = await mkdtemp(join(tmpdir(), 'insight-bundled-resources-'))
    onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
    const source = join(root, 'source'), destination = join(root, 'resources')
    const fixtures = {
      'example/SKILL.md': 'Synthetic resource bytes; not an instruction validation fixture.',
      'example/ui.json': '{"displayName":"Fixture"}',
      'example/scripts/nested/helper.mjs': 'export const fixture = true\n',
      'example/.fixture': 'hidden resource bytes',
    }
    for (const [name, bytes] of Object.entries(fixtures)) {
      const target = join(source, ...name.split('/'))
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, bytes)
    }
    const matchers = getFileMatchers({ extraResources: [{ ...rule, from: source }] }, 'extraResources', destination, {
      macroExpander: value => value, customBuildOptions: {}, globalOutDir: join(root, 'out'), defaultSrc: root,
    })
    await builderFiles.copyFiles(matchers)
    for (const [name, bytes] of Object.entries(fixtures)) {
      expect(await readFile(join(destination, 'bundled-skills', ...name.split('/')), 'utf8')).toBe(bytes)
    }
  })

  it.each(['', '0.2.2', '2.0.0', '1.3.0+local'])('requires an explicit 1.x product version: %j', async (version) => {
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    expect(() => createElectronBuilderConfig({ ...insightEnvironment, INSIGHT_DESKTOP_VERSION: version }, 'darwin', 'arm64'))
      .toThrow(/INSIGHT_DESKTOP_VERSION/u)
  })

  it('uses the immutable Insight RC feed for a signed macOS package', async () => {
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    const config = createElectronBuilderConfig({ ...insightEnvironment,
      DSH_DESKTOP_UNSIGNED: '0', DSH_DESKTOP_APP_ID: 'com.insight-aigc.desktop',
      DSH_DESKTOP_MACOS_SIGNING_IDENTITY: 'Insight (8P39WV82RX)', DSH_DESKTOP_MACOS_TEAM_ID: '8P39WV82RX',
      APPLE_API_KEY: 'notarization.p8', APPLE_API_KEY_ID: 'fixturekey', APPLE_API_ISSUER: 'fixture-issuer',
      CSC_LINK: 'signing.p12', CSC_KEY_PASSWORD: 'fixture-password',
    }, 'darwin', 'arm64')

    expect(config.publish).toEqual([{
      provider: 'generic', channel: 'nightly',
      url: 'https://updates.insight-aigc.com/desktop/native/releases/v1.3.0-beta.2/targets/darwin-arm64/',
    }])
    expect(config.extraResources).toContainEqual(expect.objectContaining({ to: 'insight-update' }))
  })

  it('uses latest metadata for stable Insight releases and emits unsigned Windows distribution metadata without Authenticode', async () => {
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    const signed = { ...insightEnvironment, DSH_DESKTOP_UNSIGNED: '0', DSH_DESKTOP_APP_ID: 'com.insight-aigc.desktop',
      DSH_DESKTOP_MACOS_SIGNING_IDENTITY: 'Insight (8P39WV82RX)', DSH_DESKTOP_MACOS_TEAM_ID: '8P39WV82RX',
      APPLE_API_KEY: 'notarization.p8', APPLE_API_KEY_ID: 'fixturekey', APPLE_API_ISSUER: 'fixture-issuer',
      CSC_LINK: 'signing.p12', CSC_KEY_PASSWORD: 'fixture-password' }
    expect(createElectronBuilderConfig({ ...signed, INSIGHT_DESKTOP_VERSION: '1.3.0' }, 'darwin', 'arm64').publish)
      .toEqual([expect.objectContaining({ channel: 'latest' })])
    const windows = createElectronBuilderConfig({ ...signed,
      DSH_DESKTOP_TARGET_PLATFORM: 'win32', DSH_DESKTOP_TARGET_ARCH: 'x64',
    }, 'win32', 'x64')
    expect(windows.publish).toEqual([expect.objectContaining({
      channel: 'nightly', url: 'https://updates.insight-aigc.com/desktop/native/releases/v1.3.0-beta.2/targets/win32-x64/',
    })])
    expect(windows.win).toMatchObject({ forceCodeSigning: false, verifyUpdateCodeSignature: false })
    expect(windows.win.signtoolOptions.sign).toBeUndefined()
  })

  it('rejects an Insight dotenv application identifier that would split runtime and signing identity', async () => {
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    expect(() => createElectronBuilderConfig({ ...insightEnvironment, DSH_DESKTOP_APP_ID: 'com.example.other' }, 'darwin', 'arm64'))
      .toThrow(/DSH_DESKTOP_APP_ID/u)
  })
})
