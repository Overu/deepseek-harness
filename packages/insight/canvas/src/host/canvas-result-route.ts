import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session-query'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { CANVAS_RESULT_ROUTE, type CanvasResultEvent, type CanvasResultSource } from '../shared/canvas-result-source.ts'
import { CanvasResultCursorError, type CanvasResultStore } from './canvas-result-store.ts'

interface BrowserConnection { requestRejection(request: IncomingMessage): 401 | 403 | undefined }
interface SessionCut {
  header: { id: string; createdAt: number }
  events: readonly { type: string; seq: number; data: unknown }[]
  [Symbol.dispose](): void
}
interface SessionReader { observeSession(id: SessionId, options: { signal: AbortSignal; projectionMode: 'none' }): Promise<SessionCut> }
interface ResultHandler { (req: IncomingMessage, res: ServerResponse): Promise<void>; close(): void }
const MAX_STREAMS = 32
const MAX_BUFFER_BYTES = 8 * 1024 * 1024
function send(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(body))
}
function queryOf(url: URL): { sessionId: string; calls?: Set<string>; after?: string } {
  if ([...url.searchParams.keys()].some(key => !['s', 'calls', 'after'].includes(key))
    || ['s', 'calls', 'after'].some(key => url.searchParams.getAll(key).length > 1)) throw new Error('invalid result query')
  const sessionId = url.searchParams.get('s')
  if (!sessionId || sessionId.trim() !== sessionId || sessionId.length > 200) throw new Error('invalid result session')
  const rawCalls = url.searchParams.get('calls'), after = url.searchParams.get('after') ?? undefined
  if (after !== undefined && !/^[A-Za-z0-9_-]{1,200}$/.test(after)) throw new Error('invalid result cursor')
  let calls: Set<string> | undefined
  if (rawCalls !== null) {
    const list: unknown = JSON.parse(rawCalls)
    if (!Array.isArray(list) || list.length === 0 || list.length > 64 || !list.every(value => typeof value === 'string' && value.length > 0 && value.length <= 200)) throw new Error('invalid result calls')
    calls = new Set(list)
    if (calls.size !== list.length) throw new Error('duplicate result calls')
  }
  return { sessionId, calls, after }
}

/** Read-only original-session scope. The official observation supports both live and cold history. */
async function visibleSource(reader: SessionReader, sessionId: string, calls: Set<string> | undefined, signal: AbortSignal) {
  const cut = await reader.observeSession(sessionId as SessionId, { signal, projectionMode: 'none' })
  try {
    if (cut.header.id !== sessionId) throw new Error('session source conflict')
    const roots = new Map<string, { seq: number; turn: number }>()
    for (const event of cut.events) {
      if (event.type !== 'tool/call' || !event.data || typeof event.data !== 'object') continue
      const callId: unknown = Reflect.get(event.data, 'callId'), turn: unknown = Reflect.get(event.data, 'turn')
      if (typeof callId === 'string' && typeof turn === 'number' && Number.isSafeInteger(turn)) roots.set(callId, { seq: Number(event.seq), turn })
    }
    if (calls && [...calls].some(call => !roots.has(call))) throw Object.assign(new Error('call outside session'), { status: 403 })
    const createdAt = cut.header.createdAt
    return (source: CanvasResultSource) => {
      const root = roots.get(source.rootCallId)
      return source.sessionId === sessionId && source.sessionCreatedAt === createdAt && !!root
        && root.seq === source.rootCallSeq && root.turn === source.turn && (!calls || calls.has(source.rootCallId))
    }
  } finally { cut[Symbol.dispose]() }
}

export function canvasResultHandler(connection: BrowserConnection, store: CanvasResultStore, reader: SessionReader): ResultHandler {
  const streams = new Set<() => void>()
  let closed = false
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const rejection = connection.requestRejection(req)
    if (rejection !== undefined) { send(res, rejection, { error: 'browser session required' }); return }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const streaming = url.pathname === CANVAS_RESULT_ROUTE + '/events'
    if (url.hash || ![CANVAS_RESULT_ROUTE, CANVAS_RESULT_ROUTE + '/events'].includes(url.pathname)) { send(res, 404, { error: 'unknown result route' }); return }
    if (req.method !== 'GET') { send(res, 405, { error: 'GET required' }); return }
    if (closed || streaming && streams.size >= MAX_STREAMS) { send(res, 503, { error: 'canvas result service unavailable' }); return }
    let query: ReturnType<typeof queryOf>
    try { query = queryOf(url); if (streaming && query.after !== undefined) throw new Error('stream cursor unsupported') }
    catch { send(res, 400, { error: 'invalid result query' }); return }
    const abort = new AbortController()
    res.once('close', () => abort.abort())
    let visible: (source: CanvasResultSource) => boolean
    try { visible = await visibleSource(reader, query.sessionId, query.calls, abort.signal) }
    catch (error) {
      if (res.destroyed || abort.signal.aborted) return
      const code = error && typeof error === 'object' ? Reflect.get(error, 'code') : undefined
      const status = error && typeof error === 'object' && Reflect.get(error, 'status') === 403 ? 403
        : code === 'SESSION_QUERY_SESSION_NOT_FOUND' ? 404 : 503
      send(res, status, { error: status === 403 ? 'call outside session' : status === 404 ? 'session unavailable' : 'canvas result history unavailable' }); return
    }
    if (res.destroyed || abort.signal.aborted) return
    if (closed || streaming && streams.size >= MAX_STREAMS) { send(res, 503, { error: 'canvas result service unavailable' }); return }
    if (!streaming) {
      try {
        const snapshot = await store.list(query.sessionId, { after: query.after, visible })
        if (!res.destroyed && !abort.signal.aborted) send(res, 200, snapshot)
      } catch (error) { if (!res.destroyed) send(res, error instanceof CanvasResultCursorError ? 400 : 503, { error: 'canvas result snapshot unavailable' }) }
      return
    }
    const queue: string[] = []
    let pendingUpdates = 0, buffered = 0, blocked = false, stopped = false, snapshotSent = false, release: (() => void) | undefined
    const cleanup = () => {
      if (stopped) return
      stopped = true; clearInterval(heartbeat); release?.(); streams.delete(stop); queue.length = 0; res.off('drain', drain)
    }
    const stop = () => { cleanup(); res.destroy() }
    const write = (line: string) => {
      if (stopped || res.destroyed) throw new Error('result stream closed')
      const bytes = Buffer.byteLength(line)
      if (queue.length >= 128 || buffered + bytes + res.writableLength > MAX_BUFFER_BYTES) { stop(); throw new Error('result stream overloaded') }
      if (blocked || !snapshotSent) { queue.push(line); buffered += bytes } else blocked = !res.write(line)
    }
    const drain = () => {
      if (!snapshotSent || stopped) return
      blocked = false
      while (queue.length && !blocked) { const line = queue.shift()!; buffered -= Buffer.byteLength(line); blocked = !res.write(line) }
    }
    const publish = (event: CanvasResultEvent) => write('data: ' + JSON.stringify(event) + '\n\n')
    const heartbeat = setInterval(() => { try { write(': keepalive\n\n') } catch { stop() } }, 15_000)
    heartbeat.unref?.()
    streams.add(stop); res.once('close', cleanup); res.on('drain', drain)
    try {
      // Subscribe first: a durable update cannot fall into the snapshot/subscription gap.
      release = store.subscribe(query.sessionId, source => {
        if (stopped) return
        if (pendingUpdates >= 32 || connection.requestRejection(req) !== undefined) { stop(); return }
        pendingUpdates++
        // A session stream outlives one Turn. Revalidate on actual changes so later roots
        // appear and removed/recreated histories cannot keep an old authorization cut.
        void visibleSource(reader, query.sessionId, query.calls, abort.signal).then(current => {
          if (!stopped && current(source)) publish({ type: 'upsert', source })
        }).catch(stop).finally(() => { pendingUpdates-- })
      })
      const snapshot = await store.list(query.sessionId, { visible })
      if (stopped || closed) { stop(); return }
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no', 'x-content-type-options': 'nosniff' })
      snapshotSent = true; blocked = !res.write('data: ' + JSON.stringify(snapshot) + '\n\n')
      if (!blocked) drain()
    } catch {
      cleanup()
      if (!res.headersSent && !res.destroyed) send(res, 503, { error: 'canvas result stream unavailable' })
      else if (!res.destroyed) res.end()
    }
  }
  return Object.assign(handler, { close() { closed = true; for (const stop of [...streams]) stop() } })
}

export function registerCanvasResultRoute(ctx: Context, store: CanvasResultStore): void {
  const connection = Reflect.get(ctx, 'connection') as BrowserConnection
  const reader = ctx.get('sessionQuery')
  if (!reader) ctx.logger.warn('canvas results unavailable: session-query service missing')
  const handler = canvasResultHandler(connection, store, reader ?? {
    async observeSession() { throw new Error('session-query unavailable') }
  })
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: CANVAS_RESULT_ROUTE, handler }), 'desktop-canvas: result route')
  ctx.effect(() => () => handler.close(), 'desktop-canvas: result streams')
}
