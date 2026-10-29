import assert from 'node:assert/strict'
import test from 'node:test'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { createCanvasResultStore } from '../src/host/canvas-result-store.ts'

const binding = { sessionId: 'session-1', ownerId: 'owner-1', rootCallId: 'root-1', callId: 'child-1', turn: 2, rootCallSeq: 7, sessionCreatedAt: 10 }
const state = { requestId: 'native-run:run', canvasId: '103161', nodeId: 'node-1', sequence: 4, phase: 'completed', version: '12',
  workflowTaskId: 'workflow-1', nodeTaskId: 'task-1', generation: { images: 1, videos: 0 }, outputs: ['https://assets.example/actual.png'] }

test('TTS source is persisted, notified and restored alongside historical image records', async () => {
  const f = fixture(), store = createCanvasResultStore(f.ctx), notices = []
  store.subscribe(binding.sessionId, source => notices.push(source))
  await store.record(binding, state)
  await store.record(binding, { ...state, requestId: 'tts', nodeId: 'tts-node', generation: { images: 0, videos: 0, audios: 1 }, outputs: ['https://assets.example/tts.mp3'] })
  assert.equal(notices.length, 2)
  const before = await store.list(binding.sessionId)
  assert.equal(before.sources.length, 2)
  assert.deepEqual(before.sources.find(source => source.requestId === 'tts').generation, { images: 0, videos: 0, audios: 1 })
  await store.close()
  const reopened = createCanvasResultStore(f.ctx)
  assert.deepEqual(await reopened.list(binding.sessionId), before)
  await reopened.close()
})

/** Memory medium only; the production DomainFacility supplies validation, write queue and durability semantics. */
export function fixture() {
  const documents = new Map()
  let failWrite = false, delayWrite
  const logs = [], writes = []
  const context = { logger: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) }, emit() {},
    storage: { backend: { get() { return { kv: { async open(descriptor) {
      const records = documents.get(descriptor.name) ?? { global: null, tables: { sources: {} } }
      documents.set(descriptor.name, records)
      return {
        async loadAll() { return structuredClone(records) },
        async putRecord(table, key, value) { if (delayWrite) await delayWrite; if (failWrite) throw new Error('medium unavailable'); records.tables[table][key] = structuredClone(value); writes.push(key) },
        async deleteRecord(table, key) { delete records.tables[table][key] }, async close() {},
        async backupRecord(table, key) { delete records.tables[table][key]; return 'test-backup' },
      }
    } } } } } } }
  const facility = new DomainFacility(context, { backend: 'test' })
  const ctx = { get(name) { return name === 'storageDomain' ? facility : undefined }, logger: context.logger }
  return { ctx, documents, writes, logs, failure(value) { failWrite = value }, delay(value) { delayWrite = value } }
}

test('durable source survives store close/reopen and deduplicates concurrent callbacks', async () => {
  const f = fixture(), store = createCanvasResultStore(f.ctx), notifications = []
  store.subscribe(binding.sessionId, value => notifications.push(value))
  await Promise.all(Array.from({ length: 20 }, () => store.record(binding, state)))
  assert.equal(f.writes.length, 1)
  assert.equal(notifications.length, 1)
  assert.deepEqual(notifications[0].outputs, state.outputs)
  assert.equal(notifications[0].rootCallSeq, 7)
  const first = await store.list(binding.sessionId)
  assert.equal(first.sources.length, 1)
  await store.close()
  const reopened = createCanvasResultStore(f.ctx)
  assert.deepEqual(await reopened.list(binding.sessionId), first)
  await reopened.record(binding, state)
  assert.equal(f.writes.length, 1)
  await reopened.close()
})

test('submission, unknown, old empty and non-canvas records are absent; failed partial retains real products', async () => {
  const f = fixture(), store = createCanvasResultStore(f.ctx)
  for (const phase of ['submitted', 'running', 'monitoring_unknown', 'submission_unknown']) await store.record(binding, { ...state, phase })
  await store.record(binding, { ...state, outputs: [] })
  assert.equal((await store.list(binding.sessionId)).sources.length, 0)
  await store.record(binding, { ...state, phase: 'failed', generation: { images: 2, videos: 0 } })
  const source = (await store.list(binding.sessionId)).sources[0]
  assert.equal(source.phase, 'failed')
  assert.equal(source.outputs.length, 1)
  assert.equal((await store.list('unrelated-session')).sources.length, 0)
  const otherProfile = createCanvasResultStore(fixture().ctx)
  assert.equal((await otherProfile.list(binding.sessionId)).sources.length, 0)
  await otherProfile.close(); await store.close()
})

test('persistence failure emits nothing, leaves no phantom source and does not prevent a later successful write', async () => {
  const f = fixture(), store = createCanvasResultStore(f.ctx), notices = []
  store.subscribe(binding.sessionId, value => notices.push(value))
  f.failure(true)
  await assert.rejects(store.record(binding, state), /medium unavailable/)
  assert.equal((await store.list(binding.sessionId)).sources.length, 0)
  assert.equal(notices.length, 0)
  f.failure(false)
  store.subscribe(binding.sessionId, () => { throw new Error('UI already closed') })
  await store.record(binding, state)
  assert.equal(notices.length, 1)
  assert.equal((await store.list(binding.sessionId)).sources.length, 1)
  assert.equal(f.logs.length, 1)
  await store.close()
})

test('stable pagination and visible original-root filtering preserve all historical sources', async () => {
  const store = createCanvasResultStore(fixture().ctx)
  for (let index = 0; index < 7; index++) await store.record({ ...binding, rootCallId: index % 2 ? 'root-2' : 'root-1' }, { ...state, requestId: 'run-' + index })
  const ids = new Set()
  let after
  do {
    const page = await store.list(binding.sessionId, { limit: 2, after })
    page.sources.forEach(source => ids.add(source.requestId)); after = page.nextCursor
  } while (after)
  assert.equal(ids.size, 7)
  assert.equal((await store.list(binding.sessionId, { visible: source => source.rootCallId === 'root-1' })).sources.length, 4)
  await assert.rejects(store.list(binding.sessionId, { after: 'not-a-cursor' }))
  await assert.rejects(store.list(binding.sessionId, { limit: 101 }))
  await store.close()
})

test('close rejects new work while draining admitted native durability writes', async () => {
  const f = fixture(), store = createCanvasResultStore(f.ctx)
  let release
  f.delay(new Promise(resolve => { release = resolve }))
  const write = store.record(binding, state)
  const closing = store.close()
  await assert.rejects(store.record(binding, { ...state, requestId: 'late' }), /closed/)
  release(); await write; await closing
  await assert.rejects(store.list(binding.sessionId), /closed/)
  const reopened = createCanvasResultStore(f.ctx)
  assert.equal((await reopened.list(binding.sessionId)).sources.length, 1)
  await reopened.close()
})


test('large multi-output sources obey the wire byte budget without discarding later pages', async () => {
  const store = createCanvasResultStore(fixture().ctx)
  const outputs = Array.from({ length: 20 }, (_, index) => 'https://assets.example/' + String(index) + 'x'.repeat(3980))
  for (let index = 0; index < 20; index++) await store.record(binding, { ...state, requestId: 'large-' + index, generation: { images: 20, videos: 0 }, outputs })
  const first = await store.list(binding.sessionId)
  assert.ok(first.nextCursor)
  assert.ok(first.sources.length < 20)
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 2 * 1024 * 1024)
  const second = await store.list(binding.sessionId, { after: first.nextCursor })
  assert.equal(first.sources.length + second.sources.length, 20)
  assert.equal(second.nextCursor, undefined)
  await store.close()
})


test('malformed private source records are backed up while valid historical sources still restore', async () => {
  const f = fixture(), store = createCanvasResultStore(f.ctx)
  await store.record(binding, state); await store.close()
  f.documents.get('desktop_canvas_results').tables.sources.invalid = { schemaVersion: 1, nodeId: 'forged' }
  const restored = createCanvasResultStore(f.ctx)
  const page = await restored.list(binding.sessionId)
  assert.equal(page.sources.length, 1)
  assert.equal(page.sources[0].nodeId, state.nodeId)
  assert.equal(f.documents.get('desktop_canvas_results').tables.sources.invalid, undefined)
  assert.equal(f.logs.length, 1)
  await restored.close()
})

test('synchronous process provenance persists operation identity without inventing a cloud task', async () => {
  const f = fixture(), store = createCanvasResultStore(f.ctx)
  const { workflowTaskId, nodeTaskId, ...base } = state
  await store.record(binding, { ...base, requestId: 'matting-operation:output:0', operationId: 'matting-operation', nodeId: 'actual-matting-output' })
  const first = await store.list(binding.sessionId)
  assert.equal(first.sources[0].operationId, 'matting-operation')
  assert.equal(first.sources[0].nodeId, 'actual-matting-output')
  assert.equal(first.sources[0].workflowTaskId, undefined)
  assert.equal(first.sources[0].nodeTaskId, undefined)
  await store.close()
  const reopened = createCanvasResultStore(f.ctx)
  assert.deepEqual(await reopened.list(binding.sessionId), first)
  await reopened.close()
})
