import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { parseCanvasViewMessage, type CanvasViewFocus, type CanvasViewFocusStatus, type CanvasViewIdentity,
  type CanvasViewMessage } from '../shared/canvas-view-navigation.ts'

/** A bounded transport for the latest explicit click; it only sends view messages. */
export function createCanvasViewNavigation(options: {
  identity: CanvasViewIdentity
  origin: string
  getFrame(): Window | null | undefined
  receiveTarget: Pick<Window, 'addEventListener' | 'removeEventListener'>
  onResult(status: CanvasViewFocusStatus): void
}) {
  let desired: { revision: number
    nodeId?: string
    selectNode?: boolean } | undefined
  let pending: { revision: number
    nodeId?: string
    selectNode?: boolean
    requestId: string } | undefined
  let channelId: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let attempts = 0
  let disposed = false
  const clear = () => { clearTimeout(timer); clearTimeout(deadline); timer = deadline = undefined }
  const send = (message: CanvasViewMessage) => options.getFrame()?.postMessage(message, options.origin)
  const hello = () => send({ ...options.identity, protocolVersion: 1, type: 'canvas.view.hello' })
  const retry = () => {
    if (disposed || !pending) return
    if (channelId) send({ ...options.identity, ...pending, channelId, protocolVersion: 1,
      type: 'canvas.view.focus' } satisfies CanvasViewFocus)
    else hello()
    if (++attempts < 3) timer = setTimeout(retry, 4000)
  }
  const navigate = (revision: number, nodeId?: string, selectNode?: boolean) => {
    if (disposed || !Number.isSafeInteger(revision) || revision < 0 || desired && revision < desired.revision) return
    desired = { revision, nodeId, ...(selectNode === undefined ? {} : { selectNode }) }; clear(); attempts = 0
    if (!nodeId && !channelId) { pending = undefined; return }
    pending = { ...desired, requestId: randomUUID() }
    deadline = setTimeout(() => { pending = undefined; clear(); if (nodeId) options.onResult('view_unavailable') }, 30000)
    retry()
  }
  const receive = (event: MessageEvent) => {
    const frame = options.getFrame()
    if (disposed || !frame || event.origin !== options.origin || event.source !== frame) return
    const message = parseCanvasViewMessage(event.data, options.identity)
    if (!message) return
    if (message.type === 'canvas.view.ready') {
      if (channelId === message.channelId) return
      channelId = message.channelId; attempts = 0; clearTimeout(timer)
      if (pending) retry()
      else if (desired) navigate(desired.revision, desired.nodeId, desired.selectNode)
    } else if (message.type === 'canvas.view.focus.result' && pending && message.channelId === channelId &&
      message.requestId === pending.requestId && message.revision === pending.revision) {
      pending = undefined; clear(); options.onResult(message.status)
    }
  }
  options.receiveTarget.addEventListener('message', receive as EventListener)
  return {
    navigate,
    frameLoaded() {
      if (disposed) return
      // Ask the loaded document for its channel. A same-document onLoad must not repeat focus.
      hello()
    },
    dispose() { disposed = true; pending = undefined; clear(); options.receiveTarget.removeEventListener('message',
      receive as EventListener) },
  }
}
