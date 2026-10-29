import { randomBytes, randomUUID } from 'node:crypto'
import { OWNERSHIP_PROTOCOL } from '../shared/canvas-bridge-protocol.ts'
import { assertCanvasResultMatches, isCanvasRunOperation, expectedCanvasReadStatus, isCanvasReadOperation, CanvasAgentError, MAX_MESSAGE_BYTES, type CanvasOperationResult, type ErrorCode, type FrameReadiness, type GenerationCounts } from '../shared/canvas-agent-protocol.ts'
import { sameGenerationCounts } from '../shared/canvas-generation-counts.ts'
import { assertBridgeId, bridgeFingerprint, isRunTrackingClosed, messageBytes, MAX_BRIDGE_CACHE_BYTES, MAX_BRIDGE_INFLIGHT, MAX_BRIDGE_RECORDS, parseBridgeOperation, parseServiceClientEvent, parseServiceHostEvent, type BridgeCapability, type BridgeOperation, type BridgeTarget, type ClientRegistration, type ServiceClientEvent, type ServiceHostEvent } from '../shared/canvas-bridge-protocol.ts'
import type { CanvasRunState } from '../shared/canvas-run-protocol.ts'
import { parseCanvasId } from '../shared/protocol.ts'
import type { CanvasReferenceItem } from '../shared/canvas-node-references.ts'
export interface CanvasHostBridge {
  ensureContext(sessionId: string, canvasId: string, capability: BridgeCapability, requestId: string, signal?: AbortSignal, refresh?: boolean): Promise<BridgeTarget>
  dispatch(target: BridgeTarget, requestId: string, operation: BridgeOperation, signal?: AbortSignal): Promise<CanvasOperationResult>
  subscribeRun(target: BridgeTarget, requestId: string, listener: (state: CanvasRunState) => void): () => void
  getPendingReferences(sessionId: string): { items: CanvasReferenceItem[]; revision: number; connectionId: string } | undefined
  consumeReferences(sessionId: string, revision: number, messageId: string, connectionId: string): void
  dispose(): void
}
export interface CanvasBridgeRegistry extends CanvasHostBridge {
  attachClient(origin: string, clientId: string, ownershipProtocol?: typeof OWNERSHIP_PROTOCOL): ClientRegistration
  checkClient(key: string, origin: string): boolean
  connectStream(key: string, origin: string, write: (event: ServiceHostEvent) => void): () => void
  acceptClientEvent(key: string, origin: string, event: ServiceClientEvent): void
  detachClient(key: string, origin: string): void
}
type Command = Extract<ServiceHostEvent, { type: 'canvas.prepare' | 'canvas.command' }>
interface Client { registration: ClientRegistration; origin: string; sessions: Set<string>; revision: number; contexts: Map<string, { contextId: string; state: FrameReadiness; order: number }>; stream?: { write: (event: ServiceHostEvent) => void } }
interface RunSubscription { target: BridgeTarget; active: boolean; reserved: number; latest?: CanvasRunState; listeners: Set<(state: CanvasRunState) => void> }
interface Pending {
  fingerprint: string; event: Command; order: number; waiting: boolean; terminal: boolean; sent: boolean; bytes: number
  value?: BridgeTarget | CanvasOperationResult; error?: CanvasAgentError
  promise: Promise<BridgeTarget | CanvasOperationResult>; resolve: (value: BridgeTarget | CanvasOperationResult) => void; reject: (error: CanvasAgentError) => void
  timer?: ReturnType<typeof setTimeout>; releaseSignal?: () => void
}
const targetIdentity = (target: BridgeTarget) => bridgeFingerprint({ connectionId: target.connectionId, sessionId: target.sessionId, canvasId: target.canvasId, contextId: target.contextId })
const error = (code: ErrorCode, message: string) => new CanvasAgentError(code, message)
function rejected(canvasId: string, code: ErrorCode, message: string): CanvasOperationResult { return { status: 'rejected', canvasId, version: null, effect: 'none', error: { code, message, retry: 'read_first' } } }
export function createCanvasHostBridge({ timeoutMs = 30000 }: { timeoutMs?: number } = {}): CanvasBridgeRegistry {
  const clients = new Map<string, Client>(), records = new Map<string, Pending>(), runs = new Map<string, RunSubscription>()
  interface SessionReferenceRecord { pending: CanvasReferenceItem[]; revision: number; owner: string; consumedMessageId?: string }
  const sessionReferences = new Map<string, SessionReferenceRecord>()
  let disposed = false, cacheBytes = 0, reservedRunBytes = 0, order = 0
  const active = () => { if (disposed) throw error('CLIENT_UNAVAILABLE', '画布通信桥已卸载') }
  const clientFor = (key: string, origin: string) => { active(); const client = clients.get(key); if (!client || client.origin !== origin) throw error('AUTH_REQUIRED', '画布桥登记无效'); return client }
  const findConnection = (id: string) => [...clients.values()].find(client => client.registration.connectionId === id)
  function finish(record: Pending, value?: BridgeTarget | CanvasOperationResult, failure?: CanvasAgentError, terminal = true) {
    if (terminal) record.terminal = true
    if (value && 'status' in value && value.status === 'rejected') {
      const run = runs.get(record.event.requestId)
      if (run?.active) { reservedRunBytes -= run.reserved; run.reserved = 0; run.active = false }
      if (record.event.type === 'canvas.command' && record.event.payload.action === 'workflow.run') {
        for (const reqId of Object.values(record.event.payload.runRequestIds)) {
          const r = runs.get(reqId)
          if (r?.active) { reservedRunBytes -= r.reserved; r.reserved = 0; r.active = false }
        }
      }
    }
    if (value !== undefined) { const size = messageBytes(value); cacheBytes += size - (record.value ? messageBytes(record.value) : 0); record.value = structuredClone(value); record.error = undefined }
    else if (failure) record.error = failure
    if (!record.waiting) return
    record.waiting = false; clearTimeout(record.timer); record.releaseSignal?.()
    if (failure) record.reject(failure); else record.resolve(structuredClone(value!))
  }
  function unavailable(record: Pending, code: ErrorCode, message: string) {
    if (!record.waiting) return
    if (record.event.type === 'canvas.prepare') finish(record, undefined, error(code === 'READ_TIMEOUT' ? 'CONTEXT_NOT_READY' : code, message))
    else if (record.sent && !isCanvasReadOperation(record.event.payload)) finish(record, {
      status: 'submission_unknown', canvasId: record.event.canvasId, version: null, phase: (isCanvasRunOperation(record.event.payload)) ? 'run' : 'save',
      affectedNodeIds: (record.event.payload.action === 'node.run' || record.event.payload.action === 'process.run') ? [record.event.payload.nodeId] : record.event.payload.action === 'workflow.run' ? record.event.payload.nodeIds : [],
      ...(record.event.payload.action === 'node.run' ? { nodeId: record.event.payload.nodeId, generation: record.event.payload.approvedGeneration } : {}), error: { code: 'SUBMISSION_UNKNOWN', message, retry: 'never_auto' }
    }, undefined, false)
    else finish(record, rejected(record.event.canvasId, record.sent ? 'READ_TIMEOUT' : code, message))
  }
  function disconnected(client: Client) {
    client.stream = undefined
    for (const record of records.values()) if (record.event.connectionId === client.registration.connectionId) unavailable(record, 'CLIENT_UNAVAILABLE', '画布连接已断开，请核对已提交的操作；不会自动重发')
  }
  function cached(requestId: string, fingerprint: string): Promise<BridgeTarget | CanvasOperationResult> | undefined {
    const record = records.get(requestId); if (!record) return
    if (record.fingerprint !== fingerprint) return Promise.reject(error('DUPLICATE_REQUEST_MISMATCH', '相同请求 ID 的目标或内容不同'))
    if (record.error) return Promise.reject(record.error)
    return record.value ? Promise.resolve(structuredClone(record.value)) : record.promise.then(value => structuredClone(value))
  }
  function submit(event: Command, fingerprint: string, client: Client, signal?: AbortSignal): Promise<BridgeTarget | CanvasOperationResult> {
    active()
    const existing = cached(event.requestId, fingerprint); if (existing) return existing
    const bytes = messageBytes(event)
    const pending = [...records.values()].filter(record => !record.terminal).length
    const singleRun = event.type === 'canvas.command' && (event.payload.action === 'node.run' || event.payload.action === 'process.run') ? runs.get(event.requestId) : undefined
    const commandRuns: RunSubscription[] = singleRun ? [singleRun] : (event.type === 'canvas.command' && event.payload.action === 'workflow.run'
      ? Object.values(event.payload.runRequestIds).map(id => runs.get(id)).filter(Boolean) as RunSubscription[]
      : [])
    if (event.type === 'canvas.command' && event.payload.action === 'workflow.run' && commandRuns.length !== event.payload.nodeIds.length) return Promise.reject(error('INVALID_ARGUMENT', '批量运行状态订阅未准备完成'))
    const inactiveRuns = commandRuns.filter(r => !r.active)
    const runReserve = inactiveRuns.length * MAX_MESSAGE_BYTES
    if (inactiveRuns.length > 0 && [...runs.values()].filter(item => item.active).length + inactiveRuns.length > MAX_BRIDGE_INFLIGHT) return Promise.reject(error('BRIDGE_OVERLOADED', '活跃生成已达上限，请等待已有任务完成'))
    if (records.size >= MAX_BRIDGE_RECORDS || pending >= MAX_BRIDGE_INFLIGHT || cacheBytes + reservedRunBytes + runReserve + bytes + (pending + 1) * MAX_MESSAGE_BYTES > MAX_BRIDGE_CACHE_BYTES) return Promise.reject(error('BRIDGE_OVERLOADED', '画布桥在途请求或回执缓存已达上限'))
    let resolve!: Pending['resolve'], reject!: Pending['reject']
    const promise = new Promise<BridgeTarget | CanvasOperationResult>((yes, no) => { resolve = yes; reject = no })
    const record: Pending = { fingerprint, event, order: ++order, waiting: true, terminal: false, sent: false, bytes, promise, resolve, reject }
    records.set(event.requestId, record); cacheBytes += bytes
    for (const r of inactiveRuns) { r.active = true; r.reserved = MAX_MESSAGE_BYTES; reservedRunBytes += MAX_MESSAGE_BYTES }
    if (signal?.aborted) { unavailable(record, 'CANCELLED_BEFORE_DISPATCH', '请求已取消，尚未发送'); return promise }
    if (!client.stream) { unavailable(record, 'CLIENT_UNAVAILABLE', '会话所属画布 Client 未连接'); return promise }
    record.timer = setTimeout(() => unavailable(record, 'READ_TIMEOUT', '画布请求超时，请核对结果；不会自动重发'), timeoutMs)
    const cancel = () => unavailable(record, 'CANCELLED_BEFORE_DISPATCH', '调用方已停止等待；已发送的写入结果未确认')
    signal?.addEventListener('abort', cancel, { once: true }); record.releaseSignal = () => signal?.removeEventListener('abort', cancel)
    try { record.sent = true; client.stream.write(event) } catch { disconnected(client) }
    return promise.then(value => structuredClone(value))
  }
  return {
    attachClient(origin, clientId, ownershipProtocol) {
      active(); assertBridgeId(clientId)
      const old = [...clients.values()].find(client => client.registration.clientId === clientId)
      if (old) { if (old.origin !== origin) throw error('AUTH_REQUIRED', 'Client 登记来源不同'); return { ...old.registration } }
      if (clients.size >= 16) throw error('BRIDGE_OVERLOADED', '画布 Client 登记已达上限')
      const registration: ClientRegistration = { protocolVersion: 4, clientId, connectionId: randomUUID(), bridgeKey: randomBytes(32).toString('base64url'), ...(ownershipProtocol ? { ownershipProtocol } : {}) }
      clients.set(registration.bridgeKey, { registration, origin, sessions: new Set(), revision: -1, contexts: new Map() }); return { ...registration }
    },
    checkClient: (key, origin) => !disposed && clients.get(key)?.origin === origin,
    connectStream(key, origin, write) {
      const client = clientFor(key, origin)
      if (client.stream) throw error('CLIENT_AMBIGUOUS', '同一 Client 已有事件流')
      const stream = { write }; client.stream = stream
      try { write({ type: 'bridge.connected', protocolVersion: 4, connectionId: client.registration.connectionId }) } catch (cause) { disconnected(client); throw cause }
      return () => { if (client.stream === stream) disconnected(client) }
    },
    acceptClientEvent(key, origin, input) {
      const client = clientFor(key, origin), event = parseServiceClientEvent(input)
      if (event.connectionId !== client.registration.connectionId) throw error('INVALID_ARGUMENT', '连接身份不匹配')
      if (event.type === 'session.sync') {
        if (event.revision < client.revision) return
        if (event.revision === client.revision && bridgeFingerprint(event.sessionIds) !== bridgeFingerprint([...client.sessions])) throw error('DUPLICATE_REQUEST_MISMATCH', '会话快照 revision 重复但内容不同')
        client.revision = event.revision; client.sessions = new Set(event.sessionIds); return
      }
      if (event.type === 'canvas.references.sync') {
        if (!client.sessions.has(event.sessionId)) throw error('CONTEXT_GONE', '节点引用所属会话未绑定')
        const record = sessionReferences.get(event.sessionId)
        const owner = record && clients.get(record.owner)
        if (record && record.owner !== key && owner?.stream && owner.sessions.has(event.sessionId)) throw error('CLIENT_AMBIGUOUS', '节点引用属于另一个 Client')
        if (record?.owner === key && event.revision < record.revision) return
        if (record?.owner === key && event.revision === record.revision) {
          if (bridgeFingerprint(record.pending) !== bridgeFingerprint(event.references)) throw error('DUPLICATE_REQUEST_MISMATCH', '引用 revision 重复但内容不同')
          if (record.consumedMessageId) this.consumeReferences(event.sessionId, record.revision, record.consumedMessageId, client.registration.connectionId)
          return
        }
        sessionReferences.set(event.sessionId, { pending: structuredClone(event.references), revision: event.revision, owner: key })
        return
      }
      if (event.type === 'canvas.context.state') {
        const context = client.contexts.get(event.canvasId)
        if (!client.sessions.has(event.sessionId) || context?.contextId !== event.contextId) throw error('CONTEXT_GONE', '上下文尚未准备、已替换或会话解绑')
        context.state = event.state; return
      }
      let record = records.get(event.requestId)
      if (!record && event.type === 'canvas.run.state') {
        for (const r of records.values()) {
          if (r.event.type === 'canvas.command' && r.event.payload.action === 'workflow.run') {
            const reqIds = Object.values(r.event.payload.runRequestIds)
            if (reqIds.includes(event.requestId)) { record = r; break }
          }
        }
      }
      if (!record || record.event.connectionId !== event.connectionId || record.event.sessionId !== event.sessionId || record.event.canvasId !== event.canvasId) throw error('INVALID_ARGUMENT', '回执目标或请求不匹配')
      if (event.type === 'canvas.run.state') {
        if (record && (record.event.type !== 'canvas.command' || record.event.contextId !== event.contextId)) throw error('CONTEXT_GONE', '运行事件上下文不匹配')
        if (record && record.event.type === 'canvas.command' && (record.event.payload.action === 'node.run' || record.event.payload.action === 'process.run')) {
          if (record.event.payload.nodeId !== event.state.nodeId) throw error('CONTEXT_GONE', '运行事件不属于已提交的节点命令')
          if (!sameGenerationCounts(event.state.generation, record.event.payload.approvedGeneration)) throw error('INVALID_ARGUMENT', '运行事件生成数量与提交不一致')
        }
        if (record && record.event.type === 'canvas.command' && record.event.payload.action === 'workflow.run') {
          if (!record.event.payload.nodeIds.includes(event.state.nodeId)) throw error('CONTEXT_GONE', '运行事件不属于已提交的工作流节点')
          if (record.event.payload.runRequestIds[event.state.nodeId] !== event.requestId) throw error('CONTEXT_GONE', '运行事件请求与节点不匹配')
          const approved = record.event.payload.approvedGenerations[event.state.nodeId]
          if (!sameGenerationCounts(event.state.generation, approved)) throw error('INVALID_ARGUMENT', '运行事件生成数量与提交不一致')
        }
        const run = runs.get(event.requestId)
        if (!run) return
        if (run.latest && event.state.sequence <= run.latest.sequence) {
          if (event.state.sequence === run.latest.sequence && bridgeFingerprint(event.state) !== bridgeFingerprint(run.latest)) throw error('DUPLICATE_REQUEST_MISMATCH', '运行事件序号重复但内容不同')
          return
        }
        if (!run.active) {
          if (run.latest && isRunTrackingClosed(run.latest)) return
          throw error('INVALID_ARGUMENT', '未提交或已拒绝的运行不能推送任务状态')
        }
        const bytes = messageBytes(event.state) - (run.latest ? messageBytes(run.latest) : 0)
        cacheBytes += bytes; run.reserved -= bytes; reservedRunBytes -= bytes; run.latest = structuredClone(event.state)
        if (isRunTrackingClosed(event.state)) { reservedRunBytes -= run.reserved; run.reserved = 0; run.active = false }
        for (const listener of run.listeners) { try { listener(structuredClone(run.latest)) } catch { /* One observer cannot corrupt native task delivery. */ } }
        return
      }
      if (event.type === 'canvas.prepare.ack') {
        if (record.event.type !== 'canvas.prepare') throw error('INVALID_ARGUMENT', '准备回执类型不匹配')
        if (record.value && 'contextId' in record.value) {
          if (event.status !== 'prepared' || bridgeFingerprint({contextId:event.contextId,readiness:event.state}) !== bridgeFingerprint({contextId:record.value.contextId,readiness:record.value.readiness})) throw error('DUPLICATE_REQUEST_MISMATCH', '准备回执内容发生变化')
          return
        }
        if (event.status === 'rejected') { finish(record, undefined, error(event.error.code, event.error.message)); return }
        const current = client.contexts.get(event.canvasId)
        if (!current || current.order <= record.order) client.contexts.set(event.canvasId, { contextId: event.contextId, state: event.state, order: record.order })
        const target = { connectionId: event.connectionId, sessionId: event.sessionId, canvasId: event.canvasId, contextId: event.contextId, readiness: event.state }
        const capability = record.event.capability
        if (!event.state.capabilities[capability]) finish(record, undefined, error(event.state.reason?.code ?? (event.state.phase === 'inactive' ? 'CONTEXT_INACTIVE' : 'CONTEXT_NOT_READY'), event.state.reason?.message ?? '画布未取得所需能力'))
        else finish(record, target)
      } else {
        if (record.event.type !== 'canvas.command' || record.event.contextId !== event.contextId) throw error('CONTEXT_GONE', '命令回执上下文不匹配')
        if (event.phase !== 'settled') return
        if (record.terminal) return
        const result = event.result
        assertCanvasResultMatches(record.event.payload, result, record.event.requestId)
        const isRun = isCanvasRunOperation(record.event.payload)
        const expectedStatus = expectedCanvasReadStatus(record.event.payload)
        if (isCanvasReadOperation(record.event.payload) ? ![expectedStatus, 'rejected'].includes(result.status) : !(isRun ? ['submitted', 'process_submitted', 'process_partial', 'submission_unknown', 'rejected'] : ['saved', 'submission_unknown', 'rejected']).includes(result.status)) throw error('INVALID_ARGUMENT', '回执与操作类型不匹配')
        if (record.event.payload.action === 'node.run' && (result.status === 'submitted' && (!('nodeId' in result) || result.nodeId !== record.event.payload.nodeId || !sameGenerationCounts(result.generation, record.event.payload.approvedGeneration)) || result.status === 'submission_unknown' && result.phase !== 'run')) throw error('INVALID_ARGUMENT', '执行回执与节点或生成数量不匹配')
        if (record.event.payload.action === 'workflow.run' && (result.status === 'submitted' && (!('nodeIds' in result) || bridgeFingerprint(result.nodeIds) !== bridgeFingerprint(record.event.payload.nodeIds)) || result.status === 'submission_unknown' && result.phase !== 'run')) throw error('INVALID_ARGUMENT', '执行回执与工作流节点不匹配')
        if (!isRun && result.status === 'submission_unknown' && result.phase !== 'save') throw error('INVALID_ARGUMENT', '保存回执不能携带执行未知状态')
        finish(record, result)
      }
    },
    async ensureContext(sessionId, canvasId, capability, requestId, signal, refresh = false) {
      active(); assertBridgeId(sessionId); assertBridgeId(requestId)
      if (!parseCanvasId(canvasId) || !['read', 'edit', 'run'].includes(capability) || (refresh && capability !== 'read')) throw error('INVALID_ARGUMENT', '画布或能力无效')
      const fingerprint = bridgeFingerprint({ type: 'canvas.prepare', sessionId, canvasId, capability, refresh })
      const old = cached(requestId, fingerprint); if (old) return await old as BridgeTarget
      const candidates = [...clients.values()].filter(client => client.stream && client.sessions.has(sessionId))
      if (candidates.length !== 1) throw error(candidates.length ? 'CLIENT_AMBIGUOUS' : 'CLIENT_UNAVAILABLE', '会话没有唯一已连接的画布 Client')
      if (capability !== 'read' && [...clients.values()].some(client => client.origin === candidates[0].origin && client.registration.ownershipProtocol !== OWNERSHIP_PROTOCOL)) throw error('CONTEXT_INACTIVE', '检测到旧版画布Client，请关闭或重载相关窗口并重启客户端后再编辑')
      const event = parseServiceHostEvent({ type: 'canvas.prepare', protocolVersion: 4, connectionId: candidates[0].registration.connectionId, sessionId, canvasId, requestId, deadline: Date.now() + timeoutMs, capability, refresh }) as Command
      return await submit(event, fingerprint, candidates[0], signal) as BridgeTarget
    },
    async dispatch(target, requestId, input, signal) {
      active(); assertBridgeId(requestId)
      const operation = parseBridgeOperation(input)
      const fingerprint = bridgeFingerprint({ type: 'canvas.command', connectionId: target.connectionId, sessionId: target.sessionId, canvasId: target.canvasId, contextId: target.contextId, payload: operation })
      const old = cached(requestId, fingerprint); if (old) return await old as CanvasOperationResult
      if (signal?.aborted) return rejected(target.canvasId, 'CANCELLED_BEFORE_DISPATCH', '请求已取消，尚未发送')
      const client = findConnection(target.connectionId), context = client?.contexts.get(target.canvasId)
      if (!client?.stream || !client.sessions.has(target.sessionId)) return rejected(target.canvasId, 'CLIENT_UNAVAILABLE', '目标 Client 或会话已断开')
      if (context?.contextId !== target.contextId) return rejected(target.canvasId, 'CONTEXT_GONE', '目标上下文已被替换')
      const capability = isCanvasRunOperation(operation) || operation.action === 'node.preflight' ? 'run' : isCanvasReadOperation(operation) ? 'read' : 'edit'
      if (capability !== 'read' && [...clients.values()].some(other => other.origin === client.origin && other.registration.ownershipProtocol !== OWNERSHIP_PROTOCOL)) return rejected(target.canvasId, 'CONTEXT_INACTIVE', '旧版画布Client未完成升级，请重启相关客户端后再编辑')
      if (!context.state.capabilities[capability]) return rejected(target.canvasId, context.state.reason?.code ?? 'CONTEXT_NOT_READY', context.state.reason?.message ?? '画布暂不可执行')
      const event = parseServiceHostEvent({ type: 'canvas.command', protocolVersion: 4, connectionId: target.connectionId, sessionId: target.sessionId, canvasId: target.canvasId, contextId: target.contextId, requestId, deadline: Date.now() + timeoutMs, payload: operation }) as Command
      if ((operation.action === 'node.run' || operation.action === 'process.run') && !runs.has(requestId)) {
        if (runs.size >= MAX_BRIDGE_RECORDS) throw error('BRIDGE_OVERLOADED', '运行状态缓存已达上限')
        runs.set(requestId, { target: structuredClone(target), listeners: new Set(), active: false, reserved: 0 })
      }
      return await submit(event, fingerprint, client, signal) as CanvasOperationResult
    },
    subscribeRun(target, requestId, listener) {
      active(); assertBridgeId(requestId)
      let run = runs.get(requestId)
      if (!run) {
        const client = findConnection(target.connectionId), context = client?.contexts.get(target.canvasId)
        if (!client || context?.contextId !== target.contextId) throw error('CONTEXT_GONE', '运行订阅目标上下文已替换或释放')
      }
      if (run && targetIdentity(run.target) !== targetIdentity(target)) throw error('DUPLICATE_REQUEST_MISMATCH', '运行订阅请求目标不同')
      if (!run) {
        if (runs.size >= MAX_BRIDGE_RECORDS) throw error('BRIDGE_OVERLOADED', '运行状态订阅已达上限')
        run = { target: structuredClone(target), listeners: new Set(), active: false, reserved: 0 }; runs.set(requestId, run)
      }
      run.listeners.add(listener)
      if (run.latest) listener(structuredClone(run.latest))
      return () => { run!.listeners.delete(listener) }
    },
    detachClient(key, origin) {
      const client = clientFor(key, origin); disconnected(client)
      for (const [requestId, run] of runs) {
        if (!run.active || run.target.connectionId !== client.registration.connectionId) continue
        const record = records.get(requestId) ?? [...records.values()].find(entry => entry.event.type === 'canvas.command'
          && entry.event.payload.action === 'workflow.run' && Object.values(entry.event.payload.runRequestIds).includes(requestId))
        if (!record || record.event.type !== 'canvas.command') continue
        const payload = record.event.payload
        if (payload.action !== 'node.run' && payload.action !== 'workflow.run' && payload.action !== 'process.run') continue
        const nodeId = payload.action !== 'workflow.run' ? payload.nodeId : Object.keys(payload.runRequestIds).find(id => payload.runRequestIds[id] === requestId)!
        const approvedGeneration: GenerationCounts = payload.action !== 'workflow.run'
          ? payload.approvedGeneration
          : payload.approvedGenerations[nodeId]
        const next: CanvasRunState = { ...run.latest, requestId, canvasId: run.target.canvasId, nodeId,
          sequence: (run.latest?.sequence ?? 0) + 1, phase: 'monitoring_unknown', version: run.latest?.version ?? null,
          generation: approvedGeneration, outputs: [], ...(payload.action === 'process.run' ? { operationId: requestId } : {}),
          error: { code: 'CLIENT_UNAVAILABLE', message: '客户端生成跟踪已关闭，后台结果尚未确认；请核对画布，不要重复生成', retry: 'never_auto' } }
        cacheBytes += messageBytes(next) - (run.latest ? messageBytes(run.latest) : 0)
        reservedRunBytes -= run.reserved; run.reserved = 0; run.active = false; run.latest = structuredClone(next)
        for (const listener of run.listeners) { try { listener(structuredClone(next)) } catch { /* Detached native work remains independent of observer errors. */ } }
      }
      for (const [sessionId, record] of sessionReferences) { if (record.owner === key) sessionReferences.delete(sessionId) }
      clients.delete(key)
    },
    getPendingReferences(sessionId) {
      active(); assertBridgeId(sessionId)
      const record = sessionReferences.get(sessionId)
      if (!record?.pending.length || record.consumedMessageId || !clients.get(record.owner)?.sessions.has(sessionId)) return undefined
      return { items: structuredClone(record.pending), revision: record.revision, connectionId: clients.get(record.owner)!.registration.connectionId }
    },
    consumeReferences(sessionId, revision, messageId, connectionId) {
      active(); assertBridgeId(sessionId); assertBridgeId(messageId)
      const record = sessionReferences.get(sessionId)
      if (!record?.pending.length || record.revision !== revision) return
      const client = clients.get(record.owner)
      if (client?.registration.connectionId !== connectionId) return
      record.consumedMessageId = messageId
      if (client?.stream && client.sessions.has(sessionId)) {
        try { client.stream.write({ protocolVersion: 4, connectionId: client.registration.connectionId,
          type: 'canvas.references.consumed', sessionId, revision, messageId }) }
        catch { disconnected(client) }
      }
    },
    dispose() { if (disposed) return; for (const client of clients.values()) disconnected(client); disposed = true; sessionReferences.clear(); for (const record of records.values()) { clearTimeout(record.timer); record.releaseSignal?.() } clients.clear(); records.clear(); runs.clear(); cacheBytes = 0; reservedRunBytes = 0 },
  }
}
