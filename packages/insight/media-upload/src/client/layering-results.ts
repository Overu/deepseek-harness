/** Rebuild remote result cards from first-party tool results in the Session log. */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { parseLayeringDelivery, type LayeringFile } from '../shared/layering-files.ts'

export interface LayeringCard {
  readonly seq: number
  readonly taskHandle: string
  readonly imageLabel: string
  readonly complete: boolean
  readonly files: readonly LayeringFile[]
}

interface LayeringState { readonly turn: number
  readonly calls: ReadonlySet<string>
  readonly cards: readonly LayeringCard[] }

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap { 'insight-layering-results': readonly LayeringCard[] }
}

/** Persisted tool results remain visible when the conversation is reopened. */
export const layeringResultsDefinition: ConversationNodeDefinition<LayeringState> = {
  kind: 'insight-layering-results',
  match(event) {
    if (event.type === 'turn/start' || event.type === 'tool/call' || event.type === 'tool/result') {
      return { id: String(event.data.turn), role: event.type === 'turn/start' ? 'start' : 'update' }
    }
    return null
  },
  start(_context, match) {
    if (match.event.type !== 'turn/start') throw new Error('Layering result requires a turn start.')
    return { turn: match.event.data.turn, calls: new Set<string>(), cards: [] }
  },
  update(context, match) {
    if (match.event.type === 'tool/call') {
      if (match.event.data.name !== 'cache_image_layering_result') return context.state
      return { ...context.state, calls: new Set([...context.state.calls, String(match.event.data.callId)]) }
    }
    if (match.event.type !== 'tool/result' || match.event.data.message.isError) return context.state
    const message = match.event.data.message
    if (!context.state.calls.has(String(message.source.callId))) return context.state
    const text = message.content.find(part => part.type === 'text')
    if (text?.type !== 'text') return context.state
    let value: unknown
    try { value = JSON.parse(text.text) as unknown } catch { return context.state }
    const delivery = parseLayeringDelivery(value)
    if (!delivery) return context.state
    const card: LayeringCard = { seq: match.event.seq, taskHandle: delivery.taskHandle,
      imageLabel: delivery.imageLabel, complete: delivery.complete, files: delivery.files }
    return { ...context.state, cards: [...context.state.cards, card] }
  },
  buildLocationData(context, scope) {
    if (scope !== 'turn' || !context.state || context.state.cards.length === 0) return null
    return { kind: 'turn', turn: context.state.turn, key: 'insight-layering-results', value: context.state.cards }
  },
}
