/** Insight search uses the Main-owned token for each cancellable request. */
import { Context } from '@deepseek-ai/cordis'
import { WebError } from '@deepseek-ai/dsh-web'
import { afterEach, expect, it, vi } from 'vitest'
import { createInsightWebSearchProvider, createInsightWebSearchService } from '../src/host/web-search.ts'

afterEach(() => { vi.unstubAllGlobals() })

it.each([
  { environment: 'test', baseURL: 'https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1' },
  { environment: 'production', baseURL: 'https://gapi.insight-aigc.com/insight-harness-llm-gateway/v1' },
] as const)('authenticates $environment native searches with the current Bearer token', async ({ environment, baseURL }) => {
  const context = new Context()
  const token = vi.fn<() => Promise<string>>()
    .mockResolvedValueOnce('first-user-token')
    .mockResolvedValueOnce('second-user-token')
  const service = createInsightWebSearchService(context, environment, { getAccessToken: token })
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ content: [{
    type: 'web_search_tool_result',
    content: [{ type: 'web_search_result', url: 'https://search.example/result', title: 'Search result' }],
  }] }))
  vi.stubGlobal('fetch', fetch)
  try {
    for (const expectedToken of ['first-user-token', 'second-user-token']) {
      await expect(service.provider.search({ query: 'native search' })).resolves.toEqual({
        sources: [{ url: 'https://search.example/result', title: 'Search result' }],
        truncated: false,
      })
      const [url, init] = fetch.mock.calls.at(-1) ?? []
      expect(url).toBe(`${baseURL}/messages`)
      expect(init?.method).toBe('POST')
      expect(init?.redirect).toBe('error')
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe(`Bearer ${expectedToken}`)
      expect(headers.get('x-api-key')).toBe(expectedToken)
      expect(headers.has('x-dsh-auth-token')).toBe(false)
      expect(headers.get('anthropic-version')).toBe('2023-06-01')
      expect(init?.body).toBe(JSON.stringify({
        model: 'enterprise-search',
        max_tokens: 4096,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Perform a web search for the query: native search' }] }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        thinking: { type: 'disabled' },
      }))
    }
    expect(token).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  } finally {
    await service.dispose()
    await context.fiber.dispose()
  }
})

it('cancels the Main token request before dispatching a search', async () => {
  const context = new Context()
  const token = vi.fn(async (signal?: AbortSignal) => await new Promise<string>((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      reject(signal.reason instanceof Error ? signal.reason : new Error('cancelled'))
    }, { once: true })
  }))
  const provider = createInsightWebSearchProvider(context, 'test', { getAccessToken: token })
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const controller = new AbortController()
  const pending = provider.search({ query: 'cancelled search' }, controller.signal)
  controller.abort(new Error('cancelled'))
  await expect(pending).rejects.toMatchObject({ code: 'WEB_ABORTED' } satisfies Partial<WebError>)
  const [tokenSignal] = token.mock.calls[0] ?? []
  expect(tokenSignal?.aborted).toBe(true)
  expect(tokenSignal?.reason).toBe(controller.signal.reason)
  expect(fetch).not.toHaveBeenCalled()
  await context.fiber.dispose()
})
