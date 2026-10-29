import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvasCommandEndpoint } from '../src/client/canvas-command-endpoint.ts'
const state = { phase: 'ready', capabilities: { read: true, edit: true, run: false }, version: '18' }
const base = { protocolVersion: 4, connectionId: 'connection', sessionId: 'session', canvasId: '2873', requestId: 'add', contextId: 'context', deadline: Date.now() + 30000 }
const command = { ...base, type: 'canvas.command', payload: { action: 'node.add', expectedVersion: '18', node: { type: 'text' } } }
function fixture() {
  const sent = []; let calls = 0, prepares = 0, refreshes = 0, current = 'context', bound = true
  const rt = { getContextInfo: () => ({ canvasId: '2873', contextId: current, readiness: state }), execute: async () => { calls++; return { status: 'saved', canvasId: '2873', version: '19', affectedNodeIds: ['n'], unchanged: false } }, ensureContext: async () => { prepares++; return rt.getContextInfo() }, reloadContext: async () => { refreshes++; return rt.getContextInfo() }, subscribeReadiness: (_id, listener) => { listener(state); return () => {} } }
  const endpoint = createCanvasCommandEndpoint({ connectionId: 'connection', getRuntime: async () => rt, isSessionBound: () => bound, send: event => sent.push(event) })
  return { endpoint, sent, rt, replace() { current = 'new' }, unbind() { bound = false }, get calls() { return calls }, get prepares() { return prepares }, get refreshes() { return refreshes } }
}
test('same command executes once, changed payload rejects, settled receipt survives transport replay', async t => {
  const f = fixture(); t.after(() => f.endpoint.dispose()); await Promise.all([f.endpoint.handle(command), f.endpoint.handle(command)])
  assert.equal(f.calls, 1); assert.equal(f.sent.at(-1).result.status, 'saved')
  await f.endpoint.handle({ ...command, payload: { ...command.payload, expectedVersion: '19' } })
  assert.equal(f.calls, 1); assert.equal(f.sent.at(-1).result.error.code, 'DUPLICATE_REQUEST_MISMATCH')
})
test('replaced context, unbound session and expired deadline never call runtime.execute', async t => {
  for (const [change,deadline] of [[f => f.replace(),command.deadline], [f => f.unbind(),command.deadline], [() => {},1]]) {
    const f = fixture(); t.after(() => f.endpoint.dispose()); change(f)
    await f.endpoint.handle({ ...command, deadline })
    assert.equal(f.calls, 0); assert.equal(f.sent.at(-1).phase, 'settled')
  }
})
test('prepare invokes existing ensure/reload and publishes actual context readiness, without creating a view', async t => {
  const f = fixture(); t.after(() => f.endpoint.dispose())
  const { contextId, ...prepare } = base
  await f.endpoint.handle({ ...prepare, type: 'canvas.prepare', requestId: 'prepare', capability: 'edit' })
  await f.endpoint.handle({ ...prepare, type: 'canvas.prepare', requestId: 'refresh', capability: 'read', refresh: true })
  assert.equal(f.prepares, 1); assert.equal(f.refreshes, 1)
  assert.ok(f.sent.some(event => event.type === 'canvas.prepare.ack' && event.status === 'prepared'))
  assert.ok(f.sent.some(event => event.type === 'canvas.context.state'))
})
test('deadline and context are checked again after the lazy runtime resolves', async t => {
  let release; const ready = new Promise(resolve => { release = resolve }); let calls = 0; const sent = []
  const endpoint = createCanvasCommandEndpoint({ connectionId: 'connection', getRuntime: () => ready, isSessionBound: () => true, send: event => sent.push(event) })
  t.after(() => endpoint.dispose()); const waiting = endpoint.handle(command)
  release({ getContextInfo: () => ({ contextId: 'changed', readiness: state }), execute() { calls++ } })
  await waiting; assert.equal(calls, 0); assert.equal(sent.at(-1).result.error.code, 'CONTEXT_GONE')
})

test('a malformed/throwing native write never becomes an effect:none rejection; replay does not execute twice', async t => {
  for (const execute of [async () => ({status:'saved',canvasId:'2873'}), async () => { throw new Error('native reply lost') }]) {
    const f = fixture(); t.after(() => f.endpoint.dispose()); f.rt.execute = execute
    await f.endpoint.handle(command)
    assert.equal(f.sent.at(-1).result.status,'submission_unknown')
    assert.equal(f.sent.at(-1).result.error.retry,'never_auto')
    await f.endpoint.handle(command); assert.equal(f.sent.at(-1).result.status,'submission_unknown')
  }
})
test('session IDs with separators release only their own readiness subscription; send failure does not undo saving', async t => {
  const stopped=[]; const sent=[]; const rt={ensureContext:async()=>({contextId:'context',readiness:state}),subscribeReadiness:()=>{const i=stopped.length;stopped.push(false);return()=>{stopped[i]=true}},getContextInfo:()=>({contextId:'context',readiness:state}),execute:async()=>({status:'saved',canvasId:'2873',version:'19',affectedNodeIds:['n'],unchanged:false})}
  const endpoint=createCanvasCommandEndpoint({connectionId:'connection',getRuntime:async()=>rt,isSessionBound:()=>true,send:event=>{sent.push(event);if(event.type==='canvas.command.ack'&&event.phase==='started')throw new Error('offline')}});t.after(()=>endpoint.dispose())
  const {contextId,...prepare}=base
  await endpoint.handle({...prepare,type:'canvas.prepare',capability:'read',requestId:'p1',sessionId:'s'})
  await endpoint.handle({...prepare,type:'canvas.prepare',capability:'read',requestId:'p2',sessionId:'s/x'})
  endpoint.releaseSession('s');assert.deepEqual(stopped,[true,false])
  await endpoint.handle(command);assert.equal(sent.at(-1).result.status,'saved')
})


test('Client passes asset.add to the existing runtime once and returns its exact saved receipt', async t => {
  const f = fixture(); t.after(() => f.endpoint.dispose()); const calls = []
  const payload = { action: 'asset.add', expectedVersion: '18', asset: { url: 'https://assets.example/product.png', title: '商品图', position: { x: 4, y: 8 } } }
  const assetCommand = { ...command, requestId: 'asset', payload }
  const saved = { status: 'saved', canvasId: '2873', version: '19', affectedNodeIds: ['asset-node'], unchanged: false }
  f.rt.execute = async input => { calls.push(input); return saved }
  await f.endpoint.handle(assetCommand)
  assert.deepEqual(calls, [{ canvasId: '2873', expectedContextId: 'context', operation: payload }])
  assert.deepEqual(f.sent.filter(event => event.type === 'canvas.command.ack').map(event => event.phase), ['accepted', 'started', 'settled'])
  assert.deepEqual(f.sent.at(-1).result, saved)
  await f.endpoint.handle(assetCommand)
  assert.equal(calls.length, 1); assert.deepEqual(f.sent.at(-1).result, saved)
})

test('asset execution errors and malformed receipts are unknown after start and replay never executes twice', async t => {
  for (const response of [async () => { throw new Error('asset registration response lost') }, async () => ({ status: 'saved', canvasId: '2873' })]) {
    const f = fixture(); t.after(() => f.endpoint.dispose()); let calls = 0
    f.rt.execute = async () => { calls++; return response() }
    const assetCommand = { ...command, requestId: 'asset', payload: { action: 'asset.add', expectedVersion: '18', asset: { url: 'https://assets.example/product.png' } } }
    await f.endpoint.handle(assetCommand)
    assert.ok(f.sent.some(event => event.phase === 'started'))
    const result = f.sent.at(-1).result
    assert.equal(result.status, 'submission_unknown'); assert.equal(result.phase, 'save'); assert.equal(result.error.retry, 'never_auto')
    await f.endpoint.handle(assetCommand)
    assert.equal(calls, 1); assert.deepEqual(f.sent.at(-1).result, result)
  }
})

test('an asset failure explicitly known to precede submission is rejected without promising rollback', async t => {
  const f = fixture(); t.after(() => f.endpoint.dispose()); let calls = 0
  f.rt.execute = async () => { calls++; throw Object.assign(new Error('asset not registered'), { code: 'ASSET_REGISTRATION_REJECTED', requestPhase: 'not_sent' }) }
  const assetCommand = { ...command, requestId: 'asset', payload: { action: 'asset.add', expectedVersion: '18', asset: { url: 'https://assets.example/product.png' } } }
  await f.endpoint.handle(assetCommand)
  assert.equal(f.sent.at(-1).result.status, 'rejected'); assert.equal(f.sent.at(-1).result.effect, 'none'); assert.equal(f.sent.at(-1).result.error.code, 'ASSET_REGISTRATION_REJECTED')
  await f.endpoint.handle(assetCommand); assert.equal(calls, 1)
})

test('invalid asset input is rejected before Client execution or ACK emission', async t => {
  const f = fixture(); t.after(() => f.endpoint.dispose())
  await assert.rejects(f.endpoint.handle({ ...command, payload: { action: 'asset.add', expectedVersion: '18', asset: { url: 'file:///tmp/private.png' } } }), { code: 'INVALID_ARGUMENT' })
  assert.equal(f.calls, 0); assert.equal(f.sent.length, 0)
})

test('graph/model read failures after start are read rejections, never submission_unknown', async t => {
  for (const payload of [{ action: 'canvas.graph.read' }, { action: 'canvas.models.read', nodeType: 'image' }]) {
    const f = fixture(); t.after(() => f.endpoint.dispose()); let calls = 0
    f.rt.execute = async () => { calls++; throw new Error('read failed') }
    const input = { ...command, requestId: payload.action, payload }
    await f.endpoint.handle(input)
    assert.equal(f.sent.at(-1).result.status, 'rejected'); assert.equal(f.sent.at(-1).result.effect, 'none')
    await f.endpoint.handle(input); assert.equal(calls, 1)
  }
})
test('graph reads only require read readiness and mismatched saved receipts cannot pass as read success', async t => {
  const f = fixture(); t.after(() => f.endpoint.dispose())
  f.rt.getContextInfo = () => ({ contextId: 'context', readiness: { ...state, capabilities: { read: true, edit: false, run: false } } })
  const graph = { status: 'graph', canvasId: '2873', version: '18', consistency: 'confirmed', nodeCount: 0, edgeCount: 0, nodes: [], edges: [], nodeOffset: 0, edgeOffset: 0, nextNodeOffset: null, nextEdgeOffset: null }
  f.rt.execute = async () => graph
  await f.endpoint.handle({ ...command, requestId: 'graph', payload: { action: 'canvas.graph.read' } })
  assert.deepEqual(f.sent.at(-1).result, graph)
  f.rt.execute = async () => ({ status: 'saved', canvasId: '2873', version: '19', affectedNodeIds: [], unchanged: false })
  await f.endpoint.handle({ ...command, requestId: 'bad-read', payload: { action: 'canvas.graph.read' } })
  assert.equal(f.sent.at(-1).result.status, 'rejected'); assert.equal(f.sent.at(-1).result.error.code, 'INVALID_ARGUMENT')
})
test('edge writes retain unknown affectedEdgeIds and replay never starts a second native write', async t => {
  const f = fixture(); t.after(() => f.endpoint.dispose()); let calls = 0
  const unknown = { status: 'submission_unknown', canvasId: '2873', version: null, phase: 'save', affectedNodeIds: ['source', 'target'], affectedEdgeIds: ['edge'], error: { code: 'SUBMISSION_UNKNOWN', message: 'lost', retry: 'never_auto' } }
  f.rt.execute = async () => { calls++; return unknown }
  const input = { ...command, requestId: 'edge', payload: { action: 'edge.add', expectedVersion: '18', connection: { sourceNodeId: 'source', targetNodeId: 'target' } } }
  await f.endpoint.handle(input); await f.endpoint.handle(input)
  assert.deepEqual(f.sent.at(-1).result, unknown); assert.equal(calls, 1)
})

test('Client subscribes before executing a run, preserves observer when UI session releases and replays terminal state', async t => {
  const f = fixture(); t.after(() => f.endpoint.dispose()); let listener, stops = 0, calls = 0
  const ready = { ...state, capabilities: { read: true, edit: true, run: true } }
  f.rt.getContextInfo = () => ({ contextId: 'context', readiness: ready })
  f.rt.subscribeRun = (input, callback) => { assert.equal(input.requestId, 'run'); listener = callback; return () => { stops++ } }
  const snapshot = { requestId: 'run', canvasId: '2873', nodeId: 'image', sequence: 2, phase: 'completed', version: '19', workflowTaskId: 'workflow', nodeTaskId: 'node-task', generation: { images: 1, videos: 0 }, outputs: ['https://assets.example/new.png'] }
  const submitted = { status: 'submitted', canvasId: '2873', nodeId: 'image', taskId: 'workflow', version: '19', generation: { images: 1, videos: 0 } }
  f.rt.execute = async input => { assert.equal(typeof listener, 'function'); assert.equal(input.requestId, 'run'); calls++; f.unbind(); f.endpoint.releaseSession('session'); assert.equal(stops, 0); listener(snapshot); return submitted }
  const run = { ...command, requestId: 'run', payload: { action: 'node.run', expectedVersion: '18', nodeId: 'image', approvedGeneration: { images: 1, videos: 0 } } }
  await f.endpoint.handle(run)
  assert.equal(stops, 1); assert.equal(calls, 1); assert.deepEqual(f.sent.find(event => event.type === 'canvas.run.state').state, snapshot)
  assert.deepEqual(f.sent.at(-1).result, submitted)
  await f.endpoint.handle(run); assert.equal(calls, 1); assert.equal(f.sent.at(-1).type, 'canvas.run.state')
})
test('a run throwing after start is run submission_unknown, never save unknown or safe rejection', async t => {
  const f = fixture(); t.after(() => f.endpoint.dispose())
  f.rt.getContextInfo = () => ({ contextId: 'context', readiness: { ...state, capabilities: { read: true, edit: true, run: true } } })
  f.rt.subscribeRun = () => () => {}
  f.rt.execute = async () => { throw new Error('lost run receipt') }
  await f.endpoint.handle({ ...command, requestId: 'run', payload: { action: 'node.run', expectedVersion: '18', nodeId: 'image', approvedGeneration: { images: 1, videos: 0 } } })
  assert.equal(f.sent.at(-1).result.phase, 'run'); assert.equal(f.sent.at(-1).result.nodeId, 'image'); assert.equal(f.sent.at(-1).result.error.retry, 'never_auto')
})

test('workflow runs subscribe and replay each node request independently', async t => {
  const f = fixture(); t.after(() => f.endpoint.dispose()); const listeners = new Map(); const stopped = []
  f.rt.getContextInfo = () => ({ contextId: 'context', readiness: { ...state, capabilities: { read: true, edit: true, run: true } } })
  f.rt.subscribeRun = (input, listener) => { listeners.set(input.requestId, listener); return () => { stopped.push(input.requestId); listeners.delete(input.requestId) } }
  const requestIds = { image: 'workflow-image', video: 'workflow-video' }
  const run = { ...command, requestId: 'workflow', payload: { action: 'workflow.run', expectedVersion: '18', nodeIds: ['image', 'video'], approvedGenerations: { image: { images: 1, videos: 0 }, video: { images: 0, videos: 1 } }, runRequestIds: requestIds } }
  f.rt.execute = async input => {
    assert.equal(input.requestId, 'workflow')
    assert.deepEqual([...listeners.keys()].sort(), Object.values(requestIds).sort())
    listeners.get('workflow-image')({ requestId: 'workflow-image', canvasId: '2873', nodeId: 'image', sequence: 1, phase: 'completed', version: '19', generation: { images: 1, videos: 0 }, outputs: [] })
    listeners.get('workflow-video')({ requestId: 'workflow-video', canvasId: '2873', nodeId: 'video', sequence: 1, phase: 'running', version: '19', generation: { images: 0, videos: 1 }, outputs: [] })
    return { status: 'submitted', canvasId: '2873', version: '19', taskId: 'workflow-task', nodeIds: ['image', 'video'], results: [{ nodeId: 'image', generation: { images: 1, videos: 0 } }, { nodeId: 'video', generation: { images: 0, videos: 1 } }] }
  }
  await f.endpoint.handle(run)
  assert.deepEqual(stopped, ['workflow-image'])
  await f.endpoint.handle(run)
  assert.equal(f.sent.at(-1).requestId, 'workflow-video')
  assert.equal(f.sent.at(-2).requestId, 'workflow-image')
  assert.deepEqual([...listeners.keys()], ['workflow-video'])
})

test('workflow subscription setup rolls back every child when a subscription rejects', async t => {
  const f = fixture(); t.after(() => f.endpoint.dispose()); const stopped = []; let calls = 0
  f.rt.getContextInfo = () => ({ contextId: 'context', readiness: { ...state, capabilities: { read: true, edit: true, run: true } } })
  f.rt.subscribeRun = input => {
    if (input.requestId === 'workflow-video') throw new Error('tracker unavailable')
    return () => { stopped.push(input.requestId) }
  }
  f.rt.execute = async () => { calls++; throw new Error('must not execute') }
  const run = { ...command, requestId: 'workflow', payload: { action: 'workflow.run', expectedVersion: '18', nodeIds: ['image', 'video'], approvedGenerations: { image: { images: 1, videos: 0 }, video: { images: 0, videos: 1 } }, runRequestIds: { image: 'workflow-image', video: 'workflow-video' } } }
  await f.endpoint.handle(run)
  assert.equal(calls, 0)
  assert.deepEqual(stopped, ['workflow-image'])
  assert.equal(f.sent.at(-1).result.status, 'rejected')
  assert.equal(f.sent.at(-1).result.error.code, 'CONTEXT_NOT_READY')
})

test('active runs reserve terminal state capacity and ninth run is rejected before invoke even after submission ACKs', async t => {
  const f = fixture(); t.after(() => f.endpoint.dispose()); const listeners = new Map(); let calls = 0
  f.rt.getContextInfo = () => ({ contextId: 'context', readiness: { ...state, capabilities: { read: true, edit: true, run: true } } })
  f.rt.subscribeRun = (input, listener) => { listeners.set(input.requestId, listener); return () => listeners.delete(input.requestId) }
  f.rt.execute = async input => { calls++; return { status: 'submitted', canvasId: '2873', version: '19', nodeId: input.operation.nodeId, taskId: 'workflow-' + input.requestId, generation: { images: 1, videos: 0 } } }
  const make = i => ({ ...command, requestId: 'run-' + i, payload: { action: 'node.run', expectedVersion: '18', nodeId: 'image-' + i, approvedGeneration: { images: 1, videos: 0 } } })
  for (let i = 0; i < 8; i++) await f.endpoint.handle(make(i))
  await f.endpoint.handle(make(8)); assert.equal(calls, 8); assert.equal(f.sent.at(-1).result.status, 'rejected'); assert.equal(f.sent.at(-1).result.error.code, 'BRIDGE_OVERLOADED')
  const completed = { requestId: 'run-0', canvasId: '2873', nodeId: 'image-0', sequence: 1, phase: 'completed', version: '20', generation: { images: 1, videos: 0 }, outputs: ['https://assets.example/new.png'] }
  listeners.get('run-0')(completed)
  assert.deepEqual(f.sent.at(-1).state, completed); assert.equal(listeners.size, 7)
  await f.endpoint.handle(make(9)); assert.equal(calls, 9); assert.equal(f.sent.at(-1).result.status, 'submitted')
})
