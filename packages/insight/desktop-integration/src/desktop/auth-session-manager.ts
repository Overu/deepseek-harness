/** Main-process authentication state, credential lifetime, and renderer-safe projections. */
import type {
  AuthCommandResult,
  CaptchaCommandResult,
  CaptchaView,
  PasswordLoginInput,
  SessionView,
  SmsLoginInput,
} from '../shared/auth-contracts.ts'
import { AuthApiError, type AuthenticatedAccount } from './auth-api-client.ts'

interface AccessTokenResult {
  accessToken: string
}

/** Account API operations consumed by the desktop authentication state machine. */
export interface AuthSessionApi {
  sendSmsCode(phone: string): Promise<void>
  captcha(): Promise<CaptchaView>
  loginSms(input: SmsLoginInput): Promise<AccessTokenResult>
  loginPassword(input: PasswordLoginInput): Promise<AccessTokenResult>
  refresh(): Promise<AccessTokenResult>
  currentUser(): Promise<AuthenticatedAccount>
  logout(): Promise<void>
}

/** Encrypted credential persistence consumed by the authentication state machine. */
export interface CredentialPersistence {
  load(): Promise<string | undefined>
  save(token: string): Promise<void>
  clear(): Promise<void>
}

type SessionListener = (view: SessionView) => void

class AuthSessionAbortError extends Error {
  constructor() {
    super('Authentication operation was cancelled.')
    this.name = 'AbortError'
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AuthSessionAbortError()
}

function commandFailure(error: unknown): Exclude<AuthCommandResult, { ok: true }> {
  if (error instanceof AuthApiError) {
    return {
      ok: false,
      reason: error.kind === 'offline'
        ? 'offline'
        : error.kind === 'rejected' || error.kind === 'expired'
          ? 'rejected'
          : 'service-error',
      message: error.message,
    }
  }
  return { ok: false, reason: 'service-error', message: '认证服务暂时不可用。' }
}

/** Owns desktop authentication state and Main-only account credentials. */
export class AuthSessionManager {
  private view: SessionView = { kind: 'unauthenticated' }
  private account: AuthenticatedAccount | undefined
  private restoreOperation: Promise<void> | undefined
  private signOutOperation: Promise<void> | undefined
  private accessToken: string | undefined
  private sessionRevision = 0
  private accessTokenValidation: Promise<string> | undefined
  private credentialWrites: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<SessionListener>()

  constructor(
    private readonly api: AuthSessionApi,
    private readonly credentials: CredentialPersistence,
    private readonly onAccessTokenChanged: (token: string | undefined) => void = () => {},
    private readonly clearLocalSession: () => Promise<void> = async () => {},
    private readonly reportObserverFailure: (error: unknown) => void = () => {},
  ) {}

  /** Return the renderer-safe authentication state.
   *
   * @returns The current renderer-safe state.
   */
  current(): SessionView {
    return this.view
  }

  /** Return the Main-only account identity associated with the active session.
   *
   * @returns The active account, if one is authenticated.
   */
  getAccount(): AuthenticatedAccount | undefined {
    return this.account
  }

  /** Subscribe to renderer-safe authentication state changes.
   *
   * @param listener State-change recipient.
   * @returns A function that removes the listener.
   */
  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Revoke in-memory state and subscriptions without changing persisted credentials. */
  dispose(): void {
    ++this.sessionRevision
    this.accessTokenValidation = undefined
    this.account = undefined
    this.setAccessToken(undefined)
    this.view = { kind: 'unauthenticated' }
    this.listeners.clear()
  }

  /** Restore the encrypted credential once for concurrent application startup callers. */
  restore(): Promise<void> {
    if (this.signOutOperation) return this.signOutOperation
    if (this.restoreOperation) return this.restoreOperation
    const operation = this.performRestore()
    this.restoreOperation = operation
    void operation.finally(() => {
      if (this.restoreOperation === operation) this.restoreOperation = undefined
    }).catch(() => undefined)
    return operation
  }

  /** Retry a failed restore without changing the selected authentication environment. */
  retry(): Promise<void> {
    return this.restore()
  }

  /** Request an SMS login code without changing session state.
   *
   * @param phone Phone number accepted by the Insight user center.
   * @returns The command result suitable for the login renderer.
   */
  async sendSmsCode(phone: string): Promise<AuthCommandResult> {
    try {
      await this.api.sendSmsCode(phone)
      return { ok: true }
    } catch (error) {
      return commandFailure(error)
    }
  }

  /** Request a password-login captcha.
   *
   * @returns The captcha command result suitable for the login renderer.
   */
  async loadCaptcha(): Promise<CaptchaCommandResult> {
    try {
      return { ok: true, captcha: await this.api.captcha() }
    } catch (error) {
      const failure = commandFailure(error)
      return {
        ok: false,
        reason: failure.reason === 'offline' ? 'offline' : 'service-error',
        message: failure.message,
      }
    }
  }

  /** Authenticate with an SMS code.
   *
   * @param input Phone number and SMS code.
   * @returns The command result suitable for the login renderer.
   */
  async loginSms(input: SmsLoginInput): Promise<AuthCommandResult> {
    return this.login('sms', () => this.api.loginSms(input))
  }

  /** Authenticate with a password and captcha.
   *
   * @param input Password and captcha fields.
   * @returns The command result suitable for the login renderer.
   */
  async loginPassword(input: PasswordLoginInput): Promise<AuthCommandResult> {
    return this.login('password', () => this.api.loginPassword(input))
  }

  /** Revoke persisted and in-memory credentials before best-effort remote logout. */
  async signOut(): Promise<void> {
    if (this.signOutOperation) return this.signOutOperation
    const operation = this.performSignOut()
    this.signOutOperation = operation
    void operation.finally(() => {
      if (this.signOutOperation === operation) this.signOutOperation = undefined
    }).catch(() => undefined)
    return operation
  }

  private async performSignOut(): Promise<void> {
    ++this.sessionRevision
    this.accessTokenValidation = undefined
    let remoteLogout: Promise<void>
    try {
      remoteLogout = this.api.logout().catch(() => undefined)
    } catch {
      remoteLogout = Promise.resolve()
    }
    this.account = undefined
    this.setAccessToken(undefined)
    this.transition({ kind: 'restoring' })
    const revision = this.sessionRevision
    try {
      await this.clearCredentials()
    } catch (error) {
      if (revision === this.sessionRevision) this.transition({ kind: 'offline' })
      throw error
    }
    if (revision === this.sessionRevision) this.transition({ kind: 'unauthenticated' })
    await remoteLogout
  }

  /** Clear local authentication when a remote logout cannot be used. */
  async resetLocal(): Promise<void> {
    if (this.signOutOperation) return this.signOutOperation
    const revision = ++this.sessionRevision
    this.accessTokenValidation = undefined
    this.account = undefined
    this.setAccessToken(undefined)
    this.transition({ kind: 'restoring' })
    try {
      await this.clearCredentials()
      await this.restoreOperation?.catch(() => undefined)
      await this.clearLocalSession()
      if (revision === this.sessionRevision) this.transition({ kind: 'unauthenticated' })
    } catch (error) {
      if (revision === this.sessionRevision) this.transition({ kind: 'offline' })
      throw error
    }
  }

  /**
   * Validate the active user-center session before a Host request and return its
   * access token only to Main/Host callers. Concurrent callers share one validation.
   *
   * @param signal Optional Host request cancellation signal.
   * @returns The current validated access token.
   */
  async getAccessToken(signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal)
    const account = this.account
    if (this.view.kind !== 'authenticated' || !account || !this.accessToken) {
      throw new AuthApiError('expired', '请重新登录后继续会话。')
    }
    const revision = this.sessionRevision
    const operation = this.accessTokenValidation ?? this.startAccessTokenValidation(revision, account.userId)
    const token = await this.waitForValidation(operation, signal)
    throwIfAborted(signal)
    this.assertSessionRevision(revision)
    if (!this.account || this.account.userId !== account.userId) {
      throw new AuthApiError('expired', '登录账号已变化，请重新登录。')
    }
    return token
  }

  private startAccessTokenValidation(revision: number, userId: string): Promise<string> {
    const operation = this.validateAccessToken(revision, userId)
    this.accessTokenValidation = operation
    void operation.finally(() => {
      if (this.accessTokenValidation === operation) this.accessTokenValidation = undefined
    }).catch(() => undefined)
    return operation
  }

  private async waitForValidation(operation: Promise<string>, signal: AbortSignal | undefined): Promise<string> {
    if (!signal) return operation
    return new Promise<string>((resolve, reject) => {
      const abort = () =>{  reject(new AuthSessionAbortError()) }
      signal.addEventListener('abort', abort, { once: true })
      void operation.then(
        (token) => {
          signal.removeEventListener('abort', abort)
          resolve(token)
        },
        (error: unknown) => {
          signal.removeEventListener('abort', abort)
          reject(error instanceof Error ? error : new Error('Access token validation failed.'))
        },
      )
    })
  }

  private async validateAccessToken(revision: number, userId: string): Promise<string> {
    try {
      const account = await this.currentUserWithOneRefresh(revision)
      this.assertSessionRevision(revision)
      if (account.userId !== userId || !this.accessToken || this.view.kind !== 'authenticated') {
        throw new AuthApiError('expired', '登录账号已变化，请重新登录。')
      }
      return this.accessToken
    } catch (error) {
      if (revision === this.sessionRevision && error instanceof AuthApiError && error.kind === 'expired') {
        ++this.sessionRevision
        this.account = undefined
        this.setAccessToken(undefined)
        this.transition({ kind: 'expired' })
        await this.clearCredentials().catch(() => undefined)
      }
      throw error
    }
  }

  private async performRestore(): Promise<void> {
    const revision = ++this.sessionRevision
    this.accessTokenValidation = undefined
    this.transition({ kind: 'restoring' })
    let token: string | undefined
    try {
      token = await this.credentials.load()
    } catch {
      if (revision === this.sessionRevision) this.transition({ kind: 'offline' })
      return
    }
    if (revision !== this.sessionRevision) return
    if (!token) {
      this.account = undefined
      this.setAccessToken(undefined)
      this.transition({ kind: 'unauthenticated' })
      return
    }
    this.setAccessToken(token)
    try {
      const account = await this.currentUserWithOneRefresh(revision)
      if (revision !== this.sessionRevision) return
      this.account = account
      this.transition({ kind: 'authenticated', account: account.summary })
    } catch (error) {
      if (revision !== this.sessionRevision) return
      this.account = undefined
      if (error instanceof AuthApiError && error.kind === 'expired') {
        this.setAccessToken(undefined)
        await this.clearCredentials()
        if (revision !== this.sessionRevision) return
        this.transition({ kind: 'expired' })
        return
      }
      this.transition({ kind: 'offline' })
    }
  }

  private async login(
    method: 'sms' | 'password',
    authenticate: () => Promise<AccessTokenResult>,
  ): Promise<AuthCommandResult> {
    if (this.signOutOperation) {
      return { ok: false, reason: 'service-error', message: '正在退出登录，请稍后重试。' }
    }
    const revision = ++this.sessionRevision
    this.accessTokenValidation = undefined
    this.transition({ kind: 'authenticating', method })
    try {
      const result = await authenticate()
      this.assertSessionRevision(revision)
      this.setAccessToken(result.accessToken)
      const account = await this.api.currentUser()
      this.assertSessionRevision(revision)
      this.account = account
      await this.persistAccessToken(result.accessToken, revision)
      this.assertSessionRevision(revision)
      this.transition({ kind: 'authenticated', account: account.summary })
      return { ok: true }
    } catch (error) {
      if (revision !== this.sessionRevision) return commandFailure(error)
      this.account = undefined
      if (error instanceof AuthApiError && error.kind === 'expired') {
        this.setAccessToken(undefined)
        await this.clearCredentials()
        if (revision === this.sessionRevision) this.transition({ kind: 'expired' })
      } else if (error instanceof AuthApiError && error.kind === 'offline') {
        this.transition({ kind: 'offline' })
      } else {
        this.setAccessToken(undefined)
        await this.clearCredentials().catch(() => undefined)
        if (revision === this.sessionRevision) this.transition({ kind: 'unauthenticated' })
      }
      return commandFailure(error)
    }
  }

  private async currentUserWithOneRefresh(revision: number): Promise<AuthenticatedAccount> {
    try {
      return await this.api.currentUser()
    } catch (error) {
      if (!(error instanceof AuthApiError) || error.kind !== 'expired') throw error
      this.assertSessionRevision(revision)
      const refreshed = await this.api.refresh()
      this.assertSessionRevision(revision)
      this.setAccessToken(refreshed.accessToken)
      await this.persistAccessToken(refreshed.accessToken, revision)
      this.assertSessionRevision(revision)
      return this.api.currentUser()
    }
  }

  private assertSessionRevision(revision: number): void {
    if (revision !== this.sessionRevision) {
      throw new AuthApiError('expired', '登录已变化，请重试。')
    }
  }

  private setAccessToken(token: string | undefined): void {
    this.accessToken = token
    try {
      this.onAccessTokenChanged(token)
    } catch (error) {
      this.notifyObserverFailure(error)
    }
  }

  private enqueueCredentialWrite(write: () => Promise<void>): Promise<void> {
    const operation = this.credentialWrites.then(write)
    this.credentialWrites = operation.catch(() => undefined)
    return operation
  }

  private clearCredentials(): Promise<void> {
    return this.enqueueCredentialWrite(() => this.credentials.clear())
  }

  private async persistAccessToken(token: string, revision: number): Promise<void> {
    try {
      await this.enqueueCredentialWrite(async () => {
        if (revision === this.sessionRevision) await this.credentials.save(token)
      })
    } catch {
      // The active session remains valid when OS credential storage is unavailable.
    }
  }

  private transition(view: SessionView): void {
    this.view = view
    for (const listener of this.listeners) {
      try {
        listener(view)
      } catch (error) {
        this.notifyObserverFailure(error)
      }
    }
  }

  private notifyObserverFailure(error: unknown): void {
    try {
      this.reportObserverFailure(error)
    } catch {
      // Observer diagnostics cannot change authentication cleanup semantics.
    }
  }
}
