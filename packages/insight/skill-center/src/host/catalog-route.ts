/** Authenticated, read-only skill catalogue forwarding owned by skill center. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { desktopServiceEnvironment, InsightAccountAccessError } from '@insight-ai/desktop-integration/host'
import type { Config } from '../config.ts'
import { SKILL_CATALOG_PATH, SKILL_CATEGORIES_PATH } from '../shared/catalog-api.ts'

/** Inputs needed by the authenticated read-only catalogue route. */
interface CatalogRouteDependencies {
  readonly connection: Pick<HostConnectionHandle, 'requestRejection'>
  readonly token: (signal: AbortSignal) => Promise<string>
  readonly register: (route: WebRoute) => () => void
  readonly gatewayOrigin: string
  readonly timeoutMs: number
  readonly maxResponseBytes: number
  readonly transport: typeof fetch
}

/** Send a fixed non-sensitive error and prevent caching of account-scoped data. */
function fail(response: ServerResponse, status: number, code: string): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify({ code }))
}

/** Validate supported catalogue requests before acquiring account credentials. */
function upstreamPath(request: IncomingMessage): string | undefined {
  const rawUrl = request.url ?? ''
  const rawPath = rawUrl.split(/[?#]/u, 1)[0]
  let url: URL
  try { url = new URL(rawUrl, 'http://localhost') } catch { return undefined }
  if (rawPath !== url.pathname) return undefined
  if (url.pathname === SKILL_CATEGORIES_PATH) {
    if ([...url.searchParams.keys()].length !== 1 || url.searchParams.get('businessChannels') !== 'A') return undefined
    return '/game-ai-editor-center/api/skill-categories?businessChannels=A'
  }
  if (url.pathname !== SKILL_CATALOG_PATH) return undefined
  const expected = ['businessChannel', 'source', 'page', 'pageSize']
  if ([...url.searchParams.keys()].length !== expected.length
    || expected.some(key => url.searchParams.getAll(key).length !== 1)
    || url.searchParams.get('businessChannel') !== 'A') return undefined
  const page = url.searchParams.get('page') ?? ''
  const pageSize = url.searchParams.get('pageSize') ?? ''
  if (url.searchParams.get('source') !== 'OFFICIAL'
    || !/^[1-9]\d*$/u.test(page) || Number(page) > 10000
    || !/^[1-9]\d*$/u.test(pageSize) || Number(pageSize) > 50) return undefined
  return `/game-ai-editor-center/api/skills${url.search}`
}

/** Raised when an upstream catalogue page exceeds the configured budget. */
class ResponseTooLargeError extends Error {}

/** Read a response within the configured byte budget and release its stream. */
async function readResponse(response: Response, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel()
    throw new ResponseTooLargeError()
  }
  const reader = response.body?.getReader()
  if (reader === undefined) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let size = 0
  let complete = false
  const cancel = (): void => { void reader.cancel().catch(() => { /* cancellation can race a completed stream */ }) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    signal.throwIfAborted()
    for (;;) {
      const item = await reader.read()
      signal.throwIfAborted()
      if (item.done) { complete = true; break }
      size += item.value.byteLength
      if (size > maxBytes) throw new ResponseTooLargeError()
      chunks.push(item.value)
    }
    return Buffer.concat(chunks, size)
  } finally {
    signal.removeEventListener('abort', cancel)
    if (!complete) await reader.cancel().catch(() => { /* the transport may already have closed */ })
    reader.releaseLock()
  }
}

/**
 * Register and own the accepted requests for the catalogue route.
 * @param dependencies - Account, browser admission, fixed destination, and request limits.
 * @returns A disposer that stops admission, cancels requests, and waits for them to settle.
 */
export function startSkillCatalogRoute(dependencies: CatalogRouteDependencies): () => Promise<void> {
  const lifetime = new AbortController()
  const pending = new Set<Promise<void>>()
  const responses = new Set<ServerResponse>()
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const rejection = dependencies.connection.requestRejection(request)
    if (rejection !== undefined) { fail(response, rejection, 'BROWSER_SESSION_REQUIRED'); return }
    if (request.method !== 'GET') { fail(response, 405, 'METHOD_NOT_ALLOWED'); return }
    const path = upstreamPath(request)
    if (path === undefined) { fail(response, 400, 'INVALID_CATALOG_REQUEST'); return }
    const client = new AbortController()
    const onClose = (): void => { if (!response.writableEnded) client.abort() }
    response.once('close', onClose)
    const timeout = AbortSignal.timeout(dependencies.timeoutMs)
    const signal = AbortSignal.any([lifetime.signal, client.signal, timeout])
    try {
      const token = await dependencies.token(signal)
      signal.throwIfAborted()
      const upstream = await dependencies.transport(`${dependencies.gatewayOrigin}${path}`, {
        method: 'GET', headers: { accept: 'application/json', token }, redirect: 'error', signal,
      })
      if (!upstream.ok) {
        await upstream.body?.cancel()
        signal.throwIfAborted()
        fail(response, upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502, 'CATALOG_UPSTREAM_FAILED')
        return
      }
      if (!/^application\/(?:json|[a-z0-9._-]+\+json)(?:\s*;|$)/iu.test(upstream.headers.get('content-type') ?? '')) {
        await upstream.body?.cancel()
        throw new Error('Invalid catalogue content type')
      }
      const body = await readResponse(upstream, dependencies.maxResponseBytes, signal)
      signal.throwIfAborted()
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      response.end(body)
    } catch (error) {
      if (client.signal.aborted || lifetime.signal.aborted || response.destroyed) return
      if (error instanceof InsightAccountAccessError && error.reason === 'expired') {
        fail(response, 401, 'LOGIN_REQUIRED')
      } else if (timeout.aborted) {
        fail(response, 504, 'CATALOG_TIMEOUT')
      } else {
        fail(response, 502, 'CATALOG_UNAVAILABLE')
      }
    } finally {
      response.removeListener('close', onClose)
    }
  }
  const routeHandler: WebRoute['handler'] = async (request, response) => {
    if (lifetime.signal.aborted) { fail(response, 503, 'CATALOG_UNAVAILABLE'); return }
    responses.add(response)
    const work = handle(request, response)
    pending.add(work)
    try { await work } finally { pending.delete(work); responses.delete(response) }
  }
  const releaseCatalog = dependencies.register({ kind: 'prefix', path: SKILL_CATALOG_PATH, handler: routeHandler })
  let releaseCategories: () => void
  try {
    releaseCategories = dependencies.register({ kind: 'prefix', path: SKILL_CATEGORIES_PATH, handler: routeHandler })
  } catch (error) {
    releaseCatalog()
    throw error
  }
  let disposal: Promise<void> | undefined
  return () => {
    disposal ??= (async () => {
      try { releaseCategories() } finally {
        try { releaseCatalog() } finally {
          lifetime.abort()
          for (const response of responses) response.destroy()
          await Promise.allSettled([...pending])
        }
      }
    })()
    return disposal
  }
}

/**
 * Register the skill-center API using the current desktop account and service environment.
 * @param ctx - Host with authenticated browser, account, and web-server services.
 * @param config - Validated catalogue request and response limits.
 */
export function registerSkillCatalogRoute(ctx: Context, config: Config): void {
  const environment = process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT
  if (environment !== 'test' && environment !== 'production') throw new Error('Invalid Insight service environment')
  ctx.effect(() => startSkillCatalogRoute({
    connection: ctx.connection,
    token: signal => ctx.insightAccount.getAccessToken(signal),
    register: route => ctx.webServer.register(route),
    gatewayOrigin: desktopServiceEnvironment(environment).gatewayOrigin,
    timeoutMs: config.catalogRequestTimeoutMs,
    maxResponseBytes: config.catalogMaxResponseBytes,
    transport: fetch,
  }), 'insight-skill-center: catalogue API')
}
