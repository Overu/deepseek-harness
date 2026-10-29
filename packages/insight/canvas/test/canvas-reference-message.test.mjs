import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvasHostBridge } from '../src/host/canvas-bridge.ts'
import { registerCanvasReferenceMessages } from '../src/host/canvas-reference-message.ts'
import { serializeNodeRefs, parseNodeRefs, splitNodeRefs, toReferenceItems, MAX_REFERENCE_BYTES } from '../src/shared/canvas-node-references.ts'

const node = (id = 'n1', title = 'Image Generator') => ({ id, type: 'image', position: { x: 12, y: 34 },
  data: { title, params: { model: 'flux', width: 1024 }, value: 'https://media.test/image.png' }, custom: { retained: true } })
const items = (id, title) => toReferenceItems([{ canvasId: '1001', node: node(id, title) }])
const message = (id = 'm1', source = { kind: 'user' }) => ({ id, role: 'user', source,
  content: [{ type: 'text', text: '帮我修改这个节点' }, { type: 'image', image: { url: 'https://media.test/attachment.png' } }] })
function setup(t) {
  const bridge = createCanvasHostBridge(), handlers = new Map(), disposers = [], events = []
  const ctx = { effect(fn) { const dispose = fn(); disposers.push(dispose); return dispose }, on(name, handler) { handlers.set(name, handler) } }
  registerCanvasReferenceMessages(ctx, bridge)
  const registration = bridge.attachClient('https://shell.test', 'client', 'web-locks-v1')
  const send = event => bridge.acceptClientEvent(registration.bridgeKey, 'https://shell.test', { protocolVersion: 4, connectionId: registration.connectionId, ...event })
  send({ type: 'session.sync', revision: 1, sessionIds: ['s1', 's2'] })
  const disconnect = bridge.connectStream(registration.bridgeKey, 'https://shell.test', event => events.push(event))
  t.after(() => { for (const dispose of disposers) dispose?.(); bridge.dispose() })
  return { bridge, events, registration, send, disconnect,
    sync(references = items(), revision = 1, sessionId = 's1') { send({ type: 'canvas.references.sync', sessionId, revision, references }) },
    enter(messages = [message()], sessionId = 's1', decision, signal = new AbortController().signal) {
      return handlers.get('agent/pre-step')({ agent: { session: { id: sessionId } }, signal }, async () => decision ?? { kind: 'enter', messages, startsRequestSeries: true })
    },
    emit(type, data, sessionId = 's1') { handlers.get('session/event')({ id: sessionId }, { type, data }) },
  }
}

test('node-refs round trip preserves complete node JSON and escapes closing tags inside node strings', () => {
  const refs = items('n1', '</node-refs><script>&')
  const text = serializeNodeRefs(refs)
  assert.equal(text.match(/<\/node-refs>/g).length, 1)
  assert.deepEqual(parseNodeRefs(text), { version: 1, nodes: refs })
  assert.equal(parseNodeRefs(text).nodes[0].node.position.x, 12)
  assert.equal(parseNodeRefs(text).nodes[0].data.params.model, 'flux')
  assert.throws(() => serializeNodeRefs(items('n1', 'x'.repeat(MAX_REFERENCE_BYTES))), /过大/)
})

test('renderer splitting preserves body, attachment identity, malformed text and future protocol versions', () => {
  const original = message().content
  const text = serializeNodeRefs(items())
  const invalid = [{ type: 'text', text: text.replace('version="1"', 'version="2"') }, { type: 'text', text: '<node-refs version="1">\ninvalid\n</node-refs>' },
    { type: 'text', text: '请解释这个示例：' + text }]
  const result = splitNodeRefs([...original, ...invalid, { type: 'text', text }])
  assert.deepEqual(result.content, [...original, ...invalid])
  assert.equal(result.content[1], original[1])
  assert.deepEqual(result.nodes, items())
  assert.equal(splitNodeRefs(original).content, original)
  for (const payload of [{ version: 2, nodes: items() }, { version: 1, nodes: [{ ...items()[0], data: null }] },
    { version: 1, nodes: [{ ...items()[0], node: null }] }, { version: 1, nodes: [] }]) {
    assert.equal(parseNodeRefs(`<node-refs version="1">\n${JSON.stringify(payload)}\n</node-refs>`), undefined)
  }
})

test('pre-step appends refs to the same user message; only its durable event consumes the Dock snapshot', async t => {
  const h = setup(t); h.sync()
  const input = message(), decision = await h.enter([input])
  assert.equal(decision.startsRequestSeries, true)
  assert.equal(decision.messages.length, 1)
  const admitted = decision.messages[0]
  assert.equal(admitted.id, input.id); assert.equal(admitted.source, input.source)
  assert.equal(admitted.content[1], input.content[1]); assert.equal(input.content.length, 2)
  assert.deepEqual(parseNodeRefs(admitted.content.at(-1).text).nodes, items())
  h.emit('turn/start', { turn: 1 })
  h.emit('user/message', message('unrelated'))
  assert.ok(h.bridge.getPendingReferences('s1'))
  assert.equal(h.events.filter(e => e.type === 'canvas.references.consumed').length, 0)
  h.emit('user/message', admitted)
  assert.equal(h.bridge.getPendingReferences('s1'), undefined)
  const consumed = h.events.find(e => e.type === 'canvas.references.consumed')
  assert.equal(consumed.messageId, input.id); assert.equal(consumed.revision, 1)
  // History remains self-contained after the bridge releases its pending state.
  h.emit('turn/end', { turn: 1 })
  assert.equal(splitNodeRefs(admitted.content).nodes[0].title, 'Image Generator')
  assert.equal((await h.enter([message('m2')])).messages[0].content.length, 2)
})

test('rejected, cancelled, empty and non-human steps never consume or inject references', async t => {
  const h = setup(t); h.sync()
  assert.deepEqual(await h.enter([], 's1', { kind: 'reject' }), { kind: 'reject' })
  assert.equal((await h.enter([])).messages.length, 0)
  assert.equal((await h.enter([message('context', { kind: 'notice' })])).messages[0].content.length, 2)
  const aborted = AbortSignal.abort(); assert.equal((await h.enter([message()], 's1', undefined, aborted)).messages[0].content.length, 2)
  h.emit('turn/end', { turn: 1 }); assert.ok(h.bridge.getPendingReferences('s1'))
  assert.equal((await h.enter([message()], 's2')).messages[0].content.length, 2)
})

test('admission retry is idempotent, preserves its snapshot, and an older commit cannot consume newer references', async t => {
  const h = setup(t); h.sync()
  const first = await h.enter()
  h.sync(items('n2', 'New selection'), 2)
  assert.deepEqual(await h.enter(), first)
  assert.deepEqual(await h.enter(first.messages), first)
  h.emit('user/message', first.messages[0])
  assert.equal(h.bridge.getPendingReferences('s1').items[0].nodeId, 'n2')
  assert.equal(h.events.filter(e => e.type === 'canvas.references.consumed').length, 0)
  const second = await h.enter([message('m2')]); h.emit('user/message', second.messages[0])
  assert.equal(h.bridge.getPendingReferences('s1'), undefined)
  assert.equal(h.events.at(-1).messageId, 'm2')
})

test('steering batch binds refs once to the human message and preserves other plugin messages', async t => {
  const h = setup(t); h.sync()
  const context = message('ctx', { kind: 'notice' }), human = message('steer'), another = message('later')
  const result = await h.enter([context, human, another])
  assert.equal(result.messages[0], context); assert.equal(result.messages[2], another)
  assert.equal(splitNodeRefs(result.messages[1].content).nodes.length, 1)
  h.emit('user/message', result.messages[1]); assert.equal(h.events.at(-1).messageId, 'steer')
})

test('reference bridge rejects unbound sessions and stale/reused revisions, and replays consumption after reconnect', t => {
  const h = setup(t); h.sync()
  h.sync(items('stale'), 0)
  assert.equal(h.bridge.getPendingReferences('s1').items[0].nodeId, 'n1')
  assert.throws(() => h.sync(items('different'), 1), { code: 'DUPLICATE_REQUEST_MISMATCH' })
  assert.throws(() => h.sync(items(), 1, 'foreign'), { code: 'CONTEXT_GONE' })
  h.bridge.consumeReferences('s1', 1, 'm1', h.registration.connectionId)
  h.sync(items(), 1)
  assert.equal(h.bridge.getPendingReferences('s1'), undefined)
  assert.equal(h.events.filter(e => e.type === 'canvas.references.consumed').length, 2)
  h.sync([], 2); h.sync(items('stale'), 1)
  assert.equal(h.bridge.getPendingReferences('s1'), undefined)
})

test('a staged message from an old Client cannot consume a replacement Client snapshot at the same revision', async t => {
  const h = setup(t); h.sync()
  const decision = await h.enter()
  h.send({ type: 'session.sync', revision: 2, sessionIds: [] })
  const replacement = h.bridge.attachClient('https://shell.test', 'replacement', 'web-locks-v1')
  const send = event => h.bridge.acceptClientEvent(replacement.bridgeKey, 'https://shell.test', { protocolVersion: 4, connectionId: replacement.connectionId, ...event })
  send({ type: 'session.sync', revision: 1, sessionIds: ['s1'] })
  send({ type: 'canvas.references.sync', sessionId: 's1', revision: 1, references: items('replacement') })
  h.emit('user/message', decision.messages[0])
  assert.equal(h.bridge.getPendingReferences('s1').items[0].nodeId, 'replacement')
})

test('a disconnected reference owner can be replaced, while connected owners remain protected', t => {
  const h = setup(t); h.sync()
  const replacement = h.bridge.attachClient('https://shell.test', 'replacement')
  const send = event => h.bridge.acceptClientEvent(replacement.bridgeKey, 'https://shell.test', { protocolVersion: 4, connectionId: replacement.connectionId, ...event })
  send({ type: 'session.sync', revision: 1, sessionIds: ['s1'] })
  h.bridge.connectStream(replacement.bridgeKey, 'https://shell.test', () => {})
  const sync = () => send({ type: 'canvas.references.sync', sessionId: 's1', revision: 1, references: items('replacement') })
  assert.throws(sync, { code: 'CLIENT_AMBIGUOUS' })

  h.disconnect()
  sync()
  assert.equal(h.bridge.getPendingReferences('s1').items[0].nodeId, 'replacement')
  // A late receipt from the disconnected owner cannot consume the replacement snapshot.
  h.bridge.consumeReferences('s1', 1, 'old-message', h.registration.connectionId)
  assert.equal(h.bridge.getPendingReferences('s1').items[0].nodeId, 'replacement')

  h.bridge.connectStream(h.registration.bridgeKey, 'https://shell.test', () => {})
  assert.throws(() => h.sync(items('old-client'), 2), { code: 'CLIENT_AMBIGUOUS' })
  assert.equal(h.bridge.getPendingReferences('s1').items[0].nodeId, 'replacement')
})

test('admission retry retains the frozen snapshot even when the Dock is cleared before commit', async t => {
  const h = setup(t); h.sync()
  const first = await h.enter()
  h.sync([], 2)
  assert.deepEqual(await h.enter(), first)
  h.emit('user/message', first.messages[0])
  assert.equal(h.bridge.getPendingReferences('s1'), undefined)
  assert.equal(h.events.filter(e => e.type === 'canvas.references.consumed').length, 0)
})
