import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import test from 'node:test'
import { readWorkspaceAsset } from '../src/host/workspace-asset-source.ts'

function fixture(patch = {}) {
  const bytes = Buffer.from('你好，画布\n'), calls = []
  const fs = { resolve: async path => ({ targetKey: path === '/workspace' ? 'root' : 'file', displayPath: path }), contains: () => true,
    stat: async () => ({ type: 'file', version: '1', size: bytes.length }),
    readByteRange: async (_target, { offset, length }) => { calls.push(length); return bytes.subarray(offset, offset + length) }, ...patch }
  return { fs, bytes, calls, read: signal => readWorkspaceAsset(fs, '/workspace', 'body.txt', signal ?? new AbortController().signal) }
}
test('workspace source uses opaque targets, bounded reads and a disposable content snapshot', async () => {
  const f = fixture(), result = await f.read()
  try { assert.deepEqual(await readFile(result.snapshot.path), f.bytes); assert.equal(result.mediaType, 'text'); assert.match(result.snapshot.sha256, /^[a-f0-9]{64}$/); assert(f.calls.every(n => n <= 256 * 1024)) }
  finally { await result.snapshot.cleanup() }
  await assert.rejects(access(result.snapshot.path))
})
test('outside-workspace, missing, special and oversized files stop before byte reads', async () => {
  for (const patch of [ { contains: () => false }, { stat: async () => undefined }, { stat: async () => ({ type: 'directory', version: '1', size: 1 }) }, { stat: async () => ({ type: 'file', version: '1', size: 128 * 1024 + 1 }) } ]) {
    const f = fixture(patch); await assert.rejects(f.read()); assert.equal(f.calls.length, 0)
  }
  await assert.rejects(readWorkspaceAsset(undefined, '/workspace', 'a.txt', new AbortController().signal), { code: 'CONFIGURATION_ERROR' })
})
test('changed version or retargeted path during reading is rejected, not uploaded from a stale path', async () => {
  let stats = 0, resolutions = 0
  for (const patch of [ { stat: async () => ({ type: 'file', version: String(++stats), size: Buffer.byteLength('你好，画布\n') }) },
    { resolve: async path => ({ targetKey: path === '/workspace' ? 'root' : ++resolutions === 1 ? 'file' : 'changed', displayPath: path }) } ]) {
    await assert.rejects(fixture(patch).read(), { code: 'ASSET_READ_REJECTED' })
  }
})
test('cancelled and URL sources cannot become host filesystem reads', async () => {
  const aborted = new AbortController(); aborted.abort()
  await assert.rejects(fixture().read(aborted.signal))
  await assert.rejects(readWorkspaceAsset(fixture().fs, '/workspace', 'file:///private/body.txt', new AbortController().signal), { code: 'INVALID_ARGUMENT' })
})
