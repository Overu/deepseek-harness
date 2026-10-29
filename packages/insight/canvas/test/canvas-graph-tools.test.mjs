import assert from 'node:assert/strict'
import test from 'node:test'
import { registerCanvasTools } from '../src/host/canvas-tools.ts'
import { registerCanvasGraphTools } from '../src/host/canvas-graph-tools.ts'
import { CanvasAgentError } from '../src/shared/canvas-agent-protocol.ts'

const id = '103165'
const exec = (callId = 'call') => ({ callId, agent: { id: 'session' }, signal: new AbortController().signal })
const graph = { status: 'graph', canvasId: id, version: '3', consistency: 'confirmed', nodeCount: 0, edgeCount: 0, nodes: [], edges: [], nodeOffset: 0, edgeOffset: 0, nextNodeOffset: null, nextEdgeOffset: null }
const models = { status: 'models', canvasId: id, version: '3', consistency: 'confirmed', catalogVersion: 'catalog-1', nodeType: 'image', modes: [], modeCount: 0, modeOffset: 0, nextModeOffset: null, modelType: null, models: [], modelCount: 0, modelOffset: 0, nextModelOffset: null, model: null, paramHints: [] }
const saved = { status: 'saved', canvasId: id, version: '4', affectedNodeIds: ['n1', 'n2'], affectedEdgeIds: ['edge'], warnings: ['输入改变后需检查模式'], unchanged: false }
function fixture(overrides = {}) {
  const definitions = new Map(), calls = []
  const ctx = { tools: { register: tool => { definitions.set(tool.name, tool); return () => definitions.delete(tool.name) } }, effect: fn => fn() }
  const bridge = {
    ensureContext: async (...args) => { calls.push(['prepare', ...args]); return { connectionId: 'private', contextId: 'private-context', canvasId: id, sessionId: 'session', readiness: { phase: 'ready', capabilities: { read: true, edit: true, run: false }, version: '3' } } },
    dispatch: async (...args) => { calls.push(['dispatch', ...args]); return args[2].action === 'canvas.graph.read' ? graph : args[2].action === 'canvas.models.read' ? models : saved },
    ...overrides,
  }
  registerCanvasTools(ctx, bridge, { getCanvas: async () => { throw new Error('must not fetch summary') } })
  registerCanvasGraphTools(ctx, bridge)
  return { definitions, calls, async run(name, input, context = exec()) {
    if ((name === 'canvas_node_edit' || name === 'canvas_edges') && 'action' in input) {
      const { canvasId, expectedVersion, action, ...fields } = input
      const op = action === 'update' || action === 'reconnect' ? 'edit' : action === 'delete' ? 'remove' : action
      input = { canvasId, expectedVersion, ops: [{ op, ...fields }] }
      if (action === 'delete') {
        const key = name === 'canvas_edges' ? 'edgeId' : 'nodeId', ids = name === 'canvas_edges' ? 'edgeIds' : 'nodeIds'
        input.ops[0][key] = fields[ids]?.[0]
        if (fields[ids]?.length !== 1) input.ops[0][ids] = fields[ids]
        else delete input.ops[0][ids]
      }
    }
    const result = JSON.parse(await definitions.get(name).execute(input, context))
    return result.status === 'saved' && result.completed?.length === 1 ? { ...result.completed[0].receipt, requestId: result.requestId, address: result.address }
      : result.failure && result.nextIndex === 0 ? { ...result.failure, requestId: result.requestId, address: result.address } : result
  } }
}

test('graph tools register save/read extensions and expose no generation or routing authority', () => {
  const f = fixture()
  assert.deepEqual([...f.definitions.keys()], ['canvas_create', 'canvas_get', 'canvas_node_edit', 'canvas_edges', 'canvas_models'])
  assert.equal(f.definitions.get('canvas_edges').parameters.properties.ops.items.oneOf.length, 4); assert.match(f.definitions.get('canvas_models').description, /默认父参数组合/); assert.match(f.definitions.get('canvas_models').description, /已有节点当前值/);
  assert.deepEqual(f.definitions.get('canvas_node_edit').parameters.properties.ops.items.oneOf.map(item => item.properties.op.const), ['add', 'edit', 'remove', 'configure'])
  for (const name of ['canvas_edges', 'canvas_models']) {
    const fields = f.definitions.get(name).parameters.properties
    for (const key of ['token', 'sessionId', 'requestId', 'run', 'url', 'graph']) assert(!Object.hasOwn(fields, key))
  }
})
test('graph reads preserve independent offsets, page version and explicit authority refresh', async () => {
  const f = fixture()
  const result = await f.run('canvas_get', { canvasId: id, view: 'graph', nodeOffset: 20, edgeOffset: 0, limit: 10, expectedVersion: '3', refresh: true })
  assert.equal(result.status, 'graph'); assert.equal(result.source, 'plugin-service')
  assert.equal(f.calls[0][3], 'read'); assert.equal(f.calls[0][6], true)
  assert.deepEqual(f.calls[1][3], { action: 'canvas.graph.read', nodeOffset: 20, edgeOffset: 0, limit: 10, expectedVersion: '3' })
  assert(!JSON.stringify(result).includes('private'))
})
test('model reads send selected mode/model and catalog-bound paging through read capability', async () => {
  const f = fixture()
  const result = await f.run('canvas_models', { canvasId: id, nodeType: 'image', modelType: 'image_to_image', model: 'legal', modeOffset: 0, modelOffset: 20, limit: 5, expectedCatalogVersion: 'catalog-1' })
  assert.equal(result.status, 'models'); assert.equal(result.source, 'plugin-service')
  assert.equal(f.calls[0][3], 'read')
  assert.deepEqual(f.calls[1][3], { action: 'canvas.models.read', nodeType: 'image', modelType: 'image_to_image', model: 'legal', modeOffset: 0, modelOffset: 20, limit: 5, expectedCatalogVersion: 'catalog-1' })
})
test('node update/delete/configure strictly dispatch to native methods and preserve edge IDs', async () => {
  const f = fixture()
  for (const [action, fields] of [
    ['update', { nodeId: 'n1', changes: { text: 'new copy' } }],
    ['delete', { nodeIds: ['n1'] }],
    ['configure', { nodeId: 'n2', configuration: { modelType: 'image_to_image', model: 'legal', params: { gen_count: 1, resolution: '1K' } } }],
  ]) {
    const result = await f.run('canvas_node_edit', { canvasId: id, expectedVersion: '3', action, ...fields }, exec(action))
    assert.equal(result.status, 'saved'); assert.deepEqual(result.affectedEdgeIds, ['edge']); assert.deepEqual(result.warnings, saved.warnings)
    assert.deepEqual(f.calls.at(-1)[3], { action: 'node.' + action, expectedVersion: '3', ...fields })
    assert.equal(f.calls.at(-2)[3], 'edit')
  }
})
test('edge add/delete/reconnect/reorder pass IDs and full input order without raw graph writes', async () => {
  const f = fixture(), connection = { sourceNodeId: 'n1', targetNodeId: 'n2', sourceHandle: 'image_source', targetHandle: 'image_target' }
  for (const [action, fields] of [
    ['add', { connection }], ['delete', { edgeIds: ['edge'] }], ['reconnect', { edgeId: 'edge', connection }], ['reorder', { targetNodeId: 'n2', edgeIds: ['edge2', 'edge1'] }],
  ]) {
    const result = await f.run('canvas_edges', { canvasId: id, expectedVersion: '3', action, ...fields }, exec(action))
    assert.equal(result.status, 'saved'); assert.deepEqual(result.affectedEdgeIds, ['edge'])
    assert.deepEqual(f.calls.at(-1)[3], { action: 'edge.' + action, expectedVersion: '3', ...fields })
  }
})
test('invalid branch fields, unsafe config, unversioned pages and forged routing stop before bridge', async () => {
  const f = fixture()
  for (const [name, input] of [
    ['canvas_get', { canvasId: id, view: 'graph', nodeIds: ['n'] }],
    ['canvas_get', { canvasId: id, view: 'nodes', nodeOffset: 0 }],
    ['canvas_get', { canvasId: id, view: 'graph', edgeOffset: 1 }],
    ['canvas_get', { canvasId: id, view: 'graph', limit: 21 }],
    ['canvas_models', { canvasId: id, nodeType: 'image', modelOffset: 1 }],
    ['canvas_models', { canvasId: id, nodeType: 'image', refresh: true }],
    ['canvas_edges', { canvasId: id, expectedVersion: '3', action: 'add', connection: { sourceNodeId: 'n1', targetNodeId: 'n2' }, edgeIds: ['edge'] }],
    ['canvas_edges', { canvasId: id, expectedVersion: '3', action: 'delete', edgeIds: ['edge', 'edge'] }],
    ['canvas_node_edit', { canvasId: id, expectedVersion: '3', action: 'update', nodeId: 'n1', changes: { title: 'ok' }, nodeIds: ['n1'] }],
    ['canvas_node_edit', { canvasId: id, expectedVersion: '3', action: 'configure', nodeId: 'n1', configuration: { params: { model: 'forged' } } }],
    ['canvas_node_edit', { canvasId: id, expectedVersion: '3', action: 'configure', nodeId: 'n1', configuration: { params: { cameraControl: {} } } }],
    ['canvas_models', { canvasId: id, nodeType: 'image', sessionId: 'other' }],
  ]) {
    let result
    try { result = await f.run(name, input) } catch (cause) { assert.equal(cause.code, 'INVALID_ARGS'); continue }
    assert.equal(result.status, 'rejected'); assert.equal(result.error.code, 'INVALID_ARGUMENT')
  }
  assert.equal(f.calls.length, 0)
})
test('read failures never claim unknown writes and writes after dispatch never leak provider errors', async () => {
  const f = fixture({ dispatch: async () => { throw new Error('private-token') } })
  for (const [name, args] of [['canvas_get', { canvasId: id, view: 'graph' }], ['canvas_models', { canvasId: id, nodeType: 'image' }]]) {
    const result = await f.run(name, args, exec(name)); assert.equal(result.status, 'rejected'); assert(!JSON.stringify(result).includes('private-token'))
  }
  const result = await f.run('canvas_edges', { canvasId: id, expectedVersion: '3', action: 'delete', edgeIds: ['edge'] }, exec('write'))
  assert.equal(result.status, 'submission_unknown'); assert.equal(result.error.retry, 'never_auto'); assert(!JSON.stringify(result).includes('private-token'))
})
test('known precondition rejection stays none and unknown edge receipts retain IDs without mutation', async () => {
  const none = fixture({ ensureContext: async () => { throw new CanvasAgentError('EDITOR_BUSY', 'editing') } })
  const args = { canvasId: id, expectedVersion: '3', action: 'delete', edgeIds: ['edge'] }
  assert.equal((await none.run('canvas_edges', args)).effect, 'none')
  const unknown = { status: 'submission_unknown', canvasId: id, version: null, phase: 'save', affectedNodeIds: ['n2'], affectedEdgeIds: ['edge'], error: { code: 'SUBMISSION_UNKNOWN', message: 'unknown', retry: 'read_first' } }
  const f = fixture({ dispatch: async () => unknown })
  const result = await f.run('canvas_edges', args)
  assert.deepEqual(result.affectedEdgeIds, ['edge']); assert.equal(result.error.retry, 'never_auto'); assert.equal(unknown.error.retry, 'read_first')
})

test('edge ops advance versions and stop after an uncertain submission', async () => {
  const operations = []
  const uncertain = { status: 'submission_unknown', canvasId: id, version: null, phase: 'save', affectedNodeIds: [], affectedEdgeIds: ['e2'], error: { code: 'SUBMISSION_UNKNOWN', message: 'unknown', retry: 'read_first' } }
  const f = fixture({ dispatch: async (_target, _request, operation) => {
    operations.push(operation)
    return operations.length === 2 ? uncertain : { ...saved, version: '4' }
  } })
  const result = await f.run('canvas_edges', { canvasId: id, expectedVersion: '3', ops: [
    { op: 'add', connection: { sourceNodeId: 'n1', targetNodeId: 'n2' } }, { op: 'remove', edgeId: 'e2' },
    { op: 'reorder', targetNodeId: 'n2', edgeIds: ['e3'] },
  ] })
  assert.equal(result.status, 'submission_unknown'); assert.equal(result.nextIndex, 1)
  assert.deepEqual(result.completed.map(item => item.receipt.version), ['4'])
  assert.deepEqual(operations.map(operation => operation.expectedVersion), ['3', '4'])
  assert.deepEqual(operations[1], { action: 'edge.delete', expectedVersion: '4', edgeIds: ['e2'] })
  assert.equal(result.failure.error.retry, 'never_auto')
})
test('edge batch refuses changed operation lists under the same call ID', async () => {
  const f = fixture()
  const first = { canvasId: id, expectedVersion: '3', ops: [{ op: 'remove', edgeId: 'e1' }] }
  const invoke = input => f.definitions.get('canvas_edges').execute(input, exec('same-edges')).then(JSON.parse)
  const receipt = await invoke(first)
  assert.equal(receipt.status, 'saved'); assert.deepEqual(await invoke(first), receipt)
  const changed = await invoke({ ...first, ops: [...first.ops, { op: 'remove', edgeId: 'e2' }] })
  assert.equal(changed.error.code, 'DUPLICATE_REQUEST_MISMATCH')
  assert.equal(f.calls.filter(call => call[0] === 'dispatch').length, 1)
})
