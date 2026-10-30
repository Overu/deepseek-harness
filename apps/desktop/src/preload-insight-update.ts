/** Isolated renderer bridge for the native Insight update window. */

import { contextBridge, ipcRenderer } from 'electron'
import { INSIGHT_UPDATE_IPC, type InsightUpdateApi, type InsightUpdateSnapshot } from '@insight-ai/desktop-integration/protocol'
import { markDocumentPlatform } from './preload-platform.ts'

const api: InsightUpdateApi = {
  status: () => ipcRenderer.invoke(INSIGHT_UPDATE_IPC.status) as Promise<InsightUpdateSnapshot>,
  subscribe: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, snapshot: InsightUpdateSnapshot): void => { listener(snapshot) }
    ipcRenderer.on(INSIGHT_UPDATE_IPC.changed, receive)
    return () => { ipcRenderer.off(INSIGHT_UPDATE_IPC.changed, receive) }
  },
  checkStable: () => ipcRenderer.invoke(INSIGHT_UPDATE_IPC.checkStable) as Promise<void>,
  checkCandidate: () => ipcRenderer.invoke(INSIGHT_UPDATE_IPC.checkCandidate) as Promise<void>,
  download: () => ipcRenderer.invoke(INSIGHT_UPDATE_IPC.download) as Promise<void>,
  install: () => ipcRenderer.invoke(INSIGHT_UPDATE_IPC.install) as Promise<void>,
  fullInstaller: () => ipcRenderer.invoke(INSIGHT_UPDATE_IPC.fullInstaller) as Promise<void>,
  skip: version => ipcRenderer.invoke(INSIGHT_UPDATE_IPC.skip, version) as Promise<void>,
  close: () => ipcRenderer.invoke(INSIGHT_UPDATE_IPC.close) as Promise<void>,
}

markDocumentPlatform()
contextBridge.exposeInMainWorld('insightUpdate', api)
