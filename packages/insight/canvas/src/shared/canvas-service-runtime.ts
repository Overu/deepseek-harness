import type { CanvasRunState } from './canvas-run-protocol.ts'
import type { CanvasOperation, CanvasOperationResult, FrameReadiness } from './canvas-agent-protocol.ts'

export type CanvasCapability = 'read' | 'edit' | 'run'
export interface CanvasContextInfo { canvasId: string
  contextId: string
  readiness: FrameReadiness }
export interface CanvasContextInput { canvasId: string
  capability: CanvasCapability
  signal?: AbortSignal }

export interface CanvasExecuteInput { canvasId: string
  expectedContextId?: string
  operation: CanvasOperation
  requestId?: string
  signal?: AbortSignal }
export interface CanvasViewRegistration { canvasId: string
  viewId: string
  frame: HTMLIFrameElement }
export interface CanvasViewInput { canvasId: string
  viewId: string
  viewWindow: Window
  viewDocument: Document }

/** Browser service; view references are internal and never Agent tool arguments. */
export interface CanvasServiceRuntimeBase<ViewBinding = unknown> {
  execute(input: CanvasExecuteInput): Promise<CanvasOperationResult>
  registerView(input: CanvasViewRegistration): () => void
  attachView(input: CanvasViewInput): Promise<ViewBinding>
  detachView(viewId: string): void
  ensureContext(input: CanvasContextInput): Promise<CanvasContextInfo>
  getContextInfo(canvasId: string): CanvasContextInfo | null
  subscribeRun(input: { canvasId: string
    expectedContextId: string
    requestId: string }, listener: (state: CanvasRunState) => void): () => void
  subscribeReadiness(canvasId: string, listener: (state: FrameReadiness) => void): () => void
  reloadContext(input: CanvasContextInput): Promise<CanvasContextInfo>
  closeContext(canvasId: string): Promise<void>
  dispose(): void
}
export interface CanvasRuntimeHandle {
  readonly ready: Promise<CanvasServiceRuntimeBase>
  registerView(input: CanvasViewRegistration): () => void
}

declare global {
  interface Window { __INSIGHT_CANVAS_RUNTIME_V1__?: CanvasRuntimeHandle }
}
