import { getCanvasViewBinding, type CanvasViewBinding } from '../../../src/canvas-service-binding';
import { useStore } from 'zustand';
import { toast } from 'sonner';
import { createFlowStoreApi, type FlowState, type FlowStoreApi } from './flowStoreCore';
import { defaultAgentEditGuard } from '../../../src/agent-edit-guard';
import { defaultCanvasVersionBarrier } from '@/lib/canvasVersionBarrier';
import { setCanvasReadOnlyFlag } from '@/components/canvasFlow/utils/canvasReadOnly';
import { showStorageCapacityLimit } from '@/components/canvasFlow/utils/toolUtil';
import type { CanvasVersionNumber } from '@/api/workflow';

export { buildSingleWorkflowPayload } from './flowStoreCore';
export type { FlowState, FlowStoreApi, NodeUpdate, StoryboardDropPreview } from './flowStoreCore';
export { isVersionConflict } from '@/lib/canvasVersionBarrier';

// Standalone UI keeps its existing singleton, hook and imperative API.
const defaultFlowStore = createFlowStoreApi({
  barrier: defaultCanvasVersionBarrier,
  guard: defaultAgentEditGuard,
  feedback: { error: message => toast.error(message), showCapacityLimit: showStorageCapacityLimit },
  onReadOnlyChange: setCanvasReadOnlyFlag,
});

// A subscription facade delegates to the same vanilla Store, and scopes UI listeners to its view.
const viewFlowApis = new WeakMap<CanvasViewBinding, FlowStoreApi>();
function currentFlowApi(): FlowStoreApi {
  const binding = getCanvasViewBinding();
  if (!binding) return defaultFlowStore;
  let api = viewFlowApis.get(binding);
  if (!api) {
    api = { ...binding.store, subscribe: listener => {
      const unsubscribe = binding.store.subscribe(listener);
      const untrack = binding.onRelease(unsubscribe);
      return () => { untrack(); unsubscribe(); };
    } };
    viewFlowApis.set(binding, api);
  }
  return api;
}

function useDefaultFlowStore(): FlowState;
function useDefaultFlowStore<T>(selector: (state: FlowState) => T): T;
function useDefaultFlowStore<T>(selector?: (state: FlowState) => T): FlowState | T {
  return useStore<FlowStoreApi, FlowState | T>(currentFlowApi(), selector ?? (state => state));
}
export const useFlowStore: typeof useDefaultFlowStore & FlowStoreApi = Object.assign(useDefaultFlowStore, {
  getState: () => (currentFlowApi()).getState(),
  getInitialState: () => (currentFlowApi()).getInitialState(),
  setState: ((...args: any[]) => (currentFlowApi()).setState(...args as [any])) as FlowStoreApi['setState'],
  subscribe: ((listener: Parameters<FlowStoreApi['subscribe']>[0]) => (currentFlowApi()).subscribe(listener)),
});

export const syncCanvasVersionNumber = (canvasId: string, versionNumber?: CanvasVersionNumber) => {
  if (typeof versionNumber !== 'number' && typeof versionNumber !== 'string') return;
  const state = useFlowStore.getState();
  if (state.canvasId === canvasId) state.actions.setVersionNumber(versionNumber);
};
