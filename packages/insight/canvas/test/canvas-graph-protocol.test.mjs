import assert from 'node:assert/strict'
import test from 'node:test'
import { assertCanvasResultMatches, isCanvasReadOperation, parseCanvasOperation, parseCanvasOperationResult, parseNodeConfiguration } from '../src/shared/canvas-agent-protocol.ts'
import { parseBridgeOperation, parseServiceHostEvent } from '../src/shared/canvas-bridge-protocol.ts'

const operations = [
  { action: 'canvas.graph.read', nodeOffset: 20, edgeOffset: 10, limit: 10, expectedVersion: '3' },
  { action: 'canvas.models.read', nodeType: 'image', modelType: 'image_to_image', model: 'model', modeOffset: 0, modelOffset: 20, limit: 10, expectedCatalogVersion: 'catalog' },
  { action: 'node.configure', expectedVersion: '3', nodeId: 'image', configuration: { modelType: 'image_to_image', model: 'model', params: { gen_count: 1 } } },
  { action: 'edge.add', expectedVersion: '3', connection: { sourceNodeId: 'image', targetNodeId: 'target' } },
  { action: 'edge.delete', expectedVersion: '3', edgeIds: ['edge'] },
  { action: 'edge.reconnect', expectedVersion: '3', edgeId: 'edge', connection: { sourceNodeId: 'image', targetNodeId: 'target', sourceHandle: 'image_source', targetHandle: 'image_target' } },
  { action: 'edge.reorder', expectedVersion: '3', targetNodeId: 'target', edgeIds: ['edge2', 'edge1'] },
  { action: 'canvas.models.read', nodeType: 'audio' },
  { action: 'canvas.voices.read', nodeType: 'audio', model: 'tts', voiceSource: 'public', page: 2, limit: 5 },
]

test('TTS voice queries and receipts bind model/source/identity and forbid mixed paging fields', () => {
  const operation = { action: 'canvas.voices.read', nodeType: 'audio', model: 'tts', voiceId: 'voice' }
  const result = { status: 'voices', canvasId: '103165', version: '3', consistency: 'confirmed', model: 'tts', source: 'public', page: 1, limit: 20, total: 1, nextPage: null,
    voices: [{ voiceId: 'voice', name: '音色', source: 'public', compatibility: 'model_declared' }] }
  assert.deepEqual(parseCanvasOperationResult(result), result)
  assert.doesNotThrow(() => assertCanvasResultMatches(operation, result))
  for (const extra of [{ nodeType: 'image' }, { page: 2 }, { name: 'query' }, { modelType: 'tts' }, { modeOffset: 0 }, { url: 'https://example.com' }]) {
    assert.throws(() => parseCanvasOperation({ ...operation, ...extra }), { code: 'INVALID_ARGUMENT' })
  }
  for (const extra of [{ model: 'other' }, { source: 'my' }, { total: 2 }, { page: 2 }, { nextPage: 2 }, { voices: [{ ...result.voices[0], voiceId: 'other' }] }]) {
    assert.throws(() => assertCanvasResultMatches(operation, { ...result, ...extra }), { code: 'INVALID_ARGUMENT' })
  }
})
test('graph save/read operations strictly preserve branch fields, and only read variants are read', () => {
  for (const operation of operations) {
    assert.deepEqual(parseCanvasOperation(operation), operation)
    assert.deepEqual(parseBridgeOperation(operation), operation)
    assert.equal(isCanvasReadOperation(operation), operation.action.startsWith('canvas.'))
  }
  assert.equal(isCanvasReadOperation({ action: 'canvas.read' }), true)
  assert.equal(parseBridgeOperation({ action: 'node.run', expectedVersion: '3', nodeId: 'n', approvedGeneration: { images: 1, videos: 0 } }).action, 'node.run')
})
test('configuration rejects unknown, nested and reserved keys while retaining scalar value types', () => {
  assert.deepEqual(parseNodeConfiguration({ params: { quality: 'medium', count: 1, fast: true, optional: null } }), { params: { quality: 'medium', count: 1, fast: true, optional: null } })
  for (const configuration of [{}, { model: '' }, { modelType: ' ' }, { params: {} }, { prompt: 'x' }, { params: { prompt: 'x' } }, { params: { model: 'x' } }, { params: { modelType: 'x' } }, { params: { array: [] } }, { params: { nested: {} } }, JSON.parse('{"params":{"__proto__":"x"}}')]) assert.throws(() => parseNodeConfiguration(configuration), { code: 'INVALID_ARGUMENT' })
})
test('pagination requires snapshot revisions and finite bounded integer offsets/limits', () => {
  for (const query of [
    { action: 'canvas.graph.read', nodeOffset: 1 }, { action: 'canvas.graph.read', edgeOffset: 1 },
    { action: 'canvas.graph.read', limit: 0 }, { action: 'canvas.graph.read', limit: 21 }, { action: 'canvas.graph.read', limit: 1.2 },
    { action: 'canvas.graph.read', nodeOffset: -1 }, { action: 'canvas.graph.read', edgeOffset: Infinity },
    { action: 'canvas.models.read', nodeType: 'image', modelOffset: 1 }, { action: 'canvas.models.read', nodeType: 'image', modeOffset: 1 },
    { action: 'canvas.models.read', nodeType: 'text' }, { action: 'canvas.models.read', nodeType: 'image', expectedCatalogVersion: '' },
  ]) assert.throws(() => parseCanvasOperation(query), { code: 'INVALID_ARGUMENT' })
  assert.deepEqual(parseCanvasOperation({ action: 'canvas.graph.read', nodeOffset: 0, edgeOffset: 0 }), { action: 'canvas.graph.read', nodeOffset: 0, edgeOffset: 0 })
})
test('edge arrays require unique bounded IDs; operations reject unrelated fields and missing handles', () => {
  for (const operation of [
    { ...operations[3], edgeId: 'forged' }, { ...operations[3], connection: { sourceNodeId: 'image', targetNodeId: 'target', sourceHandle: '' } },
    { ...operations[4], edgeIds: [] }, { ...operations[4], edgeIds: ['edge', 'edge'] }, { ...operations[4], edgeIds: Array.from({ length: 21 }, (_, i) => 'e' + i) },
    { ...operations[5], targetNodeId: 'bad' }, { ...operations[6], connection: operations[3].connection },
  ]) assert.throws(() => parseCanvasOperation(operation), { code: 'INVALID_ARGUMENT' })
})
test('graph/model receipts preserve bounded pages and true ports, never transport credentials', () => {
  const graph = { status: 'graph', canvasId: '103165', version: '3', consistency: 'confirmed', nodeCount: 1, edgeCount: 1, nodes: [{ id: 'image', type: 'image', title: 'image', position: { x: 0, y: 0 }, size: { width: 400, height: 400 }, parentId: null, ports: [{ id: 'image_target', type: 'target', mediaType: 'image', limit: null }], allowedInputTypes: ['text', 'image'], canConfigureGeneration: true }], edges: [{ id: 'edge', source: 'source', target: 'image', sourceHandle: 'image_source', targetHandle: 'image_target' }], nodeOffset: 0, edgeOffset: 0, nextNodeOffset: null, nextEdgeOffset: null }
  const models = { status: 'models', canvasId: '103165', version: '3', consistency: 'confirmed', catalogVersion: 'catalog', nodeType: 'image', modes: [{ value: 'image_to_image', label: '图生图' }], modeCount: 1, modeOffset: 0, nextModeOffset: null, modelType: 'image_to_image', models: [{ value: 'model', label: 'Model' }], modelCount: 1, modelOffset: 0, nextModelOffset: null, model: 'model', paramHints: [{ field: 'gen_count', choices: [1, '2'], editable: true }] }
  for (const result of [graph, models]) {
    assert.deepEqual(parseCanvasOperationResult(result), result)
    assert.throws(() => parseCanvasOperationResult({ ...result, token: 'private' }))
  }
  assert.throws(() => parseCanvasOperationResult({ ...graph, nodes: Array.from({ length: 21 }, () => graph.nodes[0]) }))
  assert.throws(() => parseCanvasOperationResult({ ...models, catalogVersion: '' }))
  const saved = { status: 'saved', canvasId: '103165', version: '4', affectedNodeIds: ['image'], affectedEdgeIds: ['edge'], warnings: ['mode mismatch'], unchanged: false }
  assert.deepEqual(parseCanvasOperationResult(saved), saved)
  const unknown = { ...saved, status: 'submission_unknown', version: null, phase: 'save', error: { code: 'SUBMISSION_UNKNOWN', message: 'unknown', retry: 'never_auto' } }
  delete unknown.unchanged; delete unknown.warnings
  assert.deepEqual(parseCanvasOperationResult(unknown), unknown)
})
test('refresh is read-only; edit prepare cannot force backend reload over user edits', () => {
  const base = { type: 'canvas.prepare', protocolVersion: 4, connectionId: 'c', sessionId: 's', canvasId: '103165', requestId: 'r', deadline: Date.now() + 1000 }
  assert.equal(parseServiceHostEvent({ ...base, capability: 'read', refresh: true }).refresh, true)
  assert.throws(() => parseServiceHostEvent({ ...base, capability: 'edit', refresh: true }), { code: 'INVALID_ARGUMENT' })
})
test('native composed edge IDs survive reads, mutations and save receipts without relaxing node IDs', () => {
  const source = '66d51f00-4c26-41c7-b429-ac27b2461bcc', target = '593474d6-0709-494f-9e84-cc0a6733820c'
  const edgeId = `xy-edge__${source}image_source-${target}image_target`
  assert.equal(edgeId.length, 106)
  for (const operation of [
    { action: 'edge.delete', expectedVersion: '31', edgeIds: [edgeId] },
    { action: 'edge.reorder', expectedVersion: '31', targetNodeId: target, edgeIds: [edgeId] },
    { action: 'edge.reconnect', expectedVersion: '31', edgeId, connection: { sourceNodeId: source, targetNodeId: target } },
  ]) assert.deepEqual(parseBridgeOperation(operation), operation)
  const detail = { id: target, type: 'textRedrawTool', title: '', contentType: null, text: null, prompt: null, params: {}, paramHints: [], status: 'success', inputs: [{ nodeId: source, edgeId, sourceHandle: 'image_source', targetHandle: 'image_target' }], outputs: [], generation: null, truncatedFields: [] }
  const read = { status: 'read', canvasId: '103334', version: '31', consistency: 'confirmed', nodeCount: 1, nodes: [detail], missingNodeIds: [] }
  assert.deepEqual(parseCanvasOperationResult(read), read)
  const graph = { status: 'graph', canvasId: '103334', version: '31', consistency: 'confirmed', nodeCount: 0, edgeCount: 1, nodes: [], edges: [{ id: edgeId, source, target, sourceHandle: 'image_source', targetHandle: 'image_target' }], nodeOffset: 0, edgeOffset: 0, nextNodeOffset: null, nextEdgeOffset: null }
  assert.deepEqual(parseCanvasOperationResult(graph), graph)
  const saved = { status: 'saved', canvasId: '103334', version: '32', affectedNodeIds: [target], affectedEdgeIds: [edgeId], unchanged: false }
  assert.deepEqual(parseCanvasOperationResult(saved), saved)
  for (const bad of ['', ' ', 'e'.repeat(1025)]) assert.throws(() => parseBridgeOperation({ action: 'edge.delete', expectedVersion: '31', edgeIds: [bad] }))
  assert.throws(() => parseCanvasOperationResult({ ...read, nodes: [{ ...detail, id: 'n'.repeat(101) }] }))
})

test('audio text parameter hints survive model and node receipts with bounded string metadata', () => {
  const hint = { field: 'lyrics', type: 'string', maxLength: 500, editable: true, default: '' }
  const catalog = { status: 'models', canvasId: '103165', version: '3', consistency: 'confirmed', catalogVersion: 'catalog', nodeType: 'audio', modes: [{ value: 'text_to_audio', label: '音乐' }], modeCount: 1, modeOffset: 0, nextModeOffset: null, modelType: 'text_to_audio', models: [{ value: 'music', label: 'Music' }], modelCount: 1, modelOffset: 0, nextModelOffset: null, model: 'music', paramHints: [], seniorParamHints: [hint] }
  const detail = { id: 'music', type: 'audio', title: '音乐', contentType: null, text: null, prompt: '轻快', params: { modelType: 'text_to_audio' }, paramHints: [], status: 'success', inputs: [], outputs: [], generation: { images: 0, videos: 0, audios: 1 }, truncatedFields: [], seniorParams: { lyrics: '' }, seniorParamHints: [hint] }
  const read = { status: 'read', canvasId: '103165', version: '3', consistency: 'confirmed', nodeCount: 1, nodes: [detail], missingNodeIds: [] }
  for (const result of [catalog, read]) assert.deepEqual(parseCanvasOperationResult(result), result)
  for (const invalid of [{ type: 'object' }, { maxLength: -1 }, { maxLength: 0.5 }, { maxLength: Infinity }]) {
    assert.throws(() => parseCanvasOperationResult({ ...catalog, seniorParamHints: [{ ...hint, ...invalid }] }))
    assert.throws(() => parseCanvasOperationResult({ ...read, nodes: [{ ...detail, seniorParamHints: [{ ...hint, ...invalid }] }] }))
  }
})
