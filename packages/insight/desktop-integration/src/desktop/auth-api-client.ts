/** Insight user-center requests used only by the desktop main process. */
import type {
  AccountSummary,
  CaptchaView,
  PasswordLoginInput,
  SmsLoginInput,
} from '../shared/auth-contracts.ts'
import type { AuthEnvironmentConfig } from './auth-environment.ts'

/** Fetch implementation supplied by the isolated desktop authentication session. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

interface ApiEnvelope {
  code?: string | number
  message?: string
  data?: unknown
  body?: unknown
}

interface LoginPayload {
  accessToken: string
  accessTokenExpiredSeconds?: number
}

/** Main-only account identity paired with its renderer-safe projection. */
export interface AuthenticatedAccount {
  userId: string
  summary: AccountSummary
}

/** Authentication API failure classified without parsing localized messages. */
export class AuthApiError extends Error {
  constructor(
    readonly kind: 'expired' | 'offline' | 'rejected' | 'service-error',
    message: string,
    readonly code?: string | number,
  ) {
    super(message)
    this.name = 'AuthApiError'
  }
}

/** Hide the middle digits of a phone number shown by the desktop application.
 *
 * @param phone Source phone number.
 * @returns A renderer-safe phone display value.
 */
export function maskPhone(phone: string): string {
  if (!phone) return ''
  if (phone.length < 7) return '****'
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

function record(value: unknown): object | undefined {
  return typeof value === 'object' && value !== null ? value : undefined
}

function readString(value: object, key: string): string | undefined {
  const result: unknown = Reflect.get(value, key)
  return typeof result === 'string' ? result : undefined
}

function readStringOrNumber(value: object, key: string): string | number | undefined {
  const result: unknown = Reflect.get(value, key)
  return typeof result === 'string' || typeof result === 'number' ? result : undefined
}

function stableAccountId(value: unknown): string | undefined {
  if (typeof value === 'string') return value.length > 0 ? value : undefined
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  return undefined
}

function apiEnvelope(value: unknown): ApiEnvelope {
  const item = record(value)
  if (!item) return {}
  const code = readStringOrNumber(item, 'code')
  const msg = readString(item, 'msg') ?? readString(item, 'message')
  const data: unknown = Reflect.get(item, 'data')
  const body: unknown = Reflect.get(item, 'body')
  return {
    ...(code === undefined ? {} : { code }),
    ...(msg === undefined ? {} : { message: msg }),
    ...(data === undefined ? {} : { data }),
    ...(body === undefined ? {} : { body }),
  }
}

function responsePayload(envelope: ApiEnvelope): unknown {
  return envelope.data ?? envelope.body
}

function isSuccessCode(code: string | number | undefined): boolean {
  return code === 'SUCCESS' || code === 200 || code === 0 || code === '0'
}

function isExpiredCode(code: string | number | undefined): boolean {
  return code === 'USER_SESSION_EXPIRED' || code === 'USER_NOT_LOGIN' || code === -1
}

function messageFrom(envelope: ApiEnvelope, fallback: string): string {
  return envelope.message || fallback
}

function loginPayload(value: unknown): LoginPayload {
  const item = record(value)
  const accessToken = item && readString(item, 'accessToken')
  if (!accessToken) {
    throw new AuthApiError('service-error', '登录服务未返回访问令牌。')
  }
  const accessTokenExpiredSeconds = readStringOrNumber(item, 'accessTokenExpiredSeconds')
  return {
    accessToken,
    ...(typeof accessTokenExpiredSeconds === 'number' ? { accessTokenExpiredSeconds } : {}),
  }
}

function diagnosticCode(error: Error): string | undefined {
  const code: unknown = Reflect.get(error, 'code')
  return typeof code === 'string' && /^(?:ERR_|E)[A-Z_0-9]{2,60}$/u.test(code) ? code : undefined
}

function transportFailure(error: unknown): boolean {
  return error instanceof TypeError || (
    error instanceof Error && (
      /\bnet::ERR_[A-Z_0-9]+\b/u.test(error.message) ||
      error.name === 'AbortError' ||
      error.name === 'TimeoutError'
    )
  )
}

/** Narrow client for the existing Insight account endpoints used by desktop. */
export class AuthApiClient {
  constructor(
    private readonly fetch: FetchLike,
    private readonly environment: AuthEnvironmentConfig,
    private readonly getAccessToken: () => string | undefined,
    private readonly diagnostic: (message: string) => void = () => {},
  ) {}

  /** Request an SMS login code for a phone number.
   *
   * @param phone Phone number accepted by the Insight user center.
   * @returns Resolves when the request is accepted; rejects with an {@link AuthApiError} otherwise.
   */
  async sendSmsCode(phone: string): Promise<void> {
    await this.request('/user-server/mobile/getSmsCode', {
      method: 'POST',
      body: { scene: 'LOGIN', phoneNumber: phone },
    })
  }

  /** Fetch a password-login captcha.
   *
   * @returns Captcha fields suitable for the desktop renderer.
   */
  async captcha(): Promise<CaptchaView> {
    const item = record(await this.request('/user-server/captcha/captchaImage', { method: 'GET' }))
    const uuid = item && readString(item, 'uuid')
    const rawImage = item && (readString(item, 'src') ?? readString(item, 'img'))
    if (!uuid || !rawImage) {
      throw new AuthApiError('service-error', '图形验证码服务返回了无效结果。')
    }
    return {
      uuid,
      image: rawImage.startsWith('http') || rawImage.startsWith('data:image')
        ? rawImage
        : `data:image/png;base64,${rawImage}`,
    }
  }

  /** Authenticate an SMS login.
   *
   * @param input Phone number and SMS code.
   * @returns The Main-only access token result.
   */
  async loginSms(input: SmsLoginInput): Promise<LoginPayload> {
    return loginPayload(await this.request('/user-server/loginV3', {
      method: 'POST',
      body: { type: 'PHONE_NUM', info: { phoneNo: input.phone, code: input.code } },
    }))
  }

  /** Authenticate a password login with a captcha.
   *
   * @param input Password and captcha fields.
   * @returns The Main-only access token result.
   */
  async loginPassword(input: PasswordLoginInput): Promise<LoginPayload> {
    return loginPayload(await this.request('/user-server/loginV3', {
      method: 'POST',
      body: {
        type: 'PHONE_PASS',
        info: {
          phoneNo: input.phone,
          password: input.password,
          uuid: input.uuid,
          imgCode: input.imageCode,
        },
      },
    }))
  }

  /** Refresh the current access token.
   *
   * @returns The replacement Main-only access token result.
   */
  async refresh(): Promise<LoginPayload> {
    return loginPayload(await this.request('/user-server/refresh', { method: 'GET' }))
  }

  /** Fetch the authenticated account and its renderer-safe summary.
   *
   * @returns The Main-only stable account identifier and safe summary.
   */
  async currentUser(): Promise<AuthenticatedAccount> {
    const item = record(await this.request('/user-server/getUserDetail', { method: 'GET' }))
    if (!item) throw new AuthApiError('service-error', '用户服务返回了无效结果。')
    const id: unknown = Reflect.get(item, 'id')
    const rawStableId: unknown = id === undefined || id === null ? Reflect.get(item, 'userId') : id
    const userId = stableAccountId(rawStableId)
    if (!userId) {
      throw new AuthApiError('service-error', '用户服务未返回稳定账号标识。')
    }
    const phone = readString(item, 'phoneNo') ?? ''
    const userName = readString(item, 'userName')?.trim()
    const avatarUrl = readString(item, 'avatarUrl')
    return {
      userId,
      summary: {
        displayName: userName || maskPhone(phone),
        ...(avatarUrl ? { avatarUrl } : {}),
        maskedPhone: maskPhone(phone),
      },
    }
  }

  /** Revoke the remote user-center session.
   *
   * @returns Resolves when the server responds to the revocation request.
   */
  async logout(): Promise<void> {
    await this.request('/user-server/logout', { method: 'GET' })
  }

  private async request(
    path: string,
    options: { method: 'GET' | 'POST'; body?: object },
  ): Promise<unknown> {
    const headers = new Headers({
      'accept-language': 'zh_CN',
      extinfo: JSON.stringify({ client_type: 'Desktop' }),
    })
    if (options.body) headers.set('content-type', 'application/json')
    const token = this.getAccessToken()
    if (token) headers.set('token', token)

    let response: Response
    try {
      response = await this.fetch(`${this.environment.baseUrl}${path}`, {
        method: options.method,
        headers,
        credentials: 'include',
        signal: AbortSignal.timeout(10_000),
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      })
    } catch (error) {
      const failure = error instanceof Error ? error : undefined
      this.diagnostic(JSON.stringify({
        origin: new URL(this.environment.baseUrl).origin,
        endpoint: path,
        error: failure && ['TypeError', 'Error', 'AbortError', 'TimeoutError'].includes(failure.name)
          ? failure.name : 'TransportError',
        ...(failure && diagnosticCode(failure) ? { code: diagnosticCode(failure) } : {}),
        ...(failure?.message.match(/\bnet::(ERR_[A-Z_0-9]+)\b/u)?.[1]
          ? { chromiumCode: failure.message.match(/\bnet::(ERR_[A-Z_0-9]+)\b/u)?.[1] }
          : {}),
      }))
      if (transportFailure(error)) throw new AuthApiError('offline', '网络不可用，请检查网络连接。')
      throw new AuthApiError('service-error', '认证服务请求失败。')
    }

    if (!response.ok) this.diagnostic(JSON.stringify({
      origin: new URL(this.environment.baseUrl).origin,
      endpoint: path,
      status: response.status,
    }))

    let envelope: ApiEnvelope
    try {
      const payload: unknown = JSON.parse(await response.text())
      envelope = apiEnvelope(payload)
    } catch {
      throw new AuthApiError(
        response.status === 401 ? 'expired' : 'service-error',
        '认证服务返回了无效响应。',
        response.status,
      )
    }
    if (response.status === 401) {
      throw new AuthApiError('expired', messageFrom(envelope, '登录已失效，请重新登录。'), response.status)
    }
    if (!response.ok) {
      throw new AuthApiError('service-error', messageFrom(envelope, '认证服务暂时不可用。'), response.status)
    }
    if (isSuccessCode(envelope.code)) return responsePayload(envelope)
    if (isExpiredCode(envelope.code)) {
      throw new AuthApiError('expired', messageFrom(envelope, '登录已失效，请重新登录。'), envelope.code ?? response.status)
    }
    throw new AuthApiError(
      'rejected',
      messageFrom(envelope, '认证服务暂时不可用。'),
      envelope.code ?? response.status,
    )
  }
}
