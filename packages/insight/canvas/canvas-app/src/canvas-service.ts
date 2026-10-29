import { processOwnedBy } from './process-ownership';
import { CanvasAgentError } from '../../src/shared/canvas-agent-protocol';
import type { CanvasContextInput, CanvasServiceRuntimeBase, CanvasViewRegistration } from '../../src/shared/canvas-service-runtime';
import { parseCanvasId } from '../../src/shared/protocol';
import { createCanvasContext, type CanvasContext } from './canvas-context';
import { createCanvasAgentAdapter } from './agent-adapter';
import { createPointStoreApi } from '../legacy/src/store/pointStore';
import type { CanvasViewBinding, NativeUiFeedback } from './canvas-service-binding';

function reject(code: ConstructorParameters<typeof CanvasAgentError>[0], message: string): never {
  throw Object.assign(new CanvasAgentError(code, message), { requestPhase: 'not_sent' });
}
interface ViewEntry {
  input: CanvasViewRegistration;
  binding?: CanvasViewBinding;
  document?: Document;
  releaseBinding?: () => void;
  publish?: () => void;
  active: boolean;
  attaching?: Promise<CanvasViewBinding>;
  pendingDocument?: Document;
  generation?: number;
}

/** One registry and native point cache per Client lifetime. No canvas DOM is created here. */
export function createCanvasServiceRuntime(): CanvasServiceRuntimeBase<CanvasViewBinding> {
  const contexts = new Map<string, CanvasContext>();
  const views = new Map<string, ViewEntry>();
  const ownerKey = crypto.randomUUID();
  const points = createPointStoreApi(() => ownerKey, () => ({ silentError: true }));
  let disposed = false;
  const assertActive = () => { if (disposed) reject('FRAME_GONE', '画布插件服务已卸载'); };
  const validId = (canvasId: string) => {
    assertActive(); const id = parseCanvasId(canvasId);
    if (!id) reject('INVALID_ARGUMENT', '画布 ID 无效'); return id;
  };
  const validate = (input: CanvasContextInput) => {
    const id = validId(input.canvasId);
    if (!['read', 'edit', 'run'].includes(input.capability)) reject('INVALID_ARGUMENT', '画布能力请求无效');
    if (input.signal?.aborted) reject('CANCELLED_BEFORE_DISPATCH', '调用方已停止等待画布准备'); return id;
  };
  const contextFor = (id: string) => {
    let context = contexts.get(id);
    if (!context) { context = createCanvasContext(id, points); contexts.set(id, context); }
    return context;
  };
  const detachView = (viewId: string) => {
    const entry = views.get(viewId); if (!entry) return;
    try { entry.releaseBinding?.(); } finally { views.delete(viewId); }
  };
  return {
    ensureContext: async input => {
      const context = contextFor(validate(input));
      await context.acquireOwnership();
      return context.initialize(input.capability, input.signal);
    },
    execute: async input => {
      if (input.signal?.aborted) reject('CANCELLED_BEFORE_DISPATCH', '调用已取消，尚未执行');
      const id = validId(input.canvasId);
      if (input.expectedContextId !== undefined && contexts.get(id)?.contextId !== input.expectedContextId) reject('CONTEXT_GONE', '目标画布上下文已被替换或释放');
      const context = contextFor(id);
      await context.acquireOwnership();
      return createCanvasAgentAdapter(context).execute(input.operation, input.signal, input.requestId);
    },
    registerView: input => {
      const id = validId(input.canvasId);
      if (!input.viewId || input.viewId.length > 200 || views.has(input.viewId)) reject('INVALID_ARGUMENT', '画布视图登记无效或重复');
      const url = new URL(input.frame.src);
      if (url.origin !== location.origin || url.pathname !== '/desktop-canvas/view' || url.searchParams.get('id') !== id || url.searchParams.get('viewId') !== input.viewId) reject('FRAME_GONE', '画布视图地址与登记目标不符');
      const entry: ViewEntry = { input, active: false }; views.set(input.viewId, entry);
      return () => { if (views.get(input.viewId) === entry) detachView(input.viewId); };
    },
    attachView: async input => {
      const id = validId(input.canvasId); const entry = views.get(input.viewId);
      const verify = () => {
        if (!entry || views.get(input.viewId) !== entry || entry.input.canvasId !== id || entry.input.frame.contentWindow !== input.viewWindow
          || input.viewWindow.document !== input.viewDocument || input.viewDocument.defaultView !== input.viewWindow
          || input.viewWindow.location.origin !== location.origin) reject('FRAME_GONE', '画布视图未登记、跨源或已被替换');
      };
      verify();
      if (entry!.binding && entry!.document === input.viewDocument) return entry!.binding;
      if (entry!.attaching && entry!.pendingDocument === input.viewDocument) return entry!.attaching;
      const generation = (entry!.generation ?? 0) + 1; entry!.generation = generation;
      entry!.pendingDocument = input.viewDocument;
      const attaching = (async () => {
        entry!.releaseBinding?.();
        const context = contextFor(id);
        await context.acquireOwnership(true);
        if (context.getInfo().readiness.capabilities.read && context.getInfo().readiness.reason?.code === 'FRAME_NOT_READY') await context.reload('read');
        else await context.initialize('read');
        verify();
        if (entry!.generation !== generation) reject('FRAME_GONE', '画布视图已被替换');
        context.setFeedback(undefined);
        views.forEach(other => { if (other !== entry && other.input.canvasId === id && other.active) { other.active = false; other.publish?.(); } });
        entry!.active = true; entry!.document = input.viewDocument;
        const listeners = new Set<Parameters<CanvasViewBinding['subscribeReadiness']>[0]>();
        const cleanups = new Set<() => void>();
        const markers = new Set<string>();
        let feedback: NativeUiFeedback | undefined;
        const getReadiness = () => {
          const state = context.getInfo().readiness;
          return entry!.active || !state.capabilities.read ? state : { ...state, phase: 'inactive' as const, capabilities: { read: state.capabilities.read, edit: false, run: false } };
        };
        const publish = () => { listeners.forEach(listener => { try { listener(getReadiness()); } catch (error) { console.error('Canvas view subscriber failed:', error); } }); };
        entry!.publish = publish;
        const unsubscribe = context.subscribeReadiness(publish);
        let released = false;
        const binding: CanvasViewBinding = {
          canvasId: id, contextId: context.contextId, viewId: input.viewId, store: context.store,
          guard: { ...context.guard,
          subscribeBusy: listener => {
            const unsubscribe = context.guard.subscribeBusy(listener);
            if (released) { unsubscribe(); return () => undefined; }
            cleanups.add(unsubscribe); return () => { cleanups.delete(unsubscribe); unsubscribe(); };
          },
          subscribeEditors: listener => {
            const unsubscribe = context.guard.subscribeEditors(listener);
            if (released) { unsubscribe(); return () => undefined; }
            cleanups.add(unsubscribe); return () => { cleanups.delete(unsubscribe); unsubscribe(); };
          },
          markEditorBusy: (marker, busy) => {
            if (released) return;
            const key = `${input.viewId}:${marker}`;
            if (busy) markers.add(key); else markers.delete(key);
            context.guard.markEditorBusy(key, busy);
          } }, barrier: context.barrier, points,
          isProcessOwned: nodeId => processOwnedBy(context.store, nodeId),
          getCanvasMetadata: context.getCanvasMetadata, getInitialization: context.getInitialization, getReadiness,
          subscribeReadiness: listener => { listeners.add(listener); listener(getReadiness()); return () => { listeners.delete(listener); }; },
          mountEditorRoot: root => {
            if (released || root.ownerDocument !== input.viewDocument) reject('FRAME_GONE', '编辑根元素不属于登记视图');
            const detach = context.guard.attachRoot(input.viewId, root); cleanups.add(detach);
            return () => { cleanups.delete(detach); detach(); };
          },
          setFeedback: value => {
            if (released) return () => undefined;
            feedback = value; if (entry!.active) context.setFeedback(value);
            return () => { if (!released && feedback === value) { feedback = undefined; if (entry!.active) context.setFeedback(undefined); } };
          },
          createEditorDebounce: context.timers.create,
          onRelease: cleanup => { if (released) { cleanup(); return () => undefined; } cleanups.add(cleanup); return () => { cleanups.delete(cleanup); }; },
          loadUiData: () => context.loadUiData(),
          reloadFromUi: async () => { if (released) reject('FRAME_GONE', '画布视图已释放'); await context.acquireOwnership(true); await context.reload('read'); publish(); },
          release: () => {
            if (released) return; released = true;
            cleanups.forEach(cleanup => { try { cleanup(); } catch (error) { console.error('Canvas view cleanup failed:', error); } }); cleanups.clear();
            markers.forEach(marker => context.guard.markEditorBusy(marker, false)); markers.clear();
            if (entry!.active) context.setFeedback(undefined);
            unsubscribe(); listeners.clear(); entry!.binding = undefined; entry!.document = undefined;
            entry!.active = false; entry!.publish = undefined; entry!.releaseBinding = undefined;
          },
        };
        entry!.binding = binding; entry!.releaseBinding = binding.release;
        return binding;
      })();
      entry!.attaching = attaching;
      try { return await attaching; } finally { if (entry!.attaching === attaching) { entry!.attaching = undefined; entry!.pendingDocument = undefined; } }
    },
    detachView,
    getContextInfo: canvasId => contexts.get(validId(canvasId))?.getInfo() ?? null,
    subscribeRun: (input, listener) => {
      const context = contexts.get(validId(input.canvasId));
      if (!context || context.contextId !== input.expectedContextId) reject('CONTEXT_GONE', '运行订阅目标上下文已替换或释放');
      return context.subscribeRun(input.requestId, listener);
    },
    subscribeReadiness: (canvasId, listener) => contexts.get(validId(canvasId))?.subscribeReadiness(listener) ?? (() => undefined),
    reloadContext: async input => {
      const context = contextFor(validate(input));
      const initialLoad = context.getInitialization().graph.status === 'idle';
      await context.acquireOwnership();
      // Cold refresh is already authoritative; share initialization instead of loading twice.
      return initialLoad ? context.initialize(input.capability, input.signal) : context.reload(input.capability, input.signal);
    },
    closeContext: async canvasId => {
      const id = validId(canvasId); const context = contexts.get(id); if (!context) return;
      if ([...views.values()].some(view => view.input.canvasId === id)) reject('EDITOR_BUSY', '画布视图仍在使用上下文');
      const state = context.store.getState();
      if (context.getInfo().readiness.phase === 'loading' || context.guard.isEditorBusy() || context.guard.isOperationBusy() || state.actions.hasPendingMutations()) reject('EDITOR_BUSY', '画布正在准备、编辑或保存，不能释放上下文');
      if (state.status === 'RUNNING') reject('NODE_BUSY', '画布仍在生成，不能释放上下文');
      if (state.agentPersistenceIssue) reject(state.agentPersistenceIssue.code, state.agentPersistenceIssue.message);
      if (state.versionConflict || context.barrier.isUncertain()) reject('VERSION_CONFLICT', '画布状态尚未确认，不能释放上下文');
      try { context.dispose(); } finally { contexts.delete(id); }
    },
    dispose: () => {
      if (disposed) return; disposed = true;
      views.forEach(view => { try { view.releaseBinding?.(); } catch (error) { console.error('Canvas view cleanup failed:', error); } }); views.clear();
      try { contexts.forEach(context => { try { context.dispose(); } catch (error) { console.error('Canvas context cleanup failed:', error); } }); }
      finally { contexts.clear(); points.getState().actions.resetUserPoint('session-invalidated'); }
    },
  };
}
