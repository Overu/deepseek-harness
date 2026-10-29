type CanvasNode = {
  id: string
  type?: string
  data?: { title?: unknown; value?: unknown }
}

/** The desktop receives only a bounded, user-selected node summary. */
export function nodeSelectionMessage(canvasId: string, node: CanvasNode, requestId: string) {
  if (!node.id || node.id.length > 100 || !requestId || requestId.length > 80) return undefined
  const title = typeof node.data?.title === 'string' && node.data.title ? node.data.title : '未命名节点'
  return {
    protocolVersion: 1,
    type: 'canvas.node.select',
    canvasId,
    requestId,
    payload: {
      id: node.id,
      title: title.slice(0, 100),
      type: (node.type || 'unknown').slice(0, 40),
      value: typeof node.data?.value === 'string' ? node.data.value.slice(0, 1000) : '',
    },
  }
}
