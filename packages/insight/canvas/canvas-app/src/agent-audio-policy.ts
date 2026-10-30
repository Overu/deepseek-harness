import type { Node } from '@xyflow/react'
import { CanvasAgentError, MAX_CONTENT_LENGTH, parseNodeConfiguration, type JsonScalar, type NodeConfiguration, type ParamHint } from '../../src/shared/canvas-agent-protocol'
import { AudioModelType } from '../legacy/src/components/canvasFlow/customNode/audio/types'
import { creareDefaultParamsV2, type V2ModelsMap } from '../legacy/src/components/canvasFlow/utils/mediaNodeModelUtil'
import { getChoiceFlag, isChoiceUsable, isModelSelectable } from '../legacy/src/components/canvasFlow/utils/modelPermission'
import { canConfigureAgentGeneration } from './agent-generation-policy'
import type { AgentNodeState } from './agent-node-policy'

interface AudioField {
  field: string
  type?: string
  default?: JsonScalar
  choices?: Array<{ value: JsonScalar
  }>
  min?: number
  max?: number
  step?: number
  maxLength?: number
}
export interface AgentAudioModel {
  value: string
  label: string
  params: AudioField[]
  seniorParams?: AudioField[]
  platform?: string
  modelId?: string
}
const scalar = (value: unknown): value is JsonScalar => value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)
const invalid = (message: string): never => { throw new CanvasAgentError('INVALID_ARGUMENT', message) }
export const agentAudioModes = (state: AgentNodeState) =>
  ((state.modelsMap as V2ModelsMap).audio ?? []).filter(mode => Object.values(AudioModelType).some(value => value === mode.value))
export function getAgentAudioModel(state: AgentNodeState, params: Record<string, unknown>): AgentAudioModel {
  const mode = agentAudioModes(state).find(mode => mode.value === params?.modelType)
  if (!mode) throw new CanvasAgentError('UNSUPPORTED_NODE', '音频生成模式不可用，请查询tts、text_to_audio或audio_to_audio')
  const model = mode.params.find(model => model.value === params.model)
  if (!model || !isModelSelectable(state.modelNodePermission, 'audio', String(params.model))) throw new CanvasAgentError('CONFIGURATION_ERROR', '音频模型不存在或当前账号无使用权限')
  return model as AgentAudioModel
}
export function createAgentAudioDefaults(state: AgentNodeState, model?: string, modelType?: string): Record<string, unknown> {
  const modes = agentAudioModes(state).filter(mode => mode.params.some(item => isModelSelectable(state.modelNodePermission, 'audio', String(item.value))))
  const mode = modelType !== undefined ? modes.find(mode => mode.value === modelType)
    : model !== undefined ? modes.find(mode => mode.params.some(item => item.value === model && isModelSelectable(state.modelNodePermission, 'audio', String(item.value))))
      : modes.find(mode => mode.value === AudioModelType.TTS) ?? modes[0]
  const selected = model ?? mode?.params.find(item => isModelSelectable(state.modelNodePermission, 'audio', String(item.value)))?.value
  getAgentAudioModel(state, { modelType: mode?.value, model: selected })
  const params = creareDefaultParamsV2({ audio: [mode!] }, 'audio', mode!.value, String(selected), state.modelNodePermission)
  // Reference audio comes from graph edges, never an Agent-supplied URL parameter.
  delete params.uploadUrl
  delete params.seniorParams.uploadUrl
  if (mode!.value !== AudioModelType.TTS) {
    delete params.voiceId
    params.seniorParams = { title: '', lyrics: '', ...params.seniorParams }
  }
  return params
}
/** Bind submission checks to both the node parameters and the actual declared model metadata. */
export const agentAudioConfigurationKey = (state: AgentNodeState, node: Node): string =>
  JSON.stringify({ params: node.data.params, model: getAgentAudioModel(state, node.data.params as Record<string, unknown>) })
function basicFields(model: AgentAudioModel): AudioField[] {
  return model.params.filter(field => !['voiceId', 'uploadUrl'].includes(field.field))
}
function seniorFields(model: AgentAudioModel, modelType: unknown): AudioField[] {
  const fields = (model.seniorParams ?? []).filter(field => field.field !== 'uploadUrl')
  if (modelType === AudioModelType.TTS) return fields
  // These native editor fields are not always included in the model's parameter metadata.
  return [...fields.filter(field => !['title', 'lyrics'].includes(field.field)),
    { field: 'title', type: 'string', maxLength: 100, default: '' }, { field: 'lyrics', type: 'string', maxLength: 500, default: '' }]
}
function validValue(state: AgentNodeState, model: string, field: AudioField, value: unknown): boolean {
  if (!scalar(value)) return false
  const permitted = () => isChoiceUsable(getChoiceFlag(state.modelNodePermission, 'audio', model, field.field, value))
  if (field.type === 'string') {
    const maxLength = field.maxLength ?? MAX_CONTENT_LENGTH
    return Number.isSafeInteger(maxLength) && maxLength >= 0 && typeof value === 'string' && value.length <= Math.min(maxLength, MAX_CONTENT_LENGTH) && permitted()
  }
  if (field.type === 'number') {
    const min = field.min ?? 0, max = field.max ?? 100, step = field.step ?? 1
    return typeof value === 'number' && [min, max, step].every(Number.isFinite) && max >= min && step > 0
      && value >= min && value <= max && Math.abs((value - min) / step - Math.round((value - min) / step)) <= 1e-7 && permitted()
  }
  return !!field.choices?.some(choice => Object.is(choice.value, value)) && permitted()
}
function hints(state: AgentNodeState, model: string, fields: AudioField[]): ParamHint[] {
  return fields.map((field) => {
    const common = { field: field.field, ...(scalar(field.default) && validValue(state, model, field,
      field.default) ? { default: field.default } : {}) }
    if (field.type === 'string') {
      const maxLength = field.maxLength ?? MAX_CONTENT_LENGTH
      return { ...common, type: 'string', maxLength: Math.min(maxLength, MAX_CONTENT_LENGTH), editable: Number.isSafeInteger(maxLength) && maxLength >= 0 }
    }
    if (field.type === 'number') {
      const min = field.min ?? 0, max = field.max ?? 100, step = field.step ?? 1
      return { ...common, editable: [min, max, step].every(Number.isFinite) && max >= min && step > 0, min, max, step }
    }
    const choices = (field.choices ?? []).map(choice => choice.value).filter(value => scalar(value) && validValue(state,
      model, field, value))
    return { ...common, editable: choices.length > 0, choices }
  })
}
export function getAgentAudioParamHints(state: AgentNodeState, params: Record<string, unknown>) {
  const model = getAgentAudioModel(state, params), basic = basicFields(model)
  const paramHints = hints(state, model.value, basic)
  if (!basic.some(field => field.field === 'gen_count')) paramHints.push({ field: 'gen_count', editable: true, choices: [1], default: 1 })
  return { paramHints, seniorParamHints: hints(state, model.value, seniorFields(model, params.modelType)) }
}
export function validateAgentAudioParams(state: AgentNodeState, node: Node): void {
  const params = node.data.params as Record<string, unknown>, model = getAgentAudioModel(state, params)
  const count = params.gen_count
  if (!(typeof count === 'number' || typeof count === 'string' && /^[1-9][0-9]*$/u.test(count)) || !Number.isSafeInteger(Number(count)) || Number(count) <= 0) invalid('音频生成数量无效')
  const basic = basicFields(model)
  if (!basic.some(field => field.field === 'gen_count') && count !== 1) invalid('当前音频模型只声明默认生成1条音频')
  for (const field of basic) if (!validValue(state, model.value, field, params[field.field])) invalid('音频参数 ' + field.field + ' 不符合当前模型或权限')
  const senior = params.seniorParams
  if (!senior || typeof senior !== 'object' || Array.isArray(senior)) invalid('音频高级参数缺失')
  const values = senior as Record<string, unknown>, definitions = seniorFields(model, params.modelType)
  for (const key of Object.keys(values)) if (!definitions.some(field => field.field === key) && !(key === 'uploadUrl' && values[key] === '')) invalid('本期不开放音频高级字段 ' + key)
  for (const field of definitions) {
    const value = values[field.field] === undefined && params.modelType !== AudioModelType.TTS && ['title', 'lyrics'].includes(field.field) ? '' : values[field.field]
    if (!validValue(state, model.value, field, value)) invalid('音频高级参数 ' + field.field + ' 不符合选项、范围或步长')
  }
  if (params.uploadUrl !== undefined && params.uploadUrl !== '') invalid('参考音频必须来自画布连线')
  if (params.modelType === AudioModelType.TTS) {
    if (params.voiceId !== undefined && (typeof params.voiceId !== 'string' || params.voiceId.length > 200)) invalid('音色ID不合法')
    if (params.voiceId && !isChoiceUsable(getChoiceFlag(state.modelNodePermission, 'audio', model.value, 'voiceId', params.voiceId))) invalid('当前账号不可使用该音色')
  }
}
export function resolveAgentAudioConfiguration(state: AgentNodeState, node: Node,
  input: NodeConfiguration): { data: { params: Record<string, unknown> } } {
  const configuration = parseNodeConfiguration(input)
  if (node.type !== 'audio' || !canConfigureAgentGeneration(node)) throw new CanvasAgentError('UNSUPPORTED_NODE', '仅配置普通音频节点，不能改写上传或工具产物')
  const origin = node.data.params && typeof node.data.params === 'object' && !Array.isArray(node.data.params) ? node.data.params as Record<string, unknown> : {}
  const modelType = configuration.modelType ?? String(origin.modelType ?? AudioModelType.TTS)
  const changed = modelType !== origin.modelType || configuration.model !== undefined && configuration.model !== origin.model
  const params: Record<string, unknown> = changed ? { ...createAgentAudioDefaults(state, configuration.model, modelType), prompt: origin.prompt ?? '' } : { ...origin }
  const model = getAgentAudioModel(state, params), explicit = configuration.params ?? {}
  for (const key of Object.keys(explicit)) if (!['gen_count', ...basicFields(model).map(field => field.field)].includes(key)) invalid('本期不开放音频参数 ' + key)
  if (configuration.voiceId !== undefined && modelType !== AudioModelType.TTS) invalid('voiceId仅用于TTS配音')
  Object.assign(params, explicit, configuration.voiceId !== undefined ? { voiceId: configuration.voiceId } : {})
  params.seniorParams = { ...(params.seniorParams as object), ...configuration.seniorParams }
  validateAgentAudioParams(state, { ...node, data: { ...node.data, params } })
  return { data: { params } }
}
