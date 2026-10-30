/** Adapt authenticated Insight metadata to electron-updater's public provider API. */
import electronUpdater, { type AppUpdater, type UpdateInfo, type ResolvedUpdateFileInfo } from 'electron-updater'
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider.js'
import type { ResolvedInsightUpdate } from '@insight-ai/desktop-integration/desktop'
import type { DesktopUpdateFeed } from './update-coordinator.ts'

const { Provider } = electronUpdater

/**
 * Bind one signed discovery operation to the updater instance retained for its later download.
 * @param track - Main-owned update channel.
 * @param resolve - Verifies the pointer, manifests and metadata before returning any file information.
 * @returns A trusted custom feed; no URL or provider configuration comes from a renderer.
 */
export function insightUpdateFeed(track: 'stable' | 'candidate', resolve: () => Promise<ResolvedInsightUpdate>): DesktopUpdateFeed {
  class InsightProvider extends Provider<UpdateInfo> {
    private accepted: { info: UpdateInfo; resolved: ResolvedInsightUpdate } | undefined

    constructor(_options: DesktopUpdateFeed['options'], _updater: AppUpdater, runtime: ProviderRuntimeOptions) {
      super({ ...runtime, isUseMultipleRangeRequest: false })
    }

    async getLatestVersion(): Promise<UpdateInfo> {
      const resolved = await resolve()
      const file = Object.freeze({
        url: resolved.payloadAsset.name,
        sha512: resolved.payloadAsset.sha512,
        size: resolved.payloadAsset.size,
      })
      const { releaseDate, releaseName, minimumSystemVersion, ...requiredMetadata } = resolved.metadata
      const info: UpdateInfo = {
        ...requiredMetadata, version: resolved.version, files: [file],
        releaseDate: releaseDate ?? '1970-01-01T00:00:00.000Z',
        ...(releaseName === undefined ? {} : { releaseName }),
        ...(minimumSystemVersion === undefined ? {} : { minimumSystemVersion }),
      }
      Object.freeze(info.files)
      Object.freeze(info)
      this.accepted = { info, resolved }
      return info
    }

    resolveFiles(info: UpdateInfo): ResolvedUpdateFileInfo[] {
      const accepted = this.accepted
      if (accepted === undefined || info !== accepted.info) throw new Error('Insight update: download metadata is not the verified check result')
      const file = accepted.info.files[0]
      if (file === undefined) throw new Error('Insight update: verified payload is missing')
      return [{ url: new URL(encodeURIComponent(accepted.resolved.payloadAsset.name), accepted.resolved.releaseBaseUrl), info: file }]
    }
  }
  return { id: `insight-${track}`, allowPrerelease: track === 'candidate', options: { provider: 'custom', updateProvider: InsightProvider } }
}
