import assert from 'node:assert/strict'
import test from 'node:test'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createCanvasClientBridge } from '../src/client/canvas-bridge.ts'
import { createCanvasHostBridge } from '../src/host/canvas-bridge.ts'
import { bridgeHandler } from '../src/host/bridge-route.ts'
import { consumeSse } from '../src/client/sse.ts'
const waitUntil = async check => { const until = Date.now() + 2000; while (!check()) { if (Date.now() >= until) throw new Error('fixture wait timed out'); await new Promise(resolve => setTimeout(resolve, 5)) } }
test('SSE parses UTF8/CRLF/multiple data across chunks, discards incomplete events and rejects oversized input', async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\ndata: {\r\ndata: "text":"中文"}\r\n\r\ndata: {"incomplete":true}')
  const received = []
  await consumeSse(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close() } }), value => received.push(value))
  assert.deepEqual(received, [{ text: '中文' }])
  await assert.rejects(consumeSse(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: ' + 'x'.repeat(2 * 1024 * 1024 + 200))); controller.close() } }), () => {}), { code: 'BRIDGE_OVERLOADED' })
})
test('Client real SSE/POST binds session without canvas, executes once, and preserves accepted write across reconnect', async t => {
  const host = createCanvasHostBridge(); const server = createServer(bridgeHandler({ requestRejection: () => undefined }, host))
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = 'http://127.0.0.1:' + server.address().port
  let bound = false, calls = 0, releaseWrite, gets = 0
  const receipt = new Promise(resolve => { releaseWrite = resolve })
  const state = { phase: 'ready', capabilities: { read: true, edit: true, run: false }, version: '18' }
  const runtime = { ensureContext: async () => ({ canvasId: '2873', contextId: 'ctx', readiness: state }), getContextInfo: () => ({ contextId: 'ctx', readiness: state }), subscribeReadiness: (_id, listener) => { listener(state); return () => {} }, execute: async () => { calls++; return receipt } }
  const transport = async (input, init) => { if (String(input).endsWith('/events')) gets++; const response = await fetch(input, init); if (String(input).endsWith('/client-event') && JSON.parse(init.body).type === 'session.sync' && response.ok) bound = JSON.parse(init.body).sessionIds.includes('session'); return response }
  const client = createCanvasClientBridge({ origin, getRuntime: async () => runtime, transport, reconnectMs: 10 })
  t.after(() => { client.dispose(); host.dispose(); server.closeAllConnections(); server.close() })
  const unbind = client.retainSession('session'); await waitUntil(() => bound)
  const target = await host.ensureContext('session', '2873', 'edit', 'prepare')
  const operation = { action: 'node.add', expectedVersion: '18', node: { type: 'text', changes: { text: 'saved' } } }
  const waiting = host.dispatch(target, 'write', operation); await waitUntil(() => calls === 1)
  server.closeAllConnections(); assert.equal((await waiting).status, 'submission_unknown')
  releaseWrite({ status: 'saved', canvasId: '2873', version: '19', affectedNodeIds: ['node'], unchanged: false })
  await waitUntil(() => gets >= 2)
  let result; await waitUntil(() => { void host.dispatch(target, 'write', operation).then(value => { result = value }); return result?.status === 'saved' })
  assert.equal(calls, 1)
  unbind(); await waitUntil(() => !bound)
  await assert.rejects(host.ensureContext('session','2873','edit','unbound'),{code:'CLIENT_UNAVAILABLE'})
})

test('real SSE/POST keeps canvas_get available after the UI switches away until the owning Agent is idle', async t => {
  let active = true
  const host = createCanvasHostBridge({ isSessionActive: () => active })
  const server = createServer(bridgeHandler({ requestRejection: () => undefined }, host))
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = 'http://127.0.0.1:' + server.address().port
  const ready = { phase: 'ready', capabilities: { read: true, edit: true, run: false }, version: '18' }
  let desired = false, reads = 0, stopped = 0
  const runtime = { ensureContext: async () => ({ canvasId: '2873', contextId: 'ctx', readiness: ready }),
    getContextInfo: () => ({ contextId: 'ctx', readiness: ready }),
    subscribeReadiness: (_id, listener) => { listener(ready); return () => { stopped++ } },
    execute: async input => { assert.equal(input.operation.action, 'canvas.read'); reads++; return { status: 'read',
      canvasId: '2873', version: '18', consistency: 'confirmed', nodeCount: 0, nodes: [], missingNodeIds: [] } } }
  const transport = async (input, init) => { const response = await fetch(input, init)
    if (String(input).endsWith('/client-event')) { const event = JSON.parse(init.body)
      if (event.type === 'session.sync' && response.ok) desired = event.sessionIds.includes('session') }
    return response }
  const client = createCanvasClientBridge({ origin, getRuntime: async () => runtime, transport, reconnectMs: 10 })
  t.after(() => { client.dispose(); host.dispose(); server.closeAllConnections(); server.close() })
  const unbind = client.retainSession('session'); await waitUntil(() => desired)
  await host.ensureContext('session', '2873', 'read', 'initial')
  unbind(); await waitUntil(() => !desired)
  const target = await host.ensureContext('session', '2873', 'read', 'next-step')
  assert.equal((await host.dispatch(target, 'canvas-get', { action: 'canvas.read' })).status, 'read')
  assert.equal(reads, 1); assert.equal(stopped, 1)
  active = false; host.reconsiderSession('session')
  await assert.rejects(host.ensureContext('session', '2873', 'read', 'after-idle'), { code: 'CLIENT_UNAVAILABLE' })
  await waitUntil(() => stopped === 2)
})

test('oversized comment-only SSE events are bounded and malformed UTF8 never reaches a command handler', async () => {
  for(const bytes of [new TextEncoder().encode(':'+'x'.repeat(2*1024*1024+200)+'\n\n'),Uint8Array.of(0xff,0xfe)]) {
    let calls=0
    await assert.rejects(consumeSse(new ReadableStream({start(controller){controller.enqueue(bytes);controller.close()}}),()=>calls++))
    assert.equal(calls,0)
  }
})

test('release before the first binding snapshot and stale later snapshots cannot revoke a reacquired Session', async t => {
  const connectionId = 'connection', posted = []
  let stream, calls = 0, stopped = 0, overloaded = false
  const ready = { phase: 'ready', capabilities: { read: true, edit: true, run: false }, version: '18' }
  const runtime = { ensureContext: async () => { calls++; return { canvasId: '2873', contextId: 'ctx', readiness: ready } },
    getContextInfo: () => ({ contextId: 'ctx', readiness: ready }),
    subscribeReadiness: (_id, listener) => { listener(ready); return () => { stopped++ } },
    execute: async () => { throw new Error('unexpected execution') } }
  const transport = async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/attach')) return Response.json({ protocolVersion: 4, clientId: 'client', connectionId,
      bridgeKey: 'a'.repeat(43), ownershipProtocol: 'web-locks-v1', sessionBindingProtocol: 'host-session-v1' })
    if (path.endsWith('/events')) return new Response(new ReadableStream({ start(controller) {
      stream = controller
      init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true })
    } }), { headers: { 'content-type': 'text/event-stream' } })
    if (path.endsWith('/client-event')) { const event = JSON.parse(init.body); posted.push(event)
      if (event.type === 'session.sync' && event.revision === 3 && !overloaded) {
        overloaded = true; return Response.json({ code: 'BRIDGE_OVERLOADED' }, { status: 413 })
      } }
    return Response.json({ ok: true })
  }
  const client = createCanvasClientBridge({ origin: 'https://shell.test', getRuntime: async () => runtime,
    transport, reconnectMs: 5 })
  t.after(() => client.dispose())
  const firstRelease = client.retainSession('session')
  await waitUntil(() => stream !== undefined)
  firstRelease()
  const secondRelease = client.retainSession('session')
  const emit = event => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
  emit({ type: 'bridge.connected', protocolVersion: 4, connectionId })
  await waitUntil(() => posted.filter(event => event.type === 'session.sync' && event.revision === 3 &&
    event.sessionIds[0] === 'session').length === 2)
  emit({ type: 'session.bound', protocolVersion: 4, connectionId, revision: 1, sessionIds: ['session'] })
  emit({ type: 'session.bound', protocolVersion: 4, connectionId, revision: 0, sessionIds: [] })
  emit({ type: 'canvas.prepare', protocolVersion: 4, connectionId, sessionId: 'session', canvasId: '2873',
    requestId: 'reacquired', deadline: Date.now() + 10_000, capability: 'read' })
  await waitUntil(() => calls === 1 && posted.some(event => event.type === 'canvas.prepare.ack' &&
    event.requestId === 'reacquired' && event.status === 'prepared'))
  secondRelease()
  emit({ type: 'session.bound', protocolVersion: 4, connectionId, revision: 2, sessionIds: [] })
  emit({ type: 'session.bound', protocolVersion: 4, connectionId, revision: 1, sessionIds: ['session'] })
  await waitUntil(() => stopped === 1)
  emit({ type: 'canvas.prepare', protocolVersion: 4, connectionId, sessionId: 'session', canvasId: '2873',
    requestId: 'released', deadline: Date.now() + 10_000, capability: 'read' })
  await waitUntil(() => posted.some(event => event.type === 'canvas.prepare.ack' && event.requestId === 'released'))
  assert.equal(calls, 1)
  assert.equal(posted.find(event => event.type === 'canvas.prepare.ack' && event.requestId === 'released').status, 'rejected')
})

test('a terminal run receipt bypasses an overloaded Session sync and lets that revision retry', async t => {
  const connectionId = 'connection', posted = []
  const ready = { phase: 'ready', capabilities: { read: true, edit: true, run: true }, version: '18' }
  let stream, runListener, terminalDelivered = false, blockedSyncs = 0, successfulSyncs = 0
  const runtime = { ensureContext: async () => ({ canvasId: '2873', contextId: 'ctx', readiness: ready }),
    getContextInfo: () => ({ contextId: 'ctx', readiness: ready }),
    subscribeReadiness: (_id, listener) => { listener(ready); return () => {} },
    subscribeRun: (_input, listener) => { runListener = listener; return () => {} },
    execute: async () => ({ status: 'submitted', canvasId: '2873', version: '19', nodeId: 'image',
      taskId: 'workflow', generation: { images: 1, videos: 0 } }) }
  const transport = async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/attach')) return Response.json({ protocolVersion: 4, clientId: 'client', connectionId,
      bridgeKey: 'a'.repeat(43), ownershipProtocol: 'web-locks-v1', sessionBindingProtocol: 'host-session-v1' })
    if (path.endsWith('/events')) return new Response(new ReadableStream({ start(controller) {
      stream = controller
      init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true })
    } }), { headers: { 'content-type': 'text/event-stream' } })
    if (path.endsWith('/client-event')) { const event = JSON.parse(init.body); posted.push(event)
      if (event.type === 'session.sync' && event.revision === 3) {
        if (!terminalDelivered) { blockedSyncs++; return Response.json({ code: 'BRIDGE_OVERLOADED' }, { status: 413 }) }
        successfulSyncs++
      }
      if (event.type === 'canvas.run.state') terminalDelivered = true
    }
    return Response.json({ ok: true })
  }
  const client = createCanvasClientBridge({ origin: 'https://shell.test', getRuntime: async () => runtime,
    transport, reconnectMs: 5 })
  t.after(() => client.dispose())
  const release = client.retainSession('old')
  await waitUntil(() => stream !== undefined)
  const emit = event => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
  emit({ type: 'bridge.connected', protocolVersion: 4, connectionId })
  await waitUntil(() => posted.some(event => event.type === 'session.sync' && event.revision === 1))
  emit({ type: 'session.bound', protocolVersion: 4, connectionId, revision: 1, sessionIds: ['old'] })
  emit({ type: 'canvas.prepare', protocolVersion: 4, connectionId, sessionId: 'old', canvasId: '2873',
    requestId: 'prepare', deadline: Date.now() + 10_000, capability: 'run' })
  await waitUntil(() => posted.some(event => event.type === 'canvas.prepare.ack' && event.status === 'prepared'))
  emit({ type: 'canvas.command', protocolVersion: 4, connectionId, sessionId: 'old', canvasId: '2873',
    contextId: 'ctx', requestId: 'run', deadline: Date.now() + 10_000,
    payload: { action: 'node.run', expectedVersion: '18', nodeId: 'image',
      approvedGeneration: { images: 1, videos: 0 } } })
  await waitUntil(() => runListener !== undefined && posted.some(event => event.type === 'canvas.command.ack' &&
    event.requestId === 'run' && event.phase === 'settled'))
  release(); client.retainSession('new')
  await waitUntil(() => blockedSyncs === 1)
  runListener({ requestId: 'run', canvasId: '2873', nodeId: 'image', sequence: 1, phase: 'completed', version: '20',
    workflowTaskId: 'workflow', nodeTaskId: 'node-task', generation: { images: 1, videos: 0 },
    outputs: ['https://assets.example/new.png'] })
  await waitUntil(() => terminalDelivered && successfulSyncs === 1)
  assert.equal(blockedSyncs, 2)
})

test('real SSE/POST keeps a switched-away pending run available, then releases it after its terminal receipt', async t => {
  const host = createCanvasHostBridge(); const server = createServer(bridgeHandler({ requestRejection: () => undefined }, host))
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = 'http://127.0.0.1:' + server.address().port
  const ready = { phase: 'ready', capabilities: { read: true, edit: true, run: true }, version: '18' }
  let bound = false, listener, calls = 0, releaseRun; const submitted = new Promise(resolve => { releaseRun = resolve })
  const runtime = { ensureContext: async () => ({ canvasId: '2873', contextId: 'ctx', readiness: ready }), getContextInfo: () => ({ contextId: 'ctx', readiness: ready }), subscribeReadiness: (_id, callback) => { callback(ready); return () => {} }, subscribeRun: (_input, callback) => { listener = callback; return () => {} }, execute: async input => { assert.equal(input.requestId, 'run'); calls++; return submitted } }
  const transport = async (input, init) => { const response = await fetch(input, init); if (String(input).endsWith('/client-event') && JSON.parse(init.body).type === 'session.sync' && response.ok) bound = JSON.parse(init.body).sessionIds.includes('session'); return response }
  const client = createCanvasClientBridge({ origin, getRuntime: async () => runtime, transport, reconnectMs: 10 })
  t.after(() => { client.dispose(); host.dispose(); server.closeAllConnections(); server.close() })
  const unbind = client.retainSession('session'); await waitUntil(() => bound)
  const target = await host.ensureContext('session', '2873', 'run', 'prepare-run'); const updates = []
  t.after(host.subscribeRun(target, 'run', value => updates.push(value)))
  const waiting = host.dispatch(target, 'run', { action: 'node.run', expectedVersion: '18', nodeId: 'image', approvedGeneration: { images: 1, videos: 0 } })
  await waitUntil(() => calls === 1); unbind(); await waitUntil(() => bound)
  await host.ensureContext('session', '2873', 'read', 'read-after-switch')
  listener({ requestId: 'run', canvasId: '2873', nodeId: 'image', sequence: 2, phase: 'completed', version: '20', workflowTaskId: 'workflow', nodeTaskId: 'different-node-task', generation: { images: 1, videos: 0 }, outputs: ['https://assets.example/new.png'] })
  releaseRun({ status: 'submitted', canvasId: '2873', version: '19', nodeId: 'image', taskId: 'workflow', generation: { images: 1, videos: 0 } })
  assert.equal((await waiting).status, 'submitted'); await waitUntil(() => updates.length === 1)
  await waitUntil(() => !bound)
  await assert.rejects(host.ensureContext('session', '2873', 'read', 'released'), { code: 'CLIENT_UNAVAILABLE' })
  assert.equal(updates[0].phase, 'completed'); assert.equal(updates[0].outputs[0], 'https://assets.example/new.png'); assert.equal(calls, 1)
})

test('terminal receipt POST retries after 503 without another task event or SSE reconnect, and never repeats run', async t => {
  const host = createCanvasHostBridge(); const server = createServer(bridgeHandler({ requestRejection: () => undefined }, host))
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = 'http://127.0.0.1:' + server.address().port
  const ready = { phase: 'ready', capabilities: { read: true, edit: true, run: true }, version: '18' }
  let bound = false, listener, invokes = 0, terminalPosts = 0, streams = 0
  const runtime = { ensureContext: async () => ({ canvasId: '2873', contextId: 'ctx', readiness: ready }), getContextInfo: () => ({ contextId: 'ctx', readiness: ready }), subscribeReadiness: (_id, callback) => { callback(ready); return () => {} }, subscribeRun: (_input, callback) => { listener = callback; return () => {} }, execute: async () => { invokes++; return { status: 'submitted', canvasId: '2873', version: '19', nodeId: 'image', taskId: 'workflow', generation: { images: 1, videos: 0 } } } }
  const transport = async (input, init) => {
    if (String(input).endsWith('/events')) streams++
    const event = String(input).endsWith('/client-event') ? JSON.parse(init.body) : null
    if (event?.type === 'canvas.run.state' && ++terminalPosts === 1) return new Response('{}', { status: 503 })
    const response = await fetch(input, init)
    if (event?.type === 'session.sync' && response.ok) bound = event.sessionIds.includes('session')
    return response
  }
  const client = createCanvasClientBridge({ origin, getRuntime: async () => runtime, transport, reconnectMs: 10 })
  t.after(() => { client.dispose(); host.dispose(); server.closeAllConnections(); server.close() })
  client.retainSession('session'); await waitUntil(() => bound)
  const target = await host.ensureContext('session', '2873', 'run', 'prepare-run'); const heard = []
  t.after(host.subscribeRun(target, 'run', value => heard.push(value)))
  assert.equal((await host.dispatch(target, 'run', { action: 'node.run', expectedVersion: '18', nodeId: 'image', approvedGeneration: { images: 1, videos: 0 } })).status, 'submitted')
  listener({ requestId: 'run', canvasId: '2873', nodeId: 'image', sequence: 1, phase: 'completed', version: '20', workflowTaskId: 'workflow', nodeTaskId: 'node-task', generation: { images: 1, videos: 0 }, outputs: ['https://assets.example/new.png'] })
  await waitUntil(() => heard.length === 1)
  assert.equal(terminalPosts, 2); assert.equal(invokes, 1); assert.equal(streams, 1)
})

test('eight disposed run contexts release both bridge reservations; a ninth canvas runs and unknown remains accurate', async t => {
  const host = createCanvasHostBridge(); const server = createServer(bridgeHandler({ requestRejection: () => undefined }, host))
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = 'http://127.0.0.1:' + server.address().port
  const ready = { phase: 'ready', capabilities: { read: true, edit: true, run: true }, version: '18' }
  const listeners = new Map(), seen = []; let bound = false, invokes = 0, stoppedObservers = 0
  const runtime = {
    ensureContext: async input => ({ canvasId: input.canvasId, contextId: 'ctx-' + input.canvasId, readiness: ready }),
    getContextInfo: canvasId => ({ contextId: 'ctx-' + canvasId, readiness: ready }),
    subscribeReadiness: (_id, callback) => { callback(ready); return () => {} },
    subscribeRun: (input, callback) => { listeners.set(input.requestId, callback); return () => { stoppedObservers++; listeners.delete(input.requestId) } },
    execute: async input => { invokes++; return { status: 'submitted', canvasId: input.canvasId, version: '19', nodeId: 'image', taskId: 'workflow-' + input.requestId, generation: { images: 1, videos: 0 } } }
  }
  const transport = async (input, init) => { const response = await fetch(input, init); if (String(input).endsWith('/client-event') && JSON.parse(init.body).type === 'session.sync' && response.ok) bound = JSON.parse(init.body).sessionIds.includes('session'); return response }
  const client = createCanvasClientBridge({ origin, getRuntime: async () => runtime, transport, reconnectMs: 10 })
  t.after(() => { client.dispose(); host.dispose(); server.closeAllConnections(); server.close() })
  client.retainSession('session'); await waitUntil(() => bound)
  for (let i = 0; i < 9; i++) {
    const canvasId = String(3100 + i), requestId = 'disposed-' + i
    const target = await host.ensureContext('session', canvasId, 'run', 'prepare-' + i)
    t.after(host.subscribeRun(target, requestId, state => seen.push(state)))
    assert.equal((await host.dispatch(target, requestId, { action: 'node.run', expectedVersion: '18', nodeId: 'image', approvedGeneration: { images: 1, videos: 0 } })).status, 'submitted')
    if (i === 8) break
    listeners.get(requestId)({ requestId, canvasId, nodeId: 'image', sequence: 1, phase: 'monitoring_unknown', version: '19', generation: { images: 1, videos: 0 }, outputs: [], error: { code: 'CONTEXT_GONE', message: '本地上下文已释放，后台结果未确认', retry: 'never_auto' } })
    await waitUntil(() => seen.length === i + 1)
  }
  assert.equal(invokes, 9); assert.equal(stoppedObservers, 8); assert.equal(listeners.size, 1)
  assert.ok(seen.every(state => state.phase === 'monitoring_unknown' && state.error.code === 'CONTEXT_GONE'))
})

for (const path of ['attach', 'events', 'client-event']) test(`temporary 401/403 on ${path} recovers without remounting or repeating a native run`, async t => {
  const host = createCanvasHostBridge(); const server = createServer(bridgeHandler({ requestRejection: () => undefined }, host))
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = 'http://127.0.0.1:' + server.address().port
  const ready = { phase: 'ready', capabilities: { read: true, edit: true, run: true }, version: '18' }
  let bound = false, invokes = 0, denied = 0, listener
  let denials = path === 'client-event' ? [] : [401, 403]
  const runtime = {
    ensureContext: async () => ({ canvasId: '2873', contextId: 'ctx', readiness: ready }),
    getContextInfo: () => ({ contextId: 'ctx', readiness: ready }),
    subscribeReadiness: (_id, callback) => { callback(ready); return () => {} },
    subscribeRun: (_input, callback) => { listener = callback; return () => {} },
    execute: async () => {
      invokes++
      if (path === 'client-event') denials = [401, 403]
      return { status: 'submitted', canvasId: '2873', version: '19', nodeId: 'image', taskId: 'workflow', generation: { images: 1, videos: 0 } }
    },
  }
  const transport = async (input, init) => {
    if (String(input).endsWith('/' + path) && denials.length) { denied++; return Response.json({ error: 'browser session required' }, { status: denials.shift() }) }
    const response = await fetch(input, init)
    if (String(input).endsWith('/client-event') && JSON.parse(init.body).type === 'session.sync' && response.ok) bound = true
    return response
  }
  const client = createCanvasClientBridge({ origin, getRuntime: async () => runtime, transport, reconnectMs: 5 })
  t.after(() => { client.dispose(); host.dispose(); server.closeAllConnections(); server.close() })
  client.retainSession('session'); await waitUntil(() => bound)
  const target = await host.ensureContext('session', '2873', 'run', 'prepare'), updates = []
  t.after(host.subscribeRun(target, 'run', value => updates.push(value)))
  const operation = { action: 'node.run', expectedVersion: '18', nodeId: 'image', approvedGeneration: { images: 1, videos: 0 } }
  const first = await host.dispatch(target, 'run', operation)
  assert.ok(['submitted', 'submission_unknown'].includes(first.status))
  await waitUntil(() => denied === 2)
  let receipt
  await waitUntil(() => { void host.dispatch(target, 'run', operation).then(value => { receipt = value }); return receipt?.status === 'submitted' })
  listener({ requestId: 'run', canvasId: '2873', nodeId: 'image', sequence: 1, phase: 'completed', version: '20', workflowTaskId: 'workflow', nodeTaskId: 'node-task', generation: { images: 1, videos: 0 }, outputs: ['https://assets.example/new.png'] })
  await waitUntil(() => updates.length === 1)
  assert.equal(invokes, 1); assert.equal(updates[0].phase, 'completed')
})

for (const lostAt of ['events', 'client-event']) test(`lost Host registration at ${lostAt} reattaches sessions and never replays an old generation`, async t => {
  let host = createCanvasHostBridge(), handler = bridgeHandler({ requestRejection: () => undefined }, host)
  const handlers = [handler]
  const server = createServer((req, res) => handler(req, res))
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = 'http://127.0.0.1:' + server.address().port
  const ready = { phase: 'ready', capabilities: { read: true, edit: true, run: true }, version: '18' }
  const listeners = new Map(), bound = [], calls = []
  let attaches = 0, stopped = 0
  const runtime = {
    ensureContext: async () => ({ canvasId: '2873', contextId: 'ctx', readiness: ready }),
    getContextInfo: () => ({ contextId: 'ctx', readiness: ready }),
    subscribeReadiness: (_id, callback) => { callback(ready); return () => {} },
    subscribeRun: (input, callback) => { listeners.set(input.requestId, callback); return () => { stopped++ } },
    execute: async input => { calls.push(input.requestId); return { status: 'submitted', canvasId: '2873', version: '19', nodeId: 'image', taskId: 'workflow-' + input.requestId, generation: { images: 1, videos: 0 } } },
  }
  const transport = async (input, init) => {
    if (String(input).endsWith('/attach')) attaches++
    const response = await fetch(input, init)
    if (String(input).endsWith('/client-event') && JSON.parse(init.body).type === 'session.sync' && response.ok) bound.push(JSON.parse(init.body).connectionId)
    return response
  }
  const client = createCanvasClientBridge({ origin, getRuntime: async () => runtime, transport, reconnectMs: 5 })
  t.after(() => { client.dispose(); handlers.forEach(entry => entry.close()); host.dispose(); server.closeAllConnections(); server.close() })
  client.retainSession('session'); await waitUntil(() => bound.length === 1)
  const oldTarget = await host.ensureContext('session', '2873', 'run', 'old-prepare')
  const operation = { action: 'node.run', expectedVersion: '18', nodeId: 'image', approvedGeneration: { images: 1, videos: 0 } }
  assert.equal((await host.dispatch(oldTarget, 'old-run', operation)).status, 'submitted')
  if (lostAt === 'events') { handler.close(); server.closeAllConnections() }
  host.dispose()
  host = createCanvasHostBridge(); handler = bridgeHandler({ requestRejection: () => undefined }, host); handlers.push(handler)
  if (lostAt === 'client-event') listeners.get('old-run')({ requestId: 'old-run', canvasId: '2873', nodeId: 'image', sequence: 1, phase: 'running', version: '19', workflowTaskId: 'workflow-old-run', generation: { images: 1, videos: 0 }, outputs: [] })
  await waitUntil(() => bound.some(id => id !== oldTarget.connectionId))
  assert.equal(attaches, 2); assert.equal(stopped, 1); assert.deepEqual(calls, ['old-run'])
  listeners.get('old-run')({ requestId: 'old-run', canvasId: '2873', nodeId: 'image', sequence: 1, phase: 'completed', version: '20', workflowTaskId: 'workflow-old-run', nodeTaskId: 'node-task', generation: { images: 1, videos: 0 }, outputs: ['https://assets.example/old.png'] })
  const target = await host.ensureContext('session', '2873', 'run', 'new-prepare')
  assert.notEqual(target.connectionId, oldTarget.connectionId)
  assert.equal((await host.dispatch(target, 'new-run', operation)).status, 'submitted')
  assert.deepEqual(calls, ['old-run', 'new-run'])
})
