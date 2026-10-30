import { generateKeyPairSync } from 'node:crypto'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sha512, verifyInsightRollout } from '@insight-ai/desktop-integration/desktop'
import {
  createInsightDesktopBuildManifest,
  writeInsightDesktopBuildManifest,
  type InsightDesktopBuildQualification,
} from './artifacts.ts'
import {
  publishInsightCandidate,
  type PublishInsightCandidateInput,
  type PublishInsightTransport,
} from './publish.ts'

const COMMIT = 'a'.repeat(40)
const VERSION = '1.0.10-rc.1'
const COMPATIBILITY = {
  profileSchema: 1,
  accountStorageSchema: 1,
  readsDataSchema: { minimum: 1, maximum: 1 },
  writesDataSchema: 1,
} as const

interface StoredObject {
  readonly bytes: Uint8Array
  readonly etag: string
}

class FakeTransport implements PublishInsightTransport {
  readonly objects = new Map<string, StoredObject>()
  readonly immutableWrites: string[] = []
  readonly pointerWrites: string[] = []
  readonly downloads: string[] = []
  calls = 0
  failImmutableAt: number | undefined
  failPointer = false
  corruptPointerReadback = false
  uploadSnapshotsWereReleased = true
  remoteCopiesWereReleased = true
  lastUploadSnapshot: string | undefined
  lastRemoteCopy: string | undefined
  private revision = 0

  async getMetadata(key: string) {
    this.calls++
    const found = this.objects.get(key)
    if (found === undefined) return undefined
    const bytes = this.corruptPointerReadback && this.pointerWrites.includes(key)
      ? Buffer.from('changed pointer')
      : found.bytes
    return { bytes: new Uint8Array(bytes), etag: found.etag }
  }

  async download(key: string, destination: string) {
    this.calls++
    this.downloads.push(key)
    if (this.lastRemoteCopy !== undefined && await exists(this.lastRemoteCopy)) this.remoteCopiesWereReleased = false
    const found = this.objects.get(key)
    if (found === undefined) return undefined
    await writeFile(destination, found.bytes, { flag: 'wx' })
    this.lastRemoteCopy = destination
    return { size: found.bytes.byteLength, sha512: sha512(found.bytes), etag: found.etag }
  }

  async putImmutable(key: string, source: { readonly bytes: Uint8Array } | { readonly path: string }) {
    this.calls++
    this.immutableWrites.push(key)
    if (this.lastUploadSnapshot !== undefined && await exists(this.lastUploadSnapshot)) this.uploadSnapshotsWereReleased = false
    if ('path' in source) this.lastUploadSnapshot = source.path
    if (this.failImmutableAt === this.immutableWrites.length) throw new Error('injected immutable write failure')
    if (this.objects.has(key)) throw new Error('immutable object exists')
    const bytes = 'bytes' in source ? source.bytes : await readFile(source.path)
    this.objects.set(key, { bytes: new Uint8Array(bytes), etag: this.nextEtag() })
  }

  async putPointer(
    key: string,
    bytes: Uint8Array,
    condition: { readonly expectedEtag: string } | { readonly ifAbsent: true },
  ) {
    this.calls++
    this.pointerWrites.push(key)
    if (this.failPointer) throw new Error('injected CAS outcome unknown')
    const current = this.objects.get(key)
    if ('ifAbsent' in condition ? current !== undefined : current?.etag !== condition.expectedEtag) {
      throw new Error('conditional write failed')
    }
    this.objects.set(key, { bytes: new Uint8Array(bytes), etag: this.nextEtag() })
  }

  seed(key: string, bytes: Uint8Array): void {
    this.objects.set(key, { bytes: new Uint8Array(bytes), etag: this.nextEtag() })
  }

  private nextEtag(): string {
    this.revision++
    return `etag-${String(this.revision)}`
  }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function keys() {
  const pair = generateKeyPairSync('ed25519')
  return {
    privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

async function fixture(options: {
  readonly transport?: FakeTransport
  readonly signing?: ReturnType<typeof keys>
  readonly qualification?: InsightDesktopBuildQualification
  readonly metadataVersion?: string
  readonly payload?: Uint8Array
  readonly target?: 'darwin-arm64' | 'win32-x64'
} = {}): Promise<{ input: PublishInsightCandidateInput; transport: FakeTransport; signing: ReturnType<typeof keys> }> {
  const directory = await mkdtemp(join(tmpdir(), 'insight-publish-spec-'))
  roots.push(directory)
  const transport = options.transport ?? new FakeTransport()
  const signing = options.signing ?? keys()
  const target = options.target ?? 'darwin-arm64'
  const windows = target === 'win32-x64'
  const payloadName = `insight-${VERSION}-${windows ? 'win-x64.exe' : 'mac-arm64.zip'}`
  const payload = options.payload ?? Buffer.from('signed mac zip')
  const metadataName = `insight-${VERSION}-${target}.yml`
  const files = new Map<string, Uint8Array>([
    ...(windows ? [] : [[`insight-${VERSION}-mac-arm64.dmg`, Buffer.from('signed mac dmg')] as const]),
    [payloadName, payload],
    [`${payloadName}.blockmap`, Buffer.from('signed blockmap')],
    [metadataName, Buffer.from(JSON.stringify({
      version: options.metadataVersion ?? VERSION,
      files: [{ url: payloadName, sha512: sha512(payload), size: payload.byteLength }],
      path: payloadName,
      sha512: sha512(payload),
      releaseDate: '2026-10-30T00:00:00.000Z',
    }))],
  ])
  for (const [name, bytes] of files) await writeFile(join(directory, name), bytes)
  const manifestFilename = `insight-build-${target}.json`
  const manifest = await createInsightDesktopBuildManifest({
    artifactDirectory: directory,
    manifestFilename,
    version: VERSION,
    runtimeVersion: '0.2.2-alpha.2',
    sourceCommit: COMMIT,
    target,
    qualification: options.qualification ?? 'distribution',
    assetFilenames: [...files.keys()],
  })
  await writeInsightDesktopBuildManifest(directory, manifestFilename, manifest)
  return {
    transport,
    signing,
    input: {
      directory,
      version: VERSION,
      sourceCommit: COMMIT,
      target,
      compatibility: COMPATIBILITY,
      ...signing,
      transport,
      now: () => Date.parse('2026-10-30T12:00:00.000Z'),
    },
  }
}

describe('Insight candidate publisher', () => {
  it('publishes verified immutable objects, switches the pointer last, and retries idempotently', async () => {
    const f = await fixture()
    const result = await publishInsightCandidate(f.input)
    expect(result).toEqual({
      manifestKey: `desktop/native/releases/v${VERSION}/targets/darwin-arm64/insight-target.json`,
      pointerKey: 'desktop/candidate-v3/darwin-arm64/current.json',
      version: VERSION,
    })
    expect(f.transport.immutableWrites).toHaveLength(6)
    expect(f.transport.uploadSnapshotsWereReleased).toBe(true)
    expect(f.transport.remoteCopiesWereReleased).toBe(true)
    if (f.transport.lastUploadSnapshot !== undefined) await expect(access(f.transport.lastUploadSnapshot)).rejects.toThrow()
    if (f.transport.lastRemoteCopy !== undefined) await expect(access(f.transport.lastRemoteCopy)).rejects.toThrow()
    expect(f.transport.pointerWrites).toEqual([result.pointerKey])
    const pointer = f.transport.objects.get(result.pointerKey)
    expect(pointer).toBeDefined()
    expect(verifyInsightRollout(pointer!.bytes, f.signing.publicKeyPem, 'candidate').rollout).toMatchObject({
      version: VERSION,
      target: 'darwin-arm64',
      publishedAt: '2026-10-30T12:00:00.000Z',
    })

    const immutableWrites = f.transport.immutableWrites.length
    const pointerWrites = f.transport.pointerWrites.length
    const repeated = await publishInsightCandidate({ ...f.input, now: () => Date.parse('2026-11-01T00:00:00.000Z') })
    expect(repeated).toEqual(result)
    expect(f.transport.immutableWrites).toHaveLength(immutableWrites)
    expect(f.transport.pointerWrites).toHaveLength(pointerWrites)
    expect(verifyInsightRollout(f.transport.objects.get(result.pointerKey)!.bytes, f.signing.publicKeyPem, 'candidate').rollout.publishedAt)
      .toBe('2026-10-30T12:00:00.000Z')
  })

  it('publishes the exact Windows NSIS, blockmap, and metadata roles', async () => {
    const f = await fixture({ target: 'win32-x64', payload: Buffer.from('signed NSIS executable') })
    const result = await publishInsightCandidate(f.input)
    expect(result).toEqual({
      manifestKey: `desktop/native/releases/v${VERSION}/targets/win32-x64/insight-target.json`,
      pointerKey: 'desktop/candidate-v3/win32-x64/current.json',
      version: VERSION,
    })
    expect(f.transport.immutableWrites).toHaveLength(5)
    expect([...f.transport.objects.keys()].filter(key => key.includes('/targets/win32-x64/'))).toEqual(expect.arrayContaining([
      expect.stringMatching(/\.exe$/u),
      expect.stringMatching(/\.exe\.blockmap$/u),
      expect.stringMatching(/win32-x64\.yml$/u),
    ]))
  })

  it.each([
    ['debug build', async () => (await fixture({ qualification: 'debug-signed' })).input],
    ['invalid metadata', async () => (await fixture({ metadataVersion: '1.0.10-rc.2' })).input],
    ['wrong target', async () => {
      const f = await fixture()
      await writeFile(
        join(f.input.directory, 'insight-build-win32-x64.json'),
        await readFile(join(f.input.directory, 'insight-build-darwin-arm64.json')),
      )
      return { ...f.input, target: 'win32-x64' as const }
    }],
  ])('rejects %s before any transport operation', async (_label, makeInput) => {
    const input = await makeInput()
    const transport = input.transport as FakeTransport
    await expect(publishInsightCandidate(input)).rejects.toThrow()
    expect(transport.calls).toBe(0)
  })

  it('rejects a mismatched signing key before any transport operation', async () => {
    const f = await fixture()
    await expect(publishInsightCandidate({ ...f.input, publicKeyPem: keys().publicKeyPem })).rejects.toThrow(/do not match/u)
    expect(f.transport.calls).toBe(0)
  })

  it('leaves partial immutable uploads but never writes the pointer after an upload failure', async () => {
    const f = await fixture()
    f.transport.failImmutableAt = 2
    await expect(publishInsightCandidate(f.input)).rejects.toThrow(/injected immutable/u)
    expect(f.transport.immutableWrites).toHaveLength(2)
    expect(f.transport.pointerWrites).toEqual([])
    expect(f.transport.objects.has('desktop/candidate-v3/darwin-arm64/current.json')).toBe(false)
    if (f.transport.lastUploadSnapshot !== undefined) await expect(access(f.transport.lastUploadSnapshot)).rejects.toThrow()
  })

  it('rejects an existing immutable object with different bytes without replacing it', async () => {
    const f = await fixture()
    const payloadKey = `desktop/native/releases/v${VERSION}/targets/darwin-arm64/insight-${VERSION}-mac-arm64.zip`
    f.transport.seed(payloadKey, Buffer.from('different remote payload'))
    await expect(publishInsightCandidate(f.input)).rejects.toThrow(/different bytes/u)
    expect(f.transport.pointerWrites).toEqual([])
    expect(Buffer.from(f.transport.objects.get(payloadKey)!.bytes).toString()).toBe('different remote payload')
  })

  it('refuses to change target manifest bytes for an already published version', async () => {
    const transport = new FakeTransport()
    const signing = keys()
    const first = await fixture({ transport, signing })
    await publishInsightCandidate(first.input)
    const immutableWrites = transport.immutableWrites.length
    const second = await fixture({ transport, signing, payload: Buffer.from('different signed mac zip') })
    await expect(publishInsightCandidate(second.input)).rejects.toThrow(/different target manifest/u)
    expect(transport.immutableWrites).toHaveLength(immutableWrites)
    expect(transport.pointerWrites).toHaveLength(1)
  })

  it('does not report success when the pointer CAS outcome is unknown', async () => {
    const f = await fixture()
    f.transport.failPointer = true
    await expect(publishInsightCandidate(f.input)).rejects.toThrow(/outcome unknown/u)
    expect(f.transport.pointerWrites).toHaveLength(1)
    expect(f.transport.objects.has('desktop/candidate-v3/darwin-arm64/current.json')).toBe(false)
  })

  it('does not report success when pointer readback differs after CAS', async () => {
    const f = await fixture()
    f.transport.corruptPointerReadback = true
    await expect(publishInsightCandidate(f.input)).rejects.toThrow(/readback/u)
    expect(f.transport.pointerWrites).toHaveLength(1)
  })
})
