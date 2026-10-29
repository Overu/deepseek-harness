import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCanvasResultEvent, parseCanvasResultSource } from '../src/shared/canvas-result-source.ts'

export const binding = { sessionId: 'session-1', ownerId: 'owner-1', rootCallId: 'root-1', callId: 'child-1', turn: 2, rootCallSeq: 7, sessionCreatedAt: 10 }
export const state = { requestId: 'native-run:run', canvasId: '103161', nodeId: 'node-1', sequence: 4, phase: 'completed', version: '12',
  workflowTaskId: 'workflow-1', nodeTaskId: 'task-1', generation: { images: 1, videos: 0 }, outputs: ['https://assets.example/actual.png'] }
const source = { ...binding, schemaVersion: 1, ...state, createdAt: 100 }
delete source.sequence

test('source contract retains native run/task identity and original ordered products', () => {
  const parsed = parseCanvasResultSource(source)
  assert.deepEqual(parsed, source)
  parsed.outputs.push('https://assets.example/other.png')
  assert.equal(source.outputs.length, 1)
  assert.deepEqual(parseCanvasResultEvent({ type: 'snapshot', sources: [source], nextCursor: 'abc' }), { type: 'snapshot', sources: [source], nextCursor: 'abc' })
  assert.deepEqual(parseCanvasResultEvent({ type: 'upsert', source }), { type: 'upsert', source })
})

test('unknown, empty, forged extra fields and unauthenticated URLs cannot become sources', () => {
  for (const patch of [{ phase: 'monitoring_unknown' }, { outputs: [] }, { generation: { images: 0, videos: 0 } }, { schemaVersion: 2 },
    { prompt: 'untrusted model text' }, { outputs: ['file:///tmp/result.png'] }, { outputs: ['https://assets.example/a?access_token=secret'] }, { rootCallSeq: -1 }]) {
    assert.throws(() => parseCanvasResultSource({ ...source, ...patch }))
  }
  const noNativeTask = { ...source }
  delete noNativeTask.workflowTaskId; delete noNativeTask.nodeTaskId
  assert.throws(() => parseCanvasResultSource(noNativeTask))
  assert.throws(() => parseCanvasResultEvent({ type: 'upsert', source, spoofed: true }))
  assert.throws(() => parseCanvasResultEvent({ type: 'snapshot', sources: Array.from({ length: 101 }, () => source) }))
})
