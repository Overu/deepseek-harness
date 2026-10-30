import { registerCanvasTool, type CanvasActivities } from './activities.ts'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { assertCanvasMessageSize, CanvasAgentError, type CanvasBatchWriteOutput, type CanvasCreateOutput,
  type CanvasOperationResult, type Failure, type SaveReceipt, type ToolRejection } from '../shared/canvas-agent-protocol.ts'
import { assertBridgeId, bridgeFingerprint, MAX_BRIDGE_INFLIGHT, MAX_BRIDGE_RECORDS, parseBridgeOperation,
  type BridgeOperation } from '../shared/canvas-bridge-protocol.ts'
import { canvasToolContracts, canvasToolOutputSchema } from '../shared/canvas-tool-contracts.ts'
import { canvasAddress, parseCanvasId, type CanvasId } from '../shared/protocol.ts'
import { CanvasApiError, CanvasHttpError, canvasName, createEmptyCanvas } from './canvas-api.ts'
import type { CanvasHostBridge } from './canvas-bridge.ts'
import { fetchCanvas } from './canvas-get.ts'
import { LoginRequiredError } from './account-errors.ts'

interface ToolDependencies { createCanvas: (name: string, signal?: AbortSignal) => ReturnType<typeof createEmptyCanvas>
  getCanvas: (id: CanvasId, signal?: AbortSignal) => ReturnType<typeof fetchCanvas> }
export const canvasToolOutput = { schema: canvasToolOutputSchema, render: (_args: unknown, value: string) => [{
  type: 'text' as const, text: value }] }
const output = canvasToolOutput
export function argumentsObject(input: unknown, allowed: string[]): Record<string, unknown> {
  assertCanvasMessageSize(input)
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
 Object.keys(input).some(key => !allowed.includes(key))) throw new CanvasAgentError('INVALID_ARGUMENT', '工具参数含不支持的字段')
  return input as Record<string, unknown>
}
export function idOf(input: Record<string, unknown>): CanvasId {
  const id = typeof input.canvasId === 'string' && input.canvasId.length <= 19 ? parseCanvasId(input.canvasId) : undefined
  if (!id) throw new CanvasAgentError('INVALID_ARGUMENT', '画布ID必须为正Long十进制字符串')
  return id
}
/** Require the Agent whose session owns a canvas operation. */
export function canvasAgent(exec: ToolRunContext): NonNullable<ToolRunContext['agent']> {
  if (!exec.agent) throw new CanvasAgentError('AGENT_CONTEXT_REQUIRED', '请从当前Harness Agent对话调用此工具')
  return exec.agent
}
export function sessionOf(exec: ToolRunContext): string {
  if (!exec.agent) throw new CanvasAgentError('AGENT_CONTEXT_REQUIRED', '请从当前Harness Agent对话调用此工具')
  const session = String(exec.agent.id); assertBridgeId(session); return session
}
export function requestId(name: string, exec: ToolRunContext): string {
  return 'canvas-' + createHash('sha256').update(JSON.stringify([exec.agent ? String(exec.agent.id) : null,
    exec.callId, name])).digest('hex')
}
export function failure(cause: unknown): Failure {
  if (cause instanceof CanvasAgentError || cause instanceof CanvasApiError) {
    const code = cause.code
    const retry = ['SUBMISSION_UNKNOWN',
      'ASSET_UPLOAD_UNKNOWN'].includes(code) ? 'never_auto' : code === 'INVALID_ARGUMENT' ? 'after_input'
        : code === 'CONFIGURATION_ERROR' ? 'developer_fix' : ['CLIENT_UNAVAILABLE', 'CONTEXT_NOT_READY',
          'AUTH_REQUIRED', 'EDITOR_BUSY'].includes(code) ? 'after_ready' : 'read_first'
    return { code, message: cause.message.slice(0, 2048), retry }
  }
  if (cause instanceof LoginRequiredError || (cause instanceof CanvasHttpError && [401,
    403].includes(cause.status))) return { code: 'AUTH_REQUIRED', message: '请检查桌面登录与画布权限', retry: 'after_ready' }
  return { code: 'CONTEXT_NOT_READY', message: '画布服务暂不可用，请核对当前连接及画布状态', retry: 'read_first' }
}
export function reject(requestId: string, cause: unknown, canvasId?: CanvasId): ToolRejection {
  return { status: 'rejected', requestId, effect: 'none', error: failure(cause), ...(canvasId ? { canvasId,
    address: canvasAddress(canvasId) } : {}) }
}

/** Native service owns mutation, optimistic versions and same-call bridge deduplication. */
export async function dispatchCanvasWrite(bridge: CanvasHostBridge, id: CanvasId, operation: BridgeOperation,
  exec: ToolRunContext, request: string): Promise<(CanvasOperationResult & { requestId: string
  address: string })> {
  const target = await bridge.ensureContext(sessionOf(exec), id, 'edit', request + ':prepare', exec.signal)
  try {
    const result = await bridge.dispatch(target, request + ':write', operation, exec.signal)
    const receipt = result.status === 'submission_unknown' ? { ...result, error: { ...result.error,
      retry: 'never_auto' as const } } : result
    return { ...receipt, requestId: request, address: canvasAddress(id) }
  } catch (cause) {
    if (cause instanceof CanvasAgentError && cause.code !== 'SUBMISSION_UNKNOWN') throw cause
    return { status: 'submission_unknown', canvasId: id, version: null, phase: 'save', affectedNodeIds: [],
      requestId: request, address: canvasAddress(id),
      error: { code: 'SUBMISSION_UNKNOWN', message: '画布保存结果未确认，请先权威读取核对，不要自动重复写入', retry: 'never_auto' } }
  }
}

/** Ordered tool-level batch: each native save remains independent and advances the confirmed version. */
export async function dispatchCanvasBatchWrite(bridge: CanvasHostBridge, id: CanvasId, operations: BridgeOperation[],
  initialVersion: string, exec: ToolRunContext, request: string): Promise<CanvasBatchWriteOutput | ToolRejection> {
  let version: string | null = initialVersion
  const completed: Array<{ index: number
    receipt: SaveReceipt }> = []
  for (let index = 0; index < operations.length; index++) {
    let result: CanvasOperationResult & { requestId: string
      address: string }
    try {
      result = await dispatchCanvasWrite(bridge, id, parseBridgeOperation({ ...operations[index],
        expectedVersion: version }), exec, `${request}:${index}`)
    } catch (cause) {
      result = { ...reject(`${request}:${index}`, cause, id), canvasId: id, version, address: canvasAddress(id) }
    }
    if (result.status === 'saved') {
      completed.push({ index, receipt: result }); version = result.version
      continue
    }
    if (index === 0 && result.status === 'rejected') return { status: 'rejected', requestId: request, effect: 'none',
      error: result.error, canvasId: id, address: canvasAddress(id), version: result.version }
    const failure = result.status === 'submission_unknown' ||
 result.status === 'rejected' ? result : reject(`${request}:${index}`, new CanvasAgentError('SAVE_REJECTED', '保存未返回可信回执'), id)
    return { status: result.status === 'submission_unknown' ? 'submission_unknown' : 'partial', requestId: request, canvasId: id,
      address: canvasAddress(id), version, completed, nextIndex: index, failure: failure as CanvasBatchWriteOutput['failure'] }
  }
  return { status: 'saved', requestId: request, canvasId: id, address: canvasAddress(id), version, completed,
    nextIndex: operations.length }
}

/** Three model-facing tools; all native writes still run in the existing Client service. */
export function registerCanvasTools(ctx: Context, bridge: CanvasHostBridge, { createCanvas,
  getCanvas }: ToolDependencies, activities?: CanvasActivities): void {
  const creations = new Map<string, { name: string
    pending: boolean
    promise: Promise<CanvasCreateOutput> }>()
  const batches = new Map<string, { fingerprint: string
    promise: Promise<CanvasBatchWriteOutput | ToolRejection> }>()
  let disposed = false
  ctx.effect(() => () => { disposed = true; creations.clear(); batches.clear() }, 'desktop-canvas: create and edit receipts')

  async function create(name: string, exec: ToolRunContext, request: string): Promise<CanvasCreateOutput> {
    const session = sessionOf(exec)
    const old = creations.get(request)
    if (old) { if (old.name !== name) throw new CanvasAgentError('DUPLICATE_REQUEST_MISMATCH', '相同创建调用的名称不同'); return old.promise }
    if (exec.signal.aborted) throw new CanvasAgentError('CANCELLED_BEFORE_DISPATCH', '创建已取消，尚未发送')
    if (disposed) throw new CanvasAgentError('CLIENT_UNAVAILABLE', '画布工具已卸载')
    if (creations.size >= MAX_BRIDGE_RECORDS ||
 [...creations.values()].filter(record => record.pending).length >= MAX_BRIDGE_INFLIGHT) throw new CanvasAgentError('BRIDGE_OVERLOADED', '画布创建请求或回执缓存已达上限')
    const promise = (async (): Promise<CanvasCreateOutput> => {
      let created
      try { created = await createCanvas(name, exec.signal) }
      catch (cause) {
        if (cause instanceof CanvasApiError && cause.requestPhase !== 'submission_unknown') return reject(request, cause)
        return { status: 'create_unknown', requestId: request, error: { code: 'SUBMISSION_UNKNOWN',
          message: '画布创建结果未确认；请核对画布列表，不要重新创建', retry: 'never_auto' } }
      }
      const base = { status: 'created' as const, requestId: request, ...created, address: canvasAddress(created.canvasId) }
      try {
        const target = await bridge.ensureContext(session, created.canvasId, 'read', request + ':prepare', exec.signal)
        return { ...base, version: target.readiness.version, runtime: 'ready' }
      } catch (cause) { return { ...base, runtime: 'not_ready', runtimeError: failure(cause) } }
    })()
    const record = { name, pending: true, promise }; creations.set(request, record)
    void promise.finally(() => { record.pending = false }).catch(() => undefined)
    return promise
  }

  registerCanvasTool(ctx, activities, defineTool({
    ...canvasToolContracts.canvas_create,
    output,
    async execute(input, exec) {
      const request = requestId('canvas_create', exec)
      try { const args = argumentsObject(input, ['name']); return JSON.stringify(await create(canvasName(args.name), exec, request)) }
      catch (cause) { return JSON.stringify(reject(request, cause)) }
    },
  }))
  registerCanvasTool(ctx, activities, defineTool({
    ...canvasToolContracts.canvas_get,
    output,
    async execute(input, exec) {
      const request = requestId('canvas_get', exec); let id: CanvasId | undefined
      try {
        const args = argumentsObject(input, ['canvasId', 'view', 'nodeIds', 'refresh', 'nodeOffset', 'edgeOffset',
          'limit', 'expectedVersion']); id = idOf(args)
        const view = args.view ?? 'summary'
        if (view === 'summary') {
          argumentsObject(args, ['canvasId', 'view'])
          const snapshot = await getCanvas(id, exec.signal)
          return JSON.stringify({ ...snapshot, nodes: snapshot.nodes.slice(0, 20), address: canvasAddress(id) })
        }
        if (view !== 'nodes' && view !== 'graph' || ('refresh' in args &&
 typeof args.refresh !== 'boolean')) throw new CanvasAgentError('INVALID_ARGUMENT', '详情读取参数无效')
        argumentsObject(args, view === 'nodes' ? ['canvasId', 'view', 'nodeIds', 'refresh'] : ['canvasId', 'view',
          'refresh', 'nodeOffset', 'edgeOffset', 'limit', 'expectedVersion'])
        const operation = parseBridgeOperation(view === 'nodes'
          ? { action: 'canvas.read', ...('nodeIds' in args ? { nodeIds: args.nodeIds } : {}) }
          : { action: 'canvas.graph.read', ...Object.fromEntries(['nodeOffset', 'edgeOffset', 'limit',
            'expectedVersion'].filter(key => key in args).map(key => [key, args[key]])) })
        const target = await bridge.ensureContext(sessionOf(exec), id, 'read', request + ':prepare', exec.signal, args.refresh === true)
        const result = await bridge.dispatch(target, request + ':read', operation, exec.signal)
        return JSON.stringify({ ...result, requestId: request, address: canvasAddress(id), ...(['read',
          'graph'].includes(result.status) ? { source: 'plugin-service' } : {}) })
      } catch (cause) { return JSON.stringify(reject(request, cause, id)) }
    },
  }))
  registerCanvasTool(ctx, activities, defineTool({
    ...canvasToolContracts.canvas_node_edit,
    output,
    async execute(input, exec) {
      const request = requestId('canvas_node_edit', exec); let id: CanvasId | undefined
      try {
        const args = argumentsObject(input, ['canvasId', 'expectedVersion', 'ops']); id = idOf(args)
        if (!Array.isArray(args.ops) || args.ops.length === 0) throw new CanvasAgentError('INVALID_ARGUMENT', 'ops必须为非空数组')
        const operations = args.ops.map((raw) => {
          const op = argumentsObject(raw, ['op', 'node', 'nodeId', 'changes', 'configuration'])
          const fields = op.op === 'add' ? ['node'] : op.op === 'edit' ? ['nodeId',
            'changes'] : op.op === 'remove' ? ['nodeId'] : op.op === 'configure' ? ['nodeId', 'configuration'] : null
          if (!fields) throw new CanvasAgentError('INVALID_ARGUMENT', '节点操作仅支持add/edit/remove/configure')
          argumentsObject(op, ['op', ...fields])
          if (op.node && typeof op.node === 'object' && Object.hasOwn(op.node,
            'position')) throw new CanvasAgentError('INVALID_ARGUMENT', '请使用node.placement指定放置规则')
          const payload = op.op === 'remove' ? { nodeIds: [op.nodeId] } : Object.fromEntries(fields.map(key => [key, op[key]]))
          return parseBridgeOperation({
            action: op.op === 'edit' ? 'node.update' : op.op === 'remove' ? 'node.delete' : `node.${String(op.op)}`,
            expectedVersion: args.expectedVersion, ...payload })
        })
        const fingerprint = bridgeFingerprint(args), old = batches.get(request)
        if (old) {
          if (old.fingerprint !== fingerprint) throw new CanvasAgentError('DUPLICATE_REQUEST_MISMATCH', '相同节点编辑调用的参数不同')
          return JSON.stringify(await old.promise)
        }
        if (batches.size >= MAX_BRIDGE_RECORDS) throw new CanvasAgentError('BRIDGE_OVERLOADED', '节点编辑回执缓存已达上限')
        const promise = dispatchCanvasBatchWrite(bridge, id, operations, String(args.expectedVersion), exec, request)
        batches.set(request, { fingerprint, promise })
        return JSON.stringify(await promise)
      } catch (cause) { return JSON.stringify(reject(request, cause, id)) }
    },
  }))
}
