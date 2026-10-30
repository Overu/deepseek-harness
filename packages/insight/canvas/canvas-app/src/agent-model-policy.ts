import type { Node } from '@xyflow/react'
import util, { applyEmptyMediaNodeDimensions } from '../legacy/src/components/canvasFlow/utils/util'
import { applyMediaModelTypeChange, buildMediaNodeParamState, creareDefaultParamsV2, getTransformItems,
  getImageModelTypeMismatchReason, getVideoModelTypeMismatchReason, getAudioModelTypeMismatchReason, resolveParamsOnModelChange,
  type V2ModelsMap, type MediaNodeType } from '../legacy/src/components/canvasFlow/utils/mediaNodeModelUtil'
import { getChoiceFlag, isChoiceUsable, isModelSelectable, getModelRow } from '../legacy/src/components/canvasFlow/utils/modelPermission'
import { isNonGenerativeMedia } from '../legacy/src/components/canvasFlow/utils/type'
import { CanvasAgentError, parseCanvasOperation, parseNodeConfiguration, FORBIDDEN_PARAM_FIELDS,
  type CanvasOperation, type JsonScalar, type ModelCatalogSnapshot, type NodeConfiguration, type ParamHint } from '../../src/shared/canvas-agent-protocol'
import { getAgentMediaParamFields, validateAgentMediaParams, type AgentNodeState } from './agent-node-policy'
import { agentAudioModes, createAgentAudioDefaults, getAgentAudioParamHints, resolveAgentAudioConfiguration } from './agent-audio-policy'

type ModelsQuery = Extract<CanvasOperation, { action: 'canvas.models.read' }>
const paramsOf = (node: Node): Record<string, unknown> => node.data.params && typeof node.data.params === 'object'
  && !Array.isArray(node.data.params) ? node.data.params as Record<string, unknown> : {}
const mediaMap = (state: AgentNodeState) => state.modelsMap as V2ModelsMap
const isMedia = (node: Node): node is Node & { type: MediaNodeType } => node.type === 'image' || node.type === 'video'
const scalar = (value: unknown): value is JsonScalar => value === null || typeof value === 'string'
  || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))

function canonical(value: unknown): unknown {
  if (value instanceof Map) return [...value.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([key, item]) => [key, canonical(item)])
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .map(key => [key, canonical((value as Record<string, unknown>)[key])]))
  return value
}

function paramHints(state: AgentNodeState, type: MediaNodeType, params: Record<string, unknown>): ParamHint[] {
  const parsed = buildMediaNodeParamState(mediaMap(state), type, params, state.modelNodePermission)
  return [...parsed.otherParams, parsed.timeParam].filter(field => field.key && !FORBIDDEN_PARAM_FIELDS.has(field.key))
    .map((field) => {
      const choices = (field.option ?? []).map(choice => choice.value).filter(value => scalar(value)
        && isChoiceUsable(getChoiceFlag(state.modelNodePermission, type, String(params.model), field.key, value)))
      return { field: field.key, editable: choices.length > 0, choices }
    })
}

/** Snapshot pages share a digest of the native model and permission configuration. */
export async function readAgentModels(state: AgentNodeState, input: ModelsQuery): Promise<ModelCatalogSnapshot> {
  const query = parseCanvasOperation(input) as ModelsQuery
  const modelsMap = mediaMap(state)
  const encoded = new TextEncoder().encode(JSON.stringify(canonical({ nodeType: query.nodeType,
    models: modelsMap[query.nodeType] ?? [], permission: state.modelNodePermission })))
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  const catalogVersion = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  const modeOffset = query.modeOffset ?? 0
  const modelOffset = query.modelOffset ?? 0
  const limit = query.limit ?? 20
  if ((modeOffset > 0 || modelOffset > 0) && !query.expectedCatalogVersion) {
    throw new CanvasAgentError('INVALID_ARGUMENT', '模型目录续页需要 expectedCatalogVersion')
  }
  if (query.expectedCatalogVersion && query.expectedCatalogVersion !== catalogVersion) {
    throw new CanvasAgentError('CATALOG_VERSION_CONFLICT', '模型或权限目录已变化，请从第一页重新读取')
  }
  const modes = (query.nodeType === 'audio' ? agentAudioModes(state) : modelsMap[query.nodeType] ?? []).filter(mode => mode.params?.some(model =>
    isModelSelectable(state.modelNodePermission, query.nodeType, String(model.value))))
  const selectedMode = query.modelType !== undefined ? modes.find(mode => mode.value === query.modelType)
    : query.model !== undefined ? modes.find(mode => mode.params.some(model => model.value === query.model
      && isModelSelectable(state.modelNodePermission, query.nodeType, String(model.value))))
      : (query.nodeType === 'audio' ? modes.find(mode => mode.value === 'tts') : undefined) ?? modes[0]
  if ((query.modelType !== undefined || query.model !== undefined) && !selectedMode) {
    throw new CanvasAgentError('CONFIGURATION_ERROR', '指定模式或模型未配置，或当前账号没有使用权限')
  }
  const models = (selectedMode?.params ?? []).filter(model => isModelSelectable(state.modelNodePermission, query.nodeType,
    String(model.value)))
  const selectedModel = query.model !== undefined ? models.find(model => model.value === query.model) : models[0]
  if (query.model !== undefined && !selectedModel) {
    throw new CanvasAgentError('CONFIGURATION_ERROR', '指定模型不属于该模式，或当前账号没有使用权限')
  }
  const defaults = selectedMode && selectedModel
    ? query.nodeType === 'audio' ? createAgentAudioDefaults(state, String(selectedModel.value), selectedMode.value)
      : creareDefaultParamsV2(modelsMap, query.nodeType, selectedMode.value, String(selectedModel.value), state.modelNodePermission) : null
  return { catalogVersion, nodeType: query.nodeType,
    modes: modes.slice(modeOffset, modeOffset + limit).map(mode => ({ value: mode.value, label: mode.label })),
    modeCount: modes.length, modeOffset, nextModeOffset: modeOffset + limit < modes.length ? modeOffset + limit : null,
    modelType: selectedMode?.value ?? null,
    models: models.slice(modelOffset, modelOffset + limit).map(model => ({ value: String(model.value), label: model.label })),
    modelCount: models.length, modelOffset, nextModelOffset: modelOffset + limit < models.length ? modelOffset + limit : null,
    model: selectedModel ? String(selectedModel.value) : null,
    paramHints: defaults ? query.nodeType === 'audio' ? getAgentAudioParamHints(state, defaults).paramHints : paramHints(state, query.nodeType, defaults) : [],
    ...(query.nodeType === 'audio' && defaults ? { seniorParamHints: getAgentAudioParamHints(state, defaults).seniorParamHints,
      ...(selectedMode?.value === 'tts' ? { voiceSelection: { required: true, customizable: getModelRow(state.modelNodePermission, 'audio', String(selectedModel!.value))?._voiceCustomizable ?? true } } : {}) } : {}) }
}

/** Native input semantics count resolved materials, rather than empty source nodes. */
export function getAgentInputCompatibility(state: AgentNodeState, node: Node): string | null {
  if ((!isMedia(node) && node.type !== 'audio') || isNonGenerativeMedia(String(node.data.type ?? ''))) return null
  const params = paramsOf(node)
  const { images, videos, audios } = util.getSourceMap(state.nodes, state.edges, node.id)
  return (node.type === 'image' ? getImageModelTypeMismatchReason(String(params.modelType ?? ''), images.length)
    : node.type === 'audio' ? getAudioModelTypeMismatchReason(String(params.modelType ?? ''), images.length + videos.length + audios.length, audios.length)
      : getVideoModelTypeMismatchReason(String(params.modelType ?? ''), images.length, videos.length > 0 || audios.length > 0)) ?? null
}

/** Only configuration changes: native content, sources, products and execution state are preserved. */
export function resolveAgentNodeConfiguration(state: AgentNodeState, node: Node, input: NodeConfiguration): {
  data: Record<string, unknown>
  width?: number
  height?: number
  measured?: { width: number
    height: number }
} {
  const configuration = parseNodeConfiguration(input)
  if (!state.nodes.some(current => current.id === node.id)) throw new CanvasAgentError('NODE_NOT_FOUND', '目标节点已不存在')
  if (node.type === 'audio') return resolveAgentAudioConfiguration(state, node, configuration)
  if (configuration.voiceId !== undefined || configuration.seniorParams !== undefined) throw new CanvasAgentError('INVALID_ARGUMENT', 'voiceId和seniorParams仅用于音频配置')
  if (!isMedia(node) || isNonGenerativeMedia(String(node.data.type ?? ''))) {
    throw new CanvasAgentError('UNSUPPORTED_NODE', '本期仅配置普通图片和视频生成节点，不改写上传或工具产物')
  }
  const modelsMap = mediaMap(state)
  const origin = paramsOf(node)
  let params = configuration.modelType !== undefined
    ? applyMediaModelTypeChange(modelsMap, node.type, configuration.modelType, origin) : { ...origin }
  const mode = modelsMap[node.type]?.find(item => item.value === params.modelType)
  if (!mode) throw new CanvasAgentError('CONFIGURATION_ERROR', '指定生成模式未配置')
  const modelKey = configuration.model ?? String(params.model ?? '')
  if (!mode.params.some(model => model.value === modelKey)
    || !isModelSelectable(state.modelNodePermission, node.type, modelKey)) {
    throw new CanvasAgentError('CONFIGURATION_ERROR', '模型不属于当前模式，或当前账号没有使用权限；请先查询可用模型')
  }
  const changedModel = modelKey !== origin.model || params.modelType !== origin.modelType
  if (changedModel || configuration.model !== undefined) {
    params = resolveParamsOnModelChange(modelsMap, node.type, modelKey, params, state.modelNodePermission)
  }
  const explicit = configuration.params ?? {}
  const fields = getAgentMediaParamFields(state, node, params)
  for (const key of Object.keys(explicit)) {
    if (!fields.some(field => field.key === key)) {
      throw new CanvasAgentError('INVALID_ARGUMENT', '本期不开放参数 ' + key)
    }
  }
  // Use the native cascade defaults only for omitted children. Explicit child values are validated below.
  for (const field of fields) {
    if (!Object.hasOwn(explicit, field.key)) continue
    const value = explicit[field.key]
    if (value === null) continue
    const cascade = field.cascade?.[String(value)]
    if (cascade && Object.entries(cascade).some(([, choices]) => !Array.isArray(choices) || choices.length === 0)) {
      throw new CanvasAgentError('INVALID_ARGUMENT', '参数 ' + field.key + ' 的级联子参数没有可用选项')
    }
    for (const child of getTransformItems(fields, field.key, value)) {
      if (!Object.hasOwn(explicit, child.key)) params[child.key] = child.value
    }
  }
  params = { ...params, ...explicit }
  validateAgentMediaParams(state, node, params)
  const updated = applyEmptyMediaNodeDimensions({ ...node, data: { ...node.data, params } })
  return { data: { params }, ...((updated.width !== node.width || updated.height !== node.height)
    && typeof updated.width === 'number' && typeof updated.height === 'number' ? {
      width: updated.width, height: updated.height, measured: { width: updated.width, height: updated.height } } : {}) }
}
