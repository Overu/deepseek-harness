/** Cordis plugin mounting the Host-only Insight account-token capability. */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { InsightAccount } from '../host.ts'
import type { AuthEnvironment } from '../shared/auth-contracts.ts'
import { startInsightBusinessServices } from './business-services.ts'
import { InsightSkillInventory } from './skill-inventory.ts'
import { createInsightModelGatewayAdapter, INSIGHT_MODEL_PROVIDER } from './model-gateway.ts'

/** Stable Cordis plugin identity used by the Insight desktop profile. */
export const name = 'insight-desktop-integration'

/** This provider needs the Host LLM registry for its fixed Gateway route. */
export const inject: readonly string[] = ['llm', 'web', 'shellEnv']

/** Required deadline for private Main-to-Host credential requests. */
export interface Config {
  /** Maximum wait for Desktop Main to return an access token. */
  readonly requestTimeoutMs: number
  /** Fixed paired account and model service environment selected by the product build. */
  readonly serviceEnvironment: AuthEnvironment
  /** Maximum concurrent skill operations; overflow is rejected before upstream dispatch. */
  readonly skillProxyMaxActiveRequests: number
  /** Maximum bytes retained across accepted local skill request bodies. */
  readonly skillProxyMaxBufferedRequestBytes: number
  /** Complete skill request deadline, including long-running media streams. */
  readonly skillProxyRequestTimeoutMs: number
}

/** Reject invalid deployment deadlines while loading the desktop profile. */
export const Config = Schema.object({
  requestTimeoutMs: Schema.number().min(1).max(2_147_483_647).required(),
  serviceEnvironment: Schema.union(['test', 'production'] as const).required(),
  skillProxyMaxActiveRequests: Schema.number().min(1).max(64).step(1).required(),
  skillProxyMaxBufferedRequestBytes: Schema.number().min(1).max(128 * 1024 * 1024).step(1).required(),
  skillProxyRequestTimeoutMs: Schema.number().min(1).max(2_147_483_647).step(1).required(),
})

/**
 * Register the Host-only account service, managed model, authenticated Web and skill inventory.
 * @param ctx - Host context that owns the composed integration lifecycle.
 * @param config - Validated product deployment settings.
 * @returns when all child providers are active, or rejects after rolling back their resources.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  let accountFiber!: ReturnType<Context['plugin']>
  let gatewayFiber!: ReturnType<Context['inject']>
  let businessFiber!: ReturnType<Context['inject']>
  let inventoryFiber!: ReturnType<Context['plugin']>
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

    businessFiber = ctx.inject(['insightAccount', 'web', 'shellEnv'], async (businessCtx) => {
      const services = await startInsightBusinessServices(businessCtx, {
        environment: config.serviceEnvironment,
        maxActiveRequests: config.skillProxyMaxActiveRequests,
        maxBufferedRequestBytes: config.skillProxyMaxBufferedRequestBytes,
        requestTimeoutMs: config.skillProxyRequestTimeoutMs,
      })
      businessCtx.effect(() => () => services.dispose(), 'insight-desktop: authenticated business services')
    })
    yield businessFiber.dispose
    inventoryFiber = ctx.plugin(InsightSkillInventory)
    yield inventoryFiber.dispose
  }, 'insight-desktop: account and business consumers')
  try {
    await accountFiber
    await gatewayFiber
    await businessFiber
    await inventoryFiber
  } catch (error) {
    await dispose()
    throw error
  }
}
