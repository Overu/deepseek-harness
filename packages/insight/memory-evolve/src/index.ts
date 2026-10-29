/**
 * Host entry for the fixed Memory Evolve source snapshot.
 *
 * The upstream host was distributed only as JavaScript. It lives in
 * `src/host` so a clean build never treats a generated `lib` directory as
 * its authority.
 */
import type { Context } from '@deepseek-ai/cordis'
import { apply as applySnapshot } from './host/index.js'

/** Loader identity retained for existing profile rows and persisted plugin configuration. */
export const name = 'dsh-memory-evolve'
/** Services required by the upstream host plugin. */
export const inject = ['tools', 'systemPrompt', 'agents', 'sessionTitle', 'sessionPersistence', 'settings', 'llm']

/**
 * Configuration accepted by the fixed upstream Host snapshot.
 *
 * The Host resolves and validates these fields through its own `resolveConfig`
 * routine because the archived JavaScript source has no static schema.
 */
export type Config = Record<string, unknown>

/** Mount the fixed upstream host implementation. */
export function apply(ctx: Context, config: Config = {}): void {
  applySnapshot(ctx, config)
}
