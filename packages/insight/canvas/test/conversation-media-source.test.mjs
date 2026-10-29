import assert from 'node:assert/strict'
import test from 'node:test'
import { conversationMedia } from '../src/host/conversation-media-source.ts'
const url = 'https://media.example.com/generated.png?Signature=private-reference'
const envelope = (images = [url], extra = {}) => JSON.stringify({ code: 0, status: 'success', data: { image_list: images }, ...extra })
const call = (id = 'generate', command = 'python3 /skills/media-generator/generate.py text_to_image "test"') => ({ type: 'tool/call', seq: 1, data: { callId: id, name: 'bash', arguments: JSON.stringify({ command }) } })
const result = (text, id = 'generate', extra = {}) => ({ type: 'tool/result', seq: 2, data: { message: { role: 'tool', toolCallId: id, source: { kind: 'tool', callId: id }, content: [{ type: 'text', text }], ...extra } } })
function fixture(events, session = 's', createdAt = 123) {
 let disposed = 0
 const ctx = { sessionQuery: { observeSession: async (id, options) => { assert.equal(id, session); assert.equal(options.projectionMode, 'none'); return { header: { id, createdAt }, events, [Symbol.dispose]() { disposed++ } } } } }
 const exec = { agent: { id: session, session: { id: session } }, signal: new AbortController().signal }
 return { read: () => conversationMedia(ctx, exec), ctx, exec, disposed: () => disposed }
}
test('discovers only exact successful media-generator tool results, without exposing bearer URLs', async () => {
 const f = fixture([call(), result(envelope())]); const images = await f.read()
 assert.equal(images.length, 1); assert.equal(images[0].url, url); assert.equal(images[0].origin, 'media_generator')
 assert.match(images[0].assetRef, /^conversation-image-[a-f0-9]{64}$/); assert.equal(images[0].outputIndex, 0)
 assert.equal((await f.read())[0].assetRef, images[0].assetRef); assert.equal(f.disposed(), 2)
 assert.notEqual((await fixture([call(), result(envelope())], 'other').read())[0].assetRef, images[0].assetRef)
 assert.notEqual((await fixture([call(), result(envelope())], 's', 124).read())[0].assetRef, images[0].assetRef)
})
test('same-index video/audio/image results remain distinct, and old image references are stable', async () => {
 const mixed = JSON.stringify({code:0,status:'success',data:{image_list:[url],video_list:[url],audio_list:[url],file_list:[url]}})
 const all = await fixture([call(),result(mixed)]).read(), image = (await fixture([call(),result(envelope())]).read())[0]
 assert.deepEqual(all.map(x=>x.mediaType),['image','video','audio']); assert.equal(all[0].assetRef,image.assetRef)
 assert.equal(new Set(all.map(x=>x.assetRef)).size,3); assert(all.every(x=>x.outputIndex===0))
})
test('rejects failures, running, truncated JSON, arbitrary links, unsupported list entries and unrelated commands', async () => {
 for (const text of [envelope([url], { status: 'running' }), envelope([url], { code: 1 }), envelope().slice(0,-1), 'look at '+url, envelope([{ invented: url }]), envelope()+'\n[exit code: 1]', envelope()+'\n[output truncated; full output: /private/file]']) {
  assert.deepEqual(await fixture([call(), result(text)]).read(), [])
 }
 assert.deepEqual(await fixture([call('generate', 'curl https://example.com'), result(envelope())]).read(), [])
 assert.deepEqual(await fixture([call(), result(envelope(), 'foreign')]).read(), [])
 assert.deepEqual(await fixture([call(), result(envelope(), 'generate', { isError: true })]).read(), [])
 assert.deepEqual(await fixture([{ type: 'user/message', seq: 1, data: { text: envelope() } }]).read(), [])
})
test('correlates promoted bash jobs and assembles bounded job_output deltas before accepting completed output', async () => {
 const text = envelope(), middle = Math.floor(text.length / 2)
 const jobCall = id => ({ type: 'tool/call', seq: 3, data: { callId: id, name: 'job_output', arguments: '{"job_id":"bash-1"}' } })
 const prefix = [call(), result('started background job bash-1'), jobCall('read-1'), result(text.slice(0,middle)+'\n[status: running]', 'read-1')]
 assert.deepEqual(await fixture(prefix).read(), [])
 const all = [...prefix, jobCall('read-2'), result(text.slice(middle)+'\n[status: completed, exit code: 0]', 'read-2')]
 const images = await fixture(all).read(); assert.equal(images.length,1); assert.equal(images[0].callId,'generate')
 const foreign = [...prefix, { ...jobCall('wrong'), data: { ...jobCall('wrong').data, arguments: '{"job_id":"other"}' } }, result(envelope()+'\n[status: completed, exit code: 0]', 'wrong')]
 assert.deepEqual(await fixture(foreign).read(), [])
})
test('preserves multiple image indexes, sorts newer results first, and retires a source on a later failed settlement', async () => {
 const images = await fixture([call(), result(envelope([url, 'https://media.example.com/two.png']))]).read()
 assert.deepEqual(images.map(x=>x.outputIndex),[0,1]); assert.notEqual(images[0].assetRef,images[1].assetRef)
 assert.deepEqual(await fixture([call(), result(envelope()), result('failed','generate',{isError:true})]).read(),[])
})
test('history failures and header conflicts cannot authorize a URL, leases always dispose', async () => {
 const f=fixture([call(),result(envelope())]); f.ctx.sessionQuery.observeSession=async()=>({header:{id:'foreign',createdAt:123},events:[call(),result(envelope())],[Symbol.dispose](){}})
 await assert.rejects(f.read(),{code:'ASSET_NOT_FOUND'})
 const cancelled=new AbortController();cancelled.abort();f.exec.signal=cancelled.signal
 await assert.rejects(f.read(),{code:'CANCELLED_BEFORE_DISPATCH'})
})
