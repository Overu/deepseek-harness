import { getCanvasViewBinding } from './canvas-service-binding';
import { debounce } from '../legacy/src/utils/debounce';
import { markAgentEditorBusy } from './agent-edit-guard';

let instanceId = 0;

/** Keep the native timer/flush behavior; a retired editor's pending callback still owns its marker. */
export function createAgentEditorDebounce<T extends (...args: any[]) => any>(editorId: string, commit: T, wait: number) {
  const binding = getCanvasViewBinding();
  if (binding) return binding.createEditorDebounce(editorId, commit, wait);
  let pending = false;
  const pendingId = `${editorId}:debounce:${++instanceId}`;
  const debounced = debounce((...args: Parameters<T>): ReturnType<T> => {
    pending = false;
    const result = commit(...args);
    markAgentEditorBusy(pendingId, false);
    return result;
  }, wait);
  const tracked = (...args: Parameters<T>) => {
    pending = true;
    markAgentEditorBusy(pendingId, true);
    return debounced(...args);
  };
  tracked.cancel = () => {
    pending = false;
    debounced.cancel();
    markAgentEditorBusy(pendingId, false);
  };
  tracked.flush = (...args: Parameters<T>) => debounced.flush(...args);
  tracked.isPending = () => pending;
  return tracked;
}
