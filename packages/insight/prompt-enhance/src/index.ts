/**
 * Host half of the prompt-enhance plugin: the `prompt-enhance` settings
 * section, the POST /prompt-enhance/enhance route (LLM call through
 * ctx.llm, route resolved by precedence: settings pair → session request
 * header → harness default model), and the /enhance slash command. The
 * browser half (exports "./client") contributes the composer button, the
 * preview panel, and the undo bar.
 * @module dsh-prompt-enhance
 */

import type { Context } from '@deepseek-ai/cordis'
import { DEFAULT_CONFIG, resolveConfig, type Config } from './config.ts'
import { registerEnhanceRoute } from './enhance-routes.ts'
import { registerEnhanceCommand } from './enhance-command.ts'

export const name = 'prompt-enhance'
export const inject = ['llm', 'webServer']

export { Config, DEFAULT_CONFIG, PROMPT_ENHANCE_NAMESPACE, resolveConfig } from './config.ts'
export type { StrategyMode } from './config.ts'
export { DEFAULT_SYSTEM_PROMPT, frameUserPrompt } from './prompts.ts'
export { enhanceText, formatEnhanceError, resolveRoute, toEnhanceError } from './enhancer.ts'
export type { EnhanceCallOptions, LlmStreamFace, RoutePair, UpstreamReason } from './enhancer.ts'
export { normalizeOutput } from './shared/normalize.ts'
export { checkInputText } from './shared/validate.ts'
export { ENHANCE_ENDPOINT } from './shared/protocol.ts'
export type { EnhanceError, EnhanceResult, EnhanceRequestBody, EnhanceResponse, EnhanceErrorCode } from './shared/protocol.ts'

/**
 * Mount the host half. The settings section layers over the composition
 * entry and is re-resolved per request, so Settings → 插件配置 changes reach
 * the very next call.
 *
 * Besides the declared `inject` services (llm, webServer — both required),
 * the host half optionally reads three more through `ctx.get` with
 * `undefined` fallbacks, degrading gracefully when absent:
 * - `sessions` — the session's logged request route (model routing);
 * - `settings` — the harness default model (`agent-default-model`);
 * - `commands` — the `/enhance` slash command registration.
 * @param ctx - registrant context.
 * @param config - deployment configuration (schema defaults filled by the loader).
 */
export function apply(ctx: Context, config: Config = { ...DEFAULT_CONFIG }): void {
  const readConfig = (): Config => resolveConfig(config)
  registerEnhanceRoute(ctx, readConfig)
  registerEnhanceCommand(ctx, readConfig)
}
