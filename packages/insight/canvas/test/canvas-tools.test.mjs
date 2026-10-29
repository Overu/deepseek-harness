import assert from 'node:assert/strict'
import test from 'node:test'
import { registerCanvasTools } from '../src/host/canvas-tools.ts'
import { CanvasAgentError } from '../src/shared/canvas-agent-protocol.ts'
import { CanvasApiError } from '../src/host/canvas-api.ts'

const id = '103136'
const read = { status: 'read', canvasId: id, version: '18', consistency: 'confirmed', nodeCount: 0, nodes: [], missingNodeIds: [] }
const saved = { status: 'saved', canvasId: id, version: '19', affectedNodeIds: ['node-1'], unchanged: false }
const summary = { canvasId: id, name: '测试', nodeCount: 0, nodes: [] }
const exec = (callId = 'call-1', sessionId = 'session') => ({ callId, agent: { id: sessionId }, signal: new AbortController().signal })
const add = { canvasId: id, expectedVersion: '18', action: 'add', node: { type: 'text', changes: { title: '测试文本', text: 'hello' } } }
function fixture(overrides = {}) {
  const definitions = new Map(), calls = [], cleanups = []
  const ctx = { tools: { register: definition => { assert(!definitions.has(definition.name)); definitions.set(definition.name, definition); return () => definitions.delete(definition.name) } }, effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) } }
  const bridge = {
    ensureContext: async (...args) => { calls.push(['prepare', ...args]); return { connectionId: 'private-connection', sessionId: args[0], canvasId: args[1], contextId: 'private-context', readiness: { phase: 'ready', capabilities: { read: true, edit: true, run: true }, version: '18' } } },
    dispatch: async (...args) => { calls.push(['dispatch', ...args]); return args[2].action === 'canvas.read' ? read : saved },
    dispose() {}, ...overrides.bridge,
  }
  const dependencies = {
    createCanvas: async (...args) => { calls.push(['create', ...args]); return { canvasId: id, name: args[0], version: null } },
    getCanvas: async (...args) => { calls.push(['summary', ...args]); return summary },
    ...overrides.dependencies,
  }
  registerCanvasTools(ctx, bridge, dependencies)
  return { calls, definitions, cleanups, async run(name, args, context = exec()) {
    let input = args
    if (name === 'canvas_node_edit' && 'action' in args) {
      const { canvasId, expectedVersion, action, ...fields } = args
      const op = action === 'update' ? 'edit' : action === 'delete' ? 'remove' : action
      input = { canvasId, expectedVersion, ops: [{ op, ...fields, ...(action === 'delete' ? { nodeId: fields.nodeIds?.[0] } : {}) }] }
      if (action === 'delete') delete input.ops[0].nodeIds
    }
    const result = JSON.parse(await definitions.get(name).execute(input, context))
    return name === 'canvas_node_edit' && result.status === 'saved' && result.completed?.length === 1 ? { ...result.completed[0].receipt, requestId: result.requestId, address: result.address }
      : name === 'canvas_node_edit' && result.failure && result.nextIndex === 0 ? { ...result.failure, requestId: result.requestId, address: result.address } : result
  } }
}
test('registers exactly three tools and retains legacy summary shape without Agent or Client', async () => {
  const f = fixture(); assert.deepEqual([...f.definitions.keys()], ['canvas_create', 'canvas_get', 'canvas_node_edit'])
  const value = await f.run('canvas_get', { canvasId: id }, { ...exec(), agent: undefined })
  assert.deepEqual(value, { ...summary, address: 'dsh-resource://canvas/103136' })
  assert.deepEqual(f.calls.map(call => call[0]), ['summary'])
  assert.deepEqual(f.definitions.get('canvas_get').output.render({ canvasId: id }, JSON.stringify(value)), [{ type: 'text', text: JSON.stringify(value) }])
})
test('create defaults name, prepares service and returns exact ID/version without opening any UI', async () => {
  const f = fixture(); const result = await f.run('canvas_create', {})
  assert.equal(result.status, 'created'); assert.equal(result.name, '新画布'); assert.equal(result.version, '18'); assert.equal(result.runtime, 'ready')
  assert.equal(result.address, 'dsh-resource://canvas/103136'); assert.deepEqual(f.calls.map(c => c[0]), ['create', 'prepare'])
  assert.equal(f.calls[1][1], 'session'); assert.equal(f.calls[1][3], 'read')
  assert(!JSON.stringify(result).includes('private-'))
})
test('successful creation survives service preparation failure without creating again', async () => {
  const f = fixture({ bridge: { ensureContext: async () => { throw new CanvasAgentError('CLIENT_UNAVAILABLE', '会话Client未连接') } } })
  const result = await f.run('canvas_create', { name: '作品' })
  assert.equal(result.status, 'created'); assert.equal(result.canvasId, id); assert.equal(result.runtime, 'not_ready')
  assert.equal(result.runtimeError.code, 'CLIENT_UNAVAILABLE')
  assert.deepEqual(await f.run('canvas_create', { name: '作品' }), result); assert.equal(f.calls.length, 1)
})
test('same create call is deduplicated concurrently, changed contents rejected, separate sessions isolated', async () => {
  const f = fixture(); const [a, b] = await Promise.all([f.run('canvas_create', { name: '作品' }), f.run('canvas_create', { name: ' 作品 ' })])
  assert.deepEqual(a, b); assert.equal(f.calls.filter(c => c[0] === 'create').length, 1)
  assert.equal((await f.run('canvas_create', { name: '另一个' })).error.code, 'DUPLICATE_REQUEST_MISMATCH')
  await f.run('canvas_create', { name: '作品' }, exec('call-1', 'other-session'))
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 2)
})
test('create_unknown is cached and never retried; generic failures cannot leak credential text', async () => {
  let count = 0
  const f = fixture({ dependencies: { createCanvas: async () => { count++; throw new CanvasApiError('SUBMISSION_UNKNOWN', '创建结果未确认', 'submission_unknown') } } })
  const a = await f.run('canvas_create', {}); assert.equal(a.status, 'create_unknown'); assert.equal(a.error.retry, 'never_auto')
  assert.deepEqual(await f.run('canvas_create', {}), a); assert.equal(count, 1)
  const bad = fixture({ bridge: { ensureContext: async () => { throw new Error('private-token') } } })
  const result = await bad.run('canvas_create', {})
  assert.equal(result.status, 'created'); assert(!JSON.stringify(result).includes('private-token'))
})
test('nodes read can obtain an empty graph/version, select IDs, and request explicit backend refresh', async () => {
  const f = fixture(); const result = await f.run('canvas_get', { canvasId: id, view: 'nodes', refresh: true })
  assert.equal(result.status, 'read'); assert.equal(result.source, 'plugin-service'); assert.equal(result.version, '18')
  assert.equal(f.calls[0][6], true); assert.deepEqual(f.calls[1][3], { action: 'canvas.read' })
  await f.run('canvas_get', { canvasId: id, view: 'nodes', nodeIds: ['node-1', 'node-1'] }, exec('call-2'))
  assert.deepEqual(f.calls[3][3], { action: 'canvas.read', nodeIds: ['node-1'] })
})
test('add preserves expected version, exact native receipts, cancellation and distinct step IDs', async () => {
  const f = fixture(); const context = exec(); const result = await f.run('canvas_node_edit', add, context)
  assert.equal(result.status, 'saved'); assert.equal(result.version, '19'); assert.deepEqual(result.affectedNodeIds, ['node-1'])
  assert.deepEqual(f.calls[1][3], { action: 'node.add', expectedVersion: '18', node: add.node })
  assert.equal(f.calls[0][5], context.signal); assert.equal(f.calls[1][4], context.signal)
  assert.notEqual(f.calls[0][4], f.calls[1][2]); assert.equal(f.calls[0][3], 'edit')
  const unknown = { status: 'submission_unknown', canvasId: id, version: null, phase: 'save', affectedNodeIds: [], error: { code: 'SUBMISSION_UNKNOWN', message: '确认保存结果', retry: 'read_first' } }
  const u = fixture({ bridge: { dispatch: async () => unknown } })
  const uncertain = await u.run('canvas_node_edit', add); assert.equal(uncertain.status, 'submission_unknown'); assert.equal(uncertain.error.retry, 'never_auto'); assert.equal(unknown.error.retry, 'read_first')
  const rejected = { status: 'rejected', canvasId: id, version: '20', effect: 'none', error: { code: 'VERSION_CONFLICT', message: '先读取版本', retry: 'read_first' } }
  const r = fixture({ bridge: { dispatch: async () => rejected } })
  assert.deepEqual(await r.run('canvas_node_edit', add), { ...rejected, requestId: result.requestId, address: result.address })
})
test('strict extra-field and native draft validation stop invalid input before API/bridge', async () => {
  const f = fixture()
  for (const [name, args] of [
    ['canvas_create', { name: ' ', canvasId: id }], ['canvas_create', { name: 'a'.repeat(101) }],
    ['canvas_get', { canvasId: id, nodeIds: ['n'] }], ['canvas_get', { canvasId: id, refresh: false }],
    ['canvas_get', { canvasId: '0' }], ['canvas_get', { canvasId: id, view: 'nodes', nodeIds: [] }],
    ['canvas_node_edit', { ...add, nodeId: 'other' }],
    ['canvas_node_edit', { ...add, expectedVersion: '' }],
    ['canvas_node_edit', { ...add, node: { type: 'image', changes: { params: { model: 'made-up' } } } }],
  ]) {
    let result
    try { result = await f.run(name, args) } catch (cause) { assert.equal(cause.code, 'INVALID_ARGS'); continue }
    assert.equal(result.status, 'rejected'); assert.equal(result.effect, 'none'); assert.equal(result.error.code, 'INVALID_ARGUMENT')
  }
  assert.equal(f.calls.length, 0)
})
test('writes and detail reads require Agent context and stop on pre-dispatch cancellation', async () => {
  const f = fixture()
  for (const [name, args] of [['canvas_create', {}], ['canvas_get', { canvasId: id, view: 'nodes' }], ['canvas_node_edit', add]]) {
    assert.equal((await f.run(name, args, { ...exec(), agent: undefined })).error.code, 'AGENT_CONTEXT_REQUIRED')
  }
  const c = new AbortController(); c.abort()
  assert.equal((await f.run('canvas_create', {}, { ...exec(), signal: c.signal })).error.code, 'CANCELLED_BEFORE_DISPATCH')
  assert.equal(f.calls.length, 0)
})
test('unexpected errors after attempting a write are unknown rather than claiming no effect', async () => {
  const f = fixture({ bridge: { dispatch: async () => { throw new Error('private-token') } } })
  const result = await f.run('canvas_node_edit', add)
  assert.equal(result.status, 'submission_unknown'); assert.equal(result.error.retry, 'never_auto')
  assert(!JSON.stringify(result).includes('private-token'))
})
test('create request cache has bounded concurrency and never evicts past writes to accept a new one', async () => {
  let release
  const blocked = new Promise(resolve => { release = resolve })
  let count = 0
  const f = fixture({ dependencies: { createCanvas: async () => { count++; await blocked; throw new CanvasApiError('SUBMISSION_UNKNOWN', '结果未知', 'submission_unknown') } } })
  const waiting = Array.from({ length: 8 }, (_, index) => f.run('canvas_create', {}, exec('parallel-' + index)))
  assert.equal((await f.run('canvas_create', {}, exec('overflow'))).error.code, 'BRIDGE_OVERLOADED')
  assert.equal(count, 8); release(); await Promise.all(waiting)
  for (let index = 8; index < 1024; index++) await f.run('canvas_create', {}, exec('parallel-' + index))
  assert.equal((await f.run('canvas_create', {}, exec('full'))).error.code, 'BRIDGE_OVERLOADED')
  assert.equal((await f.run('canvas_create', {}, exec('parallel-0'))).status, 'create_unknown')
  assert.equal(count, 1024)
})


test('node tool exposes only placement and preserves each mode in the native command', async () => {
  const f = fixture(); const nodeSchema = f.definitions.get('canvas_node_edit').parameters.properties.ops.items.oneOf[0].properties.node.properties;
  assert(!('position' in nodeSchema)); assert.equal(nodeSchema.placement.oneOf.length, 3);
  for (const placement of [{ mode: 'auto' }, { mode: 'absolute', position: { x: 0, y: 0 } }, { mode: 'after', anchorNodeId: 'anchor' }]) {
    const node = { ...add.node, placement };
    assert.equal((await f.run('canvas_node_edit', { ...add, node }, exec('placement-' + placement.mode))).status, 'saved');
    assert.deepEqual(f.calls.at(-1)[3].node, node);
  }
});

test('node model entry rejects obsolete raw position before preparing or dispatching', async () => {
  const f = fixture();
  for (const node of [{ ...add.node, position: { x: 0, y: 0 } }, { ...add.node, placement: { mode: 'auto' }, position: { x: 0, y: 0 } }]) {
    const result = await f.run('canvas_node_edit', { ...add, node }).catch(cause => { assert.equal(cause.code, 'INVALID_ARGS'); return { error: { code: 'INVALID_ARGUMENT' } }; });
    assert.equal(result.error.code, 'INVALID_ARGUMENT');
  }
  assert.equal(f.calls.length, 0);
});


test('atomic read/edit contracts retain confirmed reads and keep workflow policy in the guidance center', async () => {
  const f = fixture();
  const get = f.definitions.get('canvas_get');
  const edit = f.definitions.get('canvas_node_edit');
  assert.match(get.description, /refresh:false为普通读取/);
  assert.match(get.parameters.properties.refresh.description, /可见画布重载/);
  assert.equal(edit.parameters.properties.ops.items.oneOf.length, 4);
  assert.match(edit.description, /失败或提交结果未知立即停止/);
  assert(!edit.description.includes('用户要求失败停止'));
  const { readFile } = await import('node:fs/promises');
  const guide = await readFile(new URL('../guidance/desktop-canvas-workflow/references/interaction-and-output.md', import.meta.url), 'utf8');
  assert.match(guide, /用户要求失败即停.*rejected.*停止/);
  const read = await f.run('canvas_get', { canvasId: id, view: 'nodes' });
  assert.equal(read.consistency, 'confirmed');
  assert.equal((await f.run('canvas_node_edit', { ...add, expectedVersion: read.version }, exec('normal-edit'))).status, 'saved');
  assert(f.calls.filter(call => call[0] === 'prepare').every(call => !call[6]));
});

test('node ops advance versions and stop with confirmed partial results', async () => {
  let writes = 0; const operations = []
  const f = fixture({ bridge: { dispatch: async (_target, _request, operation) => {
    operations.push(operation)
    writes++
    if (writes === 3) return { status: 'rejected', canvasId: id, version: '20', effect: 'none', error: { code: 'VERSION_CONFLICT', message: 'changed', retry: 'read_first' } }
    return { ...saved, version: String(18 + writes), affectedNodeIds: [`n${writes}`] }
  } } })
  const result = await f.run('canvas_node_edit', { canvasId: id, expectedVersion: '18', ops: [
    { op: 'add', node: { type: 'text' } }, { op: 'edit', nodeId: 'n1', changes: { text: 'updated' } }, { op: 'remove', nodeId: 'n2' },
  ] })
  assert.equal(result.status, 'partial'); assert.equal(result.nextIndex, 2); assert.equal(result.version, '20')
  assert.deepEqual(result.completed.map(item => item.receipt.version), ['19', '20'])
  assert.deepEqual(operations.map(operation => operation.expectedVersion), ['18', '19', '20'])
  assert.deepEqual(operations.at(-1), { action: 'node.delete', expectedVersion: '20', nodeIds: ['n2'] })
})
test('node batch replays the original receipt and refuses appended or truncated operations', async () => {
  const f = fixture()
  const first = { canvasId: id, expectedVersion: '18', ops: [{ op: 'add', node: { type: 'text' } }, { op: 'remove', nodeId: 'n1' }] }
  const invoke = input => f.definitions.get('canvas_node_edit').execute(input, exec('same-batch')).then(JSON.parse)
  const receipt = await invoke(first)
  assert.equal(receipt.status, 'saved'); assert.deepEqual(await invoke(first), receipt)
  for (const ops of [first.ops.slice(0, 1), [...first.ops, { op: 'remove', nodeId: 'n2' }], [...first.ops].reverse()]) {
    const changed = await invoke({ ...first, ops })
    assert.equal(changed.error.code, 'DUPLICATE_REQUEST_MISMATCH')
  }
  assert.equal(f.calls.filter(call => call[0] === 'dispatch').length, 2)
})
