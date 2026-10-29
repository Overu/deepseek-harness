// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { CanvasContext } from '../src/canvas-context';
import type { Node } from '@xyflow/react';
const api = vi.hoisted(() => ({ graph: vi.fn(), models: vi.fn(), permission: vi.fn(), tools: vi.fn(), update: vi.fn(), invoke: vi.fn(), capacity: vi.fn(), balance: vi.fn(), cost: vi.fn(), dimensions: vi.fn(), voice: vi.fn(), voicePage: vi.fn(), myVoices: vi.fn(), contexts: new Map<string, CanvasContext>() }));
vi.mock('../legacy/src/api/tone', () => ({ fetchToneDetailByVoiceId: api.voice, fetchPublicToneList: api.voicePage, fetchUserTonePage: api.myVoices }));
vi.mock('@/api/workflow', () => ({ getFlowData: api.graph, getModelParams: api.models, listModelNodeSetting: api.permission, listToolNodeSetting: api.tools, updateCanvas: api.update, saveFlow: vi.fn(), excuteWorkFlow: api.invoke, fetchTone: vi.fn(), getAllRule: vi.fn() }));
vi.mock('@/api/asset', () => ({ getAvailableCapacity: api.capacity }));
vi.mock('@/api/order', () => ({ accountBalance: api.balance, calculateWorkflowCost: api.cost }));
vi.mock('@/components/canvasFlow/utils/mediaDimensionLoader', () => ({ loadIntrinsicMediaDimensions: api.dimensions }));
vi.mock('@/utils', () => ({ isSvgImageUrl: () => false, compressImage: vi.fn() }));
vi.mock('../src/canvas-context', async original => { const module = await original<typeof import('../src/canvas-context')>(); return { ...module, createCanvasContext: (...args: Parameters<typeof module.createCanvasContext>) => { const context = module.createCanvasContext(...args); api.contexts.set(args[0], context); return context; } }; });
import {registerCanvasTools} from '../../src/host/canvas-tools';
import { registerCanvasGraphTools } from '../../src/host/canvas-graph-tools';
import { registerCanvasAssetTools } from '../../src/host/canvas-asset-tools';
import { createCanvasAssetApi } from '../../src/host/canvas-assets';
import {createEmptyCanvas} from '../../src/host/canvas-api';
import {createCanvasHostBridge} from '../../src/host/canvas-bridge';
import {createCanvasCommandEndpoint} from '../../src/client/canvas-command-endpoint';
import { createCanvasServiceRuntime } from '../src/canvas-service';
import { parseCanvasOperationResult } from '../../src/shared/canvas-agent-protocol';
import { isAgentOperationBusy } from '../src/agent-edit-guard';
import { bindCanvasView } from '../src/canvas-service-binding';
import { useFlowStore } from '../legacy/src/store/flowStore';
import { usePointStore } from '../legacy/src/store/pointStore';
import { createWorkflowTabOwnership } from '../legacy/src/hooks/workflowTabOwnership';
import { audioNode, musicModel } from './audio-fixture';
const services: ReturnType<typeof createCanvasServiceRuntime>[] = [];
const success = (data: unknown) => ({ code: 'SUCCESS', data });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const model = { model_name: 'fixture', parameters: { gen_count: { default: 1, choices: [1,2].map(value => ({ value, label: String(value) })) } }, senoir_parameters: {} };
const ttsModel = { model_name: 'TTS', parameters: { voiceId: { default: 'voice-public', type: 'choices', choices: [{ value: 'voice-public', label: '测试音色' }] } }, senoir_parameters: {
  speed: { type: 'number', min: 0.5, max: 2, step: 0.1, default: 1 }, pitch: { type: 'number', min: -12, max: 12, step: 1, default: 0 },
  emotion: { type: 'choices', default: 'auto', choices: [{ value: 'auto', label: '自动' }, { value: 'calm', label: '平静' }] },
} };
const nativeMusicModel = { model_name: '音乐', parameters: Object.fromEntries(musicModel().params.map(({ field, ...definition }) => [field, definition])),
  senoir_parameters: Object.fromEntries(musicModel().seniorParams.map(({ field, ...definition }) => [field, definition])) };
const node = (type = 'text', id = 'n1'): Node => ({ id, type, position: { x: 0, y: 0 }, data: { title: id, params: { model: 'fixture', modelType: 'text_to_image', gen_count: 1, prompt: 'test' }, value: type === 'text' ? 'text' : '', taskInfo: { status: 'success' }, product: [] } });
const row = (nodes: Node[] = [], versionNumber = '18', taskStatus = 'FINISHED', edges: any[] = []) => success({ name: 'fixture', data: JSON.stringify({ nodes, edges }), taskStatus, versionNumber });
const service = () => { const value = createCanvasServiceRuntime(); services.push(value); return value; };
const prepare = async (nodes: Node[] = []) => { api.graph.mockResolvedValueOnce(row(nodes)); const rt = service(); await rt.ensureContext({ canvasId: '2873', capability: 'edit' }); return rt; };
const execute = (rt: ReturnType<typeof service>, operation: any) => rt.execute({ canvasId: '2873', operation });
const toolInput = (name: string, args: any) => {
  if (!['canvas_node_edit', 'canvas_edges'].includes(name) || !args.action) return args;
  const { canvasId, expectedVersion, action, ...fields } = args;
  const op = action === 'update' || action === 'reconnect' ? 'edit' : action === 'delete' ? 'remove' : action;
  const payload = action === 'delete' ? { [name === 'canvas_edges' ? 'edgeId' : 'nodeId']: (fields.edgeIds ?? fields.nodeIds)[0] } : fields;
  return { canvasId, expectedVersion, ops: [{ op, ...payload }] };
};
const toolResult = (value: string) => {
  const result = JSON.parse(value);
  return result.status === 'saved' && result.completed?.length === 1
    ? { ...result.completed[0].receipt, requestId: result.requestId, address: result.address }
    : result.failure && result.nextIndex === 0 ? { ...result.failure, requestId: result.requestId, address: result.address } : result;
};
beforeEach(() => {
  vi.resetAllMocks(); api.contexts.clear(); vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('crypto', webcrypto);
  api.graph.mockResolvedValue(row());
  api.models.mockResolvedValue(success([{ config: JSON.stringify({ text: { fixture: model }, image: { text_to_image: { name: 'fixture', models: { fixture: model } } }, video: { text_to_image: { name: 'fixture', models: { fixture: model } } }, audio: { tts: { name: 'fixture', models: { fixture: model, 'fixture-tts': ttsModel } }, text_to_audio: { name: '音乐', models: { 'fixture-music': nativeMusicModel } }, audio_to_audio: { name: '音乐参考', models: { 'fixture-cover': nativeMusicModel } } } }) }]));
  api.voice.mockResolvedValue(success({ voiceType: 'PUBLIC_VOICE', publicVoice: { voiceId: 'voice-public', name: '测试音色', onSale: 1 } }));
  api.voicePage.mockResolvedValue(success({ records: [{ voiceId: 'voice-public', name: '测试音色' }], total: 1 }));
  api.myVoices.mockResolvedValue(success({ records: [], total: 0 }));
  api.permission.mockResolvedValue(success([])); api.tools.mockResolvedValue(success([])); api.update.mockResolvedValue(success({ versionNumber: '19' }));
  api.invoke.mockResolvedValue(success({ versionNumber: '19', taskId: 'task-fixture' })); api.capacity.mockResolvedValue(success({ usedCapacity: 0, limitCapacity: 100 })); api.balance.mockResolvedValue(success({ rechargeBalance: 5 }));
  api.cost.mockResolvedValue(success(1));
  api.dimensions.mockResolvedValue(null);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => { services.splice(0).forEach(rt => rt.dispose()); document.body.innerHTML = ''; vi.useRealTimers(); vi.unstubAllGlobals(); });

function register(rt: ReturnType<typeof service>, viewId = 'view1') {
  const frame = document.createElement('iframe'); frame.src = `${location.origin}/desktop-canvas/view?id=2873&viewId=${viewId}`; document.body.append(frame);
  const release = rt.registerView({ canvasId: '2873', viewId, frame });
  return { frame, release, input: { canvasId: '2873', viewId, viewWindow: frame.contentWindow!, viewDocument: frame.contentDocument! } };
}

describe('complete no-view native canvas service', () => {
  it('reads an empty canvas and performs add/update/delete using exactly one native save each, without a view', async () => {
    const rt = await prepare(); const read = await execute(rt, { action: 'canvas.read' }); expect(read).toMatchObject({ status: 'read', nodes: [], nodeCount: 0 });
    const added = await execute(rt, { action: 'node.add', expectedVersion: '18', node: { type: 'text', changes: { title: '服务验收标题', text: 'a' } } });
    expect(added.status).toBe('saved'); if (added.status !== 'saved') throw new Error(JSON.stringify(added)); const id = added.affectedNodeIds[0];
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.contexts.get('2873')!.store.getState().nodes[0].data.title).toBe('服务验收标题');
    expect(JSON.parse(api.update.mock.calls[0][0].addNodes[0])).not.toHaveProperty('titleAssignment');
    api.update.mockResolvedValueOnce(success({ versionNumber: '20' }));
    const updated = await execute(rt, { action: 'node.update', expectedVersion: '19', nodeId: id, changes: { text: 'b' } }); expect(updated).toMatchObject({ status: 'saved', version: '20', affectedNodeIds: [id] });
    const detail = await execute(rt, { action: 'canvas.read', nodeIds: [id, 'missing'] }); expect(detail).toMatchObject({ nodes: [{ text: 'b' }], missingNodeIds: ['missing'] });
    api.update.mockResolvedValueOnce(success({ versionNumber: '21' })); const deleted = await execute(rt, { action: 'node.delete', expectedVersion: '20', nodeIds: [id] }); expect(deleted).toMatchObject({ status: 'saved', version: '21' });
    expect(api.update).toHaveBeenCalledTimes(3); expect(document.querySelectorAll('iframe')).toHaveLength(0);
    for (const result of [read, added, updated, detail, deleted]) expect(() => parseCanvasOperationResult(result)).not.toThrow();
  });
  it.each(['text','image','video','audio'])('creates %s with actual native defaults and no PromptModel', async type => {
    const rt = await prepare(); const result = await execute(rt, { action: 'node.add', expectedVersion: '18', node: { type, changes: { prompt: 'fixture' } } });
    expect(result.status).toBe('saved'); expect(api.contexts.get('2873')!.store.getState().nodes[0].data.params).toMatchObject({ model: 'fixture', prompt: 'fixture' }); expect(api.update).toHaveBeenCalledTimes(1);
  });
  it('validates version and busy state even for unchanged updates; unchanged sends nothing', async () => {
    const rt = await prepare([node()]); expect(await execute(rt, { action: 'node.update', expectedVersion: '18', nodeId: 'n1', changes: { text: 'text' } })).toMatchObject({ status: 'saved', unchanged: true, version: '18' });
    expect(api.update).not.toHaveBeenCalled(); expect(await execute(rt, { action: 'node.update', expectedVersion: 'old', nodeId: 'n1', changes: { text: 'text' } })).toMatchObject({ status: 'rejected', error: { code: 'VERSION_CONFLICT' } });
  });
  it('returns the response version even if another poll advances the Store before the adapter resumes', async () => {
    const rt = await prepare([node()]); const ctx = api.contexts.get('2873')!; let advanced = false;
    ctx.store.subscribe(state => { if (state.versionNumber === '19' && !advanced) { advanced = true; ctx.store.getState().actions.setVersionNumber('20'); } });
    expect(await execute(rt, { action: 'node.update', expectedVersion: '18', nodeId: 'n1', changes: { text: 'updated' } })).toMatchObject({ status: 'saved', version: '19' }); expect(ctx.store.getState().versionNumber).toBe('20');
  });
  it('delete includes the native empty parent group ID', async () => {
    const group = node('group','g'); const child = { ...node(), parentId: 'g' }; const rt = await prepare([group, child]);
    expect(await execute(rt, { action: 'node.delete', expectedVersion: '18', nodeIds: ['n1'] })).toMatchObject({ status: 'saved', affectedNodeIds: ['n1','g'] }); expect(api.update).toHaveBeenCalledTimes(1);
  });
  it('a failed model permission stage cannot authorize media parameter editing or media creation', async () => {
    api.permission.mockRejectedValueOnce(new Error('offline')); const rt = await prepare([node('image')]);
    expect(await execute(rt, { action: 'node.update', expectedVersion: '18', nodeId: 'n1', changes: { params: { gen_count: 2 } } })).toMatchObject({ status: 'rejected', error: { code: 'CONFIGURATION_ERROR' } });
    expect(await execute(rt, { action: 'node.add', expectedVersion: '18', node: { type: 'image' } })).toMatchObject({ status: 'rejected', error: { code: 'CONFIGURATION_ERROR' } }); expect(api.update).not.toHaveBeenCalled();
  });
  it('an unknown save is never reported saved and blocks later writes until authoritative reload', async () => {
    const rt = await prepare([node()]); api.update.mockRejectedValueOnce(Object.assign(new Error('response lost'), { requestPhase: 'sent_unknown' }));
    expect(await execute(rt, { action: 'node.update', expectedVersion: '18', nodeId: 'n1', changes: { text: 'unknown' } })).toMatchObject({ status: 'submission_unknown', phase: 'save' });
    expect(await execute(rt, { action: 'node.update', expectedVersion: '18', nodeId: 'n1', changes: { text: 'again' } })).toMatchObject({ status: 'rejected', error: { code: 'SUBMISSION_UNKNOWN' } }); expect(api.update).toHaveBeenCalledTimes(1);
    await rt.reloadContext({ canvasId: '2873', capability: 'edit' }); expect((await execute(rt, { action: 'canvas.read' })).status).toBe('read');
  });
  it('tracks asynchronous native node preparation before it enters the save queue', async () => {
    const rt = await prepare(); const ctx = api.contexts.get('2873')!; const gate = deferred<null>(); api.dimensions.mockReturnValueOnce(gate.promise);
    const newNode = node('image'); newNode.data.value = 'https://assets.example/file.png'; const add = ctx.store.getState().actions.addNode([newNode]);
    expect(ctx.store.getState().actions.hasPendingMutations()).toBe(true); await expect(rt.closeContext('2873')).rejects.toMatchObject({ code: 'EDITOR_BUSY' });
    await expect(ctx.reload('edit')).rejects.toMatchObject({ code: 'EDITOR_BUSY' }); gate.resolve(null); await add; expect(api.update).toHaveBeenCalledTimes(1);
  });
  it('disposed context ignores late native node preparation', async () => {
    const rt = await prepare(); const ctx = api.contexts.get('2873')!; const gate = deferred<null>(); api.dimensions.mockReturnValueOnce(gate.promise);
    const newNode = node('image'); newNode.data.value = 'https://assets.example/file.png'; const add = ctx.store.getState().actions.addNode([newNode]); rt.dispose(); gate.resolve(null);
    await expect(add).rejects.toMatchObject({ code: 'FRAME_GONE' }); expect(api.update).not.toHaveBeenCalled(); expect(ctx.store.getState().nodes).toEqual([]);
  });
  it('run is accepted only with taskId and exact response version; point failure does not undo acceptance', async () => {
    const rt = await prepare([node('image')]); api.balance.mockRejectedValue(new Error('points offline'));
    const result = await execute(rt, { action: 'node.run', expectedVersion: '18', nodeId: 'n1', approvedGeneration: { images: 1, videos: 0 } });
    expect(result).toMatchObject({ status: 'submitted', taskId: 'task-fixture', version: '19' }); expect(api.invoke).toHaveBeenCalledTimes(1);
    const ctx = api.contexts.get('2873')!; expect(ctx.store.getState().nodes[0].data.taskInfo).toMatchObject({ status: 'running' }); expect(ctx.guard.isOperationBusy()).toBe(false);
  });
  it.each([{ versionNumber: '19' }, { taskId: 'task-fixture' }])('incomplete accepted run %j is unknown and never retried', async data => {
    const rt = await prepare([node('image')]); api.invoke.mockResolvedValueOnce(success(data));
    expect(await execute(rt, { action: 'node.run', expectedVersion: '18', nodeId: 'n1', approvedGeneration: { images: 1, videos: 0 } })).toMatchObject({ status: 'submission_unknown', phase: 'run' });
    expect(api.invoke).toHaveBeenCalledTimes(1); expect(api.contexts.get('2873')!.store.getState().status).toBe('RUNNING');
  });
  it('checks generation count inside the native mutation queue after preflight', async () => {
    const rt = await prepare([node('image')]); const gate = deferred<any>(); api.capacity.mockReturnValueOnce(gate.promise);
    const running = execute(rt, { action: 'node.run', expectedVersion: '18', nodeId: 'n1', approvedGeneration: { images: 1, videos: 0 } });
    await vi.waitFor(() => expect(api.capacity).toHaveBeenCalled()); const ctx = api.contexts.get('2873')!; ctx.store.setState({ nodes: ctx.store.getState().nodes.map(n => ({ ...n, data: { ...n.data, params: { ...(n.data.params as object), gen_count: 2 } } })) });
    gate.resolve(success({ usedCapacity: 0, limitCapacity: 100 })); expect(await running).toMatchObject({ status: 'rejected', error: { code: 'COUNT_CHANGED' } }); expect(api.invoke).not.toHaveBeenCalled();
  });
  it('submits a workflow batch once and tracks every node by its child request ID', async () => {
    const rt = await prepare([node('image', 'n1'), node('video', 'n2')]); const ctx = api.contexts.get('2873')!;
    const result = await rt.execute({ canvasId: '2873', operation: {
      action: 'workflow.run', expectedVersion: '18', nodeIds: ['n1', 'n2'],
      approvedGenerations: { n1: { images: 1, videos: 0 }, n2: { images: 0, videos: 1 } },
      runRequestIds: { n1: 'batch-n1', n2: 'batch-n2' },
    } });
    expect(result).toMatchObject({ status: 'submitted', taskId: 'task-fixture', version: '19', nodeIds: ['n1', 'n2'] });
    expect(api.invoke).toHaveBeenCalledTimes(1);
    expect(ctx.getRun('batch-n1')).toMatchObject({ phase: 'submitted', nodeId: 'n1', generation: { images: 1, videos: 0 } });
    expect(ctx.getRun('batch-n2')).toMatchObject({ phase: 'submitted', nodeId: 'n2', generation: { images: 0, videos: 1 } });
  });
  it('marks every batch child unknown when an accepted native receipt is incomplete', async () => {
    const rt = await prepare([node('image', 'n1'), node('image', 'n2')]); const ctx = api.contexts.get('2873')!;
    api.invoke.mockResolvedValueOnce(success({ taskId: 'batch-task' }));
    const result = await rt.execute({ canvasId: '2873', operation: {
      action: 'workflow.run', expectedVersion: '18', nodeIds: ['n1', 'n2'],
      approvedGenerations: { n1: { images: 1, videos: 0 }, n2: { images: 1, videos: 0 } },
      runRequestIds: { n1: 'unknown-n1', n2: 'unknown-n2' },
    } });
    expect(result).toMatchObject({ status: 'submission_unknown', phase: 'run' });
    expect(ctx.getRun('unknown-n1')).toMatchObject({ phase: 'submission_unknown' });
    expect(ctx.getRun('unknown-n2')).toMatchObject({ phase: 'submission_unknown' });
    expect(ctx.store.getState().nodes.map(item => item.data.taskInfo)).toEqual([{ status: 'running' }, { status: 'running' }]);
  });
  it('discards every batch child when native execution explicitly rejects', async () => {
    const rt = await prepare([node('image', 'n1'), node('image', 'n2')]); const ctx = api.contexts.get('2873')!;
    api.invoke.mockResolvedValueOnce({ code: 'REJECTED', msg: 'rejected' });
    const result = await rt.execute({ canvasId: '2873', operation: {
      action: 'workflow.run', expectedVersion: '18', nodeIds: ['n1', 'n2'],
      approvedGenerations: { n1: { images: 1, videos: 0 }, n2: { images: 1, videos: 0 } },
      runRequestIds: { n1: 'reject-n1', n2: 'reject-n2' },
    } });
    expect(result).toMatchObject({ status: 'rejected', effect: 'none', error: { code: 'RUN_REJECTED' } });
    expect(ctx.getRun('reject-n1')).toBeNull(); expect(ctx.getRun('reject-n2')).toBeNull();
  });
});

describe('registered iframe binding and parent owned timers', () => {
  it.each([false, true])('creates and runs an image after closing the canvas (initializing=%s)', async initializing => {
    const rt = service(); const view = register(rt); const graph = deferred<any>();
    if (initializing) api.graph.mockReturnValueOnce(graph.promise);
    const attaching = rt.attachView(view.input);
    if (initializing) {
      const rejected = expect(attaching).rejects.toMatchObject({ code: 'FRAME_GONE' });
      view.release(); view.frame.remove(); graph.resolve(row()); await rejected;
    } else { await attaching; view.release(); view.frame.remove(); }
    await rt.ensureContext({ canvasId: '2873', capability: 'edit' });
    const created = await execute(rt, { action: 'node.add', expectedVersion: '18', node: { type: 'image', changes: { prompt: 'test' } } });
    expect(created.status).toBe('saved'); if (created.status !== 'saved') throw new Error(JSON.stringify(created));
    const nodeId = created.affectedNodeIds[0];
    api.invoke.mockResolvedValueOnce(success({ versionNumber: '20', taskId: 'task-after-close' }));
    expect(await execute(rt, { action: 'node.run', expectedVersion: '19', nodeId, approvedGeneration: { images: 1, videos: 0 } }))
      .toMatchObject({ status: 'submitted', nodeId, taskId: 'task-after-close' });
    expect(api.update).toHaveBeenCalledTimes(1); expect(api.invoke).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
  });
  it('uses one context/Store/points in parent and iframe hooks, with no second graph load', async () => {
    const rt = await prepare([node()]); const view = register(rt); const binding = await rt.attachView(view.input); const release = bindCanvasView(binding);
    expect(useFlowStore.getState()).toBe(api.contexts.get('2873')!.store.getState()); expect(usePointStore.getState()).toBe(binding.points.getState()); expect(api.graph).toHaveBeenCalledTimes(1);
    expect(await rt.attachView(view.input)).toBe(binding); release(); view.release(); expect(rt.getContextInfo('2873')?.readiness.phase).not.toBe('disposed');
  });
  it('ordinary dialogue updates preserve an attached native view without loading or recreating its Store', async () => {
    const copy = { ...node('text', 'copy'), data: { ...node('text').data, title: '头部文案', value: '轻巧随行，听见更多' } };
    const original = { ...node('image', 'original'), position: { x: 700, y: 0 }, width: 400, height: 400, measured: { width: 400, height: 400 },
      data: { ...node('image').data, title: '耳机原图', type: 'upload', value: 'https://assets.example/original.png',
        dimensionMeta: { sourceValue: 'https://assets.example/original.png', status: 'valid', mode: 'auto' } } };
    const poster = { ...node('image', 'poster'), position: { x: 1200, y: 0 }, data: { ...node('image').data, title: '头部卖点图' } };
    const rt = await prepare([copy, original, poster]); const context = api.contexts.get('2873')!;
    const view = register(rt); const binding = await rt.attachView(view.input); const release = bindCanvasView(binding);
    const contextId = binding.contextId; const sourceBefore = structuredClone(binding.store.getState().nodes.find(item => item.id === 'original')!);
    const phases: string[] = []; const unsubscribe = binding.subscribeReadiness(state => { phases.push(state.phase); });
    try {
      expect(binding.store).toBe(context.store); expect(useFlowStore.getState()).toBe(binding.store.getState());
      expect(api.graph).toHaveBeenCalledTimes(1); expect(api.update).not.toHaveBeenCalled();
      const updates = [
        { nodeId: 'copy', changes: { title: '头部文案-V2', text: '通勤轻负担，音乐随身听' } },
        { nodeId: 'original', changes: { title: '耳机参考实拍' } },
        { nodeId: 'poster', changes: { prompt: '保持参考商品外观，使用简洁背景，预留标题区域' } },
      ];
      for (const [index, update] of updates.entries()) {
        api.update.mockResolvedValueOnce(success({ versionNumber: String(19 + index) }));
        expect(await execute(rt, { action: 'node.update', expectedVersion: String(18 + index), ...update }))
          .toMatchObject({ status: 'saved', version: String(19 + index), affectedNodeIds: [update.nodeId] });
        expect(await execute(rt, { action: 'canvas.read', nodeIds: ['copy', 'original', 'poster'] }))
          .toMatchObject({ status: 'read', consistency: 'confirmed', version: String(19 + index) });
        expect(api.update).toHaveBeenCalledTimes(index + 1); expect(api.graph).toHaveBeenCalledTimes(1);
        expect(api.contexts.get('2873')).toBe(context); expect(binding.store).toBe(context.store);
        expect(useFlowStore.getState()).toBe(binding.store.getState()); expect(await rt.attachView(view.input)).toBe(binding);
        expect(rt.getContextInfo('2873')!.contextId).toBe(contextId); expect(document.querySelectorAll('iframe')).toHaveLength(1);
      }
      expect(await execute(rt, { action: 'canvas.read', nodeIds: ['copy', 'original', 'poster'] })).toMatchObject({ status: 'read', consistency: 'confirmed', version: '21', nodes: [
        { id: 'copy', title: '头部文案-V2', text: '通勤轻负担，音乐随身听' },
        { id: 'original', title: '耳机参考实拍', contentType: 'upload', outputs: [sourceBefore.data.value] },
        { id: 'poster', prompt: '保持参考商品外观，使用简洁背景，预留标题区域', outputs: [] },
      ] });
      const sourceAfter = binding.store.getState().nodes.find(item => item.id === 'original')!;
      expect(sourceAfter.data).toEqual({ ...sourceBefore.data, title: '耳机参考实拍' }); expect(sourceAfter.position).toEqual(sourceBefore.position);
      expect({ width: sourceAfter.width, height: sourceAfter.height, measured: sourceAfter.measured })
        .toEqual({ width: sourceBefore.width, height: sourceBefore.height, measured: sourceBefore.measured });
      expect(phases.length).toBeGreaterThan(0); expect(phases).not.toContain('loading');
      expect(api.graph).toHaveBeenCalledTimes(1); expect(api.update).toHaveBeenCalledTimes(3); expect(api.invoke).not.toHaveBeenCalled();
    } finally { unsubscribe(); release(); view.release(); }
  });
  it('rejects unregistered IDs, wrong window/document and cross-origin frame registration', async () => {
    const rt = await prepare(); const view = register(rt);
    await expect(rt.attachView({ ...view.input, viewId: 'fake' })).rejects.toMatchObject({ code: 'FRAME_GONE' });
    await expect(rt.attachView({ ...view.input, viewWindow: window })).rejects.toMatchObject({ code: 'FRAME_GONE' });
    await expect(rt.attachView({ ...view.input, viewDocument: document })).rejects.toMatchObject({ code: 'FRAME_GONE' });
    view.frame.src = 'https://other.example/desktop-canvas/view?id=2873&viewId=other'; expect(() => rt.registerView({ canvasId: '2873', viewId: 'other', frame: view.frame })).toThrow(); view.release();
  });
  it('closing a view leaves its final debounce and an in-flight Agent save alive', async () => {
    vi.useFakeTimers(); const rt = await prepare([node()]); const view = register(rt); const binding = await rt.attachView(view.input);
    const write = binding.createEditorDebounce('n1:text', text => { const current = binding.store.getState().nodes[0]; binding.store.getState().actions.updateNodeData('n1', { ...current.data, value: text }, false); }, 500);
    write('final input'); view.release(); view.frame.remove(); expect(api.contexts.get('2873')!.guard.isEditorBusy()).toBe(true);
    await vi.advanceTimersByTimeAsync(500); await binding.store.getState().actions.awaitMutationsIdle(); expect(binding.store.getState().nodes[0].data.value).toBe('final input'); expect(api.contexts.get('2873')!.guard.isEditorBusy()).toBe(false);
    const next = register(rt,'view2'); await rt.attachView(next.input); const gate = deferred<any>(); api.update.mockReturnValueOnce(gate.promise);
    const saving = execute(rt, { action: 'node.update', expectedVersion: '19', nodeId: 'n1', changes: { text: 'agent' } }); await vi.advanceTimersByTimeAsync(0); next.release(); next.frame.remove(); gate.resolve(success({ versionNumber: '20' })); expect(await saving).toMatchObject({ status: 'saved', version: '20' });
  });
  it('user drafts reject writes, while releasing transient view markers does not destroy other canvas guards', async () => {
    const rt = await prepare([node()]); const view = register(rt); const binding = await rt.attachView(view.input); binding.guard.markEditorBusy('draft', true);
    expect(await execute(rt, { action: 'node.update', expectedVersion: '18', nodeId: 'n1', changes: { text: 'agent' } })).toMatchObject({ status: 'rejected', error: { code: 'EDITOR_BUSY' } }); expect(api.update).not.toHaveBeenCalled(); view.release(); expect(api.contexts.get('2873')!.guard.isEditorBusy()).toBe(false);
  });
  it('only the latest same-context view stays editable and closeContext refuses registered views', async () => {
    const rt = await prepare(); const a = register(rt,'a'); const bindingA = await rt.attachView(a.input); const b = register(rt,'b'); const bindingB = await rt.attachView(b.input);
    expect(bindingA.getReadiness().phase).toBe('inactive'); expect(bindingB.getReadiness().capabilities.edit).toBe(true); expect(bindingA.store).toBe(bindingB.store);
    await expect(rt.closeContext('2873')).rejects.toMatchObject({ code: 'EDITOR_BUSY' }); a.release(); b.release(); await rt.closeContext('2873');
  });
  it('no-view native polling continues after detach and returns generated content', async () => {
    vi.useFakeTimers(); const media = node('image'); media.data.value = ''; const rt = await prepare([media]);
    await execute(rt, { action: 'node.run', expectedVersion: '18', nodeId: 'n1', approvedGeneration: { images: 1, videos: 0 } });
    const view = register(rt); await rt.attachView(view.input); view.release(); view.frame.remove();
    const result = { ...media, data: { ...media.data, value: 'https://assets.example/result.png' } }; api.graph.mockResolvedValueOnce(row([result], '20', 'SUCCESS'));
    await vi.advanceTimersByTimeAsync(200); expect(api.graph).toHaveBeenCalledTimes(2); expect(await execute(rt, { action: 'canvas.read' })).toMatchObject({ nodes: [{ outputs: ['https://assets.example/result.png'] }] });
  });
});

describe('native ownership protocol', () => {
  it('background service cannot steal; explicit user navigation cooperates with an idle owner', async () => {
    vi.useFakeTimers(); const channels = new Set<any>();
    class Channel {
      listeners = new Set<(event: any) => void>(); name: string;
      constructor(name: string) { this.name = name; channels.add(this); }
      postMessage(data: unknown) { channels.forEach(other => { if (other !== this && other.name === this.name) other.listeners.forEach((listener: any) => listener({ data })); }); }
      addEventListener(_name: string, listener: any) { this.listeners.add(listener); }
      removeEventListener(_name: string, listener: any) { this.listeners.delete(listener); }
      close() { channels.delete(this); }
    }
    vi.stubGlobal('BroadcastChannel', Channel); const aStatuses: string[] = []; const bStatuses: string[] = [];
    const a = createWorkflowTabOwnership('2873', value => aStatuses.push(value), false, () => true);
    const b = createWorkflowTabOwnership('2873', value => bStatuses.push(value), true);
    await b.ready; await vi.advanceTimersByTimeAsync(100); expect(a.getStatus()).toBe('active'); expect(b.getStatus()).toBe('inactive');
    await b.claim(); expect(b.getStatus()).toBe('active'); expect(a.getStatus()).toBe('inactive'); a.dispose(); b.dispose(); expect(channels.size).toBe(0);
  });
});

describe('review regressions', () => {
  it('concurrent attaches deduplicate the same document and all teardown is idempotent', async () => {
    const rt = await prepare(); const view = register(rt);
    const [a,b] = await Promise.all([rt.attachView(view.input),rt.attachView(view.input)]); expect(a).toBe(b); expect(api.graph).toHaveBeenCalledTimes(1); view.release(); view.release();
  });
  it('opening a view cannot silently reload an unknown save and erase its issue', async () => {
    const rt = await prepare([node()]); api.update.mockRejectedValueOnce(Object.assign(new Error('response lost'), { requestPhase: 'sent_unknown' }));
    await execute(rt, { action: 'node.update', expectedVersion: '18', nodeId: 'n1', changes: { text: 'unknown' } });
    const view = register(rt); const binding = await rt.attachView(view.input);
    expect(binding.getReadiness().reason?.code).toBe('SUBMISSION_UNKNOWN'); expect(api.graph).toHaveBeenCalledTimes(1); view.release();
  });
  it('inactive view subscriptions cannot erase the active view feedback', async () => {
    const rt = await prepare([node()]); const a = register(rt,'a'); const old = await rt.attachView(a.input);
    old.setFeedback({ error: vi.fn(), showCapacityLimit: vi.fn(), notifyAuthExpired: vi.fn(), notifyCanvasLoadError: vi.fn() });
    const b = register(rt,'b'); const current = await rt.attachView(b.input); const error = vi.fn();
    current.setFeedback({ error, showCapacityLimit: vi.fn(), notifyAuthExpired: vi.fn(), notifyCanvasLoadError: vi.fn() });
    api.update.mockRejectedValueOnce(Object.assign(new Error('native rejected'), { raw: { msg: 'native rejected' } }));
    current.store.getState().actions.updateNodeData('n1', { ...current.store.getState().nodes[0].data, value: 'native change' }); await current.store.getState().actions.awaitMutationsIdle(); expect(error).toHaveBeenCalledExactlyOnceWith('native rejected');
    a.release(); b.release();
  });
  it('missing per-type model configuration rejects generator creation without saving an unusable node', async () => {
    api.models.mockResolvedValueOnce(success([{ config: JSON.stringify({ text: { fixture: model } }) }])); const rt = await prepare();
    expect(await execute(rt, { action: 'node.add', expectedVersion: '18', node: { type: 'image' } })).toMatchObject({ status: 'rejected', error: { code: 'CONFIGURATION_ERROR' } }); expect(api.update).not.toHaveBeenCalled();
  });
  it('reads during optimistic native persistence are unconfirmed until saved', async () => {
    const rt = await prepare([node()]); const ctx = api.contexts.get('2873')!; const gate = deferred<any>(); api.update.mockReturnValueOnce(gate.promise);
    ctx.store.getState().actions.updateNodeData('n1', { ...ctx.store.getState().nodes[0].data, value: 'unsaved' });
    expect(await execute(rt, { action: 'canvas.read' })).toMatchObject({ status: 'read', consistency: 'unconfirmed' });
    gate.resolve(success({ versionNumber: '19' })); await ctx.store.getState().actions.awaitMutationsIdle(); expect(await execute(rt, { action: 'canvas.read' })).toMatchObject({ consistency: 'confirmed' });
  });
  it('a cancelled queued command never sends invoke even if its preflight later completes', async () => {
    const rt = await prepare([node('image')]); const gate = deferred<any>(); api.capacity.mockReturnValueOnce(gate.promise); const abort = new AbortController();
    const running = rt.execute({ canvasId: '2873', signal: abort.signal, operation: { action: 'node.run', expectedVersion: '18', nodeId: 'n1', approvedGeneration: { images: 1, videos: 0 } } });
    await vi.waitFor(() => expect(api.capacity).toHaveBeenCalled()); abort.abort(); gate.resolve(success({ usedCapacity: 0, limitCapacity: 100 }));
    expect(await running).toMatchObject({ status: 'rejected', error: { code: 'CANCELLED_BEFORE_DISPATCH' } }); expect(api.invoke).not.toHaveBeenCalled();
  });
  it('polling network errors follow native retry intervals but never claim a confirmed backend failure', async () => {
    vi.useFakeTimers(); const rt = await prepare([node('image')]); await execute(rt, { action: 'node.run', expectedVersion: '18', nodeId: 'n1', approvedGeneration: { images: 1, videos: 0 } });
    api.graph.mockRejectedValue(new Error('offline')); await vi.advanceTimersByTimeAsync(200); await vi.advanceTimersByTimeAsync(50_000);
    expect(api.graph).toHaveBeenCalledTimes(7); expect(api.contexts.get('2873')!.store.getState().status).toBe('FAILURE');
    expect(await execute(rt, { action: 'canvas.read' })).toMatchObject({ consistency: 'unconfirmed' }); expect(rt.getContextInfo('2873')!.readiness.capabilities.edit).toBe(false);
  });
});

it('a retired iframe module keeps its binding for callbacks which resolve the native Store hook later', async () => {
  vi.useFakeTimers(); const rt = await prepare([node()]); const view = register(rt); const binding = await rt.attachView(view.input); const release = bindCanvasView(binding);
  const write = binding.createEditorDebounce('n1:text', text => {
    const state = useFlowStore.getState(); const current = state.nodes.find(node => node.id === 'n1')!;
    state.actions.updateNodeData('n1', { ...current.data, value: text });
  }, 500);
  write('last iframe input'); release(true); view.release(); view.frame.remove();
  try { await vi.advanceTimersByTimeAsync(500); await binding.store.getState().actions.awaitMutationsIdle(); expect(binding.store.getState().nodes[0].data.value).toBe('last iframe input'); expect(api.update).toHaveBeenCalledTimes(1); }
  finally { release(); }
});

it('a native UI success without a trusted response version preserves UI data but fences future Agent writes', async () => {
  const rt = await prepare([node()]); const ctx = api.contexts.get('2873')!; api.update.mockResolvedValueOnce(success({}));
  ctx.store.getState().actions.updateNodeData('n1', { ...ctx.store.getState().nodes[0].data, value: 'native success' }); await ctx.store.getState().actions.awaitMutationsIdle();
  expect(ctx.store.getState().nodes[0].data.value).toBe('native success'); expect(ctx.store.getState().agentPersistenceIssue?.code).toBe('SUBMISSION_UNKNOWN');
  expect(await execute(rt, { action: 'node.update', expectedVersion: '18', nodeId: 'n1', changes: { text: 'cannot trust old version' } })).toMatchObject({ status: 'rejected', error: { code: 'SUBMISSION_UNKNOWN' } }); expect(api.update).toHaveBeenCalledTimes(1);
});

it('missing run inputs are rejected before invoke, and failed preflight does not show a UI dialog', async () => {
  const empty = node('image'); empty.data.params = { ...(empty.data.params as object), prompt: '' }; const rt = await prepare([empty]);
  expect(await execute(rt, { action: 'node.run', expectedVersion: '18', nodeId: 'n1', approvedGeneration: { images: 1, videos: 0 } })).toMatchObject({ status: 'rejected', error: { code: 'RUN_REJECTED' } }); expect(api.invoke).not.toHaveBeenCalled();
});

it('an auth failure in one canvas revokes cached access to all contexts in the same Client account', async () => {
  const rt = await prepare(); await rt.ensureContext({ canvasId: '2874', capability: 'read' });
  api.graph.mockImplementationOnce((_input: unknown, options: { onAuthExpired: () => void }) => { options.onAuthExpired(); return Promise.reject(Object.assign(new Error('expired'), {status:401})); });
  await expect(rt.reloadContext({canvasId:'2873',capability:'read'})).rejects.toMatchObject({code:'AUTH_REQUIRED'});
  expect(rt.getContextInfo('2874')!.readiness.capabilities.read).toBe(false);
});

it('native prompt guard snapshots observe the bound context busy state, not the standalone guard', async () => {
  const rt = await prepare([node()]); const view = register(rt); const binding = await rt.attachView(view.input); const release = bindCanvasView(binding); const gate = deferred<any>(); api.update.mockReturnValueOnce(gate.promise);
  const save = binding.store.getState().actions.updateNodeData('n1', {value:'agent saving'}, true, true, {strictReceipt:true,expectedVersion:'18'});
  try { expect(isAgentOperationBusy()).toBe(true); await vi.waitFor(() => expect(api.update).toHaveBeenCalled()); }
  finally { gate.resolve(success({versionNumber:'19'})); await save; expect(isAgentOperationBusy()).toBe(false); release(); view.release(); }
});

it('retired view readiness cannot advertise readable data after the Client runtime is disposed', async () => {
  const rt = await prepare(); const view = register(rt); const binding = await rt.attachView(view.input); rt.dispose();
  expect(binding.getReadiness()).toMatchObject({phase:'disposed',capabilities:{read:false,edit:false,run:false}});
});

it('parent cleanup removes native Store, point and editor subscriptions even without iframe React unmount', async () => {
  const rt = await prepare([node()]); const view = register(rt); const binding = await rt.attachView(view.input); const release = bindCanvasView(binding);
  const flow = vi.fn(); const point = vi.fn(); const editor = vi.fn();
  useFlowStore.subscribe(flow); usePointStore.subscribe(point); binding.guard.subscribeEditors(editor);
  binding.store.getState().actions.setZoom(2); binding.points.getState().actions.setPoint(1); binding.guard.markEditorBusy('draft',true);
  expect(flow).toHaveBeenCalledTimes(1); expect(point).toHaveBeenCalledTimes(1); expect(editor).toHaveBeenCalledTimes(1);
  view.release(); binding.store.getState().actions.setZoom(3); binding.points.getState().actions.setPoint(2); api.contexts.get('2873')!.guard.markEditorBusy('test',true);
  expect(flow).toHaveBeenCalledTimes(1); expect(point).toHaveBeenCalledTimes(1); expect(editor).toHaveBeenCalledTimes(1); release();
});

it('native generation preflight blocks Agent edits before the user request reaches the mutation queue', async () => {
  const rt = await prepare([node('image')]); const ctx = api.contexts.get('2873')!; const gate = deferred<any>(); api.capacity.mockReturnValueOnce(gate.promise);
  const running = ctx.store.getState().actions.excuteSingle('n1');
  try { expect(ctx.guard.isEditorBusy()).toBe(true); expect(await execute(rt, {action:'node.update',expectedVersion:'18',nodeId:'n1',changes:{prompt:'must not replace user run'}})).toMatchObject({status:'rejected',error:{code:'EDITOR_BUSY'}}); expect(api.update).not.toHaveBeenCalled(); }
  finally { gate.resolve(success({usedCapacity:0,limitCapacity:100})); await running; expect(ctx.guard.isEditorBusy()).toBe(false); }
});

it('late retired view markers and feedback cannot affect its replacement document', async () => {
  const rt = await prepare([node()]); const a = register(rt); const old = await rt.attachView(a.input); old.release();
  const fresh = await rt.attachView(a.input); const error = vi.fn(); fresh.setFeedback({error,showCapacityLimit:vi.fn(),notifyAuthExpired:vi.fn(),notifyCanvasLoadError:vi.fn()});
  old.guard.markEditorBusy('retired',true); old.setFeedback({error:vi.fn(),showCapacityLimit:vi.fn(),notifyAuthExpired:vi.fn(),notifyCanvasLoadError:vi.fn()});
  expect(api.contexts.get('2873')!.guard.isEditorBusy()).toBe(false);
  api.update.mockRejectedValueOnce(Object.assign(new Error('fresh error'),{raw:{msg:'fresh error'}})); fresh.store.getState().actions.updateNodeData('n1',{...fresh.store.getState().nodes[0].data,value:'fresh'}); await fresh.store.getState().actions.awaitMutationsIdle(); expect(error).toHaveBeenCalledExactlyOnceWith('fresh error'); a.release();
});

it('Host/service endpoint wire creates and reads one native saved node with no iframe and no duplicate save', async () => {
  const rt=service();const host=createCanvasHostBridge();const origin='http://127.0.0.1:3000';const registration=host.attachClient(origin, 'fixture-client', 'web-locks-v1')
  const endpoint=createCanvasCommandEndpoint({connectionId:registration.connectionId,getRuntime:async()=>rt,isSessionBound:()=>true,send:event=>host.acceptClientEvent(registration.bridgeKey,origin,event)})
  const disconnect=host.connectStream(registration.bridgeKey,origin,event=>{void endpoint.handle(event)})
  host.acceptClientEvent(registration.bridgeKey,origin,{type:'session.sync',protocolVersion:4,connectionId:registration.connectionId,revision:1,sessionIds:['fixture-session']})
  try {
    const target=await host.ensureContext('fixture-session','2873','edit','prepare')
    const operation={action:'node.add' as const,expectedVersion:'18',node:{type:'text' as const,changes:{title:'对话桥验收',text:'原生保存'}}}
    const saved=await host.dispatch(target,'add',operation)
    expect(saved).toMatchObject({status:'saved',version:'19'});expect(await host.dispatch(target,'add',operation)).toEqual(saved)
    const read=await host.dispatch(target,'read',{action:'canvas.read'})
    expect(read).toMatchObject({status:'read',consistency:'confirmed',version:'19',nodes:[{title:'对话桥验收',text:'原生保存'}]})
    expect(api.update).toHaveBeenCalledTimes(1);expect(api.graph).toHaveBeenCalledTimes(1);expect(document.querySelectorAll('iframe')).toHaveLength(0)
    expect(await host.dispatch(target,'stale-add',operation)).toMatchObject({status:'rejected',error:{code:'VERSION_CONFLICT'}})
    expect(api.update).toHaveBeenCalledTimes(1)
  } finally {disconnect();endpoint.dispose();host.dispose()}
})
it('fixed context execution refuses a released generation without creating a replacement Store', async () => {
  const rt=await prepare();const expectedContextId=rt.getContextInfo('2873')!.contextId;await rt.closeContext('2873')
  await expect(rt.execute({canvasId:'2873',expectedContextId,operation:{action:'node.add',expectedVersion:'18',node:{type:'text'}}})).rejects.toMatchObject({code:'CONTEXT_GONE',requestPhase:'not_sent'})
  expect(rt.getContextInfo('2873')).toBeNull();expect(api.update).not.toHaveBeenCalled();expect(api.graph).toHaveBeenCalledTimes(1)
})
it('endpoint cannot recreate a Store when a synchronous started callback releases its checked context', async () => {
  const rt=await prepare();const contextId=rt.getContextInfo('2873')!.contextId;const sent:any[]=[]
  const endpoint=createCanvasCommandEndpoint({connectionId:'connection',getRuntime:async()=>rt,isSessionBound:()=>true,send:event=>{sent.push(event);if(event.type==='canvas.command.ack'&&event.phase==='started')void rt.closeContext('2873')}})
  try {
    await endpoint.handle({type:'canvas.command',protocolVersion:4,connectionId:'connection',sessionId:'session',canvasId:'2873',contextId,requestId:'add',deadline:Date.now()+30000,payload:{action:'node.add',expectedVersion:'18',node:{type:'text'}}})
    expect(sent.at(-1)).toMatchObject({phase:'settled',result:{status:'rejected',error:{code:'CONTEXT_GONE'}}})
    expect(rt.getContextInfo('2873')).toBeNull();expect(api.update).not.toHaveBeenCalled();expect(api.graph).toHaveBeenCalledTimes(1)
  } finally {endpoint.dispose()}
})

it('registered dialogue tools create, read, add once and reload through the native Store without an iframe', async () => {
  api.graph.mockResolvedValue(row([], '0')); api.update.mockResolvedValue(success({ versionNumber: '1' }));
  const rt = service(); const host = createCanvasHostBridge(); const origin = 'http://127.0.0.1:3000';
  const registration = host.attachClient(origin, 'tool-client', 'web-locks-v1');
  const endpoint = createCanvasCommandEndpoint({ connectionId: registration.connectionId, getRuntime: async () => rt, isSessionBound: id => id === 'tool-session', send: event => host.acceptClientEvent(registration.bridgeKey, origin, event) });
  const disconnect = host.connectStream(registration.bridgeKey, origin, event => { void endpoint.handle(event); });
  host.acceptClientEvent(registration.bridgeKey, origin, { type: 'session.sync', protocolVersion: 4, connectionId: registration.connectionId, revision: 1, sessionIds: ['tool-session'] });
  const definitions = new Map<string, any>(); const cleanups: Array<() => void> = []; const requests: any[] = [];
  registerCanvasTools({ tools: { register: (definition: any) => { definitions.set(definition.name, definition); return () => definitions.delete(definition.name); } }, effect: (fn: any) => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); } } as any, host, {
    createCanvas: (name, signal) => createEmptyCanvas(name, signal, { tokenProvider: async () => 'fixture-token', transport: async (url, init) => { requests.push({ url, body: JSON.parse(init!.body as string) }); return new Response(JSON.stringify(success({ id: '2873', versionNumber: 0 }))); } }),
  });
  const run = async (name: string, args: any, callId: string) => toolResult(await definitions.get(name).execute(toolInput(name, args), { callId, agent: { id: 'tool-session' }, signal: new AbortController().signal }));
  try {
    const created = await run('canvas_create', { name: 'Agent验收' }, 'create');
    expect(created).toMatchObject({ status: 'created', canvasId: '2873', runtime: 'ready', version: '0' });
    expect(await run('canvas_create', { name: 'Agent验收' }, 'create')).toEqual(created); expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({ name: 'Agent验收', temp: false, canvasType: 0, version: 'comfyui', data: '{"nodes":[],"edges":[]}' });
    const empty = await run('canvas_get', { canvasId: created.canvasId, view: 'nodes' }, 'read-empty');
    expect(empty).toMatchObject({ status: 'read', version: '0', consistency: 'confirmed', nodes: [], source: 'plugin-service' });
    const args = { canvasId: created.canvasId, expectedVersion: empty.version, action: 'add', node: { type: 'text', changes: { title: '测试文本', text: '通过Agent对话创建并保存' } } };
    const [saved, same] = await Promise.all([run('canvas_node_edit', args, 'add'), run('canvas_node_edit', args, 'add')]);
    expect(saved).toMatchObject({ status: 'saved', version: '1' }); expect(same).toEqual(saved); expect(api.update).toHaveBeenCalledTimes(1);
    const nativeNodes = api.contexts.get('2873')!.store.getState().nodes;
    expect(nativeNodes[0].id).toBe(saved.affectedNodeIds[0]); expect(nativeNodes[0].data.value).toBe('通过Agent对话创建并保存');
    api.graph.mockResolvedValue(row(nativeNodes, '1')); const readsBeforeRefresh = api.graph.mock.calls.length;
    const persisted = await run('canvas_get', { canvasId: '2873', view: 'nodes', nodeIds: saved.affectedNodeIds, refresh: true }, 'reload');
    expect(persisted).toMatchObject({ status: 'read', consistency: 'confirmed', version: '1', nodes: [{ id: saved.affectedNodeIds[0], title: '测试文本', text: '通过Agent对话创建并保存' }] });
    expect(api.graph).toHaveBeenCalledTimes(readsBeforeRefresh + 1); expect(api.update).toHaveBeenCalledTimes(1); expect(api.invoke).not.toHaveBeenCalled(); expect(document.querySelectorAll('iframe')).toHaveLength(0);
    expect(await run('canvas_node_edit', { ...args, node: { type: 'text', changes: { text: 'different' } } }, 'add')).toMatchObject({ status: 'rejected', error: { code: 'DUPLICATE_REQUEST_MISMATCH' } });
    expect(api.update).toHaveBeenCalledTimes(1);
  } finally { cleanups.forEach(cleanup => cleanup()); disconnect(); endpoint.dispose(); host.dispose(); }
});

it('registered add tool preserves native unknown receipts and does not repeat the save', async () => {
  const rt = service(); const host = createCanvasHostBridge(); const origin = 'http://127.0.0.1:3000'; const registration = host.attachClient(origin, 'unknown-tool-client', 'web-locks-v1');
  const endpoint = createCanvasCommandEndpoint({ connectionId: registration.connectionId, getRuntime: async () => rt, isSessionBound: () => true, send: event => host.acceptClientEvent(registration.bridgeKey, origin, event) });
  const disconnect = host.connectStream(registration.bridgeKey, origin, event => { void endpoint.handle(event); });
  host.acceptClientEvent(registration.bridgeKey, origin, { type: 'session.sync', protocolVersion: 4, connectionId: registration.connectionId, revision: 1, sessionIds: ['tool-session'] });
  const definitions = new Map<string, any>(); const cleanups: Array<() => void> = [];
  registerCanvasTools({ tools: { register: (definition: any) => { definitions.set(definition.name, definition); return () => undefined; } }, effect: (fn: any) => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); } } as any, host);
  const run = async (callId: string) => toolResult(await definitions.get('canvas_node_edit').execute(toolInput('canvas_node_edit', { canvasId: '2873', expectedVersion: '18', action: 'add', node: { type: 'text', changes: { text: 'unknown' } } }), { callId, agent: { id: 'tool-session' }, signal: new AbortController().signal }));
  try {
    api.update.mockRejectedValueOnce(Object.assign(new Error('response lost'), { requestPhase: 'sent_unknown' }));
    const result = await run('unknown-add'); expect(result).toMatchObject({ status: 'submission_unknown', error: { retry: 'never_auto' } });
    expect(await run('unknown-add')).toEqual(result); expect(await run('new-add')).toMatchObject({ status: 'rejected', error: { code: 'SUBMISSION_UNKNOWN' } });
    expect(api.update).toHaveBeenCalledTimes(1); expect(api.invoke).not.toHaveBeenCalled(); expect(document.querySelectorAll('iframe')).toHaveLength(0);
  } finally { cleanups.forEach(cleanup => cleanup()); disconnect(); endpoint.dispose(); host.dispose(); }
});


it('four workspace media types cross Host/Client, save native nodes, and survive authoritative reload without a view', async () => {
  const files = new Map<string, Uint8Array>([
    ['/workspace/copy.md', Buffer.from('通勤轻负担\n音乐随身听')],
    ['/workspace/product.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=', 'base64')],
    ['/workspace/final.mp4', await readFile('../test/fixtures/media/with-audio.mp4')],
    ['/workspace/voice.wav', await readFile('../test/fixtures/media/short.wav')],
  ]);
  let version = 18; const persisted: Node[] = [], persistedEdges: any[] = [];
  api.graph.mockImplementation(async () => row(persisted, String(version), 'FINISHED', persistedEdges));
  api.models.mockRejectedValue(new Error('model params: 502'));
  api.update.mockImplementation(async (input: any) => { persisted.push(...input.addNodes.map((data: string) => JSON.parse(data))); return success({ versionNumber: String(++version) }); });
  const rt = service(), host = createCanvasHostBridge(), origin = 'http://127.0.0.1:3000';
  const registration = host.attachClient(origin, 'four-media-client', 'web-locks-v1');
  const endpoint = createCanvasCommandEndpoint({ connectionId: registration.connectionId, getRuntime: async () => rt, isSessionBound: id => id === 'four-media', send: event => host.acceptClientEvent(registration.bridgeKey, origin, event) });
  const disconnect = host.connectStream(registration.bridgeKey, origin, event => { void endpoint.handle(event); });
  host.acceptClientEvent(registration.bridgeKey, origin, { type: 'session.sync', protocolVersion: 4, connectionId: registration.connectionId, revision: 1, sessionIds: ['four-media'] });
  const definitions = new Map<string, any>(), cleanups: Array<() => void> = [], registrations: any[] = [], uploaded: Array<{ mime: string; bytes: Buffer }> = [];
  const assets = createCanvasAssetApi({ tokenProvider: async () => 'fixture-token', put: async request => {
    const chunks: Buffer[] = []; if (request.data instanceof Uint8Array) chunks.push(Buffer.from(request.data)); else for await (const chunk of request.data) chunks.push(Buffer.from(chunk));
    uploaded.push({ mime: request.mediaType, bytes: Buffer.concat(chunks) }); return { res: { status: 200 } };
  }, transport: async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/getUserDetail')) return new Response(JSON.stringify(success({ id: 123 })));
    if (path.endsWith('/sts/token')) return new Response(JSON.stringify(success({ userId: 123, bucket: 'fixture-bucket', region: 'oss-cn-hangzhou', dir: 'user/123', accessKeyId: 'fixture-ak', accessKeySecret: 'fixture-secret', securityToken: 'fixture-sts', expiration: new Date(Date.now() + 3600000).toISOString() })));
    if (path.endsWith('/upload/asset')) { registrations.push(JSON.parse(init!.body as string)); return new Response(JSON.stringify(success({}))); }
    throw new Error('Unexpected fixture endpoint');
  } });
  const fs = {
    resolve: async (path: string) => ({ targetKey: path }), contains: (_directory: unknown, target: { targetKey: string }) => target.targetKey.startsWith('/workspace/'),
    stat: async (target: { targetKey: string }) => ({ type: 'file', version: '1', size: files.get(target.targetKey)!.byteLength }),
    readByteRange: async (target: { targetKey: string }, range: { offset: number; length: number }) => Uint8Array.from(files.get(target.targetKey)!.subarray(range.offset, range.offset + range.length)),
  };
  const ctx = { tools: { register: (definition: any) => { definitions.set(definition.name, definition); return () => undefined; } }, effect: (fn: any) => { const stop = fn(); if (typeof stop === 'function') cleanups.push(stop); }, get: () => fs, attachments: { saveImage: async () => ({ width: 1, height: 1 }) } };
  registerCanvasTools(ctx as any, host); registerCanvasGraphTools(ctx as any, host); registerCanvasAssetTools(ctx as any, host, assets);
  const agent = { id: 'four-media', session: { header: { cwd: '/workspace' }, deriveMessages: () => [] } };
  const run = async (name: string, input: unknown, callId: string) => JSON.parse(await definitions.get(name).execute(input, { callId, agent, signal: new AbortController().signal }));
  const ids: string[] = [];
  try {
    for (const [index, path] of [...files.keys()].entries()) {
      const receipt = await run('canvas_asset_import', { canvasId: '2873', expectedVersion: String(version), source: { type: 'workspace_file', path }, title: ['文案', '实拍', '带配音成片', '旁白'][index] }, 'import-' + index);
      expect(receipt, JSON.stringify(receipt)).toMatchObject({ status: 'saved', version: String(19 + index), assetRegistration: { status: index === 0 ? 'not_applicable' : 'registered' } });
      expect(receipt.affectedNodeIds).toHaveLength(1); ids.push(receipt.affectedNodeIds[0]);
      expect(JSON.stringify(receipt)).not.toContain('insight-canvas-asset-');
    }
    expect(persisted.map(node => node.type)).toEqual(['text', 'image', 'video', 'audio']);
    expect(persisted[0].data.value).toBe('通勤轻负担\n音乐随身听');
    for (const node of persisted.slice(1)) expect(node.data).toMatchObject({ type: 'upload', product: [], tempFile: null });
    expect(registrations.map(item => item.assetType)).toEqual([1, 2, 3]); expect(registrations.slice(1).map(item => item.duration)).toEqual([1, 1]);
    expect(uploaded).toHaveLength(3); expect(uploaded[1].bytes).toEqual(Buffer.from(files.get('/workspace/final.mp4')!));
    const edgeId = `xy-edge__${ids[1]}image_source-${ids[2]}image_target`;
    expect(edgeId.length).toBe(106);
    persistedEdges.push({ id: edgeId, source: ids[1], target: ids[2], sourceHandle: 'image_source', targetHandle: 'image_target' });
    const read = await run('canvas_get', { canvasId: '2873', view: 'nodes', nodeIds: ids, refresh: true }, 'reload');
    expect(read).toMatchObject({ status: 'read', consistency: 'confirmed', version: '22', nodeCount: 4 });
    expect(read.nodes.map((item: any) => item.id)).toEqual(ids); expect(read.nodes[0].text).toBe('通勤轻负担\n音乐随身听');
    expect(read.nodes.slice(1).map((item: any) => [item.contentType, item.outputs.length, item.generation])).toEqual([['upload', 1, null], ['upload', 1, null], ['upload', 1, null]]);
    expect(read.nodes[2].inputs[0].edgeId).toBe(edgeId);
    const graph = await run('canvas_get', { canvasId: '2873', view: 'graph' }, 'long-edge-graph');
    expect(graph).toMatchObject({ status: 'graph', edgeCount: 1, edges: [{ id: edgeId }] });
    expect(api.contexts.get('2873')!.getInitialization().models.status).toBe('failed');
    expect(api.invoke).not.toHaveBeenCalled(); expect(document.querySelectorAll('iframe')).toHaveLength(0);
  } finally { cleanups.forEach(stop => stop()); disconnect(); endpoint.dispose(); host.dispose(); }
});

it('registered asset tools cold-read, save and reuse native images during model configuration failure without an iframe', async () => {
  api.dimensions.mockResolvedValue({ width: 1, height: 1 });
  const rt = service(); const host = createCanvasHostBridge(); const origin = 'http://127.0.0.1:3000'; const registration = host.attachClient(origin, 'asset-tool-client', 'web-locks-v1');
  const endpoint = createCanvasCommandEndpoint({ connectionId: registration.connectionId, getRuntime: async () => rt, isSessionBound: id => id === 'asset-session', send: event => host.acceptClientEvent(registration.bridgeKey, origin, event) });
  const disconnect = host.connectStream(registration.bridgeKey, origin, event => { void endpoint.handle(event); });
  host.acceptClientEvent(registration.bridgeKey, origin, { type: 'session.sync', protocolVersion: 4, connectionId: registration.connectionId, revision: 1, sessionIds: ['asset-session'] });
  const definitions = new Map<string, any>(); const cleanups: Array<() => void> = []; const requests: Array<{ path: string; method: string; body?: any }> = [];
  const data = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=', 'base64'));
  const image = { attachmentId: 'asset-image-1', name: '商品.png', mediaType: 'image/png', bytes: data.byteLength, width: 1, height: 1 };
  const readImage = vi.fn(async (ref: typeof image) => ({ ref, data })); const put = vi.fn(async () => ({ res: { status: 200 } }));
  const assets = createCanvasAssetApi({ tokenProvider: async () => 'fixture-private-token', put, transport: async (url, init) => {
    const path = new URL(String(url)).pathname; const method = init!.method!; const body = init!.body === undefined ? undefined : JSON.parse(init!.body as string); requests.push({ path, method, body });
    if (path === '/user-server/getUserDetail') return new Response(JSON.stringify(success({ id: 123 })));
    if (path === '/game-ai-editor-center/upload/sts/token') return new Response(JSON.stringify(success({ userId: 123, bucket: 'fixture-bucket', region: 'oss-cn-hangzhou', dir: 'user/123', accessKeyId: 'fixture-ak', accessKeySecret: 'fixture-secret', securityToken: 'fixture-sts', expiration: new Date(Date.now() + 3600000).toISOString() })));
    if (path === '/game-ai-editor-center/upload/asset') return new Response(JSON.stringify(success({})));
    throw new Error('Unexpected fixture request: ' + path);
  } });
  const ctx = { tools: { register: (definition: any) => { definitions.set(definition.name, definition); return () => definitions.delete(definition.name); } }, effect: (fn: any) => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); }, attachments: { readImage } };
  registerCanvasTools(ctx as any, host); registerCanvasGraphTools(ctx as any, host); registerCanvasAssetTools(ctx as any, host, assets);
  const agent = { id: 'asset-session', session: { deriveMessages: () => [{ role: 'user', content: [{ type: 'image', attachment: image }] }] } };
  const run = async (name: string, args: any, callId: string) => toolResult(await definitions.get(name).execute(toolInput(name, args), { callId, agent, signal: new AbortController().signal }));
  try {
    const list = await run('canvas_assets', {}, 'list'); expect(list).toMatchObject({ status: 'available', assets: [{ mediaType: 'image', source: { type: 'attachment', attachmentId: image.attachmentId } }] });
    expect(requests).toHaveLength(0); expect(readImage).not.toHaveBeenCalled();
    const cold = await run('canvas_get', { canvasId: '2873', view: 'nodes', refresh: true }, 'cold-refresh');
    expect(cold).toMatchObject({ status: 'read', consistency: 'confirmed', version: '18', nodes: [] });
    expect(api.graph).toHaveBeenCalledTimes(1); expect(document.querySelectorAll('iframe')).toHaveLength(0);
    const args = { canvasId: '2873', expectedVersion: cold.version, source: list.assets[0].source, title: '商品实拍图' };
    const [saved, duplicate] = await Promise.all([run('canvas_asset_import', args, 'import'), run('canvas_asset_import', args, 'import')]);
    expect(saved).toMatchObject({ status: 'saved', version: '19', assetRegistration: { status: 'registered' }, asset: { status: 'uploaded', attachmentId: image.attachmentId, mediaType: 'image/png', bytes: data.byteLength } });
    expect(duplicate).toEqual(saved); expect(saved.affectedNodeIds).toHaveLength(1); expect(readImage).toHaveBeenCalledTimes(1); expect(put).toHaveBeenCalledTimes(1); expect(api.update).toHaveBeenCalledTimes(1);
    const nodeId = saved.affectedNodeIds[0]; const nativeNodes = api.contexts.get('2873')!.store.getState().nodes;
    expect(nativeNodes).toHaveLength(1); expect(nativeNodes[0]).toMatchObject({ id: nodeId, type: 'image', data: { type: 'upload', title: '商品实拍图', value: saved.asset.url, product: [], tempFile: null } });
    expect(requests.filter(request => request.path === '/user-server/getUserDetail')).toHaveLength(3);
    expect(requests.find(request => request.path === '/game-ai-editor-center/upload/sts/token')).toMatchObject({ method: 'POST', body: { fileName: 'image.png', libraryId: '1001', type: 1, userId: 123 } });
    const registered = requests.filter(request => request.path === '/game-ai-editor-center/upload/asset'); expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({ method: 'POST', body: { assetType: 1, source: 0, sourceType: 'upload', canvasId: 2873, nodeId, fileUrl: saved.asset.url } });
    const read = await run('canvas_get', { canvasId: '2873', view: 'nodes', nodeIds: [nodeId] }, 'read');
    expect(read).toMatchObject({ status: 'read', consistency: 'confirmed', version: '19', nodes: [{ id: nodeId, title: '商品实拍图', contentType: 'upload', outputs: [saved.asset.url], generation: null }] });
    expect(api.graph).toHaveBeenCalledTimes(1);
    const original = structuredClone(nativeNodes[0]);
    api.graph.mockResolvedValue(row(nativeNodes, '19'));
    api.models.mockRejectedValueOnce(new Error('Failed to fetch model params: 502'));
    const refreshed = await run('canvas_get', { canvasId: '2873', view: 'nodes', nodeIds: [nodeId], refresh: true }, 'refresh-models-offline');
    expect(refreshed).toMatchObject({ status: 'read', consistency: 'confirmed', version: '19', nodes: [{ id: nodeId, contentType: 'upload', outputs: [saved.asset.url] }] });
    expect(api.graph).toHaveBeenCalledTimes(2); expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.contexts.get('2873')!.getInitialization().models).toMatchObject({ status: 'failed', error: { code: 'CONFIGURATION_ERROR' } });
    api.update.mockResolvedValueOnce(success({ versionNumber: '20' }));
    const copied = await run('canvas_asset_import', { canvasId: '2873', expectedVersion: refreshed.version,
      source: { type: 'canvas_node', canvasId: '2873', nodeId, outputIndex: 0 }, title: '备用参考图' }, 'copy-canvas-source');
    expect(copied).toMatchObject({ status: 'saved', version: '20', asset: { status: 'reused', url: saved.asset.url }, assetRegistration: { status: 'registered' } });
    expect(copied.affectedNodeIds).toHaveLength(1); const copiedId = copied.affectedNodeIds[0]; expect(copiedId).not.toBe(nodeId);
    const copiedRead = await run('canvas_get', { canvasId: '2873', view: 'nodes', nodeIds: [nodeId, copiedId] }, 'read-copied');
    expect(copiedRead).toMatchObject({ status: 'read', consistency: 'confirmed', version: '20', nodeCount: 2, nodes: [
      { id: nodeId, title: '商品实拍图', contentType: 'upload', outputs: [saved.asset.url] },
      { id: copiedId, title: '备用参考图', contentType: 'upload', outputs: [saved.asset.url] },
    ] });
    expect(readImage).toHaveBeenCalledTimes(1); expect(put).toHaveBeenCalledTimes(1); expect(api.update).toHaveBeenCalledTimes(2);
    // A separate authorized addition through the attachment source, not a fallback after rejection.
    api.update.mockResolvedValueOnce(success({ versionNumber: '21' }));
    const attachmentCopy = await run('canvas_asset_import', { ...args, expectedVersion: copiedRead.version, title: '附件复用图' }, 'copy-attachment-source');
    expect(attachmentCopy).toMatchObject({ status: 'saved', version: '21', asset: { status: 'reused', url: saved.asset.url }, assetRegistration: { status: 'registered' } });
    expect(attachmentCopy.affectedNodeIds).toHaveLength(1); const attachmentId = attachmentCopy.affectedNodeIds[0];
    expect([nodeId, copiedId]).not.toContain(attachmentId);
    const finalRead = await run('canvas_get', { canvasId: '2873', view: 'nodes', nodeIds: [nodeId, copiedId, attachmentId] }, 'read-all-assets');
    expect(finalRead).toMatchObject({ status: 'read', consistency: 'confirmed', version: '21', nodeCount: 3, nodes: [
      { id: nodeId, outputs: [saved.asset.url] }, { id: copiedId, outputs: [saved.asset.url] }, { id: attachmentId, title: '附件复用图', outputs: [saved.asset.url] },
    ] });
    const preserved = api.contexts.get('2873')!.store.getState().nodes.find(item => item.id === nodeId)!;
    expect(preserved.data).toEqual(original.data); expect(preserved.position).toEqual(original.position);
    expect({ width: preserved.width, height: preserved.height, measured: preserved.measured }).toEqual({ width: original.width, height: original.height, measured: original.measured });
    expect(await run('canvas_models', { canvasId: '2873', nodeType: 'image' }, 'models-still-offline')).toMatchObject({ status: 'rejected', effect: 'none', error: { code: 'CONFIGURATION_ERROR' } });
    expect(await run('canvas_node_edit', { canvasId: '2873', expectedVersion: finalRead.version, action: 'add', node: { type: 'image' } }, 'generator-config-blocked')).toMatchObject({ status: 'rejected', effect: 'none', error: { code: 'CONFIGURATION_ERROR' } });
    expect(await run('canvas_node_edit', { canvasId: '2873', expectedVersion: finalRead.version, action: 'configure', nodeId, configuration: { model: 'fixture' } }, 'configure-blocked')).toMatchObject({ status: 'rejected', effect: 'none', error: { code: 'CONFIGURATION_ERROR' } });
    expect(api.graph).toHaveBeenCalledTimes(2); expect(api.update).toHaveBeenCalledTimes(3); expect(readImage).toHaveBeenCalledTimes(2); expect(put).toHaveBeenCalledTimes(1);
    expect(requests.filter(request => request.path === '/game-ai-editor-center/upload/sts/token')).toHaveLength(1);
    expect(requests.filter(request => request.path === '/game-ai-editor-center/upload/asset')).toHaveLength(3);
    expect(api.invoke).not.toHaveBeenCalled(); expect(document.querySelectorAll('iframe')).toHaveLength(0); expect(JSON.stringify(saved)).not.toContain('fixture-private-token');
  } finally { cleanups.forEach(cleanup => cleanup()); disconnect(); endpoint.dispose(); host.dispose(); }
});

it('registered asset import preserves unknown native IDs, never registers and does not replay save or upload', async () => {
  const rt = service(); const host = createCanvasHostBridge(); const origin = 'http://127.0.0.1:3000'; const registration = host.attachClient(origin, 'asset-unknown-client', 'web-locks-v1');
  const endpoint = createCanvasCommandEndpoint({ connectionId: registration.connectionId, getRuntime: async () => rt, isSessionBound: id => id === 'asset-session', send: event => host.acceptClientEvent(registration.bridgeKey, origin, event) });
  const disconnect = host.connectStream(registration.bridgeKey, origin, event => { void endpoint.handle(event); });
  host.acceptClientEvent(registration.bridgeKey, origin, { type: 'session.sync', protocolVersion: 4, connectionId: registration.connectionId, revision: 1, sessionIds: ['asset-session'] });
  const definitions = new Map<string, any>(); const cleanups: Array<() => void> = []; const image = { attachmentId: 'asset-image-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1 };
  const assetUrl = 'https://fixture-bucket.oss-cn-hangzhou.aliyuncs.com/user/product.png';
  const uploadMedia = vi.fn(async () => ({ ...image, url: assetUrl })); const registerMedia = vi.fn(async () => ({ status: 'registered' as const }));
  registerCanvasAssetTools({ tools: { register: (definition: any) => { definitions.set(definition.name, definition); return () => definitions.delete(definition.name); } }, effect: (fn: any) => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); }, attachments: { readImage: async (ref: typeof image) => ({ ref, data: new Uint8Array([1, 2, 3]) }) } } as any, host,
    { getIdentity: async () => ({ userId: '123', token: 'fixture-private-token' }), uploadMedia, registerMedia });
  const agent = { id: 'asset-session', session: { deriveMessages: () => [{ role: 'user', content: [{ type: 'image', attachment: image }] }] } };
  const args = { canvasId: '2873', expectedVersion: '18', source: { type: 'attachment', attachmentId: image.attachmentId }, title: '待确认素材' };
  const run = async (callId: string) => JSON.parse(await definitions.get('canvas_asset_import').execute(args, { callId, agent, signal: new AbortController().signal }));
  try {
    api.update.mockRejectedValueOnce(Object.assign(new Error('response lost'), { requestPhase: 'sent_unknown' }));
    const unknown = await run('unknown'); expect(unknown).toMatchObject({ status: 'submission_unknown', phase: 'save', error: { retry: 'never_auto' }, asset: { url: assetUrl } });
    const optimisticNode = api.contexts.get('2873')!.store.getState().nodes[0]; expect(unknown.affectedNodeIds).toEqual([optimisticNode.id]);
    expect(await run('unknown')).toEqual(unknown); expect(await run('new-call')).toMatchObject({ status: 'rejected', error: { code: 'SUBMISSION_UNKNOWN' } });
    expect(api.update).toHaveBeenCalledTimes(1); expect(uploadMedia).toHaveBeenCalledTimes(1); expect(registerMedia).not.toHaveBeenCalled();
    expect(api.contexts.get('2873')!.store.getState().nodes).toHaveLength(1); expect(api.invoke).not.toHaveBeenCalled(); expect(document.querySelectorAll('iframe')).toHaveLength(0);
  } finally { cleanups.forEach(cleanup => cleanup()); disconnect(); endpoint.dispose(); host.dispose(); }
});

// Coordinates are persisted by the real native Store; no visible ReactFlow is mounted.
describe('Agent native node placement', () => {
  it('appends text and uploaded images without overlap or moving old content, then reloads the same geometry', async () => {
    const existing = { ...node('text', 'existing'), position: { x: 120, y: 80 }, width: 600, height: 420, measured: { width: 600, height: 420 } };
    const rt = await prepare([existing]);
    api.update.mockResolvedValueOnce(success({ versionNumber: '19' }));
    const text = await execute(rt, { action: 'node.add', expectedVersion: '18', node: { type: 'text', changes: { title: '自动追加文本', text: 'new' } } });
    expect(text).toMatchObject({ status: 'saved', version: '19' });
    api.dimensions.mockResolvedValue({ width: 2800, height: 1200 });
    api.update.mockResolvedValueOnce(success({ versionNumber: '20' }));
    const image = await execute(rt, { action: 'asset.add', expectedVersion: '19', asset: { url: 'https://assets.example/wide.png', title: '宽图素材' } });
    expect(image).toMatchObject({ status: 'saved', version: '20' });
    const nodes = api.contexts.get('2873')!.store.getState().nodes;
    expect(nodes[0].position).toEqual(existing.position);
    const read = await execute(rt, { action: 'canvas.read' });
    expect(read.status).toBe('read'); if (read.status !== 'read') throw new Error(JSON.stringify(read));
    const [old, addedText, addedImage] = read.nodes;
    expect(old).toMatchObject({ position: existing.position, size: { width: 600, height: 420 }, parentId: null });
    expect(addedText.position!.x).toBeGreaterThanOrEqual(old.position!.x + old.size!.width);
    expect(addedImage.position!.x).toBeGreaterThanOrEqual(addedText.position!.x + addedText.size!.width);
    expect(addedImage.size!.width).toBeGreaterThan(addedImage.size!.height);
    for (const item of read.nodes) expect(item.position).toEqual(nodes.find(native => native.id === item.id)!.position);
    expect(api.update).toHaveBeenCalledTimes(2);
    expect(api.update.mock.calls[0][0].updateNodes ?? []).toHaveLength(0);
    expect(api.update.mock.calls[1][0].updateNodes ?? []).toHaveLength(0);
    api.graph.mockResolvedValue(row(nodes, '20'));
    await rt.reloadContext({ canvasId: '2873', capability: 'read' });
    const refreshed = await execute(rt, { action: 'canvas.read' });
    expect(refreshed).toEqual(read);
    const reloaded = api.contexts.get('2873')!.store.getState().nodes;
    expect(reloaded.map(item => ({ id: item.id, position: item.position, width: item.width, height: item.height }))).toEqual(nodes.map(item => ({ id: item.id, position: item.position, width: item.width, height: item.height })));
    expect(api.update).toHaveBeenCalledTimes(2); expect(api.invoke).not.toHaveBeenCalled(); expect(document.querySelectorAll('iframe')).toHaveLength(0);
  });
  it('waits for native intrinsic dimensions before choosing a position or saving, and the next node clears its real width', async () => {
    const rt = await prepare([node('text', 'existing')]); const ctx = api.contexts.get('2873')!;
    const gate = deferred<{ width: number; height: number }>(); api.dimensions.mockReturnValueOnce(gate.promise);
    const saving = execute(rt, { action: 'asset.add', expectedVersion: '18', asset: { url: 'https://assets.example/wide.png', title: '宽图' } });
    await vi.waitFor(() => expect(api.dimensions).toHaveBeenCalled());
    expect(api.update).not.toHaveBeenCalled(); expect(ctx.store.getState().nodes.map(item => item.id)).toEqual(['existing']);
    gate.resolve({ width: 2800, height: 1200 });
    expect(await saving).toMatchObject({ status: 'saved', version: '19' });
    const wide = ctx.store.getState().nodes[1]; expect(wide.width).toBeGreaterThan(400);
    api.dimensions.mockResolvedValueOnce({ width: 1200, height: 3600 }); api.update.mockResolvedValueOnce(success({ versionNumber: '20' }));
    expect(await execute(rt, { action: 'asset.add', expectedVersion: '19', asset: { url: 'https://assets.example/tall.png', title: '长图' } })).toMatchObject({ status: 'saved', version: '20' });
    const tall = ctx.store.getState().nodes[2]; expect(tall.height).toBeGreaterThan(400);
    expect(tall.position.x).toBeGreaterThanOrEqual(wide.position.x + wide.width!);
    expect(api.update).toHaveBeenCalledTimes(2); expect(ctx.store.getState().nodes[0].position).toEqual({ x: 0, y: 0 });
  });
  it.each([
    { placement: { mode: 'absolute', position: { x: 0, y: 0 } } },
    { position: { x: 0, y: 0 } },
  ])('keeps precise coordinates including the origin: %j', async coordinates => {
    const existing = { ...node(), position: { x: 0, y: 0 }, width: 500, height: 500, measured: { width: 500, height: 500 } }; const rt = await prepare([existing]);
    const result = await execute(rt, { action: 'node.add', expectedVersion: '18', node: { type: 'text', ...coordinates } });
    expect(result).toMatchObject({ status: 'saved' }); expect(api.contexts.get('2873')!.store.getState().nodes[1].position).toEqual({ x: 0, y: 0 });
    expect(api.update).toHaveBeenCalledTimes(1);
  });
  it('extends beside its anchor without moving remote content or creating a connection', async () => {
    const anchor = { ...node('text', 'anchor'), position: { x: 10, y: 20 }, width: 600, height: 420, measured: { width: 600, height: 420 } };
    const remote = { ...node('text', 'remote'), position: { x: 9000, y: 20 } }; const rt = await prepare([anchor, remote]);
    const result = await execute(rt, { action: 'node.add', expectedVersion: '18', node: { type: 'text', placement: { mode: 'after', anchorNodeId: 'anchor' } } });
    expect(result).toMatchObject({ status: 'saved' }); const nodes = api.contexts.get('2873')!.store.getState().nodes;
    expect(nodes[2].position.x).toBeGreaterThanOrEqual(anchor.position.x + anchor.width);
    expect(nodes[2].position.x).toBeLessThan(remote.position.x); expect(nodes[2].position.y).toBe(anchor.position.y);
    expect(nodes.slice(0, 2).map(item => item.position)).toEqual([anchor.position, remote.position]);
    expect(api.contexts.get('2873')!.store.getState().edges).toEqual([]); expect(api.update).toHaveBeenCalledTimes(1);
  });
  it('rejects an absent continuation anchor before any node or partial update is created', async () => {
    const rt = await prepare([node()]);
    const result = await execute(rt, { action: 'node.add', expectedVersion: '18', node: { type: 'text', placement: { mode: 'after', anchorNodeId: 'missing' } } });
    expect(result).toMatchObject({ status: 'rejected', error: { code: 'NODE_NOT_FOUND' } }); expect(api.contexts.get('2873')!.store.getState().nodes.map(item => item.id)).toEqual(['n1']); expect(api.update).not.toHaveBeenCalled();
  });
  it('leaves native UI and existing strict Store callers without nodePlacement at their requested coordinates', async () => {
    const rt = await prepare([node('text', 'existing')]); const ctx = api.contexts.get('2873')!;
    await ctx.store.getState().actions.addNode([node('text', 'ui')]);
    expect(ctx.store.getState().nodes[1].position).toEqual({ x: 0, y: 0 });
    api.update.mockResolvedValueOnce(success({ versionNumber: '20' }));
    const strict = await ctx.store.getState().actions.addNode([node('text', 'strict')], { expectedVersion: '19', strictReceipt: true });
    expect(strict).toMatchObject({ version: '20', affectedNodeIds: ['strict'] }); expect(ctx.store.getState().nodes[2].position).toEqual({ x: 0, y: 0 });
    expect(api.update).toHaveBeenCalledTimes(2);
  });
  it.each(['version', 'editor'])('rechecks %s after intrinsic dimension preparation before automatic placement can mutate the Store', async stateChange => {
    const rt = await prepare([node()]); const ctx = api.contexts.get('2873')!;
    const gate = deferred<{ width: number; height: number }>(); api.dimensions.mockReturnValueOnce(gate.promise);
    const adding = execute(rt, { action: 'asset.add', expectedVersion: '18', asset: { url: 'https://assets.example/delayed.png' } });
    await vi.waitFor(() => expect(api.dimensions).toHaveBeenCalled());
    if (stateChange === 'version') ctx.store.getState().actions.setVersionNumber('19'); else ctx.guard.markEditorBusy('draft', true);
    gate.resolve({ width: 2400, height: 800 });
    expect(await adding).toMatchObject({ status: 'rejected', error: { code: stateChange === 'version' ? 'VERSION_CONFLICT' : 'EDITOR_BUSY' } });
    expect(ctx.store.getState().nodes.map(item => item.id)).toEqual(['n1']); expect(api.update).not.toHaveBeenCalled();
  });
  it('reads a native ungrouped node with empty parentId through the Host/Client wire as a valid top-level geometry', async () => {
    const topLevel = { ...node('text', 'ungrouped'), parentId: '', position: { x: 60, y: 90 } };
    const rt = await prepare([topLevel]); const host = createCanvasHostBridge(); const origin = 'http://127.0.0.1:3000'; const registration = host.attachClient(origin, 'geometry-client', 'web-locks-v1');
    const endpoint = createCanvasCommandEndpoint({ connectionId: registration.connectionId, getRuntime: async () => rt, isSessionBound: () => true, send: event => host.acceptClientEvent(registration.bridgeKey, origin, event) });
    const disconnect = host.connectStream(registration.bridgeKey, origin, event => { void endpoint.handle(event); });
    host.acceptClientEvent(registration.bridgeKey, origin, { type: 'session.sync', protocolVersion: 4, connectionId: registration.connectionId, revision: 1, sessionIds: ['geometry-session'] });
    try {
      const target = await host.ensureContext('geometry-session', '2873', 'read', 'prepare');
      const read = await host.dispatch(target, 'read-geometry', { action: 'canvas.read' });
      expect(read).toMatchObject({ status: 'read', consistency: 'confirmed', nodes: [{ id: 'ungrouped', parentId: null, position: topLevel.position, size: { width: 400, height: 400 } }] });
      expect(() => parseCanvasOperationResult(read)).not.toThrow();
      expect(api.contexts.get('2873')!.store.getState().nodes[0].parentId).toBe('');
      expect(api.update).not.toHaveBeenCalled(); expect(document.querySelectorAll('iframe')).toHaveLength(0);
    } finally { disconnect(); endpoint.dispose(); host.dispose(); }
  });
});

describe('agent graph editing delivery through the existing service', () => {
  it('pages brief graph metadata with a confirmed version and preserves raw edge order', async () => {
    const original = { ...node('image', 'original'), width: 400, height: 400, measured: { width: 400, height: 400 }, data: { ...node('image').data, type: 'upload', value: 'https://assets.example/original.png', dimensionMeta: { sourceValue: 'https://assets.example/original.png', status: 'valid', mode: 'auto' } } };
    const nodes = [node('text', 'copy'), original, node('image', 'poster')];
    const edges = [{ id: 'copy-edge', source: 'copy', target: 'poster', sourceHandle: 'text_source', targetHandle: 'text_target' }, { id: 'image-edge', source: 'original', target: 'poster', sourceHandle: 'image_source', targetHandle: 'image_target' }];
    api.graph.mockResolvedValueOnce(row(nodes, '18', 'FINISHED', edges)); const rt = service();
    const first = await execute(rt, { action: 'canvas.graph.read', limit: 1 });
    expect(first).toMatchObject({ status: 'graph', consistency: 'confirmed', version: '18', nodeCount: 3, edgeCount: 2, nextNodeOffset: 1, nextEdgeOffset: 1, nodes: [{ id: 'copy', ports: expect.arrayContaining([{ id: 'text_target', type: 'target', mediaType: 'text', limit: null }]) }], edges: [edges[0]] });
    if (first.status !== 'graph') throw new Error(JSON.stringify(first));
    expect(first.nodes[0]).not.toHaveProperty('text'); expect(first.nodes[0]).not.toHaveProperty('params');
    const next = await execute(rt, { action: 'canvas.graph.read', nodeOffset: 1, edgeOffset: 1, limit: 1, expectedVersion: first.version });
    expect(next).toMatchObject({ status: 'graph', nodes: [{ id: 'original', canConfigureGeneration: false }], edges: [edges[1]], nextNodeOffset: 2, nextEdgeOffset: null });
    expect(() => parseCanvasOperationResult(first)).not.toThrow(); expect(() => parseCanvasOperationResult(next)).not.toThrow();
    expect(await execute(rt, { action: 'canvas.graph.read', nodeOffset: 1 })).toMatchObject({ status: 'rejected', error: { code: 'INVALID_ARGUMENT' } });
    api.contexts.get('2873')!.store.getState().actions.setVersionNumber('19');
    expect(await execute(rt, { action: 'canvas.graph.read', nodeOffset: 1, expectedVersion: '18' })).toMatchObject({ status: 'rejected', error: { code: 'VERSION_CONFLICT' } });
    expect(api.update).not.toHaveBeenCalled(); expect(api.invoke).not.toHaveBeenCalled(); expect(document.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('rejects model reads and configuration if the native permission stage failed', async () => {
    api.permission.mockRejectedValueOnce(new Error('offline')); const rt = await prepare([node('image')]);
    expect(await execute(rt, { action: 'canvas.models.read', nodeType: 'image' })).toMatchObject({ status: 'rejected', error: { code: 'CONFIGURATION_ERROR' } });
    expect(await execute(rt, { action: 'node.configure', expectedVersion: '18', nodeId: 'n1', configuration: { model: 'fixture' } })).toMatchObject({ status: 'rejected', error: { code: 'CONFIGURATION_ERROR' } });
    expect(api.update).not.toHaveBeenCalled();
  });

  it('keeps real edge IDs after an unknown save and blocks replay until reload', async () => {
    const rt = await prepare([node('text', 'copy'), node('image', 'poster')]);
    api.update.mockRejectedValueOnce(Object.assign(new Error('response lost'), { requestPhase: 'sent_unknown' }));
    const operation = { action: 'edge.add', expectedVersion: '18', connection: { sourceNodeId: 'copy', targetNodeId: 'poster' } };
    const unknown = await execute(rt, operation);
    expect(unknown).toMatchObject({ status: 'submission_unknown', affectedNodeIds: ['copy', 'poster'], affectedEdgeIds: [expect.any(String)] });
    expect(() => parseCanvasOperationResult(unknown)).not.toThrow();
    const edges = api.contexts.get('2873')!.store.getState().edges;
    if (unknown.status !== 'submission_unknown') throw new Error(JSON.stringify(unknown));
    expect(edges.map(edge => edge.id)).toEqual(unknown.affectedEdgeIds);
    expect(await execute(rt, operation)).toMatchObject({ status: 'rejected', error: { code: 'SUBMISSION_UNKNOWN' } });
    expect(await execute(rt, { action: 'canvas.graph.read' })).toMatchObject({ status: 'graph', consistency: 'unconfirmed', edges: [{ id: edges[0].id }] });
    expect(api.update).toHaveBeenCalledTimes(1); expect(api.invoke).not.toHaveBeenCalled();
  });

  it('reports a generic catalogue read failure as read-only rejection without fencing later reads', async () => {
    const rt = await prepare();
    vi.stubGlobal('crypto', { randomUUID: () => webcrypto.randomUUID(), subtle: { digest: async () => { throw new Error('digest unavailable'); } } });
    expect(await execute(rt, { action: 'canvas.models.read', nodeType: 'image' })).toMatchObject({ status: 'rejected', effect: 'none', error: { code: 'READ_REJECTED' } });
    expect(api.contexts.get('2873')!.store.getState().agentPersistenceIssue).toBeNull();
    expect(await execute(rt, { action: 'canvas.graph.read' })).toMatchObject({ status: 'graph', consistency: 'confirmed' });
    expect(api.update).not.toHaveBeenCalled(); expect(api.invoke).not.toHaveBeenCalled();
  });

  it('registered tools update, connect, configure, reorder, reconnect and delete with one native Store and no generation', async () => {
    const nativeModel = { ...model, parameters: { ...model.parameters, aspect_ratio: { default: '1:1', choices: [{ value: '1:1', label: '方图' }, { value: '16:9', label: '横图' }] } } };
    api.models.mockResolvedValueOnce(success([{ config: JSON.stringify({ text: { fixture: model }, image: { text_to_image: { name: '文生图', models: { fixture: nativeModel } }, reference_image_to_image: { name: '图生图', models: { fixture: nativeModel } } } }) }]));
    const original = { ...node('image', 'original'), width: 400, height: 400, measured: { width: 400, height: 400 }, data: { ...node('image').data, type: 'upload', value: 'https://assets.example/original.png', product: [], dimensionMeta: { sourceValue: 'https://assets.example/original.png', status: 'valid', mode: 'auto' } } };
    const alternate = { ...original, id: 'alternate', data: { ...original.data, title: 'alternate', value: 'https://assets.example/alternate.png', dimensionMeta: { sourceValue: 'https://assets.example/alternate.png', status: 'valid', mode: 'auto' } } };
    api.graph.mockResolvedValueOnce(row([node('text', 'copy'), original, alternate]));
    let saveVersion = 18; api.update.mockImplementation(async () => success({ versionNumber: String(++saveVersion) }));
    const rt = service(); const host = createCanvasHostBridge(); const origin = 'http://127.0.0.1:3000'; const registration = host.attachClient(origin, 'graph-tool-client', 'web-locks-v1');
    const endpoint = createCanvasCommandEndpoint({ connectionId: registration.connectionId, getRuntime: async () => rt, isSessionBound: () => true, send: event => host.acceptClientEvent(registration.bridgeKey, origin, event) });
    const disconnect = host.connectStream(registration.bridgeKey, origin, event => { void endpoint.handle(event); });
    host.acceptClientEvent(registration.bridgeKey, origin, { type: 'session.sync', protocolVersion: 4, connectionId: registration.connectionId, revision: 1, sessionIds: ['graph-session'] });
    const definitions = new Map<string, any>(); const cleanups: Array<() => void> = [];
    const toolContext = { tools: { register: (definition: any) => { definitions.set(definition.name, definition); return () => definitions.delete(definition.name); } }, effect: (fn: any) => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); } };
    registerCanvasTools(toolContext as any, host); registerCanvasGraphTools(toolContext as any, host);
    const run = async (name: string, args: any, callId: string) => toolResult(await definitions.get(name).execute(toolInput(name, args), { callId, agent: { id: 'graph-session' }, signal: new AbortController().signal }));
    const save = async (name: string, args: any, callId: string) => {
      const result = await run(name, { canvasId: '2873', expectedVersion: String(saveVersion), ...args }, callId);
      expect(result.status, JSON.stringify(result)).toBe('saved'); expect(result.version).toBe(String(saveVersion)); return result;
    };
    try {
      const graph = await run('canvas_get', { canvasId: '2873', view: 'graph' }, 'graph');
      expect(graph).toMatchObject({ status: 'graph', nodeCount: 3, edgeCount: 0, version: '18' });
      await save('canvas_node_edit', { action: 'update', nodeId: 'copy', changes: { text: '耳机头部卖点文案' } }, 'copy-update');
      await save('canvas_node_edit', { action: 'update', nodeId: 'original', changes: { title: '耳机原图' } }, 'source-title');
      const created = await save('canvas_node_edit', { action: 'add', node: { type: 'image', changes: { title: '头部卖点图' } } }, 'poster-add'); const posterId = created.affectedNodeIds[0];
      const textEdge = await save('canvas_edges', { action: 'add', connection: { sourceNodeId: 'copy', targetNodeId: posterId } }, 'copy-connect');
      const imageEdge = await save('canvas_edges', { action: 'add', connection: { sourceNodeId: 'original', targetNodeId: posterId } }, 'original-connect');
      expect(imageEdge.warnings).toHaveLength(1);
      const catalog = await run('canvas_models', { canvasId: '2873', nodeType: 'image', modelType: 'reference_image_to_image' }, 'models');
      expect(catalog).toMatchObject({ status: 'models', modelType: 'reference_image_to_image', models: [{ value: 'fixture' }], paramHints: expect.arrayContaining([{ field: 'aspect_ratio', editable: true, choices: ['1:1', '16:9'] }]) });
      const configured = await save('canvas_node_edit', { action: 'configure', nodeId: posterId, configuration: { modelType: catalog.modelType, model: catalog.model, params: { gen_count: 1, aspect_ratio: '16:9' } } }, 'configure');
      expect(configured.warnings).toBeUndefined();
      const orderedIds = [imageEdge.affectedEdgeIds[0], textEdge.affectedEdgeIds[0]];
      await save('canvas_edges', { action: 'reorder', targetNodeId: posterId, edgeIds: orderedIds }, 'reorder');
      const changed = await save('canvas_edges', { action: 'reconnect', edgeId: imageEdge.affectedEdgeIds[0], connection: { sourceNodeId: 'alternate', targetNodeId: posterId } }, 'reconnect');
      expect(changed.affectedEdgeIds).toEqual(imageEdge.affectedEdgeIds);
      const ctx = api.contexts.get('2873')!;
      expect(ctx.store.getState().edges.map(edge => edge.id)).toEqual(orderedIds);
      expect(ctx.store.getState().nodes.find(item => item.id === posterId)!.data.params).toMatchObject({ modelType: 'reference_image_to_image', model: 'fixture', gen_count: 1, aspect_ratio: '16:9' });
      const calls = api.update.mock.calls.length;
      expect(await run('canvas_node_edit', { canvasId: '2873', action: 'configure', expectedVersion: String(saveVersion), nodeId: posterId, configuration: { params: { aspect_ratio: 'invalid' } } }, 'invalid-config')).toMatchObject({ status: 'rejected', error: { code: 'INVALID_ARGUMENT' } });
      expect(await run('canvas_node_edit', { canvasId: '2873', action: 'update', expectedVersion: String(saveVersion), nodeId: 'original', changes: { prompt: 'rewrite uploaded source' } }, 'invalid-source')).toMatchObject({ status: 'rejected', error: { code: 'UNSUPPORTED_NODE' } });
      expect(api.update).toHaveBeenCalledTimes(calls);
      await save('canvas_edges', { action: 'delete', edgeIds: textEdge.affectedEdgeIds }, 'edge-delete');
      const deleted = await save('canvas_node_edit', { action: 'delete', nodeIds: ['alternate'] }, 'source-delete');
      expect(deleted.affectedEdgeIds).toEqual(imageEdge.affectedEdgeIds);
      expect(deleted.warnings).toHaveLength(1); expect(deleted.warnings[0]).toContain(posterId);
      const stored = ctx.store.getState(); api.graph.mockResolvedValue(row(stored.nodes, String(saveVersion), 'FINISHED', stored.edges));
      const reread = await run('canvas_get', { canvasId: '2873', view: 'graph', refresh: true }, 'reload');
      expect(reread).toMatchObject({ status: 'graph', consistency: 'confirmed', edgeCount: 0, version: String(saveVersion) });
      const details = await run('canvas_get', { canvasId: '2873', view: 'nodes', nodeIds: ['original', posterId] }, 'details');
      expect(details.nodes[0]).toMatchObject({ title: '耳机原图', contentType: 'upload', outputs: ['https://assets.example/original.png'], generation: null });
      expect(details.nodes[1].outputs).toEqual([]); expect(details.nodes[1].params.modelType).toBe('reference_image_to_image');
      expect(api.update).toHaveBeenCalledTimes(10); expect(api.invoke).not.toHaveBeenCalled(); expect(document.querySelectorAll('iframe')).toHaveLength(0);
    } finally { cleanups.forEach(cleanup => cleanup()); disconnect(); endpoint.dispose(); host.dispose(); }
  });
});

describe('public image/video generation preparation and native tracker', () => {
  it.each(['image', 'video'])('preflights %s with exact version, native config and a backend quote without generating', async type => {
    const rt = await prepare([node(type)]); api.cost.mockResolvedValueOnce(success({ discount_applied: true, original_points: 4, discounted_points: 2 }));
    const result = await execute(rt, { action: 'node.preflight', expectedVersion: '18', nodeId: 'n1' });
    expect(result).toMatchObject({ status: 'preflight', version: '18', nodeId: 'n1', quote: { points: 2, originalPoints: 4 }, generation: type === 'image' ? { images: 1, videos: 0 } : { images: 0, videos: 1 } });
    expect(() => parseCanvasOperationResult(result)).not.toThrow(); expect(api.invoke).not.toHaveBeenCalled(); expect(document.querySelectorAll('iframe')).toHaveLength(0);
  });
  it('an unavailable unrelated tool permission does not block ordinary image preflight', async () => {
    api.tools.mockRejectedValueOnce(new Error('tool permission 502')); const rt = await prepare([node('image')]);
    expect(await execute(rt, { action: 'node.preflight', expectedVersion: '18', nodeId: 'n1' })).toMatchObject({ status: 'preflight' });
    expect(rt.getContextInfo('2873')?.readiness.capabilities.run).toBe(true); expect(api.invoke).not.toHaveBeenCalled();
  });
  it.each(['models', 'permission'])('%s failure still blocks generation even though reading/editing is possible', async key => {
    api[key as 'models' | 'permission'].mockRejectedValueOnce(new Error('502')); const rt = await prepare([node('image')]);
    expect(await execute(rt, { action: 'node.preflight', expectedVersion: '18', nodeId: 'n1' })).toMatchObject({ status: 'rejected', effect: 'none', error: { code: 'CONFIGURATION_ERROR' } });
    expect(api.cost).not.toHaveBeenCalled(); expect(api.invoke).not.toHaveBeenCalled();
  });
  it.each(['text', 'audio', 'upload'])('public preflight rejects unsupported %s target', async type => {
    const target = node(type === 'upload' ? 'image' : type); if (type === 'upload') target.data.type = 'upload'; if (type === 'audio') (target.data.params as any).seniorParams = {};
    const rt = await prepare([target]); expect(await execute(rt, { action: 'node.preflight', expectedVersion: '18', nodeId: 'n1' })).toMatchObject({ status: 'rejected', error: { code: 'UNSUPPORTED_NODE' } });
    expect(api.cost).not.toHaveBeenCalled(); expect(api.invoke).not.toHaveBeenCalled();
  });
  it('rejects stale version, running target and editor drafts before costing', async () => {
    const rt = await prepare([node('image')]); const ctx = api.contexts.get('2873')!;
    expect(await execute(rt, { action: 'node.preflight', expectedVersion: '17', nodeId: 'n1' })).toMatchObject({ status: 'rejected', error: { code: 'VERSION_CONFLICT' } });
    ctx.store.getState().actions.updateNodeStatus('n1', 'running');
    expect(await execute(rt, { action: 'node.preflight', expectedVersion: '18', nodeId: 'n1' })).toMatchObject({ status: 'rejected', error: { code: 'NODE_BUSY' } });
    ctx.store.getState().actions.updateNodeStatus('n1', 'success'); ctx.guard.markEditorBusy('draft', true);
    expect(await execute(rt, { action: 'node.preflight', expectedVersion: '18', nodeId: 'n1' })).toMatchObject({ status: 'rejected', error: { code: 'EDITOR_BUSY' } });
    expect(api.cost).not.toHaveBeenCalled(); expect(api.invoke).not.toHaveBeenCalled();
  });
  it('rejects an invalid quote and strict internal run never bypasses backend costing', async () => {
    const rt = await prepare([node('image')]); api.cost.mockResolvedValueOnce(success(-1));
    expect(await execute(rt, { action: 'node.preflight', expectedVersion: '18', nodeId: 'n1' })).toMatchObject({ status: 'rejected', effect: 'none' });
    api.cost.mockRejectedValueOnce(Object.assign(new Error('quote offline'), { requestPhase: 'sent_unknown' }));
    expect(await execute(rt, { action: 'node.run', expectedVersion: '18', nodeId: 'n1', approvedGeneration: { images: 1, videos: 0 } })).toMatchObject({ status: 'rejected', effect: 'none' });
    expect(api.invoke).not.toHaveBeenCalled(); expect(api.contexts.get('2873')!.store.getState().agentPersistenceIssue).toBeNull();
  });
  it('preflight notices a version change while awaiting backend quote', async () => {
    const rt = await prepare([node('image')]); const gate = deferred<any>(); api.cost.mockReturnValueOnce(gate.promise);
    const checking = execute(rt, { action: 'node.preflight', expectedVersion: '18', nodeId: 'n1' }); await vi.waitFor(() => expect(api.cost).toHaveBeenCalled());
    api.contexts.get('2873')!.store.setState({ versionNumber: '19' }); gate.resolve(success(1));
    expect(await checking).toMatchObject({ status: 'rejected', error: { code: 'VERSION_CONFLICT' } }); expect(api.invoke).not.toHaveBeenCalled();
  });
  it('publishes a submitted then associated completed result with no iframe and never includes previous outputs', async () => {
    vi.useFakeTimers(); const old = node('image'); old.width = 400; old.height = 400; old.measured = { width: 400, height: 400 }; old.data.meta = { width: 400, height: 400 }; old.data.value = 'https://assets.example/old.png'; old.data.taskInfo = { status: 'success', taskId: 'old-node-task' };
    const rt = await prepare([old]); const ctx = api.contexts.get('2873')!; const listener = vi.fn(); ctx.subscribeRun('request-real', listener);
    const result = await rt.execute({ canvasId: '2873', requestId: 'request-real', operation: { action: 'node.run', expectedVersion: '18', nodeId: 'n1', approvedGeneration: { images: 1, videos: 0 } } });
    expect(result).toMatchObject({ status: 'submitted' }); expect(ctx.getRun('request-real')).toMatchObject({ phase: 'submitted', outputs: [] });
    api.graph.mockResolvedValueOnce(row([old], '19', 'SUCCESS')); await vi.advanceTimersByTimeAsync(200);
    expect(ctx.getRun('request-real')?.phase).toBe('monitoring_unknown');
    const generated = { ...old, data: { ...old.data, value: 'https://assets.example/new.png', product: [{ value: old.data.value }, { value: 'https://assets.example/new.png' }], taskInfo: { status: 'success', taskId: 'new-node-task' } } };
    api.graph.mockResolvedValueOnce(row([generated], '20', 'SUCCESS')); await rt.reloadContext({ canvasId: '2873', capability: 'read' });
    expect(ctx.getRun('request-real')).toMatchObject({ phase: 'completed', workflowTaskId: 'task-fixture', nodeTaskId: 'new-node-task', outputs: ['https://assets.example/new.png'] });
    expect(listener.mock.calls.at(-1)?.[0].phase).toBe('completed'); expect(document.querySelectorAll('iframe')).toHaveLength(0); expect(api.invoke).toHaveBeenCalledTimes(1);
  });
  it('six monitoring errors emit monitoring_unknown without pretending the backend failed', async () => {
    vi.useFakeTimers(); const rt = await prepare([node('image')]); const ctx = api.contexts.get('2873')!;
    await rt.execute({ canvasId: '2873', requestId: 'offline-run', operation: { action: 'node.run', expectedVersion: '18', nodeId: 'n1', approvedGeneration: { images: 1, videos: 0 } } });
    api.graph.mockRejectedValue(new Error('offline')); await vi.advanceTimersByTimeAsync(50_200);
    expect(ctx.getRun('offline-run')).toMatchObject({ phase: 'monitoring_unknown', outputs: [], error: { code: 'READ_TIMEOUT', retry: 'never_auto' } });
    expect(ctx.store.getState().status).toBe('FAILURE'); expect(api.invoke).toHaveBeenCalledTimes(1);
    expect(() => ctx.runs.assertNodeAvailable('n1')).toThrow('前一次生成结果尚未确认');
  });
});


it.each(['image', 'video'])('uses actual reference inputs for %s single generation, never executes upstream or opens a view', async type => {
  const mode = type === 'image' ? 'reference_image_to_image' : 'image_to_video';
  api.models.mockResolvedValueOnce(success([{ config: JSON.stringify({ [type]: { [mode]: { name: 'reference fixture', models: { fixture: model } } } }) }]));
  const source = node('image', 'source'); source.data.type = 'upload'; source.data.value = 'https://assets.example/source.png';
  source.width = 400; source.height = 400; source.measured = { width: 400, height: 400 }; source.data.meta = { width: 400, height: 400 };
  const target = node(type); (target.data.params as any).modelType = mode;
  api.graph.mockResolvedValueOnce(row([source, target], '18', 'FINISHED', [{ id: 'reference', source: 'source', target: 'n1', sourceHandle: 'image_source', targetHandle: 'image_target' }]));
  const rt = service(); await rt.ensureContext({ canvasId: '2873', capability: 'edit' });
  const snapshot = await execute(rt, { action: 'canvas.read' }); if (snapshot.status !== 'read' || !snapshot.version) throw new Error(JSON.stringify(snapshot));
  const preflight = await execute(rt, { action: 'node.preflight', expectedVersion: snapshot.version, nodeId: 'n1' }); expect(preflight.status).toBe('preflight');
  const result = await rt.execute({ canvasId: '2873', requestId: 'reference-run', operation: { action: 'node.run', expectedVersion: snapshot.version, nodeId: 'n1', approvedGeneration: type === 'image' ? { images: 1, videos: 0 } : { images: 0, videos: 1 } } });
  expect(result).toMatchObject({ status: 'submitted' }); expect(api.invoke).toHaveBeenCalledTimes(1);
  expect(api.invoke.mock.calls[0][0]).toMatchObject({ executeStrategy: 'single', runningNodeIds: ['n1'], workflowData: { edges: [expect.objectContaining({ source: 'source', target: 'n1' })] } });
  expect(document.querySelectorAll('iframe')).toHaveLength(0);
});

it('an upstream still generating cannot silently reuse its previous artifact', async () => {
  api.models.mockResolvedValueOnce(success([{ config: JSON.stringify({ image: { reference_image_to_image: { name: 'reference', models: { fixture: model } } } }) }]));
  const source = node('image', 'source'); source.data.value = 'https://assets.example/previous.png'; source.data.taskInfo = { status: 'running' };
  source.width = 400; source.height = 400; source.measured = { width: 400, height: 400 }; source.data.meta = { width: 400, height: 400 };
  const target = node('image'); (target.data.params as any).modelType = 'reference_image_to_image';
  api.graph.mockResolvedValueOnce(row([source, target], '18', 'RUNNING', [{ id: 'reference', source: 'source', target: 'n1', sourceHandle: 'image_source', targetHandle: 'image_target' }]));
  const rt = service(); await rt.ensureContext({ canvasId: '2873', capability: 'edit' });
  expect(await execute(rt, { action: 'node.preflight', expectedVersion: '18', nodeId: 'n1' })).toMatchObject({ status: 'rejected', error: { code: 'NODE_BUSY' } });
  expect(api.cost).not.toHaveBeenCalled(); expect(api.invoke).not.toHaveBeenCalled();
});

describe('TTS native configuration and protected generation', () => {
  it('existing multi-target workflow preserves per-node audio/image counts and tracks both with one native submit', async () => {
    const rt = await prepare([audioNode(), node('image')]);
    const result = await execute(rt, { action: 'workflow.run', expectedVersion: '18', nodeIds: ['audio', 'n1'],
      approvedGenerations: { audio: { images: 0, videos: 0, audios: 1 }, n1: { images: 1, videos: 0 } }, runRequestIds: { audio: 'mixed-audio', n1: 'mixed-image' } });
    expect(result).toMatchObject({ status: 'submitted', results: [{ nodeId: 'audio', generation: { audios: 1 } }, { nodeId: 'n1', generation: { images: 1, videos: 0 } }] });
    expect(api.invoke).toHaveBeenCalledTimes(1);
    expect(api.contexts.get('2873')!.getRun('mixed-audio')).toMatchObject({ phase: 'submitted', generation: { audios: 1 } });
  });
  it('public model/voice tools configure a native audio node, preserve senior fields and save a real text edge without opening a view', async () => {
    const rt = service(), host = createCanvasHostBridge(), origin = 'http://localhost';
    const registration = host.attachClient(origin, 'audio-client', 'web-locks-v1');
    const endpoint = createCanvasCommandEndpoint({ connectionId: registration.connectionId, getRuntime: async () => rt, isSessionBound: () => true, send: event => host.acceptClientEvent(registration.bridgeKey, origin, event) });
    const disconnect = host.connectStream(registration.bridgeKey, origin, event => { void endpoint.handle(event); });
    host.acceptClientEvent(registration.bridgeKey, origin, { type: 'session.sync', protocolVersion: 4, connectionId: registration.connectionId, revision: 1, sessionIds: ['tts-session'] });
    const definitions = new Map<string, any>(), cleanups: Array<() => void> = [];
    const toolContext = { tools: { register: (definition: any) => definitions.set(definition.name, definition) }, effect: (fn: any) => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); } };
    registerCanvasTools(toolContext as any, host); registerCanvasGraphTools(toolContext as any, host);
    let version = 18; api.update.mockImplementation(async () => success({ versionNumber: String(++version) }));
    const run = async (name: string, args: any, callId: string) => toolResult(await definitions.get(name).execute(toolInput(name, { canvasId: '2873', ...args }), { callId, agent: { id: 'tts-session' }, signal: new AbortController().signal }));
    try {
      const catalog = await run('canvas_models', { nodeType: 'audio', model: 'fixture-tts' }, 'models');
      expect(catalog).toMatchObject({ status: 'models', modelType: 'tts', seniorParamHints: expect.arrayContaining([expect.objectContaining({ field: 'speed', step: 0.1 })]) });
      expect(await run('canvas_models', { nodeType: 'audio', view: 'voices', model: catalog.model, limit: 5 }, 'voices')).toMatchObject({ status: 'voices', voices: [{ voiceId: 'voice-public', compatibility: 'model_declared' }] });
      const audio = await run('canvas_node_edit', { expectedVersion: String(version), action: 'add', node: { type: 'audio', changes: { title: '配音验收' } } }, 'add-audio');
      const nodeId = audio.affectedNodeIds[0];
      const configured = await run('canvas_node_edit', { expectedVersion: String(version), action: 'configure', nodeId, configuration: { model: catalog.model, voiceId: 'voice-public', seniorParams: { speed: 1.2 } } }, 'configure');
      expect(configured.status).toBe('saved');
      const text = await run('canvas_node_edit', { expectedVersion: String(version), action: 'add', node: { type: 'text', changes: { text: '轻巧随行，听见更多' } } }, 'add-text');
      const edge = await run('canvas_edges', { expectedVersion: String(version), action: 'add', connection: { sourceNodeId: text.affectedNodeIds[0], targetNodeId: nodeId } }, 'connect');
      expect(edge.status).toBe('saved');
      const graph = await run('canvas_get', { view: 'graph' }, 'audio-graph');
      expect(graph).toMatchObject({ status: 'graph', nodes: expect.arrayContaining([expect.objectContaining({ id: nodeId, type: 'audio', canConfigureGeneration: true })]), edgeCount: 1 });
      const read = await run('canvas_get', { view: 'nodes', nodeIds: [nodeId] }, 'read');
      expect(read).toMatchObject({ status: 'read', consistency: 'confirmed', nodes: [{ params: { modelType: 'tts', voiceId: 'voice-public' }, seniorParams: { speed: 1.2, pitch: 0, emotion: 'auto' }, generation: { images: 0, videos: 0, audios: 1 }, inputs: [{ nodeId: text.affectedNodeIds[0] }] }] });
      expect(api.contexts.get('2873')!.store.getState().edges[0]).toMatchObject({ sourceHandle: 'text_source', targetHandle: 'text_target' });
      expect(api.update).toHaveBeenCalledTimes(4); expect(api.invoke).not.toHaveBeenCalled(); expect(document.querySelectorAll('iframe')).toHaveLength(0);
      expect(await run('canvas_models', { nodeType: 'image', view: 'voices' }, 'wrong-type')).toMatchObject({ status: 'rejected', error: { code: 'INVALID_ARGUMENT' } });
      expect(await run('canvas_models', { nodeType: 'audio', view: 'voices', modeOffset: 0 }, 'mixed')).toMatchObject({ status: 'rejected', error: { code: 'INVALID_ARGUMENT' } });
    } finally { cleanups.forEach(fn => fn()); disconnect(); endpoint.dispose(); host.dispose(); }
  });

  it.each(['version', 'draft', 'params', 'permission'])('does not save a stale voice proof when %s changes during lookup', async change => {
    const rt = await prepare([audioNode()]), ctx = api.contexts.get('2873')!, gate = deferred<any>(); api.voice.mockReturnValueOnce(gate.promise);
    const saving = execute(rt, { action: 'node.configure', expectedVersion: '18', nodeId: 'audio', configuration: { seniorParams: { speed: 1.2 } } });
    await vi.waitFor(() => expect(api.voice).toHaveBeenCalled());
    if (change === 'version') ctx.store.setState({ versionNumber: '19' });
    if (change === 'draft') ctx.guard.markEditorBusy('user-draft', true);
    if (change === 'params') ctx.store.setState({ nodes: ctx.store.getState().nodes.map(n => ({ ...n, data: { ...n.data, params: { ...(n.data.params as object), prompt: 'user edit' } } })) });
    if (change === 'permission') ctx.store.setState({ modelNodePermission: { ...ctx.store.getState().modelNodePermission! } });
    gate.resolve(success({ voiceType: 'PUBLIC_VOICE', publicVoice: { voiceId: 'voice-public', name: '测试音色' } }));
    expect(await saving).toMatchObject({ status: 'rejected', effect: 'none', error: { code: change === 'draft' ? 'EDITOR_BUSY' : 'VERSION_CONFLICT' } });
    expect(api.update).not.toHaveBeenCalled(); expect(api.invoke).not.toHaveBeenCalled();
  });

  it.each(['missing', 'off-sale', 'timeout'])('invalid %s voice neither saves nor submits, and read uncertainty does not fence the canvas', async condition => {
    const target = audioNode(); if (condition === 'missing') (target.data.params as any).voiceId = '';
    const rt = await prepare([target]);
    if (condition === 'off-sale') api.voice.mockResolvedValue(success({ voiceType: 'PUBLIC_VOICE', publicVoice: { voiceId: 'voice-public', name: 'x', onSale: 0 } }));
    if (condition === 'timeout') api.voice.mockRejectedValue(Object.assign(new Error('voice timeout'), { requestPhase: 'sent_unknown' }));
    expect(await execute(rt, { action: 'node.preflight', expectedVersion: '18', nodeId: 'audio' })).toMatchObject({ status: 'rejected', effect: 'none' });
    expect(await execute(rt, { action: 'node.run', expectedVersion: '18', nodeId: 'audio', approvedGeneration: { images: 0, videos: 0, audios: 1 } })).toMatchObject({ status: 'rejected', effect: 'none' });
    expect(api.update).not.toHaveBeenCalled(); expect(api.invoke).not.toHaveBeenCalled(); expect(api.contexts.get('2873')!.store.getState().agentPersistenceIssue).toBeNull();
  });

  it.each(['params', 'model'])('rechecks approved audio %s inside the native submission queue after capacity awaits', async change => {
    const rt = await prepare([audioNode()]), gate = deferred<any>(); api.capacity.mockReturnValueOnce(gate.promise);
    const generating = execute(rt, { action: 'node.run', expectedVersion: '18', nodeId: 'audio', approvedGeneration: { images: 0, videos: 0, audios: 1 } });
    await vi.waitFor(() => expect(api.capacity).toHaveBeenCalled()); const ctx = api.contexts.get('2873')!;
    if (change === 'params') ctx.store.setState({ nodes: ctx.store.getState().nodes.map(n => ({ ...n, data: { ...n.data, params: { ...(n.data.params as object), voiceId: 'changed-after-check' } } })) });
    else {
      const modelsMap = structuredClone(ctx.store.getState().modelsMap) as any;
      modelsMap.audio[0].params.find((model: any) => model.value === 'fixture-tts').platform = 'new-platform';
      ctx.store.setState({ modelsMap });
    }
    gate.resolve(success({ usedCapacity: 0, limitCapacity: 100 }));
    expect(await generating).toMatchObject({ status: 'rejected', error: { code: 'COUNT_CHANGED' } }); expect(api.invoke).not.toHaveBeenCalled();
  });

  it('previous audio is not a new TTS result; a new task/output is tracked and cannot be submitted twice after an unknown result', async () => {
    vi.useFakeTimers(); const target = audioNode(); target.data.value = 'https://assets.example/old.mp3'; target.data.taskInfo = { status: 'success', taskId: 'old' };
    const rt = await prepare([target]), ctx = api.contexts.get('2873')!;
    api.invoke.mockResolvedValueOnce(success({ taskId: 'accepted-without-version' }));
    expect(await rt.execute({ canvasId: '2873', requestId: 'tts-unknown', operation: { action: 'node.run', expectedVersion: '18', nodeId: 'audio', approvedGeneration: { images: 0, videos: 0, audios: 1 } } })).toMatchObject({ status: 'submission_unknown' });
    expect(ctx.getRun('tts-unknown')).toMatchObject({ outputs: [], generation: { audios: 1 } });
    expect(await execute(rt, { action: 'node.run', expectedVersion: '18', nodeId: 'audio', approvedGeneration: { images: 0, videos: 0, audios: 1 } })).toMatchObject({ status: 'rejected' });
    expect(api.invoke).toHaveBeenCalledTimes(1);
    api.graph.mockResolvedValueOnce(row([target], '19', 'SUCCESS')); await vi.advanceTimersByTimeAsync(200);
    expect(ctx.getRun('tts-unknown')?.outputs).toEqual([]);
    const generated = { ...target, data: { ...target.data, value: 'https://assets.example/new.mp3', product: [{ value: target.data.value }, { value: 'https://assets.example/new.mp3' }], taskInfo: { status: 'success', taskId: 'new-audio-task' } } };
    api.graph.mockResolvedValueOnce(row([generated], '20', 'SUCCESS')); await rt.reloadContext({ canvasId: '2873', capability: 'read' });
    expect(ctx.getRun('tts-unknown')).toMatchObject({ phase: 'completed', outputs: ['https://assets.example/new.mp3'], generation: { audios: 1 } });
  });
});

it.each(['text_to_audio', 'audio_to_audio'])('saves, reads and runs %s through native single and batch paths without a voice lookup', async modelType => {
  const rt = await prepare(); let version = 18;
  api.update.mockImplementation(async () => success({ versionNumber: String(++version) }));
  const run = (operation: any) => execute(rt, { expectedVersion: String(version), ...operation });
  const saved = await run({ action: 'node.add', node: { type: 'audio', changes: { prompt: '轻快的钢琴曲' } } });
  expect(saved.status).toBe('saved'); if (saved.status !== 'saved') throw new Error(JSON.stringify(saved));
  const nodeId = saved.affectedNodeIds[0];
  const catalog = await execute(rt, { action: 'canvas.models.read', nodeType: 'audio', modelType });
  expect(catalog).toMatchObject({ status: 'models', modelType, paramHints: expect.arrayContaining([expect.objectContaining({ field: 'audioWeight', min: 0, max: 1, step: 0.1 })]), seniorParamHints: expect.arrayContaining([expect.objectContaining({ field: 'lyrics', type: 'string', maxLength: 500 })]) });
  if (catalog.status !== 'models') throw new Error(JSON.stringify(catalog));
  expect(await run({ action: 'node.configure', nodeId, configuration: { modelType, model: catalog.model, params: { gen_count: 2, audioWeight: 0.7 }, seniorParams: { customMode: true, instrumental: false, title: '春日', lyrics: '春风轻轻吹' } } })).toMatchObject({ status: 'saved' });
  let sourceId: string | undefined;
  if (modelType === 'audio_to_audio') {
    expect(await run({ action: 'node.preflight', nodeId })).toMatchObject({ status: 'rejected', error: { code: 'RUN_REJECTED' } });
    const imported = await run({ action: 'asset.add', asset: { mediaType: 'audio', url: 'https://assets.example/reference.mp3' } });
    expect(imported.status).toBe('saved'); if (imported.status !== 'saved') throw new Error(JSON.stringify(imported));
    sourceId = imported.affectedNodeIds[0];
    expect(await run({ action: 'edge.add', connection: { sourceNodeId: sourceId, targetNodeId: nodeId } })).toMatchObject({ status: 'saved' });
  }
  const read = await execute(rt, { action: 'canvas.read', nodeIds: [nodeId] });
  expect(read).toMatchObject({ status: 'read', nodes: [{ params: { modelType, gen_count: 2, audioWeight: 0.7 }, seniorParams: { title: '春日', lyrics: '春风轻轻吹' }, inputs: modelType === 'audio_to_audio' ? [{ nodeId: sourceId }] : [], generation: { audios: 2 } }] });
  expect(() => parseCanvasOperationResult(read)).not.toThrow();
  expect(await run({ action: 'node.preflight', nodeId })).toMatchObject({ status: 'preflight', generation: { audios: 2 } });
  expect(await run({ action: 'node.run', nodeId, approvedGeneration: { images: 0, videos: 0, audios: 2 } })).toMatchObject({ status: 'submitted', generation: { audios: 2 } });
  const payload = api.invoke.mock.calls[0][0];
  expect(payload.workflowData.nodes.find((n: Node) => n.id === nodeId).data.params).toMatchObject({ modelType, gen_count: 2, audioWeight: 0.7 });
  expect(payload.workflowData.edges).toHaveLength(modelType === 'audio_to_audio' ? 1 : 0);
  if (sourceId) expect(payload.workflowData.nodes.find((n: Node) => n.id === sourceId).data).toMatchObject({ type: 'upload', value: 'https://assets.example/reference.mp3' });
  expect(api.voice).not.toHaveBeenCalled(); expect(document.querySelectorAll('iframe')).toHaveLength(0);

  const ctx = api.contexts.get('2873')!, target = ctx.store.getState().nodes.find(n => n.id === nodeId)!;
  const finished = { ...target, data: { ...target.data, taskInfo: { status: 'success', taskId: 'finished' }, value: 'https://assets.example/music.mp3' } };
  api.graph.mockResolvedValue(row(ctx.store.getState().nodes.map(n => n.id === nodeId ? finished : n), '20', 'FINISHED', ctx.store.getState().edges));
  await rt.reloadContext({ canvasId: '2873', capability: 'edit' }); version = 20;
  expect(await run({ action: 'workflow.run', nodeIds: [nodeId], approvedGenerations: { [nodeId]: { images: 0, videos: 0, audios: 2 } }, runRequestIds: { [nodeId]: 'music-batch' } })).toMatchObject({ status: 'submitted' });
  expect(api.invoke).toHaveBeenCalledTimes(2); expect(api.invoke.mock.calls[1][0].executeStrategy).toBe('total');
  expect(api.voice).not.toHaveBeenCalled();
});
