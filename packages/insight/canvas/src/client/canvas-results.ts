import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { CANVAS_RESULT_ROUTE, parseCanvasResultEvent, type CanvasResultSource } from '../shared/canvas-result-source.ts'
import { consumeSse } from './sse.ts'
import { parseCanvasId } from '../shared/protocol.ts'
import { MAX_TITLE_LENGTH } from '../shared/canvas-agent-protocol.ts'

interface CanvasResultCall { readonly callId: string; readonly seq: number }
export interface CanvasResultTurnData { readonly turn: number; readonly calls: readonly CanvasResultCall[] }

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap { 'desktop-canvas-results': CanvasResultTurnData }
}

/** Existing root tool events supply placement only; the Host supplies product identity. */
export const canvasResultsDefinition: ConversationNodeDefinition<CanvasResultTurnData> = {
  kind: 'desktop-canvas-results',
  match(event) {
    if (event.type === 'turn/start' || event.type === 'tool/call') return { id: String(event.data.turn), role: 'start' }
    return null
  },
  start(_context, match) {
    const event = match.event
    if (event.type !== 'turn/start' && event.type !== 'tool/call') throw new Error('canvas results require a turn or root call')
    return { turn: event.data.turn, calls: event.type === 'tool/call' ? [{ callId: String(event.data.callId), seq: event.seq }] : [] }
  },
  update(context, match) {
    if (match.event.type !== 'tool/call') return context.state
    const call = { callId: String(match.event.data.callId), seq: match.event.seq }
    if (context.state.calls.some(previous => previous.callId === call.callId && previous.seq === call.seq)) return context.state
    return { ...context.state, calls: [...context.state.calls, call] }
  },
  buildLocationData(context, scope, previous) {
    if (scope !== 'turn' || !context.state) return null
    if (previous?.kind === 'turn' && previous.key === 'desktop-canvas-results' && previous.value === context.state) return previous
    return { kind: 'turn', turn: context.state.turn, key: 'desktop-canvas-results', value: context.state }
  },
}

/** A completed result can update its original footer after that Agent turn has ended. */
export function resultsForClosing(sources: readonly CanvasResultSource[], sessionId: string,
  turn: number, calls: readonly CanvasResultCall[], closingSeq: number): CanvasResultSource[] {
  const roots = new Map(calls.filter(call => call.seq <= closingSeq).map(call => [call.callId, call.seq]))
  return sources.filter(source => source.sessionId === sessionId && source.turn === turn
    && roots.get(source.rootCallId) === source.rootCallSeq)
}

/** The durable turn end also owns products submitted after an interrupted partial reply. */
export function canvasResultsClosingSeq(turn: TurnTailOwnerProps['turn'], seq: number): number {
  return Math.max(seq, turn.end?.seq ?? seq)
}

export function callsForClosing(turn: TurnTailOwnerProps['turn']): CanvasResultTurnData | undefined {
  return turn.data.get('desktop-canvas-results')
}

export function groupCanvasResults(sources: readonly CanvasResultSource[]): Map<string, CanvasResultSource[]> {
  const groups = new Map<string, CanvasResultSource[]>()
  for (const source of sources) {
    const rows = groups.get(source.canvasId) ?? []
    rows.push(source); groups.set(source.canvasId, rows)
  }
  return groups
}


const EMPTY: readonly CanvasResultSource[] = []
interface SessionResults {
  refs: number
  listeners: Set<() => void>
  sources: Map<string, CanvasResultSource>
  snapshot: readonly CanvasResultSource[]
  controller: AbortController
}

/** One authenticated SSE per visible Session, released when its last footer unmounts. */
export class CanvasResultsStore {
  private readonly sessions = new Map<string, SessionResults>()
  private disposed = false
  private titleController = new AbortController()
  private readonly titleRequests = new Map<string, Promise<string | undefined>>()
  constructor(private readonly options: { origin: string; transport?: typeof fetch; reconnectMs?: number }) {}

  /** Reuse the existing authenticated, read-only snapshot; no runtime/model initialization. */
  getCanvasTitle(canvasId: string): Promise<string | undefined> {
    if (this.disposed || !parseCanvasId(canvasId)) return Promise.resolve(undefined)
    const pending = this.titleRequests.get(canvasId)
    if (pending) return pending
    const controller = this.titleController
    const url = new URL('/desktop-canvas/api/snapshot', this.options.origin)
    url.searchParams.set('id', canvasId)
    const transport = this.options.transport ?? ((input, init) => fetch(input, init))
    const request = (async () => {
      try {
        const response = await transport(url.href, { credentials: 'same-origin', signal: controller.signal })
        if (!response.ok) return undefined
        const snapshot: unknown = await response.json()
        if (controller.signal.aborted || !snapshot || typeof snapshot !== 'object'
          || Reflect.get(snapshot, 'canvasId') !== canvasId) return undefined
        const name: unknown = Reflect.get(snapshot, 'name')
        return typeof name === 'string' && name.trim() && name.length <= MAX_TITLE_LENGTH ? name.trim() : undefined
      } catch { return undefined }
    })()
    this.titleRequests.set(canvasId, request)
    void request.finally(() => { if (this.titleRequests.get(canvasId) === request) this.titleRequests.delete(canvasId) })
    return request
  }

  getSnapshot(sessionId: string): readonly CanvasResultSource[] { return this.sessions.get(sessionId)?.snapshot ?? EMPTY }
  subscribe(sessionId: string, listener: () => void): () => void {
    const session = this.session(sessionId)
    if (!session) return () => {}
    session.listeners.add(listener)
    return () => { session.listeners.delete(listener) }
  }
  retainSession(sessionId: string): () => void {
    const session = this.session(sessionId)
    if (!session) return () => {}
    if (session.refs++ === 0) { session.controller = new AbortController(); void this.loop(sessionId, session) }
    let released = false
    return () => {
      if (released) return
      released = true
      if (--session.refs !== 0) return
      session.controller.abort()
      this.sessions.delete(sessionId)
    }
  }
  reset(): void {
    this.titleController.abort(); this.titleController = new AbortController(); this.titleRequests.clear()
    for (const [id, session] of this.sessions) {
      session.controller.abort()
      session.sources.clear(); session.snapshot = EMPTY; this.publish(session)
      if (session.refs) { session.controller = new AbortController(); void this.loop(id, session) }
    }
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.titleController.abort(); this.titleRequests.clear()
    for (const session of this.sessions.values()) session.controller.abort()
    this.sessions.clear()
  }
  private session(id: string): SessionResults | undefined {
    if (this.disposed) return undefined
    let session = this.sessions.get(id)
    if (!session) {
      session = { refs: 0, listeners: new Set(), sources: new Map(), snapshot: EMPTY, controller: new AbortController() }
      this.sessions.set(id, session)
    }
    return session
  }
  private publish(session: SessionResults): void { for (const listener of session.listeners) listener() }
  private merge(sessionId: string, session: SessionResults, sources: readonly CanvasResultSource[], live: Set<string>, upsert = false): void {
    let changed = false
    for (const source of sources) {
      if (source.sessionId !== sessionId) throw new Error('canvas result belongs to another Session')
      if (upsert) live.add(source.requestId)
      else if (live.has(source.requestId)) continue
      const previous = session.sources.get(source.requestId)
      if (previous && JSON.stringify(previous) === JSON.stringify(source)) continue
      session.sources.set(source.requestId, source); changed = true
    }
    if (!changed) return
    session.snapshot = [...session.sources.values()].sort((left, right) => left.rootCallSeq - right.rootCallSeq || left.createdAt - right.createdAt)
    this.publish(session)
  }
  private async loop(sessionId: string, session: SessionResults): Promise<void> {
    const controller = session.controller
    const transport = this.options.transport ?? ((input, init) => fetch(input, init))
    const request = (cursor?: string, stream = false, signal = controller.signal) => {
      const url = new URL(CANVAS_RESULT_ROUTE + (stream ? '/events' : ''), this.options.origin)
      url.searchParams.set('s', sessionId)
      if (cursor) url.searchParams.set('after', cursor)
      return transport(url.href, { credentials: 'same-origin', signal })
    }
    let failures = 0
    while (!this.disposed && !controller.signal.aborted) {
      const attempt = new AbortController()
      const signal = AbortSignal.any([controller.signal, attempt.signal])
      try {
        const response = await request(undefined, true, signal)
        if ([401, 403, 404].includes(response.status)) { session.sources.clear(); session.snapshot = EMPTY; this.publish(session); return }
        if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('canvas result stream unavailable')
        const live = new Set<string>(), seen = new Set<string>(), cursors = new Set<string>()
        let snapshotStarted = false
        const finishSnapshot = () => {
          let removed = false
          for (const key of session.sources.keys()) {
            if (!seen.has(key) && !live.has(key)) { session.sources.delete(key); removed = true }
          }
          if (removed) {
            session.snapshot = [...session.sources.values()].sort((left, right) => left.rootCallSeq - right.rootCallSeq || left.createdAt - right.createdAt)
            this.publish(session)
          }
        }
        let hydration: Promise<void> = Promise.resolve()
        const loadPages = async (cursor: string) => {
          let next: string | undefined = cursor
          while (next && !signal.aborted) {
            if (cursors.has(next)) throw new Error('canvas result cursor repeated')
            cursors.add(next)
            const page = await request(next, false, signal)
            if (!page.ok) throw new Error('canvas result history unavailable')
            const event = parseCanvasResultEvent(await page.json())
            if (event.type !== 'snapshot') throw new Error('canvas result page must be a snapshot')
            if (signal.aborted) return
            event.sources.forEach(source => seen.add(source.requestId))
            this.merge(sessionId, session, event.sources, live)
            next = event.nextCursor
          }
          if (!signal.aborted) finishSnapshot()
        }
        await consumeSse(response.body, input => {
          if (signal.aborted) return
          const event = parseCanvasResultEvent(input)
          if (event.type === 'upsert') this.merge(sessionId, session, [event.source], live, true)
          else {
            if (snapshotStarted) throw new Error('canvas result stream contains duplicate snapshots')
            snapshotStarted = true
            event.sources.forEach(source => seen.add(source.requestId))
            this.merge(sessionId, session, event.sources, live)
            failures = 0
            if (event.nextCursor) {
              hydration = hydration.then(() => loadPages(event.nextCursor!))
              // A page failure ends this observation stream; reconnect obtains a new snapshot.
              void hydration.catch(() => { attempt.abort() })
            } else finishSnapshot()
          }
        })
        await hydration
      } catch { failures++ /* Reconnect reads receipts; it never submits native generation or saves. */ }
      finally { attempt.abort() }
      if (!controller.signal.aborted) await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finish); resolve() }
        const timer = setTimeout(finish, Math.min(5000, (this.options.reconnectMs ?? 500) * 2 ** Math.min(failures, 4)))
        controller.signal.addEventListener('abort', finish, { once: true })
        if (controller.signal.aborted) finish()
      })
    }
  }
}
