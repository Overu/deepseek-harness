import type { Node } from '@xyflow/react';
import { CanvasAgentError, type Failure, type GenerationCounts } from '../../src/shared/canvas-agent-protocol';
import { parseCanvasRunState, type CanvasRunState } from '../../src/shared/canvas-run-protocol';

export interface CanvasRunObservation { version: string; taskStatus: string; nodes: Node[] }
interface RunEntry {
  nodeId: string; generation: GenerationCounts; baselineTaskId?: string; acceptedVersion?: string;
  external?: boolean; baselineOutputs: string[]; observedTaskId?: string; observedRunning: boolean; state?: CanvasRunState;
}
const taskId = (node?: Node): string | undefined => {
  const value = (node?.data.taskInfo as { taskId?: unknown } | undefined)?.taskId;
  return typeof value === 'string' && value.trim() && value.length <= 200 ? value : undefined;
};
const outputs = (node?: Node): string[] => [...new Set([node?.data.value,
  ...(Array.isArray(node?.data.product) ? node!.data.product.map(item => item && typeof item === 'object' ? item.value : undefined) : [])]
  .filter((value): value is string => {
    if (typeof value !== 'string' || value.length > 4096) return false;
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      && ![...url.searchParams.keys()].some(key => /^(token|access_token|authorization|bridgekey)$/i.test(key)); } catch { return false; }
  }))].slice(0, 20);
const atLeast = (version: string, minimum: string): boolean => /^\d+$/.test(version) && /^\d+$/.test(minimum)
  ? BigInt(version) >= BigInt(minimum) : version === minimum;
const terminal = (phase: CanvasRunState['phase']) => phase === 'completed' || phase === 'failed';

/** Client-owned run identity; never interpret local UI failure or existing outputs as this run's result. */
export function createCanvasRunTracker(canvasId: string) {
  const runs = new Map<string, RunEntry>();
  const listeners = new Map<string, Set<(state: CanvasRunState) => void>>();
  let disposed = false;
  let lastObservation: CanvasRunObservation | undefined;
  const replay = (entry: RunEntry) => { if (lastObservation && entry.acceptedVersion && atLeast(lastObservation.version, entry.acceptedVersion)) observe(lastObservation); };
  const emit = (requestId: string, entry: RunEntry, patch: Partial<CanvasRunState>) => {
    if (disposed) return;
    const previous = entry.state;
    const candidate = { requestId, canvasId, nodeId: entry.nodeId, generation: entry.generation,
      version: previous?.version ?? null, outputs: [], ...previous, ...patch, sequence: (previous?.sequence ?? 0) + 1 };
    const next = parseCanvasRunState(Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined)));
    const comparable = (state: CanvasRunState) => JSON.stringify({ ...state, sequence: 0 });
    if (previous && comparable(previous) === comparable(next)) return;
    entry.state = next;
    listeners.get(requestId)?.forEach(listener => { try { listener(structuredClone(next)); } catch (error) { console.error('Canvas run subscriber failed:', error); } });
  };
  function observe(observation: CanvasRunObservation) {
    if (!lastObservation || atLeast(observation.version, lastObservation.version)) lastObservation = structuredClone(observation);
    runs.forEach((entry, requestId) => {
      if (entry.external) return;
      const state = entry.state;
      if (!state || terminal(state.phase) || !entry.acceptedVersion || !atLeast(observation.version, entry.acceptedVersion) || (state.version && !atLeast(observation.version, state.version))) return;
      const node = observation.nodes.find(item => item.id === entry.nodeId);
      if (!node) {
        emit(requestId, entry, { phase: 'monitoring_unknown', version: observation.version,
          error: { code: 'NODE_NOT_FOUND', message: '生成目标已不在权威画布中，结果未确认', retry: 'never_auto' } }); return;
      }
      const currentTaskId = taskId(node);
      const status = (node.data.taskInfo as { status?: string; errorMsg?: string } | undefined)?.status;
      const correlated = !!currentTaskId && (currentTaskId === state.workflowTaskId || currentTaskId !== entry.baselineTaskId);
      if (entry.observedTaskId && currentTaskId && currentTaskId !== entry.observedTaskId) {
        emit(requestId, entry, { phase: 'monitoring_unknown', version: observation.version,
          error: { code: 'SUBMISSION_UNKNOWN', message: '目标节点已切换到另一任务，本次结果未确认', retry: 'never_auto' } }); return;
      }
      if (correlated) entry.observedTaskId = currentTaskId;
      // Only an authoritative running observation proves a transition without a task ID.
      if (status === 'running' && (correlated || !currentTaskId)) entry.observedRunning = true;
      if (!correlated && (!entry.observedRunning || !!currentTaskId)) {
        if (observation.taskStatus !== 'RUNNING') emit(requestId, entry, { phase: 'monitoring_unknown', version: observation.version,
          error: { code: 'SUBMISSION_UNKNOWN', message: '权威快照尚不能关联本次生成结果，请勿再次生成', retry: 'never_auto' } });
        return;
      }
      const ids = entry.observedTaskId ? { nodeTaskId: entry.observedTaskId } : {};
      if (status === 'running') {
        emit(requestId, entry, { phase: 'running', version: observation.version, ...ids, error: undefined });
        return;
      }
      if (status === 'success') {
        const result = outputs(node).filter(url => !entry.baselineOutputs.includes(url));
        if (result.length && (correlated || entry.observedRunning)) emit(requestId, entry, { phase: 'completed', version: observation.version, ...ids, outputs: result, error: undefined });
        else emit(requestId, entry, { phase: 'monitoring_unknown', version: observation.version, ...ids,
          error: { code: 'SUBMISSION_UNKNOWN', message: '任务成功状态缺少可信产物，结果未确认', retry: 'never_auto' } });
      }
      if (status === 'failure' || status === 'interrupt' || status === 'fakeInterrupt') {
        const rawMessage = (node.data.taskInfo as { errorMsg?: unknown } | undefined)?.errorMsg;
        const message = typeof rawMessage === 'string' && rawMessage.trim() ? rawMessage.slice(0, 32768) : status === 'failure' ? '生成任务失败' : '生成任务已中断';
        emit(requestId, entry, { phase: 'failed', version: observation.version, ...ids, outputs: outputs(node).filter(url => !entry.baselineOutputs.includes(url)),
          error: { code: 'RUN_REJECTED', message, retry: 'user_decision' } });
      }
    });
  }
  const assertNodeAvailable = (nodeId: string) => {
    const entry = [...runs.values()].find(run => run.nodeId === nodeId && (!run.state || !terminal(run.state.phase)));
    if (!entry) return;
    const uncertain = entry.state?.phase === 'submission_unknown' || entry.state?.phase === 'monitoring_unknown';
    throw Object.assign(new CanvasAgentError(uncertain ? 'SUBMISSION_UNKNOWN' : 'NODE_BUSY', uncertain
      ? '该节点前一次生成结果尚未确认，请先权威读取核对，不能再次提交' : '该节点已有待完成的生成任务，请先等待结果'), { requestPhase: 'not_sent' });
  };
  return {
    assertNodeAvailable,
    beginProcess(requestId: string, node: Node, generation: GenerationCounts) {
      if (disposed || runs.has(requestId) || runs.size >= 1024) throw new CanvasAgentError('DUPLICATE_REQUEST_MISMATCH', '处理请求不可重复登记');
      assertNodeAvailable(node.id);
      runs.set(requestId, { nodeId: node.id, generation, baselineOutputs: [], observedRunning: false, external: true });
    },
    publishProcess(requestId: string, patch: Partial<CanvasRunState>) {
      const entry = runs.get(requestId);
      if (!entry?.external || disposed) return;
      emit(requestId, entry, patch);
    },
    begin(requestId: string, node: Node, generation: GenerationCounts) {
      if (disposed) throw new CanvasAgentError('CONTEXT_GONE', '生成任务上下文已释放');
      if (runs.has(requestId)) throw new CanvasAgentError('DUPLICATE_REQUEST_MISMATCH', '生成请求已存在，不允许再次提交');
      assertNodeAvailable(node.id);
      if (runs.size >= 1024) throw new CanvasAgentError('BRIDGE_OVERLOADED', '生成任务记录已达上限');
      runs.set(requestId, {
        nodeId: node.id,
        generation: { ...generation },
        baselineTaskId: taskId(node),
        baselineOutputs: outputs(node),
        observedRunning: false,
      });
    },
    beginMany(entries: Array<{ requestId: string; node: Node; generation: GenerationCounts }>) {
      if (disposed) throw new CanvasAgentError('CONTEXT_GONE', '生成任务上下文已释放');
      if (runs.size + entries.length > 1024) throw new CanvasAgentError('BRIDGE_OVERLOADED', '生成任务记录已达上限');
      const requestIds = new Set(entries.map(entry => entry.requestId));
      if (requestIds.size !== entries.length || entries.some(entry => runs.has(entry.requestId))) throw new CanvasAgentError('DUPLICATE_REQUEST_MISMATCH', '生成请求已存在，不允许再次提交');
      const nodeIds = new Set(entries.map(entry => entry.node.id));
      if (nodeIds.size !== entries.length) throw new CanvasAgentError('INVALID_ARGUMENT', '批量生成节点不能重复');
      entries.forEach(entry => assertNodeAvailable(entry.node.id));
      entries.forEach(({ requestId, node, generation }) => runs.set(requestId, {
        nodeId: node.id, generation: { ...generation }, baselineTaskId: taskId(node), baselineOutputs: outputs(node), observedRunning: false,
      }));
    },
    submitted(requestId: string, workflowTaskId: string, version: string) {
      const entry = runs.get(requestId); if (!entry) return;
      entry.acceptedVersion = version;
      emit(requestId, entry, { phase: 'submitted', workflowTaskId, version, outputs: [] });
      replay(entry);
    },
    unknown(requestId: string, version: string | null, workflowTaskId?: string) {
      const entry = runs.get(requestId); if (!entry) return;
      entry.acceptedVersion = version ?? undefined;
      emit(requestId, entry, { phase: 'submission_unknown', version, ...(workflowTaskId ? { workflowTaskId } : {}),
        error: { code: 'SUBMISSION_UNKNOWN', message: '生成提交结果未确认，不允许自动再次提交', retry: 'never_auto' } });
    },
    discard(requestId: string) { runs.delete(requestId); },
    observe,
    monitoringUnknown(error: Failure) { runs.forEach((entry, requestId) => { if (entry.state && !terminal(entry.state.phase)) emit(requestId, entry, { phase: 'monitoring_unknown', error }); }); },
    get(requestId: string): CanvasRunState | null { const state = runs.get(requestId)?.state; return state ? structuredClone(state) : null; },
    subscribe(requestId: string, listener: (state: CanvasRunState) => void) {
      if (disposed) return () => undefined;
      let set = listeners.get(requestId);
      if (!set) { if (listeners.size >= 1024) throw new CanvasAgentError('BRIDGE_OVERLOADED', '生成任务订阅已达上限'); set = new Set(); listeners.set(requestId, set); }
      set.add(listener); const state = runs.get(requestId)?.state; if (state) listener(structuredClone(state));
      return () => { set!.delete(listener); if (!set!.size) listeners.delete(requestId); };
    },
    dispose() { if (disposed) return; runs.forEach((entry, requestId) => { if (entry.state && !terminal(entry.state.phase)) emit(requestId, entry, { phase: 'monitoring_unknown',
      error: { code: 'CONTEXT_GONE', message: '客户端生成监控已释放，后端结果尚未确认', retry: 'never_auto' } }); }); disposed = true; listeners.clear(); runs.clear(); },
  };
}
