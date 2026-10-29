import assert from 'node:assert/strict'
import test from 'node:test'
import { canvasNavigationNodeId, parseCanvasViewMessage } from '../src/shared/canvas-view-navigation.ts'
import { createCanvasViewNavigation } from '../src/client/canvas-view-navigation.ts'

const identity = { canvasId: '103161', viewId: 'view-a' }
const base = { protocolVersion: 1, ...identity }
const origin = 'http://localhost:3000'
function harness(t, frameAvailable = true) {
  const sent = [], results = [], listeners = new Set()
  const frame = { postMessage: (message, targetOrigin) => sent.push({ message, targetOrigin }) }
  const controller = createCanvasViewNavigation({ identity, origin, getFrame: () => frameAvailable ? frame : undefined,
    receiveTarget: { addEventListener: (_name, cb) => listeners.add(cb), removeEventListener: (_name, cb) => listeners.delete(cb) }, onResult: status => results.push(status) })
  t.after(() => controller.dispose())
  return { controller, sent, results, listeners, frame, receive: (message, overrides = {}) => {
    for (const listener of listeners) listener({ data: message, origin, source: frame, ...overrides })
  } }
}
const ready = channelId => ({ ...base, type: 'canvas.view.ready', channelId })
const result = (request, status = 'focused') => ({ ...request, type: 'canvas.view.focus.result', status })

test('navigation parser keeps canonical identity and bounds node, request and revision fields', () => {
  assert.equal(canvasNavigationNodeId({ nodeId: 'n1' }), 'n1')
  assert.equal(canvasNavigationNodeId({ nodeId: 'x'.repeat(101) }), undefined)
  const focus = { ...base, type: 'canvas.view.focus', channelId: 'channel', requestId: 'request', revision: 1, nodeId: 'n1' }
  assert.deepEqual(parseCanvasViewMessage(focus, identity), focus)
  assert.deepEqual(parseCanvasViewMessage({ ...focus, selectNode: true }, identity), { ...focus, selectNode: true })
  assert.equal(parseCanvasViewMessage({ ...focus, selectNode: 'true' }, identity), undefined)
  for (const changed of [{ canvasId: '103162' }, { viewId: 'view-b' }, { channelId: '' }, { revision: -1 }, { revision: 1.5 }, { requestId: '' }, { nodeId: [] }, { protocolVersion: 2 }]) {
    assert.equal(parseCanvasViewMessage({ ...focus, ...changed }, identity), undefined)
  }
})

test('dock selection intent survives readiness and reload without changing ordinary result navigation', t => {
  const h = harness(t)
  h.controller.navigate(1, 'n1', true); h.receive(ready('channel-1'))
  assert.equal(h.sent.at(-1).message.selectNode, true)
  h.receive(result(h.sent.at(-1).message)); h.receive(ready('channel-2'))
  assert.equal(h.sent.at(-1).message.selectNode, true)
  h.controller.navigate(2, 'n2')
  assert.equal(h.sent.at(-1).message.selectNode, undefined)
})

test('before iframe readiness only latest click is queued; duplicate handshake does not resend', t => {
  const h = harness(t)
  h.controller.navigate(1, 'n1'); h.controller.navigate(2, 'n2')
  assert.ok(h.sent.every(item => item.message.type === 'canvas.view.hello'))
  h.receive(ready('channel'))
  assert.equal(h.sent.at(-1).message.nodeId, 'n2')
  assert.equal(h.sent.at(-1).targetOrigin, origin)
  const count = h.sent.length; h.receive(ready('channel')); assert.equal(h.sent.length, count)
  h.receive(result(h.sent.at(-1).message)); assert.deepEqual(h.results, ['focused'])
  h.controller.navigate(1, 'old'); assert.equal(h.sent.length, count)
})

test('foreign origin/frame/canvas and stale result cannot acknowledge current click', t => {
  const h = harness(t); h.controller.navigate(1, 'n1')
  h.receive(ready('channel'), { origin: 'http://foreign.test' }); h.receive(ready('channel'), { source: {} })
  h.receive({ ...ready('channel'), canvasId: '103162' })
  assert.equal(h.sent.at(-1).message.type, 'canvas.view.hello')
  h.receive(ready('channel')); const old = h.sent.at(-1).message
  h.controller.navigate(2, 'n2'); const latest = h.sent.at(-1).message
  h.receive(result(old)); h.receive(result({ ...latest, channelId: 'old-channel' })); assert.deepEqual(h.results, [])
  h.receive(result(latest, 'node_missing')); assert.deepEqual(h.results, ['node_missing'])
})

test('iframe reload replays desired node with fresh request and rejects previous channel ACK', t => {
  const h = harness(t); h.controller.navigate(1, 'n1'); h.receive(ready('channel-1'))
  const old = h.sent.at(-1).message; h.receive(result(old)); h.controller.frameLoaded()
  h.receive(ready('channel-2')); const fresh = h.sent.at(-1).message
  assert.equal(fresh.nodeId, 'n1'); assert.notEqual(fresh.requestId, old.requestId)
  h.receive(result(old)); assert.deepEqual(h.results, ['focused'])
  h.receive(result(fresh)); assert.deepEqual(h.results, ['focused', 'focused'])
})

test('plain opening is silent without iframe; disposal cleans pending delivery', t => {
  const h = harness(t, false); h.controller.navigate(0)
  assert.equal(h.sent.length, 0); assert.deepEqual(h.results, [])
  h.controller.navigate(1, 'n1'); h.controller.dispose(); assert.equal(h.listeners.size, 0)
  h.receive(ready('channel')); assert.equal(h.sent.length, 0)
})

test('initial iframe onLoad after ready keeps the successful focus and does not start it again', t => {
  const h = harness(t); h.controller.navigate(1, 'n1'); h.receive(ready('channel'))
  h.receive(result(h.sent.at(-1).message)); const before = h.sent.filter(item => item.message.type === 'canvas.view.focus').length
  h.controller.frameLoaded(); h.receive(ready('channel'))
  assert.equal(h.sent.filter(item => item.message.type === 'canvas.view.focus').length, before)
})

test('view delivery retries are bounded and timeout cannot send another command after disposal', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness(t); h.controller.navigate(1, 'n1')
  t.mock.timers.tick(4000); t.mock.timers.tick(4000)
  assert.equal(h.sent.length, 3)
  t.mock.timers.tick(22000)
  assert.deepEqual(h.results, ['view_unavailable'])
  const count = h.sent.length; h.controller.dispose(); t.mock.timers.tick(30000)
  assert.equal(h.sent.length, count); assert.equal(h.listeners.size, 0)
})

test('opening a canvas without node cancels old focus and stays silent even if its view ACK is lost', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness(t); h.controller.navigate(1, 'n1'); h.receive(ready('channel'))
  const old = h.sent.at(-1).message
  h.controller.navigate(2)
  assert.equal(h.sent.at(-1).message.nodeId, undefined)
  h.receive(result(old)); t.mock.timers.tick(30000)
  assert.deepEqual(h.results, [])
})
