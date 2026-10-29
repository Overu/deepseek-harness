import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import { canvasResultHandler } from '../src/host/canvas-result-route.ts'
import { parseCanvasResultSource } from '../src/shared/canvas-result-source.ts'

const source = parseCanvasResultSource({ schemaVersion: 1, sessionId: 'session-1', ownerId: 'owner-1', rootCallId: 'root-1', callId: 'child-1', turn: 2, rootCallSeq: 7,
  sessionCreatedAt: 10, requestId: 'run:run', canvasId: '103161', nodeId: 'node-1', workflowTaskId: 'workflow-1', nodeTaskId: 'task-1',
  phase: 'completed', version: '12', generation: { images: 1, videos: 0 }, outputs: ['https://assets.example/actual.png'], createdAt: 100 })

function fixture() {
  const records = [source], listeners = new Set()
  const f = { rejects: undefined, queries: 0, disposals: 0, birth: 10, roots: [{ type: 'tool/call', seq: 7, data: { callId: 'root-1', turn: 2 } }],
    connection: { requestRejection() { return f.rejects } },
    reader: { async observeSession(id, options) {
      f.queries++; assert.equal(options.projectionMode, 'none')
      if (id !== 'session-1') throw Object.assign(new Error('absent'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
      return { header: { id, createdAt: f.birth }, events: f.roots, [Symbol.dispose]() { f.disposals++ } }
    } },
    store: { async list(sessionId, { visible, after } = {}) {
      if (after === 'invalid') throw new Error('cursor rejected')
      return { type: 'snapshot', sources: records.filter(item => item.sessionId === sessionId && visible(item)) }
    }, subscribe(sessionId, listener) { listeners.add(listener); return () => listeners.delete(listener) } },
    push(item) { records.push(item); listeners.forEach(listener => listener(item)) }, get listeners() { return listeners.size } }
  f.handler = canvasResultHandler(f.connection, f.store, f.reader)
  return f
}
function response() {
  const res = new EventEmitter()
  Object.assign(res, { status: undefined, body: undefined, headersSent: false, destroyed: false, writableLength: 0,
    writeHead(status) { this.status = status; this.headersSent = true }, end(body) { this.body = body },
    write() { return true }, destroy() { this.destroyed = true; this.emit('close') } })
  return res
}
async function request(f, url, method = 'GET') {
  const res = response()
  await f.handler({ method, url, headers: {} }, res)
  return res
}

test('result routes authenticate first, permit reads only and reject malformed or out-of-session scopes', async () => {
  const f = fixture()
  f.rejects = 401
  assert.equal((await request(f, '/desktop-canvas/api/results?s=session-1')).status, 401)
  assert.equal(f.queries, 0)
  f.rejects = undefined
  for (const [url, method, status] of [
    ['/desktop-canvas/api/results?s=session-1', 'POST', 405], ['/desktop-canvas/api/results', 'GET', 400],
    ['/desktop-canvas/api/results?s=session-1&s=session-2', 'GET', 400], ['/desktop-canvas/api/results?s=missing', 'GET', 404],
    ['/desktop-canvas/api/results?s=session-1&calls=%5B%22foreign-root%22%5D', 'GET', 403],
    ['/desktop-canvas/api/results/extra?s=session-1', 'GET', 404], ['/desktop-canvas/api/results/events?s=session-1&after=abc', 'GET', 400],
  ]) assert.equal((await request(f, url, method)).status, status)
  f.handler.close()
})

test('snapshot checks actual original header and exact root seq/turn, never shows recreated or truncated history', async () => {
  const f = fixture()
  const good = await request(f, '/desktop-canvas/api/results?s=session-1')
  assert.equal(good.status, 200)
  assert.deepEqual(JSON.parse(good.body), { type: 'snapshot', sources: [source] })
  assert.equal(f.disposals, 1)
  for (const item of [{ ...source, requestId: 'wrong-turn', turn: 3 }, { ...source, requestId: 'wrong-seq', rootCallSeq: 8 },
    { ...source, requestId: 'fork', sessionId: 'fork-session' }, { ...source, requestId: 'different-life', sessionCreatedAt: 11 }]) f.push(item)
  assert.equal(JSON.parse((await request(f, '/desktop-canvas/api/results?s=session-1')).body).sources.length, 1)
  f.birth = 11
  assert.equal(JSON.parse((await request(f, '/desktop-canvas/api/results?s=session-1')).body).sources.length, 1)
  f.roots = []
  assert.equal(JSON.parse((await request(f, '/desktop-canvas/api/results?s=session-1')).body).sources.length, 0)
  f.handler.close()
})

test('SSE emits durable snapshot then scoped updates, cleans up abort/unmount and reconnects from snapshot', async () => {
  const f = fixture(), server = createServer((req, res) => { void f.handler(req, res) })
  server.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const address = `http://127.0.0.1:${server.address().port}/desktop-canvas/api/results/events?s=session-1`
  const abort = new AbortController()
  const res = await fetch(address, { signal: abort.signal }), reader = res.body.getReader()
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/event-stream/)
  const initial = new TextDecoder().decode((await reader.read()).value)
  assert.deepEqual(JSON.parse(initial.match(/data: (.*)\n/)[1]), { type: 'snapshot', sources: [source] })
  f.push({ ...source, requestId: 'new-run', nodeId: 'node-2' })
  const update = new TextDecoder().decode((await reader.read()).value)
  assert.equal(JSON.parse(update.match(/data: (.*)\n/)[1]).source.requestId, 'new-run')
  f.roots = [{ type: 'tool/call', seq: 20, data: { callId: 'new-root', turn: 3 } }]
  f.push({ ...source, requestId: 'truncated-root' })
  const newTurn = { ...source, requestId: 'new-turn', rootCallId: 'new-root', rootCallSeq: 20, turn: 3 }
  f.push(newTurn)
  const later = new TextDecoder().decode((await reader.read()).value)
  assert.deepEqual(JSON.parse(later.match(/data: (.*)\n/)[1]), { type: 'upsert', source: newTurn })
  abort.abort(); await reader.cancel().catch(() => {})
  const secondAbort = new AbortController(), second = await fetch(address, { signal: secondAbort.signal }), secondReader = second.body.getReader()
  const snapshot = new TextDecoder().decode((await secondReader.read()).value)
  assert.deepEqual(JSON.parse(snapshot.match(/data: (.*)\n/)[1]).sources, [newTurn])
  f.handler.close()
  await secondReader.cancel().catch(() => {}); secondAbort.abort()
  assert.equal(f.listeners, 0)
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
})

test('slow SSE has bounded backlog and a disconnected consumer cannot retain listeners', async () => {
  const f = fixture(), res = response()
  res.write = () => false
  await f.handler({ method: 'GET', url: '/desktop-canvas/api/results/events?s=session-1', headers: {} }, res)
  assert.equal(f.listeners, 1)
  for (let index = 0; index < 140 && !res.destroyed; index++) f.push({ ...source, requestId: 'run-' + index })
  assert.equal(res.destroyed, true)
  assert.equal(f.listeners, 0)
  f.handler.close()
})

test('service close prevents late streams and snapshot storage failure cannot invoke any business mutation', async () => {
  const f = fixture()
  f.store.list = async () => { throw new Error('disk unavailable') }
  assert.equal((await request(f, '/desktop-canvas/api/results?s=session-1')).status, 503)
  f.handler.close()
  assert.equal((await request(f, '/desktop-canvas/api/results/events?s=session-1')).status, 503)
  assert.equal(f.listeners, 0)
})


test('shutdown during history authorization returns unavailable and releases its observation', async () => {
  const f = fixture()
  let release
  const original = f.reader.observeSession
  f.reader.observeSession = async (...args) => { await new Promise(resolve => { release = resolve }); return original(...args) }
  const res = response()
  const opening = f.handler({ method: 'GET', url: '/desktop-canvas/api/results/events?s=session-1', headers: {} }, res)
  f.handler.close(); release(); await opening
  assert.equal(res.status, 503)
  assert.equal(f.disposals, 1)
  assert.equal(f.listeners, 0)
})
