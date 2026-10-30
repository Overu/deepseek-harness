import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { parseReferenceUpdate, type CanvasReferenceNode, type CanvasReferenceUpdate } from '../shared/canvas-node-references.ts'

export interface CanvasNodeReference { canvasId: string
  viewId: string
  node: CanvasReferenceNode }
export interface CanvasReferencesSnapshot { references: readonly CanvasNodeReference[]
  error?: CanvasReferenceUpdate['error'] }
const EMPTY: CanvasReferencesSnapshot = { references: [] }

/** Draft UI state only. No editor actions, graph mutations or model-context producer belong here. */
export class CanvasNodeReferences {
  private readonly sessions = new Map<string, CanvasReferencesSnapshot>()
  private readonly listeners = new Set<() => void>()
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = (sessionId: string): CanvasReferencesSnapshot => this.sessions.get(sessionId) ?? EMPTY
  getSessionIds = (): string[] => [...this.sessions.keys()]
  private publish(sessionId: string, snapshot: CanvasReferencesSnapshot) {
    if (!snapshot.references.length && !snapshot.error) this.sessions.delete(sessionId)
    else this.sessions.set(sessionId, snapshot)
    this.listeners.forEach((listener) =>{  listener() })
  }
  receive(sessionId: string, message: CanvasReferenceUpdate) {
    const current = this.getSnapshot(sessionId).references
    const others = current.filter(ref => ref.viewId !== message.viewId)
    const included = new Set(current.filter(ref => ref.viewId === message.viewId).map(ref => ref.node.id))
    // Updates refresh/remove existing references. Only an explicit canvas gesture can add them back.
    const nodes = message.error ? [] : message.nodes.filter(node => message.reason === 'select' || included.has(node.id))
    this.publish(sessionId, { references: [...others, ...nodes.map(node => ({ canvasId: message.canvasId,
      viewId: message.viewId, node }))],
    ...(message.error ? { error: message.error } : {}) })
  }
  remove(sessionId: string, reference: CanvasNodeReference) {
    this.publish(sessionId, { ...this.getSnapshot(sessionId), references: this.getSnapshot(sessionId).references
      .filter(ref => ref.viewId !== reference.viewId || ref.node.id !== reference.node.id) })
  }
  clear(sessionId: string) { this.publish(sessionId, EMPTY) }
  releaseView(sessionId: string, viewId: string) {
    this.publish(sessionId, { references: this.getSnapshot(sessionId).references.filter(ref => ref.viewId !== viewId) })
  }
  reset() { this.sessions.clear(); this.listeners.forEach((listener) =>{  listener() }) }
}

export function attachCanvasReferenceReceiver(options: {
  references: CanvasNodeReferences
  sessionId: string
  canvasId: string
  viewId: string
  origin: string
  getFrame(): Window | null | undefined
  receiveTarget: Pick<Window, 'addEventListener' | 'removeEventListener'>
}) {
  let subscriptionId = randomUUID()
  let revision = -1
  let disposed = false
  const hello = () => {
    if (!disposed) options.getFrame()?.postMessage({ protocolVersion: 1, type: 'canvas.references.hello',
      canvasId: options.canvasId, viewId: options.viewId, subscriptionId }, options.origin)
  }
  const receive = (event: MessageEvent) => {
    if (disposed || !options.getFrame() || event.source !== options.getFrame() || event.origin !== options.origin) return
    const data: unknown = event.data
    if (data !== null && typeof data === 'object' && 'protocolVersion' in data && 'type' in data
      && 'canvasId' in data && 'viewId' in data && data.protocolVersion === 1 && data.type === 'canvas.references.ready' &&
 data.canvasId === options.canvasId && data.viewId === options.viewId) {
      subscriptionId = randomUUID(); revision = -1; hello(); return
    }
    const message = parseReferenceUpdate(data, { canvasId: options.canvasId, viewId: options.viewId, subscriptionId })
    if (!message || message.revision <= revision) return
    revision = message.revision
    options.references.receive(options.sessionId, message)
  }
  options.receiveTarget.addEventListener('message', receive as EventListener)
  hello()
  return { hello, dispose() {
    disposed = true
    options.receiveTarget.removeEventListener('message', receive as EventListener)
    options.references.releaseView(options.sessionId, options.viewId)
  } }
}
