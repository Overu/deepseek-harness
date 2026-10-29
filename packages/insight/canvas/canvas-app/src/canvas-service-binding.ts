import type { FrameReadiness } from '../../src/shared/canvas-agent-protocol';
import type { CanvasContext } from './canvas-context';
import type { PointStoreApi } from '../legacy/src/store/pointStore';

export interface NativeUiFeedback {
  error(message: string): void;
  showCapacityLimit(): void | Promise<void>;
  notifyAuthExpired(): void;
  notifyCanvasLoadError(): void;
}
export interface CanvasViewBinding {
  canvasId: string;
  contextId: string;
  viewId: string;
  store: CanvasContext['store'];
  guard: CanvasContext['guard'];
  barrier: CanvasContext['barrier'];
  points: PointStoreApi;
  getCanvasMetadata: CanvasContext['getCanvasMetadata'];
  getInitialization: CanvasContext['getInitialization'];
  isProcessOwned?(nodeId: string): boolean;
  getReadiness(): FrameReadiness;
  subscribeReadiness(listener: (state: FrameReadiness) => void): () => void;
  mountEditorRoot(root: HTMLElement): () => void;
  setFeedback(feedback: NativeUiFeedback): () => void;
  createEditorDebounce<T extends (...args: any[]) => any>(editorId: string, commit: T, wait: number): ((...args: Parameters<T>) => void) & { cancel(): void; flush(...args: Parameters<T>): void; isPending(): boolean };
  onRelease(cleanup: () => void): () => void;
  loadUiData(): Promise<void>;
  reloadFromUi(): Promise<void>;
  release(): void;
}

// Set before React render, in this iframe's realm. Never imports parent React hooks.
let binding: CanvasViewBinding | undefined;
export const getCanvasViewBinding = () => binding;
export function bindCanvasView(value: CanvasViewBinding): (retainForPending?: boolean) => void {
  if (binding) throw new Error('Canvas view already bound');
  binding = value;
  return (retainForPending = false) => {
    // A destroyed iframe's queued callbacks still resolve its Store hook through this module.
    // Retire the view, but keep its exact binding; falling back would save into an empty UI Store.
    if (!retainForPending && binding === value) binding = undefined;
    value.release();
  };
}
