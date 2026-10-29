import { parseCanvasId, type CanvasId } from '../shared/protocol.ts'

export interface SelectedNode {
  id: string
  title: string
  type: string
  value: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

/** Validate an iframe message before it touches the active conversation draft. */
export function parseNodeSelection(value: unknown, expectedCanvasId: CanvasId): SelectedNode | undefined {
  const message = record(value)
  if (!message || message.protocolVersion !== 1 || message.type !== 'canvas.node.select' ||
      parseCanvasId(message.canvasId) !== expectedCanvasId ||
      typeof message.requestId !== 'string' || message.requestId.length > 80 || !message.requestId) return undefined
  const payload = record(message.payload)
  if (!payload || typeof payload.id !== 'string' || !payload.id || payload.id.length > 100 ||
      typeof payload.title !== 'string' || !payload.title || payload.title.length > 100 ||
      typeof payload.type !== 'string' || !payload.type || payload.type.length > 40 ||
      typeof payload.value !== 'string' || payload.value.length > 1000) return undefined
  return { id: payload.id, title: payload.title, type: payload.type, value: payload.value }
}
