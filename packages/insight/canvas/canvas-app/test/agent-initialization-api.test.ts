import { afterEach, describe, expect, it, vi } from 'vitest';
const requestMock = vi.hoisted(() => vi.fn());
vi.mock('../src/request', () => ({ request: requestMock }));
import { getFlowData, getModelParams, listModelNodeSetting, listToolNodeSetting, fetchTone, getAllRule } from '../legacy/src/api/workflow';
import { fetchSubscriptionModelMap } from '../legacy/src/components/canvasFlow/utils/modelPermission';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('native initialization API options', () => {
  it('passes context abort/UI callbacks only as request configuration, preserving existing endpoint bodies', async () => {
    const options = { signal: new AbortController().signal, silentError: true, onAuthExpired: vi.fn(), onCanvasLoadError: vi.fn() };
    await getFlowData({ id: '2873' }, options); await listModelNodeSetting(options); await listToolNodeSetting(options); await fetchTone(options); await getAllRule(options);
    expect(requestMock.mock.calls.map(([path]) => path)).toEqual([
      'game-ai-editor-center/api/canvas/get', 'game-ai-editor-center/api/v2/workflow/listModelNodeSetting',
      'game-ai-editor-center/api/v2/workflow/listToolNodeSetting', 'game-ai-editor-center/api/tone/list', 'order-server/api/cost/getAllRule',
    ]);
    expect(requestMock.mock.calls[0][1]).toEqual({ id: '2873' });
    for (const [, body, config] of requestMock.mock.calls) {
      expect(body).not.toHaveProperty('signal'); expect(body).not.toHaveProperty('onAuthExpired'); expect(config).toMatchObject(options);
    }
  });
  it('preserves backend model loading and forwards signal to both configured model/fallback CDN requests', async () => {
    vi.stubEnv('VITE_MODEL_PARAMS_URL', '');
    const options = { signal: new AbortController().signal, silentError: true };
    await getModelParams(options); expect(requestMock.mock.calls[0][0]).toBe('game-ai-editor-center/api/v2/workflow/listNodeSetting');
    expect(requestMock.mock.calls[0][2]).toBe(options);
    vi.stubEnv('VITE_MODEL_PARAMS_URL', 'https://example.com/models.json');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }); vi.stubGlobal('fetch', fetchMock);
    await getModelParams(options); await fetchSubscriptionModelMap(options);
    expect(fetchMock.mock.calls[0][1].signal).toBe(options.signal); expect(fetchMock.mock.calls[1][1].signal).toBe(options.signal);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});
