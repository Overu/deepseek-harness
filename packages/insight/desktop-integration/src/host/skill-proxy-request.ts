/** Authenticated transport for the local skill proxy. */
import { InsightAccountAccessError } from './account-service.ts'

/** Stable errors the local proxy may expose to a skill process. */
export class InsightSkillProxyError extends Error {
  /**
   * @param status - HTTP status safe for the local client.
   * @param code - Stable non-sensitive error code.
   * @param options - Optional internal cause, never returned to the client.
   */
  constructor(readonly status: number, readonly code: string, options?: ErrorOptions) {
    super(code, options)
    this.name = 'InsightSkillProxyError'
  }
}

/** Host-only account capability used for one outbound proxy call. */
export interface InsightSkillProxyAccount {
  /** Return the current access token, cancelling the Main request with the caller. */
  getAccessToken(signal?: AbortSignal): Promise<string>
}

/** Send one protocol-validated skill proxy request without replaying it. */
export type InsightSkillProxyRequest = (path: string, init: RequestInit) => Promise<Response>

/** Read only a bounded structured upstream failure without returning its body to local callers. */
async function proxyErrorCode(response: Response): Promise<string | undefined> {
  const reader = response.body?.getReader()
  if (reader === undefined) return undefined
  try {
    const chunks: Uint8Array[] = []
    let bytes = 0
    while (true) {
      const item = await reader.read()
      if (item.done) break
      bytes += item.value.byteLength
      if (bytes > 16 * 1024) return undefined
      chunks.push(item.value)
    }
    const body: unknown = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)))
    const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : undefined
    const nested = typeof record?.error === 'object' && record.error !== null ? record.error as Record<string, unknown> : undefined
    const detail = typeof record?.detail === 'object' && record.detail !== null ? record.detail as Record<string, unknown> : undefined
    const code = record?.code ?? nested?.code ?? detail?.code
    return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/u.test(code) ? code : undefined
  } catch {
    return undefined
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

/** Append one validated service path without discarding a deployment base path. */
function serviceUrl(base: URL, path: string): string {
  const result = new URL(base.origin)
  result.pathname = `${base.pathname.replace(/\/+$/u, '')}${path}`
  return result.href
}

/** Build the fixed service-plane request function without retaining account tokens. */
export function createInsightSkillProxyRequest(
  baseUrl: string,
  account: InsightSkillProxyAccount,
  transport: typeof fetch = fetch,
): InsightSkillProxyRequest {
  const base = new URL(baseUrl)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new Error('Insight skill proxy URL must be an HTTPS service base')
  }
  return async (path, init) => {
    if (!/^\/api\/skill-proxy\/[a-z][a-z0-9-]{0,63}$/u.test(path) || init.method !== 'POST') {
      throw new InsightSkillProxyError(400, 'INVALID_PROXY_REQUEST')
    }
    let token: string
    try {
      token = await account.getAccessToken(init.signal ?? undefined)
    } catch (error) {
      if (init.signal?.aborted) {
        throw new InsightSkillProxyError(503, 'SKILL_PROXY_NOT_SUBMITTED', { cause: error })
      }
      if (error instanceof InsightAccountAccessError && ['expired', 'disposed'].includes(error.reason)) {
        throw new InsightSkillProxyError(401, 'LOGIN_REQUIRED')
      }
      throw new InsightSkillProxyError(503, 'SKILL_PROXY_AUTH_UNAVAILABLE', { cause: error })
    }
    if (!token) throw new InsightSkillProxyError(401, 'LOGIN_REQUIRED')
    if (init.signal?.aborted) {
      throw new InsightSkillProxyError(503, 'SKILL_PROXY_NOT_SUBMITTED', { cause: init.signal.reason })
    }
    let response: Response
    try {
      response = await transport(serviceUrl(base, path), {
        method: 'POST',
        ...(init.body === undefined ? {} : { body: init.body }),
        ...(init.signal === undefined ? {} : { signal: init.signal }),
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
          token,
          authorization: `Bearer ${token}`,
        },
      })
    } catch (error) {
      // fetch() may have transmitted the paid operation before reporting a
      // disconnect. This transport is deliberately never retried.
      throw new InsightSkillProxyError(502, 'SKILL_PROXY_OUTCOME_UNKNOWN', { cause: error })
    }
    if (!response.ok || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
      const code = await proxyErrorCode(response)
      if (response.status === 401 || code === 'USER_NOT_LOGIN' || code === 'LOGIN_REQUIRED') {
        throw new InsightSkillProxyError(401, 'LOGIN_REQUIRED')
      }
      const safe = code !== undefined && /^(SKILL_|INVALID_|CLIENT_|MEDIA_|MESSAGES_|SIGNED_)[A-Z0-9_]{1,70}$/u.test(code)
      throw new InsightSkillProxyError(response.ok ? 502 : response.status,
        safe ? code : response.ok ? 'SKILL_PROXY_PROTOCOL_MISMATCH' : 'SKILL_PROXY_FAILED')
    }
    return response
  }
}
