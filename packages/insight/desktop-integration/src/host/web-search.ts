/** Insight-owned authenticated web-search provider. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-web'
import { DeepSeekSearchProvider } from '@deepseek-ai/dsh-web-search-deepseek'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import type { AuthEnvironment } from '../shared/auth-contracts.ts'
import { desktopServiceEnvironment } from '../shared/service-environment.ts'

/** The product search provider has its own id so DSH selection stays explicit. */
export const INSIGHT_WEB_SEARCH_PROVIDER = 'insight-enterprise-search'

/** Main-owned account capability required by product network providers. */
export interface InsightAccessTokenSource {
  /** Read a current account token without persisting it in the caller. */
  getAccessToken(signal?: AbortSignal): Promise<string>
}

/** Product search provider together with the lifecycle of its in-flight calls. */
export interface InsightWebSearchService {
  /** Provider registered with the public DSH Web registry. */
  readonly provider: WebSearchProvider
  /** Abort admitted requests and wait for their provider work to settle. */
  dispose(): Promise<void>
}

/**
 * Create the fixed Insight search provider.
 *
 * The upstream provider owns the Anthropic request protocol and cancellation
 * handling. A provider instance is created for each search so its credential
 * closure captures that search's signal; the token is never retained between
 * requests.
 * @param ctx - Context that records the model-visible auxiliary request.
 * @param environment - Product-selected backend environment.
 * @param account - Host-only Main account capability.
 * @returns provider suitable for `ctx.web.registerSearchProvider()`.
 */
export function createInsightWebSearchProvider(
  ctx: Context,
  environment: AuthEnvironment,
  account: InsightAccessTokenSource,
): WebSearchProvider {
  return createInsightWebSearchService(ctx, environment, account).provider
}

/**
 * Create the product search provider with an explicit teardown operation.
 * @param ctx - Context that records the model-visible auxiliary request.
 * @param environment - Product-selected backend environment.
 * @param account - Host-only Main account capability.
 * @returns provider registration value plus its abort-and-drain lifecycle.
 */
export function createInsightWebSearchService(
  ctx: Context,
  environment: AuthEnvironment,
  account: InsightAccessTokenSource,
): InsightWebSearchService {
  const service = desktopServiceEnvironment(environment)
  const lifetime = new AbortController()
  const operations = new Set<Promise<void>>()
  let closed = false
  const create = (signal?: AbortSignal) => new DeepSeekSearchProvider(() => ({
    baseURL: service.modelBaseUrl.replace(/\/$/u, ''),
    resolveAccountToken: async () => await account.getAccessToken(signal),
    model: 'enterprise-search',
    apiVersion: '2023-06-01',
    maxTokens: 4096,
    maxUses: 5,
    recordRequest: (request) => {
      ctx.get('agents')?.currentInitiator()?.session.append('web/deepseek-search-llm-request', request)
    },
  }))
  const provider: WebSearchProvider = {
    id: INSIGHT_WEB_SEARCH_PROVIDER,
    available: () => create().available(),
    ready: () => Promise.resolve(true),
    search: async (request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> => {
      if (closed) throw new Error('Insight enterprise search is stopping')
      const requestSignal = signal === undefined ? lifetime.signal : AbortSignal.any([signal, lifetime.signal])
      const operation = create(requestSignal).search(request, requestSignal)
      const settled = operation.then(() => undefined, () => undefined)
      operations.add(settled)
      void settled.finally(() => { operations.delete(settled) })
      return await operation
    },
  }
  return {
    provider,
    async dispose(): Promise<void> {
      if (closed) return
      closed = true
      lifetime.abort()
      await Promise.all([...operations])
    },
  }
}
