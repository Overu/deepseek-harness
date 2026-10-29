import { isReferenceId, snapshotReferenceNodes, type CanvasReferenceUpdate } from '../../src/shared/canvas-node-references'

/** A view owns this publisher; it only reads the shared native Store. */
export function createCanvasReferenceBridge(options: {
  canvasId: string; viewId: string; origin: string
  parent: Pick<Window, 'postMessage'>
  receiveTarget: Pick<Window, 'addEventListener' | 'removeEventListener'>
  getNodes(): readonly { id: string; selected?: boolean; [key: string]: unknown }[]
  subscribe(listener: () => void): () => void
}) {
  let subscriptionId: string | undefined
  let revision = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let explicitSelection = false
  let disposed = false
  let previous = ''
  let referencedIds = new Set<string>()
  let previousSelectedSignature = ''
  const identity = { protocolVersion: 1 as const, canvasId: options.canvasId, viewId: options.viewId }
  const publish = () => {
    timer = undefined
    if (disposed || !subscriptionId) return
    const allNodes = options.getNodes()
    // Defer the complete snapshot until all dragged nodes reach their final positions.
    if (allNodes.some(node => node.dragging === true)) return
    const selectedNodes = allNodes.filter(node => node.selected)
    const selectedSignature = selectedNodes.map(node => node.id).sort().join(',')

    let nodesToPublish: readonly unknown[]
    let reason: 'select' | 'update'

    if (selectedNodes.length > 0) {
      const selectionChanged = selectedSignature !== previousSelectedSignature
      previousSelectedSignature = selectedSignature
      referencedIds = new Set(selectedNodes.map(node => node.id))
      nodesToPublish = selectedNodes
      reason = (explicitSelection || selectionChanged) ? 'select' : 'update'
    } else {
      previousSelectedSignature = ''
      // Selection cancelled / empty: retain referenced nodes until the next selection/box-selection happens.
      nodesToPublish = allNodes.filter(node => referencedIds.has(node.id))
      referencedIds = new Set(nodesToPublish.map((node: any) => node.id))
      reason = 'update'
    }

    const snapshot = snapshotReferenceNodes(nodesToPublish)
    const signature = JSON.stringify(snapshot)
    if (!explicitSelection && signature === previous) return
    previous = signature
    const message: CanvasReferenceUpdate = { ...identity, type: 'canvas.references.changed', subscriptionId,
      revision: ++revision, reason, ...snapshot }
    explicitSelection = false
    options.parent.postMessage(message, options.origin)
  }
  const schedule = () => { if (!disposed && timer === undefined) timer = setTimeout(publish, 0) }
  const off = options.subscribe(schedule)
  const receive = (event: MessageEvent) => {
    if (disposed || event.origin !== options.origin || event.source !== options.parent) return
    const message = event.data
    if (!message || message.protocolVersion !== 1 || message.type !== 'canvas.references.hello'
      || message.canvasId !== options.canvasId || message.viewId !== options.viewId || !isReferenceId(message.subscriptionId)) return
    subscriptionId = message.subscriptionId
    previous = ''
    previousSelectedSignature = options.getNodes().filter(node => node.selected).map(node => node.id).sort().join(',')
    schedule()
  }
  options.receiveTarget.addEventListener('message', receive as EventListener)
  options.parent.postMessage({ ...identity, type: 'canvas.references.ready' }, options.origin)
  return {
    select() { explicitSelection = true; schedule() },
    dispose() {
      if (disposed) return
      disposed = true; clearTimeout(timer); off(); options.receiveTarget.removeEventListener('message', receive as EventListener)
      if (subscriptionId) options.parent.postMessage({ ...identity, type: 'canvas.references.changed', subscriptionId,
        revision: ++revision, reason: 'update', nodes: [] } satisfies CanvasReferenceUpdate, options.origin)
    },
  }
}
