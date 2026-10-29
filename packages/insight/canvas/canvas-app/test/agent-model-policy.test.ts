import type { Node } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../legacy/src/components/canvasFlow/utils/toolUtil', () => ({ default: { defaultWidth: 400, defaultHeight: 400 } }));
vi.mock('@/utils', () => ({ isSvgImageUrl: () => false }));
import { normalizeModelNodeSettings } from '../legacy/src/components/canvasFlow/utils/modelPermission';
import { readAgentModels, resolveAgentNodeConfiguration, getAgentInputCompatibility } from '../src/agent-model-policy';
import { resolveAgentNodePatch, type AgentNodeState } from '../src/agent-node-policy';

const choices = (values: unknown[]) => values.map(value => ({ value, label: String(value) }));
const model = (value: string, quality = 'low', canonicalModelId = 'shared') => ({ value, label: value, canonicalModelId, seniorParams: [], params: [
  { field: 'gen_count', label: '张数', default: 1, choices: choices([1, 2]) },
  { field: 'aspect_ratio', label: '比例', default: '1:1', choices: choices(['1:1', '16:9']), cascade: { '16:9': { quality: choices(['high']) } } },
  { field: 'quality', label: '质量', default: quality, choices: choices(quality === 'low' ? ['low', 'high'] : ['high']) },
  { field: 'cameraControl', label: '相机', setItems: [{ field: 'x', default: 0, choices: choices([0]) }] },
] });
const makeNode = (type = 'image'): Node => ({ id: 'n1', type, position: { x: 5, y: 7 }, width: 400, height: 400,
  measured: { width: 400, height: 400 }, data: { title: '主图', value: '', product: [], taskInfo: { status: 'success' },
    params: { modelType: type === 'video' ? 'text_to_video' : 'text_to_image', model: 'model-t', gen_count: 1,
      aspect_ratio: '1:1', quality: 'low', prompt: '保留提示', cameraControl: { x: 0 } } } });
const makeState = (nodes = [makeNode()]): AgentNodeState => ({ nodes, edges: [], modelNodePermission: null, modelsMap: {
  image: [
    { value: 'text_to_image', label: '文生图', params: [model('model-t'), model('model-hidden')] },
    { value: 'reference_image_to_image', label: '参考生图', params: [model('model-r', 'high'), model('model-r2', 'high', 'other')] },
  ], video: [
    { value: 'text_to_video', label: '文生视频', params: [model('model-t')] },
    { value: 'reference_image_to_video', label: '参考视频', params: [model('model-r', 'high')] },
  ],
} } as unknown as AgentNodeState);
const reject = (fn: () => unknown, code = 'INVALID_ARGUMENT') => expect(fn).toThrow(expect.objectContaining({ code }));
const query = { action: 'canvas.models.read' as const, nodeType: 'image' as const };

describe('native model catalog', () => {
  it('reports current modes, models and scalar choices without raw configuration', async () => {
    const state = makeState();
    const result = await readAgentModels(state, query);
    expect(result.modes.map(item => item.value)).toEqual(['text_to_image', 'reference_image_to_image']);
    expect(result.modelType).toBe('text_to_image'); expect(result.model).toBe('model-t');
    expect(result.paramHints.find(item => item.field === 'gen_count')?.choices).toEqual([1, 2]);
    expect(result.paramHints).not.toEqual(expect.arrayContaining([expect.objectContaining({ field: 'cameraControl' })]));
    expect(result).not.toHaveProperty('permission'); expect(result.catalogVersion).toMatch(/^[0-9a-f]{64}$/);
  });
  it('filters models and parameter choices using actual account permissions', async () => {
    const state = makeState();
    state.modelNodePermission = normalizeModelNodeSettings([{ model_category: 'image', model_key: 'model-r', visible: 1, enabled: 1,
      custom_parameters: { gen_count: { choices: [{ value: 1 }, { value: 2, enabled: 0 }] } } }]);
    const result = await readAgentModels(state, query);
    expect(result.modes).toEqual([{ value: 'reference_image_to_image', label: '参考生图' }]);
    expect(result.models).toEqual([{ value: 'model-r', label: 'model-r' }]);
    expect(result.paramHints.find(item => item.field === 'gen_count')?.choices).toEqual([1]);
    await expect(readAgentModels(state, { ...query, model: 'model-t' })).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });
  it('retains native successful-empty permission semantics and supports no configured models', async () => {
    const state = makeState(); state.modelNodePermission = normalizeModelNodeSettings([]);
    expect((await readAgentModels(state, query)).modelCount).toBe(2);
    state.modelsMap = {};
    expect(await readAgentModels(state, query)).toMatchObject({ modeCount: 0, modelCount: 0, modelType: null, model: null, paramHints: [] });
  });
  it('selects requested model in its mode and rejects explicit mismatches', async () => {
    const state = makeState();
    expect(await readAgentModels(state, { ...query, model: 'model-r2' })).toMatchObject({ modelType: 'reference_image_to_image', model: 'model-r2' });
    await expect(readAgentModels(state, { ...query, modelType: 'text_to_image', model: 'model-r' })).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    await expect(readAgentModels(state, { ...query, modelType: 'fake' })).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });
  it('uses stable catalog hashes and protects continuation across permissions or model changes', async () => {
    const state = makeState();
    const first = await readAgentModels(state, { ...query, limit: 1 });
    expect(first.nextModeOffset).toBe(1); expect(first.nextModelOffset).toBe(1);
    const second = await readAgentModels(state, { ...query, limit: 1, modeOffset: 1, modelOffset: 1, expectedCatalogVersion: first.catalogVersion });
    expect(second.catalogVersion).toBe(first.catalogVersion); expect(second.models[0].value).toBe('model-hidden');
    await expect(readAgentModels(state, { ...query, modeOffset: 1 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    (state.modelsMap as any).image[0].params[0].label = 'changed';
    await expect(readAgentModels(state, { ...query, modeOffset: 1, expectedCatalogVersion: first.catalogVersion })).rejects.toMatchObject({ code: 'CATALOG_VERSION_CONFLICT' });
  });
  it('ignores object and permission Map insertion order in catalog hashing', async () => {
    const state = makeState();
    state.modelNodePermission = normalizeModelNodeSettings([
      { model_category: 'image', model_key: 'model-r', visible: 1, enabled: 1 },
      { model_category: 'image', model_key: 'model-t', visible: 1, enabled: 1 },
    ]);
    const first = await readAgentModels(state, query);
    state.modelNodePermission.byCategoryAndKey = new Map([...state.modelNodePermission.byCategoryAndKey].reverse());
    expect((await readAgentModels(state, query)).catalogVersion).toBe(first.catalogVersion);
    state.modelNodePermission = normalizeModelNodeSettings([{ model_category: 'image', model_key: 'model-t', visible: 1, enabled: 1 }]);
    await expect(readAgentModels(state, { ...query, modeOffset: 1, expectedCatalogVersion: first.catalogVersion })).rejects.toMatchObject({ code: 'CATALOG_VERSION_CONFLICT' });
  });
});

describe('native generation configuration', () => {
  it('uses native same-series mode/model migration and preserves content, prompt and products', () => {
    const state = makeState(); const node = state.nodes[0]; const before = structuredClone(state);
    const patch = resolveAgentNodeConfiguration(state, node, { modelType: 'reference_image_to_image' });
    expect(patch.data.params).toMatchObject({ modelType: 'reference_image_to_image', model: 'model-r', quality: 'high', prompt: '保留提示', gen_count: 1 });
    expect(Object.keys(patch.data)).toEqual(['params']); expect(state).toEqual(before);
  });
  it('rejects explicit unknown, wrong-mode and permission-blocked models rather than silently falling back', () => {
    const state = makeState(); const node = state.nodes[0];
    reject(() => resolveAgentNodeConfiguration(state, node, { model: 'fake' }), 'CONFIGURATION_ERROR');
    reject(() => resolveAgentNodeConfiguration(state, node, { model: 'model-r' }), 'CONFIGURATION_ERROR');
    state.modelNodePermission = normalizeModelNodeSettings([{ model_category: 'image', model_key: 'model-t', visible: 1, enabled: 0 }]);
    reject(() => resolveAgentNodeConfiguration(state, node, { model: 'model-t' }), 'CONFIGURATION_ERROR');
  });
  it('applies native cascade defaults only to omitted children and rejects explicit illegal child values', () => {
    const state = makeState(); const node = state.nodes[0];
    expect(resolveAgentNodeConfiguration(state, node, { params: { aspect_ratio: '16:9' } }).data.params).toMatchObject({ aspect_ratio: '16:9', quality: 'high' });
    reject(() => resolveAgentNodeConfiguration(state, node, { params: { aspect_ratio: '16:9', quality: 'low' } }));
    expect(resolveAgentNodeConfiguration(state, node, { params: { aspect_ratio: '16:9', quality: 'high', gen_count: 2 } }).data.params).toMatchObject({ gen_count: 2, quality: 'high' });
  });
  it('validates explicit scalar types and hidden choices, never exposing complex fields', () => {
    const state = makeState(); const node = state.nodes[0];
    for (const configuration of [{ params: { gen_count: '2' } }, { params: { gen_count: null } }, { params: { unknown: 1 } },
      { params: { cameraControl: { x: 1 } } }, { params: { prompt: 'bypass' } }, { modelType: 'fake' }, {}]) {
      reject(() => resolveAgentNodeConfiguration(state, node, configuration as never), (configuration as any).modelType ? 'CONFIGURATION_ERROR' : 'INVALID_ARGUMENT');
    }
    state.modelNodePermission = normalizeModelNodeSettings([{ model_category: 'image', model_key: 'model-t', visible: 1, enabled: 1,
      custom_parameters: { gen_count: { choices: [{ value: 1 }, { value: 2, enabled: 0 }] } } }]);
    reject(() => resolveAgentNodeConfiguration(state, node, { params: { gen_count: 2 } }));
  });
  it('validates an explicit child against the new parent options, not stale empty options', () => {
    const state = makeState(); const node = state.nodes[0];
    const fields = (state.modelsMap as any).image[0].params[0].params;
    fields.find((field: any) => field.field === 'quality').choices = [];
    fields.find((field: any) => field.field === 'aspect_ratio').cascade['1:1'] = { quality: [] };
    const patch = resolveAgentNodeConfiguration(state, node, { params: { aspect_ratio: '16:9', quality: 'high' } });
    expect(patch.data.params).toMatchObject({ aspect_ratio: '16:9', quality: 'high' });
    reject(() => resolveAgentNodeConfiguration(state, node, { params: { aspect_ratio: '1:1' } }));
    expect(node.data.params).toMatchObject({ aspect_ratio: '1:1', quality: 'low' });
  });
  it('reuses empty-media aspect dimensions but leaves existing product dimensions alone', () => {
    const state = makeState(); const node = state.nodes[0];
    const patch = resolveAgentNodeConfiguration(state, node, { params: { aspect_ratio: '16:9' } });
    expect(patch.width).toBeGreaterThan(400); expect(patch.height).toBe(400);
    node.data.value = 'https://example.test/product.png';
    const existing = resolveAgentNodeConfiguration(state, node, { params: { aspect_ratio: '16:9' } });
    expect(existing).not.toHaveProperty('width'); expect(existing).not.toHaveProperty('height');
  });
  it('does not convert uploaded/tool-result media or non-media nodes into generation nodes', () => {
    for (const type of ['upload', 'tool']) {
      for (const media of ['image', 'video', 'audio']) {
        const node = makeNode(media); node.data.type = type; const state = makeState([node]);
        reject(() => resolveAgentNodeConfiguration(state, node, { params: { gen_count: 2 } }), 'UNSUPPORTED_NODE');
        expect(resolveAgentNodePatch(state, node, { title: '原始素材' }).data).toEqual({ title: '原始素材' });
        reject(() => resolveAgentNodePatch(state, node, { title: '原始素材', prompt: '不得转换' }), 'UNSUPPORTED_NODE');
      }
    }
    for (const type of ['text', 'group', 'imageEditorTool']) {
      const node = makeNode(type); reject(() => resolveAgentNodeConfiguration(makeState([node]), node, { model: 'model-t' }), 'UNSUPPORTED_NODE');
    }
    const node = makeNode(); reject(() => resolveAgentNodeConfiguration(makeState([]), node, { model: 'model-t' }), 'NODE_NOT_FOUND');
  });
});

describe('native input-mode compatibility', () => {
  it('reports a warning on resolved image inputs without blocking intermediate configuration saves', () => {
    const node = makeNode(); const source = { ...makeNode(), id: 'source', data: { title: '耳机', type: 'upload', value: 'https://example.test/headphone.png' } };
    const state = makeState([node, source]); state.edges = [{ id: 'e1', source: 'source', target: 'n1' }];
    expect(getAgentInputCompatibility(state, node)).toBe('仅支持文本输入');
    const patch = resolveAgentNodeConfiguration(state, node, { modelType: 'reference_image_to_image' });
    expect(getAgentInputCompatibility(state, { ...node, data: { ...node.data, ...patch.data } })).toBeNull();
    source.data.value = '';
    expect(getAgentInputCompatibility(state, { ...node, data: { ...node.data, ...patch.data } })).toBe('需要连入图像');
  });
  it('uses native video media mismatch rules and leaves upload nodes out of compatibility checks', () => {
    const node = makeNode('video'); const source = { ...makeNode(), id: 'source', data: { title: '耳机', value: 'https://example.test/headphone.png' } };
    const state = makeState([node, source]); state.edges = [{ id: 'e1', source: 'source', target: 'n1' }];
    expect(getAgentInputCompatibility(state, node)).toBe('仅支持文本输入');
    expect(getAgentInputCompatibility(state, { ...node, data: { ...node.data, params: { ...(node.data.params as object), modelType: 'image_to_video' } } })).toBeNull();
    node.data.type = 'upload'; expect(getAgentInputCompatibility(state, node)).toBeNull();
  });
});
