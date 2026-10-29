import { CanvasAgentError, assertCanvasMessageSize, parseCanvasFailure, type Failure, type GenerationCounts } from './canvas-agent-protocol.ts';
import { parseCanvasId } from './protocol.ts';
import { isGenerationCounts } from './canvas-generation-counts.ts';

export const CANVAS_RUN_PHASES = ['submitted', 'running', 'completed', 'failed', 'monitoring_unknown', 'submission_unknown'] as const;
export interface CanvasRunState {
  requestId: string; canvasId: string; nodeId: string; sequence: number;
  phase: typeof CANVAS_RUN_PHASES[number]; version: string | null;
  operationId?: string; products?: Array<{ nodeId: string; url: string }>; workflowTaskId?: string; nodeTaskId?: string; generation: GenerationCounts; outputs: string[]; error?: Failure;
}
const id = (value: unknown, max = 200): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const url = (value: unknown): boolean => {
  if (!id(value, 4096)) return false;
  try { const parsed = new URL(value); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password
    && ![...parsed.searchParams.keys()].some(key => /^(token|access_token|authorization|bridgekey)$/i.test(key)); } catch { return false; }
};
export function parseCanvasRunState(input: unknown): CanvasRunState {
  assertCanvasMessageSize(input);
  const required = ['requestId', 'canvasId', 'nodeId', 'sequence', 'phase', 'version', 'generation', 'outputs'];
  const optional = ['workflowTaskId', 'nodeTaskId', 'error', 'operationId', 'products'];
  const reject = (): never => { throw new CanvasAgentError('INVALID_ARGUMENT', '生成任务状态格式或字段不合法'); };
  if (!object(input) || required.some(key => !Object.hasOwn(input, key)) || Object.keys(input).some(key => !required.includes(key) && !optional.includes(key))) reject();
  const value = input as Record<string, unknown>;
  if (!id(value.requestId) || !id(value.canvasId, 19) || !parseCanvasId(value.canvasId) || !id(value.nodeId, 100) || !integer(value.sequence)
    || !CANVAS_RUN_PHASES.includes(value.phase as CanvasRunState['phase']) || (value.version !== null && !id(value.version, 100))
    || (Object.hasOwn(value, 'workflowTaskId') && !id(value.workflowTaskId)) || (Object.hasOwn(value, 'nodeTaskId') && !id(value.nodeTaskId))) reject();
  if (Object.hasOwn(value, 'operationId') && !id(value.operationId)) reject();
  if (Object.hasOwn(value, 'products') && (!Array.isArray(value.products) || value.products.length > 20 || !value.products.every(p => object(p) && Object.keys(p).length === 2 && id(p.nodeId, 100) && url(p.url)))) reject();
  const generation = value.generation;
  if (!isGenerationCounts(generation)) reject();
  if (!Array.isArray(value.outputs) || value.outputs.length > 20 || !value.outputs.every(url)) reject();
  if (Object.hasOwn(value, 'error')) parseCanvasFailure(value.error);
  return structuredClone(value) as unknown as CanvasRunState;
}
