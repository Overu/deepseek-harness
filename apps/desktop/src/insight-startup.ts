/** Native Insight login gate; one immutable account owns each Desktop process. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, safeStorage, session, type IpcMainInvokeEvent } from 'electron'
import {
  AuthApiClient, AuthSessionManager, CredentialStore, prepareInsightAccountHome, resolveAuthEnvironment,
} from '@insight-ai/desktop-integration/desktop'
import {
  INSIGHT_DESKTOP_IPC, type AccountSummary, type AuthCommandResult, type InsightAccountInfo,
  type InsightLoginState, type PasswordLoginInput, type SmsLoginInput,
} from '@insight-ai/desktop-integration/protocol'
import { resolveDesktopLocale } from './locale.ts'
import { welcomeWindowOptions } from './welcome-window.ts'
import type { InsightDesktopProduct } from './product.ts'

/** Startup cancellation caused by closing the login window before a Host exists. */
export class InsightLoginClosedError extends Error {}

/** Account authorization retained only by Main and the bound Host process. */
export interface InsightDesktopContext {
  readonly dshHome: string
  readonly summary: AccountSummary
  readonly active: boolean
  readonly info: InsightAccountInfo
  requestCredential(signal: AbortSignal): Promise<string>
  onExpired(listener: () => void): () => void
  closeAdmission(): void
  clearAuthentication(): Promise<void>
  /** Release the login window only after a workspace window is visible. */
  dismissLogin(): void
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Admit login input only after explicit agreement, without forwarding that UI field to the backend.
 * @param value - Untrusted renderer fields.
 * @param agreed - Explicit consent for the existing Insight agreements.
 * @param method - Login method being invoked.
 * @returns The admitted backend input, or undefined for malformed input.
 */
export function insightLoginInput(value: unknown, agreed: unknown, method: 'sms' | 'password'): SmsLoginInput | PasswordLoginInput | undefined {
  if (agreed !== true || !record(value) || typeof value.phone !== 'string' || !/^1\d{10}$/u.test(value.phone)) return undefined
  const keys = method === 'sms' ? ['phone', 'code'] : ['phone', 'password', 'uuid', 'imageCode']
  if (Object.keys(value).length !== keys.length || !keys.every(key => typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= 1024)) return undefined
  if (method === 'sms' && typeof value.code === 'string' && /^\d{4,6}$/u.test(value.code)) return { phone: value.phone, code: value.code }
  if (method === 'password' && typeof value.password === 'string' && typeof value.uuid === 'string' && typeof value.imageCode === 'string') {
    return { phone: value.phone, password: value.password, uuid: value.uuid, imageCode: value.imageCode }
  }
  return undefined
}

const invalidInput: AuthCommandResult = { ok: false, reason: 'invalid-input', message: '请检查登录信息并同意协议' }

/**
 * Authenticate before creating a profile or business Host. Historical homes stop at the migration notice.
 * @param product - Validated Insight product identity.
 * @param runtimeVersion - Bundled DSH version, independent of the Insight product version.
 * @param focus - Install the login-window focus callback while startup owns that window.
 * @returns One fixed account context; closing the login window rejects without starting a Host.
 */
export async function prepareInsightDesktop(
  product: InsightDesktopProduct,
  runtimeVersion: string,
  focus: (callback: () => void) => void,
): Promise<InsightDesktopContext> {
  const environment = resolveAuthEnvironment({ packaged: app.isPackaged })
  const authSession = session.fromPartition(environment.partition)
  authSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
  authSession.setPermissionCheckHandler(() => false)
  const clearSession = async (): Promise<void> => {
    await authSession.closeAllConnections()
    await authSession.clearStorageData()
    await authSession.clearCache()
  }
  const insightRoot = join(app.getPath('userData'), 'insight')
  let token: string | undefined
  const lifetime = new AbortController()
  const api = new AuthApiClient((input, init) => authSession.fetch(String(input), { ...init,
    signal: init?.signal === undefined || init.signal === null ? lifetime.signal : AbortSignal.any([init.signal, lifetime.signal]),
  }), environment, () => token)
  const credentials = app.isPackaged
    ? new CredentialStore(join(insightRoot, 'auth', `${environment.name}.json`), {
      available: () => safeStorage.isEncryptionAvailable(), encrypt: value => safeStorage.encryptString(value),
      decrypt: value => safeStorage.decryptString(value),
    })
    : { load: () => Promise.resolve(undefined), save: () => Promise.resolve(), clear: () => Promise.resolve() }
  const manager = new AuthSessionManager(api, credentials, (value) => { token = value }, clearSession)
  const options = welcomeWindowOptions(process.platform, resolveDesktopLocale('zh'))
  const window = new BrowserWindow({ ...options, width: 1024, height: 720, minWidth: 800, minHeight: 480,
    resizable: true, maximizable: true, fullscreenable: true, title: product.productName,
    ...(process.platform === 'win32' ? { titleBarOverlay: { color: '#00000000', symbolColor: '#F4F6FF', height: 42 } } : {}),
    webPreferences: {
      ...options.webPreferences, preload: fileURLToPath(new URL('./preload-insight-login.cjs', import.meta.url)),
      partition: environment.partition,
    } })
  const channels = [INSIGHT_DESKTOP_IPC.loginCurrent, INSIGHT_DESKTOP_IPC.loginSendSmsCode,
    INSIGHT_DESKTOP_IPC.loginCaptcha, INSIGHT_DESKTOP_IPC.loginSms, INSIGHT_DESKTOP_IPC.loginPassword,
    INSIGHT_DESKTOP_IPC.loginResetLocal, INSIGHT_DESKTOP_IPC.loginSignOut, INSIGHT_DESKTOP_IPC.loginOpenAgreement]
  let closed = false
  const isClosed = (): boolean => closed
  let accepted = false
  let closeAccount = (): void => {}
  let revision = 0
  let workspace: InsightLoginState['workspace'] = { kind: 'idle' }
  let resolveContext!: (value: InsightDesktopContext) => void
  let rejectContext!: (error: Error) => void
  const result = new Promise<InsightDesktopContext>((resolve, reject) => { resolveContext = resolve; rejectContext = reject })
  const current = (): InsightLoginState => ({ session: manager.current(), workspace })
  const publish = (): void => {
    if (!closed && !window.isDestroyed()) window.webContents.send(INSIGHT_DESKTOP_IPC.loginChanged, current())
  }
  const assertSender = (event: IpcMainInvokeEvent): void => {
    if (closed || accepted || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Insight login rejected an unowned frame')
    }
  }
  const handle = (channel: string, action: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => { assertSender(event); return action(...args) })
  }
  handle(INSIGHT_DESKTOP_IPC.loginCurrent, current)
  handle(INSIGHT_DESKTOP_IPC.loginSendSmsCode, value => typeof value === 'string' && /^1\d{10}$/u.test(value)
    ? manager.sendSmsCode(value) : invalidInput)
  handle(INSIGHT_DESKTOP_IPC.loginCaptcha, () => manager.loadCaptcha())
  handle(INSIGHT_DESKTOP_IPC.loginSms, (value, agreed) => {
    const input = insightLoginInput(value, agreed, 'sms')
    return input !== undefined && 'code' in input ? manager.loginSms(input) : invalidInput
  })
  handle(INSIGHT_DESKTOP_IPC.loginPassword, (value, agreed) => {
    const input = insightLoginInput(value, agreed, 'password')
    return input !== undefined && 'password' in input ? manager.loginPassword(input) : invalidInput
  })
  handle(INSIGHT_DESKTOP_IPC.loginResetLocal, () => manager.resetLocal())
  handle(INSIGHT_DESKTOP_IPC.loginSignOut, async () => { ++revision; workspace = { kind: 'idle' }; await manager.signOut(); await clearSession(); publish() })
  const legalWindows = new Set<BrowserWindow>()
  handle(INSIGHT_DESKTOP_IPC.loginOpenAgreement, async (kind) => {
    if (kind !== 'service' && kind !== 'privacy') throw new Error('Invalid Insight agreement')
    const resource = kind === 'service' ? 'ServiceAgreement.html' : 'PrivacyPolicy.html'
    const html = await readFile(join(app.getAppPath(), 'renderer', 'insight-legal', resource), 'utf8')
    if (closed || accepted) return
    const legal = new BrowserWindow({ ...options, parent: window, title: kind === 'service' ? '软件许可及服务协议' : '隐私政策',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } })
    legalWindows.add(legal)
    legal.once('closed', () => { legalWindows.delete(legal) })
    legal.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    legal.webContents.on('will-navigate', (event) => { event.preventDefault() })
    await legal.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    if (!legal.isDestroyed()) legal.show()
  })
  const stop = manager.subscribe((view) => {
    publish()
    const attempt = ++revision
    if (view.kind !== 'authenticated') return
    const account = manager.getAccount()
    if (account === undefined) return
    workspace = { kind: 'preparing' }; publish()
    void prepareInsightAccountHome({ insightRoot, environment: environment.name, userId: account.userId }).then((home) => {
      if (closed || attempt !== revision || manager.current().kind !== 'authenticated') return
      if (home.kind === 'migration-required') { workspace = { kind: 'migration-required' }; publish(); return }
      let admissionClosed = false
      const isActive = (): boolean => !admissionClosed
      const expired = new Set<() => void>()
      const stopAccount = manager.subscribe((state) => {
        if (!admissionClosed && (state.kind !== 'authenticated' || manager.getAccount()?.userId !== account.userId)) {
          admissionClosed = true
          for (const listener of expired) listener()
        }
      })
      accepted = true
      stop()
      closeAccount = () => { admissionClosed = true }
      resolveContext({ dshHome: home.dshHome, summary: view.account,
        info: { productName: product.productName, productVersion: product.productVersion, runtimeVersion,
          platform: process.platform, environment: environment.name },
        get active() { return !admissionClosed },
        requestCredential: async (signal) => {
          if (admissionClosed) throw new Error('Insight account unavailable')
          const value = await manager.getAccessToken(signal)
          if (!isActive() || signal.aborted || manager.getAccount()?.userId !== account.userId) throw new Error('Insight account unavailable')
          return value
        },
        onExpired: (listener) => { expired.add(listener); if (admissionClosed) listener(); return () => { expired.delete(listener) } },
        closeAdmission: () => { admissionClosed = true },
        clearAuthentication: async () => {
          admissionClosed = true; stopAccount()
          try { await manager.signOut(); await clearSession() } finally { manager.dispose(); lifetime.abort() }
        },
        dismissLogin: () => { cleanupLogin() },
      })
    }).catch((_error: unknown) => {
      if (!closed && attempt === revision) { workspace = { kind: 'failed', message: '无法安全准备账号数据，请退出后检查本机数据权限或重新登录' }; publish() }
    })
  })
  const activate = (): void => { if (!window.isDestroyed()) { window.show(); window.focus() } }
  focus(activate)
  app.on('activate', activate)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => { event.preventDefault() })
  const cleanupLogin = (): void => {
    if (closed) return
    closed = true; ++revision; stop(); app.off('activate', activate)
    for (const channel of channels) ipcMain.removeHandler(channel)
    for (const legal of legalWindows) if (!legal.isDestroyed()) legal.destroy()
    if (!window.isDestroyed()) window.destroy()
  }
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true; closeAccount(); manager.dispose(); lifetime.abort(); cleanupLogin()
  }
  app.once('will-quit', dispose)
  window.once('closed', () => {
    if (closed) return
    dispose()
    if (!accepted) rejectContext(new InsightLoginClosedError('Insight login closed'))
    else app.quit()
  })
  try {
    await window.loadFile(join(app.getAppPath(), 'renderer', 'insight-login.html'))
    if (!isClosed()) { window.show(); void manager.restore().catch((_error: unknown) => { publish() }) }
    return await result
  } catch (error) {
    dispose()
    app.off('will-quit', dispose)
    throw error
  }
}
