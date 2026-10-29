import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseCanvasOperation, parseCanvasReadiness,
  parseCanvasOperationResult, parseCanvasAsset, parseNodePlacement,
} from '../src/shared/canvas-agent-protocol.ts';

const update = { action: 'node.update', expectedVersion: '18', nodeId: 'n1', changes: { prompt: '缓慢移动' } };
const rejects = (fn, code = 'INVALID_ARGUMENT') => assert.throws(fn, error => error.code === code);

test('all five operations parse; read/delete IDs are deduplicated in order', () => {
  const operations = [
    { action: 'canvas.read', nodeIds: ['n2', 'n1', 'n2'] },
    { action: 'node.add', expectedVersion: '18', node: { type: 'image', position: { x: 0, y: -2 } } },
    update,
    { action: 'node.delete', expectedVersion: '18', nodeIds: ['n1'] },
    { action: 'node.run', expectedVersion: '18', nodeId: 'n1', approvedGeneration: { images: 2, videos: 0 } },
  ];
  for (const operation of operations) assert.equal(parseCanvasOperation(operation).action, operation.action);
  assert.deepEqual(parseCanvasOperation(operations[0]).nodeIds, ['n2', 'n1']);
});

test('unknown/conditional fields, empty changes and unsafe parameters are rejected', () => {
  for (const payload of [
    { ...update, action: 'template.run' }, { ...update, nodeIds: ['n1'] },
    { ...update, changes: {} }, { ...update, expectedVersion: '' },
    { ...update, expectedVersion: 'x'.repeat(101) }, { ...update, nodeId: 'x'.repeat(101) },
    { ...update, changes: { title: 'x'.repeat(101) } },
    { ...update, changes: { prompt: 'x'.repeat(32769) } },
    { ...update, changes: { params: { model: 'invented' } } },
    { ...update, changes: { params: { gen_count: Infinity } } },
    { ...update, changes: { params: { cameraControl: {} } } },
    { ...update, changes: JSON.parse('{"params":{"__proto__":"unsafe"}}') },
    { action: 'node.add', expectedVersion: '1', node: { type: 'image', id: 'forged' } },
    { action: 'node.add', expectedVersion: '1', node: { type: 'image', position: { x: NaN, y: 0 } } },
    { action: 'canvas.read', nodeIds: [] },
    { action: 'canvas.read', nodeIds: Array.from({ length: 21 }, (_, i) => String(i)) },
  ]) rejects(() => parseCanvasOperation(payload));
});

test('read/submitted/rejected/unknown results retain distinct persistence facts', () => {
  const base = { canvasId: '2873', version: '19' };
  const error = { code: 'SUBMISSION_UNKNOWN', message: '回执不确定', retry: 'never_auto' };
  const results = [
    { ...base, status: 'read', consistency: 'unconfirmed', nodeCount: 0, nodes: [], missingNodeIds: ['deleted'] },
    { ...base, status: 'submitted', nodeId: 'n1', taskId: 'task1', generation: { images: 1, videos: 0 } },
    { ...base, status: 'rejected', effect: 'none', error: { ...error, code: 'RUN_REJECTED', retry: 'after_input' } },
    { ...base, version: null, status: 'submission_unknown', phase: 'run', affectedNodeIds: ['n1'], nodeId: 'n1', generation: { images: 1, videos: 0 }, error },
  ];
  for (const result of results) assert.deepEqual(parseCanvasOperationResult(result), result);
  rejects(() => parseCanvasOperationResult({ ...results[1], taskId: '' }));
  rejects(() => parseCanvasOperationResult({ ...results[1], generation: { images: -1, videos: 0 } }));
  rejects(() => parseCanvasOperationResult({ ...results[3], error: { ...error, code: 'made_up' } }));
  rejects(() => parseCanvasOperationResult({ ...results[0], taskInfo: 'private' }));
});


test('image assets preserve HTTPS URLs, optional fields and the 4096 character boundary', () => {
  const asset = { url: 'https://assets.example/image.png?signature=abc%2Bdef', title: '商品实拍', position: { x: -12, y: 30 } };
  assert.deepEqual(parseCanvasOperation({ action: 'asset.add', expectedVersion: '18', asset }), { action: 'asset.add', expectedVersion: '18', asset });
  assert.deepEqual(parseCanvasAsset(asset), asset);
  const prefix = 'https://assets.example/';
  const boundary = prefix + 'a'.repeat(4096 - prefix.length);
  assert.equal(parseCanvasAsset({ url: boundary }).url.length, 4096);
  rejects(() => parseCanvasAsset({ url: boundary + 'a' }));
});

test('asset inputs reject non-HTTPS URLs, credentials, fragments and unsupported fields before dispatch', () => {
  for (const url of ['', '/image.png', 'http://assets.example/image.png', 'blob:https://assets.example/id', 'data:image/png;base64,aGVsbG8=', 'file:///tmp/image.png', 'https://user@assets.example/image.png', 'https://user:secret@assets.example/image.png', 'https://assets.example/image.png#preview', 'https://assets.example/image.png#', ' https://assets.example/image.png', 'https://assets.example/image.png ', '\nhttps://assets.example/image.png', null, 1]) {
    rejects(() => parseCanvasAsset({ url }));
    rejects(() => parseCanvasOperation({ action: 'asset.add', expectedVersion: '18', asset: { url } }));
  }
  for (const asset of [
    {}, { url: 'https://assets.example/image.png', type: 'image' },
    { url: 'https://assets.example/image.png', nodeId: 'forged' },
    { url: 'https://assets.example/image.png', title: 'x'.repeat(101) },
    { url: 'https://assets.example/image.png', position: { x: 0, y: Infinity } },
    { url: 'https://assets.example/image.png', position: { x: 0, y: 0, z: 1 } },
  ]) rejects(() => parseCanvasAsset(asset));
  const valid = { action: 'asset.add', expectedVersion: '18', asset: { url: 'https://assets.example/image.png' } };
  for (const input of [{ ...valid, expectedVersion: '' }, { ...valid, node: { type: 'image' } }, { ...valid, assetId: 'forged' }]) rejects(() => parseCanvasOperation(input));
});


test('placement modes preserve auto, exact zero and after without rewriting legacy coordinates', () => {
  for (const placement of [{ mode: 'auto' }, { mode: 'absolute', position: { x: 0, y: 0 } }, { mode: 'after', anchorNodeId: 'anchor' }]) {
    assert.deepEqual(parseNodePlacement(placement), placement);
    const node = { type: 'text', placement };
    assert.deepEqual(parseCanvasOperation({ action: 'node.add', expectedVersion: '1', node }).node, node);
    assert.deepEqual(parseCanvasAsset({ url: 'https://assets.example/image.png', placement }).placement, placement);
  }
  const legacy = { type: 'text', position: { x: 0, y: 0 } };
  assert.deepEqual(parseCanvasOperation({ action: 'node.add', expectedVersion: '1', node: legacy }).node, legacy);
});

test('placement rejects unsupported modes, mixed fields, nonfinite coordinates and invalid anchors', () => {
  for (const placement of [
    null, {}, { mode: 'grid' }, { mode: 'auto', position: { x: 0, y: 0 } },
    { mode: 'absolute' }, { mode: 'absolute', position: { x: 0, y: Infinity } },
    { mode: 'absolute', position: { x: NaN, y: 0 } }, { mode: 'absolute', position: { x: 0, y: 0, z: 1 } },
    { mode: 'after' }, { mode: 'after', anchorNodeId: '' }, { mode: 'after', anchorNodeId: ' ' },
    { mode: 'after', anchorNodeId: 'x'.repeat(101) }, { mode: 'after', anchorNodeId: 'anchor', extra: true },
  ]) {
    rejects(() => parseNodePlacement(placement));
    rejects(() => parseCanvasOperation({ action: 'node.add', expectedVersion: '1', node: { type: 'text', placement } }));
    rejects(() => parseCanvasAsset({ url: 'https://assets.example/image.png', placement }));
  }
  rejects(() => parseCanvasOperation({ action: 'node.add', expectedVersion: '1', node: { type: 'text', position: { x: 0, y: 0 }, placement: { mode: 'auto' } } }));
  rejects(() => parseCanvasAsset({ url: 'https://assets.example/image.png', position: { x: 0, y: 0 }, placement: { mode: 'auto' } }));
});

test('read details accept validated geometry while retaining compatibility with old receipts', () => {
  const node = { id: 'n1', type: 'text', title: 'text', contentType: null, text: 'text', prompt: '', params: {}, paramHints: [], status: 'success', inputs: [], outputs: [], generation: null, truncatedFields: [] };
  const read = { status: 'read', canvasId: '2873', version: '1', consistency: 'confirmed', nodeCount: 1, nodes: [node], missingNodeIds: [] };
  assert.deepEqual(parseCanvasOperationResult(read), read);
  const geometry = { ...node, position: { x: 0, y: -200 }, size: { width: 400, height: 200 }, parentId: null };
  assert.deepEqual(parseCanvasOperationResult({ ...read, nodes: [geometry] }).nodes[0], geometry);
  assert.equal(parseCanvasOperationResult({ ...read, nodes: [{ ...geometry, parentId: 'group' }] }).nodes[0].parentId, 'group');
  for (const extra of [
    { position: { x: NaN, y: 0 } }, { position: { x: 0, y: 0, z: 1 } },
    { size: { width: 0, height: 200 } }, { size: { width: 200, height: -1 } },
    { size: { width: Infinity, height: 200 } }, { size: { width: 200, height: 200, depth: 1 } },
    { parentId: '' }, { parentId: 'x'.repeat(101) },
  ]) rejects(() => parseCanvasOperationResult({ ...read, nodes: [{ ...geometry, ...extra }] }));
});


test('context readiness keeps complete capability and trusted version validation', () => {
  const state = { phase: 'ready', capabilities: { read: true, edit: true, run: true }, version: '18' };
  assert.deepEqual(parseCanvasReadiness(state), state);
  rejects(() => parseCanvasReadiness({ ...state, capabilities: { read: true } }));
  rejects(() => parseCanvasReadiness({ ...state, version: '' }));
});
