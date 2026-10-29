import { parseCanvasId } from './protocol.ts';
import { CanvasAgentError, parseCanvasFailure, type GenerationCounts, type Failure } from './canvas-agent-protocol.ts';
import { isGenerationCounts } from './canvas-generation-counts.ts';
export const PROCESS_KINDS = ['image_upscale', 'video_upscale', 'image_layering', 'auto_matting'] as const;
export type ProcessKind = typeof PROCESS_KINDS[number];
export const PROCESS_DEFINITIONS = {
    image_upscale: { label: '高清图片', nodeType: 'highDefinitionTool', input: 'image', output: 'image', resolutions: ['2K', '4K', '6K'] },
    video_upscale: { label: '高清视频', nodeType: 'highDefinitionVideoTool', input: 'video', output: 'video', resolutions: ['720p', '1080p', '1440p', '2160p'] },
    image_layering: { label: '图像分层', nodeType: 'imageLayoutTool', input: 'image', output: 'image', resolutions: [] },
    auto_matting: { label: '自动抠图', nodeType: null, input: 'image', output: 'image', resolutions: [] },
} as const;
export interface ProcessInput {
    kind: ProcessKind;
    sourceNodeId: string;
    outputIndex?: number;
    params?: {
        resolution?: string;
        model?: string;
        num_layers?: number;
    };
}
export interface ProcessPlanReceipt {
    status: 'process_ready';
    canvasId: string;
    version: string;
    planId: string;
    nodeId: string;
    outputNodeIds: string[];
    generation: GenerationCounts;
    quote: {
        points: number | null;
        originalPoints: number | null;
    };
}
export interface ProcessSubmittedReceipt {
    status: 'process_submitted';
    canvasId: string;
    version: string | null;
    nodeId: string;
    outputNodeIds: string[];
    operationId: string;
    taskId?: string;
    generation: GenerationCounts;
}
export interface ProcessPartialReceipt {
    status: 'process_partial';
    canvasId: string;
    version: string | null;
    nodeId: string;
    affectedNodeIds: string[];
    operationId: string;
    taskId?: string;
    error: Failure;
}
export interface ProcessCapability {
    kind: ProcessKind;
    label: string;
    input: 'image' | 'video';
    available: boolean;
    reason?: string;
    params: Array<{
        field: string;
        choices: Array<string | number>;
        default?: string | number;
    }>;
}
export interface CapabilitiesReceipt {
    status: 'capabilities';
    canvasId: string;
    version: string | null;
    processes: ProcessCapability[];
    layout: string[];
}
export interface CanvasOpenReceipt {
    status: 'opened';
    canvasId: string;
    version: null;
    content: 'loading' | 'ready';
    focus: 'not_requested' | 'focused' | 'node_missing' | 'view_unavailable';
}
export type ProcessOperation = {
    action: 'canvas.open';
    nodeId?: string;
} | {
    action: 'canvas.capabilities.read';
    kind?: ProcessKind;
    model?: string;
} | {
    action: 'canvas.layout';
    expectedVersion: string;
    nodeIds: string[];
    mode: 'grid' | 'horizontal' | 'vertical';
} | ({
    action: 'process.preflight';
    expectedVersion: string;
} & ProcessInput) | {
    action: 'process.run';
    expectedVersion: string;
    planId: string;
    nodeId: string;
    approvedGeneration: GenerationCounts;
};
export type ProcessResult = CanvasOpenReceipt | ProcessPlanReceipt | ProcessSubmittedReceipt | ProcessPartialReceipt | CapabilitiesReceipt;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = (v: unknown, max = 100) => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= max;
const exact = (v: Record<string, any>, required: string[], optional: string[] = []) => required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
export function checkProcessInput(value: unknown): value is ProcessInput {
    if (!object(value) || !PROCESS_KINDS.includes(value.kind) || !id(value.sourceNodeId) || ('outputIndex' in value && (!Number.isSafeInteger(value.outputIndex) || value.outputIndex < 0 || value.outputIndex >= 20)))
        return false;
    if (!('params' in value))
        return true;
    const p = value.params;
    return object(p) && Object.keys(p).every(k => ['resolution', 'model', 'num_layers'].includes(k))
        && (!('resolution' in p) || id(p.resolution)) && (!('model' in p) || id(p.model))
        && (!('num_layers' in p) || Number.isSafeInteger(p.num_layers) && p.num_layers > 0 && p.num_layers <= 20)
        && (value.kind === 'image_layering' || !('model' in p || 'num_layers' in p))
        && (value.kind !== 'auto_matting' || Object.keys(p).length === 0);
}
export function parseProcessInput(value: unknown): ProcessInput {
    if (!object(value) || Object.keys(value).some(k => !['kind', 'sourceNodeId', 'outputIndex', 'params'].includes(k)) || !checkProcessInput(value))
        throw new CanvasAgentError('INVALID_ARGUMENT', '处理类型、来源节点或参数不合法');
    return structuredClone(value);
}
export function checkProcessResult(v: unknown): v is ProcessResult {
    if (!object(v) || !parseCanvasId(v.canvasId) || !(v.version === null || id(v.version)))
        return false;
    if (v.status === 'opened')
        return Object.keys(v).every(k => ['status', 'canvasId', 'version', 'content', 'focus'].includes(k)) && v.version === null && ['loading', 'ready'].includes(v.content) && ['not_requested', 'focused', 'node_missing', 'view_unavailable'].includes(v.focus);
    const ids = (x: unknown) => Array.isArray(x) && x.length <= 20 && x.every(v => id(v)) && new Set(x).size === x.length;
    const generation = isGenerationCounts;
    if (v.status === 'capabilities') {
        const scalar = (x: unknown) => typeof x === 'string' && x.length <= 200 || typeof x === 'number' && Number.isFinite(x);
        return exact(v, ['status', 'canvasId', 'version', 'processes', 'layout'])
            && Array.isArray(v.layout) && v.layout.length <= 3 && new Set(v.layout).size === v.layout.length && v.layout.every((x: unknown) => ['grid', 'horizontal', 'vertical'].includes(String(x)))
            && Array.isArray(v.processes) && v.processes.length <= 4 && new Set(v.processes.map((p: any) => p?.kind)).size === v.processes.length
            && v.processes.every((p: unknown) => object(p) && exact(p, ['kind', 'label', 'input', 'available', 'params'], ['reason'])
                && PROCESS_KINDS.includes(p.kind) && id(p.label) && ['image', 'video'].includes(p.input) && typeof p.available === 'boolean'
                && (!('reason' in p) || typeof p.reason === 'string' && p.reason.length <= 2048)
                && Array.isArray(p.params) && p.params.length <= 3 && p.params.every((f: unknown) => object(f) && exact(f, ['field', 'choices'], ['default'])
                    && id(f.field) && Array.isArray(f.choices) && f.choices.length <= 100 && f.choices.every(scalar) && (!('default' in f) || scalar(f.default) && f.choices.includes(f.default))));
    }
    if (!id(v.nodeId))
        return false;
    if (v.status === 'process_ready')
        return Object.keys(v).every(k => ['status', 'canvasId', 'version', 'planId', 'nodeId', 'outputNodeIds', 'generation', 'quote'].includes(k)) && id(v.version) && id(v.planId) && ids(v.outputNodeIds) && v.outputNodeIds.length > 0 && generation(v.generation) && object(v.quote) && exact(v.quote, ['points', 'originalPoints']) && (v.quote.points === null || Number.isFinite(v.quote.points) && v.quote.points >= 0) && (v.quote.originalPoints === null || Number.isFinite(v.quote.originalPoints) && v.quote.originalPoints >= 0);
    if (!id(v.operationId, 200) || ('taskId' in v && !id(v.taskId, 200)))
        return false;
    if (v.status === 'process_submitted')
        return Object.keys(v).every(k => ['status', 'canvasId', 'version', 'nodeId', 'outputNodeIds', 'operationId', 'taskId', 'generation'].includes(k)) && ids(v.outputNodeIds) && v.outputNodeIds.length > 0 && generation(v.generation);
    try { parseCanvasFailure(v.error); } catch { return false; }
    return v.status === 'process_partial' && Object.keys(v).every(k => ['status', 'canvasId', 'version', 'nodeId', 'affectedNodeIds', 'operationId', 'taskId', 'error'].includes(k)) && Array.isArray(v.affectedNodeIds) && v.affectedNodeIds.length <= 22 && v.affectedNodeIds.every((value: unknown) => id(value)) && object(v.error) && typeof v.error.code === 'string' && typeof v.error.message === 'string' && typeof v.error.retry === 'string';
}
