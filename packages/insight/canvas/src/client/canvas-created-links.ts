import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolChatData } from '@deepseek-ai/dsh-client-ui-chat/client'
import { MAX_MESSAGE_BYTES, MAX_TITLE_LENGTH } from '../shared/canvas-agent-protocol.ts'
import { canvasAddress, parseCanvasId, type CanvasId } from '../shared/protocol.ts'

export interface CreatedCanvasLink {
  canvasId: CanvasId
  name: string
}

/** Only successful, named canvas_create receipts in the native tool projection authorize an entry. */
function creation(call: ToolCallBlock, closingSeq: number): CreatedCanvasLink | undefined {
  if (!('kind' in call) || call.name !== 'canvas_create' || call.isError
    || !Number.isSafeInteger(call.seq) || call.seq > closingSeq) return
  const text = call.content.filter(part => part.type === 'text').map(part => part.text).join('')
  if (text.length > MAX_MESSAGE_BYTES) return
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const receipt = value as Record<string, unknown>
    const canvasId = parseCanvasId(receipt.canvasId)
    if (receipt.status !== 'created' || !canvasId || receipt.address !== canvasAddress(canvasId)
      || typeof receipt.requestId !== 'string' || !receipt.requestId.trim() || receipt.requestId.length > 200
      || typeof receipt.name !== 'string' || !receipt.name.trim() || receipt.name.length > MAX_TITLE_LENGTH
      || !['ready', 'not_ready'].includes(String(receipt.runtime))) return
    return { canvasId, name: receipt.name }
  } catch { return }
}

/** Native projection already owns call pairing, nested PTC results and Session/history scope. */
export function createdCanvasLinks(tools: readonly ToolChatData[], closingSeq: number): CreatedCanvasLink[] {
  const links = new Map<string, CreatedCanvasLink>()
  const visit = (call: ToolCallBlock) => {
    const link = creation(call, closingSeq)
    if (link && !links.has(link.canvasId)) links.set(link.canvasId, link)
    call.subCalls.forEach(visit)
  }
  tools.forEach((tool) =>{  visit(tool.root) })
  return [...links.values()]
}
