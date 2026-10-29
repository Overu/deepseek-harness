import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { installAgentCanvasEditGuard } from './agent-edit-guard'
import { getCanvasViewBinding, type CanvasViewBinding } from './canvas-service-binding'
import { AUTH_EXPIRED_EVENT } from './auth-context'
import { CANVAS_LOAD_ERROR_EVENT } from './request'
import { useParams } from '@tanstack/react-router'
import { ReactFlowProvider } from '@xyflow/react'
import CanvasFlow from '../legacy/src/components/canvasFlow'
import { useWorkflowTabGuard } from '../legacy/src/hooks/useWorkflowTabGuard'
import type { WorkflowTabStatus } from '../legacy/src/hooks/workflowTabOwnership'
import { CanvasViewNavigation } from './canvas-view-navigation'
import { createCanvasReferenceBridge } from './canvas-reference-bridge'

function CanvasSurface({ status, binding, sideOperationsPosition }: { status: WorkflowTabStatus; binding?: CanvasViewBinding; sideOperationsPosition?: 'left' | 'right' }) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const references = useRef<ReturnType<typeof createCanvasReferenceBridge> | undefined>(undefined)
  useEffect(() => {
    if (!binding || status !== 'active' || window.parent === window) return
    const publisher = createCanvasReferenceBridge({ canvasId: binding.canvasId, viewId: binding.viewId, origin: location.origin,
      parent: window.parent, receiveTarget: window, getNodes: () => binding.store.getState().nodes,
      subscribe: listener => binding.store.subscribe((state, previous) => { if (state.nodes !== previous.nodes) listener() }) })
    references.current = publisher
    return () => { references.current = undefined; publisher.dispose() }
  }, [binding, status])
  useLayoutEffect(() => {
    if (canvasRef.current) return binding ? binding.mountEditorRoot(canvasRef.current) : installAgentCanvasEditGuard(canvasRef.current)
  }, [binding, status])
  useEffect(() => binding?.setFeedback({
    error: message => toast.error(message), showCapacityLimit: async () => { const { showStorageCapacityLimit } = await import('../legacy/src/components/canvasFlow/utils/toolUtil'); await showStorageCapacityLimit() },
    notifyAuthExpired: () => window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT)),
    notifyCanvasLoadError: () => window.dispatchEvent(new Event(CANVAS_LOAD_ERROR_EVENT)),
  }), [binding])
  if (status === 'checking') return <div className="flex h-screen items-center justify-center bg-black text-white">正在加载画布…</div>
  if (status === 'inactive') return <div className="flex h-screen items-center justify-center bg-black text-white">此画布已在其他标签页打开，请刷新后继续编辑</div>
  return <div ref={canvasRef} style={{ height: '100vh', width: '100%', position: 'relative' }}>
    <ReactFlowProvider><CanvasFlow hideHeader sideOperationsPosition={sideOperationsPosition}
      onReferenceSelection={() => references.current?.select()} />{binding && <CanvasViewNavigation binding={binding} />}</ReactFlowProvider>
  </div>
}
function OwnedCanvas({ binding, sideOperationsPosition }: { binding: CanvasViewBinding; sideOperationsPosition?: 'left' | 'right' }) {
  const [readiness, setReadiness] = useState(binding.getReadiness)
  useEffect(() => binding.subscribeReadiness(setReadiness), [binding])
  if (readiness.phase === 'disposed' || !readiness.capabilities.read && readiness.phase === 'failed') return <div>{readiness.reason?.message ?? '画布上下文已失效'}</div>
  return <CanvasSurface binding={binding} status={readiness.phase === 'inactive' ? 'inactive' : readiness.phase === 'loading' ? 'checking' : 'active'} sideOperationsPosition={sideOperationsPosition} />
}
function StandaloneCanvas({ sideOperationsPosition }: { sideOperationsPosition?: 'left' | 'right' } = {}) {
  const { id } = useParams({ strict: false }) as { id: string }
  return <CanvasSurface status={useWorkflowTabGuard(id)} sideOperationsPosition={sideOperationsPosition} />
}
export default function DesktopCanvas({ sideOperationsPosition }: { sideOperationsPosition?: 'left' | 'right' } = {}) {
  const binding = getCanvasViewBinding()
  return binding ? <OwnedCanvas binding={binding} sideOperationsPosition={sideOperationsPosition} /> : <StandaloneCanvas sideOperationsPosition={sideOperationsPosition} />
}
