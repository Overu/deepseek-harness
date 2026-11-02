import { expect, it } from 'vitest'
import { publishPointer } from './publish-common.ts'
import type { InsightRemoteMetadata, PublishInsightTransport } from './publish.ts'

interface StoredObject {
  readonly bytes: Uint8Array
  readonly etag: string
}

class PointerTransport implements PublishInsightTransport {
  readonly objects = new Map<string, StoredObject>()
  pointerWrites = 0
  failPointer = false
  corruptReadback = false
  mutateBeforeRead: (() => void) | undefined
  private revision = 0

  async getMetadata(key: string): Promise<InsightRemoteMetadata | undefined> {
    const mutate = this.mutateBeforeRead
    this.mutateBeforeRead = undefined
    mutate?.()
    const found = this.objects.get(key)
    if (found === undefined) return undefined
    const bytes = this.corruptReadback && this.pointerWrites > 0 ? Buffer.from('changed') : found.bytes
    return { bytes: new Uint8Array(bytes), etag: found.etag }
  }

  async download(): Promise<undefined> { return undefined }

  async putImmutable(): Promise<void> { throw new Error('not used by pointer tests') }

  async putPointer(key: string, bytes: Uint8Array, options: { readonly ifAbsent?: true }): Promise<void> {
    this.pointerWrites++
    if (this.failPointer) throw new Error('replacement outcome unknown')
    if (options.ifAbsent === true && this.objects.has(key)) throw new Error('pointer creation failed')
    this.objects.set(key, { bytes: new Uint8Array(bytes), etag: this.nextEtag() })
  }

  seed(key: string, bytes: Uint8Array): InsightRemoteMetadata {
    const stored = { bytes: new Uint8Array(bytes), etag: this.nextEtag() }
    this.objects.set(key, stored)
    return { bytes: new Uint8Array(stored.bytes), etag: stored.etag }
  }

  private nextEtag(): string {
    this.revision++
    return `etag-${String(this.revision)}`
  }
}

const key = 'desktop/candidate-v2/darwin-arm64/current.json'
const pointer = Buffer.from('signed pointer')

it.each([
  ['changed', (transport: PointerTransport) => {
    transport.seed(key, Buffer.from('changed pointer'))
  }],
  ['missing', (transport: PointerTransport) => { transport.objects.delete(key) }],
])('refuses an existing pointer that is %s immediately before replacement', async (_label, mutate) => {
  const transport = new PointerTransport()
  const current = transport.seed(key, Buffer.from('old pointer'))
  transport.mutateBeforeRead = () => { mutate(transport) }
  await expect(publishPointer(transport, key, pointer, current, false, 'Candidate')).rejects.toThrow(/changed before replacement/u)
  expect(transport.pointerWrites).toBe(0)
})

it('refuses a pointer that appears immediately before creation', async () => {
  const transport = new PointerTransport()
  transport.mutateBeforeRead = () => { transport.seed(key, Buffer.from('other pointer')) }
  await expect(publishPointer(transport, key, pointer, undefined, false, 'Candidate')).rejects.toThrow(/appeared before replacement/u)
  expect(transport.pointerWrites).toBe(0)
})

it('only reads an unchanged same-version pointer', async () => {
  const transport = new PointerTransport()
  const current = transport.seed(key, pointer)
  await expect(publishPointer(transport, key, pointer, current, true, 'Candidate')).resolves.toBeUndefined()
  expect(transport.pointerWrites).toBe(0)
})

it('does not retry an unknown pointer replacement outcome', async () => {
  const transport = new PointerTransport()
  transport.failPointer = true
  await expect(publishPointer(transport, key, pointer, undefined, false, 'Candidate')).rejects.toThrow(/outcome unknown/u)
  expect(transport.pointerWrites).toBe(1)
})

it('rejects a pointer readback that differs from the signed bytes', async () => {
  const transport = new PointerTransport()
  transport.corruptReadback = true
  await expect(publishPointer(transport, key, pointer, undefined, false, 'Candidate')).rejects.toThrow(/readback does not match/u)
  expect(transport.pointerWrites).toBe(1)
})
