import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import test from 'node:test'
import { downloadHandler } from '../src/host/download-route.ts'

const URL = 'https://assets.example.test/original.png?signature=private'
const PUBLIC = [{ address: '8.8.8.8', family: 4 }]
const graph = (url = URL, type = 'image') => ({ code: 'SUCCESS', data: { data: JSON.stringify({ nodes: [{ id: 'n1', type, data: { value: url } }] }) } })

async function fixture(t, options = {}) {
  let canvasReads = 0, lookups = 0, fallbackReads = 0, remoteReads = 0
  const captured = []
  const upstream = createServer(options.upstream ?? ((_req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.from([137,80,78,71,0,255])) }))
  const downstream = createServer(downloadHandler({ requestRejection: () => options.rejection }, {
    readCanvas: async (id, signal) => { canvasReads++; assert.equal(id, '103161'); assert.equal(signal.aborted, false); return options.canvas ?? graph() },
    lookup: async hostname => { lookups++; assert.equal(hostname, 'assets.example.test'); return options.addresses ?? PUBLIC },
    resolvePublic: async (hostname, signal) => { fallbackReads++; assert.equal(hostname, 'assets.example.test'); assert.equal(signal.aborted, false); return options.fallback ?? PUBLIC },
    request: (url, requestOptions, callback) => {
      remoteReads++; captured.push({ url, requestOptions })
      return httpRequest(`http://127.0.0.1:${upstream.address().port}`, { headers: requestOptions.headers }, callback)
    },
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  }))
  upstream.listen(0, '127.0.0.1'); downstream.listen(0, '127.0.0.1')
  await Promise.all([once(upstream, 'listening'), once(downstream, 'listening')])
  t.after(async () => {
    upstream.closeAllConnections(); downstream.closeAllConnections()
    await Promise.all([new Promise(resolve => upstream.close(resolve)), new Promise(resolve => downstream.close(resolve))])
  })
  const address = `http://127.0.0.1:${downstream.address().port}/desktop-canvas/api/download`
  return {
    address, captured,
    counters: () => ({ canvasReads, lookups, fallbackReads, remoteReads }),
    post: (body = { canvasId: '103161', url: URL }, init = {}) => fetch(address, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: 'client-secret=hidden', authorization: 'Bearer hidden', token: 'hidden' },
      body: typeof body === 'string' ? body : JSON.stringify(body), ...init,
    }),
  }
}

test('download rejects unauthenticated browser before canvas or remote reads', async t => {
  const f = await fixture(t, { rejection: 401 })
  assert.equal((await f.post()).status, 401)
  assert.deepEqual(f.counters(), { canvasReads: 0, lookups: 0, fallbackReads: 0, remoteReads: 0 })
})

test('download validates method, JSON shape, ID, URL length and body limit before authorization reads', async t => {
  const f = await fixture(t)
  assert.equal((await fetch(f.address)).status, 405)
  for (const body of ['invalid', [], {}, { canvasId: 103161, url: URL }, { canvasId: '0', url: URL },
    { canvasId: '103161', url: URL, token: 'not-accepted' }, { canvasId: '103161', url: 'https://assets.example.test/' + 'a'.repeat(8192) }]) {
    assert.equal((await f.post(body)).status, 400)
  }
  assert.equal((await f.post(' '.repeat(12 * 1024 + 1))).status, 413)
  assert.equal((await f.post({ canvasId: '103161', url: URL }, { headers: { 'content-type': 'text/plain' } })).status, 415)
  assert.equal(f.counters().canvasReads, 0)
})

test('download only accepts exact persisted non-text resource values or product values', async t => {
  for (const canvas of [graph(URL, 'text'), graph(URL + '&other=1'), { code: 'SUCCESS', data: { data: JSON.stringify({ nodes: [{ type: 'image', value: URL }] }) } }]) {
    const f = await fixture(t, { canvas })
    const response = await f.post()
    assert.equal(response.status, 403)
    assert.equal(f.counters().remoteReads, 0)
    assert.equal(f.counters().lookups, 0)
    assert.doesNotMatch(await response.text(), /signature|private|client-secret/)
  }
  const f = await fixture(t, { canvas: { code: 'SUCCESS', data: { data: { nodes: [{ type: 'video', data: { product: [{ value: URL }] } }] } } } })
  assert.equal((await f.post()).status, 200)
})

test('download refuses failed canvas authorization before contacting a resource', async t => {
  for (const [code, status] of [['USER_SESSION_EXPIRED', 401], ['USER_NOT_LOGIN', 401], ['NO_PERMISSION', 403], ['SUCCESS', 502]]) {
    const f = await fixture(t, { canvas: { code } })
    assert.equal((await f.post()).status, status)
    assert.equal(f.counters().remoteReads, 0)
  }
})

test('download preserves original image and video bytes and emits attachment without leaking credentials', async t => {
  for (const contentType of ['image/png', 'video/mp4']) {
    const bytes = Buffer.from([0,1,255,13,10,128,0,9])
    const f = await fixture(t, { upstream: (req, res) => {
      assert.equal(req.headers.cookie, undefined); assert.equal(req.headers.authorization, undefined); assert.equal(req.headers.token, undefined)
      res.writeHead(200, { 'content-type': contentType, 'content-length': bytes.length }); res.end(bytes)
    } })
    const response = await f.post()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/octet-stream')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.match(response.headers.get('content-disposition'), /^attachment/)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
    const { url, requestOptions } = f.captured[0]
    assert.equal(url.href, URL)
    assert.equal(requestOptions.agent, false)
    assert.equal(requestOptions.rejectUnauthorized, true)
    assert.equal(requestOptions.servername, 'assets.example.test')
    assert.deepEqual(Object.keys(requestOptions.headers), ['accept'])
    await new Promise((resolve, reject) => requestOptions.lookup('assets.example.test', {}, (error, address, family) => {
      if (error) { reject(error); return }
      assert.equal(address, '8.8.8.8'); assert.equal(family, 4); resolve()
    }))
  }
})

test('download rejects unsafe protocols, credentials, fragments, ports and private literals', async t => {
  for (const url of ['http://assets.example.test/a.png', 'file:///tmp/a', 'https://user:pass@assets.example.test/a',
    'https://assets.example.test/a#secret', 'https://assets.example.test:444/a', 'https://127.0.0.1/a', 'https://[::1]/a']) {
    const f = await fixture(t, { canvas: graph(url) })
    assert.equal((await f.post({ canvasId: '103161', url })).status, 400)
    assert.equal(f.counters().remoteReads, 0)
  }
})

test('download fails closed for empty, mixed-private, inconsistent and mixed Fake-IP DNS answers', async t => {
  for (const addresses of [[], [{ address: '127.0.0.1', family: 4 }], [...PUBLIC, { address: '10.0.0.1', family: 4 }],
    [{ address: '8.8.8.8', family: 6 }], [...PUBLIC, { address: '198.18.1.1', family: 4 }]]) {
    const f = await fixture(t, { addresses })
    assert.equal((await f.post()).status, 502)
    assert.equal(f.counters().remoteReads, 0)
    assert.equal(f.counters().fallbackReads, 0)
  }
})

test('download resolves independently only for all-Fake-IP DNS then verifies fallback addresses', async t => {
  const addresses = [{ address: '198.18.1.1', family: 4 }, { address: '198.19.2.2', family: 4 }]
  const valid = await fixture(t, { addresses })
  assert.equal((await valid.post()).status, 200)
  assert.equal(valid.counters().fallbackReads, 1)
  for (const fallback of [[], [...PUBLIC, { address: '192.168.0.1', family: 4 }]]) {
    const invalid = await fixture(t, { addresses, fallback })
    assert.equal((await invalid.post()).status, 502)
    assert.equal(invalid.counters().remoteReads, 0)
  }
})

test('download refuses redirects, non-2xx and HTML/error documents instead of saving them', async t => {
  for (const [status, type, body] of [[302, 'image/png', 'redirect'], [404, 'image/png', 'missing'], [200, 'text/html', '<html>expired</html>'],
    [200, 'application/json', '{"error":"expired"}'], [200, 'application/octet-stream', ' \ufeff<!doctype html><html>expired</html>']]) {
    const f = await fixture(t, { upstream: (_req, res) => { res.writeHead(status, { 'content-type': type, location: 'https://evil.example/' }); res.end(body) } })
    const response = await f.post()
    assert.equal(response.status, 502)
    assert.doesNotMatch(await response.text(), /expired|evil|signature/)
    assert.equal(f.counters().remoteReads, 1)
  }
})

test('download rejects declared and streamed overflow and detects Content-Length truncation', async t => {
  const declared = await fixture(t, { maxBytes: 4, upstream: (_req, res) => { res.writeHead(200, { 'content-type': 'image/png', 'content-length': 5 }); res.end('12345') } })
  assert.equal((await declared.post()).status, 413)
  const streamed = await fixture(t, { maxBytes: 4, upstream: (_req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.write('123'); setTimeout(() => res.end('45'), 5) } })
  const streamResponse = await streamed.post()
  if (streamResponse.status === 200) await assert.rejects(streamResponse.arrayBuffer())
  else assert.equal(streamResponse.status, 413)
  const truncated = await fixture(t, { upstream: (_req, res) => { res.writeHead(200, { 'content-type': 'image/png', 'content-length': 20 }); res.flushHeaders(); res.write('123'); setTimeout(() => res.destroy(), 5) } })
  const truncatedResponse = await truncated.post()
  if (truncatedResponse.status === 200) await assert.rejects(truncatedResponse.arrayBuffer())
  else assert.equal(truncatedResponse.status, 502)
})

test('download timeout and client cancellation close the upstream request', async t => {
  const timedOut = await fixture(t, { timeoutMs: 30, upstream: () => {} })
  assert.equal((await timedOut.post()).status, 504)
  let closedResolve
  const closed = new Promise(resolve => { closedResolve = resolve })
  const f = await fixture(t, { upstream: (req, res) => { req.once('close', closedResolve); res.writeHead(200, { 'content-type': 'video/mp4' }); res.write(Buffer.alloc(2048, 1)) } })
  const abort = new AbortController()
  const response = await f.post(undefined, { signal: abort.signal })
  assert.equal(response.status, 200)
  abort.abort()
  await Promise.race([closed, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('upstream remained open')), 1000); timer.unref() })])
})

test('download streams bytes before the upstream completes instead of buffering the file', async t => {
  let finish
  const f = await fixture(t, { upstream: (_req, res) => {
    res.writeHead(200, { 'content-type': 'video/mp4' }); res.write(Buffer.alloc(2048, 7))
    finish = () => res.end(Buffer.from([8,9]))
  } })
  const response = await f.post()
  assert.equal(response.status, 200)
  assert.equal(typeof finish, 'function')
  const reader = response.body.getReader(), first = await reader.read()
  assert.equal(first.done, false); assert.equal(first.value.byteLength, 2048)
  finish()
  const final = await reader.read()
  assert.deepEqual([...final.value], [8,9])
  assert.equal((await reader.read()).done, true)
})

test('download bounds chunked JSON requests without contacting the canvas service', async t => {
  const f = await fixture(t)
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest(f.address, { method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
      res.resume(); res.once('end', () => resolve(res.statusCode))
    })
    request.once('error', reject); request.write(' '.repeat(8 * 1024)); request.end(' '.repeat(8 * 1024))
  })
  assert.equal(status, 413)
  assert.equal(f.counters().canvasReads, 0)
})

test('download authorizes storyboard media cells only in declared table columns', async t => {
  const storyboard = (cellType, { declared = true, nodeType = 'storyboardTool' } = {}) => ({ code: 'SUCCESS', data: { data: {
    nodes: [{ type: nodeType, data: { table: {
      columns: [{ field: declared ? 'asset' : 'other', title: '镜头素材', width: 200 }],
      rowsHeight: [200], data: [{ asset: { type: cellType, value: URL } }],
    } } }],
  } } })
  for (const type of ['image', 'video', 'audio']) {
    const f = await fixture(t, { canvas: storyboard(type) })
    const response = await f.post()
    assert.equal(response.status, 200)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([137,80,78,71,0,255]))
  }
  for (const canvas of [storyboard('text'), storyboard('empty'), storyboard(['image']), storyboard('image', { declared: false }),
    storyboard('image', { nodeType: 'image' }), storyboard('image', { nodeType: 'text' })]) {
    const f = await fixture(t, { canvas })
    assert.equal((await f.post()).status, 403)
    assert.equal(f.counters().remoteReads, 0)
    assert.equal(f.counters().lookups, 0)
  }
})
