import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopUpdateState } from '../src/ipc.ts'

const fixture = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true, getVersion: () => '1.0.9', getPath: () => 'fixture-user-data',
  })
  const dialog = { showMessageBox: vi.fn() }
  const menu = { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn(() => ({})) }
  const coordinator = {
    instances: [] as Array<{
      state: DesktopUpdateState
      publish: (state: DesktopUpdateState) => DesktopUpdateState
      beforeRestart: () => Promise<boolean>
      disposed: boolean
      dispose: () => void
    }>,
  }
  const controller = {
    automaticCheck: vi.fn(async () => {}), updateState: vi.fn(), dispose: vi.fn(), snapshot: { phase: 'idle' },
    checkStable: vi.fn(async () => {}), checkCandidate: vi.fn(async () => {}), download: vi.fn(async () => {}),
    install: vi.fn(async () => {}), fullInstaller: vi.fn(async () => {}), skip: vi.fn(async () => {}),
  }
  const schedule = { instances: [] as Array<{ check: ReturnType<typeof vi.fn>; dispose: () => void }> }
  const window = { open: vi.fn(async () => {}), publish: vi.fn(), dispose: vi.fn() }
  return { app, dialog, menu, coordinator, controller, schedule, window }
})

vi.mock('electron', () => ({
  app: fixture.app, dialog: fixture.dialog, Menu: fixture.menu,
  net: { fetch: vi.fn() }, shell: { openExternal: vi.fn() },
}))
vi.mock('electron-updater', () => ({ default: { autoUpdater: { disableDifferentialDownload: false } } }))
vi.mock('../src/update-coordinator.ts', () => ({
  DesktopUpdateCoordinator: class {
    readonly entry: {
      state: DesktopUpdateState
      publish: (state: DesktopUpdateState) => DesktopUpdateState
      beforeRestart: () => Promise<boolean>
      disposed: boolean
      dispose: () => void
    }
    constructor(
      publish: (state: DesktopUpdateState) => DesktopUpdateState,
      beforeRestart: () => Promise<boolean>,
    ) {
      const dispose = vi.fn(() => { this.entry.disposed = true })
      this.entry = { state: { phase: 'idle' }, publish, beforeRestart, disposed: false,
        dispose }
      fixture.coordinator.instances.push(this.entry)
    }
    get state() { return this.entry.state }
    async check() { return this.entry.state }
    async download() { return this.entry.state }
    async install() { return this.entry.state }
    dispose() { this.entry.dispose() }
  },
}))
vi.mock('../src/update-schedule.ts', () => ({
  resolveDesktopUpdateScheduleConfig: () => ({ intervalMs: 1, maxBackoffMs: 1, jitter: 0 }),
  DesktopUpdateSchedule: class {
    private readonly entry = { check: vi.fn(async () => { await this.updates.check() }), dispose: vi.fn() }
    constructor(private readonly updates: { check: () => Promise<DesktopUpdateState> }) { fixture.schedule.instances.push(this.entry) }
    check() { return this.entry.check() }
    dispose() { this.entry.dispose() }
  },
}))
vi.mock('../src/insight-update-provider.ts', () => ({ insightUpdateFeed: vi.fn(() => ({ id: 'fixture', options: {}, allowPrerelease: false })) }))
vi.mock('../src/insight-update-window.ts', () => ({ createInsightUpdateWindow: () => fixture.window }))
vi.mock('@insight-ai/desktop-integration/desktop', () => ({
  InsightUpdateStateStore: class { constructor(...args: unknown[]) { void args.length } async acceptRollout() { return true } },
  readInsightUpdateDistribution: vi.fn(async () => ({ origin: 'https://updates.example.com', publicKeyPem: 'fixture' })),
  resolveInsightUpdate: vi.fn(),
  createInsightUpdateController: vi.fn(() => fixture.controller),
}))

const { createInsightDesktopUpdates } = await import('../src/insight-updates.ts')

beforeEach(() => {
  vi.stubGlobal('process', { ...process, platform: 'darwin', arch: 'arm64', resourcesPath: 'fixture-resources' })
  fixture.app.removeAllListeners()
  fixture.app.isPackaged = true
  fixture.coordinator.instances.length = 0
  fixture.schedule.instances.length = 0
  fixture.dialog.showMessageBox.mockReset()
  fixture.dialog.showMessageBox.mockResolvedValue({ response: 1 })
  fixture.menu.setApplicationMenu.mockReset(); fixture.menu.buildFromTemplate.mockClear()
  for (const method of [fixture.controller.automaticCheck, fixture.controller.updateState, fixture.controller.dispose,
    fixture.controller.checkStable, fixture.controller.checkCandidate, fixture.controller.download, fixture.controller.install,
    fixture.controller.fullInstaller, fixture.controller.skip]) method.mockReset()
  fixture.controller.automaticCheck.mockResolvedValue(undefined)
  fixture.window.open.mockReset(); fixture.window.open.mockResolvedValue(undefined)
  fixture.window.publish.mockReset(); fixture.window.dispose.mockReset()
})

afterEach(() => { vi.unstubAllGlobals() })

describe('Insight desktop updates', () => {
  it('creates one coordinator before login and reuses it through workspace binding', async () => {
    const service = await createInsightDesktopUpdates()
    expect(fixture.coordinator.instances).toHaveLength(1)
    service.beginWorkspace()
    const publish = vi.fn((state: DesktopUpdateState) => state)
    const restart = vi.fn(async () => true)
    service.bindWorkspace(publish, restart)
    expect(fixture.coordinator.instances).toHaveLength(1)
    expect(publish).toHaveBeenCalledWith({ phase: 'idle' })
  })

  it('does not hand an accepted login-era installer confirmation to workspace startup', async () => {
    const service = await createInsightDesktopUpdates()
    const response = Promise.withResolvers<{ response: number }>()
    fixture.dialog.showMessageBox.mockReturnValueOnce(response.promise)
    const prompt = fixture.coordinator.instances[0]!.beforeRestart()
    service.beginWorkspace()
    response.resolve({ response: 0 })
    await expect(prompt).resolves.toBe(false)
  })

  it('rejects installation after workspace startup begins until the workspace binds its restart guard', async () => {
    const service = await createInsightDesktopUpdates()
    service.beginWorkspace()
    await expect(fixture.coordinator.instances[0]!.beforeRestart()).rejects.toThrow(/handoff/u)
  })

  it('delegates workspace installation to the existing clean-stop guard', async () => {
    const service = await createInsightDesktopUpdates()
    service.beginWorkspace()
    const restart = vi.fn(async () => true)
    service.bindWorkspace(state => state, restart)
    await expect(fixture.coordinator.instances[0]!.beforeRestart()).resolves.toBe(true)
    expect(restart).toHaveBeenCalledOnce()
  })

  it('checks only stable updates automatically and disposes the pre-login service on application quit', async () => {
    const service = await createInsightDesktopUpdates()
    fixture.controller.automaticCheck.mockClear()
    service.automaticCheck()
    await vi.waitFor(() => { expect(fixture.controller.automaticCheck).toHaveBeenCalledOnce() })
    expect(fixture.controller.checkCandidate).not.toHaveBeenCalled()
    fixture.app.emit('will-quit')
    expect(fixture.coordinator.instances[0]!.dispose).toHaveBeenCalledOnce()
    expect(fixture.controller.dispose).toHaveBeenCalledOnce()
    expect(fixture.schedule.instances[0]!.dispose).toHaveBeenCalledOnce()
    expect(fixture.window.dispose).toHaveBeenCalledOnce()
  })

  it('does not publish a late coordinator update after disposal', async () => {
    const service = await createInsightDesktopUpdates()
    const entry = fixture.coordinator.instances[0]!
    fixture.app.emit('will-quit')
    if (!entry.disposed) entry.publish({ phase: 'available', version: '1.0.10' })
    expect(fixture.controller.updateState).not.toHaveBeenCalled()
    expect(fixture.window.publish).not.toHaveBeenCalled()
    service.dispose()
    expect(entry.dispose).toHaveBeenCalledOnce()
  })
})
