import { assertCanvasMessageSize, type GenerationCounts } from './canvas-agent-protocol.ts'
import { parseCanvasRunState } from './canvas-run-protocol.ts'
import { generationOutputCount } from './canvas-generation-counts.ts'

export const CANVAS_RESULT_ROUTE = '/desktop-canvas/api/results'
export const CANVAS_RESULT_PAGE_LIMIT = 100

/** Captured by the Host at the original, real tool invocation, never by model arguments. */
export interface CanvasResultBinding {
  sessionId: string
  ownerId: string
  rootCallId: string
  callId: string
  turn: number
  rootCallSeq: number
  sessionCreatedAt: number
}

/** One confirmed native run's products; output order does not stand in for product identity. */
export interface CanvasResultSource extends CanvasResultBinding {
  schemaVersion: 1
  requestId: string
  canvasId: string
  nodeId: string
  workflowTaskId?: string
  operationId?: string
  nodeTaskId?: string
  phase: 'completed' | 'failed'
  version: string | null
  generation: GenerationCounts
  outputs: string[]
  createdAt: number
}

export type CanvasResultEvent = { type: 'snapshot'
  sources: CanvasResultSource[]
  nextCursor?: string }
  | { type: 'upsert'
    source: CanvasResultSource }

const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 &&
 value.length <= 200 && value.trim() === value
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
const exact = (value: Record<string, unknown>, required: string[],
  optional: string[] = []) => required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key))

function assertCanvasResultSource(input: unknown): asserts input is CanvasResultSource {
  assertCanvasMessageSize(input)
  const required = ['schemaVersion', 'sessionId', 'ownerId', 'rootCallId', 'callId', 'turn', 'rootCallSeq', 'sessionCreatedAt',
    'requestId', 'canvasId', 'nodeId', 'phase', 'version', 'generation', 'outputs', 'createdAt']
  if (!object(input) || !exact(input, required, ['workflowTaskId', 'nodeTaskId', 'operationId']) || input.schemaVersion !== 1
    || !['sessionId', 'ownerId', 'rootCallId', 'callId'].every(key => identifier(input[key]))
    || !['turn', 'rootCallSeq', 'sessionCreatedAt', 'createdAt'].every(key => integer(input[key]))
    || !['completed', 'failed'].includes(String(input.phase)) || !Array.isArray(input.outputs) || input.outputs.length === 0
    || (!Object.hasOwn(input, 'workflowTaskId') && !Object.hasOwn(input, 'nodeTaskId') && !Object.hasOwn(input,
      'operationId'))) throw new Error('invalid canvas result source')
  parseCanvasRunState({ requestId: input.requestId, canvasId: input.canvasId, nodeId: input.nodeId, sequence: 0,
    phase: input.phase, version: input.version, generation: input.generation, outputs: input.outputs,
    ...(Object.hasOwn(input, 'workflowTaskId') ? { workflowTaskId: input.workflowTaskId } : {}),
    ...(Object.hasOwn(input, 'operationId') ? { operationId: input.operationId } : {}),
    ...(Object.hasOwn(input, 'nodeTaskId') ? { nodeTaskId: input.nodeTaskId } : {}) })
  const generation = input.generation as GenerationCounts
  if (generationOutputCount(generation) === 0) throw new Error('canvas result has no requested generation')
}
export function parseCanvasResultSource(input: unknown): CanvasResultSource {
  assertCanvasResultSource(input)
  return structuredClone(input)
}

export function parseCanvasResultEvent(input: unknown): CanvasResultEvent {
  assertCanvasMessageSize(input)
  if (!object(input)) throw new Error('invalid canvas result event')
  if (input.type === 'upsert' && exact(input, ['type', 'source'])) return { type: 'upsert',
    source: parseCanvasResultSource(input.source) }
  if (input.type === 'snapshot' && exact(input, ['type', 'sources'], ['nextCursor']) && Array.isArray(input.sources)
    && input.sources.length <= CANVAS_RESULT_PAGE_LIMIT && (!Object.hasOwn(input, 'nextCursor') || identifier(input.nextCursor))) {
    return { type: 'snapshot', sources: input.sources.map(parseCanvasResultSource),
      ...(typeof input.nextCursor === 'string' ? { nextCursor: input.nextCursor } : {}) }
  }
  throw new Error('invalid canvas result event')
}
