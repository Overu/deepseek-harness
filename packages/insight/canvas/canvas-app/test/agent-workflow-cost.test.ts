import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkFlowExcute } from '../legacy/src/api/workflow';
const api = vi.hoisted(() => ({ cost: vi.fn() }));
vi.mock('@/api/order', () => ({ calculateWorkflowCost: api.cost }));
import { buildWorkflowCostPayload, normalizeWorkflowCost, calculateSingleWorkflowCost } from '../legacy/src/components/canvasFlow/utils/workflowCost';
const payload: WorkFlowExcute = { canvasId: '2873', executeStrategy: 'single', runningNodeIds: ['n1'], workflowData: { edges: [], nodes: [
  { id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { params: { prompt: '', gen_count: 1 } } },
] } };
beforeEach(() => vi.resetAllMocks());
describe('shared native workflow quote', () => {
  it('uses a request copy for native empty prompt workaround', () => {
    const result = buildWorkflowCostPayload(payload); expect(result.workflowData.nodes[0].data.params).toMatchObject({ prompt: ' ' });
    expect(payload.workflowData.nodes[0].data.params).toMatchObject({ prompt: '' });
  });
  it.each([0, 1.5, 20])('accepts finite nonnegative number %s', value => expect(normalizeWorkflowCost(value)).toEqual({ points: value, originalPoints: null }));
  it('preserves discount and nondiscount native object behavior', () => {
    expect(normalizeWorkflowCost({ discount_applied: true, original_points: 10, discounted_points: 5 })).toEqual({ points: 5, originalPoints: 10 });
    expect(normalizeWorkflowCost({ original_points: 10 })).toEqual({ points: 10, originalPoints: null });
    expect(normalizeWorkflowCost({ discount_applied: false, original_points: 10 })).toEqual({ points: 10, originalPoints: null });
  });
  it.each([undefined, -1, NaN, Infinity, '4', {}, { discount_applied: true, original_points: 10 }, { discount_applied: true, original_points: 1, discounted_points: -1 }])('rejects malformed quote %j', value => expect(() => normalizeWorkflowCost(value)).toThrow());
  it('forwards silent error/auth and signal options to existing cost API', async () => {
    api.cost.mockResolvedValue({ code: 'SUCCESS', data: 4 }); const signal = new AbortController().signal; const onAuthExpired = vi.fn();
    expect(await calculateSingleWorkflowCost(payload, { signal, silentError: true, receiptMode: 'agent', onAuthExpired })).toEqual({ points: 4, originalPoints: null });
    expect(api.cost).toHaveBeenCalledWith(expect.objectContaining({ canvasId: '2873', executeStrategy: 'single' }), signal, { signal, silentError: true, receiptMode: 'agent', onAuthExpired });
  });
});
