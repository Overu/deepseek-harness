import { registerCanvasRoute, type CanvasActivities } from './activities.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { CanvasAgentError, MAX_MESSAGE_BYTES } from '../shared/canvas-agent-protocol.ts'
import { assertBridgeId, OWNERSHIP_PROTOCOL, parseServiceClientEvent, type ServiceHostEvent } from '../shared/canvas-bridge-protocol.ts'
import type { CanvasBridgeRegistry } from './canvas-bridge.ts'
const PREFIX = '/desktop-canvas/api/bridge'
interface BrowserConnection { requestRejection(request: IncomingMessage): 401 | 403 | undefined }
interface BridgeHandler { (req: IncomingMessage, res: ServerResponse): Promise<void>
  close(): void }
function send(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body))
}
function originOf(req: IncomingMessage): string | undefined {
  const claimed = req.headers['x-canvas-bridge-origin'], actual = req.headers.origin
  if (typeof claimed !== 'string' || (actual !== undefined && actual !== claimed)) return
  // Desktop Main authenticates and forwards only the application origin. The
  // connection admission above remains mandatory before accepting this value.
  if (claimed === 'dsh-app://app') return claimed
  try { const url = new URL(claimed); return ['http:', 'https:'].includes(url.protocol) &&
 url.origin === claimed ? claimed : undefined } catch { return }
}
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let length = 0
  for await (const chunk of req) {
    const value: unknown = chunk
    if (!(value instanceof Uint8Array) && typeof value !== 'string') throw new Error('Invalid HTTP body bytes')
    const bytes = Buffer.from(value); length += bytes.length
    if (length > MAX_MESSAGE_BYTES) throw new CanvasAgentError('BRIDGE_OVERLOADED', '桥消息过大'); chunks.push(bytes) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export function bridgeHandler(connection: BrowserConnection, bridge: CanvasBridgeRegistry): BridgeHandler {
  const streams = new Set<() => void>()
  let closed = false
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const rejection = connection.requestRejection(req)
    if (rejection !== undefined) { send(res, rejection, { error: 'browser session required' }); return }
    if (closed) { send(res, 503, { error: 'canvas bridge unavailable' }); return }
    const url = new URL(req.url ?? '/', 'http://localhost'), origin = originOf(req)
    if (!origin) { send(res, 403, { error: 'registered browser origin required' }); return }
    if ((req.url ?? '/').split(/[?#]/, 1)[0] !== url.pathname || url.search || !['/attach', '/events',
      '/client-event', '/detach'].some(path => url.pathname === PREFIX + path)) { send(res, 404, {
      error: 'unknown bridge route' }); return }
    const streaming = url.pathname === PREFIX + '/events'
    if (req.method !== (streaming ? 'GET' : 'POST')) { send(res, 405, { error: streaming ? 'GET required' : 'POST required' }); return }
    const key = req.headers['x-canvas-bridge-key']
    if (url.pathname !== PREFIX + '/attach' && (typeof key !== 'string' || !bridge.checkClient(key, origin))) {
      send(res, 403, { error: 'bridge registration required' }); return }
    if (streaming) {
      const queue: string[] = []; let buffered = 0, blocked = false, stopped = false; let release: (() => void) | undefined
      const cleanup = () => { if (stopped) return; stopped = true; clearInterval(heartbeat); res.off('drain', drain)
        streams.delete(stop); release?.(); queue.length = 0 }
      const stop = () => { cleanup(); res.destroy() }
      const write = (text: string) => {
        if (stopped || res.destroyed) throw new Error('stream closed')
        const bytes = Buffer.byteLength(text)
        if (queue.length >= 32 || buffered + bytes + res.writableLength > 8 * 1024 * 1024) { res.destroy()
          throw new CanvasAgentError('BRIDGE_OVERLOADED', 'SSE 缓冲已达上限') }
        if (blocked) { queue.push(text); buffered += bytes } else blocked = !res.write(text)
      }
      const drain = () => { blocked = false; try { while (queue.length && !blocked) { const text = queue.shift()
        if (text === undefined) break
        buffered -= Buffer.byteLength(text); blocked = !res.write(text) } } catch { cleanup(); res.destroy() } }
      const heartbeat = setInterval(() => { try { write(': keepalive\n\n') } catch { cleanup(); res.destroy() } }, 15000)
      heartbeat.unref()
      streams.add(stop); res.once('close', cleanup); res.on('drain', drain)
      try {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
        release = bridge.connectStream(key as string, origin, (event: ServiceHostEvent) =>{
          write('data: ' + JSON.stringify(event) + '\n\n') })
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Connecting the stream can synchronously close it.
        if (stopped) release()
      } catch { cleanup(); if (!res.headersSent) send(res, 409, { error: 'bridge stream unavailable' }); else res.end() }
      return
    }
    if (!/^application\/json(?:\s*;|$)/i.test((req.headers['content-type'] ?? ''))) { send(res, 415, {
      error: 'JSON required' }); return }
    if (Number(req.headers['content-length']) > MAX_MESSAGE_BYTES) { send(res, 413, { error: 'bridge message too large' }); return }
    try {
      const input = await body(req)
      if (url.pathname === PREFIX + '/attach') {
        if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['clientId', 'protocolVersion',
          'ownershipProtocol'].includes(key)) || Reflect.get(input, 'protocolVersion') !== 4) throw new Error('invalid registration')
        const fields = input as Record<string, unknown>
        const ownership = fields.ownershipProtocol
        if (ownership !== undefined && ownership !== OWNERSHIP_PROTOCOL) throw new Error('invalid ownership protocol')
        const clientId = fields.clientId; assertBridgeId(clientId); send(res, 200,
          bridge.attachClient(origin, clientId, ownership))
      } else if (url.pathname === PREFIX + '/detach') {
        if (!input || typeof input !== 'object' || Object.keys(input).length) throw new Error('invalid detach')
        bridge.detachClient(key as string, origin); send(res, 200, { ok: true })
      } else { bridge.acceptClientEvent(key as string, origin, parseServiceClientEvent(input)); send(res, 200, { ok: true }) }
    } catch (cause) {
      if (!res.destroyed) send(res, cause instanceof CanvasAgentError &&
 cause.code === 'BRIDGE_OVERLOADED' ? 413 : 400, { error: 'invalid bridge event',
        ...(cause instanceof CanvasAgentError ? { code: cause.code } : {}) })
    }
  }
  return Object.assign(handler, { close() { if (closed) return; closed = true; for (const stop of [...streams]) stop() } })
}
export function registerBridgeRoute(ctx: Context, bridge: CanvasBridgeRegistry, activities?: CanvasActivities): void {
  const handler = bridgeHandler(Reflect.get(ctx, 'connection') as BrowserConnection, bridge)
  ctx.effect(() => registerCanvasRoute(ctx, activities, { kind: 'prefix', path: PREFIX, handler }), 'desktop-canvas: bridge route')
  ctx.effect(() => () =>{  handler.close() }, 'desktop-canvas: bridge streams')
}
