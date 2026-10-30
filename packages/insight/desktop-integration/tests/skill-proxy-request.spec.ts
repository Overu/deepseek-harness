import { describe, expect, it, vi } from 'vitest'
import { InsightAccountAccessError } from '../src/host/account-service.ts'
import { InsightSkillProxyError, createInsightSkillProxyRequest } from '../src/host/skill-proxy-request.ts'

describe('createInsightSkillProxyRequest', () => {
  it('forwards cancellation to token resolution and never starts the upstream request', async () => {
    const controller = new AbortController()
    const account = {
      getAccessToken: vi.fn(async (signal?: AbortSignal) => await new Promise<string>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(signal.reason instanceof Error ? signal.reason : new Error('cancelled'))
        }, { once: true })
      })),
    }
    const transport = vi.fn<typeof fetch>()
    const request = createInsightSkillProxyRequest('https://service.example.test/insight-harness-service', account, transport)
    const pending = request('/api/skill-proxy/media-generator', { method: 'POST', signal: controller.signal })

    controller.abort(new Error('closed'))

    await expect(pending).rejects.toEqual(expect.objectContaining({
      status: 503, code: 'SKILL_PROXY_NOT_SUBMITTED',
    }))
    expect(account.getAccessToken).toHaveBeenCalledWith(controller.signal)
    expect(transport).not.toHaveBeenCalled()
  })

  it('maps an expired account into a local login-required response', async () => {
    const account = { getAccessToken: async () => { throw new InsightAccountAccessError('expired') } }
    const request = createInsightSkillProxyRequest('https://service.example.test', account)

    await expect(request('/api/skill-proxy/tikhub', { method: 'POST' })).rejects.toEqual(
      new InsightSkillProxyError(401, 'LOGIN_REQUIRED'),
    )
  })

  it('recognizes an upstream HTTP-200 login envelope without exposing it to the local skill', async () => {
    const account = { getAccessToken: async () => 'account-token' }
    const transport = vi.fn<typeof fetch>(async () => new Response('{"code":"USER_NOT_LOGIN"}', {
      headers: { 'content-type': 'application/json' },
    }))
    const request = createInsightSkillProxyRequest('https://service.example.test', account, transport)

    await expect(request('/api/skill-proxy/tikhub', { method: 'POST' })).rejects.toEqual(
      new InsightSkillProxyError(401, 'LOGIN_REQUIRED'),
    )
  })

  it('preserves the service base path and recognizes a nested detail login code', async () => {
    const account = { getAccessToken: async () => 'account-token' }
    const transport = vi.fn<typeof fetch>(async () => new Response('{"detail":{"code":"USER_NOT_LOGIN"}}', {
      headers: { 'content-type': 'application/json' },
    }))
    const request = createInsightSkillProxyRequest(
      'https://service.example.test/insight-harness-service/', account, transport,
    )

    await expect(request('/api/skill-proxy/tikhub', { method: 'POST' })).rejects.toEqual(
      new InsightSkillProxyError(401, 'LOGIN_REQUIRED'),
    )
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport.mock.calls[0]?.[0]).toBe(
      'https://service.example.test/insight-harness-service/api/skill-proxy/tikhub',
    )
  })

  it('reports an unknown outcome and never retries when transport fails after dispatch starts', async () => {
    const account = { getAccessToken: async () => 'account-token' }
    const transport = vi.fn(async () => { throw new Error('connection reset') })
    const request = createInsightSkillProxyRequest('https://service.example.test', account, transport)

    await expect(request('/api/skill-proxy/media-generator', { method: 'POST', body: '{}' })).rejects.toEqual(
      expect.objectContaining({ status: 502, code: 'SKILL_PROXY_OUTCOME_UNKNOWN' }),
    )
    expect(transport).toHaveBeenCalledTimes(1)
  })
})
