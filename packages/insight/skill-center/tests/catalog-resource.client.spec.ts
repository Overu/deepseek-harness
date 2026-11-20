/** API field mapping, complete pagination, failed reads, and cancellation. */
import { describe, expect, it, vi } from 'vitest'
import { normalizeCatalog, skillCatalogResourceProvider } from '../src/client/skill-catalog-resource.ts'
import { Config } from '../src/config.ts'
import { CATALOG_FIXTURE, catalogResponse, catalogTransport } from './fixtures/catalog.ts'

const address = 'dsh-resource://insight-skill-catalog/catalog?attempt=0'
const first = CATALOG_FIXTURE.skills[0]!
const second = CATALOG_FIXTURE.skills[1]!
const read = (request: typeof fetch, signal = new AbortController().signal) =>
  collect(skillCatalogResourceProvider(Config({}), request).open(address, { signal }))

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const frames: T[] = []
  for await (const frame of source) frames.push(frame)
  return frames
}

describe('skill catalog API', () => {
  it('uses the list skillId as the installation technical name and maps published fields', () => {
    const skill = { ...first, skillId: 'runtime-name', skill_id: 'catalog-id', release: { runtimeSkillId: 'other-name' }, summary: 'Published summary', packageVersion: '3.0.0',
      packageUrl: 'https://example.com/current.zip', skill_desc: 'Old summary', version: '1.0.0', download_url: 'old.zip' }
    expect(normalizeCatalog({ records: [skill] })).toEqual([{
      id: 'runtime-name', name: first.name, summary: 'Published summary', version: '3.0.0',
      downloadUrl: 'https://example.com/current.zip', descriptionMarkdown: first.description_markdown,
    }])
  })

  it('keeps enabled installable skills, sorts them, and ignores opaque catalog ids', () => {
    expect(normalizeCatalog({ records: [second, { ...first, enabled: 0 },
      { ...first, id: '../opaque', name: ' ' }, null, 1] }))
      .toMatchObject([{ id: first.skillId, name: first.skillId }, { id: second.skillId }])
    expect(normalizeCatalog({ records: [{ ...first, packageVersion: null }, { ...second, packageUrl: null }] })).toEqual([])
  })

  it.each([null, [], {}, { records: 'broken' }, { records: [{ ...first, skillId: undefined }] },
    { records: [{ ...first, skillId: '../invalid' }] }, { records: [first, first] },
  ])('rejects malformed lists and duplicate technical names %j', (payload) => {
    expect(() => normalizeCatalog(payload)).toThrow()
  })

  it('requests only the official desktop list through the skill-center Host route', async () => {
    const request = vi.fn(catalogTransport({ skills: [first] }))
    expect(await read(request)).toMatchObject([{ ok: true, value: [{ id: first.skillId }] }])
    expect(request.mock.calls.map(call => call[0])).toEqual([
      '/insight-skill-center/api/skills?businessChannel=A&source=OFFICIAL&page=1&pageSize=50',
    ])
    expect(request.mock.calls[0]?.[1]).toMatchObject({ headers: { Accept: 'application/json' }, credentials: 'same-origin' })
    expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
  })

  it('collects every page without requesting per-skill details', async () => {
    const request = vi.fn(catalogTransport({ skills: [first, second] }))
      .mockResolvedValueOnce(Response.json(catalogResponse({ skills: [second] }, 2)))
      .mockResolvedValueOnce(Response.json(catalogResponse({ skills: [first] }, 2)))

    expect(await read(request)).toMatchObject([{ ok: true, value: [{ id: first.skillId }, { id: second.skillId }] }])
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1]?.[0]).toContain('page=2&pageSize=50')
  })

  it('ignores recommendations and entries without installable packages', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ code: 'SUCCESS', data: {
      records: [{ ...first, packageUrl: null }], total: 1, emptyFallback: [second],
    } }))
    expect(await read(request)).toMatchObject([{ ok: true, value: [] }])
    expect(request).toHaveBeenCalledOnce()
  })

  it.each([
    { code: 'USER_NOT_LOGIN', data: { records: [], total: 0 } },
    { code: 'SUCCESS', data: { wrong: [] } },
    { code: 'SUCCESS', data: { records: [], total: -1 } },
    { code: 'SUCCESS', data: { records: [], total: 1 } },
  ])('reports unsuccessful or inconsistent API pages %j', async (payload) => {
    expect(await read(vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload)))).toMatchObject([{ ok: false }])
  })

  it('fails the complete read if a later page fails', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(catalogResponse({ skills: [first] }, 2)))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
    expect(await read(request)).toMatchObject([{ ok: false, error: { code: 'gateway/internal' } }])
  })

  it.each(['http', 'json', 'network'] as const)('contains %s transport failures', async (kind) => {
    const request = vi.fn<typeof fetch>()
    switch (kind) {
      case 'http': request.mockResolvedValue(new Response('', { status: 503 })); break
      case 'json': request.mockResolvedValue(new Response('not json')); break
      case 'network': request.mockRejectedValue('offline'); break
    }
    expect(await read(request)).toMatchObject([{ ok: false, error: { code: 'gateway/internal' } }])
  })

  it.each(['resolve', 'reject'] as const)('does not publish a late %s after release', async (kind) => {
    const pending = Promise.withResolvers<Response>()
    const request = vi.fn<typeof fetch>().mockReturnValue(pending.promise)
    const controller = new AbortController()
    const result = read(request, controller.signal)
    await vi.waitFor(() => { expect(request).toHaveBeenCalledOnce() })
    controller.abort()
    if (kind === 'resolve') pending.resolve(Response.json(catalogResponse(CATALOG_FIXTURE)))
    else pending.reject(new Error('cancelled'))
    expect(await result).toEqual([])
  })

  it('does not start requests for an already released resource or an invalid address', async () => {
    const controller = new AbortController()
    controller.abort()
    const request = vi.fn<typeof fetch>()
    expect(await read(request, controller.signal)).toEqual([])
    for (const invalid of ['not-a-url', 'https://insight-skill-catalog/catalog', 'dsh-resource://insight-skill-catalog/other']) {
      expect(await collect(skillCatalogResourceProvider(Config({}), request).open(invalid, { signal: new AbortController().signal })))
        .toMatchObject([{ ok: false, error: { code: 'gateway/bad-request' } }])
    }
    expect(request).not.toHaveBeenCalled()
  })
})

it('expires a stalled request without aborting the resource lifetime', async () => {
  const request = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
    const signal = options?.signal
    if (!signal) throw new Error('Expected a cancellable directory request')
    signal.addEventListener('abort', () => { reject(new Error('Request aborted')) }, { once: true })
  }))
  const controller = new AbortController()
  expect(await collect(skillCatalogResourceProvider(Config({ catalogRequestTimeoutMs: 1 }), request)
    .open(address, { signal: controller.signal }))).toMatchObject([{ ok: false, error: { code: 'gateway/internal' } }])
  expect(controller.signal.aborted).toBe(false)
})
