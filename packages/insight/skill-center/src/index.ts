/** Host configuration for the browser skill directory. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Config } from './config.ts'
import { InsightPlatformSkills } from './host/platform-skills.ts'
import { InsightSkillInventory } from './host/skill-inventory.ts'

export { Config } from './config.ts'
export { InsightPlatformSkills } from './host/platform-skills.ts'
export { InsightSkillInventory } from './host/skill-inventory.ts'
export type {
  InsightSkillId,
  InstalledPlatformSkill,
  PlatformSkillInstallProgress,
  PlatformSkillInstallRequest,
  PlatformSkillOperationId,
  PlatformSkillOperationSettlement,
  PlatformSkillSnapshot,
  PlatformSkillKey,
  SkillIdentity,
  PlatformSkillRemovalRequest,
} from './shared/skill-installation.ts'

/** Stable Cordis plugin identity used by the Insight bundle. */
export const name = 'insight-skill-center'

/** Installation contributes an ordinary provider to the global skill registry. */
export const inject = ['skills']

/**
 * Start account skill storage and the injected expert inventory, then publish browser configuration.
 * @param ctx - Host serving the browser application.
 * @param config - Directory request limits applied when the page loads.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  validateAllowedOrigins(config.packageAllowedOrigins)
  const desktopLegacyDirectory = process.env.DSH_INSIGHT_LEGACY_SKILL_DIR
  const effectiveConfig = Object.assign({}, config, {
    legacySkillDirs: [...new Set([...config.legacySkillDirs, ...desktopLegacyDirectory === undefined ? [] : [desktopLegacyDirectory]])],
  })
  const platformSkills = new InsightPlatformSkills(ctx, effectiveConfig)
  await platformSkills.initialize()
  await ctx.plugin(InsightSkillInventory)
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: '__INSIGHT_SKILL_CENTER_CONFIG__', value: effectiveConfig })
  })
}

/** Reject values that would turn an origin allowlist into a path or credential match. */
function validateAllowedOrigins(origins: readonly string[]): void {
  if (origins.length === 0) throw new Error('Insight skill downloads require at least one allowed origin')
  for (const value of origins) {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.origin !== value) {
      throw new Error(`Insight skill download origin must be a complete HTTPS origin: ${value}`)
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    insightPlatformSkills: InsightPlatformSkills
  }
}
