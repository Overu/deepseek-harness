import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { serializeNodeRefs, splitNodeRefs } from '../shared/canvas-node-references.ts'
import type { CanvasHostBridge } from './canvas-bridge.ts'

export function registerCanvasReferenceMessages(ctx: Context, bridge: CanvasHostBridge): void {
  const staged = new Map<string, { messageId: string
    revision: number
    connectionId: string
    text: string }>()
  ctx.effect(() => () =>{  staged.clear() }, 'desktop-canvas: staged reference messages')
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter' || signal.aborted) return decision
    const sessionId = String(agent.session.id)
    const index = decision.messages.findIndex(message => message.source.kind === 'user')
    if (index < 0) return decision
    const message = decision.messages[index]
    if (splitNodeRefs(message.content).nodes.length) return decision
    const pending = bridge.getPendingReferences(sessionId)
    // Preserve the same snapshot when admission of this message is retried.
    const previous = staged.get(sessionId)
    const snapshot = previous?.messageId === message.id ? previous : pending ? {
      messageId: message.id, revision: pending.revision, connectionId: pending.connectionId, text: serializeNodeRefs(pending.items),
    } : undefined
    if (!snapshot) return decision
    staged.set(sessionId, snapshot)
    const messages = [...decision.messages]
    messages[index] = { ...message, content: [...message.content, { type: 'text', text: snapshot.text }] }
    return { ...decision, messages }
  }, { global: true })

  ctx.on('session/event', (session, event) => {
    const sessionId = String(session.id)
    const snapshot = staged.get(sessionId)
    if (!snapshot) return
    if (event.type === 'user/message') {
      const message: UserMessage = event.data
      if (message.id !== snapshot.messageId || !message.content.some(block => block.type === 'text' &&
 block.text === snapshot.text)) return
      staged.delete(sessionId)
      // Clear the Dock only after the modified user message has been durably admitted.
      bridge.consumeReferences(sessionId, snapshot.revision, message.id, snapshot.connectionId)
    } else if (event.type === 'turn/end') staged.delete(sessionId)
  }, { global: true })
}
