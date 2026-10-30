/** Native adapters for Insight's product update policy and the sole DSH updater. */
import { existsSync } from 'node:fs'
import { release as systemRelease } from 'node:os'
import semver from 'semver'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, dialog, Menu, net, shell } from 'electron'
import electronUpdater from 'electron-updater'
import {
  createInsightUpdateController, InsightUpdateStateStore, readInsightUpdateDistribution, resolveInsightUpdate,
  type ResolvedInsightUpdate, type InsightUpdateTrack, type InsightUpdateTarget,
} from '@insight-ai/desktop-integration/desktop'
import type { DesktopUpdateState } from './ipc.ts'
import { DesktopUpdateCoordinator } from './update-coordinator.ts'
import { insightUpdateFeed } from './insight-update-provider.ts'
import { createInsightUpdateWindow } from './insight-update-window.ts'
import { DesktopUpdateSchedule, resolveDesktopUpdateScheduleConfig } from './update-schedule.ts'

/** Process-owned updates survive the transition from the login window to the workspace. */
export interface InsightDesktopUpdates {
  readonly coordinator: DesktopUpdateCoordinator
  /** Open update status, optionally beginning a user-requested stable check. */
  open(manual?: boolean): Promise<void>
  /** Poll only the stable channel through the shared completion-based schedule. */
  automaticCheck(): void
  /** Close the never-started-Host installation path before workspace startup begins. */
  beginWorkspace(): void
  /** Attach the workspace's existing task authorization and clean shutdown. */
  bindWorkspace(publish: (state: DesktopUpdateState) => DesktopUpdateState, beforeRestart: () => Promise<boolean>): void
  /** Release the window, timers, network lifetime and updater listeners once. */
  dispose(): void
}

/**
 * Create the only updater before authentication; no Host or account directory is needed for discovery.
 * @returns Native update service to bind to the workspace before starting its Host.
 */
export async function createInsightDesktopUpdates(): Promise<InsightDesktopUpdates> {
  const directory = app.isPackaged ? join(process.resourcesPath, 'insight-update')
    : fileURLToPath(new URL('../../../packages/insight/desktop-integration/resources/update/', import.meta.url))
  const distribution = await readInsightUpdateDistribution(directory)
  const currentVersion = app.isPackaged ? app.getVersion() : process.env.INSIGHT_DESKTOP_VERSION
  if (currentVersion === undefined) throw new Error('Insight development version is missing')
  const target: InsightUpdateTarget | undefined = process.platform === 'darwin' && (process.arch === 'arm64' || process.arch === 'x64')
    ? `darwin-${process.arch}` : process.platform === 'win32' && process.arch === 'x64' ? 'win32-x64' : undefined
  const lifetime = new AbortController()
  const store = new InsightUpdateStateStore(app.getPath('userData'))
  const releases = new Map<InsightUpdateTrack, ResolvedInsightUpdate>()
  let stage: 'login' | 'starting' | 'workspace' | 'disposed' = 'login'
  const isDisposed = (): boolean => stage === 'disposed'
  const isLogin = (): boolean => stage === 'login'
  let workspacePublish: ((state: DesktopUpdateState) => DesktopUpdateState) | undefined
  let workspaceBeforeRestart: (() => Promise<boolean>) | undefined
  const coordinator = new DesktopUpdateCoordinator((state) => {
    controller.updateState(state)
    workspacePublish?.(state)
    return state
  }, async () => {
    if (workspaceBeforeRestart !== undefined) return workspaceBeforeRestart()
    if (stage !== 'login') throw new Error('Insight workspace startup has not completed update handoff')
    const result = await dialog.showMessageBox({ type: 'info', title: '安装更新', message: '更新已准备就绪，是否安装并重启因赛AI？',
      buttons: ['安装并重启', '稍后'], defaultId: 1, cancelId: 1 })
    if (result.response !== 0 || !isLogin()) return false
    return true
  }, undefined, () => target !== undefined && app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml')),
  () => currentVersion)
  // Full payloads keep the first native release independent of legacy Shell blockmap naming.
  electronUpdater.autoUpdater.disableDifferentialDownload = true
  const config = resolveDesktopUpdateScheduleConfig(process.env)
  const feed = (track: InsightUpdateTrack) => insightUpdateFeed(track, async () => {
    releases.delete(track)
    if (target === undefined) throw new Error('Insight update platform is unsupported')
    const release = await resolveInsightUpdate({
      track, target, distributionOrigin: distribution.origin, publicKeyPem: distribution.publicKeyPem,
      fetch: (input, init) => net.fetch(input instanceof Request ? input : String(input), init),
      signal: lifetime.signal, acceptRollout: input => store.acceptRollout(input),
    })
    if (isDisposed()) throw new Error('Insight updates are disposed')
    releases.set(track, release)
    return release
  })
  const controller = createInsightUpdateController({ currentVersion, store,
    coordinator: {
      get state() { return coordinator.state },
      check: async (track, manual) => {
        const state = await coordinator.check(manual, feed(track))
        const release = releases.get(track)
        const minimum = release?.metadata.minimumSystemVersion
        if (state.phase === 'idle' && release !== undefined && minimum !== undefined && semver.lt(systemRelease(), minimum)) {
          return { phase: 'unsupported', version: release.version, message: '当前系统版本不满足更新要求，请升级系统后重试' }
        }
        return state
      },
      download: version => coordinator.download(version), install: version => coordinator.install(version),
      dismissAvailable: version => coordinator.dismissAvailable(version),
    },
    resolved: track => releases.get(track),
    confirmCandidate: async () => (await dialog.showMessageBox({ type: 'warning', title: '检查内测版本',
      message: '内测版本可能不稳定，是否继续检查？', detail: '仅检查一次内测版本。后台仍只检查正式版；安装前请备份重要数据。',
      buttons: ['继续检查', '取消'], defaultId: 1, cancelId: 1 })).response === 0,
    openFullInstaller: async (release) => {
      await shell.openExternal(new URL(encodeURIComponent(release.installerAsset.name), release.releaseBaseUrl).href)
    },
    publish: (state) =>{  window.publish(state) }, report: (error) => { console.error('Insight update failed', error) },
  })
  const window = createInsightUpdateWindow({ getState: () => controller.snapshot,
    checkStable: () => controller.checkStable(), checkCandidate: () => controller.checkCandidate(),
    download: () => controller.download(), install: () => controller.install(), fullInstaller: () => controller.fullInstaller(),
    skip: version => controller.skip(version),
  })
  const schedule = new DesktopUpdateSchedule({ get state() { return coordinator.state },
    check: async () => { await controller.automaticCheck(); return coordinator.state },
  }, config)
  const open = async (manual = false): Promise<void> => {
    if (isDisposed()) throw new Error('Insight updates are disposed')
    await window.open()
    if (manual) await controller.checkStable()
  }
  const automaticCheck = (): void => {
    if (!isDisposed()) void schedule.check().catch((error: unknown) => { console.error('Insight automatic update check failed', error) })
  }
  const dispose = (): void => {
    if (isDisposed()) return
    stage = 'disposed'
    app.off('will-quit', dispose)
    schedule.dispose(); controller.dispose(); lifetime.abort(); coordinator.dispose(); window.dispose()
  }
  app.once('will-quit', dispose)
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '因赛AI', submenu: [
      { label: '检查更新…', click: () => { void open(true).catch((error: unknown) => { console.error(error) }) } },
      { type: 'separator' }, { role: 'quit', label: '退出因赛AI' },
    ] },
    { role: 'editMenu' }, { role: 'windowMenu' },
  ]))
  automaticCheck()
  return { coordinator, open, automaticCheck,
    beginWorkspace(): void {
      if (stage !== 'login') throw new Error('Insight update startup handoff is not available')
      stage = 'starting'
    },
    bindWorkspace(publish, beforeRestart): void {
      if (stage !== 'starting') throw new Error('Insight workspace update ownership is invalid')
      workspacePublish = publish; workspaceBeforeRestart = beforeRestart; stage = 'workspace'
      publish(coordinator.state)
    }, dispose,
  }
}
