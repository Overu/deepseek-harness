import { registerCanvasTool, type CanvasActivities } from './activities.ts'
import { createCanvasIntentBudget, type CanvasIntentBudget, confirmCanvasVolume } from './canvas-intent-budget.ts'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-user-questions'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { CanvasAgentError, MAX_MESSAGE_BYTES, parseCanvasOperation, type CanvasOperationResult, type GenerationCounts,
  type RunReceipt, type UnknownReceipt, type CanvasRunOutput, type CanvasSingleRunOutput,
  type ToolRejection } from '../shared/canvas-agent-protocol.ts'
import type { CanvasRunState } from '../shared/canvas-run-protocol.ts'
import type { CanvasResultBinding } from '../shared/canvas-result-source.ts'
import { bridgeFingerprint, isRunTrackingClosed, MAX_BRIDGE_INFLIGHT, MAX_BRIDGE_RECORDS,
  type BridgeTarget } from '../shared/canvas-bridge-protocol.ts'
import { canvasToolContracts } from '../shared/canvas-tool-contracts.ts'
import { canvasAddress, type CanvasId } from '../shared/protocol.ts'
import type { CanvasHostBridge } from './canvas-bridge.ts'
import { canvasAgent, argumentsObject, canvasToolOutput, idOf, reject, requestId, sessionOf } from './canvas-tools.ts'
import { addGenerationCounts, generationOutputCount } from '../shared/canvas-generation-counts.ts'

declare module '@deepseek-ai/dsh-jobs/view' { interface JobKindMap { canvas: 'canvas' } }
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * Informational origin of Canvas generation completion messages.
     * @persistenceAttribution
     */
    'canvas-run': { kind: 'canvas-run' }
  }
}

const sum = (a: GenerationCounts, b: GenerationCounts) => {
  try { return addGenerationCounts(a, b) } catch { throw new CanvasAgentError('INVALID_ARGUMENT', '生成数量超出可信计数范围') }
}
const zero = () => ({ images: 0, videos: 0 })

/** Native submissions share one Jobs lifecycle; Client owns execution and per-node monitoring. */
export function registerCanvasRunTools(ctx: Context, bridge: CanvasHostBridge, { results,
  imageTimeoutMs = 30 * 60_000, videoTimeoutMs = 60 * 60_000, audioTimeoutMs = 30 * 60_000,
  budget = createCanvasIntentBudget() }: { budget?: CanvasIntentBudget
  results?: {
    record(binding: CanvasResultBinding, state: CanvasRunState): Promise<void> }
  imageTimeoutMs?: number
  videoTimeoutMs?: number
  audioTimeoutMs?: number } = {}, activities?: CanvasActivities): void {
  const pendingRootCalls = budget.roots, latestUser = budget.latestUser, usages = budget.usages, owners = budget.owners
  const calls = new Map<string, { fingerprint: string
      promise: Promise<CanvasRunOutput> }>(), busy = budget.busy, cancels = new Set<() => void>()
  const sourceObservers = new Set<() => void>()
  let disposed = false
  // Observe actual human input; completion notices and model arguments cannot mint a fresh allowance.
  ctx.on('session/event', (session, event) =>{  budget.observe(session, event) }, { global: true })
  ctx.effect(() => () => { disposed = true; for (const cancel of cancels) cancel()
    for (const stop of sourceObservers) stop(); calls.clear(); busy.clear() }, 'desktop-canvas: generation jobs')

  function observeProducts(binding: CanvasResultBinding, target: BridgeTarget, request: string, nodeId: string): () => void {
    const store = results
    if (!store) return () => {}
    let closed = false, release: (() => void) | undefined
    const stop = () => { if (closed) return; closed = true; release?.(); sourceObservers.delete(stop) }
    sourceObservers.add(stop)
    try {
      release = bridge.subscribeRun(target, request, (state) => {
        if (closed || state.requestId !== request || state.canvasId !== target.canvasId || state.nodeId !== nodeId) return
        if ((state.phase === 'completed' || state.phase === 'failed') && state.outputs.length > 0) {
          // Source capture outlives Jobs waiting/kill, but never changes its result or dispatches work.
          const write = store.record(binding, state).catch(() => { ctx.logger.warn('desktop-canvas: result source persistence unavailable') })
          void activities?.track(write)
        }
        if (isRunTrackingClosed(state)) stop()
      })
      // A terminal replay may close before subscribeRun returns its disposer.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- The subscription may replay or close synchronously.
      if (closed) release()
      return stop
    } catch (error) { stop(); throw error }
  }

  async function serialize<T>(owner: object, task: () => Promise<T>): Promise<T> {
    const previous = owners.get(owner) ?? Promise.resolve()
    let release!: () => void
    const slot = new Promise<void>((resolve) => { release = resolve }); owners.set(owner, previous.then(() => slot))
    await previous
    try { return await task() } finally { release() }
  }
  async function runBatch(input: unknown, exec: ToolRunContext, request: string): Promise<CanvasRunOutput> {
    const args = argumentsObject(input, ['canvasId', 'nodeIds', 'expectedVersion']), id = idOf(args)
    if (!Array.isArray(args.nodeIds) || args.nodeIds.length === 0 ||
 new Set(args.nodeIds).size !== args.nodeIds.length) throw new CanvasAgentError('INVALID_ARGUMENT', 'nodeIds必须是非空且不重复的节点ID数组')
    const nodeIds = args.nodeIds.map((nodeId: unknown) => {
      const operation = parseCanvasOperation({ action: 'node.preflight', nodeId, expectedVersion: args.expectedVersion })
      if (operation.action !== 'node.preflight') throw new CanvasAgentError('INVALID_ARGUMENT', '生成节点参数无效')
      return operation.nodeId
    })
    const session = sessionOf(exec), owner = canvasAgent(exec), address = canvasAddress(id)
    const sequence = latestUser.get(owner.session)
    if (sequence === undefined) throw new CanvasAgentError('AGENT_CONTEXT_REQUIRED', '无法绑定本次生成的真实用户请求')
    const rootCall = pendingRootCalls.get(owner.session)?.get(String(exec.rootCallId))
    const binding: CanvasResultBinding | undefined = results && rootCall ? {
      sessionId: String(owner.session.id), ownerId: String(owner.id), rootCallId: String(exec.rootCallId), callId: String(exec.callId),
      turn: rootCall.turn, rootCallSeq: rootCall.seq, sessionCreatedAt: owner.session.header.createdAt,
    } : undefined
    if (results && !binding) ctx.logger.warn('desktop-canvas: original tool call unavailable for result source binding')

    return serialize(owner.session, async () => {
      const ready = () => {
        if (disposed) throw new CanvasAgentError('CLIENT_UNAVAILABLE', '画布生成服务已卸载')
        if (exec.signal.aborted) throw new CanvasAgentError('CANCELLED_BEFORE_DISPATCH', '生成已取消，尚未提交')
        if (latestUser.get(owner.session) !== sequence) throw new CanvasAgentError('COUNT_CHANGED', '用户请求已变化，尚未提交')
      }
      ready()
      if (nodeIds.some(nodeId => busy.has(JSON.stringify([id, nodeId])))) throw new CanvasAgentError('NODE_BUSY', '节点已有正在跟踪的生成，请等待现有任务')
      const jobs = ctx.get('jobs')
      if (!jobs) throw new CanvasAgentError('CONTEXT_NOT_READY', '当前对话缺少后台任务服务，尚未提交生成')
      const target = await bridge.ensureContext(session, id, 'run', request + ':prepare', exec.signal)
      ready()
      const generations: GenerationCounts[] = [], versions: string[] = []
      for (let index = 0; index < nodeIds.length; index++) {
        const preflight = await bridge.dispatch(target, nodeIds.length === 1 ? request + ':preflight' : `${request}:preflight:${index}`,
          { action: 'node.preflight', nodeId: nodeIds[index], expectedVersion: String(args.expectedVersion) }, exec.signal)
        ready()
        if (preflight.status === 'rejected') return { ...preflight, requestId: request, address }
        if (preflight.status !== 'preflight') throw new CanvasAgentError('CONTEXT_NOT_READY', '未取得可信生成预检，尚未提交')
        generations.push(preflight.generation); versions.push(preflight.version)
      }
      const available = MAX_BRIDGE_INFLIGHT - busy.size
      if (available <= 0) return { status: 'paused', requestId: request, canvasId: id, address, nodeIds, results: [],
        nextIndex: 0, version: String(args.expectedVersion) }
      const batchNodeIds = nodeIds.slice(0, available), single = nodeIds.length === 1
      const generation = generations.slice(0, batchNodeIds.length).reduce(sum, zero())
      let usage = usages.get(owner.session)
      if (!usage || usage.sequence !== sequence) { usage = { sequence, generation: zero() }; usages.set(owner.session, usage) }
      const total = sum(usage.generation, generation)
      if (!Number.isSafeInteger(total.images) ||
 !Number.isSafeInteger(total.videos)) throw new CanvasAgentError('INVALID_ARGUMENT', '生成数量超出可信计数范围')
      await confirmCanvasVolume(ctx, exec, generation, total)
      ready()
      if (batchNodeIds.some(nodeId => busy.has(JSON.stringify([id, nodeId])))) throw new CanvasAgentError('NODE_BUSY',
        '节点已有正在跟踪的生成，请等待现有任务')
      if (batchNodeIds.length > MAX_BRIDGE_INFLIGHT - busy.size) throw new CanvasAgentError('BRIDGE_OVERLOADED', '活跃生成已达上限，请等待已有任务完成')

      const approvedGenerations = Object.fromEntries(batchNodeIds.map((nodeId, index) => [nodeId, generations[index]]))
      const runRequestIds = Object.fromEntries(batchNodeIds.map((nodeId, index) => [nodeId,
        single ? request + ':run' : `${request}:run:${index}`]))
      const oldCounts = usage.generation
      let rollback = () => { usage.generation = oldCounts }
      let resolveReceipt!: (value: CanvasRunOutput) => void
      const receipt = new Promise<CanvasRunOutput>((resolve) => { resolveReceipt = resolve })
      for (const nodeId of batchNodeIds) busy.set(JSON.stringify([id, nodeId]), request)
      let jobId = ''
      try {
        jobId = String(jobs.start({ kind: 'canvas', owner: owner.id, label: `画布${id}：生成${batchNodeIds.length}个节点`,
          outputLimitBytes: MAX_MESSAGE_BYTES,
          run(job) {
            const productStops: (() => void)[] = [], subscriptions: (() => void)[] = [], states = new Map<string, CanvasRunState>()
            let finished = false, stopped = false, sent = false, last: CanvasRunState | undefined,
              timer: ReturnType<typeof setTimeout> | undefined
            const controller = new AbortController()
            let settle!: (outcome: JobOutcome) => void
            const done = new Promise<JobOutcome>((resolve) => { settle = resolve })
            void activities?.track(done)
            const finish = (outcome: JobOutcome) => {
              if (finished) return
              finished = true; clearTimeout(timer); subscriptions.forEach((stop) =>{  stop() }); cancels.delete(cancel)
              for (const nodeId of batchNodeIds) {
                const key = JSON.stringify([id, nodeId])
                if (busy.get(key) === request) busy.delete(key)
              }
              settle(outcome)
            }
            const cancel = () => {
              stopped = true; controller.abort()
              finish({ status: 'killed', detail: sent ? '已停止本次跟踪；后台生成可能继续' : '已停止，尚未提交生成' })
            }
            cancels.add(cancel)
            const stopProducts = () =>{  productStops.forEach((stop) =>{  stop() }) }
            const unknown = (): UnknownReceipt => ({ status: 'submission_unknown', canvasId: id, version: last?.version ?? null,
              phase: 'run', affectedNodeIds: batchNodeIds, generation, ...(last?.workflowTaskId ? { taskId: last.workflowTaskId } : {}),
              error: { code: 'SUBMISSION_UNKNOWN', message: '生成提交或跟踪结果未确认', retry: 'never_auto' } })
            const publicReceipt = (result: RunReceipt | UnknownReceipt): CanvasRunOutput => ({
              status: result.status === 'submitted' ? batchNodeIds.length < nodeIds.length ? 'paused' : 'submitted' : 'submission_unknown',
              requestId: request, canvasId: id, address, nodeIds, jobId: String(job.id), version: result.version,
              nextIndex: result.status === 'submitted' ? batchNodeIds.length : 0,
              results: batchNodeIds.map((nodeId): CanvasSingleRunOutput => {
                const common = { canvasId: id, version: result.version, nodeId,
                  generation: approvedGenerations[nodeId], requestId: request, address, jobId: String(job.id) }
                return result.status === 'submitted'
                  ? { ...common, status: 'submitted', version: result.version, taskId: result.taskId, tracking: '等待任务终态' }
                  : { ...common, status: 'submission_unknown', phase: 'run', affectedNodeIds: [nodeId],
                    ...(result.taskId ? { taskId: result.taskId } : {}), error: { ...result.error,
                      retry: 'never_auto' }, tracking: '提交回执未知' }
              }),
            })
            const jobResult = (status: 'completed' | 'failed' | 'monitoring_unknown') => {
              const children = batchNodeIds.map(nodeId => states.get(nodeId) ?? {
                status: 'submission_unknown' as const, canvasId: id, requestId: runRequestIds[nodeId], nodeId,
                phase: 'run' as const, version: null, affectedNodeIds: [nodeId], generation: approvedGenerations[nodeId],
                error: { code: 'SUBMISSION_UNKNOWN', message: '节点尚未取得可信终态', retry: 'never_auto' },
              })
              const actualOutputCount = children.reduce((count, child) => count + ('outputs' in child ? child.outputs.length : 0), 0)
              const requestedOutputCount = generationOutputCount(generation)
              return { status, canvasId: id, nodeIds: batchNodeIds, results: children, actualOutputCount, requestedOutputCount,
                partial: actualOutputCount > 0 && (status !== 'completed' || actualOutputCount < requestedOutputCount) }
            }
            const settleStates = () => {
              if (finished) return
              const terminal = batchNodeIds.map(nodeId => states.get(nodeId))
              // Preserve single-node recovery: its Job can close while product capture waits for late evidence.
              if (terminal.some(state => !state || !isRunTrackingClosed(state) && !(single &&
 state.phase === 'monitoring_unknown'))) return
              const all = terminal as CanvasRunState[]
              const hasUnknown = all.some(state => state.phase === 'monitoring_unknown')
              const completed = all.every(state => state.phase === 'completed' && state.outputs.length > 0)
              const snapshot = jobResult(hasUnknown ? 'monitoring_unknown' : completed ? 'completed' : 'failed')
              const { actualOutputCount, requestedOutputCount, partial } = snapshot
              finish({ status: completed ? 'completed' : 'failed',
                detail: completed ? partial ? `任务结束，实际生成${actualOutputCount}/${requestedOutputCount}个产物，未全部完成` : '生成完成，真实产物已保存到画布'
                  : `${hasUnknown ? '部分节点跟踪已关闭，后台结果未确认' : all.find(state => state.error)?.error?.message ?? '任务有节点失败或结果未确认'}${partial ? `，已返回${actualOutputCount}/${requestedOutputCount}个产物` : ''}`,
                result: JSON.stringify(snapshot) })
            }
            // Jobs owns admission; subscriptions must exist before either native submission path.
            const dispatch = Promise.resolve().then(async () => {
              if (stopped || disposed || exec.signal.aborted) {
                rollback(); resolveReceipt(reject(request, new CanvasAgentError('CANCELLED_BEFORE_DISPATCH',
                  '生成已取消，尚未提交'), id)); cancel(); return
              }
              if (binding && results) for (const nodeId of batchNodeIds) productStops.push(observeProducts(binding,
                target, runRequestIds[nodeId], nodeId))
              timer = setTimeout(() =>{  finish({ status: 'failed', detail: '跟踪超时，后台生成结果未确认；不代表后台失败',
                result: JSON.stringify(jobResult('monitoring_unknown')) }) },
              generation.videos > 0 ? videoTimeoutMs : (generation.audios ?? 0) > 0 ? audioTimeoutMs : imageTimeoutMs)
              timer.unref()
              for (const nodeId of batchNodeIds) subscriptions.push(bridge.subscribeRun(target, runRequestIds[nodeId], (state) => {
                if (finished || state.canvasId !== id || state.nodeId !== nodeId || state.requestId !== runRequestIds[nodeId]) return
                states.set(nodeId, state); last = state
                if (state.phase === 'submitted' || state.phase === 'running' ||
 state.phase === 'submission_unknown') job.updateProgress(state.phase === 'submitted' ? '已提交，等待生成' : state.phase === 'running' ? '正在生成' : '提交结果未确认，继续核对现有任务')
                settleStates()
              }))
              if (finished) {
                subscriptions.forEach((stop) =>{  stop() }); rollback = () => undefined
                const cached = batchNodeIds.map(nodeId => states.get(nodeId))
                  .filter((state): state is CanvasRunState => state !== undefined)
                const replay = cached.length === batchNodeIds.length && last?.version && last.workflowTaskId &&
 cached.every(state => ['completed', 'failed'].includes(state.phase) &&
 state.workflowTaskId && state.version)
                  ? { status: 'submitted' as const, canvasId: id, version: last.version,
                    taskId: last.workflowTaskId, nodeIds: batchNodeIds, results: cached.map(state => ({ nodeId: state.nodeId,
                      generation: state.generation })) }
                  : unknown()
                resolveReceipt(publicReceipt(replay)); return
              }
              if (latestUser.get(owner.session) !== sequence) {
                stopProducts(); rollback()
                const changed = reject(request, new CanvasAgentError('COUNT_CHANGED', '用户请求已变化，尚未提交'), id)
                resolveReceipt({ ...changed, jobId: String(job.id) }); finish({ status: 'failed',
                  detail: changed.error.message, result: JSON.stringify(changed) }); return
              }
              sent = true
              let result: CanvasOperationResult | ToolRejection
              try {
                result = await bridge.dispatch(target, request + ':run', single
                  ? { action: 'node.run', nodeId: batchNodeIds[0], expectedVersion: versions[0],
                    approvedGeneration: approvedGenerations[batchNodeIds[0]] }
                  : { action: 'workflow.run', expectedVersion: String(args.expectedVersion), nodeIds: batchNodeIds,
                    approvedGenerations, runRequestIds }, controller.signal)
              } catch (cause) { result = cause instanceof CanvasAgentError &&
 cause.code !== 'SUBMISSION_UNKNOWN' ? reject(request, cause, id) : unknown() }
              if (result.status === 'rejected') {
                stopProducts(); rollback()
                resolveReceipt({ ...result, requestId: request, address, jobId: String(job.id) }); finish({
                  status: 'failed', detail: result.error.message, result: JSON.stringify(result) }); return
              }
              if (result.status !== 'submitted' && result.status !== 'submission_unknown') result = unknown()
              rollback = () => undefined
              resolveReceipt(publicReceipt(result))
            }).catch(() => {
              const result = sent ? unknown() : reject(request, new CanvasAgentError('CONTEXT_NOT_READY', '任务跟踪未准备好，尚未提交生成'), id)
              if (!sent) { stopProducts(); rollback() }
              const output = result.status === 'rejected' ? { ...result, jobId: String(job.id) } : publicReceipt(result)
              resolveReceipt(output); finish({ status: 'failed', detail: result.error.message,
                result: JSON.stringify(result.status === 'rejected' ? output : jobResult('monitoring_unknown')) })
            })
            void activities?.track(dispatch)
            return { done, cancel }
          },
        }))
        usage.generation = total
      } catch (cause) {
        for (const nodeId of batchNodeIds) busy.delete(JSON.stringify([id, nodeId]))
        throw cause
      }
      const result = await receipt
      try {
        if (jobId && result.status !== 'rejected') exec.deferContext(createUserMessage({ source: { kind: 'canvas-run' },
          content: [{ type: 'text', text: JSON.stringify({ tool: 'canvas_run', jobId, canvasId: id, nodeIds,
            status: result.status, nextIndex: result.nextIndex }) }] }))
      } catch { /* Context presentation cannot reclassify an actual submission. */ }
      return result
    })
  }
  registerCanvasTool(ctx, activities, defineTool({ ...canvasToolContracts.canvas_run, output: canvasToolOutput,
    async execute(input, exec) {
      const request = requestId('canvas_run', exec)
      let id: CanvasId | undefined
      try {
        const args = argumentsObject(input, ['canvasId', 'nodeIds', 'expectedVersion']); id = idOf(args)
        const fingerprint = bridgeFingerprint(args), old = calls.get(request)
        if (old) { if (old.fingerprint !== fingerprint) throw new CanvasAgentError('DUPLICATE_REQUEST_MISMATCH',
          '相同生成调用的目标或参数不同'); return JSON.stringify(await old.promise) }
        if (calls.size >= MAX_BRIDGE_RECORDS) throw new CanvasAgentError('BRIDGE_OVERLOADED', '生成调用回执缓存已达上限')
        const promise = runBatch(args, exec, request).catch((cause: unknown) => reject(request, cause, id)); calls.set(request, {
          fingerprint, promise })
        return JSON.stringify(await promise)
      } catch (cause) { return JSON.stringify(reject(request, cause, id)) }
    } }))
}
