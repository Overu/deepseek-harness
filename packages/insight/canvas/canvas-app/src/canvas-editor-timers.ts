import { debounce } from '../legacy/src/utils/debounce';
import type { AgentEditGuard } from './agent-edit-guard';

/** Reuse native debounce in the Client realm; removing an iframe cannot discard its timer. */
export function createCanvasEditorTimers(guard: AgentEditGuard) {
  let disposed = false;
  let sequence = 0;
  const cancellations = new Set<() => void>();
  return {
    create<T extends (...args: any[]) => any>(editorId: string, commit: T, wait: number) {
      const marker = `${editorId}:debounce:${++sequence}`;
      let pending = false;
      const debounced = debounce((...args: Parameters<T>): ReturnType<T> | undefined => {
        if (disposed) return;
        try { return commit(...args); }
        finally { pending = false; guard.markEditorBusy(marker, false); cancellations.delete(cancel); }
      }, wait);
      const cancel = () => { debounced.cancel(); pending = false; guard.markEditorBusy(marker, false); cancellations.delete(cancel); };
      const tracked = (...args: Parameters<T>) => {
        if (disposed) return;
        pending = true; guard.markEditorBusy(marker, true); cancellations.add(cancel);
        return debounced(...args);
      };
      return Object.assign(tracked, { cancel, flush: (...args: Parameters<T>) => disposed ? undefined : debounced.flush(...args), isPending: () => pending });
    },
    dispose: () => { disposed = true; [...cancellations].forEach(cancel => cancel()); },
  };
}
