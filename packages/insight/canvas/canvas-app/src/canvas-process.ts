import type { Node, Edge } from '@xyflow/react';
import { CanvasAgentError, type AgentWriteOptions, type GenerationCounts, type Failure } from '../../src/shared/canvas-agent-protocol';
import { sameGenerationCounts } from '../../src/shared/canvas-generation-counts';
import { PROCESS_DEFINITIONS, type ProcessSubmittedReceipt, type ProcessPartialReceipt } from '../../src/shared/canvas-process-protocol';
import type { CanvasContext } from './canvas-context';
import { request } from './request';
import { submitExternalTask, readExternalTask } from './external-task-api';
import { parseChildNodeInfoFromPollData } from './tool-output-info';
import { ownProcess } from './process-ownership';
import { stateOf, sourceOf, fail, urlOf, type Plan } from './canvas-process-planning';
import util from '../legacy/src/components/canvasFlow/utils/util';
import { assignNodeTitles } from '../legacy/src/components/canvasFlow/utils/nodeNaming';
import { placeAgentNodes } from './agent-node-placement';
import { isTrustedCanvasVersion } from './canvas-initialization';
export { preflightProcess, readProcessCapabilities } from './canvas-process-planning';
function refreshPoints(context: CanvasContext): void {
    try { void Promise.resolve(context.points.getState().actions.updateUserPoint()).catch(() => undefined); }
    catch { /* Balance presentation cannot reclassify a submitted or completed process. */ }
}
function prepareGraph(context: CanvasContext, plan: Plan, operationId: string): {
    nodes: Node[];
    edges: Edge[];
} {
    const state = context.store.getState(), def = PROCESS_DEFINITIONS[plan.input.kind];
    const make = (id: string, type: string, output: boolean): Node => {
        const draft = util.createNode(state.modelsMap, { type, position: { x: 0, y: 0 } }, state.modelNodePermission);
        draft.id = id;
        draft.selected = false;
        draft.data = { ...draft.data, ...(output ? util.buildInitialToolOutputNodeData(draft.data) : {}), params: output ? {} : plan.params, taskInfo: { status: 'prepared' }, desktopProcess: { operationId, kind: plan.input.kind, sourceNodeId: plan.input.sourceNodeId, outputNodeIds: plan.receipt.outputNodeIds } };
        return draft;
    };
    let nodes = plan.input.kind === 'auto_matting' ? [make(plan.receipt.nodeId, 'image', true)] : [make(plan.receipt.nodeId, def.nodeType!, false), ...plan.receipt.outputNodeIds.map(id => make(id, def.output, true))];
    let snapshot: Node | undefined;
    if (state.nodes.find(n => n.id === plan.input.sourceNodeId)?.data.value !== plan.sourceUrl) {
        snapshot = make(crypto.randomUUID(), def.input, true);
        snapshot.data = { ...util.buildMediaUploadNodeData(snapshot.data, plan.sourceUrl), taskInfo: { status: 'success' }, desktopProcess: { operationId, sourceSnapshot: true } };
        snapshot = placeAgentNodes([snapshot], state.nodes, { mode: 'after', anchorNodeId: plan.input.sourceNodeId })[0];
    }
    const source = placeAgentNodes([nodes[0]], [...state.nodes, ...(snapshot ? [snapshot] : [])], { mode: 'after', anchorNodeId: snapshot?.id ?? plan.input.sourceNodeId })[0];
    nodes = nodes.map((node, i) => ({ ...node, position: i === 0 ? source.position : { x: source.position.x + 520, y: source.position.y + (i - 1) * 480 } }));
    const edge = (sourceId: string, targetId: string): Edge => util.dealEdge({ id: crypto.randomUUID(), source: sourceId, target: targetId, sourceHandle: `${def.input}_source`, targetHandle: `${def.output}_target` });
    const edges = [...(snapshot ? [edge(plan.input.sourceNodeId, snapshot.id)] : []), edge(snapshot?.id ?? plan.input.sourceNodeId, plan.receipt.nodeId), ...(plan.input.kind === 'auto_matting' ? [] : plan.receipt.outputNodeIds.map(id => edge(plan.receipt.nodeId, id)))];
    if (snapshot) {
        nodes.push(snapshot);
    }
    nodes = assignNodeTitles({ existingNodes: state.nodes, existingEdges: state.edges, nodesToAdd: nodes, edgesToAdd: edges, mode: 'auto' });
    return { nodes, edges };
}
export async function startProcess(context: CanvasContext, planId: string, nodeId: string, expectedVersion: string, approved: GenerationCounts, requestId: string): Promise<ProcessSubmittedReceipt | ProcessPartialReceipt> {
    const state = stateOf(context), plan = state.plans.get(planId);
    if (!plan || plan.receipt.nodeId !== nodeId || Date.now() - plan.createdAt > 300000) {
        fail('INVALID_ARGUMENT', '处理预检已失效');
    }
    if (plan.receipt.version !== expectedVersion || !sameGenerationCounts(plan.receipt.generation, approved) || sourceOf(context, plan.input) !== plan.sourceUrl) {
        fail('VERSION_CONFLICT', '来源、参数或数量已变化');
    }
    state.plans.delete(planId);
    const graph = prepareGraph(context, plan, requestId), options: AgentWriteOptions = { expectedVersion, strictReceipt: true, affectedNodeIds: [plan.input.sourceNodeId] };
    let version: string | null = expectedVersion, taskId: string | undefined, affected: string[] = [];
    const releaseOwner = ownProcess(context.store, nodeId);
    let stop = () => { };
    try {
        const saved = await context.store.getState().actions.applyAgentDelta(current => ({ addNodes: graph.nodes, allEdges: [...current.edges, ...graph.edges] }), options);
        version = saved.version;
        affected = graph.nodes.map(n => n.id);
        context.runs.beginProcess(requestId, graph.nodes[0], approved);
        context.runs.publishProcess(requestId, { phase: 'submitted', operationId: requestId, version, outputs: [] });
        const executionNodes = graph.nodes.filter(n => n.id === nodeId || plan.receipt.outputNodeIds.includes(n.id));
        const publish = (patch: Parameters<CanvasContext['runs']['publishProcess']>[1]) => context.runs.publishProcess(requestId, { operationId: requestId, ...(taskId ? { nodeTaskId: taskId } : {}), ...patch });
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined, stopped = false, failures = 0;
        stop = () => {
            if (stopped) {
                return;
            }
            stopped = true;
            clearTimeout(timer);
            controller.abort();
            state.stops.delete(stop);
            releaseOwner();
        };
        state.stops.add(stop);
        const unknown = (message: string) => { publish({ phase: 'monitoring_unknown', version, outputs: [], error: { code: 'SUBMISSION_UNKNOWN', message, retry: 'never_auto' } }); stop(); };
        const transportOptions = { ...context.requestOptions(), signal: controller.signal, silentError: true, receiptMode: 'agent' as const };
        const complete = async (mapping: Record<string, string>) => {
            const products = plan.receipt.outputNodeIds.flatMap(id => urlOf(mapping[id]) ? [{ nodeId: id, url: mapping[id] }] : []);
            if (!products.length) {
                unknown('处理返回成功，但缺少可确认的结果节点映射；请勿重复执行');
                return;
            }
            const latest = context.store.getState();
            if (latest.agentPersistenceIssue || latest.versionConflict || !context.getInfo().readiness.capabilities.edit) {
                unknown('处理已产出，但画布保存状态不可确认；请先核对画布');
                return;
            }
            const completion = { expectedVersion: String(latest.versionNumber), strictReceipt: true as const, processCompletionId: requestId };
            try {
                const receipt = await latest.actions.applyAgentDelta(current => ({ updateNodes: executionNodes.map(original => {
                        const node = current.nodes.find(n => n.id === original.id);
                        if (!node || (node.data.desktopProcess as any)?.operationId !== requestId) {
                            fail('VERSION_CONFLICT', '处理结果节点已被移除或修改');
                        }
                        const product = products.find(p => p.nodeId === node.id), primary = node.id === nodeId ? products[0] : undefined;
                        const url = product?.url ?? primary?.url;
                        return { id: node.id, data: { ...(url ? { value: url, product: [{ value: url }] } : {}), taskInfo: { status: url ? 'success' : 'failure', ...(taskId ? { taskId } : {}), ...(!url ? { errorMsg: '本次处理未返回该项结果' } : {}) } } };
                    }) }), completion);
                version = receipt.version;
                publish({ phase: products.length === plan.receipt.outputNodeIds.length ? 'completed' : 'failed', version, outputs: products.map(p => p.url), products,
                    ...(products.length < plan.receipt.outputNodeIds.length ? { error: { code: 'RUN_REJECTED', message: `实际返回${products.length}/${plan.receipt.outputNodeIds.length}项，已保留可用结果`, retry: 'user_decision' } } : {}) });
                refreshPoints(context);
                for (const product of products)
                    context.store.getState().actions.ensureNodeMediaDimensions(product.nodeId, product.url);
                stop();
            }
            catch {
                unknown('处理已有结果，但结果保存未确认；请核对原任务，勿再次处理');
            }
        };
        if (plan.input.kind === 'auto_matting') {
            const response = await request('game-ai-editor-center/api/desktop/matting', { canvasId: context.canvasId, sourceNodeId: plan.input.sourceNodeId, outputIndex: plan.input.outputIndex ?? 0, expectedSourceUrl: plan.sourceUrl }, transportOptions);
            const result = (response.data as any)?.mattingImageUrl;
            if (!urlOf(result)) {
                unknown('抠图响应没有可确认的图片地址');
            }
            else {
                await complete({ [nodeId]: result });
            }
        }
        else {
            const kind = plan.input.kind;
            const response = await submitExternalTask({ type: kind === 'image_layering' ? 'IMAGE_LAYERING' : kind === 'video_upscale' ? 'VIDEO_UPSCALE' : 'IMAGE_UPSCALE', canvasId: context.canvasId, nodeId,
                data: kind === 'video_upscale' ? { videoUrlList: [plan.sourceUrl], videoParams: { resolution: plan.params.resolution }, childNodeIds: plan.receipt.outputNodeIds }
                    : { imageUrlList: [plan.sourceUrl], ...(kind === 'image_layering' ? { modelId: plan.params.model } : {}), imageParam: kind === 'image_layering' ? { numLayers: plan.params.num_layers, resolution: plan.params.resolution } : { resolution: plan.params.resolution }, childNodeIds: plan.receipt.outputNodeIds } }, transportOptions);
            const data = response.data as any;
            if (typeof data?.taskId !== 'string' || !data.taskId.trim()) {
                throw Object.assign(new Error('处理任务已接受，但缺少任务身份'), { requestPhase: 'sent_unknown' });
            }
            taskId = data.taskId;
            refreshPoints(context);
            if (!isTrustedCanvasVersion(data.versionNumber)) {
                throw Object.assign(new Error('处理已接受，但画布版本尚未确认'), { requestPhase: 'sent_unknown' });
            }
            context.store.getState().actions.setVersionNumber(data.versionNumber);
            const identity = await context.store.getState().actions.applyAgentDelta(() => ({ updateNodes: executionNodes.map(node => ({ id: node.id, data: { taskInfo: { status: 'running', taskId }, desktopProcess: { ...(node.data.desktopProcess as object), taskId } } })) }), { expectedVersion: String(context.store.getState().versionNumber), strictReceipt: true });
            version = identity.version;
            publish({ phase: 'running', version, outputs: [] });
            const poll = async () => {
                if (stopped) {
                    return;
                }
                try {
                    const result = await context.barrier.runPolling(() => readExternalTask(taskId!, transportOptions), (r: any) => {
                        const v = r?.data?.versionNumber;
                        if (!(typeof v === 'string' && v.trim() || typeof v === 'number' && Number.isSafeInteger(v) && v >= 0)) {
                            return false;
                        }
                        context.store.getState().actions.setVersionNumber(v);
                        return true;
                    });
                    if (stopped) {
                        return;
                    }
                    const data = result.data as any;
                    failures = 0;
                    if (data?.status === 'RUNNING') {
                        timer = setTimeout(() => void poll(), 3000);
                        return;
                    }
                    if (data?.status === 'SUCCESS') {
                        const map = parseChildNodeInfoFromPollData(data);
                        if (map && Object.keys(map).some(id => !plan.receipt.outputNodeIds.includes(id))) {
                            unknown('处理返回的节点映射与本次任务不一致');
                            return;
                        }
                        let resultObject = data.result;
                        if (typeof resultObject === 'string') {
                            try {
                                resultObject = JSON.parse(resultObject);
                            }
                            catch {
                                resultObject = null;
                            }
                        }
                        const fallback = kind === 'video_upscale' ? resultObject?.videoList : resultObject?.imageList;
                        await complete(map ?? (plan.receipt.outputNodeIds.length === 1 && Array.isArray(fallback) && urlOf(fallback[0]) ? { [plan.receipt.outputNodeIds[0]]: fallback[0] } : {}));
                        return;
                    }
                    if (data?.status === 'FAILURE') {
                        try {
                            const failureMessage = String(data.message ?? '处理任务失败').slice(0, 2048);
                            const saved = await context.store.getState().actions.applyAgentDelta(() => ({ updateNodes: executionNodes.map(node => ({ id: node.id, data: { taskInfo: { status: 'failure', taskId, errorMsg: failureMessage } } })) }), { expectedVersion: String(context.store.getState().versionNumber), strictReceipt: true, processCompletionId: requestId });
                            version = saved.version;
                            publish({ phase: 'failed', version, outputs: [], error: { code: 'RUN_REJECTED', message: failureMessage, retry: 'user_decision' } });
                            refreshPoints(context);
                            stop();
                        }
                        catch {
                            unknown('任务已失败，但画布状态保存未确认，请核对原任务');
                        }
                        return;
                    }
                    throw new Error('任务状态不可识别');
                }
                catch {
                    if (!stopped) {
                        failures++;
                        if (failures >= 6) {
                            unknown('处理结果监控暂不可用，后台状态未确认');
                        }
                        else {
                            timer = setTimeout(() => void poll(), 10000);
                        }
                    }
                }
            };
            timer = setTimeout(() => void poll(), 200);
        }
        return { status: 'process_submitted', canvasId: context.canvasId, version, nodeId, outputNodeIds: plan.receipt.outputNodeIds, operationId: requestId, ...(taskId ? { taskId } : {}), generation: approved };
    }
    catch (error: any) {
        let uncertain = error?.requestPhase === 'sent_unknown' || !!taskId;
        if (affected.length && !uncertain) {
            try {
                const saved = await context.store.getState().actions.applyAgentDelta(() => ({
                    updateNodes: graph.nodes.filter(n => n.id === nodeId || plan.receipt.outputNodeIds.includes(n.id)).map(node => ({
                        id: node.id,
                        data: { taskInfo: { status: 'failure', errorMsg: error?.message?.slice(0, 2048) || '处理请求被拒绝' } },
                    })),
                }), { expectedVersion: String(context.store.getState().versionNumber), strictReceipt: true, processCompletionId: requestId });
                version = saved.version;
            } catch {
                uncertain = true;
            }
        }
        stop();
        releaseOwner();
        const failure: Failure = { code: uncertain ? 'SUBMISSION_UNKNOWN' : error instanceof CanvasAgentError ? error.code : 'RUN_REJECTED', message: uncertain && !taskId && error?.requestPhase !== 'sent_unknown' ? '处理请求未完成，结果节点状态保存未确认，请核对画布' : error?.message?.slice(0, 2048) || '专用处理未完成', retry: affected.length || taskId ? 'never_auto' : 'read_first' };
        if (affected.length) {
            context.runs.publishProcess(requestId, { phase: uncertain ? 'submission_unknown' : 'failed', version: uncertain ? null : version, outputs: [], operationId: requestId, ...(taskId ? { nodeTaskId: taskId } : {}), error: failure });
        }
        if (!affected.length && !uncertain) {
            throw error;
        }
        return { status: 'process_partial', canvasId: context.canvasId, version: uncertain ? null : version, nodeId, affectedNodeIds: affected.length ? affected : graph.nodes.map(n => n.id), operationId: requestId, ...(taskId ? { taskId } : {}), error: failure };
    }
}
