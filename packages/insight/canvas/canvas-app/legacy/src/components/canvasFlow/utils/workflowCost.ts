import { calculateWorkflowCost } from '@/api/order';
import type { WorkFlowExcute, CanvasRequestOptions } from '@/api/workflow';

export interface WorkflowCost { points: number; originalPoints: number | null }
const points = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function buildWorkflowCostPayload(input: WorkFlowExcute): WorkFlowExcute {
  const payload = structuredClone(input);
  payload.workflowData.nodes = payload.workflowData.nodes.map(node => {
    const params = node.data.params as Record<string, unknown> | undefined;
    return params?.prompt == null || params.prompt === ''
      ? { ...node, data: { ...node.data, params: { ...params, prompt: ' ' } } } : node;
  });
  return payload;
}
export function normalizeWorkflowCost(value: unknown): WorkflowCost {
  if (points(value)) return { points: value, originalPoints: null };
  if (value && typeof value === 'object') {
    const data = value as Record<string, unknown>;
    if ((data.discount_applied === undefined || typeof data.discount_applied === 'boolean') && points(data.original_points)
      && (!data.discount_applied || points(data.discounted_points))) {
      return { points: data.discount_applied ? data.discounted_points as number : data.original_points,
        originalPoints: data.discount_applied ? data.original_points : null };
    }
  }
  throw new Error('预估赛点消耗响应无效');
}
export async function calculateSingleWorkflowCost(payload: WorkFlowExcute, options?: CanvasRequestOptions): Promise<WorkflowCost> {
  const response = await calculateWorkflowCost(buildWorkflowCostPayload(payload), options?.signal ?? undefined, options);
  return normalizeWorkflowCost(response.data);
}
