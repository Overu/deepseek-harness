/** Thin native owner for Insight's isolated update window. */

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { INSIGHT_UPDATE_IPC, type InsightUpdateSnapshot } from '@insight-ai/desktop-integration/protocol'

/** Main-owned update operations; policy and all URLs remain outside this native surface. */
export interface InsightUpdateWindowCallbacks {
  getState(): InsightUpdateSnapshot
  checkStable(): Promise<void>
  checkCandidate(): Promise<void>
  download(): Promise<void>
  install(): Promise<void>
  fullInstaller(): Promise<void>
  skip(version: string): Promise<void>
}

/** One process-owned native update window. */
export interface InsightUpdateWindow {
  open(): Promise<void>
  focus(): void
  publish(state: InsightUpdateSnapshot): void
  dispose(): void
}

const channels = [
  INSIGHT_UPDATE_IPC.status, INSIGHT_UPDATE_IPC.checkStable, INSIGHT_UPDATE_IPC.checkCandidate,
  INSIGHT_UPDATE_IPC.download, INSIGHT_UPDATE_IPC.install, INSIGHT_UPDATE_IPC.fullInstaller,
  INSIGHT_UPDATE_IPC.skip, INSIGHT_UPDATE_IPC.close,
] as const

/**
 * Create a window manager with no update decision logic and a single trusted renderer frame.
 * @param callbacks - Main-owned operations that have already made every update-policy decision.
 * @param productName - Native title shown by the platform's default title bar.
 * @returns Update-window lifecycle and state publisher.
 */
export function createInsightUpdateWindow(callbacks: InsightUpdateWindowCallbacks, productName = '因赛AI'): InsightUpdateWindow {
  let window: BrowserWindow | undefined
  let active = false
  let disposed = false
  const canShow = (): boolean => !disposed && active
  const renderer = join(app.getAppPath(), 'renderer', 'insight-update.html')
  const documentUrl = pathToFileURL(renderer).href

  const clear = (): void => {
    if (!active) return
    active = false
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
  const assertSender = (event: IpcMainInvokeEvent): void => {
    if (!active || window === undefined || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== documentUrl) {
      throw new Error('Insight update rejected an unowned frame')
    }
  }
  const bind = (): void => {
    if (window === undefined) throw new Error('Insight update window is unavailable')
    active = true
    ipcMain.handle(INSIGHT_UPDATE_IPC.status, (event) => { assertSender(event); return callbacks.getState() })
    ipcMain.handle(INSIGHT_UPDATE_IPC.checkStable, async (event) => { assertSender(event); await callbacks.checkStable() })
    ipcMain.handle(INSIGHT_UPDATE_IPC.checkCandidate, async (event) => { assertSender(event); await callbacks.checkCandidate() })
    ipcMain.handle(INSIGHT_UPDATE_IPC.download, async (event) => { assertSender(event); await callbacks.download() })
    ipcMain.handle(INSIGHT_UPDATE_IPC.install, async (event) => { assertSender(event); await callbacks.install() })
    ipcMain.handle(INSIGHT_UPDATE_IPC.fullInstaller, async (event) => { assertSender(event); await callbacks.fullInstaller() })
    ipcMain.handle(INSIGHT_UPDATE_IPC.skip, async (event, version: unknown) => {
      assertSender(event)
      if (typeof version !== 'string' || version.length === 0 || version.length > 128) throw new Error('Insight update rejected an invalid version')
      await callbacks.skip(version)
    })
    ipcMain.handle(INSIGHT_UPDATE_IPC.close, (event) => { assertSender(event); window?.close() })
  }
  const create = (): BrowserWindow => {
    const next = new BrowserWindow({ width: 520, height: 288, useContentSize: true, resizable: false, maximizable: false,
      minimizable: false, fullscreenable: false, show: false, title: `${productName} 更新`, webPreferences: {
        preload: join(import.meta.dirname, 'preload-insight-update.cjs'), nodeIntegration: false, contextIsolation: true,
        sandbox: true, webSecurity: true,
      } })
    window = next
    bind()
    next.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    next.webContents.on('will-navigate', (event) => { event.preventDefault() })
    next.once('closed', () => { if (window === next) { clear(); window = undefined } })
    return next
  }
  return {
    async open(): Promise<void> {
      if (disposed) throw new Error('Insight update window is disposed')
      const next = window !== undefined && !window.isDestroyed() ? window : create()
      if (next !== window) throw new Error('Insight update window changed while opening')
      try {
        await next.loadFile(renderer)
        if (canShow() && !next.isDestroyed()) { next.show(); next.focus() }
      } catch (error) {
        clear()
        if (!next.isDestroyed()) next.destroy()
        if (window === next) window = undefined
        throw error
      }
    },
    focus(): void { if (window !== undefined && !window.isDestroyed()) { window.show(); window.focus() } },
    publish(state): void {
      if (active && window !== undefined && !window.isDestroyed()) window.webContents.send(INSIGHT_UPDATE_IPC.changed, state)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      clear()
      if (window !== undefined && !window.isDestroyed()) window.destroy()
      window = undefined
    },
  }
}
