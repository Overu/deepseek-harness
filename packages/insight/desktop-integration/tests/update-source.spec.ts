/** Trusted update metadata discovery. */

import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { resolveInsightUpdate } from '../src/desktop/update/source.ts'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const ORIGIN = 'https://updates.example.test'
const targets = ['darwin-arm64', 'darwin-x64', 'win32-x64'] as const

interface Fixture {
  readonly publicKeyPem: string
  readonly responses: Map<string, Uint8Array>
  readonly sign: (value: object) => Uint8Array
}

/** Construct signed canonical release records without contacting a distribution service. */
function fixture(
  track: 'stable' | 'candidate',
  version: string,
  metadataPayloadName?: string,
  writesDataSchema?: Partial<Record<typeof targets[number], number>>,
  protocol: 'v2' | 'v3' = track === 'stable' ? 'v2' : 'v3',
): Fixture {
  const keys = generateKeyPairSync('ed25519')
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const responses = new Map<string, Uint8Array>()
  const signBytes = (value: object): Uint8Array => new Uint8Array(sign(null, json(value), keys.privateKey))
  const manifest = (target: typeof targets[number]) => {
    const [platform, arch] = target.split('-') as ['darwin' | 'win32', 'arm64' | 'x64']
    const payload = platform === 'darwin' ? `Insight-${version}-${arch}.zip` : `Insight-Setup-${version}.exe`
    const metadata = protocol === 'v3'
      ? `insight-${version}-${target}.yml`
      : platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml'
    const artifacts = [
      ...(platform === 'darwin' ? [{ platform, arch, kind: 'dmg', name: `Insight-${version}-${arch}.dmg`, size: 2, sha512: hash('dmg') }] : []),
      { platform, arch, kind: platform === 'darwin' ? 'zip' : 'nsis', name: payload, size: 3, sha512: hash('payload') },
      { platform, arch, kind: 'blockmap', name: `${payload}.blockmap`, size: 4, sha512: hash('blockmap') },
      { platform, arch, kind: 'updater-metadata', name: metadata, size: 0, sha512: '' },
    ]
    const metadataPayload = metadataPayloadName ?? payload
    const metadataBytes = Buffer.from(`version: ${version}\nfiles:\n  - url: ${metadataPayload}\n    sha512: ${hash('payload')}\n    size: 3\npath: ${metadataPayload}\nsha512: ${hash('payload')}\n`)
    const metadataAsset = artifacts.at(-1)
    if (metadataAsset === undefined) throw new Error('Missing metadata fixture.')
    metadataAsset.size = metadataBytes.length
    metadataAsset.sha512 = hash(metadataBytes)
    return { schema: `insight-desktop-target/${protocol}`, version, target: { platform, arch }, shellCommit: COMMIT, coreRuntime: { tag: '1.0.9', commit: COMMIT }, compatibility: { profileSchema: 1, accountStorageSchema: 1, readsDataSchema: { minimum: 1, maximum: 1 }, writesDataSchema: writesDataSchema?.[target] ?? 1 }, artifacts, metadata, metadataBytes }
  }
  const manifests = new Map(targets.map(target => [target, manifest(target)]))
  const base = (target: string) => protocol === 'v3'
    ? `${ORIGIN}/desktop/native/releases/v${version}/targets/${target}/`
    : `${ORIGIN}/desktop/releases/v${version}/targets/${target}/`
  for (const [target, document] of manifests) {
    const { metadata, metadataBytes, ...signedManifest } = document
    const bytes = json(signedManifest)
    responses.set(`${base(target)}insight-target.json`, bytes)
    responses.set(`${base(target)}insight-target.json.sig`, signBytes(signedManifest))
    responses.set(`${base(target)}${metadata}`, metadataBytes)
  }
  const selected = manifests.get('darwin-arm64')
  if (selected === undefined) throw new Error('Missing selected target fixture.')
  let reference: string
  if (track === 'stable') {
    const index = { schema: 'insight-desktop-release/v2', version, shellCommit: COMMIT, coreRuntime: { tag: '1.0.9', commit: COMMIT }, targets: targets.map((id) => {
      const document = manifests.get(id)
      if (document === undefined) throw new Error('Missing target fixture.')
      const { metadata, metadataBytes, ...signedManifest } = document
      void metadata
      void metadataBytes
      return { id, manifestSha512: hash(json(signedManifest)) }
    }) }
    const indexBytes = json(index)
    responses.set(`${ORIGIN}/desktop/releases/v${version}/insight-release.json`, indexBytes)
    responses.set(`${ORIGIN}/desktop/releases/v${version}/insight-release.json.sig`, signBytes(index))
    reference = hash(indexBytes)
  } else {
    const { metadata, metadataBytes, ...signedManifest } = selected
    void metadata
    void metadataBytes
    reference = hash(json(signedManifest))
  }
  const rollout = { schema: `insight-desktop-rollout/${protocol}`, state: 'active', track, version, ...(track === 'candidate' ? { target: 'darwin-arm64' } : {}), referencedSha512: reference, policy: { mode: 'optional', minimumSupportedVersion: '1.0.9' }, publishedAt: '2026-10-30T00:00:00.000Z' }
  const rolloutBytes = json(rollout)
  const envelope = { schema: `insight-desktop-rollout-envelope/${protocol}`, payloadBase64: Buffer.from(rolloutBytes).toString('base64'), signatureBase64: Buffer.from(sign(null, rolloutBytes, keys.privateKey)).toString('base64') }
  const pointer = track === 'stable' ? `${ORIGIN}/desktop/stable/current.json` : `${ORIGIN}/desktop/candidate-${protocol}/darwin-arm64/current.json`
  responses.set(pointer, json(envelope))
  return { publicKeyPem, responses, sign: signBytes }
}

/** Add a V3 candidate pointer and its selected target documents using the fixture's signer. */
function addV3Candidate(data: Fixture, version: string, state: 'active' | 'rejected' = 'active'): void {
  const target = 'darwin-arm64'
  const payload = `Insight-${version}-arm64.zip`
  const metadataName = `insight-${version}-${target}.yml`
  const metadataBytes = Buffer.from(`version: ${version}\nfiles:\n  - url: ${payload}\n    sha512: ${hash('payload')}\n    size: 3\npath: ${payload}\nsha512: ${hash('payload')}\n`)
  const manifest = {
    schema: 'insight-desktop-target/v3', version, target: { platform: 'darwin', arch: 'arm64' }, shellCommit: COMMIT,
    coreRuntime: { tag: '1.0.9', commit: COMMIT }, compatibility: { profileSchema: 1, accountStorageSchema: 1, readsDataSchema: { minimum: 1, maximum: 1 }, writesDataSchema: 1 },
    artifacts: [
      { platform: 'darwin', arch: 'arm64', kind: 'dmg', name: `Insight-${version}-arm64.dmg`, size: 2, sha512: hash('dmg') },
      { platform: 'darwin', arch: 'arm64', kind: 'zip', name: payload, size: 3, sha512: hash('payload') },
      { platform: 'darwin', arch: 'arm64', kind: 'blockmap', name: `${payload}.blockmap`, size: 4, sha512: hash('blockmap') },
      { platform: 'darwin', arch: 'arm64', kind: 'updater-metadata', name: metadataName, size: metadataBytes.length, sha512: hash(metadataBytes) },
    ],
  }
  const base = `${ORIGIN}/desktop/native/releases/v${version}/targets/${target}/`
  const manifestBytes = json(manifest)
  data.responses.set(`${base}insight-target.json`, manifestBytes)
  data.responses.set(`${base}insight-target.json.sig`, data.sign(manifest))
  data.responses.set(`${base}${metadataName}`, metadataBytes)
  const rollout = {
    schema: 'insight-desktop-rollout/v3', state, track: 'candidate', version, target,
    referencedSha512: hash(manifestBytes), policy: { mode: 'optional', minimumSupportedVersion: '1.0.9' }, publishedAt: '2026-10-30T00:00:00.000Z',
  }
  const rolloutBytes = json(rollout)
  data.responses.set(`${ORIGIN}/desktop/candidate-v3/${target}/current.json`, json({
    schema: 'insight-desktop-rollout-envelope/v3', payloadBase64: Buffer.from(rolloutBytes).toString('base64'), signatureBase64: Buffer.from(data.sign(rollout)).toString('base64'),
  }))
}

/** Return a same-origin, non-redirecting mock response or a deterministic 404. */
function fetchFor(responses: ReadonlyMap<string, Uint8Array>, observed?: string[]): typeof fetch {
  const request: typeof fetch = async (input) => {
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url
    observed?.push(url)
    const body = responses.get(url)
    const response = new Response(body === undefined ? undefined : new Uint8Array(body).buffer, { status: body === undefined ? 404 : 200 })
    Object.defineProperty(response, 'url', { value: url })
    return response
  }
  return request
}

/** Serialize exactly as the signing side does. */
function json(value: object): Uint8Array {
  return Buffer.from(JSON.stringify(value))
}

/** Calculate fixture integrity using the production encoding. */
function hash(value: string | Uint8Array): string {
  return createHash('sha512').update(value).digest('base64')
}

describe('Insight trusted update source', () => {
  it('resolves a signed final V2 stable release through its full index', async () => {
    const data = fixture('stable', '1.0.10')
    await expect(resolveInsightUpdate({ track: 'stable', target: 'darwin-arm64', distributionOrigin: ORIGIN, publicKeyPem: data.publicKeyPem, fetch: fetchFor(data.responses) })).resolves.toMatchObject({
      version: '1.0.10', track: 'stable', sourceCommit: COMMIT, metadataAsset: { name: 'latest-mac.yml' }, payloadAsset: { kind: 'zip' },
    })
  })

  it('rejects a fully signed stable release whose target compatibility declarations differ', async () => {
    const data = fixture('stable', '1.0.10', undefined, { 'win32-x64': 2 })
    await expect(resolveInsightUpdate({ track: 'stable', target: 'darwin-arm64', distributionOrigin: ORIGIN, publicKeyPem: data.publicKeyPem, fetch: fetchFor(data.responses) })).rejects.toThrow('do not share one identity')
  })

  it('resolves signed V2 final and V3 rc candidates at their protocol-specific paths', async () => {
    const finalCandidate = fixture('candidate', '1.0.10', undefined, undefined, 'v2')
    await expect(resolveInsightUpdate({ track: 'candidate', target: 'darwin-arm64', distributionOrigin: ORIGIN, publicKeyPem: finalCandidate.publicKeyPem, fetch: fetchFor(finalCandidate.responses) })).resolves.toMatchObject({
      version: '1.0.10', metadataAsset: { name: 'latest-mac.yml' }, payloadAsset: { kind: 'zip' },
    })
    const data = fixture('candidate', '1.0.10-rc.1')
    await expect(resolveInsightUpdate({ track: 'candidate', target: 'darwin-arm64', distributionOrigin: ORIGIN, publicKeyPem: data.publicKeyPem, fetch: fetchFor(data.responses) })).resolves.toMatchObject({
      version: '1.0.10-rc.1', metadataAsset: { name: 'insight-1.0.10-rc.1-darwin-arm64.yml' },
    })
    const stable = fixture('stable', '1.0.10-rc.1')
    await expect(resolveInsightUpdate({ track: 'stable', target: 'darwin-arm64', distributionOrigin: ORIGIN, publicKeyPem: stable.publicKeyPem, fetch: fetchFor(stable.responses) })).rejects.toThrow('final versions')
  })

  it('moves from a V2 final candidate to the greater V3 rc candidate', async () => {
    const data = fixture('candidate', '1.0.11', undefined, undefined, 'v2')
    const observed: string[] = []
    const accepted: string[] = []
    const fetch = fetchFor(data.responses, observed)
    await expect(resolveInsightUpdate({ track: 'candidate', target: 'darwin-arm64', distributionOrigin: ORIGIN, publicKeyPem: data.publicKeyPem, fetch,
      acceptRollout: (observation) => { accepted.push(observation.version); return Promise.resolve() },
    })).resolves.toMatchObject({ version: '1.0.11' })
    addV3Candidate(data, '1.0.12-rc.1')
    await expect(resolveInsightUpdate({ track: 'candidate', target: 'darwin-arm64', distributionOrigin: ORIGIN, publicKeyPem: data.publicKeyPem, fetch,
      acceptRollout: (observation) => { accepted.push(observation.version); return Promise.resolve() },
    })).resolves.toMatchObject({ version: '1.0.12-rc.1' })
    expect(accepted).toEqual(['1.0.11', '1.0.12-rc.1'])
    expect(observed).toContain(`${ORIGIN}/desktop/candidate-v2/darwin-arm64/current.json`)
    expect(observed).toContain(`${ORIGIN}/desktop/candidate-v3/darwin-arm64/current.json`)
  })

  it('does not fall back when the greatest candidate is withdrawn and records only that pointer', async () => {
    const data = fixture('candidate', '1.0.10', undefined, undefined, 'v2')
    addV3Candidate(data, '1.0.11-rc.1', 'rejected')
    const accepted: string[] = []
    await expect(resolveInsightUpdate({ track: 'candidate', target: 'darwin-arm64', distributionOrigin: ORIGIN, publicKeyPem: data.publicKeyPem, fetch: fetchFor(data.responses),
      acceptRollout: (observation) => { accepted.push(observation.version); return Promise.resolve() },
    })).rejects.toThrow('withdrawn')
    expect(accepted).toEqual(['1.0.11-rc.1'])
  })

  it('stops before target documents when persisting the selected candidate fails', async () => {
    const data = fixture('candidate', '1.0.10', undefined, undefined, 'v2')
    const observed: string[] = []
    const fetch = fetchFor(data.responses, observed)
    await expect(resolveInsightUpdate({ track: 'candidate', target: 'darwin-arm64', distributionOrigin: ORIGIN, publicKeyPem: data.publicKeyPem, fetch,
      acceptRollout: () => Promise.reject(new Error('history write failed')),
    })).rejects.toThrow('history write failed')
    expect(observed.some(url => url.includes('insight-target.json'))).toBe(false)
  })

  it('fails closed when either candidate pointer returns a non-404 response', async () => {
    const data = fixture('candidate', '1.0.10', undefined, undefined, 'v2')
    const fetch = async (input: URL | RequestInfo): Promise<Response> => {
      const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url
      const body = data.responses.get(url)
      const response = new Response(body === undefined ? undefined : new Uint8Array(body).buffer, { status: url.includes('/candidate-v3/') ? 403 : body === undefined ? 404 : 200 })
      Object.defineProperty(response, 'url', { value: url })
      return response
    }
    await expect(resolveInsightUpdate({ track: 'candidate', target: 'darwin-arm64', distributionOrigin: ORIGIN, publicKeyPem: data.publicKeyPem, fetch })).rejects.toThrow('trusted successful')
  })

  it('fails closed when either candidate pointer request fails', async () => {
    const data = fixture('candidate', '1.0.10', undefined, undefined, 'v2')
    const fetch = async (input: URL | RequestInfo): Promise<Response> => {
      const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url
      if (url.includes('/candidate-v3/')) throw new Error('network unavailable')
      const body = data.responses.get(url)
      const response = new Response(body === undefined ? undefined : new Uint8Array(body).buffer, {
        status: body === undefined ? 404 : 200,
      })
      Object.defineProperty(response, 'url', { value: url })
      return response
    }
    await expect(resolveInsightUpdate({ track: 'candidate', target: 'darwin-arm64', distributionOrigin: ORIGIN, publicKeyPem: data.publicKeyPem, fetch })).rejects.toThrow('network unavailable')
  })

  it('rejects tampered signatures, metadata, and target-local asset substitution', async () => {
    const data = fixture('candidate', '1.0.10-rc.1')
    data.responses.set(`${ORIGIN}/desktop/candidate-v3/darwin-arm64/current.json`, Buffer.from('{}'))
    await expect(resolveInsightUpdate({ track: 'candidate', target: 'darwin-arm64', distributionOrigin: ORIGIN, publicKeyPem: data.publicKeyPem, fetch: fetchFor(data.responses) })).rejects.toThrow()

    const metadata = fixture('candidate', '1.0.10-rc.1')
    metadata.responses.set(`${ORIGIN}/desktop/native/releases/v1.0.10-rc.1/targets/darwin-arm64/insight-1.0.10-rc.1-darwin-arm64.yml`, Buffer.from('version: 1.0.10-rc.1\nfiles: []\n'))
    await expect(resolveInsightUpdate({ track: 'candidate', target: 'darwin-arm64', distributionOrigin: ORIGIN, publicKeyPem: metadata.publicKeyPem, fetch: fetchFor(metadata.responses) })).rejects.toThrow('metadata bytes')

    const replacement = fixture('candidate', '1.0.10-rc.1', 'other.zip')
    await expect(resolveInsightUpdate({ track: 'candidate', target: 'darwin-arm64', distributionOrigin: ORIGIN, publicKeyPem: replacement.publicKeyPem, fetch: fetchFor(replacement.responses) })).rejects.toThrow('exactly the signed payload')
  })

  it('rejects an origin path and a redirected response URL', async () => {
    const data = fixture('candidate', '1.0.10-rc.1')
    await expect(resolveInsightUpdate({ track: 'candidate', target: 'darwin-arm64', distributionOrigin: `${ORIGIN}/nested`, publicKeyPem: data.publicKeyPem, fetch: fetchFor(data.responses) })).rejects.toThrow('bare HTTPS origin')
    const fetch = (async () => {
      const response = new Response(Buffer.from('{}'), { status: 200 })
      Object.defineProperty(response, 'url', { value: 'https://other.example.test/current.json' })
      return response
    }) as typeof globalThis.fetch
    await expect(resolveInsightUpdate({ track: 'candidate', target: 'darwin-arm64', distributionOrigin: ORIGIN, publicKeyPem: data.publicKeyPem, fetch })).rejects.toThrow('trusted successful same-origin')
  })
})


it('reads the deployed Shell 1.0.9 signed V2 documents with their original trailing newlines', async () => {
  const schema = z.object({ capturedAt: z.string(), origin: z.string(), documents: z.record(z.string(), z.string()) }).strict()
  const fixture = schema.parse(JSON.parse(await readFile(new URL('./fixtures/update-v2-1.0.9.json', import.meta.url), 'utf8')))
  const responses = new Map(Object.entries(fixture.documents).map(([url, bytes]) => [url, new Uint8Array(Buffer.from(bytes, 'base64'))]))
  const publicKeyPem = await readFile(new URL('../resources/update/update-signing-public.pem', import.meta.url), 'utf8')
  const observations: string[] = []
  const result = await resolveInsightUpdate({ track: 'stable', target: 'darwin-arm64', distributionOrigin: fixture.origin,
    publicKeyPem, fetch: fetchFor(responses),
    acceptRollout: (observation) => { observations.push(observation.fingerprint); return Promise.resolve() },
  })
  expect(result.version).toBe('1.0.9')
  expect(result.payloadAsset.platform).toBe('darwin')
  expect(result.payloadAsset.arch).toBe('arm64')
  const pointer = responses.get(`${fixture.origin}/desktop/stable/current.json`)
  if (pointer === undefined) throw new Error('Missing public stable pointer fixture')
  expect(observations).toEqual([hash(pointer)])
})
