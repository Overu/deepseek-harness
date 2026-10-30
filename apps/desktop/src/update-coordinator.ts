/** User-authorized downloads and separate installation of one version-bound Desktop release. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import electronUpdater, { type AppUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { gt, valid } from 'semver'
import type { DesktopUpdateState } from './ipc.ts'
import { DesktopUpdateHttpExecutor } from './update-http-executor.ts'
import { DesktopUpdatePreparationError } from './update-error.ts'

const { autoUpdater } = electronUpdater

/** One trusted custom updater source configured atomically with its check. */
export interface DesktopUpdateFeed {
  /** Stable same-process identity used to serialize checks from one source. */
  readonly id: string
  /** Public electron-updater custom-provider configuration. */
  readonly options: Extract<Parameters<AppUpdater['setFeedURL']>[0], { provider: 'custom' }>
  /** Whether this source may return a prerelease version. */
  readonly allowPrerelease: boolean
}

interface DesktopUpdateCandidate {
  readonly version: string
  readonly feedId?: string | undefined
  readonly assetIdentity: string
}

interface DesktopUpdateCheckOperation {
  readonly feedId?: string | undefined
  readonly promise: Promise<DesktopUpdateState>
}

/** Owns one updater target until its download and installation settle. */
export class DesktopUpdateCoordinator {
  private current: DesktopUpdateState = { phase: 'idle' }
  private candidate: DesktopUpdateCandidate | undefined
  private downloaded = false
  private disposed = false
  private checkOperation: DesktopUpdateCheckOperation | undefined
  private downloadOperation: Promise<DesktopUpdateState> | undefined
  private installOperation: Promise<DesktopUpdateState> | undefined

  private readonly onProgress = (progress: ProgressInfo): void => {
    if (this.downloadOperation === undefined || this.downloaded) return
    const percent = Math.min(100, Math.max(0, progress.percent))
    this.setState({ phase: percent >= 100 ? 'verifying' : 'downloading', ...this.target(), percent })
  }

  private readonly onDownloaded = (info: UpdateInfo): void => {
    const candidate = this.candidate
    if (this.downloadOperation === undefined || candidate === undefined ||
      info.version !== candidate.version || this.assetIdentity(info, candidate.feedId) !== candidate.assetIdentity) return
    this.downloaded = true
  }

  private readonly onError = (error: Error): void => {
    // Check/download promises own their failures. Installation can fail after quitAndInstall returns.
    if (this.current.phase === 'installing') {
      this.setState(this.failure(error, 'install'))
    }
  }

  /**
   * @param publish - Receives observable states for every Desktop window.
   * @param beforeRestart - Completes task authorization, admission locking, and owned-process shutdown.
   * @param updater - Process-owned Electron updater, replaceable at the network/platform test boundary.
   * @param enabled - Whether this process has a packaged update source.
   * @param currentVersion - Actual installed application version.
   * @param channel - Installed package channel; omitted test/local callers retain nightly.
   * @param downloadResult - Once per completed download attempt, including platform preparation failures.
   */
  constructor(
    private readonly publish: (state: DesktopUpdateState) => DesktopUpdateState,
    private readonly beforeRestart: () => Promise<boolean>,
    private readonly updater: AppUpdater = autoUpdater,
    private readonly enabled: () => boolean = () => app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml')),
    private readonly currentVersion: () => string = () => app.getVersion(),
    private readonly downloadResult?: (success: boolean, reason?: string) => void,
    private readonly channel: 'nightly' | 'latest' = 'nightly',
  ) {
    if (updater === autoUpdater) {
      // electron-updater omits this internal transport property from its public declarations.
      // Real-Electron qualification exercises the pinned dependency integration.
      const transportOwner = updater as AppUpdater & { httpExecutor: DesktopUpdateHttpExecutor }
      transportOwner.httpExecutor = new DesktopUpdateHttpExecutor(
        Number(process.env.DSH_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS ?? 60_000),
        (authInfo, callback) => { updater.emit('login', authInfo, callback) },
      )
    }
    this.updater.autoDownload = false
    this.updater.autoInstallOnAppQuit = false
    this.updater.channel = channel
    this.updater.allowPrerelease = channel === 'nightly'
    // Selecting a channel can enable downgrade in electron-updater.
    this.updater.allowDowngrade = false
    this.updater.on('download-progress', this.onProgress)
    this.updater.on('update-downloaded', this.onDownloaded)
    this.updater.on('error', this.onError)
  }

  /** Latest observable state; complete download identity remains main-process-owned. */
  get state(): DesktopUpdateState { return this.current }

  /**
   * Check metadata without downloading, joining any current check.
   * @param manual - Whether a failed check must remain visible in the status indicator.
   * @param feed - Trusted custom provider configured inside the serialized check; absence keeps the packaged source.
   * @returns The check result, including a silent automatic failure when applicable.
   */
  async check(manual = false, feed?: DesktopUpdateFeed): Promise<DesktopUpdateState> {
    this.assertLive()
    if (this.downloadOperation !== undefined || this.installOperation !== undefined || this.downloaded) return this.current
    // A custom provider remains bound to the selected asset until an explicit dismissal or download.
    if (this.candidate?.feedId !== undefined) return this.current
    if (!manual && this.current.phase === 'error' && this.current.failedOperation === 'download') return this.current
    const active = this.checkOperation
    if (active !== undefined) {
      if (active.feedId !== feed?.id && manual) {
        const queued: DesktopUpdateCheckOperation = {
          feedId: feed?.id,
          promise: active.promise.then(() => {
            // The explicit source wins over the automatic result without leaving a gap in which
            // download could consume the superseded provider retained by electron-updater.
            if (this.current.phase === 'available' && this.candidate?.feedId === active.feedId) {
              this.candidate = undefined
            }
            return this.doCheck(feed)
          }).finally(() => { if (this.checkOperation === queued) this.checkOperation = undefined }),
        }
        this.checkOperation = queued
        const result = await queued.promise
        if (result.phase === 'error') this.setState(result)
        return result
      }
      const result = await active.promise
      if (manual && result.phase === 'error') this.setState(result)
      return result
    }
    const operation: DesktopUpdateCheckOperation = {
      feedId: feed?.id,
      promise: Promise.resolve().then(() => this.doCheck(feed))
        .finally(() => { if (this.checkOperation === operation) this.checkOperation = undefined }),
    }
    this.checkOperation = operation
    const result = await operation.promise
    if (manual && result.phase === 'error') this.setState(result)
    return result
  }

  /**
   * Clear one unconsumed available target after an explicit product action such as skipping it.
   * @param expectedVersion - Version currently displayed to the user.
   * @returns The idle state published after the matching target is cleared.
   */
  dismissAvailable(expectedVersion: string): DesktopUpdateState {
    this.assertLive()
    if (this.checkOperation !== undefined) throw new Error('desktop update: cannot dismiss an update while checking')
    if (this.downloadOperation !== undefined || this.installOperation !== undefined || this.downloaded) {
      throw new Error('desktop update: cannot dismiss a download or prepared update')
    }
    if (this.current.phase !== 'available' || this.candidate?.version !== expectedVersion) {
      throw new Error('desktop update: available update does not match the dismissal')
    }
    this.candidate = undefined
    return this.setState({ phase: 'idle' })
  }

  /**
   * @param version - Version shown in the user's download confirmation.
   * @returns Download readiness or failure, without authorizing installation.
   */
  async download(version: string): Promise<DesktopUpdateState> {
    this.assertLive()
    if (this.downloaded || this.installOperation !== undefined) return this.current
    const approved = this.candidate
    const approvedAvailable = this.current.phase === 'available'
    this.downloadOperation ??= Promise.resolve().then(async () => {
      await this.checkOperation?.promise
      this.assertLive()
      if (this.candidate === undefined) throw new Error('desktop update: no checked update is available')
      if (version !== this.candidate.version) throw new Error('desktop update: download confirmation is stale')
      if (approvedAvailable && (approved === undefined || approved.feedId !== this.candidate.feedId ||
        approved.assetIdentity !== this.candidate.assetIdentity)) {
        throw new Error('desktop update: download confirmation is stale')
      }
      this.setState({ phase: 'downloading', version, percent: 0 })
      try {
        await this.updater.downloadUpdate()
        if (!this.downloaded) throw new Error('desktop update: platform preparation did not report readiness')
        this.downloadResult?.(true)
        return this.setState({ phase: 'ready', version })
      } catch (error) {
        this.downloaded = false
        this.downloadResult?.(false, error instanceof DesktopUpdatePreparationError ? error.kind : 'download_failed')
        return this.setState(this.failure(error, 'download'))
      }
    }).finally(() => { this.downloadOperation = undefined })
    return this.downloadOperation
  }

  /**
   * Install a prepared target after a separate user confirmation.
   * @param version - Exact version displayed in the confirmation, never a renderer-selected URL.
   * @returns Installation handoff or a recoverable preparation error.
   */
  async install(version: string): Promise<DesktopUpdateState> {
    this.assertLive()
    if (!this.downloaded || this.downloadOperation !== undefined || version !== this.candidate?.version) {
      throw new Error('desktop update: confirmed target is not ready')
    }
    this.installOperation ??= Promise.resolve().then(async () => {
      this.setState({ phase: 'installing', version })
      try {
        if (!await this.beforeRestart()) return this.setState({ phase: 'ready', version })
        this.assertLive()
        this.updater.quitAndInstall(true, true)
        return this.current
      } catch (error) {
        if (this.current.phase === 'error' && this.current.failedOperation === 'install') return this.current
        return this.setState(this.failure(error, 'install'))
      }
    }).finally(() => { this.installOperation = undefined })
    return this.installOperation
  }

  /** Remove owned listeners and prevent pending library operations from publishing into closed UI. */
  dispose(): void {
    this.disposed = true
    this.updater.off('download-progress', this.onProgress)
    this.updater.off('update-downloaded', this.onDownloaded)
    // Pending updater promises can still emit EventEmitter errors during shutdown.
    void Promise.allSettled([this.checkOperation?.promise, this.downloadOperation, this.installOperation])
      .then(() => { this.updater.off('error', this.onError) })
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('desktop update: coordinator is disposed')
  }

  private setState(state: DesktopUpdateState): DesktopUpdateState {
    if (!this.disposed) {
      this.current = state
      this.publish(state)
    }
    return state
  }

  private failure(error: unknown, failedOperation: 'check' | 'download' | 'install'): DesktopUpdateState {
    return { phase: 'error', ...this.target(), failedOperation,
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof DesktopUpdatePreparationError ? {
        preparationFailure: error.kind,
        ...(error.technicalDetails === undefined ? {} : { technicalDetails: error.technicalDetails }),
      } : {}) }
  }

  private target(): { version?: string } {
    return this.candidate === undefined ? {} : { version: this.candidate.version }
  }

  private async doCheck(feed?: DesktopUpdateFeed): Promise<DesktopUpdateState> {
    try {
      this.assertLive()
      if (!this.enabled()) throw new Error('desktop update: this application has no packaged update source')
      if (feed !== undefined) {
        this.updater.setFeedURL(feed.options)
        this.updater.allowPrerelease = feed.allowPrerelease
        // setFeedURL and channel selection must never authorize a downgrade.
        this.updater.allowDowngrade = false
      }
      const result = await this.updater.checkForUpdates()
      this.assertLive()
      if (result === null) throw new Error('desktop update: no check result was returned')
      const version = result.updateInfo.version
      if (valid(version) === null) throw new Error('desktop update: feed version is invalid')
      if ((feed === undefined ? this.channel === 'latest' : !feed.allowPrerelease) && version.includes('-')) {
        throw new Error('desktop update: stable feed contains a prerelease')
      }
      this.candidate = result.isUpdateAvailable && gt(version, this.currentVersion())
        ? { version, ...(feed === undefined ? {} : { feedId: feed.id }), assetIdentity: this.assetIdentity(result.updateInfo, feed?.id) }
        : undefined
      return this.setState(this.candidate === undefined ? { phase: 'idle' } : { phase: 'available', version })
    } catch (error) {
      return this.failure(error, 'check')
    }
  }

  private assetIdentity(info: UpdateInfo, feedId?: string): string {
    if (feedId === undefined) return info.version
    if (!Array.isArray(info.files) || info.files.length === 0) {
      throw new Error('desktop update: custom provider returned no update asset')
    }
    return JSON.stringify({ version: info.version, files: info.files.map(file => ({
      url: file.url, sha512: file.sha512, size: file.size,
    })) })
  }
}
