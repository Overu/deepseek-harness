import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { PassThrough, Readable } from 'node:stream'
import { readFile, stat } from 'node:fs/promises'
import { downloadRemoteMedia } from '../src/host/remote-media-reader.ts'
import { MEDIA_LIMITS } from '../src/shared/canvas-media.ts'

const signal = () => new AbortController().signal
function fixture({ status = 200, mime = 'video/mp4', headers = {}, chunks = [Buffer.from('container')], addresses = [{ address: '93.184.216.34', family: 4 }], stream } = {}) {
  const calls = []
  const deps = { lookup: async () => addresses, request: (url, options, callback) => {
    calls.push({ url, options }); const request = new EventEmitter(); request.destroy = () => request
    request.end = () => {
      const response = stream ?? Readable.from(chunks); response.statusCode = status; response.headers = { 'content-type': mime, ...headers }
      queueMicrotask(() => callback(response))
    }; return request
  } }
  return { deps, calls }
}
test('remote media streams to a private snapshot with DNS pinned and no account credentials', async () => {
  const bytes = await readFile(new URL('fixtures/media/with-audio.mp4', import.meta.url))
  const f = fixture({ chunks: [bytes.subarray(0, 80), bytes.subarray(80)] })
  const snapshot = await downloadRemoteMedia('https://media.example.com/a?signature=secret', 'video', 'video', signal(), f.deps)
  assert.deepEqual(await readFile(snapshot.path), bytes); assert.equal(snapshot.bytes, bytes.length); assert.equal((await stat(snapshot.path)).mode & 0o777, 0o600)
  const options = f.calls[0].options; assert.equal(options.agent, false); assert.deepEqual(options.headers, { accept: 'video/*,application/octet-stream' })
  options.lookup('media.example.com', {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, '93.184.216.34'); assert.equal(family, 4) })
  await snapshot.cleanup(); await assert.rejects(stat(snapshot.path), { code: 'ENOENT' })
})
test('remote audio uses its own limit; private DNS, redirects, HTTP errors and mismatched headers are rejected', async () => {
  for (const config of [{ addresses: [{ address: '127.0.0.1', family: 4 }] }, { status: 302, headers: { location: 'http://127.0.0.1' } }, { status: 502 }, { mime: 'text/html' }, { mime: 'video/mp4' }, { mime: 'audio/mpeg', headers: { 'content-length': String(MEDIA_LIMITS.audio) } }]) {
    const f = fixture(config)
    await assert.rejects(downloadRemoteMedia('https://media.example.com/file?signature=secret', 'audio', 'audio', signal(), f.deps), error => error.code === 'ASSET_READ_REJECTED' && !error.message.includes('secret'))
    assert.equal(f.calls.length, config.addresses ? 0 : 1)
  }
  const f = fixture({ mime: 'audio/mpeg', chunks: [Buffer.alloc(20 * 1024 * 1024)] })
  await assert.rejects(downloadRemoteMedia('https://media.example.com/file', 'audio', 'audio', signal(), f.deps), { code: 'ASSET_VALIDATION_REJECTED' })
})
test('aborted or truncated remote streams never return a successful snapshot', async () => {
  const before = new AbortController(); before.abort(); const f = fixture()
  await assert.rejects(downloadRemoteMedia('https://media.example.com/file', 'video', 'video', before.signal, f.deps), { code: 'CANCELLED_BEFORE_DISPATCH' }); assert.equal(f.calls.length, 0)
  for (const cancel of [false, true]) {
    const stream = new PassThrough(), c = new AbortController(), broken = fixture({ stream })
    const pending = downloadRemoteMedia('https://media.example.com/file', 'video', 'video', c.signal, broken.deps)
    while (!broken.calls.length) await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    stream.write(Buffer.from('partial'))
    if (cancel) c.abort(); else stream.destroy(new Error('secret connection reset'))
    await assert.rejects(pending, { code: cancel ? 'CANCELLED_BEFORE_DISPATCH' : 'ASSET_READ_REJECTED' })
  }
})
