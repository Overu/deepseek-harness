import { describe, expect, it, vi } from 'vitest'
vi.mock('../legacy/src/components/canvasFlow/utils/toolUtil', () => ({ default: { defaultWidth: 400, defaultHeight: 400 } }))
vi.mock('@/utils', () => ({ isSvgImageUrl: () => false }))

import util from '../legacy/src/components/canvasFlow/utils/util'
import { buildMediaNodeParamState, validateMediaNodesForRun } from '../legacy/src/components/canvasFlow/utils/mediaNodeModelUtil'
import { normalizeModelNodeSettings } from '../legacy/src/components/canvasFlow/utils/modelPermission'
import { createAgentNode, describeAgentNode, getAgentGenerationCounts, resolveAgentNodePatch, type AgentNodeState } from '../src/agent-node-policy'
import { readAgentModels, resolveAgentNodeConfiguration } from '../src/agent-model-policy'

const choices = (values: unknown[]) => values.map(value => ({ value, label: String(value) }))
// Relevant fields from the public GPT Image 2.6 catalog; no network is needed for replay.
const parameters = {
  mime_type: { label: '输出格式', type: 'choices', choices: choices(['png', 'gif', 'svg']), default: 'png', cascade: {
    png: { resolution: choices(['1K', '2K']), aspect_ratio: choices(['16:9', '1:1']) },
    gif: { resolution: choices(['auto']), aspect_ratio: choices(['auto']) },
    svg: { resolution: choices(['1K', '2K']), aspect_ratio: choices(['16:9', '1:1']) },
  } },
  resolution: { label: '分辨率', type: 'choices', choices: choices(['auto', '1K', '2K']), default: '1K' },
  aspect_ratio: { label: '比例', type: 'choices', choices: choices(['auto', '16:9', '1:1']), default: '16:9', cascade: {
    auto: { resolution: choices(['auto']) }, '16:9': { resolution: choices(['1K', '2K']) }, '1:1': { resolution: choices(['1K', '2K']) },
  } },
  frame_count: { label: 'GIF 帧数', type: 'number', min: 2, max: 16, step: 1, default: 9, visible_when: { mime_type: 'gif' } },
  frame_duration_ms: { label: 'GIF 单帧时长', type: 'number', min: 20, max: 2000, step: 10, default: 200, visible_when: { mime_type: 'gif' } },
  gen_count: { label: '生成数量', type: 'choices', choices: choices([1]), default: 1 },
}
const makeState = (extra: Record<string, unknown> = {}): AgentNodeState => ({ nodes: [], edges: [], modelNodePermission: null,
  modelsMap: util.transformModelMap({ image: { text_to_image: { name: '文生图', models: {
    'gpt-image-2.6-sunburst-t2i': { model_name: 'GPT Image 2.6 Sunburst', parameters: { ...parameters, ...extra } },
    'gpt-image-2': { model_name: 'GPT Image 2', parameters: { resolution: parameters.resolution, gen_count: parameters.gen_count } },
  } } } }) })
const fixture = (extra: Record<string, unknown> = {}) => {
  const state = makeState(extra)
  const node = createAgentNode(state, { type: 'image', changes: { title: '海报', prompt: '柠檬水宣传图' } })
  state.nodes.push(node)
  return { state, node }
}

describe('schema-driven media parameters', () => {
  it.each([
    { type: 'future-control' },
    { type: 'future-control', default: { nested: { enabled: true } } },
    { type: { kind: 'future' }, default: 'native' },
    { default: 'native' },
    { type: 'future-control', choices: choices(['native', 'override']), default: 'native' },
    { type: { kind: 'future' }, choices: choices(['native', 'override']), default: 'native' },
  ])('preserves an unsupported schema without blocking node creation: %j', (definition) => {
    const { state, node } = fixture({ schema_test_future: { label: '未知参数', ...definition } })
    expect(getAgentGenerationCounts(state, node)).toEqual({ images: 1, videos: 0 })
    expect(validateMediaNodesForRun([node], state.modelsMap)).toBeUndefined()
    expect(describeAgentNode(state, node).paramHints).toContainEqual({ field: 'schema_test_future', editable: false, choices: [] })
    expect(resolveAgentNodePatch(state, node, { params: { resolution: '2K' } }).data.params).toMatchObject({ resolution: '2K' })
    expect(() => resolveAgentNodeConfiguration(state, node, { params: { schema_test_future: 'override' } })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => resolveAgentNodePatch(state, node, { params: { schema_test_future: 'override' } })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('uses the new model default when an unsupported schema changes between models', () => {
    const state: AgentNodeState = { nodes: [], edges: [], modelNodePermission: null,
      modelsMap: util.transformModelMap({ image: { text_to_image: { name: '文生图', models: {
        first: { model_name: 'First', parameters: { ...parameters, future: { type: 'future-control', default: 'native-A' } } },
        second: { model_name: 'Second', parameters: { ...parameters, future: { type: 'future-control', default: { mode: 'B' } } } },
      } } } }) }
    const node = createAgentNode(state, { type: 'image' })
    state.nodes.push(node)
    expect(node.data.params).toMatchObject({ future: 'native-A' })
    expect(resolveAgentNodeConfiguration(state, node, { model: 'second' }).data.params)
      .toMatchObject({ future: { mode: 'B' } })
  })

  it('still rejects a declared enum with no usable choices', () => {
    for (const definition of [{ choices: [], default: 'native' }, { type: 'choices', default: 'native' }]) {
      const { state, node } = fixture({ broken_enum: { label: '不可用枚举', ...definition } })
      expect(getAgentGenerationCounts(state, node)).toBeNull()
      expect(validateMediaNodesForRun([node], state.modelsMap)).toBeDefined()
    }
  })

  it('creates a default PNG node and edits enum params without rejecting inactive GIF defaults', () => {
    const { state, node } = fixture()
    expect(node.data.params).toMatchObject({ mime_type: 'png', frame_count: 9, frame_duration_ms: 200 })
    expect(getAgentGenerationCounts(state, node)).toEqual({ images: 1, videos: 0 })
    expect(resolveAgentNodePatch(state, node, { params: { resolution: '2K' } }).data.params).toMatchObject({ resolution: '2K', frame_count: 9 })
    expect(validateMediaNodesForRun([node], state.modelsMap)).toBeUndefined()
    expect(resolveAgentNodeConfiguration(state, node, { model: 'gpt-image-2' }).data.params).not.toHaveProperty('frame_count')
  })

  it('exposes numeric ranges for GIF configuration and validates types, limits and steps', () => {
    const { state, node } = fixture()
    const patch = resolveAgentNodeConfiguration(state, node, { params: { mime_type: 'gif', frame_count: 12, frame_duration_ms: 300 } })
    const gif = { ...node, data: { ...node.data, ...patch.data } }
    expect(gif.data.params).toMatchObject({ mime_type: 'gif', resolution: 'auto', aspect_ratio: 'auto' })
    state.nodes = [gif]
    expect(getAgentGenerationCounts(state, gif)).toEqual({ images: 1, videos: 0 })
    expect(describeAgentNode(state, gif).paramHints).toContainEqual(expect.objectContaining({ field: 'frame_count', editable: true, min: 2, max: 16, step: 1, default: 9 }))
    expect(resolveAgentNodePatch(state, gif, { params: { frame_count: 16 } }).data.params).toMatchObject({ frame_count: 16 })
    expect(resolveAgentNodeConfiguration(state, gif, { model: 'gpt-image-2.6-sunburst-t2i' }).data.params).toMatchObject({ frame_count: 12, frame_duration_ms: 300 })
    for (const params of [{ frame_count: 1 }, { frame_count: 17 }, { frame_count: 9.5 }, { frame_count: '9' }, { frame_duration_ms: 205 }]) {
      expect(() => resolveAgentNodePatch(state, gif, { params })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
      const invalid = { ...gif, data: { ...gif.data, params: { ...(gif.data.params as object), ...params } } }
      expect(validateMediaNodesForRun([invalid], state.modelsMap)).toBeDefined()
    }
  })

  it('adapts newly named scalar fields from their schemas and retains unsupported native defaults as read-only', () => {
    const { state, node } = fixture({
      strength: { type: 'number', min: 0, max: 1, step: 0.1, default: 0.5 },
      transparent: { type: 'switch', default: false },
      caption: { type: 'string', default: '', maxLength: 8 },
      future: { type: 'future-control', default: 'native' },
    })
    expect(getAgentGenerationCounts(state, node)).toEqual({ images: 1, videos: 0 })
    expect(resolveAgentNodePatch(state, node, { params: { strength: 0.3, transparent: true, caption: '冰鲜柠檬水' } }).data.params).toMatchObject({ strength: 0.3, transparent: true })
    expect(describeAgentNode(state, node).paramHints).toContainEqual({ field: 'future', editable: false, choices: [] })
    for (const params of [{ strength: 1.1 }, { transparent: 'true' }, { caption: 'x'.repeat(9) }, { future: 'override' }]) {
      expect(() => resolveAgentNodePatch(state, node, { params })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
      expect(() => resolveAgentNodeConfiguration(state, node, { params })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    }
    state.modelNodePermission = normalizeModelNodeSettings([{ model_category: 'image', model_key: 'gpt-image-2.6-sunburst-t2i', visible: 1, enabled: 1,
      custom_parameters: { strength: { choices: [{ value: 0.5 }, { value: 0.3, enabled: 0 }] } } }])
    expect(() => resolveAgentNodePatch(state, node, { params: { strength: 0.3 } })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('keeps hidden fields out of hints and native dropdowns, without relaxing enum validation', async () => {
    const { state, node } = fixture()
    const catalog = await readAgentModels(state, { action: 'canvas.models.read', nodeType: 'image' })
    expect(catalog.paramHints.map(field => field.field)).not.toContain('frame_count')
    expect(describeAgentNode(state, node).paramHints.map(field => field.field)).not.toContain('frame_count')
    const native = buildMediaNodeParamState(state.modelsMap, 'image', { ...(node.data.params as object), mime_type: 'gif' }, null)
    expect(native.otherParams.map(field => field.key)).not.toContain('frame_count')
    expect(() => resolveAgentNodePatch(state, node, { params: { resolution: '8K' } })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => resolveAgentNodePatch(state, node, { params: { invented: 1 } })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })
})
