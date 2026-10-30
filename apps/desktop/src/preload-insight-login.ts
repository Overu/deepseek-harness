/** Isolated, renderer-safe Insight authentication operations. */
import { contextBridge, ipcRenderer } from 'electron'
import { INSIGHT_DESKTOP_IPC, type InsightLoginApi, type InsightLoginState } from '@insight-ai/desktop-integration/protocol'
import { markDocumentPlatform } from './preload-platform.ts'

const api: InsightLoginApi = {
  current: () => ipcRenderer.invoke(INSIGHT_DESKTOP_IPC.loginCurrent) as Promise<InsightLoginState>,
  subscribe: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, state: InsightLoginState): void => { listener(state) }
    ipcRenderer.on(INSIGHT_DESKTOP_IPC.loginChanged, receive)
    return () => { ipcRenderer.off(INSIGHT_DESKTOP_IPC.loginChanged, receive) }
  },
  sendSmsCode: phone => ipcRenderer.invoke(INSIGHT_DESKTOP_IPC.loginSendSmsCode, phone),
  captcha: () => ipcRenderer.invoke(INSIGHT_DESKTOP_IPC.loginCaptcha),
  loginSms: (input, agreed) => ipcRenderer.invoke(INSIGHT_DESKTOP_IPC.loginSms, input, agreed),
  loginPassword: (input, agreed) => ipcRenderer.invoke(INSIGHT_DESKTOP_IPC.loginPassword, input, agreed),
  resetLocal: () => ipcRenderer.invoke(INSIGHT_DESKTOP_IPC.loginResetLocal),
  signOut: () => ipcRenderer.invoke(INSIGHT_DESKTOP_IPC.loginSignOut),
}
markDocumentPlatform()
contextBridge.exposeInMainWorld('insightLogin', api)
