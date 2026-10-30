import { registerCanvasTool, type CanvasActivities } from './activities.ts'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { CanvasAgentError, parseCanvasOperation } from '../shared/canvas-agent-protocol.ts'
import { parseProcessInput } from '../shared/canvas-process-protocol.ts'
import type { CanvasRunState } from '../shared/canvas-run-protocol.ts'
import { canvasToolContracts } from '../shared/canvas-tool-contracts.ts'
import { bridgeFingerprint, isRunTrackingClosed, MAX_BRIDGE_INFLIGHT, MAX_BRIDGE_RECORDS } from '../shared/canvas-bridge-protocol.ts'
import { canvasAddress, type CanvasId } from '../shared/protocol.ts'
import type { CanvasHostBridge } from './canvas-bridge.ts'
import type { CanvasResultStore } from './canvas-result-store.ts'
import { createCanvasIntentBudget, type CanvasIntentBudget, confirmCanvasVolume } from './canvas-intent-budget.ts'
import { addGenerationCounts } from '../shared/canvas-generation-counts.ts'
import { canvasAgent, argumentsObject, canvasToolOutput, idOf, reject, requestId, sessionOf } from './canvas-tools.ts'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
         * Informational origin of Canvas processing completion messages.
         * @persistenceAttribution
         */
    'canvas-process': { kind: 'canvas-process' }
  }
}

export function registerCanvasProcessTools(ctx: Context, bridge: CanvasHostBridge, results?: CanvasResultStore,
  activities?: CanvasActivities, budget: CanvasIntentBudget = createCanvasIntentBudget()): void {
  const calls = new Map<string, {
      fingerprint: string
      promise: Promise<unknown>
    }>(), stops = new Set<() => void>()
  const cancels = new Set<() => void>()
  let disposed = false
  ctx.on('session/event', (session, event) =>{  budget.observe(session, event) }, { global: true })
  ctx.effect(() => () => {
    disposed = true
    for (const cancel of [...cancels])
      cancel()
    for (const stop of [...stops])
      stop()
    calls.clear()
  }, 'desktop-canvas: process jobs')
  async function execute(input: unknown, exec: ToolRunContext, request: string) {
    const args = argumentsObject(input, ['canvasId', 'expectedVersion', 'kind', 'sourceNodeId', 'outputIndex',
        'params']), id = idOf(args), sessionId = sessionOf(exec)
    const process = parseProcessInput(Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'canvasId' &&
 key !== 'expectedVersion')))
    const operation = parseCanvasOperation({ ...process, action: 'process.preflight', expectedVersion: args.expectedVersion })
    const owner = canvasAgent(exec), sequence = budget.latestUser.get(owner.session)
    if (sequence === undefined) {
      throw new CanvasAgentError('AGENT_CONTEXT_REQUIRED', '无法确认处理所属的用户请求')
    }
    const previous = budget.owners.get(owner.session) ?? Promise.resolve()
    let unlock!: () => void
    const slot = new Promise<void>((resolve) => { unlock = resolve })
    budget.owners.set(owner.session, previous.then(() => slot))
    await previous
    try {
      const ready = () => {
        if (disposed || exec.signal.aborted) {
          throw new CanvasAgentError('CANCELLED_BEFORE_DISPATCH', '处理已停止，尚未提交')
        }
        if (budget.latestUser.get(owner.session) !== sequence) {
          throw new CanvasAgentError('COUNT_CHANGED', '用户请求已变化，尚未提交')
        }
      }
      ready()
      const busyKey = JSON.stringify([id, process.sourceNodeId])
      if (budget.busy.has(busyKey)) {
        throw new CanvasAgentError('NODE_BUSY', '该节点已有执行或处理任务')
      }
      if (budget.busy.size >= MAX_BRIDGE_INFLIGHT) {
        throw new CanvasAgentError('BRIDGE_OVERLOADED', '请等待已有任务释放执行容量')
      }
      const jobs = ctx.get('jobs')
      if (!jobs) {
        throw new CanvasAgentError('CONTEXT_NOT_READY', '当前没有可用后台任务服务')
      }
      const target = await bridge.ensureContext(sessionId, id, 'run', request + ':prepare', exec.signal)
      const plan = await bridge.dispatch(target, request + ':preflight', operation, exec.signal)
      if (plan.status === 'rejected') {
        return { ...plan, requestId: request, address: canvasAddress(id) }
      }
      if (plan.status !== 'process_ready') {
        throw new CanvasAgentError('CONTEXT_NOT_READY', '尚未取得可信处理预检')
      }
      ready()
      let usage = budget.usages.get(owner.session)
      if (!usage || usage.sequence !== sequence) {
        usage = { sequence, generation: { images: 0, videos: 0 } }
        budget.usages.set(owner.session, usage)
      }
      const old = usage.generation, total = addGenerationCounts(old, plan.generation)
      if (!Number.isSafeInteger(total.images) || !Number.isSafeInteger(total.videos)) {
        throw new CanvasAgentError('INVALID_ARGUMENT', '处理数量不合法')
      }
      await confirmCanvasVolume(ctx, exec, plan.generation, total)
      ready()
      if (budget.busy.has(busyKey) || budget.busy.size >= MAX_BRIDGE_INFLIGHT) {
        throw new CanvasAgentError('NODE_BUSY', '执行容量或节点状态已变化')
      }
      const root = budget.roots.get(owner.session)?.get(String(exec.rootCallId))
      const binding = root ? { sessionId: String(owner.session.id), ownerId: String(owner.id),
        rootCallId: String(exec.rootCallId), callId: String(exec.callId), turn: root.turn, rootCallSeq: root.seq,
        sessionCreatedAt: owner.session.header.createdAt } : undefined
      const runRequest = request + ':run'
      let resolve!: (value: unknown) => void
      const receipt = new Promise<unknown>((yes) => { resolve = yes })
      budget.busy.set(busyKey, request)
      let jobId: string
      try {
        jobId = String(jobs.start({ kind: 'canvas', owner: owner.id, label: `画布${id}：${process.kind}`,
          outputLimitBytes: 2 * 1024 * 1024, run(job) {
            let sent = false, finished = false, latest: CanvasRunState | undefined, dispatchSettled = false
            let settle!: (value: JobOutcome) => void
            const done = new Promise<JobOutcome>((yes) => { settle = yes }), controller = new AbortController()
            void activities?.track(done)
            const timer = setTimeout(() =>{  finish({ status: 'failed', detail: '处理跟踪超时，后台状态未确认',
              result: JSON.stringify({ status: 'monitoring_unknown', canvasId: id, operationId: runRequest }) }) },
            process.kind === 'video_upscale' ? 60 * 60000 : 30 * 60000)
            const finish = (outcome: JobOutcome) => {
              if (finished) {
                return
              }
              finished = true
              clearTimeout(timer)
              cancels.delete(cancel)
              if (latest?.phase === 'completed' || latest?.phase === 'failed' || !sent) {
                budget.busy.delete(busyKey)
              }
              settle(outcome)
            }
            const cancel = () => { controller.abort(); resolve({ status: sent ? 'submission_unknown' : 'rejected',
              canvasId: id, requestId: request, jobId: String(job.id), error: {
                code: sent ? 'SUBMISSION_UNKNOWN' : 'CANCELLED_BEFORE_DISPATCH', message: sent ? '已停止跟踪，后台处理可能继续' : '已停止，尚未提交',
                retry: sent ? 'never_auto' : 'after_ready' } }); finish({ status: 'killed', detail: sent ? '停止跟踪不等于取消处理' : '尚未提交' }) }
            cancels.add(cancel)
            let stop = () => { }
            let observerClosed = false
            const stopObserver = () => {
              if (observerClosed) {
                return
              }
              observerClosed = true
              stop()
              stops.delete(stopObserver)
            }
            stops.add(stopObserver)
            stop = bridge.subscribeRun(target, runRequest, (state) => {
              if (state.nodeId !== plan.nodeId || state.requestId !== runRequest || state.operationId !== runRequest) {
                return
              }
              if (state.products?.some(p => !plan.outputNodeIds.includes(p.nodeId) || !state.outputs.includes(p.url))) {
                return
              }
              latest = state
              if (results && binding && state.products?.length && ['completed', 'failed'].includes(state.phase)) {
                state.products.forEach((product, index) => { const write = results.record(binding, (({ products: _products, ...rest }) => ({
                  ...rest, requestId: runRequest + ':output:' + String(index), nodeId: product.nodeId,
                  outputs: [product.url] }))(state)).catch(() =>{
                  ctx.logger.warn('desktop-canvas: process source persistence unavailable') })
                void activities?.track(write)
                })
              }
              if (state.phase === 'completed' || state.phase === 'failed') {
                budget.busy.delete(busyKey)
                if (dispatchSettled) {
                  finish({ status: state.phase === 'completed' ? 'completed' : 'failed',
                    ...(state.phase === 'failed' ? { detail: state.error?.message ?? '部分处理未完成' } : {}), result: JSON.stringify(state) })
                }
              }
              if (state.phase === 'monitoring_unknown' && dispatchSettled) {
                finish({ status: 'failed', detail: state.error?.message ?? '监控未确认', result: JSON.stringify(state) })
              }
              if (isRunTrackingClosed(state)) {
                stopObserver()
              }
            })
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Callbacks may settle the job before this check.
            if (observerClosed) {
              stop()
            }
            const dispatch = (async () => {
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Callbacks may settle the job before this check.
              if (finished || disposed || exec.signal.aborted) {
                stopObserver()
                usage.generation = old
                resolve(reject(request, new CanvasAgentError('CANCELLED_BEFORE_DISPATCH', '处理已停止，尚未提交'), id))
                finish({ status: 'killed', detail: '尚未提交' })
                return
              }
              sent = true
              const result = await bridge.dispatch(target, runRequest, parseCanvasOperation({ action: 'process.run',
                expectedVersion: plan.version, planId: plan.planId, nodeId: plan.nodeId,
                approvedGeneration: plan.generation }), controller.signal)
              dispatchSettled = true
              resolve({ ...result, requestId: request, address: canvasAddress(id), jobId: String(job.id) })
              if (result.status === 'rejected') {
                usage.generation = old
                stopObserver()
                finish({ status: 'failed', detail: result.error.message, result: JSON.stringify(result) })
                budget.busy.delete(busyKey)
                return
              }
              if (result.status === 'process_partial') {
                if (result.error.code !== 'SUBMISSION_UNKNOWN') {
                  budget.busy.delete(busyKey)
                  stopObserver()
                }
                finish({ status: 'failed', detail: result.error.message, result: JSON.stringify(result) })
                return
              }
              if (latest && (latest.phase === 'completed' || latest.phase === 'failed' || latest.phase === 'monitoring_unknown')) {
                finish({ status: latest.phase === 'completed' ? 'completed' : 'failed',
                  ...(latest.phase !== 'completed' ? { detail: latest.error?.message ?? '处理结果未完全确认' } : {}),
                  result: JSON.stringify(latest) })
              }
            })().catch(() => { dispatchSettled = true; const value = { status: 'submission_unknown', canvasId: id,
              requestId: request, jobId: String(job.id), error: { code: 'SUBMISSION_UNKNOWN', message: '处理回执未确认，请核对原任务，勿重复提交',
                retry: 'never_auto' } }; resolve(value); finish({ status: 'failed', detail: value.error.message,
              result: JSON.stringify(value) }) })
            void activities?.track(dispatch)
            return { done, cancel }
          } }))
        usage.generation = total
      }
      catch (error) {
        budget.busy.delete(busyKey)
        throw error
      }
      const result = await receipt
      try {
        if (result !== null && typeof result === 'object' && 'status' in result &&
 result.status !== 'rejected') exec.deferContext(createUserMessage({ source: { kind: 'canvas-process' }, content: [{
          type: 'text', text: JSON.stringify({ tool: 'canvas_process', jobId, canvasId: id, kind: process.kind,
            nodeId: plan.nodeId, status: result.status }) }] }))
      } catch { /* Context presentation cannot reclassify an actual submission. */ }
      return result
    }
    finally {
      unlock()
    }
  }
  registerCanvasTool(ctx, activities, defineTool({ ...canvasToolContracts.canvas_process, output: canvasToolOutput,
    async execute(input, exec) {
      const request = requestId('canvas_process', exec)
      let id: CanvasId | undefined
      try {
        const args = argumentsObject(input, ['canvasId', 'expectedVersion', 'kind', 'sourceNodeId', 'outputIndex', 'params'])
        id = idOf(args)
        const fingerprint = bridgeFingerprint(args), old = calls.get(request)
        if (old) {
          if (old.fingerprint !== fingerprint) {
            throw new CanvasAgentError('DUPLICATE_REQUEST_MISMATCH', '同一处理请求的参数不同')
          }
          return JSON.stringify(await old.promise)
        }
        if (calls.size >= MAX_BRIDGE_RECORDS) {
          throw new CanvasAgentError('BRIDGE_OVERLOADED', '处理回执缓存已达上限')
        }
        const promise = execute(args, exec, request).catch((error: unknown) => reject(request, error, id))
        calls.set(request, { fingerprint, promise })
        return JSON.stringify(await promise)
      }
      catch (error) {
        return JSON.stringify(reject(request, error, id))
      }
    } }))
}
