// @vitest-environment jsdom
/** The update preload exposes only the declared renderer-safe operations. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}))
vi.mock('electron', () => electron)
vi.mock('@insight-ai/desktop-integration/protocol', () => ({
  INSIGHT_UPDATE_IPC: { status: 'status', changed: 'changed', checkStable: 'stable', checkCandidate: 'candidate', download: 'download', install: 'install', fullInstaller: 'full', skip: 'skip', close: 'close' },
}))
vi.mock('../src/preload-platform.ts', () => ({ markDocumentPlatform: vi.fn() }))

beforeEach(() => { vi.resetModules() })
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

it('forwards only declared update operations and releases the status listener', async () => {
  await import('../src/preload-insight-update.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls[0]![1] as {
    subscribe(listener: (state: unknown) => void): () => void
    checkCandidate(): Promise<void>
    skip(version: string): Promise<void>
  }
  const listener = vi.fn()
  const unsubscribe = api.subscribe(listener)
  expect(electron.ipcRenderer.on).toHaveBeenCalledWith('changed', expect.any(Function))
  await api.checkCandidate()
  await api.skip('1.0.10-rc.1')
  expect(electron.ipcRenderer.invoke.mock.calls).toEqual([['candidate'], ['skip', '1.0.10-rc.1']])
  unsubscribe()
  expect(electron.ipcRenderer.off).toHaveBeenCalledWith('changed', expect.any(Function))
  expect(api).not.toHaveProperty('send')
})
