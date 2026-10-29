import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { EdgeEditOperation } from '../../src/shared/canvas-agent-protocol';
const api = vi.hoisted(() => ({ update: vi.fn(), save: vi.fn(), invoke: vi.fn(), capacity: vi.fn() }));
vi.mock('@/api/workflow', () => ({ updateCanvas: api.update, saveFlow: api.save, excuteWorkFlow: api.invoke }));
vi.mock('@/api/asset', () => ({ getAvailableCapacity: api.capacity }));
vi.mock('@/components/common/storageLimitManager', () => ({ openStorageLimitDialog: vi.fn() }));
vi.mock('@/components/canvasFlow/utils/mediaDimensionLoader', () => ({ loadIntrinsicMediaDimensions: vi.fn().mockResolvedValue(null) }));
vi.mock('@/utils', () => ({ isSvgImageUrl: () => false, compressImage: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
import { createFlowStoreApi } from '../legacy/src/store/flowStoreCore';
import { createAgentEditGuard } from '../src/agent-edit-guard';

const node = (id: string): Node => ({ id, type: 'image', position: { x: 0, y: 0 }, data: { title: id, params: {}, taskInfo: { status: 'success' } } });
const edge = (id: string, source: string, target: string): Edge => ({ id, source, target, sourceHandle: 'image_source', targetHandle: 'image_target', className: 'image_source' });
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const refused = () => Object.assign(new Error('明确拒绝'), { requestPhase: 'rejected' });
const unknown = () => Object.assign(new Error('回执未知'), { requestPhase: 'sent_unknown' });
let guard: ReturnType<typeof createAgentEditGuard>;
let store: ReturnType<typeof createFlowStoreApi>;
const state = () => store.getState();
const add = (sourceNodeId = 'a', targetNodeId = 'target', expectedVersion = '18'): EdgeEditOperation => ({ action: 'edge.add', expectedVersion, connection: { sourceNodeId, targetNodeId } });
const edit = (operation: EdgeEditOperation) => state().actions.editAgentEdges(operation, { strictReceipt: true, expectedVersion: operation.expectedVersion });
const incoming = () => [edge('first', 'a', 'target'), edge('outside', 'c', 'other'), edge('second', 'b', 'target')];

beforeEach(() => {
  vi.clearAllMocks(); guard = createAgentEditGuard(); store = createFlowStoreApi({ guard });
  store.setState({ canvasId: '2873', versionNumber: '18', nodes: ['a', 'b', 'c', 'target', 'other'].map(node) });
  api.update.mockResolvedValue({ code: 'SUCCESS', data: { versionNumber: '19' } });
});
afterEach(async () => { await state().actions.awaitMutationsIdle(); guard.dispose(); });

describe('native strict Agent edge writes', () => {
  it('waits for one real receipt and returns the real edge ID, affected endpoints and exact version', async () => {
    const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    let settled = false; const pending = edit(add()).then(result => { settled = true; return result; });
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1)); expect(settled).toBe(false);
    const id = state().edges[0].id;
    expect(api.update.mock.calls[0][0]).toMatchObject({ id: '2873', edges: [edge(id, 'a', 'target')], versionNumber: '18' });
    expect(api.update.mock.calls[0][1]).toMatchObject({ receiptMode: 'agent' });
    gate.resolve({ code: 'SUCCESS', data: { versionNumber: '90071992547409931' } });
    expect(await pending).toMatchObject({ version: '90071992547409931', affectedNodeIds: ['a', 'target'], affectedEdgeIds: [id] });
    expect(state().versionNumber).toBe('90071992547409931'); expect(api.invoke).not.toHaveBeenCalled();
  });
  it('reconnects and deletes using the same native save queue with stable edge ID', async () => {
    const added = await edit(add()); const id = added.affectedEdgeIds![0];
    api.update.mockResolvedValueOnce({ code: 'SUCCESS', data: { versionNumber: '20' } });
    expect(await edit({ action: 'edge.reconnect', expectedVersion: '19', edgeId: id, connection: { sourceNodeId: 'b', targetNodeId: 'other' } })).toMatchObject({ affectedEdgeIds: [id], version: '20' });
    expect(state().edges).toEqual([edge(id, 'b', 'other')]);
    api.update.mockResolvedValueOnce({ code: 'SUCCESS', data: { versionNumber: '21' } });
    expect(await edit({ action: 'edge.delete', expectedVersion: '20', edgeIds: [id] })).toMatchObject({ affectedEdgeIds: [id], version: '21' });
    expect(state().edges).toEqual([]); expect(api.update).toHaveBeenCalledTimes(3);
  });
  it('rolls back only the refused addition while retaining later unrelated edge and node changes', async () => {
    const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    const result = expect(edit(add())).rejects.toMatchObject({ requestPhase: 'rejected' });
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    store.setState({ edges: [...state().edges, edge('later', 'c', 'other')], nodes: state().nodes.map(item => item.id === 'a' ? { ...item, data: { ...item.data, product: [{ value: 'new' }] } } : item) });
    gate.reject(refused()); await result;
    expect(state().edges).toEqual([edge('later', 'c', 'other')]); expect(state().nodes[0].data.product).toEqual([{ value: 'new' }]); expect(state().agentPersistenceIssue).toBeNull();
  });
  it('restores only reconnect fields and preserves concurrent native edge animation or styling', async () => {
    store.setState({ edges: [edge('same', 'a', 'target')] });
    const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    const result = expect(edit({ action: 'edge.reconnect', expectedVersion: '18', edgeId: 'same', connection: { sourceNodeId: 'b', targetNodeId: 'other' } })).rejects.toThrow('明确拒绝');
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    store.setState({ edges: state().edges.map(item => ({ ...item, type: 'animated', style: { opacity: 0.5 } })) });
    gate.reject(refused()); await result;
    expect(state().edges[0]).toMatchObject({ ...edge('same', 'a', 'target'), type: 'animated', style: { opacity: 0.5 } }); expect(state().agentPersistenceIssue).toBeNull();
  });
  it('does not override a newer reconnect after definite refusal', async () => {
    store.setState({ edges: [edge('same', 'a', 'target')] });
    const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    const result = expect(edit({ action: 'edge.reconnect', expectedVersion: '18', edgeId: 'same', connection: { sourceNodeId: 'b', targetNodeId: 'other' } })).rejects.toThrow();
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    store.setState({ edges: [edge('same', 'c', 'other')] }); gate.reject(refused()); await result;
    expect(state().edges[0].source).toBe('c'); expect(state().agentPersistenceIssue).not.toBeNull();
  });
  it.each(['a', 'target'])('does not restore a refused reconnect to an asynchronously removed old endpoint: %s', async removedId => {
    store.setState({ edges: [edge('same', 'a', 'target')] });
    const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    const result = expect(edit({ action: 'edge.reconnect', expectedVersion: '18', edgeId: 'same', connection: { sourceNodeId: 'b', targetNodeId: 'other' } })).rejects.toThrow('明确拒绝');
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    store.setState({ nodes: state().nodes.filter(item => item.id !== removedId), edges: [
      { ...state().edges[0], type: 'animated', style: { opacity: 0.5 } }, edge('later', 'c', 'other'),
    ] });
    gate.reject(refused()); await result;
    expect(state().edges).toEqual([{ ...edge('same', 'b', 'other'), type: 'animated', style: { opacity: 0.5 } }, edge('later', 'c', 'other')]);
    expect(state().agentPersistenceIssue?.code).toBe('SAVE_REJECTED');
    await expect(edit(add('c', 'b'))).rejects.toMatchObject({ code: 'SAVE_REJECTED' }); expect(api.update).toHaveBeenCalledTimes(1);
  });
  it('drops only the refused reconnect when neither old nor current endpoints still exist', async () => {
    store.setState({ edges: [edge('same', 'a', 'target')] });
    const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    const result = expect(edit({ action: 'edge.reconnect', expectedVersion: '18', edgeId: 'same', connection: { sourceNodeId: 'b', targetNodeId: 'other' } })).rejects.toThrow();
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    store.setState({ nodes: state().nodes.filter(item => !['a', 'b'].includes(item.id)), edges: [...state().edges, edge('later', 'c', 'other')] });
    gate.reject(refused()); await result;
    expect(state().edges).toEqual([edge('later', 'c', 'other')]); expect(state().agentPersistenceIssue?.code).toBe('SAVE_REJECTED');
  });
  it('restores deleted edges in native slots without discarding later additions', async () => {
    store.setState({ edges: incoming() }); const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    const result = expect(edit({ action: 'edge.delete', expectedVersion: '18', edgeIds: ['first'] })).rejects.toThrow();
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    store.setState({ edges: [...state().edges, edge('later', 'b', 'other')] }); gate.reject(refused()); await result;
    expect(state().edges.map(item => item.id)).toEqual(['first', 'outside', 'second', 'later']); expect(state().agentPersistenceIssue).toBeNull();
  });
  it('restores refused target input ordering while retaining outside slots and later edge metadata', async () => {
    store.setState({ edges: incoming() }); const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    const result = expect(edit({ action: 'edge.reorder', expectedVersion: '18', targetNodeId: 'target', edgeIds: ['second', 'first'] })).rejects.toThrow();
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1)); expect(state().edges.map(item => item.id)).toEqual(['second', 'outside', 'first']);
    store.setState({ edges: state().edges.map(item => ({ ...item, selected: true })) }); gate.reject(refused()); await result;
    expect(state().edges.map(item => item.id)).toEqual(['first', 'outside', 'second']); expect(state().edges.every(item => item.selected)).toBe(true);
  });
  it('preserves a newer target ordering and fences after a refusal conflict', async () => {
    store.setState({ edges: incoming() }); const gate = deferred<unknown>(); api.update.mockReturnValueOnce(gate.promise);
    const result = expect(edit({ action: 'edge.reorder', expectedVersion: '18', targetNodeId: 'target', edgeIds: ['second', 'first'] })).rejects.toThrow();
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    store.setState({ edges: [...incoming(), edge('third', 'c', 'target')] }); gate.reject(refused()); await result;
    // A changed target membership cannot silently be overwritten by an old ordering.
    expect(state().edges.map(item => item.id)).toEqual(['first', 'outside', 'second', 'third']);
    expect(state().agentPersistenceIssue).not.toBeNull();
  });
  it('retains an unknown addition and its actual ID, and refuses a later retry until authoritative reload', async () => {
    api.update.mockRejectedValueOnce(unknown()); let error: any;
    try { await edit(add()); } catch (value) { error = value; }
    expect(error).toMatchObject({ requestPhase: 'sent_unknown', affectedNodeIds: ['a', 'target'], affectedEdgeIds: [state().edges[0].id] });
    expect(state().agentPersistenceIssue?.code).toBe('SUBMISSION_UNKNOWN');
    await expect(edit(add())).rejects.toMatchObject({ code: 'SUBMISSION_UNKNOWN' }); expect(api.update).toHaveBeenCalledTimes(1);
  });
  it('preserves stable reconnect IDs and new endpoints when success lacks a trusted version', async () => {
    store.setState({ edges: [edge('same', 'a', 'target')] }); api.update.mockResolvedValueOnce({ code: 'SUCCESS', data: {} });
    await expect(edit({ action: 'edge.reconnect', expectedVersion: '18', edgeId: 'same', connection: { sourceNodeId: 'b', targetNodeId: 'other' } })).rejects.toMatchObject({ requestPhase: 'sent_unknown', affectedEdgeIds: ['same'] });
    expect(state().edges[0]).toMatchObject({ id: 'same', source: 'b', target: 'other' });
  });
  it.each(['a', 'target'])('rejects a running affected endpoint before changing state: %s', async id => {
    store.setState({ nodes: state().nodes.map(item => item.id === id ? { ...item, data: { ...item.data, taskInfo: { status: 'running' } } } : item) });
    await expect(edit(add())).rejects.toMatchObject({ code: 'NODE_BUSY' }); expect(state().edges).toEqual([]); expect(api.update).not.toHaveBeenCalled();
  });
  it('checks affected endpoints again inside the HTTP queue without blocking an unrelated running node', async () => {
    let changed = false; const stop = store.subscribe(value => { if (value.edges.length && !changed) { changed = true; store.setState({ nodes: value.nodes.map(item => item.id === 'target' ? { ...item, data: { ...item.data, taskInfo: { status: 'running' } } } : item) }); } });
    await expect(edit(add())).rejects.toMatchObject({ code: 'NODE_BUSY', requestPhase: 'not_sent' }); stop(); expect(api.update).not.toHaveBeenCalled(); expect(state().edges).toEqual([]);
    store.setState({ nodes: state().nodes.map(item => ({ ...item, data: { ...item.data, taskInfo: { status: item.id === 'other' ? 'running' : 'success' } } })) });
    await expect(edit(add())).resolves.toMatchObject({ version: '19' }); expect(api.update).toHaveBeenCalledTimes(1);
  });
  it('rechecks version inside the queue and rolls back the unsubmitted edge', async () => {
    const stop = store.subscribe(value => { if (value.edges.length && value.versionNumber === '18') store.setState({ versionNumber: '20' }); });
    await expect(edit(add())).rejects.toMatchObject({ code: 'VERSION_CONFLICT', requestPhase: 'not_sent' }); stop(); expect(api.update).not.toHaveBeenCalled(); expect(state().edges).toEqual([]); expect(state().versionNumber).toBe('20');
  });
  it('guards unchanged reconnects and reorders, saving nothing and respecting drafts or node busy state', async () => {
    store.setState({ edges: incoming() });
    expect(await edit({ action: 'edge.reorder', expectedVersion: '18', targetNodeId: 'target', edgeIds: ['first', 'second'] })).toMatchObject({ unchanged: true, version: '18' });
    expect(await edit({ action: 'edge.reconnect', expectedVersion: '18', edgeId: 'first', connection: { sourceNodeId: 'a', targetNodeId: 'target' } })).toMatchObject({ unchanged: true, affectedEdgeIds: ['first'] });
    expect(api.update).not.toHaveBeenCalled(); guard.markEditorBusy('draft', true);
    await expect(edit(add('c', 'target'))).rejects.toMatchObject({ code: 'EDITOR_BUSY' }); guard.markEditorBusy('draft', false);
  });
  it('node deletion reports native edge cleanup and blocks a running downstream node', async () => {
    store.setState({ edges: [edge('e', 'a', 'target')], nodes: state().nodes.map(item => item.id === 'target' ? { ...item, data: { ...item.data, taskInfo: { status: 'running' } } } : item) });
    await expect(state().actions.deleteNodes(['a'], { strictReceipt: true, expectedVersion: '18' })).rejects.toMatchObject({ code: 'NODE_BUSY' }); expect(state().edges).toHaveLength(1); expect(api.update).not.toHaveBeenCalled();
    store.setState({ nodes: state().nodes.map(item => ({ ...item, data: { ...item.data, taskInfo: { status: 'success' } } })) });
    expect(await state().actions.deleteNodes(['a'], { strictReceipt: true, expectedVersion: '18' })).toMatchObject({ affectedNodeIds: ['a'], affectedEdgeIds: ['e'] }); expect(state().edges).toEqual([]);
  });
  it('unknown node deletion retains its optimistic result and reports removed edge IDs', async () => {
    store.setState({ edges: [edge('e', 'a', 'target')] }); api.update.mockRejectedValueOnce(unknown());
    await expect(state().actions.deleteNodes(['a'], { strictReceipt: true, expectedVersion: '18' })).rejects.toMatchObject({ requestPhase: 'sent_unknown', affectedNodeIds: ['a'], affectedEdgeIds: ['e'] });
    expect(state().nodes.some(item => item.id === 'a')).toBe(false); expect(state().edges).toEqual([]); expect(state().agentPersistenceIssue?.code).toBe('SUBMISSION_UNKNOWN');
  });
  it('keeps native UI connect/delete/order return values, selection and single save behavior', async () => {
    expect(state().actions.connect(edge('ui', 'a', 'target'))).toBeUndefined(); await state().actions.awaitMutationsIdle(); expect(state().edges).toHaveLength(1);
    expect(state().actions.edgeOrderChange([{ edgeId: 'ui', value: '' }])).toBeUndefined(); await state().actions.awaitMutationsIdle();
    expect(state().actions.deleteEdges(['ui'])).toBeUndefined(); await state().actions.awaitMutationsIdle(); expect(state().edges).toEqual([]); expect(api.update).toHaveBeenCalledTimes(3);
  });
});
