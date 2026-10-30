import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { startInsightSkillProxy, waitForInsightSkillProxyDrain } from '../src/host/skill-proxy.ts'

const cleanup: Array<() => Promise<void>> = []
const limits = { maxActiveRequests: 8, maxBufferedRequestBytes: 16 * 1024 * 1024, requestTimeoutMs: 1_250_000 }

function controlled<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

describe('Insight skill proxy', () => {
  it('releases a response backpressure wait when the complete request deadline aborts', async () => {
    const output = new EventEmitter()
    const controller = new AbortController()
    const pending = waitForInsightSkillProxyDrain(output, controller.signal)

    expect(output.listenerCount('drain')).toBe(1)
    expect(output.listenerCount('close')).toBe(1)
    controller.abort(new Error('request deadline'))

    await expect(pending).rejects.toThrow('request deadline')
    expect(output.listenerCount('drain')).toBe(0)
    expect(output.listenerCount('close')).toBe(0)
  })

  it('publishes an account-local descriptor, forwards one permitted request, and removes only its descriptor', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-insight-skill-proxy-'))
    cleanup.push(async () => { await rm(home, { recursive: true, force: true }) })
    const request = vi.fn(async () => new Response('{"type":"result"}\n', {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson' },
    }))
    const stop = await startInsightSkillProxy(request, home, limits)
    cleanup.push(stop)
    const descriptorPath = join(home, 'skill-proxy', 'connection.json')
    const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8')) as { url: string; capability: string }

    const response = await fetch(`${descriptor.url}/proxy/tikhub`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${descriptor.capability}` },
      body: JSON.stringify({ method: 'GET', path: '/api/v1/search' }),
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"type":"result"}\n')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('/api/skill-proxy/tikhub', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ method: 'GET', path: '/api/v1/search' }),
    }))
    if (process.platform !== 'win32') expect((await stat(descriptorPath)).mode & 0o777).toBe(0o600)

    await stop()
    cleanup.splice(cleanup.indexOf(stop), 1)
    await expect(readFile(descriptorPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not finish stopping or remove its descriptor until an admitted handler settles', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-insight-skill-proxy-drain-'))
    cleanup.push(async () => { await rm(home, { recursive: true, force: true }) })
    const started = controlled<undefined>()
    const release = controlled<Response>()
    const request = vi.fn(async () => { started.resolve(undefined); return await release.promise })
    const stop = await startInsightSkillProxy(request, home, limits)
    cleanup.push(stop)
    const descriptorPath = join(home, 'skill-proxy', 'connection.json')
    const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8')) as { url: string; capability: string }
    const local = fetch(`${descriptor.url}/proxy/tikhub`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${descriptor.capability}` }, body: '{}',
    }).catch(() => undefined)
    await started.promise

    let stopped = false
    const stopping = stop().then(() => { stopped = true })
    await local

    expect(stopped).toBe(false)
    expect(await readFile(descriptorPath, 'utf8')).toContain(descriptor.capability)
    release.resolve(new Response('', { status: 200, headers: { 'content-type': 'application/x-ndjson' } }))
    await stopping
    cleanup.splice(cleanup.indexOf(stop), 1)
    await expect(readFile(descriptorPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects aggregate buffering overflow before another upstream dispatch', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-insight-skill-proxy-budget-'))
    cleanup.push(async () => { await rm(home, { recursive: true, force: true }) })
    const started = controlled<undefined>()
    const release = controlled<Response>()
    const request = vi.fn(async () => { started.resolve(undefined); return await release.promise })
    const body = JSON.stringify({ value: 'retained request body' })
    const stop = await startInsightSkillProxy(request, home, {
      maxActiveRequests: 2, maxBufferedRequestBytes: Buffer.byteLength(body) + 1, requestTimeoutMs: 1_250_000,
    })
    cleanup.push(stop)
    const descriptor = JSON.parse(await readFile(join(home, 'skill-proxy', 'connection.json'), 'utf8')) as { url: string; capability: string }
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${descriptor.capability}` }
    const first = fetch(`${descriptor.url}/proxy/tikhub`, { method: 'POST', headers, body }).catch(() => undefined)
    await started.promise

    const buffered = await fetch(`${descriptor.url}/proxy/media-generator`, { method: 'POST', headers, body: '{}' })

    expect(buffered.status).toBe(429)
    expect(await buffered.json()).toEqual({ error: { code: 'SKILL_PROXY_OVERLOADED' } })
    expect(request).toHaveBeenCalledTimes(1)
    release.resolve(new Response('', { status: 200, headers: { 'content-type': 'application/x-ndjson' } }))
    await first
  })

  it('rejects work beyond the active-request limit without dispatching it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-insight-skill-proxy-active-'))
    cleanup.push(async () => { await rm(home, { recursive: true, force: true }) })
    const started = controlled<undefined>()
    const release = controlled<Response>()
    const request = vi.fn(async () => { started.resolve(undefined); return await release.promise })
    const stop = await startInsightSkillProxy(request, home, { ...limits, maxActiveRequests: 1 })
    cleanup.push(stop)
    const descriptor = JSON.parse(await readFile(join(home, 'skill-proxy', 'connection.json'), 'utf8')) as { url: string; capability: string }
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${descriptor.capability}` }
    const first = fetch(`${descriptor.url}/proxy/tikhub`, { method: 'POST', headers, body: '{}' }).catch(() => undefined)
    await started.promise

    const overloaded = await fetch(`${descriptor.url}/proxy/tikhub`, { method: 'POST', headers, body: '{}' })

    expect(overloaded.status).toBe(429)
    expect(request).toHaveBeenCalledTimes(1)
    release.resolve(new Response('', { status: 200, headers: { 'content-type': 'application/x-ndjson' } }))
    await first
  })
})
