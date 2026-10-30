import { describe, expect, it, vi } from 'vitest'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { DEFAULT_CONFIG } from '../src/config'
import { registerEnhanceRoute } from '../src/enhance-routes'
import { ENHANCE_ENDPOINT, ENHANCE_STREAM_ENDPOINT } from '../src/shared/protocol'

describe('Prompt Enhance connection routes', () => {
  it('registers exact authenticated API routes instead of a webserver prefix', async () => {
    const routes: ConnectionFetchRoute[] = []
    const ctx = {
      connection: {
        fetch: { register: vi.fn((route: ConnectionFetchRoute) => { routes.push(route); return async (): Promise<void> => {} }) },
      },
      effect: (install: () => unknown) => install(),
    } as never
    registerEnhanceRoute(ctx, () => Object.assign({}, DEFAULT_CONFIG, { enabled: false }))

    expect(routes.map(route => route.path)).toEqual([ENHANCE_ENDPOINT, ENHANCE_STREAM_ENDPOINT])
    const response = await routes[0]!.fetch(new Request('http://host/api/prompt-enhance', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'draft' }),
    }))
    expect(response.status).toBe(403)
  })
})
