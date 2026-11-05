/** Host configuration for the browser skill directory. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Config } from './config.ts'

export { Config } from './config.ts'

/**
 * Publish validated request limits to browser pages.
 * @param ctx - Host serving the browser application.
 * @param config - Directory request limits applied when the page loads.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: '__INSIGHT_SKILL_CENTER_CONFIG__', value: config })
  })
}
