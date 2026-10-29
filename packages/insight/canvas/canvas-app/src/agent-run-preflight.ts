import { CanvasAgentError, type CanvasOperation, type RunPreflightReceipt, type ErrorCode } from '../../src/shared/canvas-agent-protocol';
import type { CanvasContext } from './canvas-context';
import { getAgentGenerationCounts, validateAgentRunInputs } from './agent-node-policy';
import { canRunAgentGeneration } from './agent-generation-policy';
import { verifyAgentAudioVoice } from './canvas-voices';
import util from '../legacy/src/components/canvasFlow/utils/util';
import { buildSingleWorkflowPayload } from '../legacy/src/store/flowStoreCore';
import { calculateSingleWorkflowCost } from '../legacy/src/components/canvasFlow/utils/workflowCost';

/** Read-only generation preparation on the same guarded native graph used for submission. */
export async function preflightCanvasNode(context: CanvasContext, preflight: Extract<CanvasOperation, { action: 'node.preflight' }>, signal?: AbortSignal): Promise<RunPreflightReceipt> {
  function fail(code: ErrorCode, message: string): never { throw Object.assign(new CanvasAgentError(code, message), { requestPhase: 'not_sent' }); }
  const version = () => String(context.store.getState().versionNumber);
  return await context.guard.run<RunPreflightReceipt>(async () => {
    const current = context.store.getState();
    if (version() !== preflight.expectedVersion) fail('VERSION_CONFLICT', '画布版本已变化，请重新读取后预检');
    if (current.agentPersistenceIssue || current.versionConflict || context.barrier.isUncertain()) fail('VERSION_CONFLICT', '画布保存或任务版本尚未确认');
    const node = current.nodes.find(item => item.id === preflight.nodeId);
    if (!node) fail('NODE_NOT_FOUND', '目标节点不存在');
    context.runs.assertNodeAvailable(node.id);
    if (!canRunAgentGeneration(node)) fail('UNSUPPORTED_NODE', '公开生成只支持普通图片、视频或配音、文生音乐、音乐参考节点');
    if ((node.data.taskInfo as { status?: string } | undefined)?.status === 'running') fail('NODE_BUSY', '目标节点正在生成');
    const stages = context.getInitialization();
    if ([stages.models, stages.modelPermission].some(stage => stage.status !== 'ready')) fail('CONFIGURATION_ERROR', '模型或权限配置尚未就绪');
    validateAgentRunInputs(current, node);
    const generation = getAgentGenerationCounts(current, node);
    if (!generation) fail('RUN_REJECTED', '生成参数或数量不合法');
    if (node.type === 'audio') await verifyAgentAudioVoice(context, current, node, signal);
    const payload = buildSingleWorkflowPayload(context.canvasId, current.nodes, current.edges, node.id);
    const allowed = await util.isAllowRun(payload.workflowData.nodes, payload.workflowData.edges, current.modelMaxPromptMap,
      current.nodes, current.edges, 'single', current.modelNodePermission, node.id, current.modelsMap, async () => true);
    if (!allowed.isAllow) fail('RUN_REJECTED', allowed.message.content || '当前节点不能生成');
    let quote;
    try { quote = await calculateSingleWorkflowCost(payload, { ...context.requestOptions(), ...(signal ? { signal } : {}), receiptMode: 'agent', silentError: true }); }
    catch (error) { throw Object.assign(error instanceof Error ? error : new Error('预估赛点消耗失败'), { requestPhase: 'not_sent' }); }
    context.guard.assertOperationActive();
    const ready = context.getInfo().readiness;
    if (!ready.capabilities.run) fail(ready.reason?.code ?? 'CONTEXT_NOT_READY', ready.reason?.message ?? '画布生成服务暂不可用');
    if (signal?.aborted) fail('CANCELLED_BEFORE_DISPATCH', '调用已取消，尚未生成');
    const latest = context.store.getState();
    if (version() !== preflight.expectedVersion || latest.nodes !== current.nodes || latest.edges !== current.edges
      || latest.modelsMap !== current.modelsMap || latest.modelNodePermission !== current.modelNodePermission) fail('VERSION_CONFLICT', '预检期间画布或模型配置发生变化，请重新读取');
    return { status: 'preflight', canvasId: context.canvasId, version: preflight.expectedVersion, nodeId: node.id, generation, quote };
  }, context.store.getState().actions.awaitMutationsIdle);
}
