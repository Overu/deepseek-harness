import assert from 'node:assert/strict'
import test from 'node:test'
import { CanvasResultsStore, canvasResultsClosingSeq, canvasResultsDefinition, groupCanvasResults, resultsForClosing } from '../src/client/canvas-results.ts'

const source = (changes = {}) => ({ schemaVersion: 1, sessionId: 'session', ownerId: 'owner', rootCallId: 'root', callId: 'nested',
  turn: 2, rootCallSeq: 10, sessionCreatedAt: 100, requestId: 'request', canvasId: '2873', nodeId: 'node',
  nodeTaskId: 'task', phase: 'completed', version: '8', generation: { images: 1, videos: 0 },
  outputs: ['https://example.com/a.png'], createdAt: 200, ...changes })
const frame = value => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)
const until = async predicate => {
  for (let index = 0; index < 100; index++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)) }
  assert.fail('expected result state was not published')
}
function fixture(options = {}) {
  const requests = [], streams = []
  const transport = async (input, init) => {
    const url = new URL(input); requests.push({ url, init })
    if (url.pathname.endsWith('/events')) {
      let controller
      const body = new ReadableStream({ start(value) { controller = value }, cancel() {} })
      const stream = { send(value) { controller.enqueue(frame(value)) }, close() { controller.close() }, signal: init.signal }
      init.signal.addEventListener('abort', () => { try { controller.error(new Error('aborted')) } catch {} }, { once: true })
      streams.push(stream)
      if (options.firstStatus) return new Response('', { status: options.firstStatus })
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    }
    if (options.page) return options.page(url, init)
    assert.fail('plain GET must only be used for an advertised history cursor')
  }
  const store = new CanvasResultsStore({ origin: 'https://shell.example', transport, reconnectMs: 2 })
  return { store, requests, streams }
}

test('turn data records actual root call identity and supports partially loaded history', () => {
  assert.equal(canvasResultsDefinition.match({ type: 'assistant/message', data: { turn: 2 } }), null)
  assert.equal(canvasResultsDefinition.match({ type: 'tool/result', data: { turn: 2 } }), null)
  const event = { type: 'tool/call', seq: 10, data: { turn: 2, callId: 'root', name: 'ptc', arguments: '{}' } }
  const match = { event, role: 'start', location: { kind: 'unresolved' } }
  const state = canvasResultsDefinition.start({}, match, {})
  assert.deepEqual(state, { turn: 2, calls: [{ callId: 'root', seq: 10 }] })
  assert.equal(canvasResultsDefinition.update({ state }, match), state)
  const next = canvasResultsDefinition.update({ state }, { ...match, event: { ...event, seq: 11, data: { ...event.data, callId: 'root2' } } })
  assert.deepEqual(next.calls, [{ callId: 'root', seq: 10 }, { callId: 'root2', seq: 11 }])
  const data = canvasResultsDefinition.buildLocationData({ state: next }, 'turn', null)
  assert.equal(data.value, next)
  assert.equal(canvasResultsDefinition.buildLocationData({ state: next }, 'turn', data), data)
  assert.equal(canvasResultsDefinition.buildLocationData({ state: next }, 'step', null), null)
})

test('a product only belongs to its recorded original Session, turn and root sequence', () => {
  const calls = [{ callId: 'root', seq: 10 }, { callId: 'later', seq: 30 }]
  const valid = source({ createdAt: 99999 }) // Asynchronous completion is later than the closing reply.
  const invalid = [source({ sessionId: 'other' }), source({ turn: 1 }), source({ rootCallId: 'unknown' }),
    source({ rootCallSeq: 9 }), source({ rootCallId: 'later', rootCallSeq: 30 })]
  assert.deepEqual(resultsForClosing([valid, ...invalid], 'session', 2, calls, 20), [valid])
  assert.deepEqual(resultsForClosing([valid], 'session', 2, [], 20), [])
  assert.deepEqual(resultsForClosing([], 'session', 2, calls, 20), [])
})

test('results group by real canvas identity without guessing from output names or paths', () => {
  const first = source(), second = source({ requestId: 'next', nodeId: 'node2' }), other = source({ requestId: 'other', canvasId: '3001' })
  assert.deepEqual([...groupCanvasResults([first, second, other])], [['2873', [first, second]], ['3001', [other]]])
})

test('one Session shares one SSE, updates an ended turn and has no polling reads', async t => {
  const f = fixture(); t.after(() => f.store.dispose())
  let published = 0
  const stop = f.store.subscribe('session', () => published++)
  const release1 = f.store.retainSession('session'), release2 = f.store.retainSession('session')
  await until(() => f.streams.length === 1)
  f.streams[0].send({ type: 'snapshot', sources: [] })
  f.streams[0].send({ type: 'upsert', source: source() })
  await until(() => f.store.getSnapshot('session').length === 1)
  assert.equal(published, 1)
  const snapshot = f.store.getSnapshot('session')
  f.streams[0].send({ type: 'upsert', source: source() })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(f.store.getSnapshot('session'), snapshot)
  assert.equal(published, 1)
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].url.searchParams.get('s'), 'session')
  assert.equal(f.requests[0].init.credentials, 'same-origin')
  release1(); assert.equal(f.streams[0].signal.aborted, false)
  release2(); assert.equal(f.streams[0].signal.aborted, true)
  release2(); stop()
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(f.streams.length, 1)
  assert.deepEqual(f.store.getSnapshot('session'), [])
})

test('snapshot pagination and live updates merge without stale pages overwriting a new receipt', async t => {
  let resolvePage
  const pendingPage = new Promise(resolve => { resolvePage = resolve })
  const f = fixture({ page: () => pendingPage }); t.after(() => f.store.dispose())
  f.store.retainSession('session'); await until(() => f.streams.length === 1)
  f.streams[0].send({ type: 'snapshot', sources: [source({ requestId: 'old' })], nextCursor: 'page-2' })
  await until(() => f.requests.length === 2)
  f.streams[0].send({ type: 'upsert', source: source({ version: '9', outputs: ['https://example.com/new.png'] }) })
  await until(() => f.store.getSnapshot('session').length === 2)
  resolvePage(new Response(JSON.stringify({ type: 'snapshot', sources: [source(), source({ requestId: 'older' })] }), { headers: { 'content-type': 'application/json' } }))
  await until(() => f.store.getSnapshot('session').length === 3)
  assert.equal(f.store.getSnapshot('session').find(item => item.requestId === 'request').version, '9')
  assert.equal(f.requests[1].url.searchParams.get('after'), 'page-2')
  assert.equal(f.requests[1].init.method, undefined)
})

test('reconnect rereads durable history without replaying generation or saving', async t => {
  const f = fixture(); t.after(() => f.store.dispose())
  f.store.retainSession('session'); await until(() => f.streams.length === 1)
  f.streams[0].send({ type: 'snapshot', sources: [source()] })
  await until(() => f.store.getSnapshot('session').length === 1)
  f.streams[0].close(); await until(() => f.streams.length === 2)
  f.streams[1].send({ type: 'snapshot', sources: [source(), source({ requestId: 'missed' })] })
  await until(() => f.store.getSnapshot('session').length === 2)
  assert.equal(f.requests.length, 2)
  assert.ok(f.requests.every(request => request.url.pathname.endsWith('/events') && request.init.method === undefined))
})

test('cross-Session sources cannot populate another conversation and authorization failure stops retries', async t => {
  const f = fixture(); t.after(() => f.store.dispose())
  f.store.retainSession('session'); await until(() => f.streams.length === 1)
  f.streams[0].send({ type: 'upsert', source: source({ sessionId: 'other' }) })
  await until(() => f.streams.length === 2)
  assert.deepEqual(f.store.getSnapshot('session'), [])
  const denied = fixture({ firstStatus: 403 }); t.after(() => denied.store.dispose())
  denied.store.retainSession('session')
  await new Promise(resolve => setTimeout(resolve, 15))
  assert.equal(denied.requests.length, 1)
  assert.deepEqual(denied.store.getSnapshot('session'), [])
})

test('connection reset clears account receipts and stale old pages cannot repopulate them', async t => {
  let resolvePage
  const pendingPage = new Promise(resolve => { resolvePage = resolve })
  const f = fixture({ page: () => pendingPage }); t.after(() => f.store.dispose())
  f.store.retainSession('session'); await until(() => f.streams.length === 1)
  f.streams[0].send({ type: 'snapshot', sources: [source()], nextCursor: 'old-page' })
  await until(() => f.requests.length === 2)
  f.store.reset(); await until(() => f.streams.length === 2)
  assert.equal(f.streams[0].signal.aborted, true)
  resolvePage(new Response(JSON.stringify({ type: 'snapshot', sources: [source({ requestId: 'stale' })] })))
  f.streams[1].send({ type: 'snapshot', sources: [source({ requestId: 'new-account' })] })
  await until(() => f.store.getSnapshot('session').length === 1)
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(f.store.getSnapshot('session')[0].requestId, 'new-account')
})

test('a failed advertised history page reconnects instead of leaving an incomplete history frozen', async t => {
  const f = fixture({ page: async () => new Response('', { status: 503 }) }); t.after(() => f.store.dispose())
  f.store.retainSession('session'); await until(() => f.streams.length === 1)
  f.streams[0].send({ type: 'snapshot', sources: [], nextCursor: 'page2' })
  await until(() => f.streams.length === 2)
  assert.equal(f.streams[0].signal.aborted, true)
  f.streams[1].send({ type: 'snapshot', sources: [source()] })
  await until(() => f.store.getSnapshot('session').length === 1)
  assert.equal(f.requests.length, 3)
})

test('an authoritative empty reconnect snapshot removes stale cached sources', async t => {
  const f = fixture(); t.after(() => f.store.dispose())
  f.store.retainSession('session'); await until(() => f.streams.length === 1)
  f.streams[0].send({ type: 'snapshot', sources: [source()] })
  await until(() => f.store.getSnapshot('session').length === 1)
  f.streams[0].close(); await until(() => f.streams.length === 2)
  f.streams[1].send({ type: 'snapshot', sources: [] })
  await until(() => f.store.getSnapshot('session').length === 0)
})

test('only a complete paginated snapshot prunes absent receipts while preserving concurrent live products', async t => {
  let resolvePage
  const pendingPage = new Promise(resolve => { resolvePage = resolve })
  const f = fixture({ page: () => pendingPage }); t.after(() => f.store.dispose())
  f.store.retainSession('session'); await until(() => f.streams.length === 1)
  f.streams[0].send({ type: 'snapshot', sources: [source({ requestId: 'stale' }), source({ requestId: 'second-page' })] })
  await until(() => f.store.getSnapshot('session').length === 2)
  f.streams[0].close(); await until(() => f.streams.length === 2)
  f.streams[1].send({ type: 'snapshot', sources: [source({ requestId: 'first-page' })], nextCursor: 'page2' })
  await until(() => f.requests.length === 3)
  assert.ok(f.store.getSnapshot('session').some(item => item.requestId === 'second-page'))
  f.streams[1].send({ type: 'upsert', source: source({ requestId: 'concurrent' }) })
  await until(() => f.store.getSnapshot('session').length === 4)
  resolvePage(new Response(JSON.stringify({ type: 'snapshot', sources: [source({ requestId: 'second-page' })] })))
  await until(() => f.store.getSnapshot('session').length === 3)
  assert.deepEqual(f.store.getSnapshot('session').map(item => item.requestId).sort(), ['concurrent', 'first-page', 'second-page'])
})

test('workspace DSH assembler retains every root call in one turn across append and partial history replay', async () => {
  const { ConversationNodeAssembler } = await import(new URL('../../../client/ui-conversation/src/client/conversation/assembler.ts', import.meta.url).href)
  const views = { entries: () => [{ target: 'canvas-test', create: () => ({
    empty: new Map(), replace: ({ timeline }) => timeline.turns, apply: ({ timeline }) => timeline.turns,
  }) }] }
  const definitions = { entries: () => [canvasResultsDefinition], fallbackEntry: () => undefined }
  const assembler = new ConversationNodeAssembler(definitions, views)
  assembler.activateTarget('canvas-test')
  const entry = (seq, type, data) => ({ type: 'event', event: { type, seq, data, time: 100 + seq } })
  const start = entry(1, 'turn/start', { turn: 2 })
  const first = entry(10, 'tool/call', { turn: 2, step: 0, callId: 'root', name: 'ptc', arguments: '{}' })
  const second = entry(11, 'tool/call', { turn: 2, step: 0, callId: 'root2', name: 'canvas_run', arguments: '{}' })
  assembler.replaceWindow([start, first], false); assembler.flush()
  assembler.append(second); assembler.flush()
  const calls = assembler.snapshot('canvas-test').get(2).data.get('desktop-canvas-results').calls
  assert.deepEqual(calls, [{ callId: 'root', seq: 10 }, { callId: 'root2', seq: 11 }])
  assembler.replaceWindow([first, second], true); assembler.flush()
  assert.deepEqual(assembler.snapshot('canvas-test').get(2).data.get('desktop-canvas-results').calls, calls)
  assembler.prepend([start], false); assembler.flush()
  assert.deepEqual(assembler.snapshot('canvas-test').get(2).data.get('desktop-canvas-results').calls, calls)
})

test('a trusted turn end includes completed products after an interrupted reply without admitting future calls', () => {
  const end = { seq: 20, data: { turn: 2 } }, turn = { turn: 2, end }
  const seq = canvasResultsClosingSeq(turn, 9)
  assert.equal(seq, 20)
  assert.equal(canvasResultsClosingSeq({ turn: 2, end: undefined }, 9), 9)
  const interruptedProduct = source({ rootCallSeq: 11, rootCallId: 'submitted-after-reply' })
  const futureProduct = source({ requestId: 'future', rootCallSeq: 30, rootCallId: 'future-call' })
  const laterTurn = source({ requestId: 'later-turn', turn: 3, rootCallSeq: 11, rootCallId: 'submitted-after-reply' })
  assert.deepEqual(resultsForClosing([interruptedProduct, futureProduct, laterTurn], 'session', 2,
    [{ callId: 'submitted-after-reply', seq: 11 }, { callId: 'future-call', seq: 30 }], seq), [interruptedProduct])
})

test('real title reads deduplicate in flight without attaching or writing to the canvas', async t => {
  const requests = []
  let resolve
  const response = new Promise(done => { resolve = done })
  const store = new CanvasResultsStore({ origin: 'https://shell.example', transport: (url, init) => {
    requests.push({ url: new URL(url), init }); return response
  } })
  t.after(() => store.dispose())
  const first = store.getCanvasTitle('2873'), second = store.getCanvasTitle('2873')
  assert.equal(first, second)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url.pathname, '/desktop-canvas/api/snapshot')
  assert.equal(requests[0].url.searchParams.get('id'), '2873')
  assert.equal(requests[0].init.credentials, 'same-origin')
  assert.equal(requests[0].init.method, undefined)
  resolve(new Response(JSON.stringify({ canvasId: '2873', name: '  新品推广  ' })))
  assert.equal(await first, '新品推广')
  await store.getCanvasTitle('2873')
  assert.equal(requests.length, 2) // A later mount reads a renamed canvas rather than a permanent name cache.
  assert.equal(await store.getCanvasTitle('invalid'), undefined)
  assert.equal(requests.length, 2)
})

test('a title read failure remains optional and can recover on a future mount', async t => {
  let attempt = 0
  const store = new CanvasResultsStore({ origin: 'https://shell.example', transport: async () => {
    attempt++
    return attempt === 1 ? new Response('', { status: 502 })
      : new Response(JSON.stringify({ canvasId: '2873', name: '修复后标题' }))
  } })
  t.after(() => store.dispose())
  assert.equal(await store.getCanvasTitle('2873'), undefined)
  assert.equal(await store.getCanvasTitle('2873'), '修复后标题')
  assert.deepEqual(store.getSnapshot('session'), [])
})

test('title validation rejects another canvas and unbounded or empty names', async t => {
  for (const snapshot of [{ canvasId: '9999', name: 'wrong' }, { canvasId: '2873', name: 'x'.repeat(101) },
    { canvasId: '2873', name: '  ' }, { canvasId: '2873', name: 42 }]) {
    const store = new CanvasResultsStore({ origin: 'https://shell.example', transport: async () => new Response(JSON.stringify(snapshot)) })
    t.after(() => store.dispose())
    assert.equal(await store.getCanvasTitle('2873'), undefined)
  }
})

test('connection reset cancels old-account title reads and ignores their late responses', async t => {
  const requests = [], resolvers = []
  const store = new CanvasResultsStore({ origin: 'https://shell.example', transport: (_url, init) => {
    requests.push(init); return new Promise(resolve => resolvers.push(resolve))
  } })
  t.after(() => store.dispose())
  const old = store.getCanvasTitle('2873')
  store.reset()
  assert.equal(requests[0].signal.aborted, true)
  const current = store.getCanvasTitle('2873')
  resolvers[0](new Response(JSON.stringify({ canvasId: '2873', name: '旧账号' })))
  assert.equal(await old, undefined)
  assert.equal(store.getCanvasTitle('2873'), current)
  resolvers[1](new Response(JSON.stringify({ canvasId: '2873', name: '当前账号' })))
  assert.equal(await current, '当前账号')
  const pending = store.getCanvasTitle('2873')
  store.dispose()
  assert.equal(requests[2].signal.aborted, true)
  resolvers[2](new Response(JSON.stringify({ canvasId: '2873', name: 'disposed' })))
  assert.equal(await pending, undefined)
  assert.equal(await store.getCanvasTitle('2873'), undefined)
})
