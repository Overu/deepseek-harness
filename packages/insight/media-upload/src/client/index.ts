/** Client contribution for persisted image-layer result cards. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { layeringResultsDefinition } from './layering-results.ts'
import { LayeringResultCards, NS, zh, en } from './LayeringResultCards.tsx'

export const inject = ['uiConversation', 'slots', 'locale']

/** Register one plugin-owned footer for downloadable result files. */
export function apply(ctx: Context): void {
  ctx.uiConversation.events.register(layeringResultsDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'insight-media-upload: result card copy')
  ctx.effect(() => ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail', id: '@insight-ai/desktop-media-upload-plugin-results', locale: NS,
    inject: sessionId => ({ mediaSessionId: String(sessionId) }),
  }, LayeringResultCards)), 'insight-media-upload: result cards')
}
