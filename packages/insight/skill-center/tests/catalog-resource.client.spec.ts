/** OSS catalog normalization, failed reads, and cancellation at the resource provider. */
import { describe, expect, it, vi } from 'vitest'
import { normalizeCatalog, skillCatalogResourceProvider } from '../src/client/skill-catalog-resource.ts'
import { Config } from '../src/config.ts'
import { CATALOG_FIXTURE } from './fixtures/catalog.ts'

const address = 'dsh-resource://insight-skill-catalog/catalog?attempt=0'

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const frames: T[] = []
  for await (const frame of source) frames.push(frame)
  return frames
}

describe('OSS catalog', () => {
  it('keeps enabled skills by technical name, sorts them, and maps remote display fields', () => {
    const first = CATALOG_FIXTURE.skills[0]!
    const second = CATALOG_FIXTURE.skills[1]!
    const skills = normalizeCatalog({ skills: [second, { ...first, enabled: 0 }, first] })
    expect(skills).toHaveLength(2)
    expect(skills.map(skill => skill.id)).toEqual([first.skill_id, second.skill_id])
    expect(skills[0]).toMatchObject({
      name: first.name, summary: first.skill_desc, version: first.version,
      descriptionMarkdown: first.description_markdown,
    })
  })

  it('uses catalog defaults for absent names, summaries, and versions', () => {
    expect(normalizeCatalog({ skills: [{ skill_id: ' demo ', enabled: '1' }] })).toMatchObject([
      { id: 'demo', name: 'demo', summary: '', version: '1.0.0' },
    ])
  })

  it.each([null, [], {}, { skills: 'broken' }])('rejects malformed catalog data %j', (payload) => {
    expect(() => normalizeCatalog(payload)).toThrow()
  })

  it('rejects duplicate enabled technical names', () => {
    expect(() => normalizeCatalog({ skills: [CATALOG_FIXTURE.skills[0], CATALOG_FIXTURE.skills[0]] })).toThrow()
  })

  it('ignores opaque OSS IDs and requires a technical name', () => {
    expect(normalizeCatalog({ skills: [{ ...CATALOG_FIXTURE.skills[0], id: '../other-skill' }] })[0]).toMatchObject({ id: CATALOG_FIXTURE.skills[0]!.skill_id })
    expect(() => normalizeCatalog({ skills: [{ ...CATALOG_FIXTURE.skills[0], skill_id: ' ' }] })).toThrow()
  })

  it('ignores missing, changed, duplicate, and invalid OSS ids', () => {
    const first = CATALOG_FIXTURE.skills[0]!
    const second = CATALOG_FIXTURE.skills[1]!
    const skills = normalizeCatalog({ skills: [
      { ...first, id: undefined },
      { ...second, id: '../invalid-id' },
      { ...second, id: undefined, skill_id: 'replacement-skill' },
      { ...second, id: '../invalid-id', skill_id: 'another-skill' },
    ] })
    expect(skills.map(skill => skill.id)).toEqual([
      first.skill_id, second.skill_id, 'replacement-skill', 'another-skill',
    ])
  })

  it('rejects duplicate technical names even when OSS ids differ', () => {
    const first = CATALOG_FIXTURE.skills[0]!
    expect(() => normalizeCatalog({ skills: [first, { ...first, id: 99, name: 'Duplicate' }] })).toThrow()
  })

  it('requests the fixed OSS JSON with a cache-busting query, Accept header, and resource signal', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(CATALOG_FIXTURE))
    const controller = new AbortController()
    const frames = await collect(skillCatalogResourceProvider(Config({}), request).open(address, { signal: controller.signal }))
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ ok: true, value: normalizeCatalog(CATALOG_FIXTURE) })
    expect(request).toHaveBeenCalledOnce()
    const [url, options] = request.mock.calls[0]!
    expect(url).toEqual(expect.stringMatching(
      /^https:\/\/insight-desktop-updates\.oss-cn-guangzhou\.aliyuncs\.com\/desktop\/skills\/skills\.json\?_=/,
    ))
    expect(options).toMatchObject({ headers: { Accept: 'application/json' } })
    expect(options?.signal?.aborted).toBe(false)
  })

  it.each(['http', 'json', 'network', 'data'] as const)('reports %s failures as a resource failure frame', async (kind) => {
    const request = vi.fn<typeof fetch>()
    switch (kind) {
      case 'http': request.mockResolvedValue(new Response('', { status: 503 })); break
      case 'json': request.mockResolvedValue(new Response('not json')); break
      case 'network': request.mockRejectedValue(new TypeError('offline')); break
      case 'data': request.mockResolvedValue(Response.json({ wrong: [] })); break
    }
    const frames = await collect(skillCatalogResourceProvider(Config({}), request).open(address, { signal: new AbortController().signal }))
    expect(frames).toHaveLength(1)
    const frame = frames[0]
    if (frame?.ok !== false) throw new Error('Expected a resource failure frame')
    expect(frame.error.code).toBe(kind === 'data' ? 'gateway/bad-request' : 'gateway/internal')
  })

  it('does not publish a response that arrives after the resource was released', async () => {
    const pending = Promise.withResolvers<Response>()
    const request = vi.fn<typeof fetch>().mockReturnValue(pending.promise)
    const controller = new AbortController()
    const result = collect(skillCatalogResourceProvider(Config({}), request).open(address, { signal: controller.signal }))
    await vi.waitFor(() => { expect(request).toHaveBeenCalledOnce() })
    controller.abort()
    pending.resolve(Response.json(CATALOG_FIXTURE))
    expect(await result).toEqual([])
  })
})

it('expires stalled requests without aborting the resource lifetime', async () => {
  const request = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
    const signal = options?.signal
    if (!signal) throw new Error('Expected a cancellable directory request')
    signal.addEventListener('abort', () => { reject(new Error('Request aborted')) }, { once: true })
  }))
  const controller = new AbortController()
  const result = collect(skillCatalogResourceProvider(Config({ catalogRequestTimeoutMs: 1 }), request)
    .open(address, { signal: controller.signal }))
  expect(await result).toMatchObject([{ ok: false, error: { code: 'gateway/internal' } }])
  expect(controller.signal.aborted).toBe(false)
})

it('keeps stable retry addresses and declines unsupported resource addresses', async () => {
  const request = vi.fn<typeof fetch>()
  for (const invalid of ['not-a-url', 'https://insight-skill-catalog/catalog', 'dsh-resource://insight-skill-catalog/other']) {
    const frames = await collect(skillCatalogResourceProvider(Config({}), request).open(invalid, { signal: new AbortController().signal }))
    expect(frames).toMatchObject([{ ok: false, error: { code: 'gateway/bad-request' } }])
  }
  expect(request).not.toHaveBeenCalled()
})

it('does not start a request for an already released resource', async () => {
  const controller = new AbortController()
  controller.abort()
  const request = vi.fn<typeof fetch>()
  expect(await collect(skillCatalogResourceProvider(Config({}), request).open(address, { signal: controller.signal }))).toEqual([])
  expect(request).not.toHaveBeenCalled()
})

it('contains non-Error transport failures and cancellation rejections', async () => {
  const rejected = vi.fn<typeof fetch>().mockRejectedValue('connection unavailable')
  const frames = await collect(skillCatalogResourceProvider(Config({}), rejected).open(address, { signal: new AbortController().signal }))
  expect(frames).toMatchObject([{ ok: false, error: { code: 'gateway/internal', message: 'connection unavailable' } }])
  const controller = new AbortController()
  const pending = Promise.withResolvers<Response>()
  const request = vi.fn<typeof fetch>().mockReturnValue(pending.promise)
  const result = collect(skillCatalogResourceProvider(Config({}), request).open(address, { signal: controller.signal }))
  controller.abort()
  pending.reject(new Error('cancelled'))
  expect(await result).toEqual([])
})

it('places invalid sort values with the default order and skips non-record entries', () => {
  const first = CATALOG_FIXTURE.skills[0]!
  const skills = normalizeCatalog({ skills: [null, 1, { ...first, sort: 'not a number' }, CATALOG_FIXTURE.skills[1]] })
  expect(skills.map(skill => skill.id)).toEqual([first.skill_id, CATALOG_FIXTURE.skills[1]!.skill_id])
})
