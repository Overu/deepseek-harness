// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ update: vi.fn(), dialog: vi.fn(), toast: vi.fn() }));
vi.mock('@/api/workflow', () => ({ updateCanvas: api.update, saveFlow: vi.fn(), excuteWorkFlow: vi.fn() }));
vi.mock('@/api/asset', () => ({ getAvailableCapacity: vi.fn().mockResolvedValue({ code: 'SUCCESS', data: { usedCapacity: 100, limitCapacity: 100 } }) }));
vi.mock('@/components/common/storageLimitManager', () => ({ openStorageLimitDialog: api.dialog }));
vi.mock('@/components/canvasFlow/utils/mediaDimensionLoader', () => ({ loadIntrinsicMediaDimensions: vi.fn().mockResolvedValue(null) }));
vi.mock('@/utils', () => ({ isSvgImageUrl: () => false, compressImage: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: api.toast } }));

import { useFlowStore, isVersionConflict } from '../legacy/src/store/flowStore';
import { isCanvasReadOnly } from '../legacy/src/components/canvasFlow/utils/canvasReadOnly';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('standalone UI compatibility', () => {
  it('keeps the real hook, imperative subscriptions, void updates and the original readOnly flag', async () => {
    useFlowStore.getState().actions.reset();
    useFlowStore.setState({ canvasId: '2873', versionNumber: '18', nodes: [{ id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: { title: '原文' } }] });
    api.update.mockResolvedValue({ code: 'SUCCESS', data: { versionNumber: '19' } });
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container); const listener = vi.fn(); const unsubscribe = useFlowStore.subscribe(listener);
    function View() {
      const title = useFlowStore(state => state.nodes[0]?.data.title as string);
      return createElement('span', null, title);
    }
    try {
      await act(async () => { root.render(createElement(View)); });
      expect(container.textContent).toBe('原文');
      await act(async () => {
        expect(useFlowStore.getState().actions.updateNodeData('n1', { title: 'UI 更新' })).toBeUndefined();
        await useFlowStore.getState().actions.awaitMutationsIdle();
      });
      expect(container.textContent).toBe('UI 更新'); expect(listener).toHaveBeenCalled();
      expect(api.update).toHaveBeenCalledTimes(1); expect(useFlowStore.getState().versionNumber).toBe('19');
      expect(useFlowStore.getInitialState().nodes).toEqual([]);
      await act(async () => { useFlowStore.getState().actions.setReadOnly(true); });
      expect(isCanvasReadOnly()).toBe(true);
      expect(isVersionConflict({ raw: { code: 5011 } })).toBe(true);
    } finally {
      unsubscribe(); await act(async () => { root.unmount(); }); container.remove();
      useFlowStore.getState().actions.reset();
    }
    expect(isCanvasReadOnly()).toBe(false);
  });
  it('preserves the original toast and capacity dialog for the default UI instance', async () => {
    useFlowStore.getState().actions.reset();
    useFlowStore.setState({ canvasId: '2873', versionNumber: '18' });
    api.update.mockRejectedValueOnce(Object.assign(new Error('原提示'), { raw: { msg: '原提示' } }));
    await expect(useFlowStore.getState().actions.partialUpdate('2873', {})).rejects.toThrow('原提示');
    expect(api.toast).toHaveBeenCalledWith('原提示');
    await expect(useFlowStore.getState().actions.excuteSingle('n1')).resolves.toMatchObject({ type: 'capacity_limit' });
    expect(api.dialog).toHaveBeenCalledTimes(1);
    useFlowStore.getState().actions.reset();
  });
});
