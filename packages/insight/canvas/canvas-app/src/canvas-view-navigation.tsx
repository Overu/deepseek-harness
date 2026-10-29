import { useEffect, useRef } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
import { parseCanvasViewMessage, type CanvasViewFocus, type CanvasViewFocusResult, type CanvasViewIdentity, type CanvasViewMessage } from '../../src/shared/canvas-view-navigation'
import type { CanvasViewBinding } from './canvas-service-binding'

/** Viewport, UI selection and transient decoration never enter the save/undo queue. */
export function createCanvasViewNavigator(options: {
  identity: CanvasViewIdentity; origin: string; parent: Pick<Window, 'postMessage'>
  receiveTarget: Pick<Window, 'addEventListener' | 'removeEventListener'>
  inspect(nodeId?: string): 'waiting' | 'missing' | 'hidden' | 'ready'
  focus(nodeId?: string): Promise<boolean>; highlight(nodeId?: string): void
  select?(nodeId: string): boolean
}) {
  const channelId = crypto.randomUUID()
  let latest: CanvasViewFocus | undefined
  let completed: CanvasViewFocusResult | undefined
  let busy = false
  let disposed = false
  let deadline: ReturnType<typeof setTimeout> | undefined
  const post = (message: CanvasViewMessage) => options.parent.postMessage(message, options.origin)
  const ready = () => post({ ...options.identity, protocolVersion: 1, type: 'canvas.view.ready', channelId })
  const finish = (request: CanvasViewFocus, status: CanvasViewFocusResult['status']) => {
    if (disposed || latest !== request) return
    clearTimeout(deadline)
    completed = { ...options.identity, protocolVersion: 1, type: 'canvas.view.focus.result', channelId,
      requestId: request.requestId, revision: request.revision, status }
    post(completed)
  }
  const flush = async () => {
    const request = latest
    if (disposed || busy || !request || completed?.requestId === request.requestId) return
    const status = options.inspect(request.nodeId)
    if (status === 'waiting') return
    if (status === 'missing') { finish(request, 'node_missing'); return }
    if (status === 'hidden') { finish(request, 'view_unavailable'); return }
    busy = true
    try {
      const focused = await options.focus(request.nodeId)
      if (latest === request && !disposed) {
        if (focused && request.nodeId) {
          if (request.selectNode && options.select?.(request.nodeId) === false) { finish(request, 'node_missing'); return }
          options.highlight(request.nodeId)
        }
        finish(request, focused ? (request.nodeId ? 'focused' : 'cleared') : 'view_unavailable')
      }
    } catch { finish(request, 'view_unavailable') }
    finally { busy = false; if (latest !== request && !disposed) void flush() }
  }
  const receive = (event: MessageEvent) => {
    if (disposed || event.origin !== options.origin || event.source !== options.parent) return
    const message = parseCanvasViewMessage(event.data, options.identity)
    if (!message) return
    if (message.type === 'canvas.view.hello') { ready(); return }
    if (message.type !== 'canvas.view.focus' || message.channelId !== channelId) return
    if (latest && (message.revision < latest.revision || message.revision === latest.revision && message.requestId !== latest.requestId)) return
    if (completed?.requestId === message.requestId) { post(completed); return }
    if (latest?.requestId === message.requestId) return
    latest = message; completed = undefined; options.highlight(); clearTimeout(deadline)
    deadline = setTimeout(() => finish(message, 'view_unavailable'), 20000)
    void flush()
  }
  options.receiveTarget.addEventListener('message', receive as EventListener)
  ready()
  return {
    refresh() { void flush() },
    dispose() { disposed = true; latest = undefined; clearTimeout(deadline); options.highlight(); options.receiveTarget.removeEventListener('message', receive as EventListener) },
  }
}

export function CanvasViewNavigation({ binding }: { binding: CanvasViewBinding }) {
  const flow = useReactFlow()
  const flowRef = useRef(flow)
  flowRef.current = flow
  const nodes = useStore(state => state.nodes)
  const canSettle = useStore(state => Boolean(state.panZoom) && state.width > 0 && state.height > 0 && (state.nodes.length === 0 || !state.fitViewQueued && state.nodesInitialized))
  const settled = useRef(false)
  const controller = useRef<ReturnType<typeof createCanvasViewNavigator> | undefined>(undefined)
  useEffect(() => {
    if (window.parent === window) return
    let highlighted: Element | undefined
    let highlightTimer: ReturnType<typeof setTimeout> | undefined
    const highlight = (nodeId?: string) => {
      clearTimeout(highlightTimer); highlighted?.classList.remove('insight-canvas-result-focus'); highlighted = undefined
      if (!nodeId) return
      highlighted = Array.from(document.querySelectorAll('.react-flow__node')).find(element => (element as HTMLElement).dataset.id === nodeId)
      highlighted?.classList.add('insight-canvas-result-focus')
      highlightTimer = setTimeout(() => { highlighted?.classList.remove('insight-canvas-result-focus'); highlighted = undefined }, 1800)
    }
    const navigator = createCanvasViewNavigator({
      identity: { canvasId: binding.canvasId, viewId: binding.viewId }, origin: location.origin, parent: window.parent, receiveTarget: window,
      inspect: nodeId => {
        if (!settled.current || !flowRef.current.viewportInitialized) return 'waiting'
        if (!nodeId) return 'ready'
        const node = flowRef.current.getInternalNode(nodeId)
        if (!node) return 'missing'
        if (node.hidden) return 'hidden'
        return node.measured.width && node.measured.height ? 'ready' : 'waiting'
      },
      focus: nodeId => {
        const current = flowRef.current
        if (!nodeId && current.getNodes().length === 0) return Promise.resolve(true)
        return current.fitView({ nodes: nodeId ? [{ id: nodeId }] : undefined, padding: 0.5, maxZoom: nodeId ? 1 : undefined, duration: 0 })
      }, highlight,
      select: nodeId => {
        const state = binding.store.getState()
        if (!state.nodes.some(node => node.id === nodeId)) return false
        state.actions.setNodes(state.nodes.map(node => node.selected === (node.id === nodeId) ? node : { ...node, selected: node.id === nodeId }))
        return true
      },
    })
    controller.current = navigator
    return () => { controller.current = undefined; navigator.dispose() }
  }, [binding])
  useEffect(() => {
    settled.current = false
    if (!canSettle) return
    // CanvasFlow's original initial fitView animates for 500ms. Let it finish first.
    const timer = setTimeout(() => { settled.current = true; controller.current?.refresh() }, 550)
    return () => clearTimeout(timer)
  }, [canSettle])
  useEffect(() => { controller.current?.refresh() }, [nodes])
  return <style>{'.react-flow__node.insight-canvas-result-focus { outline: 2px solid #60a5fa; outline-offset: 6px; }'}</style>
}
