/** Insight skill center registrations for the sidebar and main panel. */
import type { Context } from '@deepseek-ai/cordis'
import skillCenterRemote from '@insight-ai/skill-center/remote'
export type {} from '@insight-ai/skill-center/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { SkillCenterPage } from './SkillCenterPage.tsx'
import { SkillInstallOverlay } from './SkillInstallOverlay.tsx'
import { PresetSkillBootstrap } from './PresetSkillBootstrap.tsx'
import { createSkillInstallationController } from './skill-installation-controller.ts'
import { InsightSkillPicker, type InsightSkillPickerInjected } from './InsightSkillPicker.tsx'
import { SkillCenterIcon } from './SkillCenterIcon.tsx'
import { createSkillCenterToastSource, SkillCenterToast } from './SkillCenterToast.tsx'
import { en, zh } from './locales.ts'
import { Config } from '../config.ts'
import { skillCatalogResourceProvider } from './skill-catalog-resource.ts'
import { platformSkillInstallationResourceProvider } from './skill-installation-resource.ts'
import type { PlatformSkillInstallRequest, PlatformSkillOperationId, PlatformSkillRemovalRequest, SkillIdentity } from '../shared/skill-installation.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Skill center navigation and overview copy. */
    'insight.skillCenter': keyof typeof zh
  }
}

/** Required browser services for localized slot registrations. */
export const inject = ['slots', 'locale', 'resources', 'remote', 'layout']

/**
 * Register the skill center immediately after Plugins and its matching main panel.
 * @param ctx - Browser plugin context.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(skillCenterRemote)
  const registrations = ctx.inject(['remote.insightPlatformSkills', 'remote.insightSkills'], registerSkillCenter)
  try { await registrations } catch (error) { await registrations.dispose(); await unmount(); throw error }
  return async () => { await registrations.dispose(); await unmount() }
}

/** Register UI contributions after the platform-skill Remote is mounted. */
function registerSkillCenter(ctx: Context): void {
  const config = Config((globalThis as { __INSIGHT_SKILL_CENTER_CONFIG__?: unknown }).__INSIGHT_SKILL_CENTER_CONFIG__ ?? {})
  const namespace = 'insight.skillCenter'
  const panelId = 'insight-skill-center' as MainPanelId
  ctx.effect(() => ctx.locale.register(namespace, { en, zh }))
  ctx.effect(() => ctx.resources.register(skillCatalogResourceProvider(config)))
  ctx.effect(() => ctx.resources.register(platformSkillInstallationResourceProvider(ctx.remote.insightPlatformSkills)))
  const t = ctx.locale.bind(namespace)
  const notices = createSkillCenterToastSource()
  const installations = createSkillInstallationController({
    install: (request: PlatformSkillInstallRequest, signal?: AbortSignal) => ctx.remote.insightPlatformSkills.installSkill(request, signal),
    cancel: (operationId: PlatformSkillOperationId) => ctx.remote.insightPlatformSkills.cancel(operationId),
  }, notices.report)
  ctx.effect(() => () => installations.dispose(), 'skill-center installation lifetime')
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: panelId, locale: namespace,
    inject: () => ({
      report: notices.report,
      installations,
      hooks: { revision: installations.hooks.revision },
      remove: (request: PlatformSkillRemovalRequest, signal?: AbortSignal) => ctx.remote.insightPlatformSkills.removeSkill(request, signal),
    }),
  }, SkillCenterPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: panelId, order: 1,
    label: () => t('title'), locale: namespace,
  }, SkillCenterIcon))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'insight-skill-center.feedback', locale: namespace,
    inject: () => ({ hooks: notices.hooks, dismiss: notices.dismiss }),
  }, SkillCenterToast))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'insight-skill-center.installation', locale: namespace,
    inject: () => ({ cancel: () => { installations.cancel() }, hooks: { active: installations.hooks.active } }),
  }, SkillInstallOverlay))
  if (config.presetSkillIds.length > 0) {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'insight-skill-center.presets',
      inject: () => ({
        installations,
        listPendingPresets: (catalogue: readonly SkillIdentity[]) => ctx.remote.insightPlatformSkills.listPendingPresets(catalogue),
        waitForInstallation: (identity: SkillIdentity) => ctx.remote.insightPlatformSkills.waitForInstallation(identity),
      }),
    }, PresetSkillBootstrap))
  }
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'insight-skills', order: -100, locale: namespace,
    inject: (): InsightSkillPickerInjected => ({
      openSkillCenter: () => { ctx.layout.selectPanel(panelId) },
      loadInventory: async (sessionId, signal) => {
        const result = await ctx.remote.insightSkills.list({ sessionId }, signal)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
    }),
  }, InsightSkillPicker))
}
