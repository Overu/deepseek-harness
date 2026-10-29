import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvasHostBridge } from '../src/host/canvas-bridge.ts'
const origin = 'http://127.0.0.1:3000'
const state = { phase: 'ready', capabilities: { read: true, edit: true, run: false }, version: '18' }
const add = { action: 'node.add', expectedVersion: '18', node: { type: 'text', changes: { text: 'hello' } } }
function fixture(options) {
  const bridge = createCanvasHostBridge(options); const events = []
  const client = bridge.attachClient(origin, 'client', 'web-locks-v1')
  const stop = bridge.connectStream(client.bridgeKey, origin, event => events.push(event))
  const send = event => bridge.acceptClientEvent(client.bridgeKey, origin, { protocolVersion: 4, connectionId: client.connectionId, ...event })
  send({ type: 'session.sync', revision: 1, sessionIds: ['session'] })
  return { bridge, events, client, stop, send, async prepare(requestId = 'prepare') {
    const waiting = bridge.ensureContext('session', '2873', 'edit', requestId)
    const { deadline, capability, refresh, ...event } = events.at(-1)
    send({ ...event, type: 'canvas.prepare.ack', status: 'prepared', contextId: 'context', state })
    return waiting
  }, settle(target, requestId = 'add') { const {readiness,...route}=target; send({ ...route, type: 'canvas.command.ack', requestId, phase: 'settled', result: { status: 'saved', canvasId: '2873', version: '19', affectedNodeIds: ['node'], unchanged: false } }) } }
}

test('graph/model dispatched read disconnects never become unknown writes', async t => {
  for (const operation of [{ action: 'canvas.graph.read' }, { action: 'canvas.models.read', nodeType: 'image' }]) {
    const f = fixture(); t.after(() => f.bridge.dispose()); const target = await f.prepare()
    const waiting = f.bridge.dispatch(target, 'read', operation); f.stop()
    const result = await waiting
    assert.equal(result.status, 'rejected'); assert.equal(result.effect, 'none'); assert.equal(result.error.code, 'READ_TIMEOUT')
    assert.equal((await f.bridge.dispatch(target, 'read', operation)).status, 'rejected')
  }
})

test('a known legacy Client blocks writes even when disconnected, while reads remain available', async t => {
  const f = fixture(); t.after(() => f.bridge.dispose()); const target = await f.prepare()
  const legacy = f.bridge.attachClient(origin, 'legacy-client')
  await assert.rejects(f.bridge.ensureContext('session', '2873', 'edit', 'mixed-prepare'), { code: 'CONTEXT_INACTIVE' })
  const rejected = await f.bridge.dispatch(target, 'mixed-write', add)
  assert.equal(rejected.status, 'rejected'); assert.equal(rejected.effect, 'none'); assert.equal(rejected.error.code, 'CONTEXT_INACTIVE')
  const waiting = f.bridge.ensureContext('session', '2873', 'read', 'mixed-read')
  const { deadline, capability, refresh, ...event } = f.events.at(-1)
  f.send({ ...event, type: 'canvas.prepare.ack', status: 'prepared', contextId: 'context', state })
  assert.equal((await waiting).readiness.capabilities.read, true)
  f.bridge.detachClient(legacy.bridgeKey, origin)
  const resumed = f.bridge.ensureContext('session', '2873', 'edit', 'upgraded')
  const { deadline: d, capability: c, refresh: r, ...next } = f.events.at(-1)
  f.send({ ...next, type: 'canvas.prepare.ack', status: 'prepared', contextId: 'context', state })
  assert.equal((await resumed).contextId, target.contextId)
})
test('Host accepts only matching graph/model read statuses and preserves saved edge IDs', async t => {
  const f = fixture(); t.after(() => f.bridge.dispose()); const target = await f.prepare()
  const graph = { status: 'graph', canvasId: '2873', version: '18', consistency: 'confirmed', nodeCount: 0, edgeCount: 0, nodes: [], edges: [], nodeOffset: 0, edgeOffset: 0, nextNodeOffset: null, nextEdgeOffset: null }
  const waiting = f.bridge.dispatch(target, 'graph', { action: 'canvas.graph.read' })
  const { readiness, ...route } = target
  assert.throws(() => f.send({ ...route, type: 'canvas.command.ack', requestId: 'graph', phase: 'settled', result: { status: 'saved', canvasId: '2873', version: '19', affectedNodeIds: [], unchanged: false } }), { code: 'INVALID_ARGUMENT' })
  f.send({ ...route, type: 'canvas.command.ack', requestId: 'graph', phase: 'settled', result: graph })
  assert.deepEqual(await waiting, graph)
  const saved = { status: 'saved', canvasId: '2873', version: '19', affectedNodeIds: ['source', 'target'], affectedEdgeIds: ['edge'], unchanged: false }
  const edge = f.bridge.dispatch(target, 'edge', { action: 'edge.add', expectedVersion: '18', connection: { sourceNodeId: 'source', targetNodeId: 'target' } })
  f.send({ ...route, type: 'canvas.command.ack', requestId: 'edge', phase: 'settled', result: saved })
  assert.deepEqual(await edge, saved)
})
test('Host routes prepare and one write to one fixed context, deduplicates call IDs and validates late ACKs', async t => {
  const f = fixture(); t.after(() => f.bridge.dispose()); const target = await f.prepare()
  const waiting = f.bridge.dispatch(target, 'add', add); const same = f.bridge.dispatch(target, 'add', { node: add.node, action: add.action, expectedVersion: '18' })
  assert.equal(f.events.filter(e => e.type === 'canvas.command').length, 1)
  assert.throws(() => f.send({ connectionId:target.connectionId,sessionId:target.sessionId,canvasId:target.canvasId, contextId: 'wrong', type: 'canvas.command.ack', requestId: 'add', phase: 'started' }))
  f.settle(target); assert.equal((await waiting).version, '19'); assert.equal((await same).status, 'saved')
  await assert.rejects(f.bridge.dispatch(target, 'add', { ...add, expectedVersion: '19' }), { code: 'DUPLICATE_REQUEST_MISMATCH' })
  assert.equal((await f.bridge.dispatch(target, 'add', add)).status, 'saved')
})
test('two registered clients for one session are ambiguous and never broadcast; stale session revisions cannot restore unbound sessions', async t => {
  const f = fixture(); t.after(() => f.bridge.dispose()); const b = f.bridge.attachClient(origin, 'other', 'web-locks-v1'); const events = []
  f.bridge.connectStream(b.bridgeKey, origin, event => events.push(event))
  f.bridge.acceptClientEvent(b.bridgeKey, origin, { type: 'session.sync', protocolVersion: 4, connectionId: b.connectionId, revision: 1, sessionIds: ['session'] })
  await assert.rejects(f.bridge.ensureContext('session', '2873', 'edit', 'p'), { code: 'CLIENT_AMBIGUOUS' })
  assert.equal(events.length, 1); assert.equal(f.events.length, 1)
  f.send({ type: 'session.sync', revision: 3, sessionIds: [] }); f.send({ type: 'session.sync', revision: 2, sessionIds: ['session'] })
  f.bridge.detachClient(b.bridgeKey, origin)
  await assert.rejects(f.bridge.ensureContext('session', '2873', 'edit', 'p2'), { code: 'CLIENT_UNAVAILABLE' })
})
test('a dispatched write becomes unknown on disconnect; reconnect never replays it and a late exact ACK updates its cached receipt', async t => {
  const f = fixture(); t.after(() => f.bridge.dispose()); const target = await f.prepare()
  const waiting = f.bridge.dispatch(target, 'add', add); f.stop()
  assert.equal((await waiting).status, 'submission_unknown')
  const reconnected = []; f.bridge.connectStream(f.client.bridgeKey, origin, event => reconnected.push(event))
  assert.equal(reconnected.length, 1)
  f.settle(target)
  assert.equal((await f.bridge.dispatch(target, 'add', add)).status, 'saved')
  assert.equal(f.events.filter(e => e.type === 'canvas.command').length, 1)
})
test('cancel before dispatch sends nothing; a dispatched cancellation is unknown and never promises rollback', async t => {
  const f = fixture(); t.after(() => f.bridge.dispose()); const target = await f.prepare()
  const before = new AbortController(); before.abort()
  assert.equal((await f.bridge.dispatch(target, 'before', add, before.signal)).error.code, 'CANCELLED_BEFORE_DISPATCH')
  const after = new AbortController(); const waiting = f.bridge.dispatch(target, 'after', add, after.signal); after.abort()
  assert.equal((await waiting).status, 'submission_unknown')
  assert.equal(f.events.filter(e => e.type === 'canvas.command').length, 1)
})
test('prepare/command target cannot change after context replacement; explicit refresh uses prepare without opening UI', async t => {
  const f = fixture(); t.after(() => f.bridge.dispose()); const old = await f.prepare()
  await assert.rejects(f.bridge.ensureContext('session', '2873', 'edit', 'invalid-refresh', undefined, true), { code: 'INVALID_ARGUMENT' })
  const waiting = f.bridge.ensureContext('session', '2873', 'read', 'refresh', undefined, true)
  const { deadline, capability, refresh, ...event } = f.events.at(-1); assert.equal(refresh, true)
  f.send({ ...event, type: 'canvas.prepare.ack', status: 'prepared', contextId: 'new-context', state })
  await waiting
  assert.equal((await f.bridge.dispatch(old, 'old', add)).error.code, 'CONTEXT_GONE')
})
test('read/prepare timeouts are bounded and do not resend; identity/auth mismatches are rejected', async t => {
  const f = fixture({ timeoutMs: 12 }); t.after(() => f.bridge.dispose()); const target = await f.prepare()
  const read = await f.bridge.dispatch(target, 'read', { action: 'canvas.read' }); assert.equal(read.error.code, 'READ_TIMEOUT')
  await assert.rejects(f.bridge.ensureContext('session', '2873', 'edit', 'timeout'), { code: 'CONTEXT_NOT_READY' })
  assert.throws(() => f.bridge.connectStream(f.client.bridgeKey, 'https://wrong.test', () => {}))
  assert.throws(() => f.send({ type: 'canvas.context.state', sessionId: 'session', canvasId: '2903', contextId: 'unprepared', state }))
})

test('a released session cannot route new work but its already dispatched write can still settle', async t => {
  const f=fixture();t.after(()=>f.bridge.dispose());const target=await f.prepare();const waiting=f.bridge.dispatch(target,'add',add)
  f.send({type:'session.sync',revision:2,sessionIds:[]});f.settle(target);assert.equal((await waiting).status,'saved')
  assert.equal((await f.bridge.dispatch(target,'new',add)).error.code,'CLIENT_UNAVAILABLE')
})
test('completed prepare identity cannot be overwritten by a conflicting duplicate receipt', async t => {
  const f=fixture();t.after(()=>f.bridge.dispose());const target=await f.prepare()
  assert.throws(()=>f.send({type:'canvas.prepare.ack',sessionId:'session',canvasId:'2873',requestId:'prepare',status:'prepared',contextId:'forged',state}),{code:'DUPLICATE_REQUEST_MISMATCH'})
  const waiting=f.bridge.dispatch(target,'add',add);f.settle(target);assert.equal((await waiting).status,'saved')
})

test('Host in-flight limit refuses a new command instead of dropping earlier uncertain writes', async t => {
  const f=fixture();t.after(()=>f.bridge.dispose());const target=await f.prepare()
  const waiting=Array.from({length:8},(_,i)=>f.bridge.dispatch(target,'write-'+i,add))
  await assert.rejects(f.bridge.dispatch(target,'overflow',add),{code:'BRIDGE_OVERLOADED'})
  assert.equal(f.events.filter(event=>event.type==='canvas.command').length,8)
  f.bridge.dispose();assert.ok((await Promise.all(waiting)).every(result=>result.status==='submission_unknown'))
})


test('Host routes an asset write through the existing context and caches its saved receipt once', async t => {
  const f = fixture(); t.after(() => f.bridge.dispose()); const target = await f.prepare()
  const asset = { action: 'asset.add', expectedVersion: '18', asset: { url: 'https://assets.example/product.png', title: '商品图', position: { x: 20, y: 40 } } }
  const waiting = f.bridge.dispatch(target, 'asset', asset)
  const duplicate = f.bridge.dispatch(target, 'asset', { asset: asset.asset, expectedVersion: '18', action: 'asset.add' })
  const commands = f.events.filter(event => event.type === 'canvas.command')
  assert.equal(commands.length, 1); assert.deepEqual(commands[0].payload, asset); assert.equal(commands[0].contextId, target.contextId)
  f.settle(target, 'asset')
  assert.equal((await waiting).status, 'saved'); assert.equal((await duplicate).version, '19')
  assert.equal((await f.bridge.dispatch(target, 'asset', asset)).status, 'saved')
  await assert.rejects(f.bridge.dispatch(target, 'asset', { ...asset, asset: { ...asset.asset, url: 'https://assets.example/other.png' } }), { code: 'DUPLICATE_REQUEST_MISMATCH' })
  assert.equal(f.events.filter(event => event.type === 'canvas.command').length, 1)
})

test('a disconnected asset write stays unknown and is never resent; only its exact late receipt settles it', async t => {
  const f = fixture(); t.after(() => f.bridge.dispose()); const target = await f.prepare()
  const asset = { action: 'asset.add', expectedVersion: '18', asset: { url: 'https://assets.example/product.png' } }
  const waiting = f.bridge.dispatch(target, 'asset', asset); f.stop()
  const unknown = await waiting
  assert.equal(unknown.status, 'submission_unknown'); assert.equal(unknown.phase, 'save'); assert.equal(unknown.error.retry, 'never_auto')
  const reconnected = []; f.bridge.connectStream(f.client.bridgeKey, origin, event => reconnected.push(event))
  assert.equal((await f.bridge.dispatch(target, 'asset', asset)).status, 'submission_unknown')
  assert.equal(reconnected.filter(event => event.type === 'canvas.command').length, 0)
  f.settle(target, 'asset')
  assert.equal((await f.bridge.dispatch(target, 'asset', asset)).status, 'saved')
  assert.equal(f.events.filter(event => event.type === 'canvas.command').length, 1)
  assert.equal(reconnected.filter(event => event.type === 'canvas.command').length, 0)
})

const runOperation = { action: 'node.run', expectedVersion: '18', nodeId: 'image', approvedGeneration: { images: 1, videos: 0 } }
const runState = (phase = 'running', sequence = 1) => ({ requestId: 'run', canvasId: '2873', nodeId: 'image', sequence, phase, version: '19', workflowTaskId: 'workflow-task', nodeTaskId: 'node-task', generation: { images: 1, videos: 0 }, outputs: phase === 'completed' ? ['https://assets.example/new.png'] : [] })
async function prepareRun(f) {
  const target = await f.prepare()
  const ready = { ...state, capabilities: { read: true, edit: true, run: true } }
  f.send({ type: 'canvas.context.state', sessionId: target.sessionId, canvasId: target.canvasId, contextId: target.contextId, state: ready })
  return { ...target, readiness: ready }
}
test('run events arrive before submission ACK, survive UI session release and replay without another execution', async t => {
  const f = fixture(); t.after(() => f.bridge.dispose()); const target = await prepareRun(f); const heard = []
  const release = f.bridge.subscribeRun(target, 'run', value => heard.push(value)); t.after(release)
  const waiting = f.bridge.dispatch(target, 'run', runOperation)
  const { readiness, ...route } = target
  const event = { ...route, type: 'canvas.run.state', requestId: 'run', state: runState('completed', 2) }
  f.send({ type: 'session.sync', revision: 2, sessionIds: [] })
  f.send(event); f.send(event)
  assert.equal(heard.length, 1); assert.equal(heard[0].nodeTaskId, 'node-task'); assert.notEqual(heard[0].nodeTaskId, heard[0].workflowTaskId)
  assert.throws(() => f.send({ ...event, state: { ...event.state, outputs: ['https://assets.example/forged.png'] } }), { code: 'DUPLICATE_REQUEST_MISMATCH' })
  f.send({ ...event, state: runState('running', 1) }); assert.equal(heard.length, 1)
  const submitted = { status: 'submitted', canvasId: '2873', version: '19', nodeId: 'image', taskId: 'workflow-task', generation: { images: 1, videos: 0 } }
  f.send({ ...route, type: 'canvas.command.ack', requestId: 'run', phase: 'settled', result: submitted })
  assert.deepEqual(await waiting, submitted)
  const replay = []; const stop = f.bridge.subscribeRun({ ...target, readiness: state }, 'run', value => replay.push(value)); t.after(stop)
  assert.deepEqual(replay, heard); assert.deepEqual(await f.bridge.dispatch(target, 'run', runOperation), submitted)
  assert.equal(f.events.filter(event => event.type === 'canvas.command').length, 1)
  assert.equal((await f.bridge.dispatch(target, 'another-run', runOperation)).error.code, 'CLIENT_UNAVAILABLE')
})
test('workflow child states are bound to their nodes and release run capacity independently', async t => {
  const f = fixture(); t.after(() => f.bridge.dispose()); const target = await prepareRun(f)
  const operation = { action: 'workflow.run', expectedVersion: '18', nodeIds: ['first', 'second'],
    approvedGenerations: { first: { images: 1, videos: 0 }, second: { images: 2, videos: 0 } },
    runRequestIds: { first: 'batch:first', second: 'batch:second' } }
  const seen = []
  for (const requestId of Object.values(operation.runRequestIds)) t.after(f.bridge.subscribeRun(target, requestId, state => seen.push(state)))
  const waiting = f.bridge.dispatch(target, 'batch', operation)
  const { readiness, ...route } = target
  const first = { ...runState('completed', 2), requestId: 'batch:first', nodeId: 'first', generation: operation.approvedGenerations.first }
  const second = { ...runState('completed', 2), requestId: 'batch:second', nodeId: 'second', generation: operation.approvedGenerations.second }
  assert.throws(() => f.send({ ...route, type: 'canvas.run.state', requestId: 'batch:first', state: { ...first, nodeId: 'second' } }), { code: 'CONTEXT_GONE' })
  assert.throws(() => f.send({ ...route, type: 'canvas.run.state', requestId: 'batch:first', state: { ...first, generation: operation.approvedGenerations.second } }), { code: 'INVALID_ARGUMENT' })
  f.send({ ...route, type: 'canvas.run.state', requestId: 'batch:first', state: first })
  f.send({ ...route, type: 'canvas.run.state', requestId: 'batch:second', state: second })
  assert.deepEqual(seen.map(state => state.nodeId), operation.nodeIds)
  const submitted = { status: 'submitted', canvasId: '2873', version: '19', taskId: 'workflow-task', nodeIds: operation.nodeIds,
    results: operation.nodeIds.map(nodeId => ({ nodeId, generation: operation.approvedGenerations[nodeId] })) }
  f.send({ ...route, type: 'canvas.command.ack', requestId: 'batch', phase: 'settled', result: submitted })
  assert.deepEqual(await waiting, submitted)
  const replay = []
  t.after(f.bridge.subscribeRun(target, 'batch:second', state => replay.push(state)))
  assert.deepEqual(replay, [second])
})
test('workflow detach closes every child tracker with its own node identity', async t => {
  const f = fixture(); t.after(() => f.bridge.dispose()); const target = await prepareRun(f)
  const operation = { action: 'workflow.run', expectedVersion: '18', nodeIds: ['first', 'second'],
    approvedGenerations: { first: { images: 1, videos: 0 }, second: { images: 0, videos: 1 } },
    runRequestIds: { first: 'batch:first', second: 'batch:second' } }
  const seen = []
  for (const requestId of Object.values(operation.runRequestIds)) t.after(f.bridge.subscribeRun(target, requestId, state => seen.push(state)))
  const waiting = f.bridge.dispatch(target, 'batch', operation)
  const { readiness, ...route } = target
  f.send({ ...route, type: 'canvas.command.ack', requestId: 'batch', phase: 'settled', result: {
    status: 'submitted', canvasId: '2873', version: '19', taskId: 'workflow-task', nodeIds: operation.nodeIds,
    results: operation.nodeIds.map(nodeId => ({ nodeId, generation: operation.approvedGenerations[nodeId] })) } })
  await waiting
  f.stop(); assert.equal(seen.length, 0)
  f.bridge.detachClient(f.client.bridgeKey, origin)
  assert.deepEqual(seen.map(state => [state.requestId, state.nodeId, state.generation, state.phase]), [
    ['batch:first', 'first', operation.approvedGenerations.first, 'monitoring_unknown'],
    ['batch:second', 'second', operation.approvedGenerations.second, 'monitoring_unknown'],
  ])
})
test('run disconnect reports generation-specific unknown and accepts matching late state without re-dispatch', async t => {
  const f = fixture(); t.after(() => f.bridge.dispose()); const target = await prepareRun(f)
  const waiting = f.bridge.dispatch(target, 'run', runOperation); f.stop()
  assert.deepEqual(await waiting, { status: 'submission_unknown', canvasId: '2873', version: null, phase: 'run', affectedNodeIds: ['image'], nodeId: 'image', generation: { images: 1, videos: 0 }, error: { code: 'SUBMISSION_UNKNOWN', message: '画布连接已断开，请核对已提交的操作；不会自动重发', retry: 'never_auto' } })
  const reconnected = []; f.bridge.connectStream(f.client.bridgeKey, origin, event => reconnected.push(event))
  const { readiness, ...route } = target
  f.send({ ...route, type: 'canvas.run.state', requestId: 'run', state: runState('completed', 2) })
  const seen = []; t.after(f.bridge.subscribeRun(target, 'run', event => seen.push(event)))
  assert.equal(seen[0].phase, 'completed'); assert.equal(reconnected.length, 1)
  assert.throws(() => f.send({ ...route, type: 'canvas.run.state', requestId: 'run', state: { ...runState(), nodeId: 'different' } }), { code: 'CONTEXT_GONE' })
})

test('Host reserves active task capacity before dispatch, rejects ninth run and admits new work after terminal', async t => {
  const f = fixture(); t.after(() => f.bridge.dispose()); const target = await prepareRun(f)
  const { readiness, ...route } = target
  for (let i = 0; i < 8; i++) {
    const requestId = 'run-' + i
    const waiting = f.bridge.dispatch(target, requestId, runOperation)
    f.send({ ...route, requestId, type: 'canvas.command.ack', phase: 'settled', result: { status: 'submitted', canvasId: '2873', nodeId: 'image', taskId: 'workflow-' + i, version: '19', generation: { images: 1, videos: 0 } } })
    await waiting
  }
  await assert.rejects(f.bridge.dispatch(target, 'ninth', runOperation), { code: 'BRIDGE_OVERLOADED' })
  assert.equal(f.events.filter(event => event.type === 'canvas.command').length, 8)
  f.send({ ...route, requestId: 'run-0', type: 'canvas.run.state', state: { ...runState('completed', 2), requestId: 'run-0' } })
  const next = f.bridge.dispatch(target, 'next', runOperation)
  f.send({ ...route, requestId: 'next', type: 'canvas.command.ack', phase: 'settled', result: { status: 'submitted', canvasId: '2873', nodeId: 'image', taskId: 'workflow-next', version: '19', generation: { images: 1, videos: 0 } } })
  assert.equal((await next).status, 'submitted'); assert.equal(f.events.filter(event => event.type === 'canvas.command').length, 9)
})

test('explicit Client detach releases active reservations with cached monitoring_unknown; temporary stream disconnect keeps them', async t => {
  const f = fixture(); t.after(() => f.bridge.dispose()); const target = await prepareRun(f), seen = []
  t.after(f.bridge.subscribeRun(target, 'run', state => seen.push(state)))
  const waiting = f.bridge.dispatch(target, 'run', runOperation)
  const { readiness, ...route } = target
  f.send({ ...route, type: 'canvas.command.ack', requestId: 'run', phase: 'settled', result: { status: 'submitted', canvasId: '2873', nodeId: 'image', version: '19', taskId: 'workflow', generation: { images: 1, videos: 0 } } })
  await waiting
  f.stop(); assert.equal(seen.length, 0)
  f.bridge.detachClient(f.client.bridgeKey, origin)
  assert.equal(seen.length, 1); assert.equal(seen[0].phase, 'monitoring_unknown'); assert.equal(seen[0].error.code, 'CLIENT_UNAVAILABLE')
  const replay = []; t.after(f.bridge.subscribeRun(target, 'run', state => replay.push(state))); assert.deepEqual(replay, seen)
  const replacement = f.bridge.attachClient(origin, 'replacement', 'web-locks-v1'); const events = []
  f.bridge.connectStream(replacement.bridgeKey, origin, event => events.push(event))
  const send = event => f.bridge.acceptClientEvent(replacement.bridgeKey, origin, { protocolVersion: 4, connectionId: replacement.connectionId, ...event })
  send({ type: 'session.sync', revision: 1, sessionIds: ['session'] })
  const prepare = f.bridge.ensureContext('session', '2874', 'run', 'replacement-prepare')
  const { deadline, capability, refresh, ...event } = events.at(-1)
  send({ ...event, type: 'canvas.prepare.ack', status: 'prepared', contextId: 'replacement-context', state: { ...state, capabilities: { read: true, edit: true, run: true } } })
  const next = await prepare, newRun = f.bridge.dispatch(next, 'replacement-run', runOperation)
  const { readiness: ignored, ...newRoute } = next
  send({ ...newRoute, type: 'canvas.command.ack', requestId: 'replacement-run', phase: 'settled', result: { status: 'submitted', canvasId: '2874', nodeId: 'image', version: '19', taskId: 'workflow-next', generation: { images: 1, videos: 0 } } })
  assert.equal((await newRun).status, 'submitted')
})
