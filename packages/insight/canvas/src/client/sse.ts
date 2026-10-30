import { CanvasAgentError, MAX_MESSAGE_BYTES } from '../shared/canvas-agent-protocol.ts'
/** A bounded SSE decoder; comments and heartbeat never become business commands. */
export async function consumeSse(body: ReadableStream<Uint8Array>, receive: (value: unknown) => void): Promise<void> {
  const reader = body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = '', data: string[] = [], bytes = 0
  const line = (text: string) => {
    if (text === '') { if (data.length) receive(JSON.parse(data.join('\n'))); data = []; bytes = 0; return }
    bytes += new TextEncoder().encode(text).byteLength + 1
    if (bytes > MAX_MESSAGE_BYTES + 100) throw new CanvasAgentError('BRIDGE_OVERLOADED', 'SSE 事件超过上限')
    if (text.startsWith(':')) return
    if (text === 'data' || text.startsWith('data:')) {
      const value = text === 'data' ? '' : text.slice(5).replace(/^ /, '')
      data.push(value)
    }
  }
  try {
    for (;;) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let index: number
      while ((index = buffer.indexOf('\n')) !== -1) { const current = buffer.slice(0, index).replace(/\r$/, '')
        buffer = buffer.slice(index + 1); line(current) }
      if (new TextEncoder().encode(buffer).byteLength + bytes > MAX_MESSAGE_BYTES + 100) throw new CanvasAgentError('BRIDGE_OVERLOADED', 'SSE 事件超过上限')
      if (done) break
    }
    // An incomplete final event is discarded; it never authorizes a command.
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
