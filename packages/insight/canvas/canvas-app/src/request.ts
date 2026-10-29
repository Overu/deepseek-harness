import { AUTH_EXPIRED_EVENT } from './auth-context'

const PREFIX = '/desktop-canvas/api/legacy'
export const CANVAS_LOAD_ERROR_EVENT = 'desktop-canvas-load-error'

export type AgentRequestPhase = 'not_sent' | 'sent_unknown' | 'rejected'
export type RequestConfig = Omit<RequestInit, 'body'> & {
  timeout?: number
  fullUrl?: string
  authRedirect?: 'route' | 'always' | 'never'
  _authRetryCount?: number
  silentError?: boolean
  receiptMode?: 'agent'
  onAuthExpired?: () => void
  onCanvasLoadError?: () => void
}

export type CustomResponse<T = unknown> = {
  code: number | string
  msg: string
  success?: boolean
  traceId?: string
  body?: T
  data?: T
}

export type MyResponse<T = unknown> = Promise<CustomResponse<T>>

export class AuthExpiredError extends Error {
  readonly status = 401
  constructor(message = '请在桌面客户端重新登录', readonly payload?: unknown) {
    super(message)
    this.name = 'AuthExpiredError'
  }
}

function localPath(path: string, config: RequestConfig): string {
  if (config.fullUrl || /^https?:\/\//iu.test(path) || path.startsWith('//')) {
    throw new Error('画布请求必须经桌面客户端转发')
  }
  const parsed = new URL(path.startsWith('/') ? path : `/${path}`, 'http://canvas.local')
  if (parsed.pathname.includes('..') || parsed.pathname.startsWith('//')) {
    throw new Error('画布请求路径无效')
  }
  return `${PREFIX}${parsed.pathname}${parsed.search}`
}

function queryString(data: unknown): string {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && value !== undefined) query.set(key, String(value))
  }
  return query.toString()
}

export async function request<T = any>(url: string, data?: unknown, config: RequestConfig = {}): MyResponse<T> {
  let path = ''
  let requestPhase: AgentRequestPhase = 'not_sent'
  let responseStatus: number | undefined
  try {
    const method = (config.method ?? 'POST').toUpperCase()
    if (method !== 'GET' && method !== 'POST' && method !== 'PUT') throw new Error('画布请求方法不支持')
    if (data instanceof FormData) throw new Error('画布文件上传尚未接入桌面客户端')
    path = localPath(url, config)
    const query = method === 'GET' ? queryString(data) : ''
    const target = query ? `${path}${path.includes('?') ? '&' : '?'}${query}` : path
    const headers = new Headers(config.headers)
    headers.delete('token')
    headers.delete('authorization')
    if (method !== 'GET') headers.set('content-type', 'application/json')
    const timeout = AbortSignal.timeout(config.timeout ?? 30000)
    const signal = config.signal ? AbortSignal.any([config.signal, timeout]) : timeout
    const body = method === 'GET' ? undefined : JSON.stringify(data)
    if (config.receiptMode === 'agent') signal.throwIfAborted()
    requestPhase = 'sent_unknown'
    const response = await fetch(target, {
      method,
      headers,
      credentials: 'same-origin',
      ...(method === 'GET' ? {} : { body }),
      signal,
    })
    responseStatus = response.status
    // Service contexts must revoke cached access even when an auth response is not JSON.
    if ((response.status === 401 || response.status === 403) && config.onAuthExpired) config.onAuthExpired()
    let payload: unknown
    try { payload = await response.json() }
    catch { throw new Error(`画布服务响应无效（HTTP ${response.status}）`) }

    if (response.status === 401) {
      if (!config.onAuthExpired && typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
      throw new AuthExpiredError('请在桌面客户端重新登录', payload)
    }
    if (!response.ok) {
      const details = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {}
      if (response.status < 500 && ((typeof details.code === 'string' && details.code.trim()) || typeof details.code === 'number')
        && !['SUCCESS', '200', '0'].includes(String(details.code))) requestPhase = 'rejected'
      const message = typeof details.msg === 'string' ? details.msg
        : typeof details.error === 'string' ? details.error
        : `画布请求失败（HTTP ${response.status}）`
      throw Object.assign(new Error(message), {
        status: response.status,
        code: details.code,
        raw: payload,
        payload,
      })
    }
    if (typeof payload !== 'object' || payload === null || !('code' in payload)) {
      throw new Error('画布服务响应格式不正确')
    }
    const result = payload as CustomResponse<T>
    if (config.receiptMode === 'agent' && !((typeof result.code === 'string' && result.code.trim()) || (typeof result.code === 'number' && Number.isFinite(result.code)))) {
      throw new Error('画布服务响应 code 不合法')
    }
    if (result.code === 'SUCCESS' || result.code === 200 || String(result.code) === '0') {
      if (path === `${PREFIX}/game-ai-editor-center/api/canvas/get` && result.data == null) {
        throw new Error('画布不存在或无访问权限')
      }
      return result
    }
    if (result.code === -1 || result.code === 'USER_SESSION_EXPIRED' || result.code === 'USER_NOT_LOGIN') {
      requestPhase = 'rejected'
      if (config.onAuthExpired) config.onAuthExpired()
      else if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
      throw new AuthExpiredError('请在桌面客户端重新登录', result)
    }
    if (!config.silentError && result.msg) {
      const { toast } = await import('sonner')
      toast.error(result.msg)
    }
    requestPhase = 'rejected'
    throw result
  } catch (error) {
    if (path === `${PREFIX}/game-ai-editor-center/api/canvas/get`) {
      if (config.onCanvasLoadError) config.onCanvasLoadError()
      else if (typeof window !== 'undefined') window.dispatchEvent(new Event(CANVAS_LOAD_ERROR_EVENT))
    }
    if (config.receiptMode === 'agent') {
      const details = error && typeof error === 'object' ? error as Record<string, unknown> : {}
      const wrapped = error instanceof Error ? error : Object.assign(new Error(typeof details.msg === 'string' ? details.msg : '画布请求失败'), { code: details.code, raw: error })
      throw Object.assign(wrapped, {
        requestPhase: responseStatus === 401 || responseStatus === 403 ? 'rejected' : requestPhase,
        ...(responseStatus === undefined ? {} : { status: responseStatus }),
      })
    }
    throw error
  }
}

export const get = <T = any>(url: string, params?: unknown, config: RequestConfig = {}) =>
  request<T>(url, params, { ...config, method: 'GET' })

export const post = <T = any>(url: string, data?: unknown, config: RequestConfig = {}) =>
  request<T>(url, data, { ...config, method: 'POST' })
