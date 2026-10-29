import { describe, expect, it, vi } from 'vitest'
import { AuthApiError, type AuthenticatedAccount } from '../src/desktop/auth-api-client.ts'
import {
  AuthSessionManager,
  type AuthSessionApi,
} from '../src/desktop/auth-session-manager.ts'

const account: AuthenticatedAccount = {
  userId: '42',
  summary: { displayName: 'Alice', avatarUrl: 'https://assets.example/a.png', maskedPhone: '138****8000' },
}

function defaultApi() {
  return {
    sendSmsCode: vi.fn().mockResolvedValue(undefined),
    captcha: vi.fn().mockResolvedValue({ uuid: 'u', image: 'data:image/png;base64,a' }),
    loginSms: vi.fn().mockResolvedValue({ accessToken: 'sms-token' }),
    loginPassword: vi.fn().mockResolvedValue({ accessToken: 'password-token' }),
    refresh: vi.fn().mockResolvedValue({ accessToken: 'fresh-token' }),
    currentUser: vi.fn().mockResolvedValue(account),
    logout: vi.fn().mockResolvedValue(undefined),
  }
}

type AuthSessionApiMock = ReturnType<typeof defaultApi>

function api(overrides: Partial<AuthSessionApiMock> = {}): AuthSessionApiMock {
  return { ...defaultApi(), ...overrides } satisfies AuthSessionApi
}

function persistence(token: string | undefined = 'stored-token') {
  return {
    load: vi.fn().mockResolvedValue(token),
    save: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  }
}

describe('Insight auth session manager', () => {
  it('restores an expired credential with exactly one refresh and never exposes the token', async () => {
    const service = api({
      currentUser: vi.fn()
        .mockRejectedValueOnce(new AuthApiError('expired', 'expired'))
        .mockResolvedValueOnce(account),
    })
    const store = persistence()
    const manager = new AuthSessionManager(service, store)

    await manager.restore()

    expect(service.refresh).toHaveBeenCalledOnce()
    expect(store.save).toHaveBeenCalledWith('fresh-token')
    expect(manager.current()).toEqual({ kind: 'authenticated', account: account.summary })
    expect(manager.getAccount()).toEqual(account)
    expect(JSON.stringify(manager.current())).not.toContain('fresh-token')
    expect(JSON.stringify(manager.current())).not.toContain(account.userId)
  })

  it('preserves credentials when validation is offline', async () => {
    const service = api({ currentUser: vi.fn().mockRejectedValue(new AuthApiError('offline', 'offline')) })
    const store = persistence()
    const manager = new AuthSessionManager(service, store)
    await manager.restore()
    expect(manager.current()).toEqual({ kind: 'offline' })
    expect(store.clear).not.toHaveBeenCalled()
  })

  it('shares access-token validation for concurrent Host callers', async () => {
    const service = api()
    const manager = new AuthSessionManager(service, persistence())
    await manager.restore()
    service.currentUser.mockRejectedValueOnce(new AuthApiError('offline', 'offline'))

    const results = await Promise.allSettled([manager.getAccessToken(), manager.getAccessToken()])

    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected'])
    expect(service.currentUser).toHaveBeenCalledTimes(2)
    expect(manager.current().kind).toBe('authenticated')
  })

  it('does not permit an aborted Host request to consume a completed validation', async () => {
    let resolve!: (value: AuthenticatedAccount) => void
    const pending = new Promise<AuthenticatedAccount>((done) => { resolve = done })
    const service = api({ currentUser: vi.fn().mockReturnValueOnce(account).mockReturnValueOnce(pending) })
    const manager = new AuthSessionManager(service, persistence())
    await manager.restore()
    const controller = new AbortController()
    const token = manager.getAccessToken(controller.signal)
    controller.abort()
    resolve(account)
    await expect(token).rejects.toMatchObject({ name: 'AbortError' })
    expect(manager.current().kind).toBe('authenticated')
  })

  it('prevents a late refresh from restoring credentials after sign out', async () => {
    let resolveRefresh!: (value: { accessToken: string }) => void
    const service = api()
    const store = persistence()
    const manager = new AuthSessionManager(service, store)
    await manager.restore()
    service.currentUser.mockRejectedValueOnce(new AuthApiError('expired', 'expired'))
    service.refresh.mockImplementationOnce(() => new Promise((done) => { resolveRefresh = done }))
    const pending = manager.getAccessToken()
    await vi.waitFor(() =>{  expect(resolveRefresh).toBeTypeOf('function') })

    await manager.signOut()
    resolveRefresh({ accessToken: 'obsolete-token' })

    await expect(pending).rejects.toMatchObject({ kind: 'expired' })
    expect(manager.current()).toEqual({ kind: 'unauthenticated' })
    expect(manager.getAccount()).toBeUndefined()
    expect(store.save).not.toHaveBeenCalledWith('obsolete-token')
    expect(store.clear).toHaveBeenCalledOnce()
  })

  it('revokes local state even if remote logout is unavailable', async () => {
    const service = api({ logout: vi.fn().mockRejectedValue(new AuthApiError('offline', 'offline')) })
    const store = persistence()
    const manager = new AuthSessionManager(service, store)
    await manager.restore()
    await manager.signOut()
    expect(store.clear).toHaveBeenCalledOnce()
    expect(manager.current()).toEqual({ kind: 'unauthenticated' })
  })

  it('isolates observer exceptions so sign out still removes the persisted credential', async () => {
    const store = persistence()
    const observerFailure = vi.fn()
    const manager = new AuthSessionManager(
      api(),
      store,
      () => { throw new Error('token observer failed') },
      async () => {},
      observerFailure,
    )
    manager.subscribe(() => { throw new Error('view observer failed') })
    await manager.restore()

    await expect(manager.signOut()).resolves.toBeUndefined()

    expect(store.clear).toHaveBeenCalledOnce()
    expect(manager.current()).toEqual({ kind: 'unauthenticated' })
    expect(observerFailure).toHaveBeenCalled()
  })

  it('reports local credential cleanup failures after revoking the in-memory session', async () => {
    const store = persistence()
    store.clear.mockRejectedValue(new Error('credential storage is busy'))
    const manager = new AuthSessionManager(api(), store)
    await manager.restore()

    await expect(manager.signOut()).rejects.toThrow('credential storage is busy')
    expect(manager.current()).toEqual({ kind: 'offline' })
    expect(manager.getAccount()).toBeUndefined()
  })

  it('publishes unauthenticated only after credential clearing commits and blocks a concurrent login', async () => {
    let finishClear!: () => void
    const store = persistence()
    store.clear.mockImplementationOnce(() => new Promise<void>((done) => { finishClear = done }))
    const manager = new AuthSessionManager(api(), store)
    await manager.restore()

    const signingOut = manager.signOut()
    await vi.waitFor(() =>{  expect(finishClear).toBeTypeOf('function') })
    expect(manager.current()).toEqual({ kind: 'restoring' })
    await expect(manager.loginSms({ phone: '13800138000', code: '123456' })).resolves.toMatchObject({
      ok: false,
    })

    finishClear()
    await signingOut
    expect(manager.current()).toEqual({ kind: 'unauthenticated' })
  })

  it('commits local sign out before waiting for the best-effort remote logout', async () => {
    let settleRemoteLogout!: () => void
    const remoteLogout = new Promise<void>((done) => { settleRemoteLogout = done })
    const tokens: Array<string | undefined> = []
    const manager = new AuthSessionManager(
      api({ logout: vi.fn().mockReturnValue(remoteLogout) }),
      persistence(),
      token => tokens.push(token),
    )
    await manager.restore()

    let settled = false
    const signingOut = manager.signOut().then(() => { settled = true })
    await vi.waitFor(() =>{  expect(manager.current()).toEqual({ kind: 'unauthenticated' }) })
    expect(tokens).toEqual(['stored-token', undefined])
    expect(settled).toBe(false)

    settleRemoteLogout()
    await signingOut
    expect(settled).toBe(true)
  })

  it('disposes late authentication work without deleting the persisted credential', async () => {
    let resolve!: (value: AuthenticatedAccount) => void
    const pending = new Promise<AuthenticatedAccount>((done) => { resolve = done })
    const store = persistence()
    const manager = new AuthSessionManager(api({ currentUser: vi.fn().mockReturnValue(pending) }), store)

    const restoring = manager.restore()
    manager.dispose()
    resolve(account)
    await restoring

    expect(store.clear).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
    expect(manager.current()).toEqual({ kind: 'unauthenticated' })
    expect(manager.getAccount()).toBeUndefined()
  })
})
