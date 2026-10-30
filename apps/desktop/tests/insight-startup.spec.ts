/** Insight login gate: authentication, Home selection, and IPC ownership stay in Main. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow } from 'electron'
import { INSIGHT_DESKTOP_IPC } from '@insight-ai/desktop-integration/protocol'

const fixture = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const callbacks = new Map<string, () => void>()
  const listeners = new Map<string, (event: { preventDefault(): void }) => void>()
  const account = { userId: 'user-1', summary: { displayName: '测试账号', maskedPhone: '188****0000' } }
  const manager = {
    current: vi.fn(), getAccount: vi.fn(), subscribe: vi.fn(), sendSmsCode: vi.fn(), loadCaptcha: vi.fn(),
    loginSms: vi.fn(), loginPassword: vi.fn(), resetLocal: vi.fn(), signOut: vi.fn(), restore: vi.fn(),
    getAccessToken: vi.fn(), dispose: vi.fn(),
  }
  const window = {
    webContents: {
      mainFrame: {}, send: vi.fn(), setWindowOpenHandler: vi.fn(),
      on: vi.fn((name: string, listener: (event: { preventDefault(): void }) => void) => { listeners.set(name, listener) }),
    },
    loadFile: vi.fn(), isDestroyed: vi.fn(), destroy: vi.fn(), show: vi.fn(), focus: vi.fn(),
    once: vi.fn((name: string, callback: () => void) => { callbacks.set(name, callback) }),
  }
  return { handlers, callbacks, listeners, account, manager, window, subscriptions: [] as Array<(value: unknown) => void>,
    prepareHome: vi.fn(), credentialClear: vi.fn(), authFetch: vi.fn(), appActivate: vi.fn(), appQuit: vi.fn() }
})

vi.mock('electron', () => ({
  app: {
    get isPackaged() { return true }, getPath: () => '/user-data', getAppPath: () => '/desktop-app',
    on: (_name: string, callback: () => void) => { fixture.appActivate.mockImplementation(callback) },
    off: vi.fn(), once: vi.fn(), quit: fixture.appQuit,
  },
  BrowserWindow: vi.fn(function () { return fixture.window }),
  ipcMain: {
    handle: (name: string, handler: (event: unknown, ...args: unknown[]) => unknown) => { fixture.handlers.set(name, handler) },
    removeHandler: (name: string) => { fixture.handlers.delete(name) },
  },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: () => 'token' },
  session: {
    fromPartition: () => ({
      fetch: fixture.authFetch,
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      closeAllConnections: vi.fn(),
      clearStorageData: vi.fn(),
      clearCache: vi.fn(),
    }),
  },
}))

vi.mock('@insight-ai/desktop-integration/desktop', () => ({
  AuthApiClient: vi.fn(function () {}),
  AuthSessionManager: vi.fn(function () { return fixture.manager }),
  CredentialStore: vi.fn(function () { return { load: vi.fn(), save: vi.fn(), clear: fixture.credentialClear } }),
  prepareInsightAccountHome: fixture.prepareHome,
  resolveAuthEnvironment: () => ({ name: 'test', partition: 'persist:insight-test', baseUrl: 'https://example.test' }),
}))


const { InsightLoginClosedError, insightLoginInput, prepareInsightDesktop } = await import('../src/insight-startup.ts')

const product = {
  kind: 'insight' as const, productName: '因赛AI' as const, appId: 'com.insight-aigc.desktop' as const,
  userDataName: 'insight-desktop' as const, developmentUserDataName: 'insight-desktop-dev' as const,
  productVersion: '1.0.0', runtimeVersion: '0.2.0',
  branding: {
    macIcon: 'branding/icon.icns' as const,
    windowsIcon: 'branding/icon.ico' as const,
    resourceIcon: 'branding/app-icon.png' as const,
  },
}

function own() { return { sender: fixture.window.webContents, senderFrame: fixture.window.webContents.mainFrame } }

function reset(): void {
  fixture.handlers.clear(); fixture.callbacks.clear(); fixture.listeners.clear(); fixture.subscriptions.length = 0
  fixture.prepareHome.mockReset(); fixture.credentialClear.mockReset(); fixture.authFetch.mockReset(); fixture.appQuit.mockReset()
  fixture.window.loadFile.mockReset().mockResolvedValue(undefined); fixture.window.isDestroyed.mockReset().mockReturnValue(false)
  fixture.window.destroy.mockReset(); fixture.window.show.mockReset(); fixture.window.focus.mockReset()
  fixture.window.webContents.send.mockReset()
  fixture.window.webContents.setWindowOpenHandler.mockReset(); fixture.window.webContents.on.mockClear(); fixture.window.once.mockClear()
  fixture.manager.current.mockReset().mockReturnValue({ kind: 'unauthenticated' })
  fixture.manager.getAccount.mockReset().mockReturnValue(undefined)
  fixture.manager.subscribe.mockReset().mockImplementation((listener: (value: unknown) => void) => {
    fixture.subscriptions.push(listener)
    return vi.fn()
  })
  fixture.manager.sendSmsCode.mockReset(); fixture.manager.loadCaptcha.mockReset()
  fixture.manager.loginSms.mockReset(); fixture.manager.loginPassword.mockReset()
  fixture.manager.resetLocal.mockReset(); fixture.manager.signOut.mockReset().mockResolvedValue(undefined)
  fixture.manager.restore.mockReset().mockResolvedValue(undefined)
  fixture.manager.getAccessToken.mockReset().mockResolvedValue('secret-token'); fixture.manager.dispose.mockReset()
}

beforeEach(reset)
afterEach(() => { vi.clearAllMocks() })

async function begin() {
  const pending = prepareInsightDesktop(product, '0.2.0', () => {})
  await vi.waitFor(() => { expect(fixture.handlers.has(INSIGHT_DESKTOP_IPC.loginCurrent)).toBe(true) })
  return { pending }
}

async function authenticate(home: { kind: 'ready'; dshHome: string } | { kind: 'migration-required' }) {
  fixture.manager.current.mockReturnValue({ kind: 'authenticated', account: fixture.account.summary })
  fixture.manager.getAccount.mockReturnValue(fixture.account)
  fixture.prepareHome.mockResolvedValue(home)
  fixture.subscriptions[0]!({ kind: 'authenticated', account: fixture.account.summary })
  await vi.waitFor(() => { expect(fixture.prepareHome).toHaveBeenCalledOnce() })
}

describe('Insight desktop login startup', () => {
  it('does not prepare an account Home before authentication', async () => {
    const { pending } = await begin()
    expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
      width: 1024, height: 720, minWidth: 800, minHeight: 480, resizable: true,
    }))
    expect(vi.mocked(BrowserWindow).mock.calls[0]?.[0]?.webPreferences).toMatchObject({
      sandbox: true, contextIsolation: true, nodeIntegration: false,
    })
    expect(fixture.prepareHome).not.toHaveBeenCalled()
    expect(fixture.window.webContents.send).not.toHaveBeenCalled()
    fixture.callbacks.get('closed')!()
    await expect(pending).rejects.toBeInstanceOf(InsightLoginClosedError)
  })

  it('keeps the login window until the visible workspace accepts its fixed context', async () => {
    const { pending } = await begin()
    await authenticate({ kind: 'ready', dshHome: '/user-data/insight/accounts/scope/harness-native' })
    const context = await pending
    expect(context.summary).toEqual(fixture.account.summary)
    expect(context.info).toEqual({ productName: '因赛AI', productVersion: '1.0.0', runtimeVersion: '0.2.0',
      platform: process.platform, environment: 'test' })
    expect(fixture.window.destroy).not.toHaveBeenCalled()
    context.dismissLogin()
    expect(fixture.window.destroy).toHaveBeenCalledOnce()
    expect(fixture.handlers.size).toBe(0)
  })

  it('rejects unknown senders and child frames before admitting login actions', async () => {
    const { pending } = await begin()
    const current = fixture.handlers.get(INSIGHT_DESKTOP_IPC.loginCurrent)!
    expect(() => current({ sender: {}, senderFrame: {} })).toThrow('unowned frame')
    expect(() => current({ ...own(), senderFrame: {} })).toThrow('unowned frame')
    fixture.callbacks.get('closed')!()
    await expect(pending).rejects.toBeInstanceOf(InsightLoginClosedError)
  })

  it('reports legacy Home migration without resolving a bypass context', async () => {
    const { pending } = await begin()
    await authenticate({ kind: 'migration-required' })
    let settled = false
    void pending.finally(() => { settled = true }).catch(() => undefined)
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(fixture.window.webContents.send).toHaveBeenLastCalledWith(
      INSIGHT_DESKTOP_IPC.loginChanged,
      expect.objectContaining({ workspace: { kind: 'migration-required' } }),
    )
    fixture.callbacks.get('closed')!()
    await expect(pending).rejects.toBeInstanceOf(InsightLoginClosedError)
  })

  it.each(['closed', 'failed load'] as const)(
    'cleans handlers and aborts the auth manager on %s without clearing credentials',
    async (kind) => {
      if (kind === 'failed load') fixture.window.loadFile.mockRejectedValueOnce(new Error('missing login page'))
      const pending = prepareInsightDesktop(product, '0.2.0', () => {})
      if (kind === 'closed') {
        await vi.waitFor(() => { expect(fixture.callbacks.has('closed')).toBe(true) })
        fixture.callbacks.get('closed')!()
        await expect(pending).rejects.toBeInstanceOf(InsightLoginClosedError)
      } else await expect(pending).rejects.toThrow('missing login page')
      expect(fixture.handlers.size).toBe(0)
      expect(fixture.manager.dispose).toHaveBeenCalledOnce()
      expect(fixture.credentialClear).not.toHaveBeenCalled()
    },
  )

  it('withdraws credential admission after expiry or explicit close without exposing account internals', async () => {
    const { pending } = await begin()
    await authenticate({ kind: 'ready', dshHome: '/native-home' })
    const context = await pending
    expect(context).not.toHaveProperty('token')
    expect(context.summary).not.toHaveProperty('userId')
    expect(context.summary).not.toHaveProperty('path')
    context.closeAdmission()
    await expect(context.requestCredential(new AbortController().signal)).rejects.toThrow('unavailable')
    const expired = vi.fn()
    context.onExpired(expired)
    fixture.subscriptions[1]!({ kind: 'expired' })
    expect(expired).toHaveBeenCalledOnce()
    await expect(context.requestCredential(new AbortController().signal)).rejects.toThrow('unavailable')
  })

  it('admits only exact agreed SMS and password payloads', () => {
    expect(insightLoginInput({ phone: '18800000000', code: '1234' }, true, 'sms')).toEqual({ phone: '18800000000', code: '1234' })
    expect(insightLoginInput({ phone: '18800000000', code: '1234', extra: 'x' }, true, 'sms')).toBeUndefined()
    expect(insightLoginInput({ phone: '18800000000', code: '1234' }, false, 'sms')).toBeUndefined()
    expect(insightLoginInput({ phone: '18800000000', password: 'pass', uuid: 'id', imageCode: 'code' }, true, 'password'))
      .toEqual({ phone: '18800000000', password: 'pass', uuid: 'id', imageCode: 'code' })
    expect(insightLoginInput({ phone: '18800000000', password: '', uuid: 'id', imageCode: 'code' }, true, 'password')).toBeUndefined()
  })
})
