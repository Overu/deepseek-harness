import { createPointStoreApi, type PointStoreApi } from '../legacy/src/store/pointStore';
import { createWorkflowTabOwnership } from '../legacy/src/hooks/workflowTabOwnership';
import { createCanvasRunTracker } from './canvas-run-tracker';
import type { CanvasRunState } from '../../src/shared/canvas-run-protocol';
import { createCanvasGenerationMonitor } from './canvas-generation-monitor';
import { createCanvasEditorTimers } from './canvas-editor-timers';
import type { NativeUiFeedback } from './canvas-service-binding';
import { CanvasAgentError, type ErrorCode, type Failure, type FrameReadiness } from '../../src/shared/canvas-agent-protocol';
import { parseCanvasId } from '../../src/shared/protocol';
import { createFlowStoreApi, type FlowStoreApi } from '../legacy/src/store/flowStoreCore';
import { createCanvasVersionBarrier } from '../legacy/src/lib/canvasVersionBarrier';
import { fetchSubscriptionModelMap } from '../legacy/src/components/canvasFlow/utils/modelPermission';
import { fetchTone, getAllRule, type CanvasRequestOptions } from '../legacy/src/api/workflow';
import { createAgentEditGuard } from './agent-edit-guard';
import { loadNativeCanvas, loadNativeModels, loadNativeModelPermission, loadNativeToolPermission, isTrustedCanvasVersion, type CanvasMetadata } from './canvas-initialization';
import { AUTH_EXPIRED_EVENT } from './auth-context';

export type Capability = 'read' | 'edit' | 'run';
export type CanvasContextReadiness = FrameReadiness;
export interface ContextInfo { canvasId: string; contextId: string; readiness: CanvasContextReadiness }
type StageName = 'graph' | 'models' | 'modelPermission' | 'toolPermission' | 'subscription' | 'persistence' | 'tones' | 'prices';
export interface InitializationStage {
  status: 'idle' | 'loading' | 'ready' | 'failed' | 'fallback';
  empty?: boolean;
  error?: Failure;
  replacedSubscriptionModel?: boolean;
}
export type CanvasInitialization = Record<StageName, InitializationStage>;
export interface CanvasContext {
  readonly canvasId: string;
  readonly contextId: string;
  readonly store: FlowStoreApi;
  readonly guard: ReturnType<typeof createAgentEditGuard>;
  readonly points: PointStoreApi;
  readonly timers: ReturnType<typeof createCanvasEditorTimers>;
  readonly monitor: ReturnType<typeof createCanvasGenerationMonitor>;
  readonly runs: ReturnType<typeof createCanvasRunTracker>;
  getRun(requestId: string): CanvasRunState | null;
  subscribeRun(requestId: string, listener: (state: CanvasRunState) => void): () => void;
  requestOptions(): CanvasRequestOptions;
  acquireOwnership(explicit?: boolean): Promise<void>;
  setFeedback(feedback?: NativeUiFeedback): void;
  readonly barrier: ReturnType<typeof createCanvasVersionBarrier>;
  initialize(capability: Capability, signal?: AbortSignal): Promise<ContextInfo>;
  reload(capability: Capability, signal?: AbortSignal): Promise<ContextInfo>;
  getInfo(): ContextInfo;
  getCanvasMetadata(): CanvasMetadata;
  getInitialization(): CanvasInitialization;
  subscribeReadiness(listener: (state: CanvasContextReadiness) => void): () => void;
  // Internal trusted controller input; never an Agent argument. Controller wiring is task 1.4.4.
  setOwnership(status: 'checking' | 'active' | 'inactive'): void;
  loadUiData(signal?: AbortSignal): Promise<void>;
  dispose(): void;
}

const failure = (code: ErrorCode, message: string): Failure => ({ code, message, retry: 'read_first' });
const errorFrom = (reason: Failure) => Object.assign(new CanvasAgentError(reason.code, reason.message), { requestPhase: 'not_sent' });
const authError = (error: any) => error?.status === 401 || error?.status === 403 || ['USER_SESSION_EXPIRED', 'USER_NOT_LOGIN', -1].includes(error?.code);
const message = (error: any, fallback: string) => typeof error?.message === 'string' ? error.message : typeof error?.msg === 'string' ? error.msg : fallback;

function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal, reason = failure('CANCELLED_BEFORE_DISPATCH', '调用方已停止等待画布准备')): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    // The shared work may have rejected synchronously while revoking authentication.
    void promise.catch(() => undefined);
    return Promise.reject(errorFrom(reason));
  }
  return new Promise<T>((resolve, reject) => {
    const cancel = () => { reject(errorFrom(reason)); };
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}

export function createCanvasContext(canvasId: string, points = createPointStoreApi(() => canvasId, () => ({ silentError: true }))): CanvasContext {
  if (!parseCanvasId(canvasId)) throw errorFrom(failure('INVALID_ARGUMENT', '画布 ID 无效'));
  const contextId = crypto.randomUUID();
  const runs = createCanvasRunTracker(canvasId);
  const guard = createAgentEditGuard(); const barrier = createCanvasVersionBarrier();
  const timers = createCanvasEditorTimers(guard);
  let feedback: NativeUiFeedback | undefined;
  let ownershipController: ReturnType<typeof createWorkflowTabOwnership> | undefined;
  let disposed = false; let authorized = true; let epoch = 0;
  let ownership: 'checking' | 'active' | 'inactive' = 'checking';
  let graphLoaded = false; let loadedWritable = false; let initialized = false; let preparing = false;
  let loadFailure: Failure | undefined;
  let controller = new AbortController();
  let preparation: Promise<void> | null = null; let uiData: Promise<void> | null = null;
  let ownershipPreparation: Promise<void> | null = null;
  let metadata: CanvasMetadata = { name: '', temp: false, thumbnailUrl: '', templateId: 0 };
  const stages: CanvasInitialization = {
    graph: { status: 'idle' }, models: { status: 'idle' }, modelPermission: { status: 'idle' },
    toolPermission: { status: 'idle' }, subscription: { status: 'idle' }, persistence: { status: 'idle' },
    tones: { status: 'idle' }, prices: { status: 'idle' },
  };
  const listeners = new Set<(state: CanvasContextReadiness) => void>();
  const store = createFlowStoreApi({ guard, barrier, requireConfirmedNativeVersion: true, isContextActive: () => !disposed && authorized && ownership === 'active',
    feedback: { error: message => feedback?.error(message), showCapacityLimit: () => feedback?.showCapacityLimit() },
    requestOptions: () => ({ silentError: true, onAuthExpired: invalidateAuth, onCanvasLoadError: () => feedback?.notifyCanvasLoadError() }),
  });
  store.setState({ canvasId, readOnly: true });

  const assertAlive = (expectedEpoch = epoch) => {
    if (disposed || expectedEpoch !== epoch) throw errorFrom(failure('FRAME_GONE', '目标画布上下文已失效'));
    if (!authorized) throw errorFrom(failure('AUTH_REQUIRED', '请在桌面客户端重新登录'));
  };
  const generationReady = () => [stages.models, stages.modelPermission].every(stage => stage.status === 'ready');
  const configurationReady = () => [stages.models, stages.modelPermission, stages.toolPermission].every(stage => stage.status === 'ready');
  const configurationFailure = () => [stages.models, stages.modelPermission, stages.toolPermission].find(stage => stage.error)?.error
    ?? failure('CONFIGURATION_ERROR', '当前没有可用的生成模型配置');
  const hasModels = () => Object.values(store.getState().modelsMap).some(value => Array.isArray(value) && value.length > 0);
  const getInfo = (): ContextInfo => {
    const state = store.getState();
    const version = isTrustedCanvasVersion(state.versionNumber) ? String(state.versionNumber) : null;
    let phase: FrameReadiness['phase'] = preparing ? 'loading' : graphLoaded ? 'ready' : initialized ? 'failed' : 'loading';
    let reason: Failure | undefined = loadFailure;
    if (disposed) { phase = 'disposed'; reason = failure('FRAME_GONE', '目标画布上下文已销毁'); }
    else if (!authorized) { phase = 'failed'; reason = failure('AUTH_REQUIRED', '请在桌面客户端重新登录'); }
    else if (ownership !== 'active' && graphLoaded && !preparing) { phase = 'inactive'; reason = failure('FRAME_INACTIVE', ownershipController?.getReason() ?? '画布尚未获得原生编辑所有权'); }
    else if (!reason && graphLoaded && !preparing) {
      if (state.agentPersistenceIssue) reason = state.agentPersistenceIssue;
      else if (state.versionConflict || barrier.isUncertain()) reason = failure('VERSION_CONFLICT', '画布版本未确认，请权威刷新');
      else if (!version) reason = failure('VERSION_UNAVAILABLE', '画布缺少可信版本');
      else if (!loadedWritable) reason = failure('FRAME_NOT_READY', '获得所有权后需要权威刷新画布');
      else if (!configurationReady() || !hasModels()) reason = configurationFailure();
    }
    const read = graphLoaded && !preparing && !disposed && authorized;
    const edit = read && ownership === 'active' && loadedWritable && version !== null && !loadFailure
      && !state.readOnly && !state.agentPersistenceIssue && !state.versionConflict && !barrier.isUncertain();
    return { canvasId, contextId, readiness: { phase, capabilities: { read, edit, run: edit && generationReady() && hasModels() }, version, ...(reason ? { reason: { ...reason } } : {}) } };
  };
  const publish = () => {
    const snapshot = getInfo().readiness;
    listeners.forEach(listener => {
      try { listener(snapshot); }
      catch (error) { console.error('Canvas readiness subscriber failed:', error); }
    });
  };
  let monitor: ReturnType<typeof createCanvasGenerationMonitor>;
  const unsubscribeStore = store.subscribe(() => { publish(); if (!preparing) monitor?.reconcile(); });
  const invalidateAuth = (event?: Event) => {
    if (disposed || !authorized) return;
    runs.monitoringUnknown({ code: 'AUTH_REQUIRED', message: '登录已失效，生成结果尚未确认', retry: 'never_auto' });
    authorized = false; loadedWritable = false; store.getState().actions.setReadOnly(true); controller.abort(); timers.dispose(); monitor?.stop(); points.getState().actions.resetUserPoint('session-invalidated'); feedback?.notifyAuthExpired(); publish();
    if (!event && typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  };
  if (typeof window !== 'undefined') window.addEventListener(AUTH_EXPIRED_EVENT, invalidateAuth);
  monitor = createCanvasGenerationMonitor(store, barrier, points, invalidateAuth, {
    onObservation: observation => runs.observe(observation),
    onMonitorError: (_error, attempts) => { if (attempts >= 6) runs.monitoringUnknown({ code: 'READ_TIMEOUT', message: '生成结果监控暂不可用，后端状态未确认，请勿再次生成', retry: 'never_auto' }); },
  });
  const options = (): CanvasRequestOptions => ({ signal: controller.signal, silentError: true, onAuthExpired: invalidateAuth, onCanvasLoadError: () => feedback?.notifyCanvasLoadError() });
  const requireCapability = (capability: Capability): ContextInfo => {
    assertAlive();
    const info = getInfo();
    if (!info.readiness.capabilities[capability]) throw errorFrom(info.readiness.reason ?? failure('FRAME_NOT_READY', '画布尚未准备完成'));
    return info;
  };

  async function prepare(reload: boolean): Promise<void> {
    const currentEpoch = ++epoch;
    controller.abort(); controller = new AbortController(); uiData = null;
    preparing = true; loadFailure = undefined; publish();
    const requestOptions = options();
    const savedIssue = store.getState().agentPersistenceIssue;
    const savedConflict = store.getState().versionConflict;
    try {
      stages.graph = { status: 'loading' };
      const row = await loadNativeCanvas(canvasId, requestOptions); assertAlive(currentEpoch);
      stages.graph = { status: 'ready', empty: JSON.parse(row.data).nodes.length === 0 };
      stages.models = stages.modelPermission = stages.toolPermission = { status: 'loading' }; publish();
      const configured = await Promise.allSettled([
        loadNativeModels(requestOptions), loadNativeModelPermission(requestOptions), loadNativeToolPermission(requestOptions),
      ]); assertAlive(currentEpoch);
      const keys = ['models', 'modelPermission', 'toolPermission'] as const;
      configured.forEach((result, index) => {
        const key = keys[index];
        if (result.status === 'fulfilled') stages[key] = { status: 'ready' };
        else {
          if (authError(result.reason)) invalidateAuth();
          stages[key] = { status: 'failed', error: failure('CONFIGURATION_ERROR', message(result.reason, '配置加载失败')) };
        }
      }); assertAlive(currentEpoch);
      const models = configured[0].status === 'fulfilled' ? configured[0].value : null;
      const modelPermission = configured[1].status === 'fulfilled' ? configured[1].value : null;
      const toolPermission = configured[2].status === 'fulfilled' ? configured[2].value : null;
      if (models) stages.models.empty = !Object.values(models.modelsMap).some(value => Array.isArray(value) && value.length > 0);
      stages.subscription = { status: 'loading' }; publish();
      let fallbackMap: Record<string, string> = {};
      try {
        fallbackMap = await fetchSubscriptionModelMap({ signal: controller.signal }); assertAlive(currentEpoch);
        stages.subscription = { status: 'ready', empty: Object.keys(fallbackMap).length === 0 };
      } catch (error) {
        assertAlive(currentEpoch);
        stages.subscription = { status: 'fallback', error: failure('CONFIGURATION_ERROR', message(error, '订阅映射不可用，沿用空映射')) };
      }
      assertAlive(currentEpoch);
      // Optional configuration outages must not block ordinary edits on a confirmed graph.
      // Keep the existing recovery fence when a prior save or polling version is uncertain.
      if (reload && !configurationReady() && (savedIssue || savedConflict || barrier.isUncertain())) throw errorFrom(configurationFailure());
      if (reload && isTrustedCanvasVersion(row.versionNumber)) barrier.consumeUncertain();
      const persist = ownership === 'active' && isTrustedCanvasVersion(row.versionNumber) && configurationReady();
      store.getState().actions.setReadOnly(ownership !== 'active' || !isTrustedCanvasVersion(row.versionNumber));
      store.getState().actions.setModelsMap(models?.modelsMap ?? {});
      store.getState().actions.setModelMaxPromptMap(models?.modelMaxPromptMap ?? {});
      store.getState().actions.setModelNodePermission(modelPermission);
      store.getState().actions.setToolNodePermission(toolPermission);
      stages.persistence = { status: 'loading' };
      // Reset undo history only after authoritative row/configuration validation.
      if (reload) store.setState({ undoStack: [], redoStack: [] });
      stages.graph.replacedSubscriptionModel = store.getState().actions.init(row, configurationReady() ? { modelNodePermission: modelPermission, subscriptionFallbackMap: fallbackMap } : undefined,
        { persistMediaInitialization: persist });
      if ((!configurationReady() || !isTrustedCanvasVersion(row.versionNumber)) && (savedIssue || savedConflict)) {
        store.setState({ agentPersistenceIssue: savedIssue, versionConflict: savedConflict });
      }
      await store.getState().actions.awaitMutationsIdle(); assertAlive(currentEpoch);
      const issue = store.getState().agentPersistenceIssue;
      stages.persistence = issue ? { status: 'failed', error: { ...issue } } : { status: 'ready' };
      if (isTrustedCanvasVersion(row.versionNumber)) runs.observe({ version: String(row.versionNumber), taskStatus: row.taskStatus, nodes: JSON.parse(row.data).nodes });
      graphLoaded = true; loadedWritable = ownership === 'active';
      metadata = { name: row.name, temp: row.temp, thumbnailUrl: row.thumbnailUrl, templateId: row.templateId };
    } catch (error) {
      if (disposed || currentEpoch !== epoch) throw error;
      if (authError(error)) invalidateAuth();
      loadFailure = error instanceof CanvasAgentError ? failure(error.code, error.message)
        : failure('FRAME_NOT_READY', message(error, '画布初始化失败'));
      if (!authorized) loadFailure = failure('AUTH_REQUIRED', '请在桌面客户端重新登录');
      if (stages.graph.status === 'loading') stages.graph = { status: 'failed', error: loadFailure };
      throw errorFrom(loadFailure);
    } finally {
      if (currentEpoch === epoch && !disposed) { preparing = false; initialized = true; publish(); monitor.reconcile(); }
    }
  }

  async function initialize(capability: Capability, signal?: AbortSignal): Promise<ContextInfo> {
    assertAlive();
    if (signal?.aborted) throw errorFrom(failure('CANCELLED_BEFORE_DISPATCH', '调用方已停止等待画布准备'));
    if (!initialized && !preparation) {
      preparation = prepare(false);
      // Every caller owns its wait; only context disposal/auth invalidation aborts shared preparation.
      preparation.catch(() => undefined);
    }
    if (preparation && preparing) {
      try {
        await waitForCaller(waitForCaller(preparation, controller.signal, failure('FRAME_GONE', '画布准备已中止')), signal);
      } catch (error) { assertAlive(); throw error; }
    }
    return requireCapability(capability);
  }

  async function reload(capability: Capability, signal?: AbortSignal): Promise<ContextInfo> {
    assertAlive();
    if (signal?.aborted) throw errorFrom(failure('CANCELLED_BEFORE_DISPATCH', '调用方已停止等待画布准备'));
    if (preparing || store.getState().actions.hasPendingMutations()) throw errorFrom(failure('EDITOR_BUSY', '画布正在准备或保存，请完成后刷新'));
    const operation = guard.run(async () => {
      const release = barrier.beginMutation();
      try {
        await barrier.waitPollingIdle(); assertAlive();
        store.getState().actions.invalidateMediaDimensionRequests(store.getState().nodes.map(node => node.id));
        preparation = prepare(true);
        try { await waitForCaller(preparation, controller.signal, failure('FRAME_GONE', '画布刷新已中止')); }
        catch (error) { assertAlive(); throw error; }
        return requireCapability(capability);
      } finally { release(); }
    }, store.getState().actions.awaitMutationsIdle);
    return waitForCaller(operation, signal);
  }

  async function loadUiData(signal?: AbortSignal): Promise<void> {
    assertAlive();
    if (signal?.aborted) throw errorFrom(failure('CANCELLED_BEFORE_DISPATCH', '调用方已停止等待画布准备'));
    if (!graphLoaded || preparing) throw errorFrom(failure('FRAME_NOT_READY', '请先初始化画布'));
    if (!uiData) {
      const currentEpoch = epoch; const requestOptions = options();
      stages.tones = stages.prices = { status: 'loading' };
      uiData = Promise.allSettled([fetchTone(requestOptions), getAllRule(requestOptions)]).then(results => {
        assertAlive(currentEpoch);
        results.forEach((result, index) => {
          const key = index === 0 ? 'tones' : 'prices';
          if (result.status === 'fulfilled' && result.value.code === 'SUCCESS' && Array.isArray(result.value.data)) {
            const data = result.value.data;
            if (index === 0) store.getState().actions.setCustomToneList(data.map((item: any) => ({ value: item.voiceId, label: item.name })));
            else store.getState().actions.setPointList(data);
            stages[key] = { status: 'ready', empty: data.length === 0 };
          } else {
            const error = result.status === 'rejected' ? result.reason : result.value;
            if (authError(error)) invalidateAuth();
            stages[key] = { status: 'failed', error: failure('CONFIGURATION_ERROR', message(error, '辅助配置加载失败')) };
          }
        }); assertAlive(currentEpoch); publish();
      });
    }
    return waitForCaller(uiData, signal);
  }

  return {
    canvasId, contextId, store, guard, barrier, points, timers, monitor, runs, getRun: runs.get, subscribeRun: runs.subscribe, requestOptions: options, initialize, reload, getInfo, loadUiData,
    setFeedback: value => { feedback = value; },
    acquireOwnership: async (explicit = false) => {
      assertAlive();
      if (ownershipPreparation) return ownershipPreparation;
      ownershipPreparation = (async () => {
        const wasInactive = ownershipController?.getStatus() === 'inactive';
        ownershipController ??= createWorkflowTabOwnership(canvasId, status => {
          ownership = status;
          if (status !== 'active') { loadedWritable = false; store.getState().actions.setReadOnly(true); }
          publish();
        }, true, () => {
          const state = store.getState();
          if (preparing || guard.isOperationBusy() || state.actions.hasPendingMutations() || state.agentPersistenceIssue || state.versionConflict || barrier.isUncertain()) return false;
          try { guard.assertOperationActive(); return true; } catch { return false; }
        });
        await ownershipController.ready;
        if (explicit) await ownershipController.claim();
        else if (wasInactive) await ownershipController.recheck();
        assertAlive();
        const state = store.getState();
        if (ownership === 'active' && graphLoaded && !loadedWritable && !preparing && !state.agentPersistenceIssue && !state.versionConflict && !barrier.isUncertain()) await reload('read');
      })().finally(() => { ownershipPreparation = null; });
      return ownershipPreparation;
    },
    getCanvasMetadata: () => { assertAlive(); return { ...metadata }; },
    getInitialization: () => Object.fromEntries(Object.entries(stages).map(([key, stage]) => [key, { ...stage, ...(stage.error ? { error: { ...stage.error } } : {}) }])) as CanvasInitialization,
    subscribeReadiness: listener => {
      listener(getInfo().readiness);
      if (disposed) return () => undefined;
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    setOwnership: status => {
      assertAlive(); ownership = status;
      if (status !== 'active') { loadedWritable = false; store.getState().actions.setReadOnly(true); }
      publish();
    },
    dispose: () => {
      if (disposed) return;
      runs.dispose(); disposed = true; epoch++; controller.abort(); timers.dispose(); monitor.stop();
      const idle = store.getState().actions.awaitMutationsIdle();
      void idle.then(() => ownershipController?.dispose(), () => ownershipController?.dispose());
      guard.dispose(); unsubscribeStore(); feedback = undefined;
      if (typeof window !== 'undefined') window.removeEventListener(AUTH_EXPIRED_EVENT, invalidateAuth);
      store.getState().actions.reset(); publish(); listeners.clear();
    },
  };
}
