import { getCanvasViewBinding } from './canvas-service-binding';
import { CanvasAgentError } from '../../src/shared/canvas-agent-protocol';

export interface AgentEditGuard {
  markEditorBusy(editorId: string, busy: boolean): void;
  isEditorBusy(): boolean;
  isOperationBusy(): boolean;
  subscribeBusy(listener: () => void): () => void;
  subscribeEditors(listener: () => void): () => void;
  assertOperationActive(): void;
  run<T>(operation: () => T | Promise<T>, awaitIdle: () => Promise<void>): Promise<T>;
  attachRoot(viewId: string, root: HTMLElement): () => void;
  dispose(): void;
}

interface GuardOptions {
  // Preserve the existing iframe-only API until owned views are migrated.
  legacyDocumentFocus?: boolean;
  invalidateOnDetach?: boolean;
}

export function createAgentEditGuard(options: GuardOptions = {}): AgentEditGuard {
  const pendingEditors = new Set<string>();
  const busyListeners = new Set<() => void>();
  let operationBusy = false;
  let surfaceRevision = 0;
  let operationRevision = 0;
  let surfaceId = 0;
  let disposed = false;
  const roots = new Map<string, { root: HTMLElement; detach: () => void }>();
  const editorListeners = new Set<() => void>();

  function markAgentEditorBusy(editorId: string, busy: boolean): void {
    if (disposed) return;
    const wasBusy = pendingEditors.has(editorId);
    if (busy) pendingEditors.add(editorId);
    else pendingEditors.delete(editorId);
    if (wasBusy !== busy) editorListeners.forEach(listener => listener());
  }

  function isAgentEditorBusy(): boolean {
    return pendingEditors.size > 0;
  }

  function isAgentOperationBusy(): boolean {
    return operationBusy;
  }

  function subscribeAgentOperationBusy(listener: () => void): () => void {
    busyListeners.add(listener);
    return () => { busyListeners.delete(listener); };
  }

  function rejectOperation(code: 'EDITOR_BUSY' | 'READ_ONLY', message: string): never {
    throw Object.assign(new CanvasAgentError(code, message), { requestPhase: 'not_sent' });
  }

  function assertNoEditorDraft(): void {
    if (disposed) rejectOperation('READ_ONLY', '目标画布上下文已关闭');
    const activeElements = [...roots.values()]
      .filter(({ root }) => {
        const doc = root.ownerDocument;
        if (!doc.hasFocus()) return false;
        // An inactive iframe can retain its last editor as activeElement.
        let frame = doc.defaultView?.frameElement;
        while (frame) {
          if (frame.ownerDocument.activeElement !== frame) return false;
          frame = frame.ownerDocument.defaultView?.frameElement;
        }
        return true;
      })
      .map(({ root }) => root.ownerDocument.activeElement);
    if (options.legacyDocumentFocus && typeof document !== 'undefined') activeElements.push(document.activeElement);
    if (isAgentEditorBusy() || activeElements.some(active => active?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])'))) {
      rejectOperation('EDITOR_BUSY', '用户正在编辑或有待提交内容，请编辑完成后重试');
    }
  }

  /** Also used immediately before the existing queue sends a strict mutation. */
  function assertAgentOperationActive(): void {
    if (operationBusy && operationRevision !== surfaceRevision) {
      rejectOperation('READ_ONLY', '目标画布已卸载或切换');
    }
    assertNoEditorDraft();
  }

  async function withAgentEditGuard<T>(operation: () => T | Promise<T>, awaitIdle: () => Promise<void>): Promise<T> {
    assertNoEditorDraft();
    if (operationBusy) rejectOperation('EDITOR_BUSY', '已有 Agent 操作正在保存或提交');
    operationRevision = surfaceRevision;
    operationBusy = true;
    try {
      busyListeners.forEach(listener => listener());
      await awaitIdle();
      assertAgentOperationActive();
      return await operation();
    } finally {
      operationBusy = false;
      busyListeners.forEach(listener => listener());
    }
  }

  /** Desktop iframe only: capture before document shortcuts and include body portals. */
  function attachRoot(viewId: string, root: HTMLElement): () => void {
    if (disposed) rejectOperation('READ_ONLY', '目标画布上下文已关闭');
    roots.get(viewId)?.detach();
    const view = root.ownerDocument.defaultView!;
    const doc = root.ownerDocument;
    const prefix = `surface:${++surfaceId}`;
    const wasInert = root.inert;
    const composing = new Map<Element, string>();
    let compositionId = 0;
    const pointers = new Set<string>();
    if (options.invalidateOnDetach) surfaceRevision++;
    const syncBusy = () => { root.inert = operationBusy || wasInert; };
    const unsubscribe = subscribeAgentOperationBusy(syncBusy);
    syncBusy();

    const blockedEvents = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu', 'keydown', 'keypress', 'beforeinput', 'input', 'change', 'paste', 'cut', 'dragstart', 'dragover', 'drop', 'compositionstart'];
    const capture = (event: Event) => {
      if (operationBusy) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.type === 'compositionstart' && event.target instanceof view.Element) {
        const target = event.target;
        if (!composing.has(target)) {
          const nodeId = target.closest('[data-id]')?.getAttribute('data-id') ?? target.id;
          const id = `${prefix}:${nodeId}:composition:${++compositionId}`;
          composing.set(target, id);
          markAgentEditorBusy(id, true);
        }
      }
      if (event.type === 'pointerdown') {
        const id = `${prefix}:pointer:${(event as PointerEvent).pointerId ?? 0}`;
        pointers.add(id);
        markAgentEditorBusy(id, true);
      }
    };
    const endComposition = (event: Event) => {
      const target = event.target as Element;
      const id = composing.get(target);
      if (id) { markAgentEditorBusy(id, false); composing.delete(target); }
    };
    const endPointer = (event: Event) => {
      const id = `${prefix}:pointer:${(event as PointerEvent).pointerId ?? 0}`;
      markAgentEditorBusy(id, false);
      pointers.delete(id);
    };
    const clearPointers = () => {
      pointers.forEach(id => markAgentEditorBusy(id, false));
      pointers.clear();
    };
    const observer = new view.MutationObserver(() => {
      composing.forEach((id, target) => {
        if (!target.isConnected) { markAgentEditorBusy(id, false); composing.delete(target); }
      });
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    blockedEvents.forEach(name => view.addEventListener(name, capture, true));
    view.addEventListener('compositionend', endComposition, true);
    view.addEventListener('pointerup', endPointer, true);
    view.addEventListener('pointercancel', endPointer, true);
    view.addEventListener('blur', clearPointers);
    let detached = false;
    const detach = () => {
      if (detached) return;
      detached = true;
      roots.delete(viewId);
      if (options.invalidateOnDetach) surfaceRevision++;
      unsubscribe();
      root.inert = wasInert;
      blockedEvents.forEach(name => view.removeEventListener(name, capture, true));
      view.removeEventListener('compositionend', endComposition, true);
      view.removeEventListener('pointerup', endPointer, true);
      view.removeEventListener('pointercancel', endPointer, true);
      view.removeEventListener('blur', clearPointers);
      observer.disconnect();
      composing.forEach(id => markAgentEditorBusy(id, false));
      clearPointers();
    };
    roots.set(viewId, { root, detach });
    return detach;
  }

  function subscribeEditors(listener: () => void): () => void {
    editorListeners.add(listener);
    return () => { editorListeners.delete(listener); };
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    surfaceRevision++;
    [...roots.values()].forEach(({ detach }) => detach());
    pendingEditors.clear();
    editorListeners.forEach(listener => listener());
    editorListeners.clear();
    busyListeners.clear();
  }

  return {
    markEditorBusy: markAgentEditorBusy, isEditorBusy: isAgentEditorBusy,
    isOperationBusy: isAgentOperationBusy, subscribeBusy: subscribeAgentOperationBusy,
    assertOperationActive: assertAgentOperationActive, run: withAgentEditGuard,
    subscribeEditors, attachRoot, dispose,
  };
}

export const defaultAgentEditGuard = createAgentEditGuard({ legacyDocumentFocus: true, invalidateOnDetach: true });
export const markAgentEditorBusy = (id: string, busy: boolean) => (getCanvasViewBinding()?.guard ?? defaultAgentEditGuard).markEditorBusy(id, busy);
export const isAgentEditorBusy = () => (getCanvasViewBinding()?.guard ?? defaultAgentEditGuard).isEditorBusy();
export const isAgentOperationBusy = () => (getCanvasViewBinding()?.guard ?? defaultAgentEditGuard).isOperationBusy();
export const subscribeAgentOperationBusy = (listener: () => void) => (getCanvasViewBinding()?.guard ?? defaultAgentEditGuard).subscribeBusy(listener);
export const assertAgentOperationActive = () => (getCanvasViewBinding()?.guard ?? defaultAgentEditGuard).assertOperationActive();
export const withAgentEditGuard: AgentEditGuard['run'] = (operation, awaitIdle) => (getCanvasViewBinding()?.guard ?? defaultAgentEditGuard).run(operation, awaitIdle);
let defaultViewId = 0;
export const installAgentCanvasEditGuard = (root: HTMLElement): (() => void) =>
  defaultAgentEditGuard.attachRoot(`standalone:${++defaultViewId}`, root);
