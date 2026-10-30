import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useEffect, useRef, useMemo, useCallback, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { canvasIdFromAddress } from '../shared/protocol.ts'
import { attachCanvasReferenceReceiver, type CanvasNodeReferences } from './canvas-node-references.ts'
import type { CanvasOpenReceipt } from '../shared/canvas-process-protocol.ts'
import { canvasNavigationNodeId } from '../shared/canvas-view-navigation.ts'
import { createCanvasViewNavigation } from './canvas-view-navigation.ts'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightResourceParamsMap { canvas: { nodeId?: string
    selectNode?: boolean
    navigationId?: string } }
}

/** The view owns its reference subscription; the native composer retains ownership of its draft. */
export function CanvasTab({ useTabInfo, references, referenceSessionId, onCanvasNavigation }: PropsRuntime<'sidebar.right.pane.tab'> & {
  references: CanvasNodeReferences
  referenceSessionId: string
  onCanvasNavigation?: (id: string, status: CanvasOpenReceipt['focus']) => void
}) {
  const { tab } = useTabInfo()
  const id = canvasIdFromAddress(tab.contentId)
  const frame = useRef<HTMLIFrameElement | null>(null)
  const viewId = useMemo(() => randomUUID(), [id])
  const navigation = useRef<ReturnType<typeof createCanvasViewNavigation>>()
  const referenceReceiver = useRef<ReturnType<typeof attachCanvasReferenceReceiver>>()
  const navigationId = (tab.navigation.params as { navigationId?: string } | undefined)?.navigationId
  const navigationCallback = useRef({ navigationId, onCanvasNavigation }); navigationCallback.current = {
    navigationId, onCanvasNavigation }
  const [navigationNotice, setNavigationNotice] = useState('')
  const nodeId = canvasNavigationNodeId(tab.navigation.params)
  const selectNode = (tab.navigation.params as { selectNode?: boolean
    navigationId?: string } | undefined)?.selectNode === true
  const releaseView = useRef<(() => void) | undefined>()
  const registerFrame = useCallback((node: HTMLIFrameElement | null) => {
    releaseView.current?.(); releaseView.current = undefined; frame.current = node
    if (id && node) releaseView.current = window.__INSIGHT_CANVAS_RUNTIME_V1__?.registerView({ canvasId: id, viewId, frame: node })
  }, [id, viewId])

  useEffect(() => {
    if (!id) return
    const controller = createCanvasViewNavigation({
      identity: { canvasId: id, viewId }, origin: location.origin, receiveTarget: window,
      getFrame: () => frame.current?.contentWindow,
      onResult: (status) => { const current = navigationCallback.current
        if (current.navigationId) current.onCanvasNavigation?.(current.navigationId,
          status === 'cleared' ? 'not_requested' : status)
        setNavigationNotice(status === 'node_missing' ? '来源节点已不存在，已为你打开画布。' : status === 'view_unavailable' ? '画布已打开，暂时无法定位节点，请稍后再试。' : '') },
    })
    navigation.current = controller
    return () => { navigation.current = undefined; controller.dispose() }
  }, [id, viewId])
  useEffect(() => {
    setNavigationNotice('')
    navigation.current?.navigate(tab.navigation.revision, nodeId, selectNode)
  }, [id, viewId, tab.navigation.revision, nodeId, selectNode])
  useEffect(() => {
    if (!navigationNotice) return
    const timer = setTimeout(() =>{  setNavigationNotice('') }, 4000)
    return () =>{  clearTimeout(timer) }
  }, [navigationNotice])

  useEffect(() => {
    if (!id) return
    const receiver = attachCanvasReferenceReceiver({ references, sessionId: referenceSessionId, canvasId: id, viewId,
      origin: location.origin, receiveTarget: window, getFrame: () => frame.current?.contentWindow })
    referenceReceiver.current = receiver
    return () => { referenceReceiver.current = undefined; receiver.dispose() }
  }, [id, viewId, references, referenceSessionId])

  if (!id) return <div>无效的画布地址</div>
  return <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    {navigationNotice && <div role="status" style={{ position: 'absolute', zIndex: 10, pointerEvents: 'none', top: 12,
      left: 12, right: 12, padding: 10, borderRadius: 8, color: '#fff', background: '#25272b' }}>{navigationNotice}</div>}
    <iframe
      ref={registerFrame}
      title={`画布 ${id}`}
      onLoad={() => { navigation.current?.frameLoaded(); referenceReceiver.current?.hello() }}
      src={`/desktop-canvas/view?id=${encodeURIComponent(id)}&viewId=${encodeURIComponent(viewId)}`}
      style={{ display: 'block', width: '100%', height: '100%', border: 0, background: '#111318' }}
    />
  </div>
}
