import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { registerCanvasRunTools } from '../src/host/canvas-run-tools.ts'
import { CanvasAgentError } from '../src/shared/canvas-agent-protocol.ts'

const canvasId = '103228'
const args = { canvasId, nodeId: 'target', expectedVersion: '12' }
function fixture(options = {}) {
  const definitions = new Map(), events = new Map(), disposers = [], trace = [], jobRecords = [], contexts = [], invocations = []
  const session = { id: 'session', header: { createdAt: 1000 } }, agent = { id: 'session', session }, warnings = []
  const listeners = new Set(), listenersByRun = new Map()
  let generation = options.generation ?? { images: 1, videos: 0 }, sequence = 0, activeRunRequest, activeRunIds
  const jobs = {
    start(spec) {
      trace.push('job-admission')
      if (options.admissionError) throw new Error('owner/controller/limit admission rejected')
      assert.equal(spec.owner, agent.id)
      const id = 'canvas-' + (jobRecords.length + 1)
      const progress = [], hooks = spec.run({ id, append: () => { throw new Error('no duplicate result append') }, updateProgress: value => progress.push(value) })
      const record = { id, spec, hooks, progress }; jobRecords.push(record)
      void hooks.done.then(value => { record.outcome = value })
      return id
    }
  }
  const questions = { async ask(request) {
    trace.push('human-confirm'); assert.equal(request.agent, agent)
    if (options.ask) return options.ask(request)
    return { answers: [{ id: 'canvas-generation-volume', selected: [options.decline ? '暂不生成' : '确认生成'] }] }
  } }
  const ctx = {
    logger: { warn: value => warnings.push(value) },
    tools: { register: definition => { definitions.set(definition.name, definition) } },
    effect: fn => { disposers.push(fn()) },
    on: (name, handler) => { events.set(name, handler) },
    get: name => name === 'jobs' ? options.noJobs ? undefined : jobs : name === 'userQuestions' ? options.noQuestions ? undefined : questions : undefined,
  }
  const target = { canvasId, sessionId: agent.id, contextId: 'context', connectionId: 'connection', readiness: { phase: 'ready', version: '12', capabilities: { read: true, edit: true, run: true } } }
  const bridge = {
    async ensureContext(...values) { trace.push('prepare'); assert.equal(values[2], 'run'); return target },
    subscribeRun(target, requestId, callback) {
      trace.push('subscribe'); listeners.add(callback)
      let current = listenersByRun.get(requestId)
      if (!current) { current = new Set(); listenersByRun.set(requestId, current) }
      current.add(callback); activeRunRequest = requestId
      if (options.cachedTerminal) callback(state('completed', requestId, options.cachedNodeIds?.[Number(requestId.match(/:run:(\d+)$/)?.[1] ?? 0)] ?? 'target'))
      return () => { trace.push('unsubscribe'); listeners.delete(callback); current.delete(callback); if (!current.size) listenersByRun.delete(requestId) }
    },
    async dispatch(target, requestId, operation) {
      if (operation.action === 'node.preflight') { trace.push('preflight'); options.onPreflight?.(operation); return options.preflightRejected ?? { status: 'preflight', canvasId, nodeId: operation.nodeId, version: operation.expectedVersion, generation, quote: { points: 10, originalPoints: null } } }
      trace.push('invoke'); invocations.push(operation)
      if (operation.action === 'workflow.run') {
        activeRunIds = operation.runRequestIds
        options.onInvoke?.(operation)
        if (options.runThrow) throw new Error('transport secret must not leak')
        if ('runUnknownVersion' in options) return { status: 'submission_unknown', canvasId, version: options.runUnknownVersion, phase: 'run', affectedNodeIds: [], error: { code: 'SUBMISSION_UNKNOWN', message: 'acknowledgement missing', retry: 'never_auto' } }
        if (options.runRejected) return { status: 'rejected', canvasId, version: '12', effect: 'none', error: { code: 'COUNT_CHANGED', message: 'count changed', retry: 'read_first' } }
        return {
          status: 'submitted', canvasId, version: String(Number(operation.expectedVersion) + 1),
          taskId: 'workflow-task', nodeIds: operation.nodeIds,
          results: operation.nodeIds.map(nodeId => ({ nodeId, generation: operation.approvedGenerations[nodeId] }))
        }
      }
      assert.equal(operation.action, 'node.run'); assert.deepEqual(operation.approvedGeneration, generation)
      options.onInvoke?.(operation)
      if (options.runThrow) throw new Error('transport secret must not leak')
        if ('runUnknownVersion' in options) return { status: 'submission_unknown', canvasId, version: options.runUnknownVersion, phase: 'run', affectedNodeIds: [], error: { code: 'SUBMISSION_UNKNOWN', message: 'acknowledgement missing', retry: 'never_auto' } }
      if (options.runRejected) return { status: 'rejected', canvasId, version: '12', effect: 'none', error: { code: 'COUNT_CHANGED', message: 'count changed', retry: 'read_first' } }
      if (options.fastTerminal) { const terminal = state('completed', requestId); for (const callback of [...listeners]) callback(terminal) }
      return { status: 'submitted', canvasId, version: String(Number(operation.expectedVersion) + 1), nodeId: operation.nodeId, taskId: 'workflow-task', generation }
    }
  }
  function state(phase, requestId = 'run-state', nodeId = 'target') { return { requestId, canvasId, nodeId, sequence: ++sequence, phase, version: '14', workflowTaskId: 'workflow-task', nodeTaskId: 'node-task', generation, outputs: phase === 'completed' ? [`https://assets.example/${nodeId === 'target' ? 'new' : nodeId}.png`] : phase === 'failed' ? options.failureOutputs ?? [] : [], ...(phase === 'failed' ? { error: { code: 'RUN_REJECTED', message: 'model rejected', retry: 'user_decision' } } : {}) } }
  registerCanvasRunTools(ctx, bridge, { ...options.timeouts, results: options.results })
  const human = (seq = 1) => events.get('session/event')(session, { seq, type: 'user/message', data: { source: { kind: 'user' } } })
  if (!options.noIntent) human()
  const exec = (callId = 'run', signal = new AbortController().signal) => ({ callId, rootCallId: options.rootCallId ?? callId, agent, signal, deferContext: value => { if (options.deferError) throw new Error('presentation failed'); contexts.push(value) } })
  return { trace, definitions, jobRecords, contexts, human, warnings, invocations, get listenerCount() { return listeners.size }, rootCall(callId, turn = 1, seq = 16) { events.get('session/event')(session, { seq, type: 'tool/call', data: { callId, turn, name: 'run_code' } }) }, notice(seq = 2) { events.get('session/event')(session, { seq, type: 'user/message', data: { source: { kind: 'tool-jobs' } } }) },
    setGeneration(value) { generation = value }, emit(phase) { assert(listeners.size, 'must keep live subscription'); const snapshot = state(phase, activeRunRequest); for (const callback of [...listeners]) callback(snapshot) },
    emitNode(nodeId, phase, closed = false) { const requestId = activeRunIds?.[nodeId], callbacks = listenersByRun.get(requestId); assert(requestId && callbacks?.size, 'must keep node subscription'); const snapshot = state(phase, requestId, nodeId); if (closed) snapshot.error = { code: 'CLIENT_UNAVAILABLE', message: 'client disconnected', retry: 'never_auto' }; for (const callback of [...callbacks]) callback(snapshot) },
    dispose() { for (const dispose of disposers) dispose() },
    runRaw(input = { canvasId, nodeIds: ['target'], expectedVersion: '12' }, callId = 'run', signal) {
      const actual = 'nodeId' in input ? { ...input, nodeIds: [input.nodeId] } : input
      if ('nodeId' in actual) delete actual.nodeId
      const rootCallId = options.rootCallId ?? callId
      this.rootCall(rootCallId, options.turn ?? 1)
      return definitions.get('canvas_run').execute(actual, exec(callId, signal)).then(value => {
        events.get('session/event')(session, { seq: 17, type: 'tool/result', data: { message: { source: { callId: rootCallId } } } })
        return JSON.parse(value)
      })
    },
    async run(input = args, callId = 'run', signal) {
      const result = await this.runRaw(input, callId, signal)
      return result.results?.length === 1 ? result.results[0] : result
    }
  }
}
const complete = async f => { f.emit('completed'); await delay(0) }

test('run public contract accepts only true target/version, never forged routing, count or confirmation', async () => {
  const f = fixture()
  assert.deepEqual(Object.keys(f.definitions.get('canvas_run').parameters.properties), ['canvasId', 'nodeIds', 'expectedVersion'])
  for (const input of [{ ...args, confirmed: true }, { ...args, approvedGeneration: { images: 99, videos: 0 } }, { ...args, sessionId: 'other' }, { ...args, scope: 'canvas' }]) {
    const result = await f.run(input); assert.equal(result.status, 'rejected'); assert.equal(result.error.code, 'INVALID_ARGUMENT')
  }
  assert.equal(f.trace.length, 0)
})
test('one tool call preflights and confirms all targets, then submits via native batch workflow', async () => {
  const f = fixture({ generation: { images: 16, videos: 0 } })
  const result = await f.run({ canvasId, nodeIds: ['target', 'target-2'], expectedVersion: '12' }, 'multi')
  assert.equal(result.status, 'submitted'); assert.equal(result.nextIndex, 2)
  assert.equal(result.results.length, 2); assert.deepEqual(result.results.map(item => item.jobId), ['canvas-1', 'canvas-1'])
  assert.equal(result.jobId, 'canvas-1')
  assert.equal(f.invocations.length, 1)
  assert.equal(f.invocations[0].action, 'workflow.run')
  assert.equal(f.invocations[0].expectedVersion, '12')
  assert.deepEqual(f.invocations[0].nodeIds, ['target', 'target-2'])
  assert.equal(f.trace.filter(item => item === 'human-confirm').length, 1)
  assert.equal(f.jobRecords.length, 1)
  f.dispose()
})
test('batch Job waits for every child terminal state, then releases both node fences', async () => {
  const f = fixture(), input = { canvasId, nodeIds: ['target', 'target-2'], expectedVersion: '12' }
  const result = await f.run(input, 'batch')
  assert.equal(result.status, 'submitted')
  assert.deepEqual(Object.keys(f.invocations[0].runRequestIds), input.nodeIds)
  f.emitNode('target', 'completed'); await delay(0)
  assert.equal(f.jobRecords[0].outcome, undefined)
  assert.equal((await f.run(input, 'while-one-running')).error.code, 'NODE_BUSY')
  f.emitNode('target-2', 'completed'); await delay(0)
  assert.equal(f.jobRecords[0].outcome.status, 'completed')
  assert.deepEqual(JSON.parse(f.jobRecords[0].outcome.result).results.map(state => state.nodeId), input.nodeIds)
  assert.equal((await f.run(input, 'after-terminal')).status, 'submitted')
  f.dispose()
})
test('batch Job reports partial output when one node succeeds and another fails', async () => {
  const f = fixture(), input = { canvasId, nodeIds: ['target', 'target-2'], expectedVersion: '12' }
  await f.run(input, 'partial-batch')
  f.emitNode('target', 'completed')
  f.emitNode('target-2', 'failed')
  await delay(0)
  assert.equal(f.jobRecords[0].outcome.status, 'failed')
  const result = JSON.parse(f.jobRecords[0].outcome.result)
  assert.equal(result.partial, true)
  assert.equal(result.actualOutputCount, 1)
  assert.deepEqual(result.results.map(state => state.phase), ['completed', 'failed'])
  assert.deepEqual(result.results[0].outputs, ['https://assets.example/new.png'])
  f.dispose()
})
test('one closed child keeps the batch Job tracking the other child until its result arrives', async () => {
  const f = fixture(), input = { canvasId, nodeIds: ['target', 'target-2'], expectedVersion: '12' }
  await f.run(input, 'closed-child')
  f.emitNode('target', 'monitoring_unknown', true); await delay(0)
  assert.equal(f.jobRecords[0].outcome, undefined)
  assert.equal((await f.run(input, 'still-running')).error.code, 'NODE_BUSY')
  f.emitNode('target-2', 'completed'); await delay(0)
  assert.equal(f.jobRecords[0].outcome.status, 'failed')
  const result = JSON.parse(f.jobRecords[0].outcome.result)
  assert.equal(result.status, 'monitoring_unknown')
  assert.deepEqual(result.results.map(state => state.phase), ['monitoring_unknown', 'completed'])
  assert.deepEqual(result.results[1].outputs, ['https://assets.example/target-2.png'])
  f.dispose()
})
test('new user input during batch preflight prevents every native generation', async () => {
  let f
  f = fixture({ onPreflight: () => f.human(2) })
  const result = await f.run({ canvasId, nodeIds: ['target', 'target-2'], expectedVersion: '12' }, 'preflight-steered')
  assert.equal(result.status, 'rejected'); assert.equal(result.error.code, 'COUNT_CHANGED')
  assert.equal(f.invocations.length, 0); assert.equal(f.jobRecords.length, 0)
  f.dispose()
})
test('batch pauses at active tracking capacity and gives a continuation index', async () => {
  const f = fixture()
  const nodeIds = Array.from({ length: 9 }, (_, index) => `target-${index}`)
  const result = await f.run({ canvasId, nodeIds, expectedVersion: '12' }, 'many')
  assert.equal(result.status, 'paused'); assert.equal(result.nextIndex, 8); assert.equal(result.version, '13')
  assert.deepEqual(result.nodeIds, nodeIds)
  assert.equal(result.results.length, 8); assert.equal(f.invocations.length, 1)
  assert.equal(f.invocations[0].action, 'workflow.run')
  assert.equal(f.invocations[0].nodeIds.length, 8)
  assert.equal(f.jobRecords.length, 1)
  f.dispose()
})
test('preflight and Jobs admission precede native invoke, subscription precedes fast result and no canvas UI is involved', async () => {
  const f = fixture({ fastTerminal: true }), result = await f.run()
  assert.equal(result.status, 'submitted'); assert.equal(result.jobId, 'canvas-1'); assert.equal(result.taskId, 'workflow-task')
  assert.deepEqual(f.trace.slice(0, 5), ['prepare', 'preflight', 'job-admission', 'subscribe', 'invoke'])
  await delay(0); assert.equal(f.jobRecords[0].outcome.status, 'completed')
  assert.deepEqual(JSON.parse(f.jobRecords[0].outcome.result).results[0].outputs, ['https://assets.example/new.png'])
  assert.deepEqual(JSON.parse(f.contexts[0].content[0].text), { tool:'canvas_run',jobId:'canvas-1',canvasId,nodeIds:['target'],status:'submitted',nextIndex:1 })
})
test('controller, owner or concurrency admission rejection submits zero native requests', async () => {
  const f = fixture({ admissionError: true }), result = await f.run()
  assert.equal(result.status, 'rejected'); assert(!f.trace.includes('invoke')); assert.equal(f.jobRecords.length, 0)
})
test('missing Jobs or genuine human intent fails closed before native generation', async () => {
  for (const options of [{ noJobs: true }, { noIntent: true }]) {
    const f = fixture(options), result = await f.run(); assert.equal(result.status, 'rejected'); assert(!f.trace.includes('invoke'))
  }
})
test('native precondition rejection keeps actual error and creates no Job', async () => {
  const f = fixture({ preflightRejected: { status: 'rejected', canvasId, version: '12', effect: 'none', error: { code: 'EDITOR_BUSY', message: 'editing', retry: 'after_ready' } } }), result = await f.run()
  assert.equal(result.error.code, 'EDITOR_BUSY'); assert(!f.trace.includes('job-admission')); assert(!f.trace.includes('invoke'))
})
test('same-call dedup returns original receipt and changed arguments are rejected without a new generation', async () => {
  const f = fixture(), first = await f.run(), second = await f.run()
  assert.deepEqual(first, second); assert.equal(f.trace.filter(value => value === 'invoke').length, 1)
  assert.equal((await f.run({ ...args, nodeId: 'other' })).error.code, 'DUPLICATE_REQUEST_MISMATCH')
  await complete(f)
})
test('a second call on the same running target is refused until terminal completion, then local rerun works', async () => {
  const f = fixture(); await f.run()
  assert.equal((await f.run(args, 'second')).error.code, 'NODE_BUSY'); assert.equal(f.trace.filter(value => value === 'invoke').length, 1)
  await complete(f); assert.equal((await f.run(args, 'third')).status, 'submitted'); await complete(f)
})
test('31 images and 7 videos require real UI confirmation; declined/unavailable answers submit zero', async () => {
  for (const generation of [{ images: 31, videos: 0 }, { images: 0, videos: 7 }]) for (const options of [{ decline: true }, { noQuestions: true }, { ask: async () => { throw new Error('no live root') } }]) {
    const f = fixture({ generation, ...options }), result = await f.run()
    assert.equal(result.status, 'rejected'); assert.match(result.error.code, /CONFIRMATION_/); assert(!f.trace.includes('invoke')); assert.equal(f.jobRecords.length, 0)
  }
})
test('30 images and 6 videos need no extra confirmation, larger exact count can proceed after real answer', async () => {
  for (const generation of [{ images: 30, videos: 0 }, { images: 0, videos: 6 }, { images: 31, videos: 0 }]) {
    const f = fixture({ generation }), result = await f.run()
    assert.equal(result.status, 'submitted'); assert.equal(f.trace.includes('human-confirm'), generation.images > 30)
    await complete(f)
  }
})
test('same human intent accumulates despite completion notices, while next human message starts a new allowance', async () => {
  const f = fixture({ generation: { images: 30, videos: 0 }, decline: true }); await f.run(); await complete(f)
  f.setGeneration({ images: 1, videos: 0 }); f.notice(2)
  assert.equal((await f.run(args, 'overflow')).error.code, 'CONFIRMATION_DECLINED'); assert.equal(f.trace.filter(value => value === 'invoke').length, 1)
  f.human(3); assert.equal((await f.run(args, 'new-intent')).status, 'submitted'); await complete(f)
})
test('owner serialization prevents concurrent calls on separate nodes bypassing aggregate confirmation', async () => {
  const f = fixture({ generation: { images: 20, videos: 0 }, decline: true })
  const results = await Promise.all([f.run(args, 'one'), f.run({ ...args, nodeId: 'second-target' }, 'two')])
  assert.equal(results[0].status, 'submitted'); assert.equal(results[1].error.code, 'CONFIRMATION_DECLINED')
  assert.equal(f.trace.filter(value => value === 'invoke').length, 1); await complete(f)
})
test('known rejected invoke releases reserved counts and target; no false generation success', async () => {
  const f = fixture({ generation: { images: 30, videos: 0 }, runRejected: true, decline: true })
  assert.equal((await f.run()).error.code, 'COUNT_CHANGED'); f.setGeneration({ images: 1, videos: 0 })
  assert.equal((await f.run(args, 'retry-with-human-instruction')).error.code, 'COUNT_CHANGED'); assert(!f.trace.includes('human-confirm'))
  await delay(0); assert.equal(f.jobRecords[0].outcome.status, 'failed')
})
test('lost submission acknowledgement remains unknown and tracked, later trusted completion reports the real result', async () => {
  const f = fixture({ runThrow: true }), result = await f.run()
  assert.equal(result.status, 'submission_unknown'); assert.equal(result.error.retry, 'never_auto'); assert.equal(result.jobId, 'canvas-1')
  assert(!JSON.stringify(result).includes('secret')); assert.equal((await f.run(args, 'duplicate-invoke')).error.code, 'NODE_BUSY')
  await complete(f); assert.equal(f.jobRecords[0].outcome.status, 'completed')
})
test('tracking timeout means unknown backend result, and never resubmits native work', async () => {
  const f = fixture({ timeouts: { imageTimeoutMs: 3, videoTimeoutMs: 3 } }); await f.run(); await delay(20)
  assert.equal(f.jobRecords[0].outcome.status, 'failed'); assert.match(f.jobRecords[0].outcome.detail, /不代表后台失败/)
  assert.equal(JSON.parse(f.jobRecords[0].outcome.result).status, 'monitoring_unknown'); assert.equal(f.trace.filter(value => value === 'invoke').length, 1)
})
test('Job kill stops tracking but never claims cancellation of the backend generation', async () => {
  const f = fixture(); await f.run(); f.jobRecords[0].hooks.cancel('user stopped waiting'); await delay(0)
  assert.equal(f.jobRecords[0].outcome.status, 'killed'); assert.match(f.jobRecords[0].outcome.detail, /后台生成可能继续/)
  assert.equal(f.trace.filter(value => value === 'invoke').length, 1); assert(f.trace.includes('unsubscribe'))
})
test('pre-dispatch caller cancellation submits zero, genuine user steering during confirmation invalidates the old approval', async () => {
  const controller = new AbortController(); controller.abort()
  const f = fixture(); assert.equal((await f.run(args, 'cancel', controller.signal)).status, 'rejected'); assert(!f.trace.includes('invoke'))
  let steer
  const waiting = fixture({ generation: { images: 31, videos: 0 }, ask: async () => { steer(); return { answers: [{ id: 'canvas-generation-volume', selected: ['确认生成'] }] } } })
  steer = () => waiting.human(2)
  assert.equal((await waiting.run()).error.code, 'COUNT_CHANGED'); assert(!waiting.trace.includes('invoke'))
})

test('cached terminal replay returns its correlated result without a second native invocation', async () => {
  const f = fixture({ cachedTerminal: true }), result = await f.run()
  assert.equal(result.status, 'submitted'); assert.equal(result.taskId, 'workflow-task')
  assert(!f.trace.includes('invoke')); assert(f.trace.includes('unsubscribe')); await delay(0)
  assert.equal(f.jobRecords[0].outcome.status, 'completed')
})
test('unknown state events keep the live observer, and partial results are counted honestly', async () => {
  const f = fixture({ generation: { images: 3, videos: 0 } }); await f.run()
  f.emit('submission_unknown'); assert.match(f.jobRecords[0].progress.at(-1), /未确认/)
  await complete(f); const output = JSON.parse(f.jobRecords[0].outcome.result)
  assert.equal(output.actualOutputCount, 1); assert.equal(output.requestedOutputCount, 3); assert.equal(output.partial, true)
  assert.match(f.jobRecords[0].outcome.detail, /未全部完成/)
})

test('partial native failure exposes fresh outputs without claiming complete success', async () => {
  const f = fixture({ generation: { images: 3, videos: 0 }, failureOutputs: ['https://assets.example/partial.png'] }); await f.run()
  f.emit('failed'); await delay(0); const output = JSON.parse(f.jobRecords[0].outcome.result)
  assert.equal(f.jobRecords[0].outcome.status, 'failed'); assert.equal(output.partial, true); assert.equal(output.actualOutputCount, 1)
  assert(f.jobRecords[0].outcome.detail.includes('已返回1/3个产物'))
})
test('deferred context presentation errors cannot turn a billable submission into effect none', async () => {
  const f = fixture({ deferError: true }), result = await f.run()
  assert.equal(result.status, 'submitted'); assert.equal(result.jobId, 'canvas-1'); await complete(f)
})


test('canvas products bind the original root call even when Jobs is unread and a later turn starts', async () => {
  const sources = []
  const f = fixture({ rootCallId: 'outer-ptc', turn: 3, results: { async record(binding, state) { sources.push({ binding, state }) } } })
  const result = await f.run(args, 'inner-canvas')
  f.rootCall('later-call', 4, 32)
  f.human(31)
  await complete(f)
  assert.equal(sources.length, 1)
  assert.deepEqual(sources[0].binding, { sessionId: 'session', ownerId: 'session', rootCallId: 'outer-ptc', callId: 'inner-canvas', turn: 3, rootCallSeq: 16, sessionCreatedAt: 1000 })
  assert.equal(sources[0].state.requestId, result.requestId + ':run')
  assert.deepEqual(sources[0].state.outputs, ['https://assets.example/new.png'])
  assert.equal(f.trace.filter(value => value === 'invoke').length, 1)
})

test('fast completion persists source and source write failure never changes the generated Job result', async () => {
  const sources = []
  const fast = fixture({ fastTerminal: true, results: { async record(binding, state) { sources.push({ binding, state }) } } })
  await fast.run(); await delay(0)
  assert.equal(sources.length, 1)
  assert.equal(fast.jobRecords[0].outcome.status, 'completed')
  const failed = fixture({ results: { async record() { throw new Error('storage offline') } } })
  await failed.run(); await complete(failed)
  assert.equal(failed.jobRecords[0].outcome.status, 'completed')
  assert.equal(failed.warnings.length, 1)
  assert.equal(failed.trace.filter(value => value === 'invoke').length, 1)
})

test('unconfirmed or empty generation results do not register canvas products', async () => {
  for (const phase of ['running', 'monitoring_unknown', 'submission_unknown', 'failed']) {
    const sources = []
    const f = fixture({ results: { async record(binding, state) { sources.push({ binding, state }) } } })
    await f.run(); f.emit(phase); await delay(0)
    assert.equal(sources.length, 0)
    f.dispose()
  }
})


for (const ending of ['monitoring_unknown', 'timeout', 'kill']) test('late confirmed product persists after ' + ending + ' without changing the settled Job or resubmitting', async () => {
  const sources = []
  const f = fixture({ timeouts: ending === 'timeout' ? { imageTimeoutMs: 3 } : undefined, results: { async record(binding, state) { sources.push({ binding, state }) } } })
  await f.run()
  if (ending === 'timeout') await delay(20)
  else if (ending === 'kill') { f.jobRecords[0].hooks.cancel(); await delay(0) }
  else { f.emit(ending); await delay(0) }
  const outcome = f.jobRecords[0].outcome
  assert.equal(outcome.status, ending === 'kill' ? 'killed' : 'failed')
  assert.equal(sources.length, 0); assert.equal(f.listenerCount, 1)
  await complete(f)
  assert.equal(sources.length, 1); assert.equal(f.listenerCount, 0)
  assert.equal(f.jobRecords[0].outcome, outcome)
  assert.equal(f.trace.filter(value => value === 'invoke').length, 1)
  f.dispose()
})

test('source observers release after synchronous terminal replay, rejected invoke and plugin disposal', async () => {
  const results = { async record() {} }
  const cached = fixture({ cachedTerminal: true, results }); await cached.run(); assert.equal(cached.listenerCount, 0)
  const rejected = fixture({ runRejected: true, results }); await rejected.run(); assert.equal(rejected.listenerCount, 0)
  const running = fixture({ results }); await running.run(); assert.equal(running.listenerCount, 2)
  running.dispose(); assert.equal(running.listenerCount, 0)
})


for (const nodeIds of [['target'], ['target', 'target-2']]) {
  const label = nodeIds.length === 1 ? 'single' : 'multiple'
  test(label + ' public receipt exposes a consistent job envelope and factual deferred context', async () => {
    const f = fixture()
    const result = await f.runRaw({ canvasId, nodeIds, expectedVersion: '12' }, 'raw-success')
    assert.equal(result.status, 'submitted')
    assert.equal(result.jobId, 'canvas-1')
    assert.deepEqual(result.nodeIds, nodeIds)
    assert.equal(result.nextIndex, nodeIds.length)
    assert.equal(result.version, '13')
    assert.deepEqual(result.results.map(item => item.jobId), nodeIds.map(() => result.jobId))
    assert.deepEqual(JSON.parse(f.contexts[0].content[0].text), { tool: 'canvas_run', jobId: result.jobId, canvasId, nodeIds, status: 'submitted', nextIndex: nodeIds.length })
    f.dispose()
  })
  test(label + ' public receipt keeps a zero-submission rejection rather than partial', async () => {
    const f = fixture({ runRejected: true })
    const result = await f.runRaw({ canvasId, nodeIds, expectedVersion: '12' }, 'raw-rejected')
    assert.equal(result.status, 'rejected')
    assert.equal(result.effect, 'none')
    assert.equal(result.error.code, 'COUNT_CHANGED')
    assert.equal(f.contexts.length, 0)
    assert.equal(f.invocations.length, 1)
    f.dispose()
  })
  for (const version of [null, '15']) test(label + ' unknown public receipt preserves actual version ' + version, async () => {
    const f = fixture({ runUnknownVersion: version })
    const result = await f.runRaw({ canvasId, nodeIds, expectedVersion: '12' }, 'raw-unknown')
    assert.equal(result.status, 'submission_unknown')
    assert.equal(result.version, version)
    assert.equal(result.jobId, 'canvas-1')
    assert.deepEqual(result.results.map(item => item.version), nodeIds.map(() => version))
    assert.deepEqual(result.results.map(item => item.jobId), nodeIds.map(() => result.jobId))
    assert(result.results.every(item => item.error.retry === 'never_auto'))
    assert.equal(result.nextIndex, 0)
    f.dispose()
  })
}


test('multiple cached terminal replays reuse the actual task without native resubmission', async () => {
  const nodeIds = ['target', 'target-2'], f = fixture({ cachedTerminal: true, cachedNodeIds: nodeIds })
  const result = await f.runRaw({ canvasId, nodeIds, expectedVersion: '12' })
  assert.equal(result.status, 'submitted')
  assert.equal(result.jobId, 'canvas-1')
  assert.equal(result.version, '14')
  assert(result.results.every(item => item.taskId === 'workflow-task'))
  assert.equal(result.nextIndex, 2)
  assert.equal(f.invocations.length, 0)
  assert.equal(f.listenerCount, 0)
  await delay(0)
  assert.equal(f.jobRecords[0].outcome.status, 'completed')
  f.dispose()
})
test('multiple product observers persist both original sources after Job kill', async () => {
  const sources = [], f = fixture({ results: { async record(binding, state) { sources.push({ binding, state }) } } })
  const nodeIds = ['target', 'target-2']
  const result = await f.runRaw({ canvasId, nodeIds, expectedVersion: '12' }, 'original-batch')
  assert.equal(f.listenerCount, 4)
  f.jobRecords[0].hooks.cancel(); await delay(0)
  const outcome = f.jobRecords[0].outcome
  assert.equal(outcome.status, 'killed')
  assert.equal(f.listenerCount, 2)
  f.human(30)
  for (const nodeId of nodeIds) f.emitNode(nodeId, 'completed')
  await delay(0)
  assert.deepEqual(sources.map(source => source.state.nodeId), nodeIds)
  assert(sources.every(source => source.binding.rootCallId === 'original-batch'))
  assert.equal(f.jobRecords[0].outcome, outcome)
  assert.equal(f.invocations.length, 1)
  assert.equal(f.listenerCount, 0)
  assert.equal(result.jobId, 'canvas-1')
  f.dispose()
})

for (const nodeIds of [['target'], ['target', 'target-2']]) test(nodeIds.length + '-node timeout keeps a factual per-node Job envelope and late source observers', async () => {
  const sources = [], f = fixture({ timeouts: { imageTimeoutMs: 3 }, results: { async record(binding, state) { sources.push({ binding, state }) } } })
  await f.runRaw({ canvasId, nodeIds, expectedVersion: '12' }, 'timeout-envelope')
  if (nodeIds.length > 1) f.emitNode('target', 'completed')
  await delay(20)
  const outcome = f.jobRecords[0].outcome, result = JSON.parse(outcome.result)
  assert.equal(outcome.status, 'failed')
  assert.equal(result.status, 'monitoring_unknown')
  assert.deepEqual(result.nodeIds, nodeIds)
  assert.deepEqual(result.results.map(item => item.nodeId), nodeIds)
  assert.equal(result.actualOutputCount, nodeIds.length - 1)
  assert.equal(result.requestedOutputCount, nodeIds.length)
  assert.equal(result.partial, nodeIds.length > 1)
  if (nodeIds.length > 1) {
    assert.equal(result.results[0].phase, 'completed')
    assert.equal(result.results[0].version, '14')
    assert.deepEqual(result.results[0].outputs, ['https://assets.example/new.png'])
  }
  const unknown = result.results.at(-1)
  assert.equal(unknown.status, 'submission_unknown')
  assert.equal(unknown.version, null)
  assert.equal(unknown.error.retry, 'never_auto')
  assert.equal(unknown.outputs, undefined)
  assert.equal(f.listenerCount, 1)
  if (nodeIds.length === 1) f.emit('completed')
  else f.emitNode('target-2', 'completed')
  await delay(0)
  assert.deepEqual(sources.map(source => source.state.nodeId), nodeIds)
  assert.equal(f.jobRecords[0].outcome, outcome)
  assert.equal(f.listenerCount, 0)
  assert.equal(f.invocations.length, 1)
  f.dispose()
})
