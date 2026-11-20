/** Insight-specific DSH workspace branding and account footer registrations. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { AssistantMessageNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InsightAccountApi } from '../shared/desktop-api.ts'
import { toolArgumentFailure } from '../shared/tool-argument-failure.ts'
import { InsightAccountFooter, type InsightAccountFooterInjected } from './AccountFooter.tsx'
import { InsightAccountSettings, type InsightAccountSettingsInjected } from './AccountSettings.tsx'
import { InsightAccountSource } from './account-source.ts'
import { InsightBrandMark, InsightBrandName } from './Brand.tsx'
import { InsightSettingsLauncher, type InsightSettingsLauncherInjected } from './SettingsLauncher.tsx'

/** Required service: the generic browser slot registry. */
export const inject = ['slots']

/**
 * Replace generic DSH product branding and expose the Main-owned account summary.
 * The account bridge is optional so ordinary Web clients keep their existing UI.
 * @param ctx - Root client context.
 */
export function apply(ctx: Context): void {
  registerProductUi(ctx)
  ctx.inject(['uiConversation', 'locale'], (client) => {
    const locale = client.get('locale') as { resolveText(text: { en: string; zh: string }): string }
    client.uiConversation.events.register({
      kind: 'insight-trajectory-rejected-tool-call',
      target: 'trajectory',
      match: (event) => {
        if (event.type === 'assistant/attempt') return { id: String(event.data.turn), role: 'start' }
        if (event.type === 'turn/end' && event.data.reason.kind === 'error' && event.data.reason.error.code === 'MALFORMED_RESPONSE') {
          return { id: String(event.data.turn), role: 'update' }
        }
        return null
      },
      start: () => null,
      update: () => null,
      publication: match => match.event.type === 'assistant/attempt' ? 'none' : 'immediate',
      buildViewNode: ({ key, id, kind, matches }) => {
        const end = matches.at(-1)
        const attempt = matches.at(-2)?.event
        if (end?.event.type !== 'turn/end' || attempt?.type !== 'assistant/attempt') return null
        const diagnostic = toolArgumentFailure(attempt.data.stream)
        if (diagnostic === undefined) return null
        const { seq, time } = end.event
        const { turn, step } = attempt.data
        const text = locale.resolveText({ en: 'Parameter parsing failed. Tool did not run', zh: '参数解析失败，未执行' })
        const node: AssistantMessageNode = {
          kind: 'assistant', seq, time, turn, step, interrupted: true,
          blocks: [{ kind: 'text', text: `${diagnostic.name} · ${text}` }],
        }
        return { key, id, kind, target: 'trajectory', anchorSeq: seq, location: end.location, data: { kind: 'node', node } }
      },
    })
  })
}

function registerProductUi(ctx: Context): void {
  const bridge = (globalThis as typeof globalThis & { insightAccount?: InsightAccountApi }).insightAccount
  const account = new InsightAccountSource(bridge)
  ctx.effect(() => () => { account.dispose() }, 'insight desktop account bridge')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, InsightBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, InsightBrandName)
    }))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
    name: 'conversation.hero.brand.mark',
  }, InsightBrandMark))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'insight-account', order: -100,
    inject: (): InsightAccountFooterInjected => ({
      signOut: () => account.signOut(),
      openSettings: () => { account.openSettings() },
      hooks: { account: account.store },
    }),
  }, InsightAccountFooter))
  ctx.slots.inject('settings.launcher', () => ctx.slots.register({
    name: 'settings.launcher',
    inject: (): InsightSettingsLauncherInjected => ({ hooks: { requests: account.settingsRequests } }),
  }, InsightSettingsLauncher))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'insight', order: -100, label: '因赛AI',
    inject: (): InsightAccountSettingsInjected => ({ hooks: { account: account.store } }),
  }, InsightAccountSettings))
}
