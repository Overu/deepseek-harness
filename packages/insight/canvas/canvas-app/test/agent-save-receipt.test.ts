import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
const api = vi.hoisted(() => ({ update: vi.fn(), save: vi.fn(), invoke: vi.fn(), capacity: vi.fn(), cost: vi.fn() }));
vi.mock('@/api/workflow', () => ({ updateCanvas: api.update, saveFlow: api.save, excuteWorkFlow: api.invoke }));
vi.mock('@/api/order', () => ({ calculateWorkflowCost: api.cost }));
vi.mock('@/api/asset', () => ({ getAvailableCapacity: api.capacity }));
vi.mock('@/components/common/storageLimitManager', () => ({ openStorageLimitDialog: vi.fn() }));
vi.mock('@/components/canvasFlow/utils/mediaDimensionLoader', () => ({ loadIntrinsicMediaDimensions: vi.fn().mockResolvedValue(null) }));
vi.mock('@/utils', () => ({ isSvgImageUrl: () => false, compressImage: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
import { isAgentOperationBusy, markAgentEditorBusy } from '../src/agent-edit-guard';
import { useFlowStore } from '../legacy/src/store/flowStore';
import { createFlowMediaDimensionCoordinator } from '../legacy/src/store/flowMediaDimensionCoordinator';
import { runCanvasVersionPolling } from '../legacy/src/lib/canvasVersionBarrier';

const options = { strictReceipt: true as const, expectedVersion: '18' };
const makeNode = (id: string): Node => ({ id, type: 'text', position: { x: 0, y: 0 }, data: { title: id, value: '原文', params: { prompt: '旧提示', model: 'fixture' }, product: [{ value: 'old' }], taskInfo: { status: 'success' } } });
const rejected = () => Object.assign(new Error('明确拒绝'), { requestPhase: 'rejected', code: 4001 });
const unknown = () => Object.assign(new Error('回执丢失'), { requestPhase: 'sent_unknown' });
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const state = () => useFlowStore.getState();

beforeEach(async () => {
  if (state().actions.awaitMutationsIdle) await state().actions.awaitMutationsIdle();
  vi.clearAllMocks(); state().actions.reset();
  useFlowStore.setState({ canvasId: '2873', versionNumber: '18', modelsMap: { text: [{ value: 'fixture', params: [] }] }, nodes: [makeNode('n1'), makeNode('n2')] });
  api.update.mockResolvedValue({ code: 'SUCCESS', data: { versionNumber: '19' } });
  api.save.mockResolvedValue({ code: 'SUCCESS', data: { versionNumber: '19' } });
  api.invoke.mockResolvedValue({ code: 'SUCCESS', data: { versionNumber: '19', taskId: 'task1' } });
  api.cost.mockResolvedValue({ code: 'SUCCESS', data: 1 });
  api.capacity.mockResolvedValue({ code: 'SUCCESS', data: { usedCapacity: 0, limitCapacity: 100 } });
});

describe('existing media persistence queue', () => {
  it('returns strict rejection but does not poison the next same-node operation', async () => {
    const coordinator = createFlowMediaDimensionCoordinator({ getState: state, setNodes: () => undefined, partialUpdate: vi.fn() });
    await expect(coordinator.queuePersistence(['n1'], async () => { throw rejected(); }, { strictReceipt: true })).rejects.toThrow('明确拒绝');
    const persist = vi.fn().mockResolvedValue(undefined);
    await coordinator.queuePersistence(['n1'], persist, { strictReceipt: true });
    expect(persist).toHaveBeenCalledTimes(1);
    await expect(coordinator.queuePersistence(['n1'], async () => { throw rejected(); })).resolves.toBeUndefined();
  });
  it('idle barrier includes a media tail which has not entered the mutation queue', async () => {
    const coordinator = createFlowMediaDimensionCoordinator({ getState: state, setNodes: () => undefined, partialUpdate: vi.fn() });
    const gate = deferred<void>();
    const first = coordinator.queuePersistence(['n1'], () => gate.promise);
    const persist = vi.fn().mockResolvedValue(undefined);
    const second = coordinator.queuePersistence(['n1'], persist);
    let idle = false;
    try {
      const wait = coordinator.waitPersistenceIdle().then(() => { idle = true; });
      await Promise.resolve(); expect(idle).toBe(false); expect(persist).not.toHaveBeenCalled();
      gate.resolve(); await first; await second; await wait; expect(idle).toBe(true);
    } finally { gate.resolve(); }
  });
});

describe('strict Store saves', () => {
  it('waits for one real save, merges partial data and strips taskInfo / unchanged media outputs', async () => {
    const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    let settled = false;
    try {
      const save = state().actions.updateNodeData('n1', { params: { prompt: '新提示', model: 'fixture' } }, true, true, options);
      expect(save).toBeInstanceOf(Promise);
      const done = save.then(() => { settled = true; });
      await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1)); expect(settled).toBe(false);
      const payload = JSON.parse(api.update.mock.calls[0][0].updateNodes[0]);
      expect(payload.data.params.prompt).toBe('新提示'); expect(payload.data).not.toHaveProperty('taskInfo');
      expect(payload.data).not.toHaveProperty('value'); expect(payload.data).not.toHaveProperty('product');
      expect(state().nodes[0].data.value).toBe('原文'); expect(state().nodes[0].data.product).toEqual([{ value: 'old' }]);
      expect(api.update.mock.calls[0][1]).toMatchObject({ receiptMode: 'agent' });
      gate.resolve({ code: 'SUCCESS', data: { versionNumber: '19' } }); await done;
      expect(state().versionNumber).toBe('19'); expect(state().agentPersistenceIssue).toBeNull();
    } finally { gate.resolve({ code: 'SUCCESS', data: { versionNumber: '19' } }); }
  });
  it('checks version after queued UI mutation and restores only the rejected command', async () => {
    const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    try {
      const ui = state().actions.partialUpdate('2873', { updateNodes: [{ id: 'n2', data: { title: 'UI 修改' } }] });
      const strict = state().actions.updateNodeData('n1', { params: { prompt: '不能覆盖', model: 'fixture' } }, true, true, options);
      const outcome = expect(strict).rejects.toMatchObject({ code: 'VERSION_CONFLICT', requestPhase: 'not_sent' });
      gate.resolve({ code: 'SUCCESS', data: { versionNumber: '19' } }); await ui; await outcome;
      expect(api.update).toHaveBeenCalledTimes(1); expect(state().nodes[0].data.params).toMatchObject({ prompt: '旧提示' });
      expect(state().agentPersistenceIssue).toBeNull();
    } finally { gate.resolve({ code: 'SUCCESS', data: { versionNumber: '19' } }); }
  });
  it('checks expectedVersion after an active native polling response', async () => {
    const gate = deferred<void>();
    const poll = runCanvasVersionPolling(() => gate.promise, () => { state().actions.setVersionNumber('19'); return true; });
    await Promise.resolve();
    try {
      const save = state().actions.partialUpdate('2873', {}, options);
      const outcome = expect(save).rejects.toMatchObject({ code: 'VERSION_CONFLICT', requestPhase: 'not_sent' });
      gate.resolve(); await poll; await outcome; expect(api.update).not.toHaveBeenCalled();
    } finally { gate.resolve(); }
  });
  it('definite refusal restores touched params but preserves concurrent products and other nodes', async () => {
    const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    const save = state().actions.updateNodeData('n1', { params: { prompt: '会失败', model: 'fixture' } }, true, true, options);
    const outcome = expect(save).rejects.toMatchObject({ requestPhase: 'rejected' });
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    useFlowStore.setState({ nodes: state().nodes.map(node => ({ ...node, data: { ...node.data, ...(node.id === 'n1' ? { product: [{ value: 'new' }] } : { value: '别的节点产物' }) } })) });
    gate.reject(rejected()); await outcome;
    expect(state().nodes[0].data.params).toMatchObject({ prompt: '旧提示' });
    expect(state().nodes[0].data.product).toEqual([{ value: 'new' }]); expect(state().nodes[1].data.value).toBe('别的节点产物');
    expect(state().agentPersistenceIssue).toBeNull();
    await state().actions.updateNodeData('n1', { title: '可重试' }, true, true, options);
    expect(api.update).toHaveBeenCalledTimes(2);
  });
  it('does not overwrite newer values when a refused field changed again', async () => {
    const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    const save = state().actions.updateNodeData('n1', { title: '会失败' }, true, true, options);
    const outcome = expect(save).rejects.toThrow('明确拒绝');
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    useFlowStore.setState({ nodes: state().nodes.map(node => node.id === 'n1' ? { ...node, data: { ...node.data, title: '较新修改' } } : node) });
    gate.reject(rejected()); await outcome;
    expect(state().nodes[0].data.title).toBe('较新修改'); expect(state().agentPersistenceIssue).not.toBeNull();
  });
  it.each(['network', 'missing-version'])('retains uncertain optimistic state and blocks subsequent strict operations: %s', async kind => {
    if (kind === 'network') api.update.mockRejectedValueOnce(unknown());
    else api.update.mockResolvedValueOnce({ code: 'SUCCESS', data: {} });
    await expect(state().actions.updateNodeData('n1', { title: '未确认' }, true, true, options)).rejects.toMatchObject({ requestPhase: 'sent_unknown' });
    expect(state().nodes[0].data.title).toBe('未确认'); expect(state().agentPersistenceIssue?.code).toBe('SUBMISSION_UNKNOWN');
    await expect(state().actions.partialUpdate('2873', {}, options)).rejects.toMatchObject({ requestPhase: 'not_sent' });
    expect(api.update).toHaveBeenCalledTimes(1);
    await state().actions.partialUpdate('2873', {}); expect(state().agentPersistenceIssue).not.toBeNull();
    state().actions.init({ data: JSON.stringify({ nodes: [makeNode('n1')], edges: [] }), taskStatus: '', versionNumber: '20' });
    expect(state().agentPersistenceIssue).toBeNull();
  });
  it.each(['agent', 'ui'])('%s additions keep the appropriate selection state', async source => {
    useFlowStore.setState({ nodes: [{ ...makeNode('n1'), selected: true }, { ...makeNode('n2'), selected: false }] });
    await state().actions.addNode([{ ...makeNode('new1'), selected: true }, makeNode('new2')], source === 'agent' ? options : undefined);
    expect(state().nodes.map(node => [node.id, node.selected])).toEqual(source === 'agent'
      ? [['n1', true], ['n2', false], ['new1', false], ['new2', false]]
      : [['n1', false], ['n2', false], ['new1', true], ['new2', true]]);
  });
  it('strict add failure is observable; unknown additions are retained; UI still rolls back and resolves', async () => {
    api.update.mockRejectedValueOnce(rejected());
    await expect(state().actions.addNode([makeNode('new')], options)).rejects.toThrow('明确拒绝');
    expect(state().nodes.some(node => node.id === 'new')).toBe(false);
    api.update.mockRejectedValueOnce(unknown());
    await expect(state().actions.addNode([makeNode('uncertain')], options)).rejects.toMatchObject({ requestPhase: 'sent_unknown' });
    expect(state().nodes.some(node => node.id === 'uncertain')).toBe(true);
    api.update.mockRejectedValueOnce(rejected());
    await expect(state().actions.addNode([makeNode('ui')])).resolves.toBeUndefined();
    expect(state().nodes.some(node => node.id === 'ui')).toBe(false);
  });
  it('strict deletion preserves native empty-parent/edge cleanup and restores it on refusal', async () => {
    const group: Node = { id: 'group', type: 'group', position: { x: 0, y: 0 }, data: {} };
    const child = { ...makeNode('n1'), parentId: 'group' }; const other = makeNode('n2');
    useFlowStore.setState({ nodes: [group, child, other], edges: [{ id: 'edge', source: 'n1', target: 'n2' }] });
    api.update.mockRejectedValueOnce(rejected());
    await expect(state().actions.deleteNodes(['n1'], options)).rejects.toThrow('明确拒绝');
    expect(new Set(state().nodes.map(node => node.id))).toEqual(new Set(['group', 'n1', 'n2'])); expect(state().edges).toHaveLength(1);
    await state().actions.deleteNodes(['n1'], options);
    expect(api.update.mock.calls[1][0].deleteNodeIds).toEqual(['n1', 'group']); expect(state().nodes.map(node => node.id)).toEqual(['n2']);
  });
  it('rejects read-only / missing version before changing graph; keeps large string versions exact', async () => {
    state().actions.setReadOnly(true);
    await expect(state().actions.updateNodeData('n1', { title: '不能写' }, true, true, options)).rejects.toMatchObject({ code: 'READ_ONLY' });
    expect(state().nodes[0].data.title).toBe('n1'); expect(api.update).not.toHaveBeenCalled();
    state().actions.setReadOnly(false); state().actions.setVersionNumber(undefined);
    await expect(state().actions.partialUpdate('2873', {}, options)).rejects.toMatchObject({ code: 'VERSION_UNAVAILABLE' });
    useFlowStore.setState({ versionNumber: '9007199254740992' }); api.update.mockResolvedValueOnce({ code: 'SUCCESS', data: { versionNumber: '9007199254740993' } });
    await state().actions.partialUpdate('2873', {}, { ...options, expectedVersion: '9007199254740992' });
    expect(api.update.mock.calls[0][0].versionNumber).toBe('9007199254740992'); expect(state().versionNumber).toBe('9007199254740993');
  });
  it('UI update/delete retain void returns; failed UI save marks consistency without blocking UI', async () => {
    api.update.mockRejectedValueOnce(rejected());
    expect(state().actions.updateNodeData('n1', { ...state().nodes[0].data, title: 'UI 标题' })).toBeUndefined();
    await state().actions.awaitMutationsIdle(); expect(state().nodes[0].data.title).toBe('UI 标题'); expect(state().agentPersistenceIssue).not.toBeNull();
    expect(state().actions.deleteNodes(['n2'])).toBeUndefined(); await state().actions.awaitMutationsIdle();
    expect(state().nodes.map(node => node.id)).toEqual(['n1']);
  });
  it('strict invoke exposes transport failure; native UI keeps its info result', async () => {
    api.invoke.mockRejectedValueOnce(unknown());
    await expect(state().actions.excuteSingle('n1', { ...options, strictTransportErrors: true, approvedGeneration: { images: 0, videos: 0 } })).rejects.toMatchObject({ requestPhase: 'sent_unknown' });
    api.invoke.mockRejectedValueOnce({ msg: '旧 UI 提示' });
    await expect(state().actions.excuteSingle('n1')).resolves.toMatchObject({ type: 'info', content: '旧 UI 提示' });
  });
  it('a failed capacity preflight is not_sent and does not invoke a workflow', async () => {
    api.capacity.mockRejectedValueOnce(new Error('容量查询失败'));
    await expect(state().actions.excuteSingle('n1', { ...options, strictTransportErrors: true, approvedGeneration: { images: 0, videos: 0 } })).rejects.toMatchObject({ requestPhase: 'not_sent' });
    expect(api.invoke).not.toHaveBeenCalled(); expect(state().agentPersistenceIssue).toBeNull();
  });
  it('unknown deletion keeps its optimistic cleanup without resubmitting', async () => {
    api.update.mockRejectedValueOnce(unknown());
    await expect(state().actions.deleteNodes(['n1'], options)).rejects.toMatchObject({ requestPhase: 'sent_unknown' });
    expect(state().nodes.map(node => node.id)).toEqual(['n2']); expect(api.update).toHaveBeenCalledTimes(1);
    expect(state().agentPersistenceIssue?.code).toBe('SUBMISSION_UNKNOWN');
    state().actions.init({ data: 'null', taskStatus: '', versionNumber: '19' });
    expect(state().agentPersistenceIssue?.code).toBe('SUBMISSION_UNKNOWN');
  });
  it('a canvas switch after dispatch cannot roll back or mark the replacement canvas', async () => {
    const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    const save = state().actions.updateNodeData('n1', { title: '旧画布修改' }, true, true, options);
    const outcome = expect(save).rejects.toMatchObject({ requestPhase: 'rejected' });
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    state().actions.reset(); useFlowStore.setState({ canvasId: '2874', versionNumber: '8', nodes: [{ ...makeNode('n1'), data: { title: '新画布' } }] });
    gate.reject(rejected()); await outcome;
    expect(state().nodes[0].data.title).toBe('新画布'); expect(state().agentPersistenceIssue).toBeNull(); expect(state().undoStack).toHaveLength(0);
  });
  it('local serialization errors are not_sent; the idle barrier waits strict media persistence', async () => {
    const cyclic: Record<string, unknown> = { id: 'n1' }; cyclic.self = cyclic;
    await expect(state().actions.partialUpdate('2873', { updateNodes: [cyclic] }, options)).rejects.toMatchObject({ requestPhase: 'not_sent' });
    expect(api.update).not.toHaveBeenCalled(); expect(state().agentPersistenceIssue).toBeNull();
    const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    const save = state().actions.updateNodeData('n1', { title: '排队保存' }, true, true, options);
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    let idle = false;
    const wait = state().actions.awaitMutationsIdle().then(() => { idle = true; });
    await Promise.resolve(); expect(idle).toBe(false);
    gate.resolve({ code: 'SUCCESS', data: { versionNumber: '19' } }); await save; await wait; expect(idle).toBe(true);
  });
  it('checks read-only inside the queue and preserves native backend 5011 conflict handling', async () => {
    const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    const ui = state().actions.partialUpdate('2873', {});
    const save = state().actions.updateNodeData('n1', { title: '不能写' }, true, true, options);
    const outcome = expect(save).rejects.toMatchObject({ code: 'READ_ONLY', requestPhase: 'not_sent' });
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1)); state().actions.setReadOnly(true);
    gate.resolve({ code: 'SUCCESS', data: { versionNumber: '18' } }); await ui; await outcome;
    expect(api.update).toHaveBeenCalledTimes(1); expect(state().nodes[0].data.title).toBe('n1');
    state().actions.setReadOnly(false); api.update.mockRejectedValueOnce(Object.assign(rejected(), { code: 5011 }));
    await expect(state().actions.partialUpdate('2873', {}, options)).rejects.toMatchObject({ code: 5011 });
    expect(state().versionConflict).toBe(true);
  });
});


describe('strict Store editor protection', () => {
  it('rejects add/edit/delete/run while a native draft is pending, with no optimistic change or request', async () => {
    markAgentEditorBusy('n1:prompt', true);
    try {
      const actions = state().actions;
      for (const operation of [
        () => actions.addNode([makeNode('n3')], options),
        () => actions.updateNodeData('n1', { title: 'Agent' }, true, true, options),
        () => actions.deleteNodes(['n1'], options),
        () => actions.partialUpdate('2873', {}, options),
        () => actions.excuteSingle('n1', { ...options, strictTransportErrors: true, approvedGeneration: { images: 0, videos: 0 } }),
      ]) await expect(operation()).rejects.toMatchObject({ code: 'EDITOR_BUSY', requestPhase: 'not_sent' });
      expect(state().nodes.map(node => node.data.title)).toEqual(['n1', 'n2']);
      expect(api.update).not.toHaveBeenCalled(); expect(api.invoke).not.toHaveBeenCalled(); expect(api.capacity).not.toHaveBeenCalled();
      // The same native UI call still returns void and saves normally; guard is not Store readOnly.
      expect(actions.updateNodeData('n1', { ...state().nodes[0].data, title: 'UI' })).toBeUndefined();
      await actions.awaitMutationsIdle(); expect(api.update).toHaveBeenCalledTimes(1); expect(state().readOnly).toBe(false);
    } finally { markAgentEditorBusy('n1:prompt', false); }
  });
  it('keeps original fields until the pending UI save settles and rejects stale expectedVersion', async () => {
    const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    const ui = state().actions.partialUpdate('2873', {});
    const strict = state().actions.updateNodeData('n1', { title: 'Agent' }, true, true, options);
    const outcome = expect(strict).rejects.toMatchObject({ code: 'VERSION_CONFLICT', requestPhase: 'not_sent' });
    try {
      await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
      expect(isAgentOperationBusy()).toBe(true); expect(state().nodes[0].data.title).toBe('n1'); expect(state().readOnly).toBe(false);
      gate.resolve({ code: 'SUCCESS', data: { versionNumber: '19' } }); await ui; await outcome;
      expect(api.update).toHaveBeenCalledTimes(1); expect(isAgentOperationBusy()).toBe(false);
    } finally { gate.resolve({ code: 'SUCCESS', data: { versionNumber: '19' } }); }
  });
  it('rejects competing edits until receipt, allows system product updates and unlocks while media is running', async () => {
    const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    const save = state().actions.updateNodeData('n1', { title: 'Agent' }, true, true, options);
    try {
      await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
      await expect(state().actions.deleteNodes(['n2'], options)).rejects.toMatchObject({ code: 'EDITOR_BUSY' });
      useFlowStore.setState({ nodes: state().nodes.map(node => node.id === 'n2' ? { ...node, data: { ...node.data, product: [{ value: '系统产物' }], taskInfo: { status: 'running' } } } : node) });
      expect(state().nodes[1].data.product).toEqual([{ value: '系统产物' }]);
      gate.resolve({ code: 'SUCCESS', data: { versionNumber: '19' } }); await save;
      expect(isAgentOperationBusy()).toBe(false); expect(state().nodes[1].data.taskInfo).toMatchObject({ status: 'running' });
      await expect(state().actions.updateNodeData('n2', { title: '不可覆盖' }, true, true, { ...options, expectedVersion: '19' })).rejects.toMatchObject({ code: 'NODE_BUSY', requestPhase: 'not_sent' });
      await expect(state().actions.deleteNodes(['n2'], { ...options, expectedVersion: '19' })).rejects.toMatchObject({ code: 'NODE_BUSY' });
      await expect(state().actions.excuteSingle('n2', { ...options, expectedVersion: '19', strictTransportErrors: true, approvedGeneration: { images: 0, videos: 0 } })).rejects.toMatchObject({ code: 'NODE_BUSY' });
      expect(api.capacity).not.toHaveBeenCalled(); expect(api.update).toHaveBeenCalledTimes(1);
    } finally { gate.resolve({ code: 'SUCCESS', data: { versionNumber: '19' } }); }
  });
  it('rejects a target canvas switch while waiting for UI persistence', async () => {
    const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    const ui = state().actions.partialUpdate('2873', {});
    const save = state().actions.updateNodeData('n1', { title: '旧指令' }, true, true, options);
    const outcome = expect(save).rejects.toMatchObject({ code: 'READ_ONLY', requestPhase: 'not_sent' });
    try {
      await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1)); useFlowStore.setState({ canvasId: '999', nodes: [makeNode('n1')], versionNumber: '18' });
      gate.resolve({ code: 'SUCCESS', data: { versionNumber: '19' } }); await ui; await outcome;
      expect(state().nodes[0].data.title).toBe('n1'); expect(api.update).toHaveBeenCalledTimes(1); expect(isAgentOperationBusy()).toBe(false);
    } finally { gate.resolve({ code: 'SUCCESS', data: { versionNumber: '19' } }); }
  });
});

it('strict invoke unlocks after acceptance while native loading / result updates continue', async () => {
  const gate = deferred<unknown>(); api.invoke.mockReturnValueOnce(gate.promise);
  const run = state().actions.excuteSingle('n1', { ...options, strictTransportErrors: true, approvedGeneration: { images: 0, videos: 0 } });
  try {
    await vi.waitFor(() => expect(api.invoke).toHaveBeenCalledTimes(1)); expect(isAgentOperationBusy()).toBe(true);
    state().actions.updateNodeStatus('n1', 'running');
    gate.resolve({ code: 'SUCCESS', data: { taskId: 'task1', versionNumber: '19' } });
    await expect(run).resolves.toMatchObject({ type: 'success', taskId: 'task1' });
    expect(isAgentOperationBusy()).toBe(false); expect(state().status).toBe('RUNNING');
    expect(state().nodes[0].data.taskInfo).toMatchObject({ status: 'running' });
    state().actions.updateNodeStatus('n1', 'success'); expect(state().nodes[0].data.taskInfo).toMatchObject({ status: 'success' });
  } finally { gate.resolve({ code: 'SUCCESS', data: { taskId: 'task1', versionNumber: '19' } }); }
});
