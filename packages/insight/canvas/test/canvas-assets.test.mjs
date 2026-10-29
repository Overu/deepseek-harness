import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvasAssetApi } from '../src/host/canvas-assets.ts'

const identity = { userId: '103', token: 'private-token' }
const stored = (mediaType = 'image/png') => ({ ref: { attachmentId: 'image-ref', mediaType, bytes: 3, width: 2, height: 1 }, data: new Uint8Array([1, 2, 3]) })
const credentials = (userId = identity.userId) => ({ userId, bucket: 'insight-canvas', region: 'oss-cn-hangzhou', dir: 'canvas/images/',
  accessKeyId: 'private-key', accessKeySecret: 'private-secret', securityToken: 'private-sts', expiration: new Date(Date.now() + 60_000).toISOString(), endPoint: 'https://untrusted.invalid/' })
const response = data => new Response(JSON.stringify({ code: 'SUCCESS', data }))
function fixture({ reply, put } = {}) {
  const calls = []; const puts = []; let tokens = 0
  const api = createCanvasAssetApi({ tokenProvider: async () => { tokens++; return identity.token },
    transport: async (url, init) => { calls.push({ url, init }); return reply ? reply(url, init) : response(url.endsWith('getUserDetail') ? { id: identity.userId } : credentials()) },
    put: async request => { puts.push(request); return put ? put(request) : { url: 'http://untrusted.invalid/private-sts', res: { status: 200 } } } })
  return { api, calls, puts, tokenCount: () => tokens }
}
const safeError = error => !/private-|untrusted/u.test(error.message)

test('audio/video uploads stream exact file bytes and register native types and duration', async () => {
  const { readFile } = await import('node:fs/promises')
  const { snapshotAsset } = await import('../src/host/asset-snapshot.ts')
  for (const [file, mediaType, mimeType, assetType] of [['with-audio.mp4', 'video', 'video/mp4', 2], ['short.wav', 'audio', 'audio/wav', 3]]) {
    const bytes = await readFile(new URL('fixtures/media/' + file, import.meta.url))
    const snapshot = await snapshotAsset((async function* () { yield bytes })(), file, mediaType, new AbortController().signal)
    const consumed = []
    const f = fixture({ put: async request => { assert(!(request.data instanceof Uint8Array)); assert.equal(request.bytes, bytes.length); for await (const chunk of request.data) consumed.push(chunk); return { res: { status: 200 } } } })
    try {
      const uploaded = await f.api.uploadMedia({ ...snapshot, mediaType, mimeType, duration: 1, hasAudio: true, ...(mediaType === 'video' ? { width: 16, height: 16 } : {}) }, identity)
      assert.deepEqual(Buffer.concat(consumed), bytes); assert.equal(uploaded.hasAudio, true)
      assert.equal((await f.api.registerMedia(uploaded.url, '103161', 'node', identity, undefined, mediaType, 0.2)).status, 'registered')
      const body = JSON.parse(f.calls.at(-1).init.body); assert.equal(body.assetType, assetType); assert.equal(body.duration, 1)
      assert(!JSON.stringify(uploaded).includes(snapshot.path))
    } finally { await snapshot.cleanup() }
  }
  const f = fixture()
  for (const [type, duration] of [['audio', undefined], ['video', NaN], ['video', 301], ['audio', 0], ['text', 1]]) {
    const result = await f.api.registerMedia('https://cdn.example.com/file', '103161', 'node', identity, undefined, type, duration)
    assert.equal(result.status, 'rejected'); assert.equal(result.error.code, 'INVALID_ARGUMENT')
  }
  assert.equal(f.calls.length, 0)
})

test('identity uses current desktop token and fixed test/production GET with no redirects', async () => {
  const previous = process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT
  try {
    for (const [environment, suffix] of [[undefined, '-test'], ['test', '-test'], ['production', '']]) {
      if (environment === undefined) delete process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT
      else process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT = environment
      const f = fixture(); assert.deepEqual(await f.api.getIdentity(), identity)
      assert.equal(f.tokenCount(), 1); assert.equal(f.calls.length, 1)
      assert.equal(f.calls[0].url, `https://gapi${suffix}.insight-aigc.com/user-server/getUserDetail`)
      assert.equal(f.calls[0].init.method, 'GET'); assert.equal(f.calls[0].init.body, undefined)
      assert.equal(f.calls[0].init.headers.token, identity.token)
      assert.equal(f.calls[0].init.headers.origin, `https://dynsight${suffix}.insight-aigc.com`)
      assert.equal(f.calls[0].init.redirect, 'error')
    }
  } finally { if (previous === undefined) delete process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT; else process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT = previous }
})
test('identity success forms and Long JSON tokens are preserved exactly', async () => {
  for (const code of ['SUCCESS', 200, 0, '0']) {
    const f = fixture({ reply: () => new Response(`{"code":${JSON.stringify(code)},"data":{"userId":9223372036854775807}}`) })
    assert.deepEqual(await f.api.getIdentity(), { userId: '9223372036854775807', token: identity.token })
  }
  const f = fixture({ reply: () => new Response('{"code":0,"id":103}') }); assert.deepEqual(await f.api.getIdentity(), identity)
})
test('invalid environment and cancelled token lookup never send a request', async () => {
  const previous = process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT
  try {
    process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT = 'invalid'; const f = fixture()
    await assert.rejects(f.api.getIdentity(), { code: 'CONFIGURATION_ERROR', requestPhase: 'not_sent' })
    await assert.rejects(f.api.uploadMedia(stored(), identity), { code: 'CONFIGURATION_ERROR', requestPhase: 'not_sent' })
    assert.equal(f.tokenCount(), 0); assert.equal(f.calls.length, 0); assert.equal(f.puts.length, 0)
  } finally { if (previous === undefined) delete process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT; else process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT = previous }
  const f = fixture(); const controller = new AbortController(); controller.abort()
  await assert.rejects(f.api.getIdentity(controller.signal), { code: 'CANCELLED_BEFORE_DISPATCH', requestPhase: 'not_sent' })
  assert.equal(f.calls.length, 0); assert.equal(f.tokenCount(), 0)
})
test('identity rejects invalid account IDs and hides auth error text', async () => {
  for (const id of [0, -1, '', '01', '9223372036854775808', {}]) {
    const f = fixture({ reply: () => response({ id }) })
    await assert.rejects(f.api.getIdentity(), error => error.code === 'AUTH_REQUIRED' && safeError(error))
  }
  const api = createCanvasAssetApi({ tokenProvider: async () => { throw new Error('private-token') } })
  await assert.rejects(api.getIdentity(), error => error.code === 'AUTH_REQUIRED' && error.requestPhase === 'not_sent' && safeError(error))
})
test('upload uses native STS payload, trusted MIME extension and public URL rather than provider URLs', async () => {
  const f = fixture(); const image = stored(); image.ref.name = '../../untrusted.html'
  image.ref.originalDimensions = { width: 100, height: 50 }
  const result = await f.api.uploadMedia(image, identity)
  assert.equal(f.calls.length, 1); assert.equal(f.puts.length, 1)
  assert.equal(f.calls[0].url, 'https://gapi-test.insight-aigc.com/game-ai-editor-center/upload/sts/token')
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { fileName: 'image.png', libraryId: '1001', type: 1, userId: 103 })
  assert.equal(f.puts[0].credentials.endPoint, undefined)
  assert.match(f.puts[0].objectKey, /^canvas\/images\/[a-f0-9-]+\.png$/u)
  assert.deepEqual(f.puts[0].data, image.data); assert.equal(f.puts[0].mediaType, 'image/png')
  assert.equal(result.url, `https://insight-canvas.oss-cn-hangzhou.aliyuncs.com/${f.puts[0].objectKey}`)
  assert.deepEqual({ ...result, url: undefined }, { attachmentId: 'image-ref', mediaType: 'image/png', bytes: 3, width: 2, height: 1, originalDimensions: { width: 100, height: 50 }, url: undefined })
  assert.equal(JSON.stringify(result).includes('private-'), false)
})
test('each supported MIME selects its own extension; invalid sizes and metadata start no request', async () => {
  for (const [mime, extension] of [['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif']]) {
    const f = fixture(); await f.api.uploadMedia(stored(mime), identity)
    assert.equal(JSON.parse(f.calls[0].init.body).fileName, `image.${extension}`)
  }
  for (const image of [stored('image/svg+xml'), { ...stored(), data: new Uint8Array(4) }, { ...stored(), ref: { ...stored().ref, width: 0 } },
    { ...stored(), ref: { ...stored().ref, bytes: 20 * 1024 * 1024 }, data: new Uint8Array(20 * 1024 * 1024) }]) {
    const f = fixture(); await assert.rejects(f.api.uploadMedia(image, identity), { code: 'INVALID_ARGUMENT', requestPhase: 'not_sent' })
    assert.equal(f.calls.length, 0); assert.equal(f.puts.length, 0)
  }
})
test('STS rejects foreign users, invalid destination, expired or incomplete credentials before PUT', async () => {
  for (const patch of [{ userId: '104' }, { bucket: 'evil.invalid/path' }, { region: 'https://evil.invalid' }, { dir: '../secrets' },
    { dir: 'canvas/%2e%2e' }, { expiration: new Date(0).toISOString() }, { accessKeySecret: '' }, { securityToken: undefined }]) {
    const f = fixture({ reply: () => response({ ...credentials(), ...patch }) })
    await assert.rejects(f.api.uploadMedia(stored(), identity), error => error.code === 'ASSET_UPLOAD_REJECTED' && safeError(error))
    assert.equal(f.calls.length, 1); assert.equal(f.puts.length, 0)
  }
})
test('large Long IDs remain raw numeric JSON tokens in STS and registration payloads', async () => {
  const user = { ...identity, userId: '9223372036854775807' }
  const f = fixture({ reply: url => response(url.endsWith('/sts/token') ? credentials(user.userId) : {}) })
  const uploaded = await f.api.uploadMedia(stored(), user)
  assert.match(f.calls[0].init.body, /"userId":9223372036854775807[},]/u)
  assert.deepEqual(await f.api.registerMedia(uploaded.url, '9223372036854775807', 'node-1', user), { status: 'registered' })
  assert.match(f.calls[1].init.body, /"canvasId":9223372036854775807[},]/u)
})
test('PUT transport loss or malformed success is unknown and no operation retries automatically', async () => {
  for (const put of [async () => { throw new Error('private-sts') }, async () => { throw { status: 408 } }, async () => { throw { status: 500 } },
    async () => ({}), async () => ({ res: { status: 408 } }), async () => ({ res: { status: 500 } }), async () => ({ res: { status: 204 } })]) {
    const f = fixture({ put }); await assert.rejects(f.api.uploadMedia(stored(), identity), error => error.code === 'ASSET_UPLOAD_UNKNOWN' && error.requestPhase === 'submission_unknown' && safeError(error))
    assert.equal(f.calls.length, 1); assert.equal(f.puts.length, 1)
  }
})
test('cancellation before PUT does not dispatch; cancellation after PUT is unknown and stops waiting', async () => {
  const before = new AbortController(); const f = fixture({ reply: () => { before.abort(); return response(credentials()) } })
  await assert.rejects(f.api.uploadMedia(stored(), identity, before.signal), { code: 'CANCELLED_BEFORE_DISPATCH', requestPhase: 'not_sent' })
  assert.equal(f.puts.length, 0)
  const after = new AbortController(); let finish
  const g = fixture({ put: () => { after.abort(); return new Promise(resolve => { finish = resolve }) } })
  await assert.rejects(g.api.uploadMedia(stored(), identity, after.signal), { code: 'ASSET_UPLOAD_UNKNOWN', requestPhase: 'submission_unknown' })
  assert.equal(g.puts.length, 1); finish({ res: { status: 200 } })
})
test('HTTP/business refusal and STS transport failures stay sanitized and start no PUT', async () => {
  for (const [reply, code, phase] of [[() => new Response('private-token', { status: 401 }), 'AUTH_REQUIRED', 'not_sent'],
    [() => new Response('{"code":"USER_NOT_LOGIN","msg":"private-token"}'), 'AUTH_REQUIRED', 'not_sent'],
    [() => new Response('{"code":"DENIED","msg":"private-key"}'), 'ASSET_UPLOAD_REJECTED', 'not_sent'],
    [() => new Response('private-sts', { status: 502 }), 'CONTEXT_NOT_READY', 'not_sent'],
    [() => new Response('{'), 'CONTEXT_NOT_READY', 'not_sent'],
    [() => { throw new Error('private-key') }, 'CONTEXT_NOT_READY', 'not_sent']]) {
    const f = fixture({ reply }); await assert.rejects(f.api.uploadMedia(stored(), identity), error => error.code === code && error.requestPhase === phase && safeError(error))
    assert.equal(f.calls.length, 1); assert.equal(f.puts.length, 0)
  }
})
test('registration uses fixed native body, separates rejection from unknown, and never repeats PUT', async () => {
  const url = 'https://insight-canvas.oss-cn-hangzhou.aliyuncs.com/canvas/image.png'
  for (const [reply, status, code] of [[() => response({}), 'registered', undefined],
    [() => new Response('{"code":"DENIED","msg":"private-token"}'), 'rejected', 'ASSET_REGISTRATION_REJECTED'],
    [() => new Response('', { status: 503 }), 'registration_unknown', 'SUBMISSION_UNKNOWN']]) {
    const f = fixture({ reply }); const result = await f.api.registerMedia(url, '103161', 'node-1', identity)
    assert.equal(result.status, status); if (code) { assert.equal(result.error.code, code); assert.equal(safeError(result.error), true) }
    if (status === 'registration_unknown') assert.equal(result.error.retry, 'never_auto')
    assert.deepEqual(JSON.parse(f.calls[0].init.body), { assetType: 1, fileUrl: url, canvasId: 103161, nodeId: 'node-1', source: 0, sourceType: 'upload' })
    assert.equal(f.calls.length, 1); assert.equal(f.puts.length, 0)
  }
})
test('invalid registration destinations, IDs and pre-cancellation start no request', async () => {
  const f = fixture(); const url = 'https://insight-canvas.oss-cn-hangzhou.aliyuncs.com/canvas/image.png'
  for (const [value, id, node] of [['http://cdn.insight-aigc.com/a', '103', 'node'], ['https://user:pass@cdn.insight-aigc.com/a', '103', 'node'],
    ['https://cdn.insight-aigc.com/a#secret', '103', 'node'], [url, '0', 'node'], [url, '103', '']]) {
    const result = await f.api.registerMedia(value, id, node, identity); assert.equal(result.status, 'rejected'); assert.equal(result.error.code, 'INVALID_ARGUMENT')
  }
  const c = new AbortController(); c.abort()
  const result = await f.api.registerMedia(url, '103', 'node', identity, c.signal)
  assert.equal(result.status, 'rejected'); assert.equal(result.error.code, 'CANCELLED_BEFORE_DISPATCH')
  assert.equal(f.calls.length, 0); assert.equal(f.puts.length, 0)
})
test('identity reads the body envelope used by desktop login services', async () => {
  const f = fixture({ reply: () => new Response('{"code":0,"body":{"id":"103"}}') })
  assert.deepEqual(await f.api.getIdentity(), identity)
})
test('identity and STS transport or parse failures report no upload dispatch', async () => {
  for (const reply of [() => { throw new Error('private-token') }, () => new Response('{'), () => new Response('', { status: 503 })]) {
    const f = fixture({ reply })
    await assert.rejects(f.api.getIdentity(), error => error.code === 'CONTEXT_NOT_READY' && error.requestPhase === 'not_sent' && safeError(error))
    await assert.rejects(f.api.uploadMedia(stored(), identity), error => error.code === 'CONTEXT_NOT_READY' && error.requestPhase === 'not_sent' && safeError(error))
    assert.equal(f.calls.length, 2); assert.equal(f.puts.length, 0)
  }
})
test('trusted legal business CDN URLs can register without altering the URL', async () => {
  const url = 'https://cdn.insight-aigc.com/product/image.webp?version=1'
  const f = fixture({ reply: () => response({}) })
  assert.deepEqual(await f.api.registerMedia(url, '103161', 'node-1', identity), { status: 'registered' })
  assert.equal(JSON.parse(f.calls[0].init.body).fileUrl, url); assert.equal(f.puts.length, 0)
})
test('OSS PUT rejected by an explicit HTTP 403 reports rejection without retrying', async () => {
  const f = fixture({ put: async () => { throw Object.assign(new Error('private-secret'), { status: 403 }) } })
  await assert.rejects(f.api.uploadMedia(stored(), identity), error => error.code === 'ASSET_UPLOAD_REJECTED' && error.requestPhase === 'rejected' && safeError(error))
  assert.equal(f.calls.length, 1); assert.equal(f.puts.length, 1)
})
test('OSS PUT resolved with an explicit HTTP 403 reports rejection without retrying', async () => {
  const f = fixture({ put: async () => ({ res: { status: 403 }, message: 'private-secret' }) })
  await assert.rejects(f.api.uploadMedia(stored(), identity), error => error.code === 'ASSET_UPLOAD_REJECTED' && error.requestPhase === 'rejected' && safeError(error))
  assert.equal(f.calls.length, 1); assert.equal(f.puts.length, 1)
})
