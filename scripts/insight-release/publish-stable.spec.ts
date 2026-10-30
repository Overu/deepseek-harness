import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sha512, verifyInsightRollout } from '@insight-ai/desktop-integration/desktop'
import {
  createInsightDesktopBuildManifest,
  writeInsightDesktopBuildManifest,
  type InsightDesktopBuildQualification,
  type InsightDesktopBuildTarget,
} from './artifacts.ts'
import {
  publishInsightStable,
  type PublishInsightStableInput,
} from './publish-stable.ts'
import type { PublishInsightTransport } from './publish.ts'

const COMMIT = 'a'.repeat(40)
const VERSION = '1.0.10'
const RUNTIME_VERSION = '0.2.2-alpha.2'
const TARGETS = ['darwin-arm64', 'darwin-x64', 'win32-x64'] as const
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
  readonly operations: string[] = []
  calls = 0
  failImmutableAt: number | undefined
  failPointer = false
  private revision = 0

  async getMetadata(key: string) {
    this.calls++
    this.operations.push(`metadata:${key}`)
    const found = this.objects.get(key)
    return found === undefined ? undefined : { bytes: new Uint8Array(found.bytes), etag: found.etag }
  }

  async download(key: string, destination: string) {
    this.calls++
    this.operations.push(`download:${key}`)
    const found = this.objects.get(key)
    if (found === undefined) return undefined
    await writeFile(destination, found.bytes, { flag: 'wx' })
    return { size: found.bytes.byteLength, sha512: sha512(found.bytes), etag: found.etag }
  }

  async putImmutable(key: string, source: { readonly bytes: Uint8Array } | { readonly path: string }) {
    this.calls++
    this.operations.push(`immutable:${key}`)
    this.immutableWrites.push(key)
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
    this.operations.push(`pointer:${key}`)
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

async function targetFixture(input: {
  readonly target: InsightDesktopBuildTarget
  readonly payloadSuffix?: string
  readonly qualification?: InsightDesktopBuildQualification
  readonly runtimeVersion?: string
}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `insight-stable-${input.target}-`))
  roots.push(directory)
  const windows = input.target === 'win32-x64'
  const targetSuffix = windows ? 'win-x64' : input.target === 'darwin-arm64' ? 'mac-arm64' : 'mac-x64'
  const payloadName = `insight-${VERSION}-${targetSuffix}.${windows ? 'exe' : 'zip'}`
  const payload = Buffer.from(`signed ${input.target} payload ${input.payloadSuffix ?? ''}`)
  const metadataName = `insight-${VERSION}-${input.target}.yml`
  const entries: Array<readonly [string, Uint8Array]> = [
    ...(windows ? [] : [[`insight-${VERSION}-${targetSuffix}.dmg`, Buffer.from(`signed ${input.target} installer`)] as const]),
    [payloadName, payload],
    [`${payloadName}.blockmap`, Buffer.from(`signed ${input.target} blockmap`)],
    [metadataName, Buffer.from(JSON.stringify({
      version: VERSION,
      files: [{ url: payloadName, sha512: sha512(payload), size: payload.byteLength }],
      path: payloadName,
      sha512: sha512(payload),
      releaseDate: '2026-10-30T00:00:00.000Z',
    }))],
  ]
  for (const [name, bytes] of entries) await writeFile(join(directory, name), bytes)
  const manifestFilename = `insight-build-${input.target}.json`
  const manifest = await createInsightDesktopBuildManifest({
    artifactDirectory: directory,
    manifestFilename,
    version: VERSION,
    runtimeVersion: input.runtimeVersion ?? RUNTIME_VERSION,
    sourceCommit: COMMIT,
    target: input.target,
    qualification: input.qualification ?? 'distribution',
    assetFilenames: entries.map(([name]) => name),
  })
  await writeInsightDesktopBuildManifest(directory, manifestFilename, manifest)
  return directory
}

async function fixture(options: {
  readonly transport?: FakeTransport
  readonly signing?: ReturnType<typeof keys>
  readonly payloadSuffix?: string
  readonly qualificationTarget?: InsightDesktopBuildTarget
  readonly runtimeMismatch?: boolean
} = {}): Promise<{ input: PublishInsightStableInput; transport: FakeTransport; signing: ReturnType<typeof keys> }> {
  const transport = options.transport ?? new FakeTransport()
  const signing = options.signing ?? keys()
  const entries = await Promise.all(TARGETS.map(async target => [target, await targetFixture({
    target,
    ...(options.payloadSuffix === undefined ? {} : { payloadSuffix: options.payloadSuffix }),
    qualification: target === options.qualificationTarget ? 'debug-signed' : 'distribution',
    runtimeVersion: options.runtimeMismatch && target === 'win32-x64' ? '0.2.3' : RUNTIME_VERSION,
  })] as const))
  const directories = Object.fromEntries(entries) as Record<InsightDesktopBuildTarget, string>
  return {
    transport,
    signing,
    input: {
      directories,
      version: VERSION,
      sourceCommit: COMMIT,
      compatibility: COMPATIBILITY,
      ...signing,
      transport,
      now: () => Date.parse('2026-10-30T12:00:00.000Z'),
    },
  }
}

describe('Insight stable publisher', () => {
  it('publishes every target, switches the stable pointer last, and retries idempotently', async () => {
    const f = await fixture()
    const result = await publishInsightStable(f.input)
    expect(result).toEqual({
      indexKey: `desktop/releases/v${VERSION}/insight-release.json`,
      pointerKey: 'desktop/stable/current.json',
      version: VERSION,
    })
    expect(f.transport.immutableWrites).toHaveLength(19)
    expect(f.transport.pointerWrites).toEqual([result.pointerKey])
    expect(f.transport.immutableWrites).toEqual(expect.arrayContaining([
      expect.stringContaining('/darwin-arm64/latest-mac.yml'),
      expect.stringContaining('/darwin-x64/latest-mac.yml'),
      expect.stringContaining('/win32-x64/latest.yml'),
    ]))
    expect(f.transport.operations.at(-2)).toBe(`pointer:${result.pointerKey}`)
    expect(f.transport.operations.at(-1)).toBe(`metadata:${result.pointerKey}`)
    expect(verifyInsightRollout(
      f.transport.objects.get(result.pointerKey)!.bytes,
      f.signing.publicKeyPem,
      'stable',
    ).rollout).toMatchObject({
      version: VERSION,
      publishedAt: '2026-10-30T12:00:00.000Z',
    })

    const immutableWrites = f.transport.immutableWrites.length
    const pointerWrites = f.transport.pointerWrites.length
    await expect(publishInsightStable({
      ...f.input,
      now: () => Date.parse('2026-11-01T00:00:00.000Z'),
    })).resolves.toEqual(result)
    expect(f.transport.immutableWrites).toHaveLength(immutableWrites)
    expect(f.transport.pointerWrites).toHaveLength(pointerWrites)
    expect(verifyInsightRollout(
      f.transport.objects.get(result.pointerKey)!.bytes,
      f.signing.publicKeyPem,
      'stable',
    ).rollout.publishedAt).toBe('2026-10-30T12:00:00.000Z')
  })

  it.each([
    ['a release-candidate version', async () => ({ ...(await fixture()).input, version: '1.0.10-rc.1' })],
    ['a missing Windows target', async () => {
      const f = await fixture()
      return { ...f.input, directories: { ...f.input.directories, 'win32-x64': '' } }
    }],
    ['a debug target', async () => (await fixture({ qualificationTarget: 'darwin-x64' })).input],
    ['mismatched source identity', async () => ({ ...(await fixture()).input, sourceCommit: 'b'.repeat(40) })],
    ['mismatched runtime identity', async () => (await fixture({ runtimeMismatch: true })).input],
  ])('rejects %s before any transport operation', async (_label, makeInput) => {
    const input = await makeInput()
    const transport = input.transport as FakeTransport
    await expect(publishInsightStable(input)).rejects.toThrow()
    expect(transport.calls).toBe(0)
  })

  it('leaves partial immutable uploads but never writes the pointer after an upload failure', async () => {
    const f = await fixture()
    f.transport.failImmutableAt = 3
    await expect(publishInsightStable(f.input)).rejects.toThrow(/injected immutable/u)
    expect(f.transport.immutableWrites).toHaveLength(3)
    expect(f.transport.pointerWrites).toEqual([])
    expect(f.transport.objects.has('desktop/stable/current.json')).toBe(false)
  })

  it('rejects an existing immutable object with different bytes without replacing it', async () => {
    const f = await fixture()
    const payloadKey = `desktop/releases/v${VERSION}/targets/darwin-arm64/insight-${VERSION}-mac-arm64.zip`
    f.transport.seed(payloadKey, Buffer.from('different remote payload'))
    await expect(publishInsightStable(f.input)).rejects.toThrow(/different bytes/u)
    expect(f.transport.pointerWrites).toEqual([])
    expect(Buffer.from(f.transport.objects.get(payloadKey)!.bytes).toString()).toBe('different remote payload')
  })

  it('refuses to change any target bytes for an already published stable version', async () => {
    const transport = new FakeTransport()
    const signing = keys()
    const first = await fixture({ transport, signing })
    await publishInsightStable(first.input)
    const immutableWrites = transport.immutableWrites.length
    const second = await fixture({ transport, signing, payloadSuffix: 'changed' })
    await expect(publishInsightStable(second.input)).rejects.toThrow(/different release-index bytes/u)
    expect(transport.immutableWrites).toHaveLength(immutableWrites)
    expect(transport.pointerWrites).toHaveLength(1)
  })

  it('does not report success when the stable pointer CAS outcome is unknown', async () => {
    const f = await fixture()
    f.transport.failPointer = true
    await expect(publishInsightStable(f.input)).rejects.toThrow(/outcome unknown/u)
    expect(f.transport.pointerWrites).toHaveLength(1)
    expect(f.transport.objects.has('desktop/stable/current.json')).toBe(false)
  })
})
