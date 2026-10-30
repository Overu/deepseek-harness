/** Product business services layered on the public DSH Host registries. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-shell-env'
import type {} from '@deepseek-ai/dsh-web'
import type { AuthEnvironment } from '../shared/auth-contracts.ts'
import { skillProxyServiceBaseUrl } from '../shared/service-environment.ts'
import type {} from '../host.ts'
import { createInsightSkillProxyRequest } from './skill-proxy-request.ts'
import { insightSkillProxyRuntimePaths, registerInsightSkillProxyEnvironment } from './skill-proxy-environment.ts'
import { startInsightSkillProxy, type InsightSkillProxyLimits } from './skill-proxy.ts'
import { createInsightWebSearchService } from './web-search.ts'

/** The started business services and their ordered shutdown operation. */
export interface InsightBusinessServices {
  /** Stop public admission, abort work, drain it, then release proxy resources. */
  dispose(): Promise<void>
}

/** Product configuration required by authenticated Host business services. */
export interface InsightBusinessServiceConfig extends InsightSkillProxyLimits {
  /** Fixed paired account and skill service environment. */
  readonly environment: AuthEnvironment
}

/**
 * Start Insight's authenticated Web provider and local bundled-skill proxy.
 *
 * `DSH_HOME` is the account-isolated directory selected by Desktop Main before
 * the Host starts. Bundled skills locate the published descriptor from this
 * stable location; no token or backend URL reaches their process environment.
 * @param ctx - Host context already carrying the account and Web services.
 * @param config - Product-selected service environment and local proxy budgets.
 * @returns started services whose owner must dispose them before `insightAccount`.
 */
export async function startInsightBusinessServices(
  ctx: Context,
  config: InsightBusinessServiceConfig,
): Promise<InsightBusinessServices> {
  const home = process.env.DSH_HOME
  if (home === undefined || home.length === 0) {
    throw new Error('Insight business services require the account-scoped DSH_HOME')
  }
  const search = createInsightWebSearchService(ctx, config.environment, ctx.insightAccount)
  const unregisterSearch = ctx.web.registerSearchProvider(search.provider)
  let stopProxy: (() => Promise<void>) | undefined
  let unregisterProxyEnvironment: (() => void) | undefined
  try {
    stopProxy = await startInsightSkillProxy(
      createInsightSkillProxyRequest(skillProxyServiceBaseUrl(config.environment), ctx.insightAccount),
      home,
      config,
    )
    unregisterProxyEnvironment = registerInsightSkillProxyEnvironment(ctx, insightSkillProxyRuntimePaths())
  } catch (error) {
    unregisterSearch()
    const results = await Promise.allSettled([search.dispose(), stopProxy?.()])
    const failed = results.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') {
      throw new AggregateError([error, failed.reason], 'Insight business service startup rollback failed')
    }
    throw error
  }
  const unregisterEnvironment = unregisterProxyEnvironment
  const stop = stopProxy
  return {
    async dispose(): Promise<void> {
      // Removing the provider first prevents new callers from capturing the
      // service while its cancellation signal and account capability unwind.
      unregisterEnvironment()
      unregisterSearch()
      const results = await Promise.allSettled([search.dispose(), stop()])
      const failed = results.find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    },
  }
}
