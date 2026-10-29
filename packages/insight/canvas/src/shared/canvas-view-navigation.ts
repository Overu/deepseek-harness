import { parseCanvasId } from './protocol.ts'

/** View-only navigation. These messages never enter the Agent command/save queue. */
export interface CanvasViewIdentity { canvasId: string; viewId: string }
export interface CanvasViewHello extends CanvasViewIdentity { protocolVersion: 1; type: 'canvas.view.hello' }
export interface CanvasViewReady extends CanvasViewIdentity { protocolVersion: 1; type: 'canvas.view.ready'; channelId: string }
export interface CanvasViewFocus extends CanvasViewIdentity {
  protocolVersion: 1; type: 'canvas.view.focus'; channelId: string; requestId: string; revision: number; nodeId?: string; selectNode?: boolean
}
export type CanvasViewFocusStatus = 'focused' | 'cleared' | 'node_missing' | 'view_unavailable'
export interface CanvasViewFocusResult extends CanvasViewIdentity {
  protocolVersion: 1; type: 'canvas.view.focus.result'; channelId: string; requestId: string; revision: number; status: CanvasViewFocusStatus
}
export type CanvasViewMessage = CanvasViewHello | CanvasViewReady | CanvasViewFocus | CanvasViewFocusResult

const boundedId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 100
export function canvasNavigationNodeId(params: unknown): string | undefined {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined
  const nodeId = (params as Record<string, unknown>).nodeId
  return boundedId(nodeId) ? nodeId : undefined
}
export function parseCanvasViewMessage(value: unknown, expected: CanvasViewIdentity): CanvasViewMessage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const message = value as Record<string, unknown>
  if (message.protocolVersion !== 1 || parseCanvasId(message.canvasId) !== expected.canvasId || message.viewId !== expected.viewId) return undefined
  const base = { protocolVersion: 1 as const, canvasId: expected.canvasId, viewId: expected.viewId }
  if (message.type === 'canvas.view.hello') return { ...base, type: message.type }
  if (!boundedId(message.channelId)) return undefined
  if (message.type === 'canvas.view.ready') return { ...base, type: message.type, channelId: message.channelId }
  if (!boundedId(message.requestId) || !Number.isSafeInteger(message.revision) || Number(message.revision) < 0) return undefined
  const navigation = { ...base, channelId: message.channelId, requestId: message.requestId, revision: Number(message.revision) }
  if (message.type === 'canvas.view.focus' && (message.nodeId === undefined || boundedId(message.nodeId))
    && (message.selectNode === undefined || typeof message.selectNode === 'boolean')) {
    return { ...navigation, type: message.type, ...(message.nodeId === undefined ? {} : { nodeId: message.nodeId }),
      ...(message.selectNode === undefined ? {} : { selectNode: message.selectNode }) }
  }
  if (message.type === 'canvas.view.focus.result' && ['focused', 'cleared', 'node_missing', 'view_unavailable'].includes(String(message.status))) {
    return { ...navigation, type: message.type, status: message.status as CanvasViewFocusStatus }
  }
}
