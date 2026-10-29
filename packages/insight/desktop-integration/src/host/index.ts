/** Cordis plugin mounting the Host-only Insight account-token capability. */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { InsightAccount } from '../host.ts'
import type { AuthEnvironment } from '../shared/auth-contracts.ts'
import { createInsightModelGatewayAdapter, INSIGHT_MODEL_PROVIDER } from './model-gateway.ts'

/** Stable Cordis plugin identity used by the Insight desktop profile. */
export const name = 'insight-desktop-integration'

/** This provider needs the Host LLM registry for its fixed Gateway route. */
export const inject: readonly string[] = ['llm']

/** Required deadline for private Main-to-Host credential requests. */
export interface Config {
  /** Maximum wait for Desktop Main to return an access token. */
  readonly requestTimeoutMs: number
  /** Fixed paired account and model service environment selected by the product build. */
  readonly serviceEnvironment: AuthEnvironment
}

/** Reject invalid deployment deadlines while loading the desktop profile. */
export const Config = Schema.object({
  requestTimeoutMs: Schema.number().min(1).max(2_147_483_647).required(),
  serviceEnvironment: Schema.union(['test', 'production'] as const).required(),
})

/**
 * Register the Host-only account service and fixed Insight Gateway route.
 * @param ctx - Host context that owns the composed integration lifecycle.
 * @param config - Validated product deployment settings.
 * @returns when both child providers are active, or rejects after rolling back their resources.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  let accountFiber!: ReturnType<Context['plugin']>
  let gatewayFiber!: ReturnType<Context['inject']>
  const dispose = ctx.effect(function* () {
    accountFiber = ctx.plugin((accountCtx) => {
      new InsightAccount(accountCtx, { requestTimeoutMs: config.requestTimeoutMs })
    })
    yield accountFiber.dispose

    gatewayFiber = ctx.inject(['insightAccount', 'llm'], (gatewayCtx) => {
      const adapter = createInsightModelGatewayAdapter(gatewayCtx, config.serviceEnvironment)
      const unregister = gatewayCtx.llm.registerAdapter([INSIGHT_MODEL_PROVIDER], adapter)
      gatewayCtx.effect(() => async () => {
        unregister()
        await adapter.dispose()
      }, 'insight-desktop: model gateway')
    })
    yield gatewayFiber.dispose
  }, 'insight-desktop: account and model gateway')
  try {
    await accountFiber
    await gatewayFiber
  } catch (error) {
    await dispose()
    throw error
  }
}
