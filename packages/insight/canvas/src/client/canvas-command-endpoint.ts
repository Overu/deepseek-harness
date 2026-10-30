import { assertCanvasResultMatches, isCanvasRunOperation, expectedCanvasReadStatus, isCanvasReadOperation,
  CanvasAgentError, MAX_MESSAGE_BYTES, ERROR_CODES, type CanvasOperationResult, type ErrorCode,
  type Failure } from '../shared/canvas-agent-protocol.ts'
import { bridgeFingerprint, isRunTrackingClosed, messageBytes, MAX_BRIDGE_CACHE_BYTES, MAX_BRIDGE_INFLIGHT,
  MAX_BRIDGE_RECORDS, parseServiceHostEvent, parseServiceClientEvent, type ServiceHostEvent, type ServiceClientEvent,
  type PrepareAck, type CommandAck } from '../shared/canvas-bridge-protocol.ts'
import type { CanvasServiceRuntimeBase } from '../shared/canvas-service-runtime.ts'
import { sameGenerationCounts } from '../shared/canvas-generation-counts.ts'
type RunEvent = Extract<ServiceClientEvent, { type: 'canvas.run.state' }>
type Command = Extract<ServiceHostEvent, { type: 'canvas.prepare' | 'canvas.command' }>
interface Entry { fingerprint: string
  latest?: PrepareAck | CommandAck
  latestRuns: Map<string, RunEvent>
  done: Promise<void>
  pending: boolean }
export interface CanvasCommandEndpoint {
  handle(input: ServiceHostEvent): Promise<void>
  releaseSession(sessionId: string): void
  dispose(): void
}
function failure(cause: unknown): Failure {
  const input = cause !== null && typeof cause === 'object' ? cause as { code?: ErrorCode
    message?: string } : {}
  return { code: input.code !== undefined && ERROR_CODES.includes(input.code) ? input.code : 'CONTEXT_NOT_READY',
    message: input.message || '画布服务暂不可用', retry: 'read_first' }
}
export function createCanvasCommandEndpoint(options: { connectionId: string
  getRuntime: () => Promise<CanvasServiceRuntimeBase>
  isSessionBound: (sessionId: string) => boolean
  send: (event: ServiceClientEvent) => void
  openCanvas?: (sessionId: string, canvasId: string, nodeId?: string) => Promise<CanvasOperationResult> }): CanvasCommandEndpoint {
  const entries = new Map<string, Entry>(), subscriptions = new Map<string, { sessionId:string
    stop:()=>void }>()
  const runSubscriptions = new Map<string, { stop?: () => void
    active: boolean
    reserved: number }>()
  let disposed = false, cacheBytes = 0, reservedRunBytes = 0
  const emit = (event: ServiceClientEvent) => { if (!disposed) { try { options.send(event) } catch {
    /* A transport failure cannot undo or reclassify a native receipt. */ } } }
  const reject = (event: Command, cause: unknown): PrepareAck | CommandAck => event.type === 'canvas.prepare'
    ? { type: 'canvas.prepare.ack', protocolVersion: 4, connectionId: event.connectionId, sessionId: event.sessionId,
      canvasId: event.canvasId, requestId: event.requestId, status: 'rejected', error: failure(cause) }
    : { type: 'canvas.command.ack', protocolVersion: 4, connectionId: event.connectionId, sessionId: event.sessionId,
      canvasId: event.canvasId, contextId: event.contextId, requestId: event.requestId, phase: 'settled', result: {
        status: 'rejected', canvasId: event.canvasId, version: null, effect: 'none', error: failure(cause) } }
  function check(event: Command) {
    if (disposed) throw new CanvasAgentError('CLIENT_UNAVAILABLE', '画布通信桥已卸载')
    if (!options.isSessionBound(event.sessionId)) throw new CanvasAgentError('AGENT_CONTEXT_REQUIRED', '会话未在本 Client 登记')
    if (Date.now() >= event.deadline) throw new CanvasAgentError('CANCELLED_BEFORE_DISPATCH', '命令已过期，尚未执行')
  }
  function watch(runtime: CanvasServiceRuntimeBase, event: Command, contextId: string) {
    if (disposed || !options.isSessionBound(event.sessionId)) return
    const key = JSON.stringify([event.sessionId, event.canvasId])
    subscriptions.get(key)?.stop()
    const stop = runtime.subscribeReadiness(event.canvasId, (state) =>{  emit({ type: 'canvas.context.state',
      protocolVersion: 4, connectionId: event.connectionId, sessionId: event.sessionId, canvasId: event.canvasId, contextId, state }) })
    subscriptions.set(key, { sessionId:event.sessionId,stop })
  }
  function stopRun(requestId: string) {
    const subscription = runSubscriptions.get(requestId); if (!subscription) return
    subscription.active = false; reservedRunBytes -= subscription.reserved; subscription.reserved = 0
    subscription.stop?.(); runSubscriptions.delete(requestId)
  }
  function runRequestIds(event: Extract<Command, { type: 'canvas.command' }>): string[] {
    return event.payload.action === 'workflow.run' ? Object.values(event.payload.runRequestIds) : [event.requestId]
  }
  function stopRuns(event: Extract<Command, { type: 'canvas.command' }>) {
    for (const requestId of runRequestIds(event)) stopRun(requestId)
  }
  function watchRun(runtime: CanvasServiceRuntimeBase, event: Extract<Command, { type: 'canvas.command' }>, entry: Entry) {
    // Reserve the full bounded state before invoke. A submitted run must never lose its terminal event to cache pressure.
    const requestIds = runRequestIds(event)
    if (runSubscriptions.size + requestIds.length > MAX_BRIDGE_INFLIGHT ||
 cacheBytes + reservedRunBytes + requestIds.length * MAX_MESSAGE_BYTES > MAX_BRIDGE_CACHE_BYTES) throw new CanvasAgentError('BRIDGE_OVERLOADED', '活跃生成或任务状态缓存已达上限，请等待已有任务完成')
    const subscriptions = requestIds.map(requestId => ({ requestId, subscription: { active: true,
      reserved: MAX_MESSAGE_BYTES } as { stop?: () => void
      active: boolean
      reserved: number } }))
    for (const { requestId, subscription } of subscriptions) {
      reservedRunBytes += subscription.reserved
      runSubscriptions.set(requestId, subscription)
    }
    try {
      for (const { requestId, subscription } of subscriptions) {
        subscription.stop = runtime.subscribeRun({ canvasId: event.canvasId, expectedContextId: event.contextId, requestId }, (state) => {
          if (!subscription.active || disposed) return
          const next = parseServiceClientEvent({ type: 'canvas.run.state', protocolVersion: 4,
            connectionId: event.connectionId, sessionId: event.sessionId, canvasId: event.canvasId, contextId: event.contextId,
            requestId, state }) as RunEvent
          const previous = entry.latestRuns.get(requestId)
          const bytes = messageBytes(next) - (previous ? messageBytes(previous) : 0)
          cacheBytes += bytes; subscription.reserved -= bytes; reservedRunBytes -= bytes
          entry.latestRuns.set(requestId, next); emit(next)
          if (isRunTrackingClosed(state)) stopRun(requestId)
        })
        if (!subscription.active) subscription.stop()
      }
    } catch (cause) {
      for (const { requestId } of subscriptions) stopRun(requestId)
      throw cause
    }
  }
  return {
    async handle(input) {
      const event = parseServiceHostEvent(input)
      if (event.connectionId !== options.connectionId) throw new CanvasAgentError('INVALID_ARGUMENT', '命令属于另一 Client 连接')
      if (event.type !== 'canvas.prepare' && event.type !== 'canvas.command') return
      const fingerprint = bridgeFingerprint(event), existing = entries.get(event.requestId)
      if (existing) {
        if (existing.fingerprint !== fingerprint) { emit(reject(event,
          new CanvasAgentError('DUPLICATE_REQUEST_MISMATCH', '相同请求 ID 的命令内容不同'))); return }
        if (existing.latest) emit(existing.latest)
        for (const latestRun of existing.latestRuns.values()) emit(latestRun)
        await existing.done
        if (existing.latest) emit(existing.latest)
        for (const latestRun of existing.latestRuns.values()) emit(latestRun)
        return
      }
      const pending = [...entries.values()].filter(entry => entry.pending).length
      if (entries.size >= MAX_BRIDGE_RECORDS || pending >= MAX_BRIDGE_INFLIGHT ||
 cacheBytes + reservedRunBytes + messageBytes(event) + (pending + 1) * MAX_MESSAGE_BYTES > MAX_BRIDGE_CACHE_BYTES) {
        emit(reject(event, new CanvasAgentError('BRIDGE_OVERLOADED', '画布命令或回执缓存已达上限'))); return }
      let complete!: () => void
      const entry: Entry = { fingerprint, latestRuns: new Map(), done: new Promise<void>((resolve) => {
        complete = resolve }), pending: true }
      entries.set(event.requestId, entry); cacheBytes += messageBytes(event)
      let startedExecution = false
      const settle = (ack: PrepareAck | CommandAck) => {
        ack = parseServiceClientEvent(ack) as PrepareAck | CommandAck
        cacheBytes += messageBytes(ack) - (entry.latest ? messageBytes(entry.latest) : 0); entry.latest = ack; emit(ack)
      }
      try {
        check(event)
        if (event.type === 'canvas.command') settle({ type: 'canvas.command.ack', protocolVersion: 4,
          connectionId: event.connectionId, sessionId: event.sessionId, canvasId: event.canvasId, contextId: event.contextId,
          requestId: event.requestId, phase: 'accepted' })
        const runtime = await options.getRuntime(); check(event)
        if (event.type === 'canvas.prepare') {
          const info = await (event.refresh ? runtime.reloadContext({
            canvasId: event.canvasId, capability: event.capability }) : runtime.ensureContext({
            canvasId: event.canvasId, capability: event.capability }))
          if (disposed) return
          settle({ type: 'canvas.prepare.ack', protocolVersion: 4, connectionId: event.connectionId,
            sessionId: event.sessionId, canvasId: event.canvasId, requestId: event.requestId, status: 'prepared',
            contextId: info.contextId, state: info.readiness })
          watch(runtime, event, info.contextId)
        } else {
          const info = runtime.getContextInfo(event.canvasId)
          if (info?.contextId !== event.contextId) throw new CanvasAgentError('CONTEXT_GONE', '目标画布上下文已被替换或释放')
          const isRun = isCanvasRunOperation(event.payload)
          const capability = isRun ||
 event.payload.action === 'node.preflight' ? 'run' : isCanvasReadOperation(event.payload) ? 'read' : 'edit'
          if (!info.readiness.capabilities[capability]) throw new CanvasAgentError(info.readiness.reason?.code ?? 'CONTEXT_NOT_READY', info.readiness.reason?.message ?? '画布暂不可执行')
          if (isRun) watchRun(runtime, event, entry)
          settle({ type: 'canvas.command.ack', protocolVersion: 4, connectionId: event.connectionId,
            sessionId: event.sessionId, canvasId: event.canvasId, contextId: event.contextId,
            requestId: event.requestId, phase: 'started' })
          // No await between identity check and execute's synchronous context capture.
          startedExecution = true
          const result: CanvasOperationResult = event.payload.action === 'canvas.open'
            ? await (options.openCanvas?.(event.sessionId, event.canvasId,
              event.payload.nodeId) ?? Promise.reject(new CanvasAgentError('CLIENT_UNAVAILABLE', '画布导航未安装')))
            : await runtime.execute({ canvasId: event.canvasId, expectedContextId: event.contextId,
              operation: event.payload, ...(isRun ? { requestId: event.requestId } : {}) })
          assertCanvasResultMatches(event.payload, result, event.requestId)
          const readStatus = expectedCanvasReadStatus(event.payload)
          if (isCanvasReadOperation(event.payload) ? ![readStatus,
            'rejected'].includes(result.status) : !(isRun ? ['submitted', 'process_submitted', 'process_partial',
            'submission_unknown', 'rejected'] : ['saved', 'submission_unknown',
            'rejected']).includes(result.status)) throw new CanvasAgentError('INVALID_ARGUMENT', '回执与操作类型不匹配')
          if (event.payload.action === 'node.run' && (result.status === 'submitted' && (!('nodeId' in result) ||
 result.nodeId !== event.payload.nodeId || !sameGenerationCounts(result.generation,
            event.payload.approvedGeneration)) || result.status === 'submission_unknown' &&
 result.phase !== 'run')) throw new CanvasAgentError('INVALID_ARGUMENT', '执行回执与节点或生成数量不匹配')
          if (event.payload.action === 'workflow.run' && (result.status === 'submitted' && (!('nodeIds' in result) ||
 bridgeFingerprint(result.nodeIds) !== bridgeFingerprint(event.payload.nodeIds)) ||
 result.status === 'submission_unknown' && result.phase !== 'run')) throw new CanvasAgentError('INVALID_ARGUMENT', '执行回执与工作流节点不匹配')
          if (!isRun && result.status === 'submission_unknown' &&
 result.phase !== 'save') throw new CanvasAgentError('INVALID_ARGUMENT', '保存回执不能携带执行未知状态')
          settle({ type: 'canvas.command.ack', protocolVersion: 4, connectionId: event.connectionId,
            sessionId: event.sessionId, canvasId: event.canvasId, contextId: event.contextId,
            requestId: event.requestId, phase: 'settled', result })
          if (result.status === 'rejected' && isRun) stopRuns(event)
        }
      } catch (cause) {
        if (event.type === 'canvas.command' && !isCanvasReadOperation(event.payload) && startedExecution &&
 (cause !== null && typeof cause === 'object' && 'requestPhase' in cause ? cause.requestPhase : undefined) !== 'not_sent') {
          const isRun = isCanvasRunOperation(event.payload)
          settle({ type:'canvas.command.ack',protocolVersion:4,connectionId:event.connectionId,
            sessionId:event.sessionId,canvasId:event.canvasId,contextId:event.contextId,requestId:event.requestId,phase:'settled',
            result:{ status:'submission_unknown',canvasId:event.canvasId,version:null,phase:isRun?'run':'save',
              affectedNodeIds:(event.payload.action==='node.run'||
event.payload.action==='process.run')?[event.payload.nodeId]:event.payload.action==='workflow.run'?event.payload.nodeIds:[],...(event.payload.action==='node.run'?{ nodeId:event.payload.nodeId,generation:event.payload.approvedGeneration }:{}),error:{ code:'SUBMISSION_UNKNOWN',message:'服务已开始执行，但未取得可信保存回执，请核对结果',retry:'never_auto' } } })
        } else {
          if (event.type === 'canvas.command' && (isCanvasRunOperation(event.payload))) stopRuns(event)
          settle(reject(event, cause))
        }
      }
      finally { entry.pending = false; complete() }
    },
    releaseSession(sessionId) { for (const [key, value] of subscriptions) if (value.sessionId === sessionId) {
      value.stop(); subscriptions.delete(key) } },
    dispose() { if (disposed) return; disposed = true; for (const value of subscriptions.values()) value.stop()
      subscriptions.clear(); for (const value of runSubscriptions.values()) value.stop?.(); runSubscriptions.clear()
      entries.clear(); cacheBytes = 0; reservedRunBytes = 0 },
  }
}
