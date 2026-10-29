import { CanvasAgentError } from '../../src/shared/canvas-agent-protocol';
import { PROCESS_DEFINITIONS, PROCESS_KINDS, type ProcessInput, type ProcessKind, type ProcessPlanReceipt, type CapabilitiesReceipt } from '../../src/shared/canvas-process-protocol';
import type { CanvasContext } from './canvas-context';
import { request } from './request';
import { describeAgentNode } from './agent-node-policy';
import util from '../legacy/src/components/canvasFlow/utils/util';
import toolUtil from '../legacy/src/components/canvasFlow/utils/toolUtil';
import { isToolUsable, isModelSelectable, getChoiceFlag } from '../legacy/src/components/canvasFlow/utils/modelPermission';
import { resolveDefaultParams } from '../legacy/src/components/canvasFlow/components/toolControl/imageLayoutParams';
import { normalizeWorkflowCost } from '../legacy/src/components/canvasFlow/utils/workflowCost';
export interface Plan {
    input: ProcessInput;
    sourceUrl: string;
    params: Record<string, string | number>;
    receipt: ProcessPlanReceipt;
    createdAt: number;
}
interface ProcessState {
    plans: Map<string, Plan>;
    stops: Set<() => void>;
    release?: () => void;
}
const states = new WeakMap<CanvasContext, ProcessState>();
export function stateOf(context: CanvasContext): ProcessState {
    let state = states.get(context);
    if (state) {
        return state;
    }
    state = { plans: new Map(), stops: new Set() };
    states.set(context, state);
    state.release = context.subscribeReadiness(info => {
        if (info.phase === 'disposed' || info.reason?.code === 'AUTH_REQUIRED') {
            for (const stop of [...state!.stops])
                stop();
            state!.plans.clear();
        }
    });
    return state;
}
export function fail(code: 'INVALID_ARGUMENT' | 'CONFIGURATION_ERROR' | 'NODE_NOT_FOUND' | 'NODE_BUSY' | 'VERSION_CONFLICT' | 'RUN_REJECTED', message: string): never {
    throw Object.assign(new CanvasAgentError(code, message), { requestPhase: 'not_sent' });
}
export const urlOf = (value: unknown): value is string => {
    if (typeof value !== 'string' || value.length > 4096) {
        return false;
    }
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.hash && ![...url.searchParams.keys()].some(k => /^(token|authorization|access_token|bridgekey)$/i.test(k));
    }
    catch {
        return false;
    }
};
export function sourceOf(context: CanvasContext, input: ProcessInput): string {
    const node = context.store.getState().nodes.find(n => n.id === input.sourceNodeId);
    if (!node) {
        fail('NODE_NOT_FOUND', '来源节点不存在');
    }
    if (node.type !== PROCESS_DEFINITIONS[input.kind].input) {
        fail('INVALID_ARGUMENT', '来源节点的素材类型与处理不匹配');
    }
    if ((node.data.taskInfo as any)?.status === 'running') {
        fail('NODE_BUSY', '来源素材还在生成');
    }
    const value = describeAgentNode(context.store.getState(), node).outputs[input.outputIndex ?? 0];
    if (!urlOf(value)) {
        fail('INVALID_ARGUMENT', '来源节点没有所选素材');
    }
    return value;
}
function layerCatalog(context: CanvasContext, model?: string) {
    const state = context.store.getState();
    const models = (state.modelsMap.imageLayoutTool ?? []) as any[];
    const usable = models.filter(m => isModelSelectable(state.modelNodePermission, 'imageLayoutTool', String(m.value)));
    const item = model === undefined ? usable[0] : usable.find(m => m.value === model);
    if (!item) {
        fail('CONFIGURATION_ERROR', '当前没有所选分层模型的权限或配置');
    }
    const defaults = resolveDefaultParams(item, {});
    const fields = util.transformByModel(usable, {}, item.value).otherParams;
    const choices = (key: string) => (fields.find((f: any) => f.key === key)?.option ?? []).map((o: any) => o.value).filter((v: any) => (typeof v === 'string' || typeof v === 'number') && getChoiceFlag(state.modelNodePermission, 'imageLayoutTool', String(item.value), key, v).enabled && getChoiceFlag(state.modelNodePermission, 'imageLayoutTool', String(item.value), key, v).visible);
    return { models: usable, item, defaults, choices };
}
export function readProcessCapabilities(context: CanvasContext, selectedKind?: ProcessKind, selectedModel?: string): CapabilitiesReceipt {
    const state = context.store.getState(), stages = context.getInitialization();
    return { status: 'capabilities', canvasId: context.canvasId, version: state.versionNumber == null ? null : String(state.versionNumber), layout: ['grid', 'horizontal', 'vertical'], processes: PROCESS_KINDS.filter(kind => !selectedKind || selectedKind === kind).map(kind => {
            const definition = PROCESS_DEFINITIONS[kind];
            let available = context.getInfo().readiness.capabilities.run && stages.toolPermission.status === 'ready' && isToolUsable(state.toolNodePermission, definition.nodeType ?? 'imageEditorTool');
            let reason = available ? undefined : '工具权限未就绪或当前账号不可用';
            const params: CapabilitiesReceipt['processes'][number]['params'] = definition.resolutions.length ? [{ field: 'resolution', choices: [...definition.resolutions], default: definition.resolutions[0] }] : [];
            if (kind === 'image_layering' && available) {
                try {
                    if (stages.models.status !== 'ready' || stages.modelPermission.status !== 'ready') {
                        throw new Error();
                    }
                    const catalog = layerCatalog(context, selectedModel);
                    params.push({ field: 'model', choices: catalog.models.map(m => m.value), default: catalog.item.value });
                    for (const key of ['num_layers', 'resolution'] as const) {
                        const choices = catalog.choices(key).filter((v: any) => key !== 'num_layers' || Number.isInteger(v) && v > 0 && v <= 20);
                        if (!choices.length) {
                            throw new Error();
                        }
                        params.push({ field: key, choices, default: choices.includes(catalog.defaults[key]) ? catalog.defaults[key] : choices[0] });
                    }
                }
                catch {
                    available = false;
                    reason = '没有可用分层模型或参数';
                }
            }
            return { kind, label: definition.label, input: definition.input, available, ...(reason ? { reason } : {}), params };
        }) };
}
export async function preflightProcess(context: CanvasContext, input: ProcessInput, expectedVersion: string, signal?: AbortSignal): Promise<ProcessPlanReceipt> {
    return context.guard.run(async () => {
        if (String(context.store.getState().versionNumber) !== expectedVersion) {
            fail('VERSION_CONFLICT', '画布已变化，请重新读取');
        }
        const capability = readProcessCapabilities(context, input.kind, input.params?.model).processes.find(p => p.kind === input.kind)!;
        if (!capability.available) {
            fail('CONFIGURATION_ERROR', capability.reason!);
        }
        const sourceUrl = sourceOf(context, input), params: Plan['params'] = {};
        for (const field of capability.params) {
            const supplied = input.params?.[field.field as keyof NonNullable<ProcessInput['params']>];
            const selected = supplied ?? field.default;
            if (selected === undefined || !field.choices.some(v => Object.is(v, selected))) {
                fail('INVALID_ARGUMENT', '参数不在当前可用选项中：' + field.field);
            }
            params[field.field] = selected;
        }
        if (input.kind === 'image_layering' && input.params?.model) {
            const catalog = layerCatalog(context, input.params.model);
            for (const key of ['num_layers', 'resolution'] as const) {
                const choices = catalog.choices(key);
                const selected = input.params[key] ?? catalog.defaults[key];
                if (!choices.some((v: any) => Object.is(v, selected))) {
                    fail('INVALID_ARGUMENT', '参数与所选分层模型不兼容');
                }
                params[key] = selected;
            }
        }
        const options = { ...context.requestOptions(), signal, silentError: true, receiptMode: 'agent' as const };
        const capacity = await toolUtil.isAllowCapacity(() => undefined, options);
        if (!capacity) {
            fail('RUN_REJECTED', '素材空间不足，尚未处理');
        }
        let quote: ProcessPlanReceipt['quote'] = { points: null, originalPoints: null };
        if (input.kind !== 'auto_matting') {
            const endpoint = input.kind === 'image_layering' ? 'order-server/api/cost/externalTask' : `game-ai-editor-center/upscale/${input.kind === 'video_upscale' ? 'video' : 'image'}/points`;
            const body = input.kind === 'image_layering' ? { type: 'IMAGE_LAYERING', model: params.model, numLayers: params.num_layers, resolution: params.resolution } : { urlList: [sourceUrl], resolution: params.resolution, canvasId: context.canvasId, nodeId: input.sourceNodeId };
            const response = await request(endpoint, body, options);
            quote = normalizeWorkflowCost(response.data);
        }
        context.guard.assertOperationActive();
        if (String(context.store.getState().versionNumber) !== expectedVersion || sourceOf(context, input) !== sourceUrl) {
            fail('VERSION_CONFLICT', '预检期间来源已变化');
        }
        const planId = crypto.randomUUID(), nodeId = crypto.randomUUID(), count = input.kind === 'image_layering' ? Number(params.num_layers) : 1;
        const outputNodeIds = Array.from({ length: count }, () => input.kind === 'auto_matting' ? nodeId : crypto.randomUUID());
        const generation = input.kind === 'video_upscale' ? { images: 0, videos: count } : { images: count, videos: 0 };
        const receipt: ProcessPlanReceipt = { status: 'process_ready', canvasId: context.canvasId, version: expectedVersion, planId, nodeId, outputNodeIds, generation, quote };
        const state = stateOf(context);
        for (const [id, plan] of state.plans)
            if (Date.now() - plan.createdAt > 300000) {
                state.plans.delete(id);
            }
        if (state.plans.size >= 1024) {
            fail('RUN_REJECTED', '处理预检记录已达上限');
        }
        state.plans.set(planId, { input, sourceUrl, params, receipt, createdAt: Date.now() });
        return receipt;
    }, context.store.getState().actions.awaitMutationsIdle);
}
