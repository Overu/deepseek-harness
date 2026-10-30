/** Insight-specific DSH workspace branding and account footer registrations. */
import insightSkillsRemote from '@insight-ai/desktop-integration/remote'
export type {} from '@insight-ai/desktop-integration/remote'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InsightAccountApi } from '../shared/desktop-api.ts'
import { InsightAccountFooter, type InsightAccountFooterInjected } from './AccountFooter.tsx'
import { InsightAccountSettings, type InsightAccountSettingsInjected } from './AccountSettings.tsx'
import { InsightAccountSource } from './account-source.ts'
import { InsightBrandMark, InsightBrandName } from './Brand.tsx'
import { InsightSettingsLauncher, type InsightSettingsLauncherInjected } from './SettingsLauncher.tsx'
import { InsightSkillPicker, type InsightSkillPickerInjected } from './InsightSkillPicker.tsx'

/** Required service: the generic browser slot registry. */
export const inject = ['slots', 'remote']

/**
 * Replace generic DSH product branding and expose the Main-owned account summary.
 * The account bridge is optional so ordinary Web clients keep their existing UI.
 * @param ctx - Root client context.
 * @returns disposer removing the product UI before its generated Remote contribution.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(insightSkillsRemote)
  const ui = ctx.inject(['remote.insightSkills'], registerProductUi)
  try { await ui } catch (error) { await ui.dispose(); await unmount(); throw error }
  return async () => { await ui.dispose(); await unmount() }
}

function registerProductUi(ctx: Context): void {
  const inventory = ctx.remote.insightSkills
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
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'insight-skills', order: -100,
    inject: (): InsightSkillPickerInjected => ({
      loadInventory: async (sessionId, signal) => {
        const result = await inventory.list({ sessionId }, signal)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
    }),
  }, InsightSkillPicker))

}
