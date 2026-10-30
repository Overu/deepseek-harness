import { assertCanvasMessageSize, CanvasAgentError, parseCanvasOperation, parseCanvasOperationResult,
  parseCanvasReadiness, parseCanvasFailure, type CanvasOperation, type CanvasOperationResult, type Failure,
  type FrameReadiness } from './canvas-agent-protocol.ts'
import { parseCanvasRunState, type CanvasRunState } from './canvas-run-protocol.ts'
import { parseCanvasId } from './protocol.ts'
import { isCanvasReferenceItem, type CanvasReferenceItem } from './canvas-node-references.ts'
export const BRIDGE_VERSION = 4 as const
export const OWNERSHIP_PROTOCOL = 'web-locks-v1' as const
export const MAX_BRIDGE_RECORDS = 1024
export const MAX_BRIDGE_INFLIGHT = 8
export const MAX_BRIDGE_CACHE_BYTES = 32 * 1024 * 1024
export type BridgeCapability = 'read' | 'edit' | 'run'
export type BridgeOperation = CanvasOperation
export interface BridgeTarget { connectionId: string
  sessionId: string
  canvasId: string
  contextId: string
  readiness: FrameReadiness }
export interface ClientRegistration { protocolVersion: 4
  clientId: string
  connectionId: string
  bridgeKey: string
  ownershipProtocol?: typeof OWNERSHIP_PROTOCOL }
interface Connection { protocolVersion: 4
  connectionId: string }
interface Request extends Connection { sessionId: string
  canvasId: string
  requestId: string }
export type ServiceHostEvent =
  | (Connection & { type: 'bridge.connected' })
  | (Connection & { type: 'canvas.references.consumed'
    sessionId: string
    revision: number
    messageId: string })
  | (Request & { type: 'canvas.prepare'
    deadline: number
    capability: BridgeCapability
    refresh?: boolean })
  | (Request & { type: 'canvas.command'
    deadline: number
    contextId: string
    payload: BridgeOperation })
export type PrepareAck = Request & { type: 'canvas.prepare.ack' } & (
  | { status: 'prepared'
    contextId: string
    state: FrameReadiness }
  | { status: 'rejected'
    error: Failure })
export type CommandAck = Request & { type: 'canvas.command.ack'
  contextId: string } & (
  | { phase: 'accepted' | 'started' }
  | { phase: 'settled'
    result: CanvasOperationResult })
export type ServiceClientEvent =
  | (Connection & { type: 'session.sync'
    revision: number
    sessionIds: string[] })
  | (Connection & { type: 'canvas.references.sync'
    sessionId: string
    revision: number
    references: CanvasReferenceItem[] })
  | (Connection & { type: 'canvas.context.state'
    sessionId: string
    canvasId: string
    contextId: string
    state: FrameReadiness })
  | (Request & { type: 'canvas.run.state'
    contextId: string
    state: CanvasRunState })
  | PrepareAck | CommandAck
// Closing local tracking does not claim the backend task was cancelled or failed.
export function isRunTrackingClosed(state: CanvasRunState): boolean {
  return state.phase === 'completed' || state.phase === 'failed' || state.phase === 'monitoring_unknown'
    && ['CONTEXT_GONE', 'FRAME_GONE', 'CLIENT_UNAVAILABLE'].includes(state.error?.code ?? '')
}
export function bridgeFingerprint(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(bridgeFingerprint).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + bridgeFingerprint((value as Record<string, unknown>)[key])).join(',') + '}'
  return JSON.stringify(value)
}
export const messageBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength
function invalid(): never { throw new CanvasAgentError('INVALID_ARGUMENT', '服务桥消息格式或字段不合法') }
function object(value: unknown): Record<string, unknown> {
  assertCanvasMessageSize(value)
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
 !(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) invalid()
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) &&
 !optional.includes(key))) invalid()
}
export function assertBridgeId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200 || !value.trim()) invalid()
}
const connectionFields = ['protocolVersion', 'connectionId', 'type']
const requestFields = [...connectionFields, 'sessionId', 'canvasId', 'requestId']
function base(value: Record<string, unknown>, request = false): void {
  if (value.protocolVersion !== BRIDGE_VERSION) throw new CanvasAgentError('INVALID_ARGUMENT', '画布通信协议版本已变化，请刷新或重启客户端后再操作')
  assertBridgeId(value.connectionId)
  if (request) { assertBridgeId(value.sessionId); assertBridgeId(value.requestId); if (!parseCanvasId(value.canvasId)) invalid() }
}
export function parseBridgeOperation(value: unknown): BridgeOperation {
  const operation = parseCanvasOperation(value)
  return structuredClone(operation)
}
function assertClientRegistration(value: Record<string, unknown>): asserts value is Record<string, unknown> & ClientRegistration {
  exact(value, ['protocolVersion', 'clientId', 'connectionId',
    'bridgeKey'], ['ownershipProtocol'])
  if ('ownershipProtocol' in value && value.ownershipProtocol !== OWNERSHIP_PROTOCOL) invalid()
  base(value); assertBridgeId(value.clientId)
  if (typeof value.bridgeKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.bridgeKey)) invalid()
}
export function parseClientRegistration(input: unknown): ClientRegistration {
  const value = structuredClone(object(input))
  assertClientRegistration(value)
  return structuredClone(value)
}

function assertServiceHostEvent(value: Record<string, unknown>): asserts value is Record<string, unknown> & ServiceHostEvent {
  base(value, value.type !== 'bridge.connected' &&
 value.type !== 'canvas.references.consumed')
  if (value.type === 'bridge.connected') exact(value, connectionFields)
  else if (value.type === 'canvas.references.consumed') {
    exact(value, [...connectionFields, 'sessionId', 'revision', 'messageId']); assertBridgeId(value.sessionId)
    assertBridgeId(value.messageId)
    if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) invalid()
  } else {
    if (!Number.isSafeInteger(value.deadline) || Number(value.deadline) < 1) invalid()
    if (value.type === 'canvas.prepare') {
      exact(value, [...requestFields, 'deadline', 'capability'], ['refresh'])
      if (!['read', 'edit', 'run'].includes(String(value.capability)) || ('refresh' in value &&
 typeof value.refresh !== 'boolean') || (value.refresh === true && value.capability !== 'read')) invalid()
    } else if (value.type === 'canvas.command') {
      exact(value, [...requestFields, 'deadline', 'contextId', 'payload']); assertBridgeId(value.contextId)
      value.payload = parseBridgeOperation(value.payload)
    } else invalid()
  }
}
export function parseServiceHostEvent(input: unknown): ServiceHostEvent {
  const value = structuredClone(object(input))
  assertServiceHostEvent(value)
  return structuredClone(value)
}

function assertServiceClientEvent(value: Record<string, unknown>): asserts value is Record<string, unknown> & ServiceClientEvent {
  base(value, value.type === 'canvas.prepare.ack' ||
 value.type === 'canvas.command.ack' || value.type === 'canvas.run.state')
  if (value.type === 'session.sync') {
    exact(value, [...connectionFields, 'revision', 'sessionIds'])
    if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.sessionIds) ||
 value.sessionIds.length > 64 || new Set(value.sessionIds).size !== value.sessionIds.length) invalid()
    value.sessionIds.forEach(assertBridgeId)
  } else if (value.type === 'canvas.references.sync') {
    exact(value, [...connectionFields, 'sessionId', 'revision', 'references']); assertBridgeId(value.sessionId)
    if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) invalid()
    if (!Array.isArray(value.references) || value.references.length > 64) invalid()
    if (!value.references.every(isCanvasReferenceItem)) invalid()
  } else if (value.type === 'canvas.context.state') {
    exact(value, [...connectionFields, 'sessionId', 'canvasId', 'contextId', 'state'])
    assertBridgeId(value.sessionId); assertBridgeId(value.contextId)
    if (!parseCanvasId(value.canvasId)) invalid()
    value.state = parseCanvasReadiness(value.state)
  } else if (value.type === 'canvas.run.state') {
    exact(value, [...requestFields, 'contextId', 'state']); assertBridgeId(value.contextId)
    value.state = parseCanvasRunState(value.state)
    const state = value.state as CanvasRunState
    if (state.canvasId !== value.canvasId || state.requestId !== value.requestId) invalid()
  } else if (value.type === 'canvas.prepare.ack') {
    if (value.status === 'prepared') { exact(value, [...requestFields, 'status', 'contextId', 'state'])
      assertBridgeId(value.contextId); value.state = parseCanvasReadiness(value.state) }
    else if (value.status === 'rejected') { exact(value, [...requestFields, 'status', 'error'])
      value.error = parseCanvasFailure(value.error) }
    else invalid()
  } else if (value.type === 'canvas.command.ack') {
    assertBridgeId(value.contextId)
    if (value.phase === 'settled') {
      exact(value, [...requestFields, 'contextId', 'phase', 'result'])
      const result = parseCanvasOperationResult(value.result)
      if (result.canvasId !== value.canvasId) invalid()
      value.result = result
    } else { exact(value, [...requestFields, 'contextId', 'phase']); if (value.phase !== 'accepted' &&
 value.phase !== 'started') invalid() }
  } else invalid()
}
export function parseServiceClientEvent(input: unknown): ServiceClientEvent {
  const value = structuredClone(object(input))
  assertServiceClientEvent(value)
  return structuredClone(value)
}
