import type { Node } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'

// Keep the real factory/model/permission helpers; isolate browser/API imports.
vi.mock('../legacy/src/components/canvasFlow/utils/toolUtil', () => ({ default: { defaultWidth: 400, defaultHeight: 400 } }))
vi.mock('@/utils', () => ({ isSvgImageUrl: () => false }))

import { normalizeModelNodeSettings } from '../legacy/src/components/canvasFlow/utils/modelPermission'
import { parseCanvasOperationResult } from '../../src/shared/canvas-agent-protocol'
import { createAgentNode, describeAgentNode, resolveAgentNodePatch,
  getAgentGenerationCounts, type AgentNodeState } from '../src/agent-node-policy'

const model = {
  value: 'fixture-model', label: '测试模型', seniorParams: [], params: [
    { field: 'gen_count', label: '张数', default: 1, choices: [1, 2, 4].map(value => ({ value, label: String(value) })) },
    { field: 'aspect_ratio', label: '比例', default: '1:1', choices: ['1:1', '16:9'].map(value => ({ value, label: value })), cascade: { '16:9': { quality: [{ value: 'high', label: '高' }] } } },
    { field: 'quality', label: '质量', default: 'low', choices: ['low', 'high'].map(value => ({ value, label: value })) },
  ],
}
const makeNode = (type = 'image'): Node => ({ id: 'n1', type, position: { x: 5, y: 7 }, data: { title: '主图', params: { modelType: 'fixture-mode', model: 'fixture-model', gen_count: 1, aspect_ratio: '1:1', quality: 'low', prompt: '旧提示', seniorParams: { untouched: true } }, value: '', product: [], taskInfo: { status: 'success' } } })
const makeState = (nodes = [makeNode()]): AgentNodeState => ({ nodes, edges: [], modelsMap: { image: [{ value: 'fixture-mode', label: '测试模式', params: [structuredClone(model)] }], video: [{ value: 'fixture-mode', label: '测试模式', params: [structuredClone(model)] }] }, modelNodePermission: null } as AgentNodeState)
const rejection = (fn: () => unknown, code = 'INVALID_ARGUMENT') => expect(fn).toThrow(expect.objectContaining({ code }))

describe('controlled node mapping', () => {
  it('preserves other params and original state; never calls Store actions', () => {
    const state = makeState(); const node = state.nodes[0]; const before = structuredClone(state)
    const patch = resolveAgentNodePatch(state, node, { prompt: '新提示', title: '新标题' })
    expect(patch.data).toEqual({ title: '新标题', params: { ...(node.data.params as object), prompt: '新提示' } })
    expect(patch.data).not.toHaveProperty('value'); expect(patch.data).not.toHaveProperty('taskInfo')
    expect(state).toEqual(before)
  })
  it('uses the native title validator and allows an unchanged title', () => {
    const node = makeNode(); const other = { ...makeNode('text'), id: 'n2', data: { title: '已存在' } }
    const state = makeState([node, other])
    rejection(() => resolveAgentNodePatch(state, node, { title: ' ' }))
    rejection(() => resolveAgentNodePatch(state, node, { title: '已存在' }))
    expect(resolveAgentNodePatch(state, node, { title: '主图' }).data.title).toBe('主图')
    rejection(() => resolveAgentNodePatch(makeState([]), node, { title: '新标题' }), 'NODE_NOT_FOUND')
  })
  it('maps text to value; text/audio keep technical defaults', () => {
    const node = makeNode('text'); const state = makeState([node])
    expect(resolveAgentNodePatch(state, node, { text: '脚本' }).data.value).toBe('脚本')
    rejection(() => resolveAgentNodePatch(makeState(), makeNode(), { text: '不能写图片 value' }))
    for (const type of ['text', 'audio']) {
      const current = makeNode(type)
      rejection(() => resolveAgentNodePatch(makeState([current]), current, { params: { duration: 4 } }), type === 'audio' ? 'UNSUPPORTED_NODE' : 'INVALID_ARGUMENT')
      expect(resolveAgentNodePatch(makeState([current]), current, { prompt: '新提示' }).data.params).toEqual({ ...(current.data.params as object), prompt: '新提示' })
    }
  })
  it('rejects forbidden, unknown, complex and non-finite params even for direct callers', () => {
    const node = makeNode(); const state = makeState([node])
    for (const changes of [{ params: { model: 'fake' } }, { params: { unknown: 3 } }, { params: { cameraControl: {} } }, { params: { gen_count: NaN } }, { title: 'x'.repeat(101) }, {}, { value: 'bypass' }]) rejection(() => resolveAgentNodePatch(state, node, changes as never))
    expect(state.nodes[0]).toEqual(node)
  })
  it('validates merged cascade combinations without changing another parameter', () => {
    const state = makeState(); const node = state.nodes[0]
    rejection(() => resolveAgentNodePatch(state, node, { params: { aspect_ratio: '16:9' } }))
    const patch = resolveAgentNodePatch(state, node, { params: { aspect_ratio: '16:9', quality: 'high', gen_count: 2 } })
    expect(patch.data.params).toMatchObject({ aspect_ratio: '16:9', quality: 'high', gen_count: 2, model: 'fixture-model', modelType: 'fixture-mode' })
    expect(node.data.params).toMatchObject({ aspect_ratio: '1:1', quality: 'low' })
  })
  it('updates native empty-media dimensions for ratio edits and preserves dimensions of existing products', () => {
    const state = makeState(); const node = state.nodes[0]
    node.width = 400; node.height = 400; node.measured = { width: 400, height: 400 }
    const before = structuredClone(node)
    const patch = resolveAgentNodePatch(state, node, { params: { aspect_ratio: '16:9', quality: 'high' } })
    expect(patch.width).toBeGreaterThan(400); expect(patch.height).toBe(400)
    expect(patch.measured).toEqual({ width: patch.width, height: patch.height })
    expect(node).toEqual(before)
    for (const type of ['image', 'video']) {
      const existing = { ...node, type, data: { ...node.data, value: 'https://example.test/product.png' } }
      const unchangedSize = resolveAgentNodePatch(makeState([existing]), existing, { params: { aspect_ratio: '16:9', quality: 'high' } })
      expect(unchangedSize).not.toHaveProperty('width'); expect(unchangedSize).not.toHaveProperty('height')
      expect(unchangedSize.data.params).toMatchObject({ aspect_ratio: '16:9', quality: 'high' })
    }
  })
  it('applies native option permissions and preserves successful-empty permission semantics', () => {
    const state = makeState(); const node = state.nodes[0]
    state.modelNodePermission = normalizeModelNodeSettings([{ model_key: 'fixture-model', model_category: 'image', visible: 1, enabled: 1, custom_parameters: { gen_count: { choices: [{ value: 1 }, { value: 2, enabled: 0 }, { value: 4, visible: 0 }] } } }])
    for (const gen_count of [2, 4]) rejection(() => resolveAgentNodePatch(state, node, { params: { gen_count } }))
    const hints = describeAgentNode(state, node).paramHints
    expect(hints.find(item => item.field === 'gen_count')?.choices).toEqual([1])
    state.modelNodePermission = normalizeModelNodeSettings([])
    expect(resolveAgentNodePatch(state, node, { params: { gen_count: 2 } }).data.params).toMatchObject({ gen_count: 2 })
  })
  it('reads other types but rejects special and upload/tool writes', () => {
    for (const node of [makeNode('group'), makeNode('storyboardTool'), { ...makeNode(), data: { ...makeNode().data, type: 'upload' } }, { ...makeNode(), data: { ...makeNode().data, type: 'tool' } }]) {
      const state = makeState([node])
      expect(describeAgentNode(state, node).id).toBe('n1')
      expect(getAgentGenerationCounts(state, node)).toBeNull()
      rejection(() => resolveAgentNodePatch(state, node, { prompt: '不能更新' }), 'UNSUPPORTED_NODE')
    }
  })
})

describe('native node construction and generation counts', () => {
  it('creates UUID/default params/empty media dimensions using the native factory', () => {
    const state = makeState([])
    const node = createAgentNode(state, { type: 'image', changes: { prompt: '商品海报' } })
    expect(node.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(node.position).toEqual({ x: 0, y: 0 })
    expect(node.data.params).toMatchObject({ model: 'fixture-model', modelType: 'fixture-mode', gen_count: 1, prompt: '商品海报' })
    expect(node.width).toBeGreaterThan(0); expect(node.height).toBeGreaterThan(0)
    expect(state.nodes).toEqual([])
    expect(createAgentNode(state, { type: 'text', position: { x: 8, y: 9 }, changes: { text: '脚本' } })).toMatchObject({ position: { x: 8, y: 9 }, data: { value: '脚本' } })
    rejection(() => createAgentNode(state, { type: 'image', id: 'forged' } as never))
  })
  it('counts only configured models with legal gen_count from timeParam', () => {
    const state = makeState(); const node = state.nodes[0]
    expect(getAgentGenerationCounts(state, node)).toEqual({ images: 1, videos: 0 })
    expect(getAgentGenerationCounts(state, makeNode('video'))).toEqual({ images: 0, videos: 1 })
    expect(getAgentGenerationCounts(state, makeNode('text'))).toEqual({ images: 0, videos: 0 })
    expect(getAgentGenerationCounts(state, makeNode('audio'))).toBeNull() // No configured TTS mode in this fixture.
    for (const gen_count of [undefined, 0, -1, 1.5, 3, '1', Number.MAX_SAFE_INTEGER + 1]) expect(getAgentGenerationCounts(state, { ...node, data: { ...node.data, params: { ...(node.data.params as object), gen_count } } })).toBeNull()
    expect(getAgentGenerationCounts({ ...state, modelsMap: {} }, node)).toBeNull()
    const missing = createAgentNode({ ...state, modelsMap: {} }, { type: 'image' })
    expect(getAgentGenerationCounts(state, missing)).toBeNull()
    rejection(() => resolveAgentNodePatch({ ...state, nodes: [missing], modelsMap: {} }, missing, { params: { gen_count: 2 } }), 'CONFIGURATION_ERROR')
  })
  it('preserves model-declared string counts and refuses disabled models', () => {
    const node = makeNode(); const state = makeState([node])
    const modelsMap = structuredClone(state.modelsMap) as Record<string,
      Array<{ params: Array<{ params: Array<{ field: string; choices: Array<{ value: unknown; label: string }> }> }> }>>
    modelsMap.image[0].params[0].params.find(param => param.field === 'gen_count')!.choices = [{ value: '2', label: '2' }]
    state.modelsMap = modelsMap as AgentNodeState['modelsMap']
    node.data.params = { ...(node.data.params as object), gen_count: '2' }
    expect(getAgentGenerationCounts(state, node)).toEqual({ images: 2, videos: 0 })
    state.modelNodePermission = normalizeModelNodeSettings([{ model_key: 'fixture-model', model_category: 'image', visible: 1, enabled: 0 }])
    expect(getAgentGenerationCounts(state, node)).toBeNull()
    expect(describeAgentNode(state, node).params.gen_count).toBe('2')
  })
})

describe('bounded node details', () => {
  it('keeps input edge order/handles and existing product URLs; drops internal/credential data', () => {
    const node = makeNode(); node.data.value = 'https://assets.example/selected.png'
    node.data.product = [{ value: 'https://assets.example/other.png' }, { value: node.data.value }, { value: 'https://user:password@assets.example/private.png' }, { value: 'https://assets.example/private.png?access_token=secret' }]
    const state = makeState([node])
    state.edges = [{ id: 'e2', source: 'up2', target: 'n1', sourceHandle: 'image_source', targetHandle: 'image_target' }, { id: 'e1', source: 'up1', target: 'n1' }]
    const detail = describeAgentNode(state, node)
    expect(detail.inputs.map(input => input.edgeId)).toEqual(['e2', 'e1'])
    expect(detail.inputs[0]).toMatchObject({ nodeId: 'up2', sourceHandle: 'image_source', targetHandle: 'image_target' })
    expect(detail.outputs).toEqual(['https://assets.example/selected.png', 'https://assets.example/other.png'])
    expect(parseCanvasOperationResult({ status: 'read', canvasId: '2873', version: '18', consistency: 'confirmed', nodeCount: 1, nodes: [detail], missingNodeIds: [] })).toMatchObject({ nodes: [detail] })
    expect(detail.params).not.toHaveProperty('seniorParams')
    expect(detail).not.toHaveProperty('taskInfo')
    expect(node.data.product).toHaveLength(4)
  })
  it('reports truncation and readable native status without trimming Store data', () => {
    const node = makeNode('text'); node.data.value = '你'.repeat(32769)
    node.data.title = '长'.repeat(101); node.data.taskInfo = { status: 'running', taskId: 'private-task' }
    const state = makeState([node]); const detail = describeAgentNode(state, node)
    expect(detail.text).toHaveLength(32768); expect(detail.title).toHaveLength(100)
    expect(detail.truncatedFields).toEqual(expect.arrayContaining(['text', 'title']))
    expect(detail.status).toBe('running'); expect(node.data.value).toHaveLength(32769)
  })
  it('caps output URLs and rejects irreducible oversized details', () => {
    const node = makeNode(); node.data.product = Array.from({ length: 21 }, (_, i) => ({ value: `https://assets.example/${i}.png` }))
    const state = makeState([node]); const detail = describeAgentNode(state, node)
    expect(detail.outputs).toHaveLength(20); expect(detail.truncatedFields).toContain('outputs')
    state.edges = Array.from({ length: 25_000 }, (_, i) => ({ id: 'e' + i, source: 'upstream', target: 'n1', sourceHandle: 'image_source', targetHandle: 'image_target' }))
    rejection(() => describeAgentNode(state, node), 'BRIDGE_OVERLOADED')
  })
})
