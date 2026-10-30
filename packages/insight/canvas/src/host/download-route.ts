import { registerCanvasRoute, type CanvasActivities } from './activities.ts'
import { lookup as dnsLookup } from 'node:dns/promises'
import type { ClientRequest, IncomingMessage, ServerResponse } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { isIP } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { parseCanvasId, type CanvasId } from '../shared/protocol.ts'
import { CanvasApiError, CanvasHttpError, requestCanvasJson } from './canvas-api.ts'
import { LoginRequiredError } from './account-errors.ts'
import { isFakeAddress, resolvePublicImageHost } from './remote-image-dns.ts'
import { isPublicAddress } from './remote-image-reader.ts'

const PATH = '/desktop-canvas/api/download'
const BODY_LIMIT = 12 * 1024
interface BrowserConnection { requestRejection(request: IncomingMessage): 401 | 403 | undefined }
type Address = { address: string
  family: number }
interface DownloadDependencies {
  readCanvas(id: CanvasId, signal: AbortSignal): Promise<unknown>
  lookup(hostname: string): Promise<Address[]>
  resolvePublic: typeof resolvePublicImageHost
  request(url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void): ClientRequest
  maxBytes: number
  timeoutMs: number
}
class DownloadError extends Error { constructor(readonly status: number) { super('Canvas resource download refused') } }
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' &&
 !Array.isArray(value) ? value as Record<string, unknown> : undefined

function answer(res: ServerResponse, status: number): void {
  if (res.destroyed) return
  if (res.headersSent) { res.destroy(); return }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify({ error: status === 401 ? '请在桌面客户端重新登录' : status === 403 ? '该资源不属于当前可访问画布' :
    status === 413 ? '资源或请求超过下载大小限制' : status === 504 ? '下载超时，请稍后重试' : status === 400 ? '下载参数无效' :
      status === 405 ? '下载仅接受POST请求' : status === 415 ? '下载请求必须使用JSON' : '资源暂时无法下载，请稍后重试' }))
}
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new DownloadError(504)) }
    signal.addEventListener('abort', abort, { once: true })
    void work.then(resolve, reject).finally(() =>{  signal.removeEventListener('abort', abort) })
    if (signal.aborted) abort()
  })
}
function readBody(req: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0
    const cleanup = () => { req.removeListener('data', data); req.removeListener('end', end)
      req.removeListener('error', fail); signal.removeEventListener('abort', abort) }
    const fail = () => { cleanup(); reject(new DownloadError(400)) }
    const abort = () => { cleanup(); req.resume(); reject(new DownloadError(504)) }
    const data = (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > BODY_LIMIT) { cleanup(); req.resume(); reject(new DownloadError(413)) }
      else chunks.push(Buffer.from(chunk))
    }
    const end = () => {
      cleanup()
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(new DownloadError(400)) }
    }
    req.on('data', data); req.once('end', end); req.once('error', fail); signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}
function resourceUrl(value: string): URL {
  try {
    const url = new URL(value), host = url.hostname.replace(/^\[|\]$/gu, '')
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port || !host ||
      /[\u0000-\u0020\u007f]/u.test(value) || isIP(host) && !isPublicAddress(host)) throw new Error()
    return url
  } catch { throw new DownloadError(400) }
}
function authorizeResource(body: unknown, value: string): void {
  const envelope = record(body)
  if (['USER_SESSION_EXPIRED', 'USER_NOT_LOGIN', -1].some(code => code === envelope?.code)) throw new DownloadError(401)
  if (!envelope || envelope.code !== 'SUCCESS') throw new DownloadError(403)
  let graph: unknown
  try { const raw = record(envelope.data)?.data; graph = typeof raw === 'string' ? JSON.parse(raw) : raw } catch {
    throw new DownloadError(502) }
  const nodes = record(graph)?.nodes
  if (!Array.isArray(nodes)) throw new DownloadError(502)
  if (!nodes.some((valueNode) => {
    const node = record(valueNode), data = record(node?.data)
    if (!node || typeof node.type !== 'string' || node.type === 'text' || !data) return false
    if (data.value === value || Array.isArray(data.product) && data.product.some(product => record(product)?.value === value)) return true
    if (node.type !== 'storyboardTool') return false
    const table = record(data.table), columns = table?.columns
    if (!Array.isArray(columns) || !Array.isArray(table?.data)) return false
    return table.data.some(row => columns.some((column) => {
      const field = record(column)?.field, cells = record(row)
      if (typeof field !== 'string' || !field || !cells || !Object.hasOwn(cells, field)) return false
      const cell = record(cells[field])
      return cell && typeof cell.type === 'string' && ['image', 'video', 'audio'].includes(cell.type) && cell.value === value
    }))
  })) throw new DownloadError(403)
}
async function publicAddress(url: URL, deps: DownloadDependencies, signal: AbortSignal): Promise<Address> {
  const host = url.hostname.replace(/^\[|\]$/gu, '')
  let addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await abortable(deps.lookup(host), signal)
  if (!isIP(host) && addresses.length &&
 addresses.every(address => isFakeAddress(address.address))) addresses = await abortable(deps.resolvePublic(host, signal), signal)
  if (!addresses.length || addresses.some(address => isIP(address.address) !== address.family ||
 !isPublicAddress(address.address))) throw new DownloadError(502)
  return addresses[0]
}
async function writeChunk(res: ServerResponse, chunk: Buffer, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  if (!res.write(chunk)) await new Promise<void>((resolve, reject) => {
    const cleanup = () => { res.removeListener('drain', drain); res.removeListener('close', closed)
      signal.removeEventListener('abort', closed) }
    const drain = () => { cleanup(); resolve() }
    const closed = () => { cleanup(); reject(new DownloadError(502)) }
    res.once('drain', drain); res.once('close', closed); signal.addEventListener('abort', closed, { once: true })
    if (signal.aborted || res.destroyed) closed()
  })
}
async function streamResource(url: URL, address: Address, deps: DownloadDependencies, res: ServerResponse,
  signal: AbortSignal): Promise<void> {
  let request: ClientRequest | undefined, response: IncomingMessage | undefined
  const abort = () => { response?.destroy(); request?.destroy() }
  const failed = () => { response?.destroy() }
  signal.addEventListener('abort', abort, { once: true })
  try {
    response = await new Promise<IncomingMessage>((resolve, reject) => {
      request = deps.request(url, { method: 'GET', agent: false, family: address.family, rejectUnauthorized: true,
        ...(isIP(url.hostname.replace(/^\[|\]$/gu, '')) ? {} : { servername: url.hostname }),
        lookup: (_hostname, _options, callback) =>{  callback(null, address.address, address.family) }, headers: {
          accept: '*/*' } }, resolve)
      request.once('error', () =>{  reject(new DownloadError(502)) }); request.on('error', failed); request.end()
      if (signal.aborted) { abort(); reject(new DownloadError(504)) }
    })
    const type = (response.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
    if (response.statusCode !== 200 || type === 'text/html' || type === 'application/xhtml+xml' ||
 type === 'application/json' || type === 'application/xml' || type === 'text/xml') throw new DownloadError(502)
    const rawLength = response.headers['content-length']
    const length = rawLength === undefined ? undefined : Number(rawLength)
    if (length !== undefined && (!/^\d+$/u.test(String(rawLength)) || !Number.isSafeInteger(length) ||
 length <= 0)) throw new DownloadError(502)
    if (length !== undefined && length > deps.maxBytes) throw new DownloadError(413)
    if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw new DownloadError(502)
    let bytes = 0, started = false, prefix = Buffer.alloc(0)
    const start = async () => {
      if (/^\s*(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/iu.test(prefix.subarray(0,
        512).toString('utf8'))) throw new DownloadError(502)
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store',
        'content-disposition': 'attachment', 'x-content-type-options': 'nosniff',
        ...(length === undefined ? {} : { 'content-length': length }) })
      started = true; await writeChunk(res, prefix, signal); prefix = Buffer.alloc(0)
    }
    for await (const value of response) {
      const input: unknown = value
      if (!(input instanceof Uint8Array)) throw new DownloadError(502)
      const chunk = Buffer.from(input); bytes += chunk.length
      if (bytes > deps.maxBytes) throw new DownloadError(413)
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- The start callback updates this state.
      if (!started) { prefix = Buffer.concat([prefix, chunk]); if (prefix.length >= 512) await start() }
      else await writeChunk(res, chunk, signal)
    }
    if (bytes === 0 || length !== undefined && bytes !== length) throw new DownloadError(502)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- The start callback updates this state.
    if (!started) await start()
    res.end()
  } finally {
    signal.removeEventListener('abort', abort); request?.removeListener('error', failed); abort()
  }
}

/** Download only persisted resources from a canvas authorized by the current desktop identity. */
export function downloadHandler(connection: BrowserConnection, overrides: Pick<DownloadDependencies,
  'readCanvas'> & Partial<DownloadDependencies>) {
  const deps: DownloadDependencies = { lookup: hostname => dnsLookup(hostname, { all: true, order: 'verbatim' }),
    resolvePublic: resolvePublicImageHost,
    request: httpsRequest, maxBytes: 512 * 1024 * 1024, timeoutMs: 5 * 60 * 1000, ...overrides }
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const rejection = connection.requestRejection(req)
    if (rejection !== undefined) { req.resume(); answer(res, rejection); return }
    if (req.method !== 'POST') { req.resume(); answer(res, 405); return }
    if ((req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      req.resume(); answer(res, 415); return }
    if (Number(req.headers['content-length']) > BODY_LIMIT) { req.resume(); answer(res, 413); return }
    const controller = new AbortController(), timeout = setTimeout(() =>{  controller.abort() }, deps.timeoutMs)
    timeout.unref()
    const closed = () =>{  controller.abort() }
    res.once('close', closed); req.once('aborted', closed)
    try {
      const body = record(await readBody(req, controller.signal)), id = parseCanvasId(body?.canvasId)
      if (!body || Object.keys(body).length !== 2 || !Object.hasOwn(body, 'canvasId') || !Object.hasOwn(body, 'url') ||
        !id || typeof body.url !== 'string' || !body.url || body.url.length > 8192) throw new DownloadError(400)
      const url = resourceUrl(body.url)
      authorizeResource(await abortable(deps.readCanvas(id, controller.signal), controller.signal), body.url)
      await streamResource(url, await publicAddress(url, deps, controller.signal), deps, res, controller.signal)
    } catch (error) {
      const status = controller.signal.aborted ? 504 : error instanceof DownloadError ? error.status
        : error instanceof LoginRequiredError ||
        error instanceof CanvasApiError && error.code === 'AUTH_REQUIRED' ? 401 : error instanceof CanvasHttpError &&
 [401, 403, 404, 429].includes(error.status) ? error.status : 502
      answer(res, status)
    } finally {
      clearTimeout(timeout); res.removeListener('close', closed); req.removeListener('aborted', closed); controller.abort()
    }
  }
}

export function registerDownloadRoute(ctx: Context, tokenProvider: (signal?: AbortSignal) => Promise<string>,
  activities?: CanvasActivities): void {
  const connection = Reflect.get(ctx, 'connection') as BrowserConnection
  ctx.effect(() => registerCanvasRoute(ctx, activities, { kind: 'exact', path: PATH,
    handler: downloadHandler(connection, { readCanvas: (id, signal) => requestCanvasJson('get', { id }, signal, {
      tokenProvider }) }) }), 'desktop-canvas: download')
}
