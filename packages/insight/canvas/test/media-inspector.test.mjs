import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { snapshotAsset } from '../src/host/asset-snapshot.ts'
import { inspectCanvasMedia } from '../src/host/media-inspector.ts'

const attachments = { saveImage: async () => ({ width: 1, height: 1 }) }
async function inspect(data, type, name = 'fixture') {
  const signal = new AbortController().signal, snapshot = await snapshotAsset((async function* () { yield data })(), name, type, signal)
  try { return await inspectCanvasMedia(snapshot, type, attachments, signal) }
  finally { await snapshot.cleanup() }
}
test('UTF-8 BOM and exact text are preserved; binary, malformed UTF-8 and oversized text are refused', async () => {
  assert.equal((await inspect(Buffer.from('\ufeff你好\n'), 'text')).text, '你好\n')
  for (const data of [Buffer.from([255, 0, 128]), Buffer.from('a\0b'), Buffer.from('x'.repeat(32769))]) await assert.rejects(inspect(data, 'text'), { code: 'ASSET_VALIDATION_REJECTED' })
})
test('actual MP4/WebM tracks and MP3/WAV/M4A/AAC duration are parsed without a browser or ffmpeg', async () => {
  for (const [name, type, hasAudio] of [ ['with-audio.mp4', 'video', true], ['silent.mp4', 'video', false], ['short.mov', 'video', true], ['short.webm', 'video', false], ['short.mp3', 'audio', true], ['short.wav', 'audio', true], ['short.m4a', 'audio', true], ['short.aac', 'audio', true] ]) {
    const file = await inspect(await readFile(new URL('./fixtures/media/' + name, import.meta.url)), type, name)
    assert.equal(file.mediaType, type); assert.equal(file.hasAudio, hasAudio); assert(file.duration > 0)
    if (type === 'video') assert.deepEqual([file.width, file.height], [16, 16])
  }
})
test('all four raster formats are sniffed from bytes and use the native image validator', async () => {
  const expected = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
  for (const [extension, mimeType] of Object.entries(expected)) {
    const bytes = await readFile(new URL('./fixtures/media/short.' + extension, import.meta.url))
    const snapshot = await snapshotAsset((async function* () { yield bytes })(), 'image.' + extension, 'image', new AbortController().signal)
    let validated = false
    try {
      const file = await inspectCanvasMedia(snapshot, 'image', { saveImage: async image => { assert.equal(image.mediaType, mimeType); assert.deepEqual(image.data, bytes); validated = true; return { width: 1, height: 1, originalDimensions: { width: 16, height: 16 } } } }, new AbortController().signal)
      assert.equal(validated, true); assert.equal(file.mimeType, mimeType); assert.equal(file.width, 16); assert.equal(file.height, 16)
    } finally { await snapshot.cleanup() }
  }
})
test('mislabelled tracks and corrupted containers fail before upload; audio MP4 is not a video', async () => {
  await assert.rejects(inspect(await readFile(new URL('./fixtures/media/short.m4a', import.meta.url)), 'video'), { code: 'ASSET_VALIDATION_REJECTED' })
  await assert.rejects(inspect(await readFile(new URL('./fixtures/media/with-audio.mp4', import.meta.url)), 'audio'), { code: 'ASSET_VALIDATION_REJECTED' })
  await assert.rejects(inspect(Buffer.from('not-a-video'), 'video'), { code: 'ASSET_VALIDATION_REJECTED' })
  await assert.rejects(inspect(Buffer.from('not-an-image'), 'image'), { code: 'ASSET_VALIDATION_REJECTED' })
})
