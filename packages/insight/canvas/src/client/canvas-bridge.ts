import { CanvasAgentError } from '../shared/canvas-agent-protocol.ts'
import { OWNERSHIP_PROTOCOL } from '../shared/canvas-bridge-protocol.ts'
import { bridgeFingerprint, assertBridgeId, messageBytes, MAX_BRIDGE_CACHE_BYTES, MAX_BRIDGE_RECORDS, parseClientRegistration, parseServiceHostEvent, parseServiceClientEvent, type ClientRegistration, type ServiceClientEvent } from '../shared/canvas-bridge-protocol.ts'
import type { CanvasReferenceItem } from '../shared/canvas-node-references.ts'
import type { CanvasServiceRuntimeBase } from '../shared/canvas-service-runtime.ts'
import { createCanvasCommandEndpoint, type CanvasCommandEndpoint } from './canvas-command-endpoint.ts'
import { consumeSse } from './sse.ts'
export interface CanvasClientBridge {
  retainSession(sessionId: string): () => void
  syncReferences(sessionId: string, references: CanvasReferenceItem[]): void
  onReferencesConsumed(listener: (sessionId: string) => void): () => void
  dispose(): void
}
export function createCanvasClientBridge(options: { origin: string; getRuntime: () => Promise<CanvasServiceRuntimeBase>; transport?: typeof fetch; reconnectMs?: number; openCanvas?: Parameters<typeof createCanvasCommandEndpoint>[0]['openCanvas'] }): CanvasClientBridge {
  const transport: typeof fetch = options.transport ?? ((input, init) => fetch(input, init))
  const controller = new AbortController(), sessions = new Map<string, number>(), outbox = new Map<string, ServiceClientEvent>(), clientId = crypto.randomUUID()
  const pendingReferences = new Map<string, { references: CanvasReferenceItem[]; revision: number }>(), consumedListeners = new Set<(sessionId: string) => void>()
  let registration: ClientRegistration | undefined, endpoint: CanvasCommandEndpoint | undefined
  let streamController: AbortController | undefined
  let reconnectFailures = 0
  let revision = 0, started = false, disposed = false, connected = false, flushing = false, buffered = 0, streamGeneration = 0, retryTimer: ReturnType<typeof setTimeout> | undefined, receiptRetryTimer: ReturnType<typeof setTimeout> | undefined, deliveryFailures = 0
  const url = (path: string) => new URL('/desktop-canvas/api/bridge/' + path, options.origin).href
  const headers = () => ({ 'content-type': 'application/json', 'x-canvas-bridge-origin': options.origin, ...(registration ? { 'x-canvas-bridge-key': registration.bridgeKey } : {}) })
  const request = (path: string, init: RequestInit = {}) => transport(url(path), { ...init, headers: headers(), credentials: 'same-origin', signal: init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal })
  function stop() { if (disposed) return; disposed = true; connected = false; clearTimeout(retryTimer); clearTimeout(receiptRetryTimer); controller.abort(); endpoint?.dispose(); sessions.clear(); outbox.clear(); pendingReferences.clear(); consumedListeners.clear(); buffered = 0 }
  async function recoverConnection(response: Response, current: ClientRegistration) {
    let lostRegistration = false
    if (response.status === 403) {
      try { lostRegistration = (await response.json()).error === 'bridge registration required' } catch { /* An auth rejection does not revoke native receipts. */ }
    }
    if (disposed || registration !== current) return
    connected = false; streamController?.abort()
    if (lostRegistration) {
      // A new Host cannot accept old identities or receipts; never replay their commands.
      endpoint?.dispose(); endpoint = undefined; registration = undefined
      outbox.clear(); buffered = 0
    }
  }
  async function flush() {
    if (flushing || !connected || disposed || !registration) return
    clearTimeout(receiptRetryTimer); receiptRetryTimer = undefined
    flushing = true
    const generation = streamGeneration
    try {
      while (outbox.size && connected && !disposed) {
        const current: ClientRegistration = registration
        const [key, event] = outbox.entries().next().value!
        const response = await request('client-event', { method: 'POST', body: JSON.stringify(event) })
        if (registration !== current || disposed) return
        if (response.status === 401 || response.status === 403) { deliveryFailures++; await recoverConnection(response, current); return }
        if (!response.ok && response.status >= 500) { deliveryFailures++; return }
        deliveryFailures = 0
        // Invalid/stale state receipts are not execution requests and must not loop.
        if (outbox.get(key) === event) { outbox.delete(key); buffered -= messageBytes(event) }
      }
    } catch { deliveryFailures++ /* Native commands are never resent; only receipt delivery retries. */ }
    finally {
      flushing = false
      if (!disposed && connected && outbox.size) {
        if (generation !== streamGeneration) void flush()
        else receiptRetryTimer = setTimeout(() => { receiptRetryTimer = undefined; void flush() }, Math.min(5000, (options.reconnectMs ?? 500) * 2 ** Math.min(deliveryFailures, 6)))
      }
    }
  }
  function enqueue(input: ServiceClientEvent) {
    if (disposed) return
    const event = parseServiceClientEvent(input)
    const key = event.type === 'session.sync' ? 'sessions' : event.type === 'canvas.references.sync' ? 'references:' + event.sessionId : event.type === 'canvas.run.state' ? JSON.stringify([event.type, event.sessionId, event.canvasId, event.contextId, event.requestId]) : event.type === 'canvas.context.state' ? JSON.stringify([event.type, event.sessionId, event.canvasId, event.contextId]) : event.requestId
    const old = outbox.get(key), bytes = messageBytes(event)
    if ((!old && outbox.size >= MAX_BRIDGE_RECORDS) || buffered - (old ? messageBytes(old) : 0) + bytes > MAX_BRIDGE_CACHE_BYTES) { stop(); return }
    outbox.set(key, event); buffered += bytes - (old ? messageBytes(old) : 0); void flush()
  }
  function syncSessions() { if (registration) enqueue({ type: 'session.sync', protocolVersion: 4, connectionId: registration.connectionId, revision, sessionIds: [...sessions.keys()] }) }
  function syncAllReferences() {
    if (!registration) return
    for (const [sessionId, snapshot] of pendingReferences) {
      if (!sessions.has(sessionId)) continue
      enqueue({ type: 'canvas.references.sync', protocolVersion: 4, connectionId: registration.connectionId, sessionId, ...snapshot })
    }
  }
  async function loop() {
    while (!disposed) {
      try {
        if (!registration) {
          const response = await request('attach', { method: 'POST', body: JSON.stringify({ protocolVersion: 4, clientId, ownershipProtocol: OWNERSHIP_PROTOCOL }) })
          if (!response.ok) throw new Error('bridge registration unavailable')
          const attached = parseClientRegistration(await response.json())
          if (disposed) return
          registration = attached
          endpoint = createCanvasCommandEndpoint({ connectionId: registration.connectionId, getRuntime: options.getRuntime, isSessionBound: sessionId => sessions.has(sessionId), send: enqueue, openCanvas: options.openCanvas })
        }
        const current = registration, stream = new AbortController(); streamController = stream
        const response = await request('events', { signal: stream.signal })
        if (disposed || registration !== current) continue
        if (response.status === 401 || response.status === 403) { await recoverConnection(response, current); throw new Error('bridge connection unavailable') }
        if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) throw new Error('bridge event stream unavailable')
        await consumeSse(response.body, input => {
          if (disposed || registration !== current || stream.signal.aborted) return
          const event = parseServiceHostEvent(input)
          if (event.connectionId !== current.connectionId) throw new CanvasAgentError('INVALID_ARGUMENT', '事件属于另一连接')
          if (event.type === 'bridge.connected') { reconnectFailures = 0; streamGeneration++; connected = true; syncSessions(); syncAllReferences(); void flush() }
          else if (event.type === 'canvas.references.consumed') {
            if (pendingReferences.get(event.sessionId)?.revision !== event.revision) return
            for (const listener of consumedListeners) { try { listener(event.sessionId) } catch {} }
          }
          else { if (!connected) throw new CanvasAgentError('INVALID_ARGUMENT', '事件流尚未登记'); void endpoint!.handle(event).catch(() => {}) }
        })
      } catch { reconnectFailures++ /* Stream reconnect preserves endpoint IDs and pending native work. */ }
      finally { connected = false }
      if (!disposed) await new Promise<void>(resolve => {
        const done = () => { clearTimeout(retryTimer); controller.signal.removeEventListener('abort', done); resolve() }
        controller.signal.addEventListener('abort', done, { once: true }); retryTimer = setTimeout(done, Math.min(5000, (options.reconnectMs ?? 500) * 2 ** Math.min(Math.max(reconnectFailures - 1, deliveryFailures), 6)))
        if (controller.signal.aborted) done()
      })
    }
  }
  return {
    retainSession(sessionId) {
      assertBridgeId(sessionId)
      if (disposed) throw new CanvasAgentError('CLIENT_UNAVAILABLE', '画布通信桥已卸载')
      if (!sessions.has(sessionId) && sessions.size >= 64) throw new CanvasAgentError('BRIDGE_OVERLOADED', '画布会话登记已达上限')
      sessions.set(sessionId, (sessions.get(sessionId) ?? 0) + 1); revision++; syncSessions(); syncAllReferences()
      if (!started) { started = true; void loop() }
      let released = false
      return () => { if (released || disposed) return; released = true; const refs = sessions.get(sessionId)! - 1; if (refs) sessions.set(sessionId, refs); else { sessions.delete(sessionId); endpoint?.releaseSession(sessionId) } revision++; syncSessions() }
    },
    syncReferences(sessionId, references) {
      assertBridgeId(sessionId)
      if (disposed) return
      const previous = pendingReferences.get(sessionId)
      if (previous && bridgeFingerprint(previous.references) === bridgeFingerprint(references)) return
      const revision = (previous?.revision ?? 0) + 1
      pendingReferences.set(sessionId, { references: structuredClone(references), revision })
      if (registration && sessions.has(sessionId)) {
        enqueue({
          type: 'canvas.references.sync',
          protocolVersion: 4,
          connectionId: registration.connectionId,
          sessionId,
          revision,
          references,
        })
      }
    },
    onReferencesConsumed(listener) {
      consumedListeners.add(listener)
      return () => { consumedListeners.delete(listener) }
    },
    dispose() {
      if (disposed) return
      if (registration) void transport(url('detach'), { method: 'POST', headers: headers(), credentials: 'same-origin', body: '{}', keepalive: true, signal: AbortSignal.timeout(3000) }).catch(() => {})
      stop()
    },
  }
}
