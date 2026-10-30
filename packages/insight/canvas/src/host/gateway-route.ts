import { registerCanvasRoute, type CanvasActivities } from './activities.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { LoginRequiredError } from './account-errors.ts'
import { desktopServiceProfile } from './service-environment.ts'
import { CanvasAssetApiError, createCanvasAssetApi } from './canvas-assets.ts'
import { UPLOAD_LIBRARY_ID, UPLOAD_TYPE } from '../shared/upload/constants.ts'

const PREFIX = '/desktop-canvas/api/legacy'
const MAX_REQUEST_BYTES = 20_000_000
const MAX_RESPONSE_BYTES = 30_000_000
const CANVAS_SERVICE_PREFIXES = [
  '/game-ai-editor-center/api/',
  '/game-ai-editor-center/upload/',
  '/game-ai-editor-center/workflow-tool/',
  '/game-ai-editor-center/upscale/',
  '/material-server/asset/',
  '/order-server/api/cost/',
  '/account-service/api/account/',
] as const

interface BrowserConnection {
  requestRejection(request: IncomingMessage): 401 | 403 | undefined
}

class RequestTooLargeError extends Error {}
class ResponseTooLargeError extends Error {}

function send(res: ServerResponse, status: number, error: string): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify({ error }))
}

async function requestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const value: unknown = chunk
    const bytes = value instanceof Uint8Array ? Buffer.from(value) : typeof value === 'string' ? Buffer.from(value) : undefined
    if (!bytes) throw new Error('Invalid HTTP body bytes')
    total += bytes.length
    if (total > MAX_REQUEST_BYTES) throw new RequestTooLargeError()
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, total)
}

async function responseBody(response: Response): Promise<Buffer> {
  const reader = response.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      const bytes = Buffer.from(value)
      total += bytes.length
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new ResponseTooLargeError()
      }
      chunks.push(bytes)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

/** Proxy canvas business requests to the fixed Gateway using the desktop login. */
export function gatewayHandler(
  connection: BrowserConnection,
  tokenProvider: (signal?: AbortSignal) => Promise<string>,
  transport: typeof fetch = fetch,
) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const rejection = connection.requestRejection(req)
    if (rejection !== undefined) { send(res, rejection, 'browser session required'); return }

    const rawPath = (req.url ?? '/').split(/[?#]/u, 1)[0]
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (rawPath !== url.pathname || !url.pathname.startsWith(`${PREFIX}/`)) {
      send(res, 404, 'unknown canvas API'); return
    }
    const servicePath = url.pathname.slice(PREFIX.length)
    if (!/^\/[A-Za-z0-9._/-]+$/u.test(servicePath)
      || !CANVAS_SERVICE_PREFIXES.some(prefix => servicePath.startsWith(prefix))) {
      send(res, 404, 'unknown canvas API'); return
    }
    const method = req.method
    if (method !== 'GET' && method !== 'POST' && method !== 'PUT') {
      send(res, 405, 'GET, POST or PUT required'); return
    }
    const isUploadCredentials = servicePath === '/game-ai-editor-center/upload/sts/token'
    if (isUploadCredentials && method !== 'POST') { send(res, 405, 'POST required'); return }
    if (isUploadCredentials && url.search) { send(res, 400, 'invalid query'); return }
    if ([...url.searchParams.keys()].some(key => /^(?:token|authorization|access_token)$/iu.test(key))) {
      send(res, 400, 'invalid query'); return
    }

    const contentType = req.headers['content-type']
    if (method !== 'GET' && contentType !== undefined
      && (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/iu.test(contentType))) {
      send(res, 415, 'JSON required'); return
    }
    const length = Number(req.headers['content-length'])
    if (method !== 'GET' && Number.isFinite(length) && length > MAX_REQUEST_BYTES) {
      send(res, 413, 'canvas request too large'); return
    }

    const clientAbort = new AbortController()
    res.once('close', () => { if (!res.writableEnded) clientAbort.abort() })
    const signal = AbortSignal.any([clientAbort.signal, AbortSignal.timeout(30000)])
    try {
      const body = method === 'GET' ? undefined : await requestBody(req)
      signal.throwIfAborted()
      let uploadFileName: string | undefined
      if (isUploadCredentials) {
        let params: unknown
        try { params = JSON.parse(body?.toString('utf8') ?? '') }
        catch { send(res, 400, 'invalid upload request'); return }
        if (!params || typeof params !== 'object' || Array.isArray(params)
          || !('fileName' in params) || typeof params.fileName !== 'string' || !params.fileName.trim()
          || !('libraryId' in params) || params.libraryId !== UPLOAD_LIBRARY_ID
          || !('type' in params) || params.type !== UPLOAD_TYPE) {
          send(res, 400, 'invalid upload request'); return
        }
        uploadFileName = params.fileName
      }
      const profile = desktopServiceProfile()
      const token = await tokenProvider(signal)
      signal.throwIfAborted()
      if (uploadFileName !== undefined) {
        // Resolve the identity with the same token used for STS; never trust an iframe userId.
        const assets = createCanvasAssetApi({ tokenProvider: () => Promise.resolve(token), transport })
        const identity = await assets.getIdentity(signal)
        const credentials = await assets.getUploadCredentials(uploadFileName, identity, signal)
        if (clientAbort.signal.aborted) return
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        res.end(JSON.stringify(credentials))
        return
      }
      const upstream = await transport(`${profile.api}${servicePath}${url.search}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
          origin: profile.web,
          referer: `${profile.web}/`,
          token,
        },
        ...(body === undefined ? {} : { body: body.toString('utf8') }),
        redirect: 'error',
        signal,
      })
      if (clientAbort.signal.aborted) return
      const upstreamType = upstream.headers.get('content-type') ?? ''
      if (!/^application\/(?:json|[a-z0-9._-]+\+json)(?:\s*;|$)/iu.test(upstreamType)) {
        send(res, upstream.ok ? 502 : upstream.status, '画布服务返回了非 JSON 响应')
        return
      }
      const upstreamLength = Number(upstream.headers.get('content-length'))
      if (Number.isFinite(upstreamLength) && upstreamLength > MAX_RESPONSE_BYTES) {
        throw new ResponseTooLargeError()
      }
      const bytes = await responseBody(upstream)
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- The client may disconnect during the awaited read.
      if (clientAbort.signal.aborted) return
      res.writeHead(upstream.status, {
        'content-type': upstreamType,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      res.end(bytes)
    } catch (error) {
      if (clientAbort.signal.aborted || res.destroyed) return
      if (error instanceof LoginRequiredError) { send(res, 401, '请在桌面客户端重新登录'); return }
      if (error instanceof RequestTooLargeError) { send(res, 413, '画布请求过大'); return }
      if (error instanceof ResponseTooLargeError) { send(res, 502, '画布响应过大'); return }
      if (signal.aborted || (error instanceof Error && error.name === 'TimeoutError')) {
        send(res, 504, '画布请求超时'); return
      }
      if (error instanceof CanvasAssetApiError) {
        send(res, error.code === 'AUTH_REQUIRED' ? 401 : 502, error.message); return
      }
      send(res, 502, '画布服务暂时不可用')
    }
  }
}

export function registerGatewayRoute(ctx: Context, tokenProvider: (signal?: AbortSignal) => Promise<string>,
  activities?: CanvasActivities): void {
  const connection = Reflect.get(ctx, 'connection') as BrowserConnection
  ctx.effect(() => registerCanvasRoute(ctx, activities, { kind: 'prefix', path: PREFIX,
    handler: gatewayHandler(connection, tokenProvider) }), 'desktop-canvas: gateway')
}
