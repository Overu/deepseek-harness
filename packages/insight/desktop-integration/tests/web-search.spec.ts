/** Insight search uses the Main-owned token for each cancellable request. */
import { Context } from '@deepseek-ai/cordis'
import { WebError } from '@deepseek-ai/dsh-web'
import { afterEach, expect, it, vi } from 'vitest'
import { createInsightWebSearchProvider } from '../src/host/web-search.ts'

afterEach(() => { vi.unstubAllGlobals() })

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
