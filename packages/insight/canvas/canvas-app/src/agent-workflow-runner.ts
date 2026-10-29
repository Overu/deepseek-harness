import type { Node } from '@xyflow/react';
import { CanvasAgentError, type ErrorCode, type GenerationCounts } from '../../src/shared/canvas-agent-protocol';
import { isTrustedCanvasVersion } from './canvas-initialization';
import { validateAgentRunInputs, getAgentGenerationCounts } from './agent-node-policy';
import util from '../legacy/src/components/canvasFlow/utils/util';
import toolUtil from '../legacy/src/components/canvasFlow/utils/toolUtil';
import { excuteWorkFlow } from '../legacy/src/api/workflow';
import type { CanvasContext } from './canvas-context';
import { sameGenerationCounts } from '../../src/shared/canvas-generation-counts';
import { verifyAgentAudioVoice } from './canvas-voices';

const { isAllowRun } = util;
const { isAllowCapacity, getEdgesByNodes, getSourceNodesAndEdges } = toolUtil;

export interface WorkflowRunInput {
  expectedVersion: string;
  nodeIds: string[];
  approvedGenerations: Record<string, GenerationCounts>;
}

const notSent = (code: ErrorCode, message: string) =>
  Object.assign(new CanvasAgentError(code, message), { requestPhase: 'not_sent' as const });

export async function executeAgentWorkflowBatch(
  context: CanvasContext,
  workflow: WorkflowRunInput,
  options: { signal?: AbortSignal } = {}
): Promise<{ taskId: string; versionNumber: string | number }> {
  if (options.signal?.aborted) throw notSent('CANCELLED_BEFORE_DISPATCH', '调用已取消，尚未发送');

  const checkTargets = (state: ReturnType<CanvasContext['store']['getState']>) => {
    if (state.canvasId !== context.canvasId) throw notSent('FRAME_GONE', '目标画布已切换');
    if (state.readOnly) throw notSent('READ_ONLY', '画布不可编辑');
    if (state.agentPersistenceIssue) throw notSent(state.agentPersistenceIssue.code, state.agentPersistenceIssue.message);
    if (state.versionConflict) throw notSent('VERSION_CONFLICT', '画布版本未确认，请重新加载');
    if (state.versionNumber === undefined || state.versionNumber === null) throw notSent('VERSION_UNAVAILABLE', '画布缺少版本');
    if (String(state.versionNumber) !== workflow.expectedVersion) throw notSent('VERSION_CONFLICT', '画布已发生变化');

    const targets: Node[] = [];
    for (const id of workflow.nodeIds) {
      const node = state.nodes.find(n => n.id === id);
      if (!node) throw notSent('NODE_NOT_FOUND', `目标节点不存在：${id}`);
      if ((node.data?.taskInfo as { status?: string } | undefined)?.status === 'running') {
        throw notSent('NODE_BUSY', '目标节点正在生成，请完成后再修改或执行');
      }
      validateAgentRunInputs(state, node);
      const actual = getAgentGenerationCounts(state, node);
      const approved = workflow.approvedGenerations[node.id];
      if (!approved || !actual || !sameGenerationCounts(actual, approved)) {
        throw notSent('COUNT_CHANGED', '生成数量或参数已变化，请重新预检');
      }
      targets.push(node);
    }
    return targets;
  };

  const initial = context.store.getState();
  const initialTargets = checkTargets(initial);
  const audioParams = new Map(initialTargets.filter(node => node.type === 'audio').map(node => [node.id, JSON.stringify(node.data.params)]));

  return await context.guard.run(async () => {
    for (const node of initialTargets) if (node.type === 'audio') await verifyAgentAudioVoice(context, initial, node, options.signal);
    const capacity = () => isAllowCapacity(
      () => undefined,
      { ...context.requestOptions(), signal: options.signal, silentError: true, receiptMode: 'agent' }
    );
    const initialEdges = getEdgesByNodes(initialTargets, initial.edges);
    let allowRunResult: Awaited<ReturnType<typeof isAllowRun>>;
    try {
      allowRunResult = await isAllowRun(
        initialTargets,
        initialEdges,
        initial.modelMaxPromptMap,
        initial.nodes,
        initial.edges,
        'total',
        initial.modelNodePermission,
        '',
        initial.modelsMap,
        capacity
      );
    } catch (error) {
      // A failed capacity/read check cannot make the later workflow invocation uncertain.
      if (options.signal?.aborted) throw notSent('CANCELLED_BEFORE_DISPATCH', '调用已取消，尚未发送');
      throw Object.assign(error instanceof Error ? error : new Error('工作流执行预检失败'), { requestPhase: 'not_sent' as const });
    }
    if (!allowRunResult?.isAllow) {
      const msg = typeof allowRunResult?.message === 'string'
        ? allowRunResult.message
        : (allowRunResult?.message as any)?.content || (allowRunResult as any)?.content || '工作流未通过原生执行检查';
      throw notSent('RUN_REJECTED', msg);
    }

    if (options.signal?.aborted) throw notSent('CANCELLED_BEFORE_DISPATCH', '调用已取消，尚未发送');

    const releaseBarrier = context.barrier.beginMutation();
    try {
      await context.barrier.waitPollingIdle();
      if (context.barrier.consumeUncertain()) {
        context.store.setState({ versionConflict: true });
        throw notSent('VERSION_CONFLICT', '轮询后的画布版本未确认');
      }
      context.guard.assertOperationActive();

      const latest = context.store.getState();
      const latestTargets = checkTargets(latest);
      if (audioParams.size && (latest.modelsMap !== initial.modelsMap || latest.modelNodePermission !== initial.modelNodePermission
        || latest.nodes !== initial.nodes || latest.edges !== initial.edges
        || latestTargets.some(node => audioParams.has(node.id) && audioParams.get(node.id) !== JSON.stringify(node.data.params)))) {
        throw notSent('VERSION_CONFLICT', '音色检查后画布或模型配置已变化，请重新读取');
      }
      const excuteEdges = getEdgesByNodes(latestTargets, latest.edges);
      const { sourceNodes, relateEdges } = getSourceNodesAndEdges(latest.nodes, latestTargets, latest.edges);
      const params = {
        canvasId: latest.canvasId,
        workflowData: {
          nodes: latestTargets.concat(sourceNodes),
          edges: excuteEdges.concat(relateEdges),
        },
        executeStrategy: 'total' as const,
        versionNumber: latest.versionNumber,
      };

      const response: any = await excuteWorkFlow(params, {
        ...context.requestOptions(),
        receiptMode: 'agent',
        signal: options.signal,
      });

      const isSuccess = (response?.code === 'SUCCESS' || response?.code === 200 || String(response?.code) === '0')
        || (response?.type === 'success');
      if (!isSuccess) {
        const msg = typeof response?.msg === 'string' ? response.msg
          : typeof response?.message === 'string' ? response.message
          : (response as any)?.content || '工作流未通过原生执行检查';
        throw notSent('RUN_REJECTED', msg);
      }

      const version = response?.versionNumber ?? response?.data?.versionNumber;
      const validVersion = isTrustedCanvasVersion(version);
      const rawTaskId = typeof response?.taskId === 'string' ? response.taskId : response?.data?.taskId;
      const taskId = typeof rawTaskId === 'string' && rawTaskId.trim().length > 0 && rawTaskId.trim().length <= 200
        ? rawTaskId.trim()
        : '';

      if (!validVersion || !taskId || latest.canvasId !== context.canvasId) {
        for (const targetId of workflow.nodeIds) latest.actions.updateNodeStatus(targetId, 'running');
        latest.actions.setStatus('RUNNING');
        throw Object.assign(
          new CanvasAgentError('SUBMISSION_UNKNOWN', '执行已接受，但任务 ID 或版本不完整'),
          { requestPhase: 'sent_unknown' as const, raw: response }
        );
      }

      latest.actions.setVersionNumber(version);
      latest.actions.setStatus('RUNNING');
      for (const targetId of workflow.nodeIds) latest.actions.updateNodeStatus(targetId, 'running');

      return { taskId, versionNumber: version };
    } catch (error: any) {
      if (error?.raw?.__accepted) {
        const cur = context.store.getState();
        workflow.nodeIds.forEach(id => cur.actions.updateNodeStatus(id, 'running'));
        cur.actions.setStatus('RUNNING');
      }
      throw error;
    } finally {
      releaseBarrier();
    }
  }, () => context.store.getState().actions.awaitMutationsIdle());
}
