import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasContext } from '../src/canvas-context';

const api = vi.hoisted(() => ({ graph: vi.fn(), models: vi.fn(), permission: vi.fn(), tools: vi.fn(), update: vi.fn(), contexts: new Map<string, CanvasContext>(), creations: vi.fn() }));
vi.mock('@/api/workflow', () => ({ getFlowData: api.graph, getModelParams: api.models, listModelNodeSetting: api.permission, listToolNodeSetting: api.tools, updateCanvas: api.update, saveFlow: vi.fn(), excuteWorkFlow: vi.fn(), fetchTone: vi.fn(), getAllRule: vi.fn() }));
vi.mock('@/api/asset', () => ({ getAvailableCapacity: vi.fn() }));
vi.mock('@/components/canvasFlow/utils/mediaDimensionLoader', () => ({ loadIntrinsicMediaDimensions: vi.fn().mockResolvedValue(null) }));
vi.mock('@/utils', () => ({ isSvgImageUrl: () => false, compressImage: vi.fn() }));
vi.mock('../src/canvas-context', async importOriginal => {
  const original = await importOriginal<typeof import('../src/canvas-context')>();
  return { ...original, createCanvasContext: (id: string) => {
    api.creations(id); const context = original.createCanvasContext(id); api.contexts.set(id, context); return context;
  } };
});
import { createCanvasServiceRuntime } from '../src/canvas-service';

const success = (data: unknown) => ({ code: 'SUCCESS', data });
const input = (canvasId = '2873') => ({ canvasId, capability: 'read' as const });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
beforeEach(() => {
  vi.resetAllMocks(); api.contexts.clear();
  api.graph.mockResolvedValue(success({ name: '图', data: '{"nodes":[],"edges":[]}', taskStatus: 'FINISHED', versionNumber: '18' }));
  api.models.mockResolvedValue(success([{ config: '{}' }])); api.permission.mockResolvedValue(success([])); api.tools.mockResolvedValue(success([]));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => { api.contexts.forEach(context => context.dispose()); vi.unstubAllGlobals(); });

describe('per-Client canvas registry', () => {
  it('does not create contexts on module/runtime load; concurrent ensure uses one real context and one API load', async () => {
    const service = createCanvasServiceRuntime(); expect(api.creations).not.toHaveBeenCalled();
    const [a, b] = await Promise.all([service.ensureContext(input()), service.ensureContext(input())]);
    expect(a.contextId).toBe(b.contextId); expect(api.creations).toHaveBeenCalledTimes(1); expect(api.graph).toHaveBeenCalledTimes(1);
    expect(a.readiness.capabilities).toEqual({ read: true, edit: true, run: false }); service.dispose();
  });
  it('isolates canvas IDs and preserves large IDs without Number conversion', async () => {
    const service = createCanvasServiceRuntime(); const a = await service.ensureContext(input()); const b = await service.ensureContext(input('9007199254740993'));
    expect(a.contextId).not.toBe(b.contextId); expect(api.graph.mock.calls[1][0].id).toBe('9007199254740993');
    expect(service.getContextInfo('2873')?.contextId).toBe(a.contextId); service.dispose();
  });
  it('unknown information/subscriptions/close do not silently create a canvas', async () => {
    const service = createCanvasServiceRuntime(); const listener = vi.fn();
    expect(service.getContextInfo('2873')).toBeNull(); service.subscribeReadiness('2873', listener)(); await service.closeContext('2873');
    expect(listener).not.toHaveBeenCalled(); expect(api.creations).not.toHaveBeenCalled(); service.dispose();
  });
  it('initializes a cold authoritative read once without a view, and shares concurrent cold refreshes', async () => {
    const service = createCanvasServiceRuntime();
    const [a, b] = await Promise.all([service.reloadContext(input()), service.reloadContext(input())]);
    expect(a.contextId).toBe(b.contextId); expect(a.readiness.capabilities.read).toBe(true);
    expect(a.readiness.version).toBe('18'); expect(api.creations).toHaveBeenCalledTimes(1);
    expect(api.graph).toHaveBeenCalledTimes(1); expect(typeof document).toBe('undefined');
    service.dispose();
  });
  it('an existing authoritative reload remains one fresh load and rejects concurrent refresh while preparing', async () => {
    const service = createCanvasServiceRuntime(); const original = await service.ensureContext(input());
    const gate = deferred<unknown>(); api.graph.mockReturnValueOnce(gate.promise);
    const refresh = service.reloadContext(input());
    await vi.waitFor(() => expect(api.graph).toHaveBeenCalledTimes(2));
    await expect(service.reloadContext(input())).rejects.toMatchObject({ code: 'EDITOR_BUSY' });
    gate.resolve(success({ name: '新图', data: '{"nodes":[],"edges":[]}', taskStatus: 'FINISHED', versionNumber: '19' }));
    const refreshed = await refresh;
    expect(refreshed.contextId).toBe(original.contextId); expect(refreshed.readiness.version).toBe('19');
    expect(api.creations).toHaveBeenCalledTimes(1); expect(api.graph).toHaveBeenCalledTimes(2); service.dispose();
  });
  it('cancellation during cold ownership preparation does not start a graph request or prevent a later refresh', async () => {
    const service = createCanvasServiceRuntime(); const abort = new AbortController();
    const refresh = service.reloadContext({ ...input(), signal: abort.signal }); abort.abort();
    await expect(refresh).rejects.toMatchObject({ code: 'CANCELLED_BEFORE_DISPATCH' });
    expect(api.creations).toHaveBeenCalledTimes(1); expect(api.graph).not.toHaveBeenCalled();
    const refreshed = await service.reloadContext(input());
    expect(refreshed.readiness.version).toBe('18'); expect(api.creations).toHaveBeenCalledTimes(1);
    expect(api.graph).toHaveBeenCalledTimes(1); service.dispose();
  });
  it('rejects invalid IDs/capabilities/pre-aborted input before any factory or request', async () => {
    const service = createCanvasServiceRuntime();
    await expect(service.ensureContext(input('0'))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(service.ensureContext({ ...input(), capability: 'anything' as 'read' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(service.ensureContext({ ...input(), signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'CANCELLED_BEFORE_DISPATCH' });
    await expect(service.reloadContext({ ...input(), signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'CANCELLED_BEFORE_DISPATCH' });
    expect(api.creations).not.toHaveBeenCalled(); service.dispose();
  });
  it('each cancelled waiter leaves another concurrent ensure alive', async () => {
    const service = createCanvasServiceRuntime(); const gate = deferred<unknown>(); api.graph.mockReturnValueOnce(gate.promise);
    const abort = new AbortController(); const a = service.ensureContext({ ...input(), signal: abort.signal }); const b = service.ensureContext(input());
    const cancelled = expect(a).rejects.toMatchObject({ code: 'CANCELLED_BEFORE_DISPATCH' }); abort.abort(); await cancelled;
    gate.resolve(success({ data: '{"nodes":[],"edges":[]}', versionNumber: '18', taskStatus: 'FINISHED' }));
    await b; expect(api.creations).toHaveBeenCalledTimes(1); service.dispose();
  });
  it('retains a failed context and uses explicit reload instead of auto-retrying ensure', async () => {
    const service = createCanvasServiceRuntime(); api.graph.mockRejectedValueOnce(new Error('取图失败'));
    await expect(service.ensureContext(input())).rejects.toMatchObject({ code: 'FRAME_NOT_READY' });
    await expect(service.ensureContext(input())).rejects.toMatchObject({ code: 'FRAME_NOT_READY' }); expect(api.graph).toHaveBeenCalledTimes(1);
    const id = service.getContextInfo('2873')?.contextId; await service.reloadContext(input());
    expect(service.getContextInfo('2873')?.contextId).toBe(id); expect(api.graph).toHaveBeenCalledTimes(2); service.dispose();
  });
  it('subscribes to existing context immediately and notifies its disposal on close', async () => {
    const service = createCanvasServiceRuntime(); await service.ensureContext(input()); const listener = vi.fn(); service.subscribeReadiness('2873', listener);
    expect(listener).toHaveBeenCalledTimes(1); await service.closeContext('2873');
    expect(listener.mock.lastCall?.[0].phase).toBe('disposed'); expect(service.getContextInfo('2873')).toBeNull(); service.dispose();
  });
  it('refuses close during preparation, drafts, in-flight writes, RUNNING or unconfirmed state', async () => {
    const service = createCanvasServiceRuntime(); const gate = deferred<unknown>(); api.graph.mockReturnValueOnce(gate.promise);
    const prepare = service.ensureContext(input()); await expect(service.closeContext('2873')).rejects.toMatchObject({ code: 'EDITOR_BUSY' });
    gate.resolve(success({ data: '{"nodes":[],"edges":[]}', versionNumber: '18', taskStatus: 'FINISHED' })); await prepare;
    const context = api.contexts.get('2873')!; context.guard.markEditorBusy('draft', true);
    await expect(service.closeContext('2873')).rejects.toMatchObject({ code: 'EDITOR_BUSY' }); context.guard.markEditorBusy('draft', false);
    context.store.setState({ status: 'RUNNING' }); await expect(service.closeContext('2873')).rejects.toMatchObject({ code: 'NODE_BUSY' }); context.store.setState({ status: 'FINISHED' });
    context.store.setState({ agentPersistenceIssue: { code: 'SUBMISSION_UNKNOWN', message: '未知', retry: 'read_first' } });
    await expect(service.closeContext('2873')).rejects.toMatchObject({ code: 'SUBMISSION_UNKNOWN' }); context.store.setState({ agentPersistenceIssue: null });
    const save = deferred<unknown>(); const original = context.store.getState().actions.partialUpdate;
    const write = context.guard.run(() => save.promise, async () => undefined);
    await expect(service.closeContext('2873')).rejects.toMatchObject({ code: 'EDITOR_BUSY' }); save.resolve(undefined); await write;
    expect(context.store.getState().actions.partialUpdate).toBe(original); service.dispose();
  });
  it('closing an idle context allows a fresh context ID; dispose aborts preparation and prohibits all reuse', async () => {
    const service = createCanvasServiceRuntime(); const a = await service.ensureContext(input()); await service.closeContext('2873'); const b = await service.ensureContext(input());
    expect(b.contextId).not.toBe(a.contextId);
    const gate = deferred<unknown>(); api.graph.mockReturnValueOnce(gate.promise);
    const preparing = service.ensureContext(input('2874')); const stopped = expect(preparing).rejects.toMatchObject({ code: 'FRAME_GONE' });
    service.dispose(); service.dispose(); await stopped; gate.resolve(success({ data: '{"nodes":[],"edges":[]}' }));
    await expect(service.ensureContext(input())).rejects.toMatchObject({ code: 'FRAME_GONE' });
    expect(() => service.getContextInfo('2873')).toThrow();
  });
  it('refuses close for real native UI queue persistence and polling uncertainty', async () => {
    const service = createCanvasServiceRuntime(); await service.ensureContext(input());
    const context = api.contexts.get('2873')!; context.setOwnership('active'); await context.reload('edit');
    const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    const write = context.store.getState().actions.partialUpdate('2873', {});
    await expect(service.closeContext('2873')).rejects.toMatchObject({ code: 'EDITOR_BUSY' });
    expect(context.guard.isOperationBusy()).toBe(false);
    gate.resolve(success({ versionNumber: '19' })); await write; expect(api.update).toHaveBeenCalledTimes(1);
    await context.barrier.runPolling(async () => null, () => false);
    await expect(service.closeContext('2873')).rejects.toMatchObject({ code: 'VERSION_CONFLICT' }); service.dispose();
  });
  it('a cleanup error from one context cannot leave the remaining contexts alive', async () => {
    const service = createCanvasServiceRuntime(); await service.ensureContext(input()); await service.ensureContext(input('2874'));
    const a = api.contexts.get('2873')!; const b = api.contexts.get('2874')!; const original = a.dispose;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dispose = vi.spyOn(a, 'dispose').mockImplementation(() => { original(); throw new Error('view cleanup failed'); });
    try { service.dispose(); expect(b.getInfo().readiness.phase).toBe('disposed'); expect(log).toHaveBeenCalled(); }
    finally { dispose.mockRestore(); log.mockRestore(); }
  });
  it('an idle close that reports a cleanup error does not leave a disposed context in the registry', async () => {
    const service = createCanvasServiceRuntime(); await service.ensureContext(input());
    const context = api.contexts.get('2873')!; const original = context.dispose;
    const stop = vi.spyOn(context, 'dispose').mockImplementation(() => { original(); throw new Error('cleanup failed'); });
    await expect(service.closeContext('2873')).rejects.toThrow('cleanup failed');
    expect(service.getContextInfo('2873')).toBeNull(); stop.mockRestore();
    await service.ensureContext(input()); expect(api.creations).toHaveBeenCalledTimes(2); service.dispose();
  });
});
