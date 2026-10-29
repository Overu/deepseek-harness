import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';

const api = vi.hoisted(() => ({ graph: vi.fn(), models: vi.fn(), modelPermission: vi.fn(), tools: vi.fn(), update: vi.fn(), tone: vi.fn(), prices: vi.fn(), dimensions: vi.fn() }));
vi.mock('@/api/workflow', () => ({ getFlowData: api.graph, getModelParams: api.models, listModelNodeSetting: api.modelPermission, listToolNodeSetting: api.tools, updateCanvas: api.update, saveFlow: vi.fn(), excuteWorkFlow: vi.fn(), fetchTone: api.tone, getAllRule: api.prices }));
vi.mock('@/api/asset', () => ({ getAvailableCapacity: vi.fn() }));
vi.mock('@/components/canvasFlow/utils/mediaDimensionLoader', () => ({ loadIntrinsicMediaDimensions: api.dimensions }));
vi.mock('@/utils', () => ({ isSvgImageUrl: () => false, compressImage: vi.fn() }));
vi.mock('@/store/flowStore', () => { throw new Error('Initialization bootstrapped UI Store'); });
vi.mock('@/routes', () => { throw new Error('Initialization bootstrapped router'); });

import { createCanvasContext } from '../src/canvas-context';

const success = (data: unknown) => ({ code: 'SUCCESS', data });
const node = { id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: { title: '原文', value: '内容' } };
const row = (nodes: Node[] = [node], versionNumber: unknown = '18') => ({ name: '示例', temp: true, thumbnailUrl: 'https://example.com/cover.png', templateId: 'fixture', taskStatus: 'FINISHED', versionNumber, data: JSON.stringify({ nodes, edges: [] }) });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const active = () => { const context = createCanvasContext('2873'); context.setOwnership('active'); return context; };

beforeEach(() => {
  vi.resetAllMocks();
  api.graph.mockResolvedValue(success(row()));
  api.models.mockResolvedValue(success([{ config: JSON.stringify({ text: { fixture: { label: '测试', maxPrompt: 20, params: [] } } }) }]));
  api.modelPermission.mockResolvedValue(success([])); api.tools.mockResolvedValue(success([]));
  api.update.mockResolvedValue(success({ versionNumber: '19' })); api.dimensions.mockResolvedValue(null);
  api.tone.mockResolvedValue(success([{ voiceId: 'tone1', name: '音色' }])); api.prices.mockResolvedValue(success([]));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('native context initialization and readiness', () => {
  it('rejects an invalid ID or already-cancelled waiter before starting a request', async () => {
    expect(() => createCanvasContext('2873x')).toThrow();
    const context = active(); const signal = AbortSignal.abort();
    await expect(context.initialize('read', signal)).rejects.toMatchObject({ code: 'CANCELLED_BEFORE_DISPATCH' });
    expect(api.graph).not.toHaveBeenCalled(); context.dispose();
  });
  it('loads the real graph, model transform, successful empty permissions and metadata without UI', async () => {
    const context = active();
    try {
      const info = await context.initialize('run');
      expect(info.readiness).toMatchObject({ phase: 'ready', capabilities: { read: true, edit: true, run: true }, version: '18' });
      expect(context.store.getState().nodes[0].data.value).toBe('内容');
      expect(context.store.getState().modelNodePermission).toBeNull(); expect(context.store.getState().toolNodePermission).toEqual({});
      expect(context.store.getState().modelMaxPromptMap.fixture).toBe(20);
      expect(context.getCanvasMetadata()).toMatchObject({ name: '示例', temp: true, templateId: 'fixture' });
      expect(context.getInitialization().models.status).toBe('ready'); expect(api.update).not.toHaveBeenCalled();
      expect(api.tone).not.toHaveBeenCalled(); expect(api.prices).not.toHaveBeenCalled();
      await context.loadUiData(); expect(context.store.getState().customToneList).toEqual([{ value: 'tone1', label: '音色' }]);
      expect(api.tone).toHaveBeenCalledTimes(1); await context.loadUiData(); expect(api.tone).toHaveBeenCalledTimes(1);
    } finally { context.dispose(); }
  });
  it('accepts a legal empty graph and rejects malformed graphs before configuration or saves', async () => {
    const empty = active(); api.graph.mockResolvedValueOnce(success(row([])));
    await empty.initialize('edit'); expect(empty.store.getState().nodes).toEqual([]); empty.dispose();
    for (const graph of ['null', '{', '{"nodes":[],"edges":{}}', JSON.stringify({ nodes: [{ ...node, position: null }], edges: [] }), JSON.stringify({ nodes: [node, node], edges: [] })]) {
      const context = active(); api.graph.mockResolvedValueOnce(success({ ...row(), data: graph }));
      await expect(context.initialize('read')).rejects.toMatchObject({ code: 'FRAME_NOT_READY', requestPhase: 'not_sent' });
      expect(context.getInfo().readiness.capabilities.read).toBe(false); expect(context.store.getState().nodes).toEqual([]); context.dispose();
    }
    expect(api.models).toHaveBeenCalledTimes(1); expect(api.update).not.toHaveBeenCalled();
  });
  it.each([undefined, '', ' ', -1, 1.2, Number.MAX_SAFE_INTEGER + 1])('a missing or untrusted version %s allows read but cannot auto-save or edit', async version => {
    const context = active(); api.graph.mockResolvedValueOnce(success({ ...row(), versionNumber: version }));
    try {
      expect((await context.initialize('read')).readiness.version).toBeNull();
      await expect(context.initialize('edit')).rejects.toMatchObject({ code: 'VERSION_UNAVAILABLE' });
      expect(api.update).not.toHaveBeenCalled(); expect(api.graph).toHaveBeenCalledTimes(1);
    } finally { context.dispose(); }
  });
  it('preserves a valid zero and a large Long string version exactly', async () => {
    for (const version of [0, '9007199254740993']) {
      const context = active(); api.graph.mockResolvedValueOnce(success(row([node], version)));
      expect((await context.initialize('edit')).readiness.version).toBe(String(version));
      expect(context.store.getState().versionNumber).toBe(version); context.dispose();
    }
  });
  it('records model failure but still prepares a readable graph and safe text editing', async () => {
    const context = active(); api.models.mockRejectedValueOnce(new Error('模型失败'));
    try {
      expect((await context.initialize('read')).readiness.capabilities).toEqual({ read: true, edit: true, run: false });
      expect(context.getInitialization().models).toMatchObject({ status: 'failed', error: { code: 'CONFIGURATION_ERROR' } });
      await expect(context.initialize('run')).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
      expect(context.store.getState().nodes[0].data.title).toBe('原文'); expect(api.update).not.toHaveBeenCalled();
      await context.store.getState().actions.updateNodeData('n1', { title: '文本仍可编辑' }, true, true, { strictReceipt: true, expectedVersion: '18' });
      expect(api.update).toHaveBeenCalledTimes(1);
    } finally { context.dispose(); }
  });
  it.each(['models', 'modelPermission', 'tools'] as const)('a healthy authoritative graph refresh tolerates %s outages without disabling ordinary editing', async key => {
    const context = active(); await context.initialize('edit');
    api.graph.mockResolvedValueOnce(success(row([{ ...node, data: { title: '权威新标题', value: '新正文' } }], '20')));
    api[key].mockRejectedValueOnce(new Error('Failed to fetch model params: 502'));
    try {
      // Ordinary generation needs model permission, not unrelated tool permission.
      expect((await context.reload('read')).readiness.capabilities).toEqual({ read: true, edit: true, run: key === 'tools' });
      expect(context.getInfo().readiness.version).toBe('20');
      expect(context.store.getState().nodes[0].data.title).toBe('权威新标题');
      api.update.mockResolvedValueOnce(success({ versionNumber: '21' }));
      await context.store.getState().actions.updateNodeData('n1', { title: '普通编辑仍可保存' }, true, true, { strictReceipt: true, expectedVersion: '20' });
      expect(api.update).toHaveBeenCalledTimes(1);
      if (key === 'tools') await expect(context.initialize('run')).resolves.toMatchObject({ readiness: { capabilities: { run: true } } });
      else await expect(context.initialize('run')).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    } finally { context.dispose(); }
  });
  it('a configuration outage cannot clear a polling version uncertainty during refresh', async () => {
    const context = active(); await context.initialize('edit');
    await context.barrier.runPolling(async () => null, () => false);
    api.models.mockRejectedValueOnce(new Error('models 502'));
    try {
      await expect(context.reload('read')).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
      expect(context.barrier.isUncertain()).toBe(true);
      expect(context.getInfo().readiness.capabilities.edit).toBe(false);
      expect(api.update).not.toHaveBeenCalled();
    } finally { context.dispose(); }
  });
  it('model authentication failure still revokes a previously healthy graph during refresh', async () => {
    const context = active(); await context.initialize('edit'); api.models.mockRejectedValueOnce({ status: 401 });
    try {
      await expect(context.reload('read')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
      expect(context.getInfo().readiness.capabilities).toEqual({ read: false, edit: false, run: false });
      expect(api.update).not.toHaveBeenCalled();
    } finally { context.dispose(); }
  });
  it('a configuration outage with an untrusted refreshed version stays read-only instead of reusing the old version', async () => {
    const context = active(); await context.initialize('edit');
    api.graph.mockResolvedValueOnce(success({ ...row(), versionNumber: null })); api.models.mockRejectedValueOnce(new Error('models 502'));
    try {
      const info = await context.reload('read');
      expect(info.readiness.version).toBeNull();
      expect(info.readiness.capabilities).toEqual({ read: true, edit: false, run: false });
      await expect(context.initialize('edit')).rejects.toMatchObject({ code: 'VERSION_UNAVAILABLE' });
      expect(api.update).not.toHaveBeenCalled();
    } finally { context.dispose(); }
  });
  it('distinguishes an empty model configuration from failure and never claims run support', async () => {
    const context = active(); api.models.mockResolvedValueOnce(success([{ config: '{}' }]));
    try {
      await context.initialize('read'); expect(context.getInitialization().models).toMatchObject({ status: 'ready', empty: true });
      await expect(context.initialize('run')).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    } finally { context.dispose(); }
  });
  it('applies the real native subscription/permission migration and records its result', async () => {
    const context = active();
    api.graph.mockResolvedValueOnce(success(row([{ ...node, data: { title: '旧模型', params: { model: 'old', prompt: '内容' } } }])));
    api.modelPermission.mockResolvedValueOnce(success([
      { model_key: 'old', model_category: 'text', visible: 0, enabled: 0 },
      { model_key: 'fixture', model_category: 'text', visible: 1, enabled: 1 },
    ]));
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ old: 'fixture' }) } as Response);
    await context.initialize('edit');
    expect(context.store.getState().nodes[0].data.params).toMatchObject({ model: 'fixture' });
    expect(context.getInitialization().graph.replacedSubscriptionModel).toBe(true); context.dispose();
  });
  it('does not auto-persist media initialization or late size resolution when configuration fails', async () => {
    const context = active(); const size = deferred<null>(); api.dimensions.mockReturnValueOnce(size.promise);
    api.graph.mockResolvedValueOnce(success(row([{ ...node, type: 'image', data: { title: '图', value: 'https://example.com/a.png' } }])));
    api.modelPermission.mockRejectedValueOnce(new Error('权限失败'));
    try {
      await context.initialize('read'); size.resolve(null);
      await vi.waitFor(() => expect(context.store.getState().nodes[0].data.dimensionMeta).toMatchObject({ status: 'failed' }));
      await context.store.getState().actions.awaitMutationsIdle(); expect(api.update).not.toHaveBeenCalled();
      await expect(context.initialize('run')).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    } finally { size.resolve(null); context.dispose(); }
  });
  it('waits for native initialization persistence before advertising edit readiness', async () => {
    const context = active(); const save = deferred<unknown>(); const size = deferred<null>();
    api.update.mockReturnValueOnce(save.promise); api.dimensions.mockReturnValueOnce(size.promise);
    api.graph.mockResolvedValueOnce(success(row([{ ...node, type: 'image', data: { title: '图', value: 'https://example.com/a.png' } }])));
    const init = context.initialize('edit');
    try {
      await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
      expect(context.getInfo().readiness.capabilities.edit).toBe(false);
      save.resolve(success({ versionNumber: '19' }));
      expect((await init).readiness.version).toBe('19');
    } finally { save.resolve(success({ versionNumber: '19' })); await init; context.dispose(); size.resolve(null); }
    await Promise.resolve(); expect(api.update).toHaveBeenCalledTimes(1);
  });
  it('keeps a failed native init save unconfirmed and blocks strict operations', async () => {
    const context = active(); const size = deferred<null>(); api.dimensions.mockReturnValueOnce(size.promise);
    api.graph.mockResolvedValueOnce(success(row([{ ...node, type: 'image', data: { title: '图', value: 'https://example.com/a.png' } }])));
    api.update.mockRejectedValueOnce(Object.assign(new Error('保存失败'), { requestPhase: 'sent_unknown' }));
    try {
      await context.initialize('read');
      await expect(context.initialize('edit')).rejects.toMatchObject({ code: 'SUBMISSION_UNKNOWN' });
      expect(context.getInitialization().persistence.status).toBe('failed');
    } finally { context.dispose(); size.resolve(null); }
  });
  it('shares initialization, and cancelling one waiter does not abort another waiter', async () => {
    const context = active(); const graph = deferred<unknown>(); api.graph.mockReturnValueOnce(graph.promise);
    const abort = new AbortController(); const a = context.initialize('read', abort.signal); const b = context.initialize('edit');
    const cancelled = expect(a).rejects.toMatchObject({ code: 'CANCELLED_BEFORE_DISPATCH' });
    abort.abort(); await cancelled;
    expect(api.graph.mock.calls[0][1].signal.aborted).toBe(false);
    graph.resolve(success(row())); await b;
    expect(api.graph).toHaveBeenCalledTimes(1); expect(api.models).toHaveBeenCalledTimes(1); context.dispose();
  });
  it('disposal aborts context fetches and ignores late graph/configuration replies', async () => {
    const context = active(); const graph = deferred<unknown>(); api.graph.mockReturnValueOnce(graph.promise);
    const init = context.initialize('read'); const stopped = expect(init).rejects.toMatchObject({ code: 'FRAME_GONE' });
    context.dispose(); expect(api.graph.mock.calls[0][1].signal.aborted).toBe(true);
    await stopped; graph.resolve(success(row())); await Promise.resolve();
    expect(context.getInfo().readiness.phase).toBe('disposed'); expect(context.store.getState().nodes).toEqual([]); expect(api.models).not.toHaveBeenCalled();
  });
  it('does not apply late model/permission responses after disposal', async () => {
    const context = active(); const models = deferred<unknown>(); api.models.mockReturnValueOnce(models.promise);
    const init = context.initialize('read'); const stopped = expect(init).rejects.toMatchObject({ code: 'FRAME_GONE' });
    await vi.waitFor(() => expect(api.models).toHaveBeenCalledTimes(1)); context.dispose(); await stopped;
    models.resolve(success([{ config: '{}' }])); await Promise.resolve(); await Promise.resolve();
    expect(context.store.getState().nodes).toEqual([]); expect(context.store.getState().modelsMap).toEqual({}); expect(fetch).not.toHaveBeenCalled();
  });
  it('records subscription fallback failure separately while retaining the native empty-map policy', async () => {
    const context = active(); vi.mocked(fetch).mockRejectedValueOnce(new Error('CDN不可用'));
    await context.initialize('edit'); expect(context.getInitialization().subscription.status).toBe('fallback');
    expect(context.getInfo().readiness.capabilities.edit).toBe(true); context.dispose();
  });
  it('initializes only read access without ownership and requires authoritative reload after activation', async () => {
    const context = createCanvasContext('2873');
    await context.initialize('read'); await expect(context.initialize('edit')).rejects.toMatchObject({ code: 'FRAME_INACTIVE' });
    expect(context.store.getState().readOnly).toBe(true); expect(api.update).not.toHaveBeenCalled();
    context.setOwnership('active'); await expect(context.initialize('edit')).rejects.toMatchObject({ code: 'FRAME_NOT_READY' });
    await context.reload('edit'); expect(context.getInfo().readiness.capabilities.edit).toBe(true); context.dispose();
  });
  it('returns snapshots immediately and updates readiness after graph/save/ownership changes', async () => {
    const context = active(); const listener = vi.fn(); const unsubscribe = context.subscribeReadiness(listener);
    expect(listener.mock.calls[0][0].phase).toBe('loading'); await context.initialize('edit');
    context.store.getState().actions.setVersionNumber('19'); expect(listener.mock.lastCall?.[0].version).toBe('19');
    context.setOwnership('inactive'); expect(listener.mock.lastCall?.[0].capabilities.edit).toBe(false);
    unsubscribe(); const calls = listener.mock.calls.length; context.dispose(); expect(listener).toHaveBeenCalledTimes(calls);
  });
  it('a failing readiness observer cannot turn an acknowledged native save into a failed receipt', async () => {
    const context = active(); await context.initialize('edit');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined); const observed = vi.fn();
    context.subscribeReadiness(state => { if (state.version === '19') throw new Error('通知连接失效'); });
    context.subscribeReadiness(observed);
    try {
      await context.store.getState().actions.updateNodeData('n1', { title: '已保存' }, true, true, { strictReceipt: true, expectedVersion: '18' });
      expect(context.store.getState().versionNumber).toBe('19'); expect(context.store.getState().agentPersistenceIssue).toBeNull();
      expect(observed.mock.lastCall?.[0].version).toBe('19'); expect(log).toHaveBeenCalled();
    } finally { context.dispose(); log.mockRestore(); }
  });
  it('only explicit successful reload clears unknown saves; failed reload preserves the original issue and graph', async () => {
    const context = active(); await context.initialize('edit');
    context.store.setState({ agentPersistenceIssue: { code: 'SUBMISSION_UNKNOWN', message: '未知保存', retry: 'read_first' } });
    await expect(context.initialize('edit')).rejects.toMatchObject({ code: 'SUBMISSION_UNKNOWN' }); expect(api.graph).toHaveBeenCalledTimes(1);
    api.graph.mockRejectedValueOnce(new Error('刷新失败'));
    await expect(context.reload('read')).rejects.toMatchObject({ code: 'FRAME_NOT_READY' });
    expect(context.store.getState().agentPersistenceIssue?.code).toBe('SUBMISSION_UNKNOWN'); expect(context.store.getState().nodes[0].data.title).toBe('原文');
    api.graph.mockResolvedValueOnce(success(row([{ ...node, data: { title: '权威新图', value: '新内容' } }], '20')));
    await context.reload('edit'); expect(context.store.getState().agentPersistenceIssue).toBeNull(); expect(context.getInfo().readiness.version).toBe('20');
    expect(context.store.getState().undoStack).toHaveLength(1); context.dispose();
  });
  it('a reload without a trustworthy version retains the original unknown receipt', async () => {
    const context = active(); await context.initialize('read');
    context.store.setState({ agentPersistenceIssue: { code: 'SUBMISSION_UNKNOWN', message: '未知', retry: 'read_first' } });
    api.graph.mockResolvedValueOnce(success({ ...row(), versionNumber: null }));
    await context.reload('read'); expect(context.getInfo().readiness.version).toBeNull();
    expect(context.store.getState().agentPersistenceIssue?.code).toBe('SUBMISSION_UNKNOWN');
    await expect(context.initialize('edit')).rejects.toMatchObject({ code: 'SUBMISSION_UNKNOWN' }); context.dispose();
  });
  it('failed reload configuration preserves the graph/issue, and a later authoritative reload consumes uncertainty', async () => {
    const context = active(); await context.initialize('edit');
    context.store.setState({ agentPersistenceIssue: { code: 'SUBMISSION_UNKNOWN', message: '未知', retry: 'read_first' } });
    api.tools.mockRejectedValueOnce(new Error('工具权限失败'));
    await expect(context.reload('edit')).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(context.store.getState().agentPersistenceIssue?.code).toBe('SUBMISSION_UNKNOWN'); expect(context.store.getState().nodes[0].data.title).toBe('原文');
    await context.barrier.runPolling(async () => null, () => false); expect(context.barrier.isUncertain()).toBe(true);
    await context.reload('edit'); expect(context.barrier.isUncertain()).toBe(false); expect(context.store.getState().agentPersistenceIssue).toBeNull(); context.dispose();
  });
  it('invalidates old size responses before reload and prevents unsent native queue writes after disposal', async () => {
    const context = active(); const size = deferred<null>(); api.dimensions.mockReturnValueOnce(size.promise);
    api.graph.mockResolvedValueOnce(success(row([{ ...node, type: 'image', data: { title: '图', value: 'https://example.com/a.png' } }])));
    await context.initialize('edit'); expect(api.update).toHaveBeenCalledTimes(1);
    await context.reload('edit'); size.resolve(null); await Promise.resolve(); await Promise.resolve();
    expect(context.store.getState().nodes[0].type).toBe('text'); expect(api.update).toHaveBeenCalledTimes(1);
    const unsent = context.store.getState().actions.partialUpdate('2873', {});
    const refused = expect(unsent).rejects.toMatchObject({ code: 'FRAME_GONE' }); context.dispose(); await refused;
    expect(api.update).toHaveBeenCalledTimes(1);
  });
  it('refuses reload while native UI persistence or editor drafts are pending', async () => {
    const context = active(); await context.initialize('edit'); context.guard.markEditorBusy('prompt', true);
    await expect(context.reload('read')).rejects.toMatchObject({ code: 'EDITOR_BUSY' }); context.guard.markEditorBusy('prompt', false);
    const save = deferred<unknown>(); api.update.mockReturnValueOnce(save.promise);
    const ui = context.store.getState().actions.partialUpdate('2873', {});
    await expect(context.reload('read')).rejects.toMatchObject({ code: 'EDITOR_BUSY' });
    expect(api.graph).toHaveBeenCalledTimes(1); save.resolve(success({ versionNumber: '19' })); await ui; context.dispose();
  });
  it('auth failure never exposes the already loaded graph as usable cache', async () => {
    const context = active(); await context.initialize('read'); api.graph.mockRejectedValueOnce({ status: 403 });
    await expect(context.reload('read')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(context.initialize('read')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(context.getInfo().readiness.capabilities.read).toBe(false); expect(() => context.getCanvasMetadata()).toThrow(); context.dispose();
  });
});
