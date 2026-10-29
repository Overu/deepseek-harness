// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasContext } from '../src/canvas-context';
import type { Node } from '@xyflow/react';
const api = vi.hoisted(() => ({ graph: vi.fn(), models: vi.fn(), permission: vi.fn(), tools: vi.fn(), update: vi.fn(), invoke: vi.fn(), dimensions: vi.fn(), contexts: new Map<string, CanvasContext>() }));
vi.mock('@/api/workflow', () => ({ getFlowData: api.graph, getModelParams: api.models, listModelNodeSetting: api.permission, listToolNodeSetting: api.tools, updateCanvas: api.update, saveFlow: vi.fn(), excuteWorkFlow: api.invoke, fetchTone: vi.fn(), getAllRule: vi.fn() }));
vi.mock('@/components/canvasFlow/utils/mediaDimensionLoader', () => ({ loadIntrinsicMediaDimensions: api.dimensions }));
vi.mock('@/utils', () => ({ isSvgImageUrl: () => false, compressImage: vi.fn() }));
vi.mock('../src/canvas-context', async original => { const module = await original<typeof import('../src/canvas-context')>(); return { ...module, createCanvasContext: (...args: Parameters<typeof module.createCanvasContext>) => { const context = module.createCanvasContext(...args); api.contexts.set(args[0], context); return context; } }; });
import { createAgentAssetNode, describeAgentNode, type AgentNodeState } from '../src/agent-node-policy';
import { createCanvasServiceRuntime } from '../src/canvas-service';
import { parseCanvasOperationResult } from '../../src/shared/canvas-agent-protocol';
const services: ReturnType<typeof createCanvasServiceRuntime>[] = [];
const url = 'https://fixture.oss-cn-hangzhou.aliyuncs.com/upload/product.png';
const success = (data: unknown) => ({ code: 'SUCCESS', data });
const row = (nodes: Node[] = []) => success({ name: 'fixture', data: JSON.stringify({ nodes, edges: [] }), taskStatus: 'FINISHED', versionNumber: '18' });
const state = (nodes: Node[] = []): AgentNodeState => ({ nodes, edges: [], modelsMap: {}, modelNodePermission: null });
const operation = (expectedVersion = '18') => ({ action: 'asset.add' as const, expectedVersion, asset: { url, title: '商品实拍图' } });
const prepare = async () => { const rt = createCanvasServiceRuntime(); services.push(rt); await rt.ensureContext({ canvasId: '2873', capability: 'edit' }); return rt; };
const execute = (rt: ReturnType<typeof createCanvasServiceRuntime>, input = operation()) => rt.execute({ canvasId: '2873', operation: input });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
beforeEach(() => {
  vi.resetAllMocks(); api.contexts.clear(); vi.stubGlobal('BroadcastChannel', undefined);
  api.graph.mockResolvedValue(row()); api.models.mockResolvedValue(success([{ config: '{}' }]));
  api.permission.mockResolvedValue(success([])); api.tools.mockResolvedValue(success([]));
  api.update.mockResolvedValue(success({ versionNumber: '19' })); api.dimensions.mockResolvedValue(null);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => { services.splice(0).forEach(rt => rt.dispose()); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('native upload asset mapping', () => {
  it('constructs the native upload image with no generation configuration and no state mutation', () => {
    const before = state(); const node = createAgentAssetNode(before, { url, title: ' 商品实拍图 ', position: { x: 24, y: 36 } });
    expect(node).toMatchObject({ type: 'image', position: { x: 24, y: 36 }, data: { title: '商品实拍图', type: 'upload', value: url, product: [], tempFile: null, params: { model: '', modelType: '', prompt: '', gen_count: 1 }, taskInfo: { status: 'success' } } });
    expect(node.id).toBeTruthy(); expect(before).toEqual(state());
    expect(describeAgentNode({ ...before, nodes: [node] }, node)).toMatchObject({ contentType: 'upload', outputs: [url], generation: null, paramHints: [] });
  });
  it('reuses native title validation and leaves automatic naming to the Store', () => {
    const existing = createAgentAssetNode(state(), { url, title: '已存在' });
    for (const title of [' ', '已存在']) expect(() => createAgentAssetNode(state([existing]), { url, title })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(createAgentAssetNode(state(), { url })).not.toHaveProperty('titleAssignment');
  });
});

describe('headless asset save through the native Store', () => {
  it('returns a strict save and reads the same upload image without a view or generation', async () => {
    const rt = await prepare(); const saved = await execute(rt);
    expect(saved).toMatchObject({ status: 'saved', version: '19', unchanged: false });
    if (saved.status !== 'saved') throw new Error(JSON.stringify(saved));
    const id = saved.affectedNodeIds[0]; expect(saved.affectedNodeIds).toHaveLength(1);
    expect(api.update).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(api.update.mock.calls[0][0].addNodes[0]);
    expect(persisted).toMatchObject({ id, type: 'image', data: { type: 'upload', title: '商品实拍图', value: url, tempFile: null, product: [] } });
    expect(persisted).not.toHaveProperty('titleAssignment');
    const read = await rt.execute({ canvasId: '2873', operation: { action: 'canvas.read', nodeIds: [id] } });
    expect(read).toMatchObject({ status: 'read', version: '19', consistency: 'confirmed', nodes: [{ id, contentType: 'upload', outputs: [url], generation: null }] });
    for (const result of [saved, read]) expect(() => parseCanvasOperationResult(result)).not.toThrow();
    expect(api.invoke).not.toHaveBeenCalled(); expect(document.querySelectorAll('iframe')).toHaveLength(0);
  });
  it('does not require generation models or permissions to save a pure input image', async () => {
    api.models.mockRejectedValueOnce(new Error('models offline')); api.permission.mockRejectedValueOnce(new Error('permissions offline')); api.tools.mockRejectedValueOnce(new Error('tools offline'));
    const rt = await prepare(); expect(await execute(rt)).toMatchObject({ status: 'saved', version: '19' });
    expect(api.update).toHaveBeenCalledTimes(1); expect(api.invoke).not.toHaveBeenCalled();
  });
  it('rejects stale versions and active user edits before changing the graph', async () => {
    const rt = await prepare(); expect(await execute(rt, operation('old'))).toMatchObject({ status: 'rejected', effect: 'none', error: { code: 'VERSION_CONFLICT' } });
    const context = api.contexts.get('2873')!; context.guard.markEditorBusy('native-prompt', true);
    expect(await execute(rt)).toMatchObject({ status: 'rejected', effect: 'none', error: { code: 'EDITOR_BUSY' } });
    expect(api.update).not.toHaveBeenCalled(); expect(context.store.getState().nodes).toHaveLength(0);
  });
  it('rechecks the version after asynchronous native image preparation', async () => {
    const rt = await prepare(); const gate = deferred<null>(); api.dimensions.mockReturnValueOnce(gate.promise);
    const saving = execute(rt); await vi.waitFor(() => expect(api.dimensions).toHaveBeenCalled());
    const context = api.contexts.get('2873')!; context.store.getState().actions.setVersionNumber('20'); gate.resolve(null);
    expect(await saving).toMatchObject({ status: 'rejected', effect: 'none', error: { code: 'VERSION_CONFLICT' } });
    expect(api.update).not.toHaveBeenCalled(); expect(context.store.getState().nodes).toHaveLength(0);
  });
  it('retains an uncertain save and fences later asset additions instead of replaying', async () => {
    const rt = await prepare(); api.update.mockRejectedValueOnce(Object.assign(new Error('response lost'), { requestPhase: 'sent_unknown' }));
    const unknown = await execute(rt); expect(unknown).toMatchObject({ status: 'submission_unknown', phase: 'save', error: { code: 'SUBMISSION_UNKNOWN' } });
    expect(await execute(rt)).toMatchObject({ status: 'rejected', error: { code: 'SUBMISSION_UNKNOWN' } });
    expect(api.update).toHaveBeenCalledTimes(1); const optimisticNodes = api.contexts.get('2873')!.store.getState().nodes;
    expect(optimisticNodes).toHaveLength(1); expect(unknown).toMatchObject({ affectedNodeIds: [optimisticNodes[0].id] });
    expect(() => parseCanvasOperationResult(unknown)).not.toThrow();
  });
  it('rolls back an explicitly rejected save while preserving the old graph', async () => {
    const rt = await prepare(); api.update.mockRejectedValueOnce(Object.assign(new Error('denied'), { requestPhase: 'rejected', status: 403 }));
    expect(await execute(rt)).toMatchObject({ status: 'rejected', effect: 'none', error: { code: 'AUTH_REQUIRED' } });
    expect(api.update).toHaveBeenCalledTimes(1); expect(api.contexts.get('2873')!.store.getState().nodes).toHaveLength(0);
  });
});
