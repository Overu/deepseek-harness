import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionImages, readSessionImage } from '../src/host/asset-resolver.ts'
const ref = (attachmentId, name = 'picture.png') => ({ attachmentId, name, mediaType: 'image/png', bytes: 3, width: 1, height: 1 })
const user = image => ({ role: 'user', content: [{ type: 'image', attachment: image }] })
const exec = messages => ({ agent: { session: { deriveMessages: () => messages } }, signal: new AbortController().signal })
test('only current visible user images authorize reads, duplicate images retain recent order', () => {
  const a = ref('a'), b = ref('b')
  assert.deepEqual(sessionImages(exec([user(a), user(b), user(a), { role: 'assistant', content: [{ type: 'image', attachment: ref('external') }] }, { role: 'user', content: [{ type: 'file', attachment: { attachmentId: 'file' } }] }])), [a, b])
  assert.throws(() => sessionImages({}), { code: 'AGENT_CONTEXT_REQUIRED' })
})
test('a missing or offloaded attachment fails before provider read, without filesystem fallback', async () => {
  let reads = 0
  const store = { readImage: async () => { reads++; throw Error('private-path') } }
  await assert.rejects(readSessionImage(store, exec([user(ref('a'))]), 'other-session'), { code: 'ASSET_NOT_FOUND' })
  await assert.rejects(readSessionImage(store, exec([]), 'a'), { code: 'ASSET_NOT_FOUND' })
  assert.equal(reads, 0)
})
test('passes the actual ref and signal to the verified attachment provider without using request variants', async () => {
  const image = ref('a'); const context = exec([user(image)]), data = new Uint8Array([1, 2, 3]); let reads = 0
  const result = await readSessionImage({ readImage: async (value, signal) => { reads++; assert.equal(value, image); assert.equal(signal, context.signal); return { ref: value, data } } }, context, 'a')
  assert.equal(result.data, data); assert.equal(reads, 1)
})
test('provider failure is sanitized; pre-read cancellation never calls the provider', async () => {
  const context = exec([user(ref('a'))]); const store = { readImage: async () => { throw Error('private-path') } }
  await assert.rejects(readSessionImage(store, context, 'a'), error => error.code === 'ASSET_READ_REJECTED' && !error.message.includes('private-path'))
  const controller = new AbortController(); controller.abort(); context.signal = controller.signal
  await assert.rejects(readSessionImage({ readImage: () => assert.fail('must not read') }, context, 'a'), { code: 'CANCELLED_BEFORE_DISPATCH' })
})
