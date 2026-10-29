import type { FlowStoreApi } from '../legacy/src/store/flowStoreCore';
import { getCanvasViewBinding } from './canvas-service-binding';
const owners = new WeakMap<FlowStoreApi, Set<string>>();
export function ownProcess(store: FlowStoreApi, nodeId: string): () => void {
    let ids = owners.get(store);
    if (!ids) {
        ids = new Set();
        owners.set(store, ids);
    }
    ids.add(nodeId);
    return () => { ids!.delete(nodeId); store.setState({}); };
}
export function isDesktopProcessOwned(nodeId: string): boolean {
    const binding = getCanvasViewBinding();
    return binding?.isProcessOwned?.(nodeId) ?? false;
}
export const processOwnedBy = (store: FlowStoreApi, nodeId: string): boolean => owners.get(store)?.has(nodeId) === true;
