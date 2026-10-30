import { checkProcessInput, checkProcessResult, type ProcessOperation, type ProcessResult } from './canvas-process-protocol.ts'
import { parseCanvasId } from './protocol.ts'
import { isGenerationCounts, sameGenerationCounts } from './canvas-generation-counts.ts'

export const MAX_MESSAGE_BYTES = 2 * 1024 * 1024
export const MAX_NODE_IDS = 20
export const MAX_TITLE_LENGTH = 100
export const MAX_CONTENT_LENGTH = 32_768
export const MAX_NODE_ID_LENGTH = 100
// Native XYFlow IDs compose two node IDs and handles (up to 610 characters).
export const MAX_EDGE_ID_LENGTH = 1024
export const MAX_ROUTING_ID_LENGTH = 200
export const STANDARD_NODE_TYPES = ['text', 'image', 'video', 'audio'] as const

export type JsonScalar = string | number | boolean | null
export type Version = string
export type StandardNodeType = typeof STANDARD_NODE_TYPES[number]
export interface GenerationCounts { images: number
  videos: number
  audios?: number }
export interface NodeChanges {
  title?: string
  prompt?: string
  text?: string
  params?: Record<string, JsonScalar>
}
export interface NodeConfiguration {
  modelType?: string
  model?: string
  params?: Record<string, JsonScalar>
  voiceId?: string
  seniorParams?: Record<string, JsonScalar>
}
export interface EdgeConnection {
  sourceNodeId: string
  targetNodeId: string
  sourceHandle?: string
  targetHandle?: string
}
export type EdgeEditOperation =
  | { action: 'edge.add'
    expectedVersion: Version
    connection: EdgeConnection }
  | { action: 'edge.delete'
    expectedVersion: Version
    edgeIds: string[] }
  | { action: 'edge.reconnect'
    expectedVersion: Version
    edgeId: string
    connection: EdgeConnection }
  | { action: 'edge.reorder'
    expectedVersion: Version
    targetNodeId: string
    edgeIds: string[] }
export type NodePlacement =
  | { mode: 'auto' }
  | { mode: 'absolute'
    position: { x: number
      y: number } }
  | { mode: 'after'
    anchorNodeId: string }
export type CanvasAssetInput = { title?: string
  position?: { x: number
    y: number }
  placement?: NodePlacement } & (
  | { mediaType?: 'image'
    url: string }
  | { mediaType: 'video' | 'audio'
    url: string }
  | { mediaType: 'text'
    text: string }
)
export interface NodeDraft {
  type: StandardNodeType
  position?: { x: number
    y: number }
  placement?: NodePlacement
  changes?: NodeChanges
}
export interface ParamHint {
  field: string
  type?: 'string'
  maxLength?: number
  choices?: JsonScalar[]
  min?: number
  max?: number
  step?: number
  default?: JsonScalar
  editable: boolean
}
export interface NodeDetail {
  id: string
  type: string
  title: string
  position?: { x: number
    y: number }
  size?: { width: number
    height: number }
  parentId?: string | null
  contentType: string | null
  text: string | null
  prompt: string | null
  params: Record<string, JsonScalar>
  paramHints: ParamHint[]
  status: string
  inputs: Array<{ nodeId: string
    edgeId: string
    sourceHandle: string | null
    targetHandle: string | null }>
  outputs: string[]
  generation: GenerationCounts | null
  truncatedFields: string[]
  seniorParams?: Record<string, JsonScalar>
  seniorParamHints?: ParamHint[]
}
export const ERROR_CODES = [
  'ASSET_NOT_FOUND', 'ASSET_UPLOAD_REJECTED', 'ASSET_UPLOAD_UNKNOWN', 'ASSET_REGISTRATION_REJECTED',
  'ASSET_READ_REJECTED', 'ASSET_VALIDATION_REJECTED',
  'INVALID_ARGUMENT', 'AGENT_CONTEXT_REQUIRED', 'CLIENT_UNAVAILABLE',
  'CLIENT_AMBIGUOUS', 'CONTEXT_GONE', 'CONTEXT_NOT_READY', 'CONTEXT_INACTIVE', 'FRAME_NOT_READY', 'FRAME_INACTIVE', 'FRAME_GONE',
  'READ_TIMEOUT', 'READ_REJECTED', 'READ_ONLY', 'NODE_NOT_FOUND', 'EDGE_NOT_FOUND', 'INVALID_CONNECTION',
  'CATALOG_VERSION_CONFLICT', 'NODE_BUSY', 'EDITOR_BUSY',
  'UNSUPPORTED_NODE', 'CONFIGURATION_ERROR', 'VERSION_UNAVAILABLE',
  'VERSION_CONFLICT', 'AUTH_REQUIRED', 'SAVE_REJECTED', 'RUN_REJECTED',
  'COUNT_CHANGED', 'CONFIRMATION_DECLINED', 'CONFIRMATION_UNAVAILABLE',
  'SUBMISSION_UNKNOWN', 'DUPLICATE_REQUEST_MISMATCH', 'BRIDGE_OVERLOADED',
  'CANCELLED_BEFORE_DISPATCH',
] as const
export type ErrorCode = typeof ERROR_CODES[number]
export interface Failure {
  code: ErrorCode
  message: string
  retry: 'read_first' | 'after_ready' | 'after_input' | 'developer_fix' | 'user_decision' | 'never_auto'
}
export class CanvasAgentError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message)
    this.name = 'CanvasAgentError'
  }
}
export interface ReadReceipt {
  status: 'read'
  canvasId: string
  version: Version | null
  consistency: 'confirmed' | 'unconfirmed'
  nodeCount: number
  nodes: NodeDetail[]
  missingNodeIds: string[]
}
export interface GraphPort { id: string
  type: 'source' | 'target'
  mediaType: string
  limit: number | null }
export interface GraphNode {
  id: string
  type: string
  title: string
  position: { x: number
    y: number }
  size: { width: number
    height: number }
  parentId: string | null
  ports: GraphPort[]
  allowedInputTypes: string[]
  canConfigureGeneration: boolean
}
export interface GraphEdge { id: string
  source: string
  target: string
  sourceHandle: string | null
  targetHandle: string | null }
export interface GraphReadReceipt {
  status: 'graph'
  canvasId: string
  version: Version | null
  consistency: 'confirmed' | 'unconfirmed'
  nodeCount: number
  edgeCount: number
  nodes: GraphNode[]
  edges: GraphEdge[]
  nodeOffset: number
  edgeOffset: number
  nextNodeOffset: number | null
  nextEdgeOffset: number | null
}
export interface ModelCatalogSnapshot {
  catalogVersion: string
  nodeType: 'image' | 'video' | 'audio'
  modes: Array<{ value: string
    label: string }>
  modeCount: number
  modeOffset: number
  nextModeOffset: number | null
  modelType: string | null
  models: Array<{ value: string
    label: string }>
  modelCount: number
  modelOffset: number
  nextModelOffset: number | null
  model: string | null
  paramHints: ParamHint[]
  seniorParamHints?: ParamHint[]
  voiceSelection?: { required: boolean
    customizable: boolean }
}
export interface CanvasVoice {
  voiceId: string
  name: string
  source: 'public' | 'my'
  platform?: string
  modelId?: string
  language?: string
  gender?: string
  compatibility: 'model_declared' | 'not_declared'
}
export interface VoicesReadReceipt {
  status: 'voices'
  canvasId: string
  version: Version | null
  consistency: 'confirmed' | 'unconfirmed'
  model: string
  source: 'public' | 'my'
  page: number
  limit: number
  total: number
  nextPage: number | null
  voices: CanvasVoice[]
}
export interface ModelsReadReceipt extends ModelCatalogSnapshot {
  status: 'models'
  canvasId: string
  version: Version | null
  consistency: 'confirmed' | 'unconfirmed'
}
export interface SaveReceipt {
  status: 'saved'
  canvasId: string
  version: Version
  affectedNodeIds: string[]
  unchanged: boolean
  affectedEdgeIds?: string[]
  warnings?: string[]
}
export interface RunPreflightReceipt {
  status: 'preflight'
  canvasId: string
  version: Version
  nodeId: string
  generation: GenerationCounts
  quote: { points: number
    originalPoints: number | null }
}
export type RunReceipt =
  | { status: 'submitted'
    canvasId: string
    version: Version
    nodeId: string
    taskId: string
    generation: GenerationCounts }
  | { status: 'submitted'
    canvasId: string
    version: Version
    taskId: string
    nodeIds: string[]
    results: { nodeId: string
      generation: GenerationCounts }[] }
export interface UnknownReceipt {
  status: 'submission_unknown'
  canvasId: string
  phase: 'save' | 'run'
  version: Version | null
  affectedNodeIds: string[]
  generation?: GenerationCounts
  nodeId?: string
  taskId?: string
  error: Failure
  affectedEdgeIds?: string[]
}
export interface RejectedReceipt {
  status: 'rejected'
  canvasId: string
  version: Version | null
  effect: 'none'
  error: Failure
}
export type CanvasOperationResult =
  | ProcessResult | ReadReceipt | GraphReadReceipt | ModelsReadReceipt | VoicesReadReceipt
  | RunPreflightReceipt | SaveReceipt | RunReceipt | UnknownReceipt | RejectedReceipt
export type CanvasOperation =
  | { action: 'canvas.read'
    nodeIds?: string[] }
  | { action: 'canvas.graph.read'
    nodeOffset?: number
    edgeOffset?: number
    limit?: number
    expectedVersion?: Version }
  | { action: 'canvas.models.read'
    nodeType: 'image' | 'video' | 'audio'
    modelType?: string
    model?: string
    modeOffset?: number
    modelOffset?: number
    limit?: number
    expectedCatalogVersion?: string }
  | { action: 'canvas.voices.read'
    nodeType: 'audio'
    model?: string
    voiceSource?: 'public' | 'my'
    voiceId?: string
    name?: string
    language?: string
    gender?: string
    page?: number
    limit?: number }
  | { action: 'node.add'
    expectedVersion: Version
    node: NodeDraft }
  | { action: 'asset.add'
    expectedVersion: Version
    asset: CanvasAssetInput }
  | { action: 'node.update'
    expectedVersion: Version
    nodeId: string
    changes: NodeChanges }
  | { action: 'node.delete'
    expectedVersion: Version
    nodeIds: string[] }
  | { action: 'node.configure'
    expectedVersion: Version
    nodeId: string
    configuration: NodeConfiguration }
  | { action: 'node.preflight'
    expectedVersion: Version
    nodeId: string }
  | { action: 'node.run'
    expectedVersion: Version
    nodeId: string
    approvedGeneration: GenerationCounts }
  | { action: 'workflow.run'
    expectedVersion: Version
    nodeIds: string[]
    approvedGenerations: Record<string, GenerationCounts>
    runRequestIds: Record<string, string> }
  | EdgeEditOperation | ProcessOperation
export function isCanvasReadOperation(operation: CanvasOperation): boolean {
  return operation.action === 'canvas.read' || operation.action === 'canvas.graph.read' ||
 operation.action === 'canvas.models.read' || operation.action === 'canvas.voices.read' ||
 operation.action === 'node.preflight' || operation.action === 'canvas.open' ||
 operation.action === 'canvas.capabilities.read' || operation.action === 'process.preflight'
}
export interface FrameReadiness {
  phase: 'loading' | 'ready' | 'failed' | 'inactive' | 'disposed'
  capabilities: { read: boolean
    edit: boolean
    run: boolean }
  version: Version | null
  reason?: Failure
}
export interface AgentWriteOptions { expectedVersion: Version
  strictReceipt: true
  signal?: AbortSignal
  nodePlacement?: NodePlacement
  affectedNodeIds?: string[]
  processCompletionId?: string }
export interface AgentRunOptions extends AgentWriteOptions {
  strictTransportErrors: true
  approvedGeneration: GenerationCounts
  approvedAudioConfig?: string
}
export interface ToolRejection {
  status: 'rejected'
  requestId: string
  effect: 'none'
  error: Failure
  canvasId?: string
  address?: string
  version?: Version | null
  jobId?: string
}
export interface CanvasCreateInput { name?: string }
export type CanvasCreateOutput =
  | { status: 'created'
    requestId: string
    canvasId: string
    address: string
    name: string
    version: Version | null
    runtime: 'ready' | 'not_ready'
    runtimeError?: Failure }
  | { status: 'create_unknown'
    requestId: string
    error: Failure }
  | ToolRejection
export interface CanvasGetInput { canvasId: string
  view?: 'summary' | 'nodes' | 'graph'
  nodeIds?: string[]
  refresh?: boolean
  nodeOffset?: number
  edgeOffset?: number
  limit?: number
  expectedVersion?: Version }
export interface CanvasSummaryOutput {
  canvasId: string
  name: string
  nodeCount: number
  nodes: Array<{ id: string
    title: string
    type: string
    value: string }>
  address: string
}
export type CanvasGetOutput = CanvasSummaryOutput | ((ReadReceipt | GraphReadReceipt) & { requestId: string
  address: string
  source: 'plugin-service' }) | ToolRejection
export interface CanvasNodeEditInput {
  canvasId: string
  expectedVersion: Version
  ops: Array<
    | { op: 'add'
      node: NodeDraft }
    | { op: 'edit'
      nodeId: string
      changes: NodeChanges }
    | { op: 'remove'
      nodeId: string }
    | { op: 'configure'
      nodeId: string
      configuration: NodeConfiguration }
  >
}
export interface CanvasEdgesInput { canvasId: string
  expectedVersion: Version
  ops: Array<
  | { op: 'add'
    connection: EdgeConnection }
  | { op: 'edit'
    edgeId: string
    connection: EdgeConnection }
  | { op: 'remove'
    edgeId: string }
  | { op: 'reorder'
    targetNodeId: string
    edgeIds: string[] }
  > }
export interface CanvasBatchWriteOutput {
  status: 'saved' | 'partial' | 'submission_unknown'
  requestId: string
  canvasId: string
  address: string
  version: Version | null
  completed: Array<{ index: number
    receipt: SaveReceipt }>
  nextIndex: number
  failure?: RejectedReceipt | UnknownReceipt
}
export type CanvasNodeEditOutput = CanvasBatchWriteOutput | ToolRejection
export interface CanvasRunInput { canvasId: string
  nodeIds: string[]
  expectedVersion: Version }
export type CanvasSingleRunOutput =
  | (RunReceipt & { requestId: string
    address: string
    jobId: string
    tracking: string })
  | (UnknownReceipt & { requestId: string
    address: string
    phase: 'run'
    nodeId: string
    generation: GenerationCounts
    jobId: string
    tracking: string })
  | (ToolRejection & { jobId?: string })
export type CanvasRunOutput = { status: 'submitted' | 'partial' | 'submission_unknown' | 'paused'
  requestId: string
  canvasId: string
  address: string
  nodeIds: string[]
  results: CanvasSingleRunOutput[]
  nextIndex: number
  version: Version | null
  jobId?: string } | ToolRejection

type Check = (value: unknown) => boolean
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
const oneOf = (values: readonly unknown[]): Check => value => values.includes(value)
const string = (max: number, min = 0): Check => value => typeof value === 'string' && value.length >= min && value.length <= max
const identifier = (max: number): Check => value => string(max, 1)(value) && (value as string).trim().length > 0
const finite: Check = value => typeof value === 'number' && Number.isFinite(value)
const integer: Check = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const boolean: Check = value => typeof value === 'boolean'
const nullable = (check: Check): Check => value => value === null || check(value)
const array = (check: Check, max = Infinity): Check => value => Array.isArray(value) && value.length <= max && value.every(check)
const shape = (required: Record<string, Check>, optional: Record<string, Check> = {}): Check => value => record(value)
  && Object.keys(value).every(key => Object.hasOwn(required, key) || Object.hasOwn(optional, key))
  && Object.entries(required).every(([key, check]) => Object.hasOwn(value, key) && check(value[key]))
  && Object.entries(optional).every(([key, check]) => !Object.hasOwn(value, key) || check(value[key]))
const version = identifier(100)
const nodeId = identifier(MAX_NODE_ID_LENGTH)
const edgeId = identifier(MAX_EDGE_ID_LENGTH)
const routingId = identifier(MAX_ROUTING_ID_LENGTH)
const canvasId: Check = value => typeof value === 'string' && value.length <= 19 && parseCanvasId(value) !== undefined
const nodeIds: Check = value => array(nodeId)(value) && (value as string[]).length > 0 && new Set(value as string[]).size <= MAX_NODE_IDS
const edgeIds: Check = value => array(edgeId, MAX_NODE_IDS)(value) && (value as string[]).length > 0 &&
 new Set(value as string[]).size === (value as string[]).length
const scalar: Check = value => value === null || typeof value === 'boolean' || string(MAX_CONTENT_LENGTH)(value) || finite(value)
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype'])
export const FORBIDDEN_PARAM_FIELDS = new Set(['model', 'modelType', 'prompt', ...unsafeKeys])
const scalarParams: Check = value => record(value) && Object.entries(value).every(([key,
  item]) => identifier(100)(key) && !unsafeKeys.has(key) && scalar(item))
const changes: Check = value => shape({}, { title: string(MAX_TITLE_LENGTH), prompt: string(MAX_CONTENT_LENGTH),
  text: string(MAX_CONTENT_LENGTH), params: item => scalarParams(item) && Object.keys(item as object).length > 0 &&
 Object.keys(item as object).every(key => !FORBIDDEN_PARAM_FIELDS.has(key)) })(value)
  && Object.keys(value as object).length > 0
const configuration: Check = value => shape({}, {
  modelType: identifier(200), model: identifier(200),
  voiceId: identifier(200), seniorParams: item => scalarParams(item) && Object.keys(item as object).length > 0,
  params: item => scalarParams(item) && Object.keys(item as object).length > 0 &&
 Object.keys(item as object).every(key => !FORBIDDEN_PARAM_FIELDS.has(key)),
})(value) && Object.keys(value as object).length > 0
const connection = shape({ sourceNodeId: nodeId, targetNodeId: nodeId }, { sourceHandle: identifier(200), targetHandle: identifier(200) })
const pageLimit: Check = value => integer(value) && (value as number) >= 1 && (value as number) <= MAX_NODE_IDS
const graphQuery: Check = value => shape({ action: oneOf(['canvas.graph.read']) }, { nodeOffset: integer,
  edgeOffset: integer, limit: pageLimit, expectedVersion: version })(value)
  && (!((value as { nodeOffset?: number
    edgeOffset?: number }).nodeOffset || (value as { edgeOffset?: number }).edgeOffset) ||
 Object.hasOwn(value as object, 'expectedVersion'))
const modelQuery: Check = value => shape({ action: oneOf(['canvas.models.read']), nodeType: oneOf(['image', 'video', 'audio']) }, {
  modelType: identifier(200), model: identifier(200), modeOffset: integer, modelOffset: integer, limit: pageLimit,
  expectedCatalogVersion: version,
})(value) && (!((value as { modeOffset?: number
  modelOffset?: number }).modeOffset || (value as { modelOffset?: number }).modelOffset) ||
 Object.hasOwn(value as object, 'expectedCatalogVersion'))
const position = shape({ x: finite, y: finite })
const placement: Check = value => shape({ mode: oneOf(['auto']) })(value)
  || shape({ mode: oneOf(['absolute']), position })(value)
  || shape({ mode: oneOf(['after']), anchorNodeId: nodeId })(value)
const exclusivePlacement: Check = value => !Object.hasOwn(value as object, 'position') || !Object.hasOwn(value as object, 'placement')
const draft: Check = value => shape({ type: oneOf(STANDARD_NODE_TYPES) }, { position, placement, changes })(value) &&
 exclusivePlacement(value)
const assetUrl: Check = (value) => {
  if (typeof value !== 'string' || value.length > 4096 || value !== value.trim() || value.includes('#')) return false
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password &&
 !url.hash } catch { return false }
}
const asset: Check = value => (shape({ url: assetUrl }, { mediaType: oneOf(['image']),
  title: string(MAX_TITLE_LENGTH), position, placement })(value)
  || shape({ mediaType: oneOf(['video', 'audio']), url: assetUrl }, { title: string(MAX_TITLE_LENGTH), position, placement })(value)
  || shape({ mediaType: oneOf(['text']), text: string(MAX_CONTENT_LENGTH, 1) }, { title: string(MAX_TITLE_LENGTH),
    position, placement })(value)) && exclusivePlacement(value)
const counts: Check = isGenerationCounts
const failure = shape({ code: oneOf(ERROR_CODES), message: string(MAX_CONTENT_LENGTH, 1), retry: oneOf(['read_first',
  'after_ready', 'after_input', 'developer_fix', 'user_decision', 'never_auto']) })
const operationChecks: Record<CanvasOperation['action'], Check> = {
  'canvas.open': shape({ action: oneOf(['canvas.open']) }, { nodeId }),
  'canvas.capabilities.read': shape({ action: oneOf(['canvas.capabilities.read']) }, { kind: oneOf(['image_upscale',
    'video_upscale','image_layering','auto_matting']), model: identifier(100) }),
  'canvas.layout': shape({ action: oneOf(['canvas.layout']), expectedVersion: version, nodeIds, mode: oneOf(['grid',
    'horizontal', 'vertical']) }),
  'process.preflight': value => shape({ action: oneOf(['process.preflight']), expectedVersion: version,
    kind: identifier(100), sourceNodeId: nodeId }, { outputIndex: integer, params: value => record(value) })(value) &&
 checkProcessInput(value),
  'process.run': shape({ action: oneOf(['process.run']), expectedVersion: version, planId: nodeId, nodeId, approvedGeneration: counts }),
  'canvas.read': shape({ action: oneOf(['canvas.read']) }, { nodeIds }),
  'canvas.graph.read': graphQuery,
  'canvas.models.read': modelQuery,
  'canvas.voices.read': value => shape({ action: oneOf(['canvas.voices.read']), nodeType: oneOf(['audio']) }, {
    model: identifier(200), voiceSource: oneOf(['public', 'my']), voiceId: identifier(200), name: string(100, 1),
    language: identifier(100), gender: identifier(100),
    page: value => integer(value) && (value as number) >= 1 && (value as number) <= 10000, limit: pageLimit,
  })(value) && record(value) && (!('voiceId' in value) || !['name', 'language', 'gender', 'page'].some(key => key in value)),
  'node.add': shape({ action: oneOf(['node.add']), expectedVersion: version, node: draft }),
  'asset.add': shape({ action: oneOf(['asset.add']), expectedVersion: version, asset }),
  'node.update': shape({ action: oneOf(['node.update']), expectedVersion: version, nodeId, changes }),
  'node.delete': shape({ action: oneOf(['node.delete']), expectedVersion: version, nodeIds }),
  'node.configure': shape({ action: oneOf(['node.configure']), expectedVersion: version, nodeId, configuration }),
  'edge.add': shape({ action: oneOf(['edge.add']), expectedVersion: version, connection }),
  'edge.delete': shape({ action: oneOf(['edge.delete']), expectedVersion: version, edgeIds }),
  'edge.reconnect': shape({ action: oneOf(['edge.reconnect']), expectedVersion: version, edgeId, connection }),
  'edge.reorder': shape({ action: oneOf(['edge.reorder']), expectedVersion: version, targetNodeId: nodeId, edgeIds }),
  'node.preflight': shape({ action: oneOf(['node.preflight']), expectedVersion: version, nodeId }),
  'node.run': shape({ action: oneOf(['node.run']), expectedVersion: version, nodeId, approvedGeneration: counts }),
  'workflow.run': value => shape({
    action: oneOf(['workflow.run']),
    expectedVersion: version,
    nodeIds,
    approvedGenerations: value => record(value) && Object.values(value as object).every(counts),
    runRequestIds: value => record(value) && Object.values(value as object).every(routingId),
  })(value) && (() => {
    const run = value as Extract<CanvasOperation, { action: 'workflow.run' }>
    const ids = new Set(run.nodeIds)
    return ids.size === run.nodeIds.length && ids.size <= MAX_NODE_IDS
      && [run.approvedGenerations, run.runRequestIds].every(map => Object.keys(map).length === ids.size &&
 Object.keys(map).every(id => ids.has(id)))
      && new Set(Object.values(run.runRequestIds)).size === ids.size
  })(),
}
const operation: Check = value => record(value) && typeof value.action === 'string'
  && Object.hasOwn(operationChecks, value.action) && operationChecks[value.action as CanvasOperation['action']](value)
const paramHint = shape({ field: identifier(100), editable: boolean }, { choices: array(scalar), min: finite,
  max: finite, step: finite, default: scalar, type: oneOf(['string']), maxLength: integer })
const detail = shape({
  id: nodeId, type: string(100), title: string(MAX_TITLE_LENGTH), contentType: nullable(string(100)),
  text: nullable(string(MAX_CONTENT_LENGTH)), prompt: nullable(string(MAX_CONTENT_LENGTH)), params: scalarParams,
  paramHints: array(paramHint),
  status: string(100), inputs: array(shape({ nodeId, edgeId, sourceHandle: nullable(string(200)), targetHandle: nullable(string(200)) })),
  outputs: array(string(MAX_CONTENT_LENGTH, 1), 20), generation: nullable(counts), truncatedFields: array(string(200, 1)),
}, { position, size: shape({ width: value => finite(value) && (value as number) > 0, height: value => finite(value) &&
 (value as number) > 0 }), parentId: nullable(nodeId), seniorParams: scalarParams,
seniorParamHints: array(paramHint) })
const resultBase = { canvasId, version: nullable(version) }
const size = shape({ width: value => finite(value) && (value as number) > 0, height: value => finite(value) && (value as number) > 0 })
const graphNode = shape({ id: nodeId, type: string(100), title: string(MAX_TITLE_LENGTH), position, size, parentId: nullable(nodeId),
  ports: array(shape({ id: identifier(200), type: oneOf(['source', 'target']), mediaType: identifier(100),
    limit: nullable(integer) }), 100),
  allowedInputTypes: array(identifier(100), 100), canConfigureGeneration: boolean })
const graphEdge = shape({ id: edgeId, source: nodeId, target: nodeId, sourceHandle: nullable(string(200)),
  targetHandle: nullable(string(200)) })
const modelOption = shape({ value: identifier(200), label: string(200) })
const resultChecks: Record<CanvasOperationResult['status'], Check> = {
  opened: checkProcessResult, capabilities: checkProcessResult, process_ready: checkProcessResult,
  process_submitted: checkProcessResult, process_partial: checkProcessResult,
  read: shape({ ...resultBase, status: oneOf(['read']), consistency: oneOf(['confirmed', 'unconfirmed']),
    nodeCount: integer, nodes: array(detail, MAX_NODE_IDS), missingNodeIds: array(nodeId, MAX_NODE_IDS) }),
  graph: shape({ ...resultBase, status: oneOf(['graph']), consistency: oneOf(['confirmed', 'unconfirmed']),
    nodeCount: integer, edgeCount: integer,
    nodes: array(graphNode, MAX_NODE_IDS), edges: array(graphEdge, MAX_NODE_IDS), nodeOffset: integer,
    edgeOffset: integer, nextNodeOffset: nullable(integer), nextEdgeOffset: nullable(integer) }),
  models: shape({ ...resultBase, status: oneOf(['models']), consistency: oneOf(['confirmed', 'unconfirmed']),
    catalogVersion: version, nodeType: oneOf(['image', 'video', 'audio']),
    modes: array(modelOption, MAX_NODE_IDS), modeCount: integer, modeOffset: integer,
    nextModeOffset: nullable(integer), modelType: nullable(identifier(200)),
    models: array(modelOption, MAX_NODE_IDS), modelCount: integer, modelOffset: integer,
    nextModelOffset: nullable(integer), model: nullable(identifier(200)), paramHints: array(paramHint) }, {
    seniorParamHints: array(paramHint), voiceSelection: shape({ required: boolean, customizable: boolean }),
  }),
  voices: shape({ ...resultBase, status: oneOf(['voices']), consistency: oneOf(['confirmed', 'unconfirmed']),
    model: identifier(200), source: oneOf(['public', 'my']),
    page: value => integer(value) && (value as number) >= 1, limit: pageLimit, total: integer,
    nextPage: nullable(value => integer(value) && (value as number) >= 2),
    voices: array(shape({ voiceId: identifier(200), name: string(200), source: oneOf(['public', 'my']),
      compatibility: oneOf(['model_declared', 'not_declared']) }, {
      platform: identifier(200), modelId: identifier(200), language: identifier(100), gender: identifier(100),
    }), MAX_NODE_IDS) }),
  saved: shape({ canvasId, version, status: oneOf(['saved']), affectedNodeIds: array(nodeId), unchanged: boolean }, {
    affectedEdgeIds: array(edgeId), warnings: array(string(2048)) }),
  preflight: shape({ canvasId, version, status: oneOf(['preflight']), nodeId, generation: counts, quote: shape({
    points: value => finite(value) && (value as number) >= 0, originalPoints: nullable(value => finite(value) &&
 (value as number) >= 0) }) }),
  submitted: (value: unknown) =>
    shape({ canvasId, version, status: oneOf(['submitted']), nodeId, taskId: routingId, generation: counts })(value)
    || shape({
      canvasId, version, status: oneOf(['submitted']), taskId: routingId, nodeIds,
      results: array(shape({ nodeId, generation: counts })),
    })(value),
  submission_unknown: shape({ ...resultBase, status: oneOf(['submission_unknown']), phase: oneOf(['save', 'run']),
    affectedNodeIds: array(nodeId), error: failure }, { generation: counts, nodeId, taskId: routingId, affectedEdgeIds: array(edgeId) }),
  rejected: shape({ ...resultBase, status: oneOf(['rejected']), effect: oneOf(['none']), error: failure }),
}
const result: Check = value => record(value) && typeof value.status === 'string'
  && Object.hasOwn(resultChecks, value.status) && resultChecks[value.status as CanvasOperationResult['status']](value)
const readiness = shape({ phase: oneOf(['loading', 'ready', 'failed', 'inactive', 'disposed']), capabilities: shape({
  read: boolean, edit: boolean, run: boolean }), version: nullable(version) }, { reason: failure })
const stringifyJson: (value: unknown) => string | undefined = JSON.stringify

export function assertCanvasMessageSize(value: unknown): void {
  let json: string | undefined
  try { json = stringifyJson(value) } catch { throw new CanvasAgentError('INVALID_ARGUMENT', '消息必须可序列化为 JSON') }
  if (json === undefined) throw new CanvasAgentError('INVALID_ARGUMENT', '消息必须是 JSON 对象')
  if (new TextEncoder().encode(json).byteLength > MAX_MESSAGE_BYTES) throw new CanvasAgentError('BRIDGE_OVERLOADED', '消息超过 2 MiB 上限')
}
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- The caller supplies the checked wire type.
function parse<T>(value: unknown, check: Check, label: string): T {
  assertCanvasMessageSize(value)
  if (!check(value)) throw new CanvasAgentError('INVALID_ARGUMENT', label + '格式或字段不合法')
  return value as T
}
export function parseCanvasAsset(value: unknown): CanvasAssetInput { return parse(value, asset, '素材') }
export function parseNodeChanges(value: unknown): NodeChanges { return parse(value, changes, '节点变化') }
export function parseNodeConfiguration(value: unknown): NodeConfiguration { return parse(value, configuration, '节点配置') }
export function parseNodePlacement(value: unknown): NodePlacement { return parse(value, placement, '节点放置') }
export function parseNodeDraft(value: unknown): NodeDraft { return parse(value, draft, '新增节点') }
export function parseCanvasOperation(value: unknown): CanvasOperation {
  const parsed = parse<CanvasOperation>(value, operation, '画布操作')
  return 'nodeIds' in parsed && parsed.nodeIds ? { ...parsed, nodeIds: [...new Set(parsed.nodeIds)] } : parsed
}
export function parseCanvasOperationResult(value: unknown): CanvasOperationResult { return parse(value, result, '画布回执') }

export function parseCanvasReadiness(value: unknown): FrameReadiness { return parse(value, readiness, '画布上下文状态') }
export function parseCanvasFailure(value: unknown): Failure { return parse(value, failure, '画布错误') }

export function isCanvasRunOperation(operation: CanvasOperation): boolean { return operation.action === 'node.run' ||
 operation.action === 'workflow.run' || operation.action === 'process.run' }
export function expectedCanvasReadStatus(operation: CanvasOperation): string {
  return operation.action === 'canvas.open' ? 'opened' : operation.action === 'canvas.read' ? 'read' : operation.action === 'canvas.graph.read' ? 'graph' : operation.action === 'canvas.voices.read' ? 'voices' : operation.action === 'node.preflight' ? 'preflight' : operation.action === 'canvas.capabilities.read' ? 'capabilities' : operation.action === 'process.preflight' ? 'process_ready' : 'models' }

/** A receipt for one operation cannot be substituted by another run family. */
export function assertCanvasResultMatches(operation: CanvasOperation, result: CanvasOperationResult, requestId?: string): void {
  const reject = () => { throw new CanvasAgentError('INVALID_ARGUMENT', '回执与画布操作不匹配') }
  if (result.status === 'rejected') return
  if (isCanvasReadOperation(operation)) {
    if (result.status !== expectedCanvasReadStatus(operation)) reject()
    if (operation.action === 'canvas.voices.read' && result.status === 'voices') {
      if (operation.model && result.model !== operation.model || operation.voiceSource && result.source !== operation.voiceSource
        || result.voices.some(voice => voice.source !== result.source) || result.voices.length > result.limit
        || result.page !== (operation.voiceId ? 1 : operation.page ?? 1) || result.limit !== (operation.limit ?? 20)
        || result.nextPage !== (result.page * result.limit < result.total ? result.page + 1 : null)
        || operation.voiceId && (result.voices.length !== 1 || result.voices[0].voiceId !== operation.voiceId ||
 result.total !== 1)) reject()
    }
    return
  }
  if (result.status === 'submission_unknown') {
    if (result.phase !== (isCanvasRunOperation(operation) ? 'run' : 'save')) reject(); return }
  if (operation.action === 'process.run') {
    if (result.status !== 'process_submitted' && result.status !== 'process_partial') { reject(); return }
    if (result.nodeId !== operation.nodeId || requestId && result.operationId !== requestId) reject()
    if (result.status === 'process_submitted' && !sameGenerationCounts(result.generation, operation.approvedGeneration)) reject()
    return
  }
  if (operation.action === 'node.run') {
    if (result.status !== 'submitted' || !('nodeId' in result)) { reject(); return }
    if (result.nodeId !== operation.nodeId || !sameGenerationCounts(result.generation, operation.approvedGeneration)) reject()
    return
  }
  if (operation.action === 'workflow.run') {
    if (result.status !== 'submitted' || !('nodeIds' in result)) { reject(); return }
    if (JSON.stringify(result.nodeIds) !== JSON.stringify(operation.nodeIds)) reject()
    if (result.results.length !== operation.nodeIds.length || result.results.some((item,
      index) => item.nodeId !== operation.nodeIds[index]
      || !sameGenerationCounts(item.generation, operation.approvedGenerations[item.nodeId]))) reject()
    return
  }
  if (result.status !== 'saved') reject()
}
