import assert from 'node:assert/strict'
import test from 'node:test'
import { registerCanvasAssetTools } from '../src/host/canvas-asset-tools.ts'
import { CanvasAgentError } from '../src/shared/canvas-agent-protocol.ts'
const id = '103161', url = 'https://example-bucket.oss-cn-hangzhou.aliyuncs.com/user/image.png'
const image = { attachmentId: 'image-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1, name: 'test.png' }
const args = { canvasId: id, expectedVersion: '18', source: { type: 'attachment', attachmentId: image.attachmentId }, title: '图片素材' }
const exec = (callId = 'import-1', session = 'session-1', images = [image]) => ({ callId, agent: { id: session, session: { id: session, deriveMessages: () => [{ role: 'user', content: images.map(attachment => ({ type: 'image', attachment })) }] } }, signal: new AbortController().signal })
function fixture(overrides = {}) {
  const definitions = new Map(), calls = [], cleanups = []
  const ctx = { sessionQuery: { observeSession: async sessionId => ({ header: { id: sessionId, createdAt: 0 }, events: [], [Symbol.dispose]() {} }) }, tools: { register: definition => { definitions.set(definition.name, definition); return () => {} } }, effect: fn => { cleanups.push(fn()) }, attachments: { readImage: async ref => { calls.push(['read-image', ref.attachmentId]); return { ref, data: new Uint8Array([1, 2, 3]) } } } }
  const bridge = { ensureContext: async (...input) => { calls.push(['prepare', ...input]); return { canvasId: input[1], readiness: { version: '18' } } },
    dispatch: async (_target, request, operation) => { calls.push(['dispatch', request, operation]); return operation.action === 'canvas.read' ? { status: 'read', consistency: 'confirmed', nodes: [{ id: 'source', type: 'image', outputs: ['https://cdn.example.com/result.png'], truncatedFields: [] }] } : { status: 'saved', canvasId: id, version: '19', affectedNodeIds: ['asset-node'], unchanged: false } }, ...overrides.bridge }
  const api = { getIdentity: async () => { calls.push(['identity']); return { userId: '123', token: 'private-token' } },
    uploadMedia: async stored => { calls.push(['upload', stored.ref.attachmentId]); return { ...stored.ref, url } },
    registerMedia: async (...input) => { calls.push(['register', ...input]); return { status: 'registered' } }, ...overrides.api }
  registerCanvasAssetTools(ctx, bridge, api, overrides.importOptions)
  return { ctx, calls, cleanups, definitions, run: async (name, input, context = exec()) => JSON.parse(await definitions.get(name).execute(input, context)) }
}

test('generic user file attachments are discovered without reading bytes and text imports skip OSS and registration', async () => {
  const f = fixture(), text = Buffer.from('\ufeff商品说明\n保留正文')
  const attachment = { attachmentId: 'text-file', name: '文案.md', bytes: text.length }
  const context = exec('text-file'); context.agent.session.deriveMessages = () => [{ role: 'user', content: [{ type: 'file', attachment }] }]
  let reads = 0
  f.ctx.attachments.readFileStream = async function* () { reads++; yield text }
  const list = await f.run('canvas_assets', { mediaType: 'text' }, context)
  assert.equal(reads, 0); assert.equal(list.assets[0].mediaType, 'text')
  const result = await f.run('canvas_asset_import', { ...args, source: list.assets[0].source }, context)
  assert.equal(result.status, 'saved'); assert.equal(result.asset.status, 'not_applicable'); assert.equal(result.assetRegistration.status, 'not_applicable')
  assert.deepEqual(f.calls.find(call => call[0] === 'dispatch')[2].asset, { mediaType: 'text', text: '商品说明\n保留正文', title: '图片素材' })
  assert.equal(reads, 1); assert(!f.calls.some(call => call[0] === 'upload' || call[0] === 'register'))
  assert(!JSON.stringify(result).includes('insight-canvas-asset-'))
})

test('workspace media uses content identity, keeps video audio metadata, and cleans its private snapshots', async () => {
  const { readFile, stat } = await import('node:fs/promises')
  let bytes = await readFile(new URL('fixtures/media/with-audio.mp4', import.meta.url)), version = 1
  const uploads = [], files = []
  const f = fixture({ api: { uploadMedia: async prepared => {
    assert.equal(prepared.mediaType, 'video'); assert.equal(prepared.duration, 1)
    assert.equal(prepared.hasAudio, version === 1); assert.deepEqual(await readFile(prepared.path), bytes)
    files.push(prepared.path); uploads.push(prepared.sha256)
    return { url, mediaType: prepared.mimeType, bytes: prepared.bytes }
  } } })
  f.ctx.get = () => ({ resolve: async path => ({ targetKey: path }), contains: (_root, target) => target.targetKey.startsWith('/workspace/'), stat: async () => ({ type: 'file', version, size: bytes.length }), readByteRange: async (_target, range) => bytes.subarray(range.offset, range.offset + range.length) })
  const input = { ...args, source: { type: 'workspace_file', path: '/workspace/final.mp4' } }, context = exec('video1'); context.agent.session.header = { cwd: '/workspace' }
  const first = await f.run('canvas_asset_import', input, context); assert.equal(first.status, 'saved')
  assert.deepEqual(await f.run('canvas_asset_import', input, context), first)
  const next = { ...context, callId: 'video2' }; assert.equal((await f.run('canvas_asset_import', input, next)).asset.status, 'reused'); assert.equal(uploads.length, 1)
  bytes = await readFile(new URL('fixtures/media/silent.mp4', import.meta.url)); version = 2
  assert.equal((await f.run('canvas_asset_import', input, { ...context, callId: 'video3' })).asset.status, 'uploaded'); assert.equal(uploads.length, 2); assert.notEqual(uploads[0], uploads[1])
  for (const path of files) await assert.rejects(stat(path), { code: 'ENOENT' })
  assert.equal(f.calls.filter(call => call[0] === 'register').at(-1)[6], 'video')
})
test('registers two controlled tools; available and missing-image list do not upload or prepare', async () => {
  const f = fixture(); assert.deepEqual([...f.definitions.keys()], ['canvas_assets', 'canvas_asset_import'])
  const list = await f.run('canvas_assets', {}); assert.equal(list.status, 'available'); assert.equal(list.scope, 'current_session_assets'); assert.deepEqual(list.assets.map(item => item.source), [{ type: 'attachment', attachmentId: image.attachmentId }]); assert.equal(list.assets[0].mediaType, 'image')
  assert.equal((await f.run('canvas_assets', {}, exec('list', 's', []))).status, 'needs_input')
  assert.equal((await f.run('canvas_assets', { sessionId: 'other' })).error.code, 'INVALID_ARGUMENT'); assert.equal(f.calls.length, 0)
  assert.equal((await f.run('canvas_assets', {}, { ...exec(), agent: undefined })).error.code, 'AGENT_CONTEXT_REQUIRED')
})
test('imports through the native asset operation, returns real IDs/version and independent registration', async () => {
  const f = fixture(); const result = await f.run('canvas_asset_import', args)
  assert.equal(result.status, 'saved'); assert.equal(result.version, '19'); assert.deepEqual(result.affectedNodeIds, ['asset-node']); assert.equal(result.assetRegistration.status, 'registered')
  const dispatch = f.calls.find(value => value[0] === 'dispatch'); assert.deepEqual(dispatch[2], { action: 'asset.add', expectedVersion: '18', asset: { url, title: '图片素材' } })
  assert.equal(f.calls.filter(value => value[0] === 'upload').length, 1); assert.equal(f.calls.filter(value => value[0] === 'register').length, 1)
  assert.equal(f.calls.find(value => value[0] === 'register')[2], id); assert.equal(f.calls.find(value => value[0] === 'register')[3], 'asset-node')
  assert(!JSON.stringify(result).includes('private-token'))
})
test('same call deduplicates concurrent import and registration; changed parameters reject without more writes', async () => {
  const f = fixture(); const [a, b] = await Promise.all([f.run('canvas_asset_import', args), f.run('canvas_asset_import', args)])
  assert.deepEqual(a, b); assert.equal(f.calls.filter(value => value[0] === 'dispatch').length, 1)
  assert.equal((await f.run('canvas_asset_import', { ...args, title: '另一个' })).error.code, 'DUPLICATE_REQUEST_MISMATCH')
  assert.equal(f.calls.filter(value => value[0] === 'register').length, 1)
})
test('confirmed upload is reused on a distinct explicit call, scoped to same identity and session', async () => {
  const f = fixture(); await f.run('canvas_asset_import', args)
  const reused = await f.run('canvas_asset_import', args, exec('another')); assert.equal(reused.asset.status, 'reused')
  assert.equal(f.calls.filter(value => value[0] === 'upload').length, 1)
  await f.run('canvas_asset_import', args, exec('another', 'different-session')); assert.equal(f.calls.filter(value => value[0] === 'upload').length, 2)
})
test('invalid inputs and stale version stop before material upload; absent source fails before byte read', async () => {
  const f = fixture()
  for (const input of [{ ...args, source: { type: 'attachment', attachmentId: 'a', url } }, { ...args, source: { ...args.source, canvasId: id } }, { ...args, position: { x: 0, y: 0, z: 1 } }, { ...args, title: ' ' }, { ...args, expectedVersion: '' }, { ...args, sessionId: 'other' }]) {
    const result = await f.run('canvas_asset_import', input).catch(cause => { assert.equal(cause.code, 'INVALID_ARGS'); return { error: { code: 'INVALID_ARGUMENT' } } })
    assert.equal(result.error.code, 'INVALID_ARGUMENT')
  }
  assert.equal(f.calls.length, 0)
  const stale = await f.run('canvas_asset_import', { ...args, expectedVersion: '17' }); assert.equal(stale.error.code, 'VERSION_CONFLICT'); assert(!f.calls.some(value => value[0] === 'upload'))
  const missing = await f.run('canvas_asset_import', { ...args, source: { type: 'attachment', attachmentId: 'other' } }, exec('missing'))
  assert.equal(missing.error.code, 'ASSET_NOT_FOUND'); assert(!f.calls.some(value => value[0] === 'read-image'))
})
test('changed identity after upload refuses canvas dispatch but preserves uploaded material', async () => {
  let reads = 0; const f = fixture({ api: { getIdentity: async () => ({ userId: ++reads === 1 ? '123' : '456', token: 'private-token' }) } })
  const result = await f.run('canvas_asset_import', args)
  assert.equal(result.status, 'rejected'); assert.equal(result.error.code, 'AUTH_REQUIRED'); assert.equal(result.asset.url, url)
  assert(!f.calls.some(value => value[0] === 'dispatch' || value[0] === 'register'))
})
test('unknown upload is retained across new calls, never dispatches or registers', async () => {
  let uploads = 0; const f = fixture({ api: { uploadMedia: async () => { uploads++; throw new CanvasAgentError('ASSET_UPLOAD_UNKNOWN', 'unknown') } } })
  const a = await f.run('canvas_asset_import', args); assert.equal(a.status, 'upload_unknown'); assert.equal(a.error.retry, 'never_auto')
  await f.run('canvas_asset_import', args); await f.run('canvas_asset_import', args, exec('new-call')); assert.equal(uploads, 1)
  assert(!f.calls.some(value => value[0] === 'dispatch' || value[0] === 'register'))
})
test('unknown native save keeps IDs and never_auto; new explicit read/recovery belongs to native fence', async () => {
  const f = fixture({ bridge: { dispatch: async () => ({ status: 'submission_unknown', canvasId: id, phase: 'save', version: null, affectedNodeIds: ['unknown-node'], error: { code: 'SUBMISSION_UNKNOWN', message: 'read first', retry: 'read_first' } }) } })
  const result = await f.run('canvas_asset_import', args); assert.equal(result.status, 'submission_unknown'); assert.deepEqual(result.affectedNodeIds, ['unknown-node']); assert.equal(result.error.retry, 'never_auto')
  assert(!f.calls.some(value => value[0] === 'register'))
  assert.deepEqual(await f.run('canvas_asset_import', args), result)
})
test('registration failure never changes saved or repeats the node; malformed write receipt remains unknown', async () => {
  const f = fixture({ api: { registerMedia: async () => ({ status: 'registration_unknown', error: { code: 'SUBMISSION_UNKNOWN', message: 'not confirmed', retry: 'never_auto' } }) } })
  const result = await f.run('canvas_asset_import', args); assert.equal(result.status, 'saved'); assert.equal(result.assetRegistration.status, 'registration_unknown')
  await f.run('canvas_asset_import', args); assert.equal(f.calls.filter(value => value[0] === 'dispatch').length, 1)
  const malformed = fixture({ bridge: { dispatch: async () => ({ status: 'saved', affectedNodeIds: [], version: '19' }) } })
  assert.equal((await malformed.run('canvas_asset_import', args)).status, 'submission_unknown')
})
test('authorized canvas image reuse does not read/upload attachments and demands a specific output when ambiguous', async () => {
  const input = { ...args, source: { type: 'canvas_node', canvasId: '2873', nodeId: 'source' } }; const f = fixture()
  const result = await f.run('canvas_asset_import', input); assert.equal(result.status, 'saved'); assert.equal(result.asset.url, 'https://cdn.example.com/result.png')
  assert(!f.calls.some(value => ['upload', 'read-image'].includes(value[0])))
  const multiple = fixture({ bridge: { dispatch: async () => ({ status: 'read', consistency: 'confirmed', nodes: [{ id: 'source', type: 'image', outputs: [url, url + '2'], truncatedFields: [] }] }) } })
  const missing = await multiple.run('canvas_asset_import', input); assert.equal(missing.status, 'needs_input'); assert.deepEqual(missing.missing, ['source.outputIndex'])
  assert(!multiple.calls.some(value => value[0] === 'register'))
})
test('generic error after a write attempt is unknown and sanitized; cancelled or disposed tool sends no upload', async () => {
  const f = fixture({ bridge: { dispatch: async () => { throw Error('private-token') } } })
  const result = await f.run('canvas_asset_import', args); assert.equal(result.status, 'submission_unknown'); assert(!JSON.stringify(result).includes('private-token'))
  const g = fixture(); const context = exec(); const controller = new AbortController(); controller.abort(); context.signal = controller.signal
  assert.equal((await g.run('canvas_asset_import', args, context)).error.code, 'CANCELLED_BEFORE_DISPATCH'); assert.equal(g.calls.length, 0)
  g.cleanups.forEach(cleanup => cleanup?.()); assert.equal((await g.run('canvas_asset_import', args, exec('other'))).error.code, 'CLIENT_UNAVAILABLE')
})


test('asset tool exposes only placement and preserves auto, exact zero and anchor modes', async () => {
  const f = fixture(); const schema = f.definitions.get('canvas_asset_import').parameters.properties;
  assert(!('position' in schema)); assert.equal(schema.placement.oneOf.length, 3);
  for (const placement of [{ mode: 'auto' }, { mode: 'absolute', position: { x: 0, y: 0 } }, { mode: 'after', anchorNodeId: 'anchor' }]) {
    assert.equal((await f.run('canvas_asset_import', { ...args, placement }, exec('placement-' + placement.mode))).status, 'saved');
    assert.deepEqual(f.calls.filter(value => value[0] === 'dispatch').at(-1)[2].asset, { url, title: '图片素材', placement });
  }
});

test('asset model raw position and invalid placement stop before identity, prepare, read or upload', async () => {
  const f = fixture();
  for (const extra of [{ position: { x: 0, y: 0 } }, { placement: { mode: 'auto', position: { x: 0, y: 0 } } }, { placement: { mode: 'after', anchorNodeId: ' ' } }]) {
    const result = await f.run('canvas_asset_import', { ...args, ...extra }).catch(cause => { assert.equal(cause.code, 'INVALID_ARGS'); return { error: { code: 'INVALID_ARGUMENT' } }; });
    assert.equal(result.error.code, 'INVALID_ARGUMENT');
  }
  assert.equal(f.calls.length, 0);
});

test('asset placement participates in same-call fingerprint without repeating upload or node save', async () => {
  const f = fixture();
  const input = { ...args, placement: { mode: 'absolute', position: { x: 0, y: 0 } } };
  assert.equal((await f.run('canvas_asset_import', input)).status, 'saved');
  assert.equal((await f.run('canvas_asset_import', { ...input, placement: { mode: 'after', anchorNodeId: 'anchor' } })).error.code, 'DUPLICATE_REQUEST_MISMATCH');
  assert.equal(f.calls.filter(value => value[0] === 'upload').length, 1);
  assert.equal(f.calls.filter(value => value[0] === 'dispatch').length, 1);
});

function remoteHistory(f, output = 'https://media.example.com/new.png?Signature=private', mediaType = 'image') {
 const envelope = JSON.stringify({ code:0,status:'success',data:{[mediaType + '_list']:[output]} })
 const events=[{type:'tool/call',seq:10,data:{callId:'media-call',name:'bash',arguments:JSON.stringify({command:'python3 /skills/media-generator/generate.py text_to_image "test"'})}},
  {type:'tool/result',seq:11,data:{message:{role:'tool',source:{kind:'tool',callId:'media-call'},toolCallId:'media-call',content:[{type:'text',text:envelope}]}}}]
 f.ctx.sessionQuery={observeSession:async id=>({header:{id,createdAt:123},events,[Symbol.dispose](){}})}
 f.ctx.attachments.saveImage=async input=>{f.calls.push(['normalize',input.mediaType]);return {...image,attachmentId:'generated-normalized'}}
 return events
}
test('same-session generated image discovery is read-only and imports once through normalized bytes and existing OSS API',async()=>{
 let downloads=0
 const f=fixture({importOptions:{downloadImage:async(url,signal)=>{downloads++;assert(url.includes('Signature=private'));assert(!signal.aborted);return{data:new Uint8Array([1,2,3]),mediaType:'image/png'}}}})
 remoteHistory(f)
 const listing=await f.run('canvas_assets',{},exec('list','session-1',[]))
 assert.equal(listing.status,'available');assert.equal(listing.assets.length,1);assert.equal(f.calls.length,0);assert.equal(downloads,0)
 assert(!JSON.stringify(listing).includes('Signature'));assert(!JSON.stringify(listing).includes('media.example.com'))
 const input={...args,source:listing.assets[0].source}
 assert.equal((await f.run('canvas_asset_import',input,exec('generated-import'))).status,'saved')
 assert.equal((await f.run('canvas_asset_import',input,exec('generated-import-2'))).asset.status,'reused')
 assert.equal(downloads,2);assert.equal(f.calls.filter(x=>x[0]==='upload').length,1);assert.equal(f.calls.filter(x=>x[0]==='dispatch').length,2)
})
test('generated references cannot be used in another session or with URL authority supplied by the model',async()=>{
 let downloads=0;const f=fixture({importOptions:{downloadImage:async()=>{downloads++;throw Error('must not read')}}});remoteHistory(f)
 const source=(await f.run('canvas_assets',{},exec('list','session-1',[]))).assets[0].source
 assert.equal((await f.run('canvas_asset_import',{...args,source},exec('foreign','other'))).error.code,'ASSET_NOT_FOUND')
 await assert.rejects(f.run('canvas_asset_import',{...args,source:{...source,url:'http://127.0.0.1/private'}},exec('url')), {code:'INVALID_ARGS'})
 assert.equal(downloads,0);assert(!f.calls.some(x=>x[0]==='upload'||x[0]==='dispatch'))
})
test('read/decoder failure before upload is rejected, never an unknown upload or a saved node',async()=>{
 const f=fixture({importOptions:{downloadImage:async()=>({data:new Uint8Array([1]),mediaType:'image/png'})}});remoteHistory(f)
 f.ctx.attachments.saveImage=async()=>{throw Error('private-url: invalid image')}
 const source=(await f.run('canvas_assets',{},exec('list','session-1',[]))).assets[0].source
 const result=await f.run('canvas_asset_import',{...args,source},exec('decode-failure'))
 assert.equal(result.status,'rejected');assert.equal(result.error.code,'ASSET_READ_REJECTED');assert(!JSON.stringify(result).includes('private-url'));assert(!f.calls.some(x=>x[0]==='upload'||x[0]==='dispatch'))
})
test('a retired generated source is rechecked before cached upload reuse, preserving confirmed material without new writes',async()=>{
 const f=fixture({importOptions:{downloadImage:async()=>({data:new Uint8Array([1,2,3]),mediaType:'image/png'})}});const events=remoteHistory(f)
 const source=(await f.run('canvas_assets',{},exec('list','session-1',[]))).assets[0].source
 await f.run('canvas_asset_import',{...args,source},exec('first'))
 events[1].data.message.isError=true
 const result=await f.run('canvas_asset_import',{...args,source},exec('second'))
 assert.equal(result.error.code,'ASSET_NOT_FOUND');assert.equal(f.calls.filter(x=>x[0]==='upload').length,1);assert.equal(f.calls.filter(x=>x[0]==='dispatch').length,1)
})

test('unavailable generated history does not hide usable user attachments or pretend generated assets were verified',async()=>{
 const f=fixture();f.ctx.sessionQuery={observeSession:async()=>{throw Error('offline')}}
 const listing=await f.run('canvas_assets',{},exec('mixed'))
 assert.equal(listing.status,'available');assert.deepEqual(listing.assets.map(item => item.source),[{type:'attachment',attachmentId:image.attachmentId}]);assert.equal(listing.generatedSourceError.code,'ASSET_READ_REJECTED')
 const missing=await f.run('canvas_assets',{},exec('missing-history','session-1',[]));assert.equal(missing.status,'rejected');assert.equal(missing.error.code,'ASSET_READ_REJECTED')
 const filtered=await f.run('canvas_assets',{sourceType:'conversation_asset'},exec('filtered-history'));assert.equal(filtered.status,'rejected');assert.equal(filtered.error.code,'ASSET_READ_REJECTED')
})

test('authorized canvas text/video/audio reuse preserves content and verifies media before native save', async () => {
 const {readFile}=await import('node:fs/promises'),{snapshotAsset}=await import('../src/host/asset-snapshot.ts')
 for(const mediaType of ['text','video','audio']) {
  const f=fixture({bridge:{dispatch:async(_target,_request,op)=>{
   if(op.action==='canvas.read')return {status:'read',consistency:'confirmed',nodes:[{id:'source',type:mediaType,text:'保留正文',outputs:mediaType==='text'?[]:[url],truncatedFields:[]}]}
   f.calls.push(['dispatch',op]);return {status:'saved',canvasId:id,version:'19',affectedNodeIds:['copy'],unchanged:false}
  }},importOptions:{downloadMedia:async(value,name,type,signal)=>{assert.equal(value,url);return snapshotAsset((async function*(){yield await readFile(new URL('fixtures/media/'+(type==='video'?'with-audio.mp4':'short.wav'),import.meta.url))})(),name,type,signal)}}})
  const result=await f.run('canvas_asset_import',{...args,source:{type:'canvas_node',canvasId:id,nodeId:'source'}})
  assert.equal(result.status,'saved');assert.equal(result.asset.status,mediaType==='text'?'not_applicable':'reused')
  const native=f.calls.find(call=>call[0]==='dispatch')[1].asset;assert.equal(native.mediaType,mediaType)
  assert.equal(mediaType==='text'?native.text:native.url,mediaType==='text'?'保留正文':url)
  assert(!f.calls.some(call=>call[0]==='upload'||call[0]==='read-image'))
 }
})

test('media-generator video/audio references follow streaming inspection and native typed import without image decoding', async () => {
 const {readFile}=await import('node:fs/promises'),{snapshotAsset}=await import('../src/host/asset-snapshot.ts')
 for(const mediaType of ['video','audio']){
  const f=fixture({api:{uploadMedia:async file=>{assert.equal(file.mediaType,mediaType);assert.equal(file.hasAudio,true);return {url,mediaType:file.mimeType,bytes:file.bytes}}},importOptions:{downloadMedia:async(_url,name,type,signal)=>snapshotAsset((async function*(){yield await readFile(new URL('fixtures/media/'+(type==='video'?'with-audio.mp4':'short.wav'),import.meta.url))})(),name,type,signal)}})
  remoteHistory(f,'https://media.example.com/result',mediaType)
  const listing=await f.run('canvas_assets',{mediaType},exec('list','session-1',[]));assert.equal(listing.assets[0].mediaType,mediaType)
  const result=await f.run('canvas_asset_import',{...args,source:listing.assets[0].source},exec('import-'+mediaType))
  assert.equal(result.status,'saved');assert.equal(f.calls.find(call=>call[0]==='dispatch')[2].asset.mediaType,mediaType)
  assert(!f.calls.some(call=>call[0]==='normalize'||call[0]==='read-image'))
 }
})
