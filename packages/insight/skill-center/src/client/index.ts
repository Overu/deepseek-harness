/** Insight skill center registrations for the sidebar and main panel. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { SkillCenterPage } from './SkillCenterPage.tsx'
import { SkillCenterIcon } from './SkillCenterIcon.tsx'
import { createSkillCenterToastSource, SkillCenterToast } from './SkillCenterToast.tsx'
import { en, zh } from './locales.ts'
import { Config } from '../config.ts'
import { skillCatalogResourceProvider } from './skill-catalog-resource.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Skill center navigation and overview copy. */
    'insight.skillCenter': keyof typeof zh
  }
}

/** Required browser services for localized slot registrations. */
export const inject = ['slots', 'locale', 'resources']

/**
 * Register the skill center immediately after Plugins and its matching main panel.
 * @param ctx - Browser plugin context.
 */
export function apply(ctx: Context): void {
  const config = Config((globalThis as { __INSIGHT_SKILL_CENTER_CONFIG__?: unknown }).__INSIGHT_SKILL_CENTER_CONFIG__ ?? {})
  const namespace = 'insight.skillCenter'
  const panelId = 'insight-skill-center' as MainPanelId
  ctx.effect(() => ctx.locale.register(namespace, { en, zh }))
  ctx.effect(() => ctx.resources.register(skillCatalogResourceProvider(config)))
  const t = ctx.locale.bind(namespace)
  const notices = createSkillCenterToastSource()
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: panelId, locale: namespace,
    inject: () => ({ report: notices.report }),
  }, SkillCenterPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: panelId, order: 1,
    label: () => t('title'), locale: namespace,
  }, SkillCenterIcon))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'insight-skill-center.feedback', locale: namespace,
    inject: () => ({ hooks: notices.hooks, dismiss: notices.dismiss }),
  }, SkillCenterToast))
}
