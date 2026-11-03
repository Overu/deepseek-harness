/** Native Insight update window rejects all renderer ownership confusion. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { InsightUpdateWindowCallbacks } from '../src/insight-update-window.ts'

const fixture = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const contentsEvents = new Map<string, (...args: unknown[]) => void>()
  const windowEvents = new Map<string, (...args: unknown[]) => void>()
  const webContents = { mainFrame: { url: 'file:///app/renderer/insight-update.html' }, send: vi.fn(), setWindowOpenHandler: vi.fn<(handler: () => { action: string }) => void>(),
    on: vi.fn((name: string, listener: (...args: unknown[]) => void) => { contentsEvents.set(name, listener) }),
    emit: (name: string, ...args: unknown[]) => { contentsEvents.get(name)?.(...args) } }
  const window = {
    webContents, isDestroyed: vi.fn(() => false), loadFile: vi.fn(async () => {}), show: vi.fn(), focus: vi.fn(),
    close: vi.fn(), destroy: vi.fn(), setMenu: vi.fn(),
    once: vi.fn((name: string, listener: (...args: unknown[]) => void) => { windowEvents.set(name, listener) }),
    emit: (name: string, ...args: unknown[]) => { windowEvents.get(name)?.(...args) },
  }
  const browserCalls: unknown[][] = []
  function BrowserWindow(...args: unknown[]) { browserCalls.push(args); return window }
  return { handlers, webContents, window, browserCalls,
    BrowserWindow, app: { getAppPath: vi.fn(() => '/app') },
    ipcMain: {
      handle: vi.fn((channel: string, callback: (event: unknown, ...args: unknown[]) => unknown) => { handlers.set(channel, callback) }),
      removeHandler: vi.fn((channel: string) => { handlers.delete(channel) }),
    },
  }
})
vi.mock('electron', () => ({ BrowserWindow: fixture.BrowserWindow, app: fixture.app, ipcMain: fixture.ipcMain }))
vi.mock('@insight-ai/desktop-integration/protocol', () => ({
  INSIGHT_UPDATE_IPC: { status: 'status', changed: 'changed', checkForUpdates: 'check', checkCandidate: 'candidate', download: 'download', install: 'install', fullInstaller: 'full', skip: 'skip', close: 'close' },
}))

beforeEach(() => { fixture.handlers.clear(); fixture.browserCalls.length = 0; vi.clearAllMocks(); fixture.window.isDestroyed.mockReturnValue(false); fixture.webContents.mainFrame.url = 'file:///app/renderer/insight-update.html' })
afterEach(() => { vi.resetModules() })

function callbacks() {
  return {
    getState: vi.fn(() => ({ currentVersion: '1.0.9', phase: 'idle' as const, track: 'stable' as const, required: false, canDownloadFullInstaller: false })),
    checkForUpdates: vi.fn(async () => {}), checkCandidate: vi.fn(async () => {}), download: vi.fn(async () => {}),
    install: vi.fn(async () => {}), fullInstaller: vi.fn(async () => {}), skip: vi.fn(async () => {}),
  } satisfies InsightUpdateWindowCallbacks
}

it('binds only the exact update-window main frame and cleans handlers on close', async () => {
  const { createInsightUpdateWindow } = await import('../src/insight-update-window.ts')
  const actions = callbacks()
  const manager = createInsightUpdateWindow(actions)
  await manager.open()
  const owned = { sender: fixture.webContents, senderFrame: fixture.webContents.mainFrame }
  await fixture.handlers.get('candidate')!(owned)
  expect(actions.checkCandidate).toHaveBeenCalledOnce()
  await expect(fixture.handlers.get('candidate')!({ sender: {}, senderFrame: fixture.webContents.mainFrame })).rejects.toThrow('unowned frame')
  await expect(fixture.handlers.get('candidate')!({ ...owned, senderFrame: { url: 'file:///app/renderer/insight-update.html' } })).rejects.toThrow('unowned frame')
  fixture.webContents.mainFrame.url = 'https://untrusted.example/'
  await expect(fixture.handlers.get('candidate')!(owned)).rejects.toThrow('unowned frame')
  fixture.window.emit('closed')
  expect(fixture.handlers.size).toBe(0)
})

it('uses default native chrome without an application menu, denies navigation, and only closes the update window', async () => {
  const { createInsightUpdateWindow } = await import('../src/insight-update-window.ts')
  const manager = createInsightUpdateWindow(callbacks())
  await manager.open()
  expect(fixture.browserCalls[0]![0]).not.toHaveProperty('titleBarStyle')
  expect(fixture.window.setMenu).toHaveBeenCalledWith(null)
  expect(fixture.webContents.setWindowOpenHandler.mock.calls[0]![0]()).toEqual({ action: 'deny' })
  const navigation = { preventDefault: vi.fn() }
  fixture.webContents.emit('will-navigate', navigation)
  expect(navigation.preventDefault).toHaveBeenCalledOnce()
  await fixture.handlers.get('close')!({ sender: fixture.webContents, senderFrame: fixture.webContents.mainFrame })
  expect(fixture.window.close).toHaveBeenCalledOnce()
})

it('focuses the existing update window as confirmation owner without creating or reloading it', async () => {
  const { createInsightUpdateWindow } = await import('../src/insight-update-window.ts')
  const manager = createInsightUpdateWindow(callbacks())
  expect(manager.confirmationWindow()).toBeUndefined()
  await manager.open()
  vi.clearAllMocks()
  expect(manager.confirmationWindow()).toBe(fixture.window)
  expect(fixture.window.show).toHaveBeenCalledOnce()
  expect(fixture.window.focus).toHaveBeenCalledOnce()
  expect(fixture.window.loadFile).not.toHaveBeenCalled()
  manager.dispose()
  expect(manager.confirmationWindow()).toBeUndefined()
})

it('does not reuse a closed window for confirmation or create a replacement', async () => {
  const { createInsightUpdateWindow } = await import('../src/insight-update-window.ts')
  const manager = createInsightUpdateWindow(callbacks())
  await manager.open()
  fixture.window.emit('closed')
  vi.clearAllMocks()
  expect(manager.confirmationWindow()).toBeUndefined()
  expect(fixture.browserCalls).toHaveLength(1)
  expect(fixture.window.show).not.toHaveBeenCalled()
  manager.dispose()
})
