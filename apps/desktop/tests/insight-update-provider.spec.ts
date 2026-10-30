/** The updater consumes the exact authenticated metadata and retains OS restrictions. */
import { describe, expect, it, vi } from 'vitest'
import type { ResolvedInsightUpdate } from '@insight-ai/desktop-integration/desktop'
import type { UpdateInfo } from 'electron-updater'
import type { DesktopUpdateFeed } from '../src/update-coordinator.ts'

vi.mock('electron-updater', () => ({
  default: { Provider: class { constructor(readonly runtime: object) {} } },
}))
const { insightUpdateFeed } = await import('../src/insight-update-provider.ts')

interface InsightProviderUnderTest {
  getLatestVersion(): Promise<UpdateInfo>
  resolveFiles(info: UpdateInfo): { readonly url: URL }[]
}

type InsightProviderConstructor = new (options: object, updater: object, runtime: object) => InsightProviderUnderTest

function providerFor(feed: DesktopUpdateFeed): InsightProviderUnderTest {
  const updateProvider = feed.options.updateProvider
  if (typeof updateProvider !== 'function') throw new Error('Missing custom provider')
  return new (updateProvider as InsightProviderConstructor)(feed.options, {}, {})
}

function fixture(): ResolvedInsightUpdate {
  const asset = { platform: 'darwin' as const, arch: 'arm64' as const, kind: 'zip' as const,
    name: 'insight-1.0.10-rc.1-mac-arm64.zip', size: 42, sha512: 'verified-payload-hash' }
  return { version: '1.0.10-rc.1', sourceCommit: 'a'.repeat(40), track: 'candidate',
    policy: { mode: 'optional', minimumSupportedVersion: '1.0.9' }, releaseBaseUrl: new URL('https://updates.example.test/desktop/native/releases/v1.0.10-rc.1/targets/darwin-arm64/'),
    metadataAsset: { ...asset, kind: 'updater-metadata', name: 'metadata.yml' }, installerAsset: { ...asset, kind: 'dmg', name: 'installer.dmg' },
    payloadAsset: asset, metadata: { version: '1.0.10-rc.1', files: [{ url: asset.name, size: 42, sha512: asset.sha512 }],
      path: asset.name, sha512: asset.sha512, minimumSystemVersion: '25.0.0' }, identityFingerprint: 'key-fingerprint',
  }
}

describe('Insight custom update provider', () => {
  it('passes authenticated system requirements and resolves only the retained check object without refetching', async () => {
    const release = fixture()
    const resolve = vi.fn(async () => release)
    const feed = insightUpdateFeed('candidate', resolve)
    const provider = providerFor(feed)
    const info = await provider.getLatestVersion()
    expect(info.minimumSystemVersion).toBe('25.0.0')
    expect(info.files).toEqual(release.metadata.files)
    expect(Object.isFrozen(info)).toBe(true)
    const [file] = provider.resolveFiles(info)
    if (file === undefined) throw new Error('Missing verified download file')
    expect(file.url.href).toBe(new URL(release.payloadAsset.name, release.releaseBaseUrl).href)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(() => provider.resolveFiles({ ...info })).toThrow('verified check result')
  })

  it('does not produce an updater target when signature discovery fails', async () => {
    const feed = insightUpdateFeed('stable', async () => { throw new Error('bad signature') })
    const provider = providerFor(feed)
    await expect(provider.getLatestVersion()).rejects.toThrow('bad signature')
  })
})
