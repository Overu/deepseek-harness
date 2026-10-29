import { preflightProcess, startProcess, readProcessCapabilities } from './canvas-process';
import { CanvasAgentError, parseCanvasOperation, assertCanvasMessageSize, MAX_NODE_IDS, isCanvasReadOperation,
  type CanvasOperation, type CanvasOperationResult, type Failure, type ErrorCode, type NodePlacement, type NodeDraft, type CanvasAssetInput } from '../../src/shared/canvas-agent-protocol';
import { layoutSelectedNodes } from '../legacy/src/components/canvasFlow/utils/autoLayout';
import { preflightCanvasNode } from './agent-run-preflight';
import type { CanvasContext } from './canvas-context';
import { createAgentNode, createAgentAssetNode, describeAgentNode, resolveAgentNodePatch, getAgentGenerationCounts, validateAgentRunInputs } from './agent-node-policy';
import { isTrustedCanvasVersion } from './canvas-initialization';
import { isNonGenerativeMedia } from '../legacy/src/components/canvasFlow/utils/type';
import { STANDARD_NODE_TYPES } from '../../src/shared/canvas-agent-protocol';
import { readAgentGraph } from './agent-graph-read';
import { readAgentModels, resolveAgentNodeConfiguration, getAgentInputCompatibility } from './agent-model-policy';
import { executeAgentWorkflowBatch } from './agent-workflow-runner';
import type { Node } from '@xyflow/react';
import { canRunAgentGeneration } from './agent-generation-policy';
import { readAgentVoices, verifyAgentAudioVoice } from './canvas-voices';
import { agentAudioConfigurationKey } from './agent-audio-policy';

const placementFor = (input: NodeDraft | CanvasAssetInput): NodePlacement => input.placement
  ?? (input.position ? { mode: 'absolute', position: input.position } : { mode: 'auto' });

export function createCanvasAgentAdapter(context: CanvasContext) {
  const version = () => { const value = context.store.getState().versionNumber; return isTrustedCanvasVersion(value) ? String(value) : null; };
  function fail(code: ErrorCode, message: string): never { throw Object.assign(new CanvasAgentError(code, message), { requestPhase: 'not_sent' }); }
  const supported = (node: { type?: string; data: Record<string, unknown> }) => STANDARD_NODE_TYPES.some(type => type === node.type) && !isNonGenerativeMedia(String(node.data.type ?? ''));
  const requireConfiguration = () => {
    const stages = context.getInitialization();
    if ([stages.models, stages.modelPermission].some(stage => stage.status !== 'ready')) fail('CONFIGURATION_ERROR', '模型或权限配置加载失败，请刷新后重试');
  };
  return {
    async execute(input: CanvasOperation, signal?: AbortSignal, requestId?: string): Promise<CanvasOperationResult> {
      let operation = input;
      let runRequestId: string | undefined;
      let batchRunRequestIds: string[] = [];
      try {
        operation = structuredClone(parseCanvasOperation(input));
        if (signal?.aborted) fail('CANCELLED_BEFORE_DISPATCH', '调用已取消，尚未执行');
        await context.initialize(operation.action === 'node.run' || operation.action === 'workflow.run' || operation.action === 'node.preflight' || operation.action === 'process.preflight' || operation.action === 'process.run' ? 'run' : isCanvasReadOperation(operation) ? 'read' : 'edit', signal);
        const state = context.store.getState();
        const snapshotVersion = version();
        const consistency = () => !snapshotVersion || context.store.getState() !== state || state.actions.hasPendingMutations()
          || context.guard.isEditorBusy() || context.guard.isOperationBusy() || state.agentPersistenceIssue
          || state.versionConflict || context.barrier.isUncertain() ? 'unconfirmed' as const : 'confirmed' as const;
        if (operation.action === 'canvas.capabilities.read') return readProcessCapabilities(context, operation.kind, operation.model);
        if (operation.action === 'process.preflight') return await preflightProcess(context, operation, operation.expectedVersion, signal);
        if (operation.action === 'process.run') return await startProcess(context, operation.planId, operation.nodeId, operation.expectedVersion, operation.approvedGeneration, requestId ?? crypto.randomUUID());
        if (operation.action === 'canvas.open') fail('INVALID_ARGUMENT', '导航只能由 Client 视图控制器执行');
        if (operation.action === 'canvas.read') {
          const ids = operation.nodeIds ?? state.nodes.slice(0, MAX_NODE_IDS).map(node => node.id);
          const result: CanvasOperationResult = { status: 'read', canvasId: context.canvasId, version: snapshotVersion,
            consistency: consistency(),
            nodeCount: state.nodes.length, nodes: ids.flatMap(id => { const node = state.nodes.find(item => item.id === id); return node ? [describeAgentNode(state, node)] : []; }),
            missingNodeIds: ids.filter(id => !state.nodes.some(node => node.id === id)) };
          assertCanvasMessageSize(result); return result;
        }
        if (operation.action === 'canvas.graph.read') {
          if (operation.expectedVersion !== undefined) {
            if (!snapshotVersion || consistency() !== 'confirmed') fail('VERSION_UNAVAILABLE', '图结构尚未确认，请等待保存完成后重新读取第一页');
            if (operation.expectedVersion !== snapshotVersion) fail('VERSION_CONFLICT', '图结构版本已变化，请从第一页重新读取');
          }
          const result: CanvasOperationResult = { status: 'graph', canvasId: context.canvasId,
            version: snapshotVersion, consistency: consistency(), ...readAgentGraph(state, operation) };
          assertCanvasMessageSize(result); return result;
        }
        if (operation.action === 'canvas.models.read') {
          requireConfiguration();
          const catalog = await readAgentModels(state, operation);
          if (signal?.aborted) fail('CANCELLED_BEFORE_DISPATCH', '读取已取消');
          const result: CanvasOperationResult = { status: 'models', canvasId: context.canvasId,
            version: snapshotVersion, consistency: consistency(), ...catalog };
          assertCanvasMessageSize(result); return result;
        }
        if (operation.action === 'canvas.voices.read') {
          requireConfiguration();
          const catalog = await readAgentVoices(context, state, operation, signal);
          if (signal?.aborted) fail('CANCELLED_BEFORE_DISPATCH', '读取已取消');
          const result: CanvasOperationResult = { status: 'voices', canvasId: context.canvasId, version: snapshotVersion, consistency: consistency(), ...catalog };
          assertCanvasMessageSize(result); return result;
        }
        if (operation.action === 'node.preflight') return await preflightCanvasNode(context, operation, signal);
        if (signal?.aborted) fail('CANCELLED_BEFORE_DISPATCH', '调用已取消，尚未执行');
        const options = { expectedVersion: operation.expectedVersion, strictReceipt: true as const, signal };
        if (operation.action === 'node.run') {
          const targetId = operation.nodeId;
          const node = state.nodes.find(node => node.id === targetId);
          if (!node) fail('NODE_NOT_FOUND', '目标节点不存在');
          if (!supported(node)) fail('UNSUPPORTED_NODE', '本期只开放普通节点单点执行');
          requireConfiguration();
          validateAgentRunInputs(state, node);
          const approvedAudioConfig = node.type === 'audio' ? agentAudioConfigurationKey(state, node) : undefined;
          if (node.type === 'audio') {
            if (snapshotVersion !== operation.expectedVersion) fail('VERSION_CONFLICT', '画布已发生变化');
            if (context.guard.isEditorBusy()) fail('EDITOR_BUSY', '用户正在编辑，请完成后再生成');
            await verifyAgentAudioVoice(context, state, node, signal);
            const latest = context.store.getState();
            if (latest.nodes !== state.nodes || latest.edges !== state.edges || version() !== operation.expectedVersion
              || latest.modelsMap !== state.modelsMap || latest.modelNodePermission !== state.modelNodePermission) fail('VERSION_CONFLICT', '音色检查期间画布或模型配置已变化，请重新读取');
          }
          if (canRunAgentGeneration(node)) {
            runRequestId = requestId ?? crypto.randomUUID();
            context.runs.begin(runRequestId, node, operation.approvedGeneration);
          }
          const response = await state.actions.excuteSingle(operation.nodeId, { ...options, strictTransportErrors: true, approvedGeneration: operation.approvedGeneration, ...(approvedAudioConfig === undefined ? {} : { approvedAudioConfig }) });
          if (response.type !== 'success') fail('RUN_REJECTED', response.content || '当前节点未通过原生执行检查');
          void context.points.getState().actions.updateUserPoint();
          if (typeof response.taskId !== 'string' || !response.taskId.trim() || response.taskId.length > 200 || !isTrustedCanvasVersion(response.versionNumber)) {
            throw Object.assign(new CanvasAgentError('SUBMISSION_UNKNOWN', '执行已接受，但任务 ID 或版本不完整'), { requestPhase: 'sent_unknown', raw: response });
          }
          if (runRequestId) context.runs.submitted(runRequestId, response.taskId, String(response.versionNumber));
          return { status: 'submitted', canvasId: context.canvasId, version: String(response.versionNumber), nodeId: operation.nodeId, taskId: response.taskId, generation: operation.approvedGeneration };
        }
        if (operation.action === 'workflow.run') {
          const workflow = operation;
          if (String(state.versionNumber) !== workflow.expectedVersion) fail('VERSION_CONFLICT', '画布已发生变化');
          if (state.readOnly) fail('READ_ONLY', '画布不可编辑');
          if (state.agentPersistenceIssue) fail(state.agentPersistenceIssue.code, state.agentPersistenceIssue.message);
          const targetIds = workflow.nodeIds;
          const targetNodes: Node[] = [];
          for (const targetId of targetIds) {
            const node = state.nodes.find(n => n.id === targetId);
            if (!node) fail('NODE_NOT_FOUND', `目标节点不存在：${targetId}`);
            if (!supported(node)) fail('UNSUPPORTED_NODE', '批量工作流生成仅支持普通节点');
            if ((node.data.taskInfo as { status?: string } | undefined)?.status === 'running') fail('NODE_BUSY', '目标节点正在生成，请完成后再修改或执行');
            validateAgentRunInputs(state, node);
            targetNodes.push(node);
          }
          requireConfiguration();
          const childRequestIds = targetIds.map(id => workflow.runRequestIds[id]);
          context.runs.beginMany(targetNodes.map(node => ({
            requestId: workflow.runRequestIds[node.id], node, generation: workflow.approvedGenerations[node.id],
          })));
          batchRunRequestIds = childRequestIds;
          const response = await executeAgentWorkflowBatch(context, workflow, { signal });
          void context.points.getState().actions.updateUserPoint();
          const responseVersion = String(response.versionNumber);
          batchRunRequestIds.forEach(id => context.runs.submitted(id, response.taskId, responseVersion));
          return {
            status: 'submitted',
            canvasId: context.canvasId,
            version: responseVersion,
            taskId: response.taskId,
            nodeIds: targetIds,
            results: targetIds.map(nodeId => ({
              nodeId,
              generation: workflow.approvedGenerations[nodeId] ?? { images: 0, videos: 0 },
            })),
          };
        }
        if (operation.action === 'canvas.layout') {
          const op = operation;
          const outcome = await state.actions.applyAgentDelta(current => {
            const selected = op.nodeIds.map(id => { const node = current.nodes.find(n => n.id === id); if (!node) fail('NODE_NOT_FOUND', '排版目标不存在'); return node; });
            const updates = layoutSelectedNodes(selected, current.edges, current.nodes, op.mode);
            return { updateNodes: updates.map(update => ({ ...update, ...(update.style ? { style: { ...current.nodes.find(n => n.id === update.id)?.style, ...update.style } } : {}) })) };
          }, options);
          return { status: 'saved', canvasId: context.canvasId, version: outcome.version, affectedNodeIds: outcome.affectedNodeIds, unchanged: outcome.unchanged === true };
        }
        let outcome;
        if (operation.action === 'asset.add') {
          const asset = operation.asset;
          outcome = await state.actions.addNode(current => [createAgentAssetNode(current, asset)], { ...options, nodePlacement: placementFor(asset) });
        } else if (operation.action === 'node.add') {
          const draft = operation.node;
          if (draft.type !== 'text') requireConfiguration();
          outcome = await state.actions.addNode(current => {
            const node = createAgentNode(current, draft);
            const params = node.data.params as Record<string, unknown>;
            if (draft.type !== 'text' && (!params.model || !getAgentGenerationCounts(current, node))) fail('CONFIGURATION_ERROR', '当前节点类型没有可用的原生默认模型或参数');
            return [node];
          }, { ...options, nodePlacement: placementFor(draft) });
        } else if (operation.action === 'node.update') {
          const changes = operation.changes;
          if (changes.params) requireConfiguration();
          outcome = await state.actions.updateNode(operation.nodeId, (current, node) => {
            if (signal?.aborted) fail('CANCELLED_BEFORE_DISPATCH', '调用已取消，尚未执行');
            return resolveAgentNodePatch(current, node, changes);
          }, true, true, options);
        } else if (operation.action === 'node.configure') {
          requireConfiguration();
          const configuration = operation.configuration;
          const targetId = operation.nodeId;
          const target = state.nodes.find(node => node.id === targetId);
          if (!target) fail('NODE_NOT_FOUND', '目标节点不存在');
          const audioPatch = target.type === 'audio' ? resolveAgentNodeConfiguration(state, target, configuration) : undefined;
          if (audioPatch) {
            if (snapshotVersion !== operation.expectedVersion) fail('VERSION_CONFLICT', '画布已发生变化');
            if (context.guard.isEditorBusy()) fail('EDITOR_BUSY', '用户正在编辑，请完成后再配置');
            await verifyAgentAudioVoice(context, state, { ...target, data: { ...target.data, ...audioPatch.data } }, signal);
          }
          outcome = await state.actions.updateNode(operation.nodeId, (current, node) => {
            if (signal?.aborted) fail('CANCELLED_BEFORE_DISPATCH', '调用已取消，尚未执行');
            if (audioPatch && (current.modelsMap !== state.modelsMap || current.modelNodePermission !== state.modelNodePermission)) fail('VERSION_CONFLICT', '音色检查后模型配置已变化，请重新读取');
            const patch = resolveAgentNodeConfiguration(current, node, configuration);
            if (audioPatch && JSON.stringify(patch.data.params) !== JSON.stringify(audioPatch.data.params)) fail('VERSION_CONFLICT', '音色检查后配置已变化，请重新读取');
            return patch;
          }, true, true, options);
        } else if (operation.action === 'edge.add' || operation.action === 'edge.delete'
          || operation.action === 'edge.reconnect' || operation.action === 'edge.reorder') {
          outcome = await state.actions.editAgentEdges(operation, options);
        } else if (operation.action === 'node.delete') {
          for (const id of operation.nodeIds) {
            const node = state.nodes.find(node => node.id === id);
            if (!node) fail('NODE_NOT_FOUND', '删除目标不存在');
            if (!STANDARD_NODE_TYPES.some(type => type === node.type)) fail('UNSUPPORTED_NODE', '本期只开放普通节点删除');
          }
          outcome = await state.actions.deleteNodes(operation.nodeIds, options);
        }
        if (!outcome) fail('SAVE_REJECTED', '保存没有返回严格回执');
        const current = context.store.getState();
        const affectedEdges = new Set(outcome.affectedEdgeIds ?? []);
        const warningNodeIds = [...new Set([...outcome.affectedNodeIds,
          ...state.edges.filter(edge => affectedEdges.has(edge.id)).map(edge => edge.target)])];
        const warnings = [...new Set(warningNodeIds.flatMap(id => {
          const node = current.nodes.find(item => item.id === id);
          try {
            const warning = node && supported(node) ? getAgentInputCompatibility(current, node) : null;
            return warning ? [id + '：' + warning] : [];
          } catch { return [id + '：输入兼容性尚未确认，请重新读取节点核对']; }
        }))];
        return { status: 'saved', canvasId: context.canvasId, version: outcome.version,
          affectedNodeIds: outcome.affectedNodeIds, unchanged: outcome.unchanged === true,
          ...(outcome.affectedEdgeIds ? { affectedEdgeIds: outcome.affectedEdgeIds } : {}),
          ...(warnings.length ? { warnings } : {}) };
      } catch (error: any) {
        if (error?.requestPhase === 'sent_unknown' && !isCanvasReadOperation(operation)) {
          const failure: Failure = { code: 'SUBMISSION_UNKNOWN', message: error.message || '请求结果未确认，请先读取核对', retry: 'read_first' };
          context.store.setState({ agentPersistenceIssue: failure });
          const nodeId = 'nodeId' in operation ? operation.nodeId : undefined;
          const taskId = typeof error.raw?.taskId === 'string' && error.raw.taskId.trim() && error.raw.taskId.length <= 200 ? error.raw.taskId : undefined;
          if (runRequestId) context.runs.unknown(runRequestId, version(), taskId);
          batchRunRequestIds.forEach(id => context.runs.unknown(id, version(), taskId));
          return { status: 'submission_unknown', canvasId: context.canvasId, phase: operation.action === 'node.run' || operation.action === 'workflow.run' ? 'run' : 'save', version: version(),
            affectedNodeIds: error.affectedNodeIds ?? ('nodeIds' in operation ? operation.nodeIds ?? [] : nodeId ? [nodeId] : []), error: failure,
            ...(Array.isArray(error.affectedEdgeIds) ? { affectedEdgeIds: error.affectedEdgeIds } : {}),
            ...(operation.action === 'node.run' ? { nodeId: operation.nodeId, generation: operation.approvedGeneration, ...(taskId ? { taskId } : {}) } : {}) };
        }
        if (runRequestId) context.runs.discard(runRequestId);
        batchRunRequestIds.forEach(id => context.runs.discard(id));
        const code: ErrorCode = error instanceof CanvasAgentError ? error.code : String(error?.code ?? error?.raw?.code) === '5011' ? 'VERSION_CONFLICT' : error?.status === 401 || error?.status === 403 ? 'AUTH_REQUIRED' : isCanvasReadOperation(operation) ? 'READ_REJECTED' : operation?.action === 'node.run' || operation?.action === 'workflow.run' ? 'RUN_REJECTED' : 'SAVE_REJECTED';
        return { status: 'rejected', canvasId: context.canvasId, version: version(), effect: 'none',
          error: { code, message: error?.message || error?.msg || '画布操作未执行', retry: code === 'INVALID_ARGUMENT' || code === 'UNSUPPORTED_NODE' || code === 'INVALID_CONNECTION' ? 'after_input' : 'read_first' } };
      }
    },
  };
}
