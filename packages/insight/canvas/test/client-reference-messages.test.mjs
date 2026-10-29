import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvasClientBridge } from '../src/client/canvas-bridge.ts'
import { parseServiceClientEvent, parseServiceHostEvent } from '../src/shared/canvas-bridge-protocol.ts'

const refs = id => [{ canvasId: '1001', nodeId: id, title: id, data: { params: { model: 'flux' } }, products: [] }]
const waitUntil = async check => {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)) }
  assert.fail('reference bridge did not settle')
}
function setup(t) {
  const posts = [], registration = { protocolVersion: 4, clientId: 'client', connectionId: 'connection', bridgeKey: 'x'.repeat(43) }
  let stream
  const push = event => stream.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ protocolVersion: 4, connectionId: 'connection', ...event }) + '\n\n'))
  const transport = async (input, init) => {
    const path = new URL(input).pathname
    if (path.endsWith('/attach')) return Response.json(registration)
    if (path.endsWith('/events')) {
      const body = new ReadableStream({ start(controller) {
        stream = controller
        init.signal.addEventListener('abort', () => controller.error(new Error('disposed')), { once: true })
        push({ type: 'bridge.connected' })
      } })
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    }
    if (path.endsWith('/client-event')) posts.push(parseServiceClientEvent(JSON.parse(init.body)))
    return Response.json({})
  }
  const bridge = createCanvasClientBridge({ origin: 'https://shell.test', getRuntime: async () => { throw new Error('not needed') }, transport })
  t.after(() => bridge.dispose())
  return { bridge, posts, push }
}

test('late consumption acknowledgements cannot clear newer Dock refs; matching ack clears only its session', async t => {
  const h = setup(t), consumed = []
  h.bridge.onReferencesConsumed(sessionId => { consumed.push(sessionId); h.bridge.syncReferences(sessionId, []) })
  h.bridge.retainSession('s1'); h.bridge.retainSession('s2')
  h.bridge.syncReferences('s1', refs('old')); h.bridge.syncReferences('s2', refs('other'))
  await waitUntil(() => h.posts.some(e => e.type === 'canvas.references.sync' && e.sessionId === 's1'))
  h.bridge.syncReferences('s1', refs('new'))
  await waitUntil(() => h.posts.some(e => e.type === 'canvas.references.sync' && e.sessionId === 's1' && e.revision === 2))
  h.push({ type: 'canvas.references.consumed', sessionId: 's1', revision: 1, messageId: 'old-message' })
  await new Promise(resolve => setTimeout(resolve, 10)); assert.deepEqual(consumed, [])
  h.push({ type: 'canvas.references.consumed', sessionId: 's1', revision: 2, messageId: 'new-message' })
  await waitUntil(() => consumed.length === 1)
  assert.deepEqual(consumed, ['s1'])
  await waitUntil(() => h.posts.some(e => e.type === 'canvas.references.sync' && e.sessionId === 's1' && e.revision === 3 && !e.references.length))
  h.push({ type: 'canvas.references.consumed', sessionId: 's1', revision: 2, messageId: 'new-message' })
  await new Promise(resolve => setTimeout(resolve, 10)); assert.deepEqual(consumed, ['s1'])
  assert.equal(h.posts.filter(e => e.type === 'canvas.references.sync' && e.sessionId === 's2').at(-1).references[0].nodeId, 'other')
})

test('identical snapshots do not advance revision and unbound refs synchronize when their session is retained', async t => {
  const h = setup(t)
  h.bridge.retainSession('active')
  h.bridge.syncReferences('later', refs('saved'))
  await waitUntil(() => h.posts.some(e => e.type === 'session.sync'))
  assert.equal(h.posts.some(e => e.type === 'canvas.references.sync'), false)
  h.bridge.retainSession('later')
  await waitUntil(() => h.posts.some(e => e.type === 'canvas.references.sync' && e.sessionId === 'later'))
  h.bridge.syncReferences('later', refs('saved'))
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(h.posts.filter(e => e.type === 'canvas.references.sync').map(e => e.revision), [1])
})

test('reference protocol requires a valid revision and message identity on consumption', () => {
  const base = { protocolVersion: 4, connectionId: 'connection', sessionId: 's1' }
  const sync = { ...base, type: 'canvas.references.sync', revision: 1, references: refs('n1') }
  const consumed = { ...base, type: 'canvas.references.consumed', revision: 1, messageId: 'm1' }
  assert.deepEqual(parseServiceClientEvent(sync), sync); assert.deepEqual(parseServiceHostEvent(consumed), consumed)
  for (const revision of [undefined, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseServiceClientEvent({ ...sync, revision }))
    assert.throws(() => parseServiceHostEvent({ ...consumed, revision }))
  }
  assert.throws(() => parseServiceHostEvent({ ...consumed, messageId: '' }))
})
