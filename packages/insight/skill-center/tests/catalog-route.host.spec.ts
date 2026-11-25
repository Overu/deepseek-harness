/** Authentication, forwarding, and lifecycle of the skill-center catalogue route. */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { InsightAccountAccessError } from '@insight-ai/desktop-integration/host'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { startSkillCatalogRoute } from '../src/host/catalog-route.ts'
import { SKILL_CATALOG_PATH, SKILL_CATEGORIES_PATH } from '../src/shared/catalog-api.ts'

const list = `${SKILL_CATALOG_PATH}?businessChannel=A&source=OFFICIAL&page=1&pageSize=50`
const categories = `${SKILL_CATEGORIES_PATH}?businessChannels=A`
const json = (value: object) => Response.json(value)

async function fixture(options: {
  rejection?: 401 | 403
  token?: (signal: AbortSignal) => Promise<string>
  transport?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
  gatewayOrigin?: string
} = {}) {
  const routes = new Map<string, WebRoute>()
  const token = vi.fn(options.token ?? (() => Promise.resolve('account-token')))
  const transport = vi.fn(options.transport ?? (() => Promise.resolve(json({ code: 'SUCCESS', data: {} }))))
  const dispose = startSkillCatalogRoute({
    connection: { requestRejection: () => options.rejection }, token, transport,
    gatewayOrigin: options.gatewayOrigin ?? 'https://gapi-test.insight-aigc.com',
    timeoutMs: options.timeoutMs ?? 5000, maxResponseBytes: options.maxResponseBytes ?? 1024,
    register(value) { routes.set(value.path, value); return () => { routes.delete(value.path) } },
  })
  const server = createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0] ?? ''
    const route = [...routes.values()].find(value => path.startsWith(value.path))
    if (route === undefined) { response.writeHead(404); response.end(); return }
    void route.handler(request, response)
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  onTestFinished(async () => {
    await dispose()
    await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
  })
  return { url, token, transport, dispose }
}

describe('skill catalogue route', () => {
  it('releases the catalogue route if category registration fails', () => {
    const release = vi.fn()
    const register = vi.fn<(route: WebRoute) => () => void>()
      .mockReturnValueOnce(release).mockImplementationOnce(() => { throw new Error('registration failed') })
    expect(() => startSkillCatalogRoute({
      connection: { requestRejection: () => undefined }, token: () => Promise.resolve('token'),
      register, gatewayOrigin: 'https://example.com', timeoutMs: 1000, maxResponseBytes: 1024, transport: fetch,
    })).toThrow('registration failed')
    expect(release).toHaveBeenCalledOnce()
  })

  it('forwards the A-line categories with the account credential', async () => {
    const { url, token, transport } = await fixture()
    const response = await fetch(`${url}${categories}`, { headers: { token: 'forged' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(token).toHaveBeenCalledOnce()
    expect(transport).toHaveBeenCalledWith(
      'https://gapi-test.insight-aigc.com/game-ai-editor-center/api/skill-categories?businessChannels=A',
      expect.objectContaining({ headers: { token: 'account-token', accept: 'application/json' }, redirect: 'error' }),
    )
  })

  it('rejects unauthorized or modified category requests before reading credentials', async () => {
    const { url, token, transport } = await fixture()
    for (const path of [SKILL_CATEGORIES_PATH, `${categories}&businessChannels=D`, `${categories}&token=forged`,
      categories.replace('businessChannels=A', 'businessChannels=D'), `${SKILL_CATEGORIES_PATH}/other?businessChannels=A`]) {
      expect((await fetch(`${url}${path}`)).status).toBe(400)
    }
    expect((await fetch(`${url}${categories}`, { method: 'POST' })).status).toBe(405)
    expect(token).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
    const denied = await fixture({ rejection: 401 })
    expect((await fetch(`${denied.url}${categories}`)).status).toBe(401)
    expect(denied.token).not.toHaveBeenCalled()
  })

  it.each(['https://gapi-test.insight-aigc.com', 'https://gapi-dsh.idealead.com'])
  ('forwards the list to the selected environment %s', async (origin) => {
    const { url, token, transport } = await fixture({ gatewayOrigin: origin })
    const response = await fetch(`${url}${list}`, { headers: { token: 'forged', authorization: 'Bearer forged' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ code: 'SUCCESS', data: {} })
    expect(token).toHaveBeenCalledOnce()
    expect(transport.mock.calls.map(([address]) => address)).toEqual([
      `${origin}/game-ai-editor-center/api/skills?businessChannel=A&source=OFFICIAL&page=1&pageSize=50`,
    ])
    expect(transport.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET', headers: { token: 'account-token', accept: 'application/json' }, redirect: 'error',
    })
    expect([...new Headers(transport.mock.calls[0]?.[1]?.headers).keys()].sort()).toEqual(['accept', 'token'])
  })

  it.each([401, 403] as const)('denies browser rejection %s before obtaining credentials', async (rejection) => {
    const { url, token, transport } = await fixture({ rejection })
    expect((await fetch(`${url}${list}`)).status).toBe(rejection)
    expect(token).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })

  it('rejects unsupported methods, paths, queries, and pagination before obtaining credentials', async () => {
    const { url, token, transport } = await fixture()
    const paths = [
      `${SKILL_CATALOG_PATH}/wrong/path?businessChannel=A`,
      `${SKILL_CATALOG_PATH}/%2e%2e/other?businessChannel=A`,
      `${SKILL_CATALOG_PATH}/UPPER?businessChannel=A`,
      `${list}&token=forged`, `${list}&page=2`,
      list.replace('page=1', 'page=0'), list.replace('page=1', 'page=10001'),
      list.replace('pageSize=50', 'pageSize=51'), list.replace('source=OFFICIAL', 'source=CREATOR'),
      list.replace('businessChannel=A', 'businessChannel=D'),
      `${SKILL_CATALOG_PATH}/skill-one?businessChannel=A`,
    ]
    expect((await fetch(`${url}${list}`, { method: 'POST' })).status).toBe(405)
    for (const path of paths) expect((await fetch(`${url}${path}`)).status).not.toBe(200)
    expect(token).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })

  it('contains upstream failures and refuses oversized or non-JSON content', async () => {
    for (const response of [
      new Response('upstream-private', { status: 503 }),
      new Response('private', { headers: { 'content-type': 'text/plain' } }),
      new Response('{"length":"too large"}', { headers: { 'content-type': 'application/json' } }),
    ]) {
      const { url } = await fixture({ transport: () => Promise.resolve(response), maxResponseBytes: 8 })
      const result = await fetch(`${url}${list}`)
      expect(result.status).toBeGreaterThanOrEqual(500)
      expect(await result.text()).not.toContain('private')
    }
  })

  it('does not expose account credentials in upstream failures', async () => {
    const { url } = await fixture({ transport: () => Promise.reject(new Error('account-token private failure')) })
    const response = await fetch(`${url}${list}`)
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('account-token')
  })

  it('cancels stalled upstream calls when their budget expires', async () => {
    const { url } = await fixture({ timeoutMs: 5, transport: (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true })
    }) })
    expect((await fetch(`${url}${list}`)).status).toBe(504)
  })

  it('reports an expired account without sending a request upstream', async () => {
    const { url, transport } = await fixture({ token: () => Promise.reject(new InsightAccountAccessError('expired')) })
    const response = await fetch(`${url}${list}`)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'LOGIN_REQUIRED' })
    expect(transport).not.toHaveBeenCalled()
  })

  it('cancels upstream work when the browser disconnects', async () => {
    const started = Promise.withResolvers<undefined>()
    const stopped = Promise.withResolvers<undefined>()
    const { url } = await fixture({ transport: (_input, init) => new Promise((_resolve, reject) => {
      started.resolve(undefined)
      init?.signal?.addEventListener('abort', () => { stopped.resolve(undefined); reject(new Error('aborted')) }, { once: true })
    }) })
    const controller = new AbortController()
    const request = fetch(`${url}${list}`, { signal: controller.signal }).catch(() => undefined)
    await started.promise
    controller.abort()
    await stopped.promise
    await request
  })

  it('cancels a response stream after crossing the configured size limit', async () => {
    const cancelled = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(9)) },
      cancel() { cancelled() },
    })
    const { url } = await fixture({ maxResponseBytes: 8,
      transport: () => Promise.resolve(new Response(stream, { headers: { 'content-type': 'application/json' } })) })
    expect((await fetch(`${url}${list}`)).status).toBe(502)
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('withdraws admission and waits for an aborted in-flight request to finish on disposal', async () => {
    const started = Promise.withResolvers<undefined>()
    const unblock = Promise.withResolvers<undefined>()
    const stopped = Promise.withResolvers<undefined>()
    const { url, dispose } = await fixture({ transport: async (_input, init) => {
      started.resolve(undefined)
      await new Promise<void>((resolve) => { init?.signal?.addEventListener('abort', () => { resolve() }, { once: true }) })
      stopped.resolve(undefined)
      await unblock.promise
      throw new Error('aborted')
    } })
    onTestFinished(() => { unblock.resolve(undefined) })
    const request = fetch(`${url}${list}`).catch(() => undefined)
    await started.promise
    const disposed = vi.fn()
    const disposal = dispose().then(disposed)
    await stopped.promise
    expect(disposed).not.toHaveBeenCalled()
    expect((await fetch(`${url}${list}`)).status).toBe(404)
    unblock.resolve(undefined)
    await disposal
    await request
    expect(disposed).toHaveBeenCalledOnce()
  })
})
