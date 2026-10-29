import assert from 'node:assert/strict'
import test from 'node:test'
import { snapshotReferenceNodes, parseReferenceUpdate, referenceProducts, MAX_REFERENCE_BYTES } from '../src/shared/canvas-node-references.ts'
import { CanvasNodeReferences, attachCanvasReferenceReceiver } from '../src/client/canvas-node-references.ts'
import { createCanvasReferenceBridge } from '../canvas-app/src/canvas-reference-bridge.ts'

const identity = { canvasId: '2873', viewId: 'view', subscriptionId: 'subscription' }
const node = (id = 'n1', changes = {}) => ({ id, type: 'image', selected: true, position: { x: 23, y: -45 },
  data: { title: id, value: 'https://media.test/first.png', product: [{ value: 'https://media.test/second.png' }], params: { model: 'm', seed: 4 } }, ...changes })
const update = (nodes, reason = 'select', changes = {}) => ({ ...identity, protocolVersion: 1, type: 'canvas.references.changed', revision: 1, reason, nodes, ...changes })

test('reference snapshots retain all serializable node data and detach from the mutable canvas', () => {
  const original = node('n', { parentId: 'group', width: 300, custom: { props: ['extra', true, null] } })
  const snapshot = snapshotReferenceNodes([original])
  assert.deepEqual(snapshot.nodes, [original]); assert.notEqual(snapshot.nodes[0].data, original.data)
  original.position.x = 500; original.data.params.seed = 10
  assert.equal(snapshot.nodes[0].position.x, 23); assert.equal(snapshot.nodes[0].data.params.seed, 4)
  assert.equal(snapshotReferenceNodes([node('n', { callback() {} })]).nodes[0].callback, undefined)
})

test('transport rejects malformed identities, duplicate ids, cyclic data and oversized snapshots', () => {
  assert.ok(parseReferenceUpdate(update([node()]), identity))
  for (const changes of [{ canvasId: '2903' }, { viewId: 'foreign' }, { subscriptionId: 'old' }, { revision: -1 }, { revision: 0.5 }, { reason: 'click' }]) {
    assert.equal(parseReferenceUpdate(update([node()], 'select', changes), identity), undefined)
  }
  for (const nodes of [[node(), node()], [node('', {})], [node('n', { position: { x: NaN, y: 1 } })], [node('n', { data: null })]]) {
    assert.equal(snapshotReferenceNodes(nodes).error, 'unserializable')
  }
  const cyclic = node(); cyclic.data.self = cyclic
  assert.equal(snapshotReferenceNodes([cyclic]).error, 'unserializable')
  assert.equal(snapshotReferenceNodes([node('large', { data: { value: '字'.repeat(MAX_REFERENCE_BYTES / 2) } })]).error, 'too_large')
})

test('explicit selection adds references; live edits refresh and deletions remove without resurrecting dismissed items', () => {
  const refs = new CanvasNodeReferences()
  refs.receive('s', update([node(), node('n2')]))
  const [first] = refs.getSnapshot('s').references
  refs.remove('s', first)
  const changed = node('n2', { data: { title: 'renamed', value: 'https://media.test/new.png' }, position: { x: 99, y: 1 } })
  refs.receive('s', update([node(), changed], 'update'))
  assert.deepEqual(refs.getSnapshot('s').references.map(ref => ref.node), [changed])
  refs.receive('s', update([node(), changed])) // A click on the already-selected nodes is an explicit gesture.
  assert.equal(refs.getSnapshot('s').references.length, 2)
  refs.receive('s', update([changed], 'update'))
  assert.deepEqual(refs.getSnapshot('s').references.map(ref => ref.node.id), ['n2'])
  refs.clear('s'); refs.receive('s', update([changed], 'update'))
  assert.equal(refs.getSnapshot('s').references.length, 0)
  refs.receive('s', update([changed])); assert.equal(refs.getSnapshot('s').references.length, 1)
  refs.receive('s', update([], 'update')); assert.equal(refs.getSnapshot('s').references.length, 0)
})

test('reference drafts are isolated by session and view, and invalid data is surfaced instead of retaining stale references', () => {
  const refs = new CanvasNodeReferences()
  refs.receive('a', update([node()])); refs.receive('b', update([node('b')]))
  refs.receive('a', update([node('other')], 'select', { viewId: 'other-view' }))
  refs.releaseView('a', 'view')
  assert.deepEqual(refs.getSnapshot('a').references.map(ref => ref.node.id), ['other'])
  assert.deepEqual(refs.getSnapshot('b').references.map(ref => ref.node.id), ['b'])
  refs.receive('b', update([], 'update', { error: 'too_large' }))
  assert.equal(refs.getSnapshot('b').references.length, 0); assert.ok(refs.getSnapshot('b').error)
  refs.reset(); assert.equal(refs.getSnapshot('a').references.length, 0)
})

test('preview retains all outputs in order, deduplicates the current output, and excludes unsafe media URLs', () => {
  assert.deepEqual(referenceProducts(node()).map(product => product.value), ['https://media.test/first.png', 'https://media.test/second.png'])
  assert.deepEqual(referenceProducts(node('n', { data: { value: 'https://media.test/a', product: [{ value: 'https://media.test/a' }, { value: 'javascript:alert(1)' }, { value: 'file:///secret' }] } })), [{ kind: 'image', value: 'https://media.test/a' }])
  assert.deepEqual(referenceProducts(node('t', { type: 'text', data: { value: 'hello <world>' } })), [{ kind: 'text', value: 'hello <world>' }])
  assert.deepEqual(referenceProducts(node('empty', { data: {} })), [])
})

const tick = () => new Promise(resolve => setTimeout(resolve, 10))
function channel() {
  const listeners = new Set()
  return { addEventListener: (_type, fn) => listeners.add(fn), removeEventListener: (_type, fn) => listeners.delete(fn),
    emit: event => [...listeners].forEach(fn => fn(event)), listeners }
}
function bridgeFixture(t) {
  const refs = new CanvasNodeReferences(), outer = channel(), inner = channel(), updates = new Set()
  const origin = 'https://shell.test', sent = [], hellos = []
  let nodes = [node()], subscriptions = 0
  const parent = { postMessage(data) { sent.push(data); outer.emit({ origin, source: frame, data }) } }
  const frame = { postMessage(data) { hellos.push(data); inner.emit({ origin, source: parent, data }) } }
  const receiver = (sessionId = 's') => attachCanvasReferenceReceiver({ ...identity, references: refs, sessionId, origin, getFrame: () => frame, receiveTarget: outer })
  const firstReceiver = receiver()
  const publisher = createCanvasReferenceBridge({ ...identity, origin, parent, receiveTarget: inner, getNodes: () => nodes,
    subscribe(listener) { updates.add(listener); subscriptions++; return () => { updates.delete(listener); subscriptions-- } } })
  t.after(() => { firstReceiver.dispose(); publisher.dispose() })
  return { refs, outer, inner, origin, parent, frame, sent, hellos, receiver, firstReceiver, publisher,
    setNodes(value) { nodes = value; updates.forEach(listener => listener()) }, getSubscriptions: () => subscriptions }
}

test('iframe handshake, click, live products, delete and repeated selection round-trip without writing the canvas', async t => {
  const h = bridgeFixture(t)
  await tick(); assert.equal(h.refs.getSnapshot('s').references.length, 0)
  h.publisher.select(); await tick(); assert.equal(h.refs.getSnapshot('s').references.length, 1)
  h.refs.clear('s')
  h.setNodes([node('n1', { position: { x: 30, y: 40 } })]); await tick()
  assert.equal(h.refs.getSnapshot('s').references.length, 0)
  h.publisher.select(); await tick(); assert.equal(h.refs.getSnapshot('s').references[0].node.position.x, 30)
  const changed = node('n1', { data: { title: 'new', value: 'https://media.test/new' } })
  h.setNodes([changed]); await tick(); assert.deepEqual(h.refs.getSnapshot('s').references[0].node, changed)
  h.setNodes([]); await tick(); assert.equal(h.refs.getSnapshot('s').references.length, 0)
  h.publisher.dispose(); assert.equal(h.getSubscriptions(), 0); assert.equal(h.inner.listeners.size, 0)
})

test('dragging publishes no intermediate snapshots and sends the final position and data once', async t => {
  const h = bridgeFixture(t)
  h.publisher.select(); await tick()
  const before = h.sent.length
  for (const x of [30, 60, 90]) {
    h.setNodes([node('n1', { dragging: true, position: { x, y: 40 } })]); await tick()
    assert.equal(h.sent.length, before)
    assert.equal(h.refs.getSnapshot('s').references[0].node.position.x, 23)
  }
  const final = node('n1', { dragging: false, position: { x: 100, y: 40 }, data: { title: 'updated during drag' } })
  h.setNodes([final]); await tick()
  assert.equal(h.sent.length, before + 1)
  assert.deepEqual(h.refs.getSnapshot('s').references[0].node, final)
  assert.equal(h.sent.at(-1).reason, 'update')
  h.setNodes([final]); await tick()
  assert.equal(h.sent.length, before + 1)
})

test('multi-node dragging waits until every node has stopped before publishing the final snapshot', async t => {
  const h = bridgeFixture(t)
  h.setNodes([node('n1'), node('n2')]); h.publisher.select(); await tick()
  const before = h.sent.length
  h.setNodes([node('n1', { dragging: true }), node('n2', { dragging: true })]); await tick()
  h.setNodes([node('n1', { dragging: false, position: { x: 100, y: 40 } }), node('n2', { dragging: true })]); await tick()
  assert.equal(h.sent.length, before)
  const final = [node('n1', { dragging: false, position: { x: 100, y: 40 } }), node('n2', { dragging: false, position: { x: 200, y: 80 } })]
  h.setNodes(final); await tick()
  assert.equal(h.sent.length, before + 1)
  assert.deepEqual(h.refs.getSnapshot('s').references.map(ref => ref.node), final)
})

test('selection during a drag is retained and published when the drag ends', async t => {
  const h = bridgeFixture(t)
  await tick()
  const before = h.sent.length
  h.setNodes([node('n2', { dragging: true })]); h.publisher.select(); await tick()
  assert.equal(h.sent.length, before)
  assert.equal(h.refs.getSnapshot('s').references.length, 0)
  const final = node('n2', { dragging: false, position: { x: 200, y: 80 } })
  h.setNodes([final]); await tick()
  assert.equal(h.sent.length, before + 1)
  assert.equal(h.sent.at(-1).reason, 'select')
  assert.deepEqual(h.refs.getSnapshot('s').references[0].node, final)
})

test('deselecting on canvas retains dock references until the next selection gesture occurs', async t => {
  const h = bridgeFixture(t)
  await tick()
  // 1. Select n1
  h.setNodes([node('n1'), node('n2', { selected: false })]); h.publisher.select(); await tick()
  assert.equal(h.refs.getSnapshot('s').references.length, 1)
  assert.equal(h.refs.getSnapshot('s').references[0].node.id, 'n1')

  // 2. Deselect on canvas (all selected: false)
  h.setNodes([node('n1', { selected: false }), node('n2', { selected: false })]); await tick()
  // Dock still retains n1
  assert.equal(h.refs.getSnapshot('s').references.length, 1)
  assert.equal(h.refs.getSnapshot('s').references[0].node.id, 'n1')

  // 3. Live update while unselected
  const updatedN1 = node('n1', { selected: false, data: { title: 'updated-title', value: 'https://media.test/live.png' } })
  h.setNodes([updatedN1, node('n2', { selected: false })]); await tick()
  assert.equal(h.refs.getSnapshot('s').references[0].node.data.title, 'updated-title')

  // 4. Next selection occurs: user selects n2
  h.setNodes([updatedN1, node('n2', { selected: true })]); await tick()
  assert.equal(h.refs.getSnapshot('s').references.length, 1)
  assert.equal(h.refs.getSnapshot('s').references[0].node.id, 'n2')

  // 5. Deselect n2, then delete n2 from canvas
  h.setNodes([updatedN1, node('n2', { selected: false })]); await tick()
  assert.equal(h.refs.getSnapshot('s').references.length, 1)
  h.setNodes([updatedN1]); await tick()
  assert.equal(h.refs.getSnapshot('s').references.length, 0)
})

test('receiver rejects foreign frames/origins, stale revisions and events from the previous session subscription', async t => {
  const h = bridgeFixture(t)
  h.publisher.select(); await tick()
  const message = h.sent.findLast(value => value.type === 'canvas.references.changed')
  for (const changes of [{ origin: 'https://foreign.test', source: h.frame }, { origin: h.origin, source: {} }]) {
    h.outer.emit({ ...changes, data: { ...message, revision: 999, nodes: [node('forged')] } })
  }
  h.outer.emit({ origin: h.origin, source: h.frame, data: { ...message, nodes: [node('stale')] } })
  assert.equal(h.refs.getSnapshot('s').references[0].node.id, 'n1')
  h.firstReceiver.dispose()
  const second = h.receiver('next'); t.after(second.dispose)
  h.outer.emit({ origin: h.origin, source: h.frame, data: { ...message, revision: 1000 } })
  await tick(); assert.equal(h.refs.getSnapshot('s').references.length, 0); assert.equal(h.refs.getSnapshot('next').references.length, 0)
  h.publisher.select(); await tick(); assert.equal(h.refs.getSnapshot('next').references.length, 1)
  second.dispose(); assert.equal(h.refs.getSnapshot('next').references.length, 0)
})
