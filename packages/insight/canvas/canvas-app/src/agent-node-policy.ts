import type { Node } from '@xyflow/react'
import type { useFlowStore } from '../legacy/src/store/flowStore'
import { getAgentNodeGeometry } from './agent-node-placement'
import util, { applyEmptyMediaNodeDimensions, type SelectParam } from '../legacy/src/components/canvasFlow/utils/util'
import { buildMediaNodeParamState, isMediaParamValueUnavailable, validateMediaNodesForRun,
  getImageSvgUnsupportedReason, getImageModelTypeMismatchReason, getVideoModelTypeMismatchReason, getAudioModelTypeMismatchReason, type MediaModelsMap, type MediaNodeType } from '../legacy/src/components/canvasFlow/utils/mediaNodeModelUtil'
import { getChoiceFlag, isChoiceUsable, isModelSelectable, validateBasicNodesParamsForRun } from '../legacy/src/components/canvasFlow/utils/modelPermission'
import { preserveNodeTitle, validateNodeTitle } from '../legacy/src/components/canvasFlow/utils/nodeNaming'
import { isNonGenerativeMedia } from '../legacy/src/components/canvasFlow/utils/type'
import { AudioModelType } from '../legacy/src/components/canvasFlow/customNode/audio/types'
import { createAgentAudioDefaults, getAgentAudioParamHints, resolveAgentAudioConfiguration, validateAgentAudioParams } from './agent-audio-policy'
import { canRunAgentGeneration } from './agent-generation-policy'
import { CanvasAgentError, STANDARD_NODE_TYPES, FORBIDDEN_PARAM_FIELDS,
  MAX_TITLE_LENGTH, MAX_CONTENT_LENGTH, assertCanvasMessageSize, parseNodeChanges, parseNodeDraft, parseCanvasAsset,
  type CanvasAssetInput, type GenerationCounts, type JsonScalar, type NodeChanges, type NodeDetail, type NodeDraft, type ParamHint } from '../../src/shared/canvas-agent-protocol'

export type AgentNodeState = Pick<ReturnType<typeof useFlowStore.getState>, 'nodes' | 'edges' | 'modelsMap' | 'modelNodePermission'>
const scalar = (value: unknown): value is JsonScalar => value === null || typeof value === 'string'
  || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
const paramsOf = (node: Node): Record<string, unknown> => {
  const params = node.data.params
  return params && typeof params === 'object' && !Array.isArray(params) ? params as Record<string, unknown> : {}
}
const isMedia = (node: Node): node is Node & { type: MediaNodeType } => node.type === 'image' || node.type === 'video'
const supported = (node: Node) => STANDARD_NODE_TYPES.some(type => type === node.type) && !isNonGenerativeMedia(String(node.data.type ?? ''))

function mediaParams(state: AgentNodeState, node: Node & { type: MediaNodeType }, params = paramsOf(node)) {
  // The native Store declares the older flat map; image/video actually use the native two-level map.
  const modelsMap = state.modelsMap as MediaModelsMap
  const configured = modelsMap[node.type]?.find(mode => mode.value === params.modelType)?.params.find(model => model.value === params.model)
  if (!configured || !isModelSelectable(state.modelNodePermission, node.type, String(params.model))) {
    throw new CanvasAgentError('CONFIGURATION_ERROR', '当前节点模型或模式未配置，或没有使用权限')
  }
  return buildMediaNodeParamState(modelsMap, node.type, params, state.modelNodePermission)
}
function simpleFields(state: AgentNodeState, node: Node & { type: MediaNodeType }, params: Record<string, unknown>): SelectParam[] {
  const parsed = mediaParams(state, node, params)
  return [...parsed.otherParams, parsed.timeParam].filter(field => field.key && !FORBIDDEN_PARAM_FIELDS.has(field.key))
}
function usableChoices(state: AgentNodeState, node: Node, params: Record<string, unknown>, field: SelectParam): JsonScalar[] {
  return (field.option ?? []).map(choice => choice.value).filter(value => scalar(value)
    && isChoiceUsable(getChoiceFlag(state.modelNodePermission, node.type ?? '', String(params.model), field.key, value)))
}
function positiveCount(value: unknown): number | null {
  // Preserve the native strict choice value type; digit strings are valid only if the model offers them.
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value))) return null
  const count = Number(value)
  return Number.isSafeInteger(count) && count > 0 ? count : null
}
function validateMediaParams(state: AgentNodeState, node: Node & { type: MediaNodeType }, params: Record<string, unknown>): void {
  const fields = simpleFields(state, node, params)
  for (const field of fields) {
    const choices = usableChoices(state, node, params, field)
    if (isMediaParamValueUnavailable(params[field.key], field.option)
      || !choices.some(choice => Object.is(choice, params[field.key]))) {
      throw new CanvasAgentError('INVALID_ARGUMENT', '参数 ' + field.key + ' 不在当前模型允许的选项中')
    }
  }
  if (!fields.some(field => field.key === 'gen_count') || positiveCount(params.gen_count) === null) {
    throw new CanvasAgentError('INVALID_ARGUMENT', '当前模型的 gen_count 缺失或不是合法正整数')
  }
  const updated = { ...node, data: { ...node.data, params } }
  const error = validateMediaNodesForRun([updated], state.modelsMap as MediaModelsMap)
  if (error || !validateBasicNodesParamsForRun([updated], state.modelNodePermission)) {
    throw new CanvasAgentError('INVALID_ARGUMENT', error ?? '节点参数不满足当前权限')
  }
}

export function resolveAgentNodePatch(state: AgentNodeState, node: Node, input: NodeChanges): {
  data: Record<string, unknown>
  width?: number
  height?: number
  measured?: { width: number
    height: number }
} {
  if (!state.nodes.some(item => item.id === node.id)) throw new CanvasAgentError('NODE_NOT_FOUND', '目标节点已不存在')
  const changes = parseNodeChanges(input)
  const ordinary = STANDARD_NODE_TYPES.some(type => type === node.type)
  const sourceOnly = isNonGenerativeMedia(String(node.data.type ?? ''))
  if (!ordinary || (sourceOnly && (node.type === 'text' || Object.keys(changes).some(key => key !== 'title')))) {
    throw new CanvasAgentError('UNSUPPORTED_NODE', '该节点仅允许修改标题，上传或工具产物不能改写内容与生成参数')
  }
  const data: Record<string, unknown> = {}
  if (changes.title !== undefined) {
    const validation = validateNodeTitle({ existingNodes: state.nodes, nodeId: node.id, nextTitle: changes.title })
    if (!validation.ok) throw new CanvasAgentError('INVALID_ARGUMENT', '节点标题不合法：' + validation.reason)
    data.title = validation.title
  }
  if (changes.text !== undefined) {
    if (node.type !== 'text') throw new CanvasAgentError('INVALID_ARGUMENT', 'text 仅用于文本节点')
    data.value = changes.text
  }
  if (changes.params !== undefined && !isMedia(node) && node.type !== 'audio') throw new CanvasAgentError('INVALID_ARGUMENT', '仅开放图片、视频和音频的技术参数编辑')
  if (changes.prompt !== undefined || changes.params !== undefined) {
    const params = { ...paramsOf(node), ...changes.params }
    if (changes.prompt !== undefined) params.prompt = changes.prompt
    if (changes.params !== undefined && node.type === 'audio') {
      const patch = resolveAgentAudioConfiguration(state, { ...node, data: { ...node.data, params: { ...paramsOf(node),
        prompt: params.prompt } } }, { params: changes.params })
      Object.assign(params, patch.data.params)
    }
    if (changes.params !== undefined && isMedia(node)) {
      const fields = simpleFields(state, node, params)
      for (const key of Object.keys(changes.params)) {
        if (!fields.some(field => field.key === key && usableChoices(state, node, params, field).length > 0)) {
          throw new CanvasAgentError('INVALID_ARGUMENT', '本期不开放参数 ' + key)
        }
      }
      validateMediaParams(state, node, params)
    }
    data.params = params
  }
  if (data.params !== undefined) {
    const sized = applyEmptyMediaNodeDimensions({ ...node, data: { ...node.data, ...data } })
    if ((sized.width !== node.width || sized.height !== node.height)
      && typeof sized.width === 'number' && typeof sized.height === 'number') {
      return { data, width: sized.width, height: sized.height, measured: { width: sized.width, height: sized.height } }
    }
  }
  return { data }
}

/** Constructs a draft only. addNode remains responsible for title allocation and persistence. */
export function createAgentNode(state: AgentNodeState, input: NodeDraft): Node {
  const draft = parseNodeDraft(input)
  const node: Node = util.createNode(state.modelsMap, { type: draft.type, position: draft.position ?? (draft.placement?.mode === 'absolute' ? draft.placement.position : { x: 0, y: 0 }) }, state.modelNodePermission)
  if (draft.type === 'audio') node.data.params = createAgentAudioDefaults(state)
  if (draft.changes) {
    // Include the draft for title validation without putting it into the actual Store.
    const patch = resolveAgentNodePatch({ ...state, nodes: [...state.nodes, node] }, node, draft.changes)
    node.data = { ...node.data, ...patch.data }
  }
  const sized = applyEmptyMediaNodeDimensions(node)
  return draft.changes?.title !== undefined ? preserveNodeTitle(sized) : sized
}

/** Trusted text/media input; native Store owns naming, dimensions and strict persistence. */
export function createAgentAssetNode(state: AgentNodeState, input: CanvasAssetInput): Node {
  const asset = parseCanvasAsset(input)
  const node: Node = util.createNode(state.modelsMap, { type: asset.mediaType ?? 'image', position: asset.position ?? (asset.placement?.mode === 'absolute' ? asset.placement.position : { x: 0, y: 0 }) }, state.modelNodePermission)
  node.data = asset.mediaType === 'text' ? { ...node.data, value: asset.text } : util.buildMediaUploadNodeData(node.data, asset.url)
  if (asset.title !== undefined) {
    const validation = validateNodeTitle({ existingNodes: [...state.nodes, node], nodeId: node.id, nextTitle: asset.title })
    if (!validation.ok) throw new CanvasAgentError('INVALID_ARGUMENT', '节点标题不合法：' + validation.reason)
    node.data.title = validation.title
    return preserveNodeTitle(node)
  }
  return node
}

export function getAgentGenerationCounts(state: AgentNodeState, node: Node): GenerationCounts | null {
  if (!supported(node)) return null
  if (node.type === 'audio') {
    if (!canRunAgentGeneration(node)) return null
    try { validateAgentAudioParams(state, node) } catch (error) {
      if (error instanceof CanvasAgentError) return null
      throw error
    }
    return { images: 0, videos: 0, audios: Number(paramsOf(node).gen_count) }
  }
  if (!isMedia(node)) return { images: 0, videos: 0 }
  try { validateMediaParams(state, node, paramsOf(node)) } catch (error) {
    if (error instanceof CanvasAgentError) return null
    throw error
  }
  const count = positiveCount(paramsOf(node).gen_count)!
  return node.type === 'image' ? { images: count, videos: 0 } : { images: 0, videos: count }
}

/** Same prompt/input-mode prerequisites used by native PromptModel panels, without mounting them. */
export function validateAgentRunInputs(state: AgentNodeState, node: Node): void {
  if (node.type === 'audio') {
    if (!canRunAgentGeneration(node)) throw new CanvasAgentError('UNSUPPORTED_NODE', '音频生成仅支持普通配音、文生音乐或音乐参考节点')
    validateAgentAudioParams(state, node)
  }
  for (const edge of state.edges.filter(item => item.target === node.id)) {
    const source = state.nodes.find(item => item.id === edge.source)
    if (!source) throw new CanvasAgentError('RUN_REJECTED', '上游素材节点已不存在，请先修正连接')
    if ((source.data.taskInfo as { status?: string } | undefined)?.status === 'running') throw new CanvasAgentError('NODE_BUSY', '上游素材仍在生成，请完成后再执行目标节点')
    if (['image', 'video', 'audio'].includes(source.type ?? '') && (typeof source.data.value !== 'string' || !source.data.value.trim())) {
      throw new CanvasAgentError('RUN_REJECTED', '上游素材尚无可用产物，请先完成素材准备')
    }
  }
  const params = paramsOf(node)
  const model = String(params.model ?? '')
  const configured = node.type === 'text'
    ? state.modelsMap.text?.some((item: any) => item.value === model)
    : state.modelsMap[node.type ?? '']?.some((mode: any) => mode.value === params.modelType && mode.params?.some((item: any) => item.value === model))
  if (!model || !configured || !isModelSelectable(state.modelNodePermission, node.type ?? '', model)) throw new CanvasAgentError('RUN_REJECTED', '节点缺少可用模型，请先在画布中配置')
  const { texts, images, videos, audios } = util.getSourceMap(state.nodes, state.edges, node.id)
  const nonTextCount = images.length + videos.length + audios.length
  const mismatch = node.type === 'image' ? getImageModelTypeMismatchReason(String(params.modelType ?? ''), images.length)
    : node.type === 'video' ? getVideoModelTypeMismatchReason(String(params.modelType ?? ''), images.length, videos.length > 0 || audios.length > 0)
      : node.type === 'audio' ? getAudioModelTypeMismatchReason(String(params.modelType ?? ''), nonTextCount, audios.length) : undefined
  if (mismatch) throw new CanvasAgentError('RUN_REJECTED', mismatch)
  const svgTip = node.type === 'image' ? getImageSvgUnsupportedReason(model, images) : undefined
  if (svgTip) throw new CanvasAgentError('RUN_REJECTED', svgTip)
  if (node.type === 'audio' && params.modelType === AudioModelType.TTS && !String(params.voiceId ?? '').trim()) throw new CanvasAgentError('RUN_REJECTED', '请先选择音色')
  if (!String(params.prompt ?? '').trim() && !texts.some(item => item.value?.trim()) && nonTextCount === 0) throw new CanvasAgentError('RUN_REJECTED', '请提供提示词或有效的上游素材')
  const senior = params.seniorParams as Record<string, unknown> | undefined
  if (node.type === 'audio' && senior?.customMode) {
    if (!String(senior.title ?? '').trim()) throw new CanvasAgentError('RUN_REJECTED', '请输入歌曲标题')
    if (!senior.instrumental && !String(senior.lyrics ?? '').trim()) throw new CanvasAgentError('RUN_REJECTED', '请输入歌词')
  }
}

function outputUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || [...url.searchParams.keys()].some(key => /^(token|access_token|authorization|bridgekey)$/i.test(key))) return null
    return value
  } catch { return null }
}

export function describeAgentNode(state: AgentNodeState, node: Node): NodeDetail {
  const truncatedFields: string[] = []
  const bounded = (value: string, limit: number, field: string) => {
    if (value.length > limit) truncatedFields.push(field)
    return value.slice(0, limit)
  }
  const params = paramsOf(node)
  const paramHints: ParamHint[] = []
  let seniorParamHints: ParamHint[] | undefined
  if (node.type === 'audio' && canRunAgentGeneration(node)) {
    try {
      const audioHints = getAgentAudioParamHints(state, params)
      paramHints.push(...audioHints.paramHints)
      seniorParamHints = audioHints.seniorParamHints
    } catch (error) { if (!(error instanceof CanvasAgentError)) throw error }
  }
  if (supported(node) && isMedia(node)) {
    try {
      for (const field of simpleFields(state, node, params)) {
        const choices = usableChoices(state, node, params, field)
        paramHints.push({ field: field.key, editable: choices.length > 0, choices })
      }
    } catch (error) { if (!(error instanceof CanvasAgentError)) throw error }
  }
  const scalarParams = Object.fromEntries(Object.entries(params).filter(([key, value]) => !['__proto__', 'constructor', 'prototype'].includes(key) && scalar(value))
    .map(([key, value]) => [key, typeof value === 'string' ? bounded(value, MAX_CONTENT_LENGTH, 'params.' + key) : value])) as Record<string, JsonScalar>
  const products = Array.isArray(node.data.product) ? node.data.product : []
  const outputs = [...new Set([node.type === 'text' ? null : node.data.value, ...products.map(item => item && typeof item === 'object' ? item.value : null)].map(outputUrl).filter((value): value is string => value !== null))]
  if (outputs.length > 20) truncatedFields.push('outputs')
  const taskInfo = node.data.taskInfo as { status?: unknown } | undefined
  const detail: NodeDetail = {
    id: node.id, type: node.type ?? '', ...getAgentNodeGeometry(node),
    title: bounded(typeof node.data.title === 'string' ? node.data.title : '', MAX_TITLE_LENGTH, 'title'),
    contentType: typeof node.data.type === 'string' ? node.data.type : null,
    text: node.type === 'text' && typeof node.data.value === 'string' ? bounded(node.data.value, MAX_CONTENT_LENGTH, 'text') : null,
    prompt: typeof params.prompt === 'string' ? bounded(params.prompt, MAX_CONTENT_LENGTH, 'prompt') : null,
    params: scalarParams, paramHints, ...(node.type === 'audio' && params.seniorParams && typeof params.seniorParams === 'object' && !Array.isArray(params.seniorParams) ? { seniorParamHints: seniorParamHints ?? [],
      seniorParams: Object.fromEntries(Object.entries((params.seniorParams ?? {}) as object).filter(([key, value]) => !['__proto__', 'constructor', 'prototype'].includes(key) && scalar(value))
        .map(([key, value]) => [key, typeof value === 'string' ? bounded(value, MAX_CONTENT_LENGTH, 'seniorParams.' + key) : value])) as Record<string, JsonScalar> } : {}),
    status: typeof taskInfo?.status === 'string' ? taskInfo.status : 'unknown',
    // Raw incoming edges retain missing sources, duplicate references and exact handle order.
    inputs: state.edges.filter(edge => edge.target === node.id).map(edge => ({ nodeId: edge.source, edgeId: edge.id,
      sourceHandle: edge.sourceHandle ?? null, targetHandle: edge.targetHandle ?? null })),
    outputs: outputs.slice(0, 20), generation: getAgentGenerationCounts(state, node), truncatedFields,
  }
  assertCanvasMessageSize(detail)
  return detail
}

// Shared native validation for the dedicated generation-configuration entry point.
export { simpleFields as getAgentMediaParamFields, validateMediaParams as validateAgentMediaParams }
