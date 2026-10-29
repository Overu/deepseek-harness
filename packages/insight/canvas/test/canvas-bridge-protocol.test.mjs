import assert from 'node:assert/strict'
import test from 'node:test'
import { parseServiceHostEvent, parseServiceClientEvent, bridgeFingerprint } from '../src/shared/canvas-bridge-protocol.ts'
const base = { protocolVersion: 4, connectionId: 'connection', sessionId: 'session', canvasId: '9007199254740993', requestId: 'call', deadline: Date.now() + 30000 }
const command = { ...base, type: 'canvas.command', contextId: 'context', payload: { action: 'node.add', expectedVersion: '18', node: { type: 'text', changes: { text: 'hello' } } } }
test('service protocol preserves IDs, rejects legacy frame fields and accepts explicit single-node generation', () => {
  assert.equal(parseServiceHostEvent(command).canvasId, base.canvasId)
  for (const input of [{ ...command, protocolVersion: 2 }, { ...command, frameId: 'frame' }, { ...command, contextId: undefined }, { ...command, protocolVersion: 3 }]) assert.throws(() => parseServiceHostEvent(input))
  assert.equal(parseServiceHostEvent({ ...base, type: 'canvas.prepare', capability: 'run' }).capability, 'run')
})
test('client receipts require matching canvas, strict fields and versioned session snapshots', () => {
  const { deadline, ...target } = base
  const ack = { ...target, contextId: 'context', type: 'canvas.command.ack', phase: 'settled', result: { status: 'saved', canvasId: base.canvasId, version: '19', affectedNodeIds: ['n'], unchanged: false } }
  assert.equal(parseServiceClientEvent(ack).result.version, '19')
  assert.throws(() => parseServiceClientEvent({ ...ack, result: { ...ack.result, canvasId: '2873' } }))
  assert.throws(() => parseServiceClientEvent({ type: 'session.sync', protocolVersion: 4, connectionId: 'connection', revision: 0, sessionIds: ['s', 's'] }))
  assert.throws(() => parseServiceClientEvent({ ...ack, result: { ...ack.result, token: 'forbidden' } }))
})
test('fingerprints normalize key order and parsers own their input snapshot', () => {
  assert.equal(bridgeFingerprint({ a: 1, b: { c: 2 } }), bridgeFingerprint({ b: { c: 2 }, a: 1 }))
  const parsed = parseServiceHostEvent(command)
  command.payload.node.changes.text = 'later'
  assert.equal(parsed.payload.node.changes.text, 'hello')
})


test('asset.add retains ownership of nested asset fields and single-node generation is explicit', () => {
  const payload = { action: 'asset.add', expectedVersion: '18', asset: { url: 'https://assets.example/image.png', title: '参考图', position: { x: 5, y: -10 } } }
  const parsed = parseServiceHostEvent({ ...command, payload })
  assert.deepEqual(parsed.payload, payload)
  payload.asset.title = 'changed'; payload.asset.position.x = 99
  assert.equal(parsed.payload.asset.title, '参考图'); assert.equal(parsed.payload.asset.position.x, 5)
  for (const operation of [
    { action: 'canvas.read' },
    { action: 'node.add', expectedVersion: '18', node: { type: 'image' } },
    { action: 'node.run', expectedVersion: '18', nodeId: 'n', approvedGeneration: { images: 1, videos: 0 } },
  ]) assert.equal(parseServiceHostEvent({ ...command, payload: operation }).payload.action, operation.action)
  for (const operation of [
    { action: 'template.run', templateId: 'template' },
  ]) assert.throws(() => parseServiceHostEvent({ ...command, payload: operation }), { code: 'INVALID_ARGUMENT' })
})

test('service bridge rejects unsafe asset URLs and extra envelope or asset fields', () => {
  const payload = { action: 'asset.add', expectedVersion: '18', asset: { url: 'https://assets.example/image.png' } }
  for (const input of [
    { ...command, payload, nodeId: 'forged' },
    { ...command, payload: { ...payload, sessionId: 'other' } },
    { ...command, payload: { ...payload, asset: { ...payload.asset, path: '/tmp/local.png' } } },
    { ...command, payload: { ...payload, asset: { url: 'http://assets.example/image.png' } } },
    { ...command, payload: { ...payload, asset: { url: 'https://user:secret@assets.example/image.png' } } },
    { ...command, payload: { ...payload, asset: { url: 'https://assets.example/image.png#fragment' } } },
  ]) assert.throws(() => parseServiceHostEvent(input), { code: 'INVALID_ARGUMENT' })
})

test('v4 task states bind request/canvas and permit distinct workflow and node task IDs', () => {
  const { deadline, ...route } = base
  const state = { requestId: route.requestId, canvasId: route.canvasId, nodeId: 'image', sequence: 1, phase: 'completed', version: '20', workflowTaskId: 'workflow', nodeTaskId: 'node-task', generation: { images: 1, videos: 0 }, outputs: ['https://assets.example/new.png'] }
  const event = { ...route, type: 'canvas.run.state', contextId: 'context', state }
  assert.deepEqual(parseServiceClientEvent(event).state, state)
  assert.throws(() => parseServiceClientEvent({ ...event, state: { ...state, requestId: 'other' } }), { code: 'INVALID_ARGUMENT' })
  assert.throws(() => parseServiceClientEvent({ ...event, protocolVersion: 3 }), { code: 'INVALID_ARGUMENT' })
})

test('current bridge envelopes reject malformed IDs, cycles and oversized messages', async () => {
  const { MAX_MESSAGE_BYTES } = await import('../src/shared/canvas-agent-protocol.ts')
  for (const input of [{ ...command, canvasId: 2873 }, { ...command, canvasId: '9223372036854775808' },
    { ...command, sessionId: '' }, { ...command, requestId: '' }, { ...command, type: 'canvas.evil' }]) {
    assert.throws(() => parseServiceHostEvent(input), { code: 'INVALID_ARGUMENT' })
  }
  assert.throws(() => parseServiceHostEvent({ type: 'bridge.connected', protocolVersion: 4, connectionId: 'connection',
    extra: '你'.repeat(MAX_MESSAGE_BYTES / 2) }), { code: 'BRIDGE_OVERLOADED' })
  const cyclic = { ...command }; cyclic.self = cyclic
  assert.throws(() => parseServiceHostEvent(cyclic), { code: 'INVALID_ARGUMENT' })
})
