import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';

const api = vi.hoisted(() => ({ update: vi.fn(), save: vi.fn(), invoke: vi.fn(), capacity: vi.fn() }));
vi.mock('@/api/workflow', () => ({ updateCanvas: api.update, saveFlow: api.save, excuteWorkFlow: api.invoke }));
vi.mock('@/api/asset', () => ({ getAvailableCapacity: api.capacity }));
vi.mock('@/components/canvasFlow/utils/mediaDimensionLoader', () => ({ loadIntrinsicMediaDimensions: vi.fn().mockResolvedValue(null) }));
vi.mock('@/utils', () => ({ isSvgImageUrl: () => false, compressImage: vi.fn() }));
// Importing the factory must not bootstrap the UI Store or router/dialog tree.
vi.mock('@/store/flowStore', () => { throw new Error('Core imported the UI Store'); });
vi.mock('@/routes', () => { throw new Error('Core imported the router'); });
vi.mock('@/components/common/storageLimitManager', () => { throw new Error('Core eagerly imported the UI dialog'); });

import { createFlowStoreApi, type FlowStoreOptions } from '../legacy/src/store/flowStoreCore';
import { createCanvasVersionBarrier } from '../legacy/src/lib/canvasVersionBarrier';
import { createAgentEditGuard } from '../src/agent-edit-guard';
import { isCanvasReadOnly, setCanvasReadOnlyFlag } from '../legacy/src/components/canvasFlow/utils/canvasReadOnly';

const options = { strictReceipt: true as const, expectedVersion: '18' };
const makeNode = (): Node => ({ id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: { title: '原文', value: '内容', params: { prompt: '旧提示', model: 'fixture' } } });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const saved = (versionNumber = '19') => ({ code: 'SUCCESS', data: { versionNumber } });
const makeContext = (canvasId: string, extra: FlowStoreOptions = {}) => {
  const guard = createAgentEditGuard();
  const barrier = createCanvasVersionBarrier();
  const store = createFlowStoreApi({ ...extra, guard, barrier });
  store.setState({ canvasId, versionNumber: '18', nodes: [makeNode()] });
  return { store, guard, barrier, state: () => store.getState() };
};

beforeEach(() => {
  vi.resetAllMocks(); setCanvasReadOnlyFlag(false);
  api.update.mockResolvedValue(saved()); api.save.mockResolvedValue(saved());
  api.capacity.mockResolvedValue({ code: 'SUCCESS', data: { usedCapacity: 0, limitCapacity: 100 } });
});

describe('per-canvas native Store factories', () => {
  it('a mutation blocks polling only on its own barrier, and releasing twice is harmless', async () => {
    const a = createCanvasVersionBarrier(); const b = createCanvasVersionBarrier();
    const release = a.beginMutation(); const requestA = vi.fn().mockResolvedValue('a');
    const pollA = a.runPolling(requestA, () => true);
    try {
      await b.runPolling(async () => 'b', () => false);
      expect(requestA).not.toHaveBeenCalled(); expect(a.isUncertain()).toBe(false); expect(b.isUncertain()).toBe(true);
    } finally { release(); release(); await pollA; }
    await a.runPolling(async () => 'after release', () => true);
    expect(requestA).toHaveBeenCalledTimes(1); expect(a.consumeUncertain()).toBe(false);
    expect(b.consumeUncertain()).toBe(true); expect(b.consumeUncertain()).toBe(false);
  });
  it('isolates nodes, history, model parameters, versions and reset', async () => {
    const a = makeContext('2873'); const b = makeContext('2874');
    a.state().actions.setModelsMap({ fixture: { model: 'a' } });
    a.state().actions.recordSnapshot();
    await a.state().actions.updateNodeData('n1', { title: 'A' }, true, true, options);
    expect(a.state().versionNumber).toBe('19'); expect(b.state().versionNumber).toBe('18');
    expect(b.state().nodes[0].data.title).toBe('原文'); expect(b.state().modelsMap).toEqual({});
    a.state().actions.reset();
    expect(b.state().canvasId).toBe('2874'); expect(b.state().nodes).toHaveLength(1); expect(b.state().undoStack).toEqual([]);
    expect(a.state().actions).not.toBe(b.state().actions);
  });
  it('uses its own readOnly even when the legacy UI flag is true', async () => {
    const a = makeContext('2873'); const b = makeContext('2874');
    a.state().actions.setReadOnly(true);
    expect(isCanvasReadOnly()).toBe(false);
    await expect(a.state().actions.partialUpdate('2873', {}, options)).rejects.toMatchObject({ code: 'READ_ONLY', requestPhase: 'not_sent' });
    setCanvasReadOnlyFlag(true);
    try {
      await b.state().actions.partialUpdate('2874', {}, options);
      expect(api.update).toHaveBeenCalledTimes(1); expect(api.update.mock.calls[0][0].id).toBe('2874');
      a.state().actions.reset(); expect(isCanvasReadOnly()).toBe(true);
    } finally { setCanvasReadOnlyFlag(false); }
  });
  it('keeps the original UI persistence queue serial within each Store', async () => {
    const a = makeContext('2873'); const b = makeContext('2874'); const gate = deferred<unknown>();
    api.update.mockImplementation((payload: { id: string; versionNumber: string }) => payload.id === '2873' && payload.versionNumber === '18' ? gate.promise : Promise.resolve(saved('20')));
    const first = a.state().actions.partialUpdate('2873', {});
    const second = a.state().actions.partialUpdate('2873', {});
    try {
      await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
      await b.state().actions.partialUpdate('2874', {}, options);
      expect(api.update.mock.calls.map(([payload]) => payload.id)).toEqual(['2873', '2874']);
      gate.resolve(saved()); await first; await second;
      expect(api.update.mock.calls[2][0]).toMatchObject({ id: '2873', versionNumber: '19' });
    } finally { gate.resolve(saved()); await Promise.allSettled([first, second]); }
  });
  it('A drafts and active strict operations do not block B; a second strict A operation is rejected', async () => {
    const a = makeContext('2873'); const b = makeContext('2874');
    a.guard.markEditorBusy('n1:prompt', true);
    await expect(a.state().actions.partialUpdate('2873', {}, options)).rejects.toMatchObject({ code: 'EDITOR_BUSY' });
    await b.state().actions.partialUpdate('2874', {}, options);
    a.guard.markEditorBusy('n1:prompt', false);
    const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    const first = a.state().actions.partialUpdate('2873', {}, options);
    try {
      await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
      expect(a.guard.isOperationBusy()).toBe(true); expect(b.guard.isOperationBusy()).toBe(false);
      await expect(a.state().actions.partialUpdate('2873', {}, options)).rejects.toMatchObject({ code: 'EDITOR_BUSY', requestPhase: 'not_sent' });
      await b.state().actions.partialUpdate('2874', {}, { ...options, expectedVersion: '19' });
      expect(api.update).toHaveBeenCalledTimes(3);
    } finally { gate.resolve(saved()); await first; }
    expect(a.guard.isOperationBusy()).toBe(false);
  });
  it('waits only for its own polling and checks the resulting version before dispatch', async () => {
    const a = makeContext('2873'); const b = makeContext('2874'); const gate = deferred<string>();
    const poll = a.barrier.runPolling(() => gate.promise, version => { a.state().actions.setVersionNumber(version); return true; });
    await Promise.resolve();
    const strict = a.state().actions.partialUpdate('2873', {}, options);
    const outcome = expect(strict).rejects.toMatchObject({ code: 'VERSION_CONFLICT', requestPhase: 'not_sent' });
    try {
      await b.state().actions.partialUpdate('2874', {}, options);
      expect(api.update).toHaveBeenCalledTimes(1); expect(api.update.mock.calls[0][0].id).toBe('2874');
    } finally { gate.resolve('19'); await poll; await outcome; }
    expect(api.update).toHaveBeenCalledTimes(1);
  });
  it('does not consume another canvas uncertainty or persistence failure', async () => {
    const a = makeContext('2873'); const b = makeContext('2874');
    await a.barrier.runPolling(async () => null, () => false);
    await b.state().actions.partialUpdate('2874', {}, options);
    expect(a.barrier.isUncertain()).toBe(true);
    await expect(a.state().actions.partialUpdate('2873', {}, options)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(a.state().versionConflict).toBe(true); expect(b.state().versionConflict).toBe(false);
    a.store.setState({ versionConflict: false });
    api.update.mockRejectedValueOnce(Object.assign(new Error('unknown'), { requestPhase: 'sent_unknown' }));
    await expect(a.state().actions.partialUpdate('2873', {}, options)).rejects.toThrow('unknown');
    expect(a.state().agentPersistenceIssue?.code).toBe('SUBMISSION_UNKNOWN'); expect(b.state().agentPersistenceIssue).toBeNull();
    await b.state().actions.partialUpdate('2874', {}, { ...options, expectedVersion: '19' });
  });
  it('keeps same-node media persistence and UI void returns independent across canvases', async () => {
    const a = makeContext('2873'); const b = makeContext('2874'); const gate = deferred<unknown>();
    api.update.mockImplementation((payload: { id: string }) => payload.id === '2873' ? gate.promise : Promise.resolve(saved()));
    expect(a.state().actions.updateNodeData('n1', { title: 'UI A' })).toBeUndefined();
    try {
      await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
      await b.state().actions.updateNodeData('n1', { title: 'Agent B' }, true, true, options);
      expect(b.state().nodes[0].data.title).toBe('Agent B'); expect(b.state().versionNumber).toBe('19');
      expect(a.state().versionNumber).toBe('18');
    } finally { gate.resolve(saved()); await a.state().actions.awaitMutationsIdle(); }
  });
  it('routes native errors and capacity notices only to the injected feedback', async () => {
    const errorA = vi.fn(); const capacityA = vi.fn(); const errorB = vi.fn(); const capacityB = vi.fn();
    const a = makeContext('2873', { feedback: { error: errorA, showCapacityLimit: capacityA } });
    const b = makeContext('2874', { feedback: { error: errorB, showCapacityLimit: capacityB } });
    api.update.mockRejectedValueOnce(Object.assign(new Error('A save rejected'), { raw: { msg: 'A save rejected' }, requestPhase: 'rejected' }));
    await expect(a.state().actions.partialUpdate('2873', {})).rejects.toThrow('A save rejected');
    expect(errorA).toHaveBeenCalledWith('A save rejected'); expect(errorB).not.toHaveBeenCalled();
    api.capacity.mockResolvedValue({ code: 'SUCCESS', data: { usedCapacity: 100, limitCapacity: 100 } });
    await expect(a.state().actions.excuteSingle('n1')).resolves.toMatchObject({ type: 'capacity_limit' });
    expect(capacityA).toHaveBeenCalledTimes(1); expect(capacityB).not.toHaveBeenCalled();
    await expect(makeContext('2875').state().actions.excuteSingle('n1')).resolves.toMatchObject({ type: 'capacity_limit' });
    expect(api.invoke).not.toHaveBeenCalled();
    expect(b.state().agentPersistenceIssue).toBeNull();
  });
  it('each omitted barrier and guard option also creates an independent instance', async () => {
    const a = createFlowStoreApi(); const b = createFlowStoreApi(); const gate = deferred<unknown>();
    for (const [store, canvasId] of [[a, '2873'], [b, '2874']] as const) store.setState({ canvasId, versionNumber: '18', nodes: [makeNode()] });
    api.update.mockReturnValueOnce(gate.promise);
    const first = a.getState().actions.partialUpdate('2873', {}, options);
    try {
      await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
      await b.getState().actions.partialUpdate('2874', {}, options);
      expect(api.update).toHaveBeenCalledTimes(2);
    } finally { gate.resolve(saved()); await first; }
  });
});
