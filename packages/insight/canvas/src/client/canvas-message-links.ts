/** Navigation for Canvas links rendered by Chat. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { canvasAddress, canvasIdFromAddress } from '../shared/protocol.ts'

/**
 * Open valid Canvas links from the on-screen assistant reply in its Session's sidebar.
 * @param ctx - Canvas client plugin context.
 */
export function registerCanvasMessageLinks(ctx: Context): void {
  ctx.effect(() => {
    const document = window.document
    const open = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      if (!(event.target instanceof Element)) return
      const link = event.target.closest('a[href]')
      if (link === null) return
      const id = canvasIdFromAddress(link.getAttribute('href') ?? '')
      if (id === undefined) return

      const reply = link.closest('[data-chat-flow-kind="assistant-step"]')
      if (reply === null || reply.getAttribute('data-chat-group-part') === 'reasoning') return
      const session = reply.closest('[data-conversation-session]')?.getAttribute('data-conversation-session')
      if (session == null || session !== ctx.sidebarRight.mounted.getSnapshot()) return

      event.preventDefault()
      ctx.sidebarRight.openResource(canvasAddress(id))
    }
    document.addEventListener('click', open)
    return () => { document.removeEventListener('click', open) }
  }, 'desktop-canvas: assistant links')
}
