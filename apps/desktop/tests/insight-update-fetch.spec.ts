/** The Electron adapter fills missing URLs without relaxing the signed source's response checks. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveInsightUpdate } from '@insight-ai/desktop-integration/desktop'

const fetch = vi.hoisted(() => vi.fn<typeof globalThis.fetch>())
vi.mock('electron', () => ({ net: { fetch } }))
const { fetchInsightUpdate } = await import('../src/insight-update-fetch.ts')

const url = 'https://updates.example.test/desktop/stable/current.json'
beforeEach(() => { fetch.mockReset() })

describe('Insight Electron update fetch', () => {
  it.each([url, new URL(url), new Request(url)])('fills an absent response URL for %s and retains the body and request options', async (input) => {
    const response = new Response('verified bytes')
    fetch.mockResolvedValueOnce(response)
    const options = { redirect: 'error' as const, signal: new AbortController().signal, headers: { 'Cache-Control': 'no-cache' } }
    const result = await fetchInsightUpdate(input, options)
    expect(result).toBe(response)
    expect(result.url).toBe(url)
    expect(await result.text()).toBe('verified bytes')
    expect(fetch).toHaveBeenCalledWith(input instanceof Request ? input : String(input), options)
  })

  it('leaves an already populated response URL unchanged', async () => {
    const response = new Response('bytes')
    Object.defineProperty(response, 'url', { value: url })
    fetch.mockResolvedValueOnce(response)
    expect(await fetchInsightUpdate(url, { redirect: 'error' })).toBe(response)
    expect(response.url).toBe(url)
  })

  it.each([undefined, 'follow', 'manual'] as const)('rejects redirect mode %s before requesting metadata', async (redirect) => {
    await expect(fetchInsightUpdate(url, redirect === undefined ? undefined : { redirect })).rejects.toThrow('must reject redirects')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { responseUrl: 'https://unexpected.example.test/current.json', redirected: false },
    { responseUrl: '', redirected: true },
  ])('keeps the resolver rejection for $responseUrl / redirected=$redirected', async ({ responseUrl, redirected }) => {
    const response = new Response('untrusted bytes')
    Object.defineProperty(response, 'url', { value: responseUrl })
    Object.defineProperty(response, 'redirected', { value: redirected })
    fetch.mockResolvedValueOnce(response)
    await expect(resolveInsightUpdate({
      track: 'stable', target: 'darwin-arm64', distributionOrigin: 'https://updates.example.test',
      publicKeyPem: 'not used before URL validation', fetch: fetchInsightUpdate,
    })).rejects.toThrow('not a trusted successful same-origin response')
    expect(response.url).toBe(responseUrl)
    expect(response.bodyUsed).toBe(false)
    await response.body?.cancel()
  })

  it('retains non-success status for the resolver to handle', async () => {
    const response = new Response('missing', { status: 404 })
    fetch.mockResolvedValueOnce(response)
    const result = await fetchInsightUpdate(url, { redirect: 'error' })
    expect(result.status).toBe(404)
    expect(result.url).toBe(url)
    await result.body?.cancel()
  })

  it('propagates the original transport failure', async () => {
    const failure = new Error('network unavailable')
    fetch.mockRejectedValueOnce(failure)
    await expect(fetchInsightUpdate(url, { redirect: 'error' })).rejects.toBe(failure)
  })
})
