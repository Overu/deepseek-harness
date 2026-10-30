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
}

/** Construct signed canonical release records without contacting a distribution service. */
function fixture(track: 'stable' | 'candidate', version: string, metadataPayloadName?: string, writesDataSchema?: Partial<Record<typeof targets[number], number>>): Fixture {
  const keys = generateKeyPairSync('ed25519')
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const responses = new Map<string, Uint8Array>()
  const signBytes = (value: object): Uint8Array => new Uint8Array(sign(null, json(value), keys.privateKey))
  const manifest = (target: typeof targets[number]) => {
    const [platform, arch] = target.split('-') as ['darwin' | 'win32', 'arm64' | 'x64']
    const payload = platform === 'darwin' ? `Insight-${version}-${arch}.zip` : `Insight-Setup-${version}.exe`
    const metadata = track === 'candidate'
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
    return { schema: `insight-desktop-target/v${track === 'stable' ? '2' : '3'}`, version, target: { platform, arch }, shellCommit: COMMIT, coreRuntime: { tag: '1.0.9', commit: COMMIT }, compatibility: { profileSchema: 1, accountStorageSchema: 1, readsDataSchema: { minimum: 1, maximum: 1 }, writesDataSchema: writesDataSchema?.[target] ?? 1 }, artifacts, metadata, metadataBytes }
  }
  const manifests = new Map(targets.map(target => [target, manifest(target)]))
  const base = (target: string) => track === 'stable'
    ? `${ORIGIN}/desktop/releases/v${version}/targets/${target}/`
    : `${ORIGIN}/desktop/native/releases/v${version}/targets/${target}/`
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
  const rollout = { schema: `insight-desktop-rollout/v${track === 'stable' ? '2' : '3'}`, state: 'active', track, version, ...(track === 'candidate' ? { target: 'darwin-arm64' } : {}), referencedSha512: reference, policy: { mode: 'optional', minimumSupportedVersion: '1.0.9' }, publishedAt: '2026-10-30T00:00:00.000Z' }
  const rolloutBytes = json(rollout)
  const envelope = { schema: `insight-desktop-rollout-envelope/v${track === 'stable' ? '2' : '3'}`, payloadBase64: Buffer.from(rolloutBytes).toString('base64'), signatureBase64: Buffer.from(sign(null, rolloutBytes, keys.privateKey)).toString('base64') }
  const pointer = track === 'stable' ? `${ORIGIN}/desktop/stable/current.json` : `${ORIGIN}/desktop/candidate-v3/darwin-arm64/current.json`
  responses.set(pointer, json(envelope))
  return { publicKeyPem, responses }
}

/** Return a same-origin, non-redirecting mock response or a deterministic 404. */
function fetchFor(responses: ReadonlyMap<string, Uint8Array>): typeof fetch {
  const request: typeof fetch = async (input) => {
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url
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

  it('resolves a signed V3 rc candidate and rejects its use as V2 stable', async () => {
    const data = fixture('candidate', '1.0.10-rc.1')
    await expect(resolveInsightUpdate({ track: 'candidate', target: 'darwin-arm64', distributionOrigin: ORIGIN, publicKeyPem: data.publicKeyPem, fetch: fetchFor(data.responses) })).resolves.toMatchObject({
      version: '1.0.10-rc.1', metadataAsset: { name: 'insight-1.0.10-rc.1-darwin-arm64.yml' },
    })
    const stable = fixture('stable', '1.0.10-rc.1')
    await expect(resolveInsightUpdate({ track: 'stable', target: 'darwin-arm64', distributionOrigin: ORIGIN, publicKeyPem: stable.publicKeyPem, fetch: fetchFor(stable.responses) })).rejects.toThrow('final versions')
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
