import { registerCanvasTool, type CanvasActivities } from './activities.ts'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import { CanvasAgentError, parseCanvasOperation } from '../shared/canvas-agent-protocol.ts'
import { canvasToolContracts } from '../shared/canvas-tool-contracts.ts'
import { canvasAddress, parseCanvasId } from '../shared/protocol.ts'
import { argumentsObject, canvasToolOutput, idOf, reject, requestId, sessionOf, dispatchCanvasWrite } from './canvas-tools.ts'
import type { CanvasHostBridge } from './canvas-bridge.ts'
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}
export function parseCanvasList(body: unknown, page: number, limit: number) {
  const envelope = record(body)
  if (envelope?.code !== 'SUCCESS') throw new CanvasAgentError('READ_REJECTED', '画布列表读取未成功')
  const data = record(envelope.data)
  const rows: unknown = Array.isArray(envelope.data) ? envelope.data : data?.records ?? data?.list
  if (!Array.isArray(rows) || rows.length > limit) throw new CanvasAgentError('READ_REJECTED', '画布列表响应格式不正确')
  const canvases = rows.map((value: unknown) => {
    const row = record(value)
    const id = typeof row?.id === 'number' && Number.isSafeInteger(row.id)
      ? parseCanvasId(String(row.id)) : typeof row?.id === 'string' ? parseCanvasId(row.id) : undefined
    if (!id || typeof row?.name !== 'string') throw new CanvasAgentError('READ_REJECTED', '列表中的画布身份不合法')
    return { canvasId: id, name: row.name.slice(0, 100), address: canvasAddress(id) }
  })
  const total = typeof data?.total === 'number' && Number.isSafeInteger(data.total) && data.total >= 0 ? data.total : null
  return { status: 'listed', canvases, page, limit, total,
    nextPage: total === null ? rows.length === limit ? page + 1 : null : page * limit < total ? page + 1 : null }
}
export function registerCanvasManagementTools(ctx: Context, bridge: CanvasHostBridge, list: (operation: 'list',
  body: unknown, signal?: AbortSignal) => Promise<unknown>, activities?: CanvasActivities): void {
  registerCanvasTool(ctx, activities, defineTool({ ...canvasToolContracts.canvas_list, output: canvasToolOutput,
    async execute(input, exec) {
      const request = requestId('canvas_list', exec)
      try {
        sessionOf(exec)
        const args = argumentsObject(input, ['name', 'page', 'limit']), page = args.page ?? 1, limit = args.limit ?? 20
        if (!Number.isSafeInteger(page) || Number(page) < 1 || Number(page) > 10000 || !Number.isSafeInteger(limit) ||
 Number(limit) < 1 || Number(limit) > 20 || ('name' in args && (typeof args.name !== 'string' || args.name.length > 100))) {
          throw new CanvasAgentError('INVALID_ARGUMENT', '画布列表筛选或分页不合法')
        }
        const result = await list('list', { page, size: limit, name: args.name ?? '', version: 'comfyui',
          canvasType: null, folderId: null, sort_type: 'time_desc' }, exec.signal)
        return JSON.stringify({ ...parseCanvasList(result, Number(page), Number(limit)), requestId: request })
      }
      catch (error) {
        return JSON.stringify(reject(request, error))
      }
    } }))
  for (const name of ['canvas_open', 'canvas_capabilities', 'canvas_layout'] as const)
    registerCanvasTool(ctx, activities, defineTool<ParameterSchemaSpec, typeof canvasToolOutput.schema>({
      ...canvasToolContracts[name], output: canvasToolOutput, async execute(input, exec) {
        const request = requestId(name, exec)
        let id
        try {
          const args = argumentsObject(input, name === 'canvas_open' ? ['canvasId',
            'nodeId'] : name === 'canvas_layout' ? ['canvasId', 'expectedVersion', 'nodeIds', 'mode'] : ['canvasId', 'kind', 'model'])
          id = idOf(args)
          const operation = parseCanvasOperation({
            action: name === 'canvas_open' ? 'canvas.open' : name === 'canvas_layout' ? 'canvas.layout' : 'canvas.capabilities.read', ...Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'canvasId')) })
          if (name === 'canvas_layout') {
            return JSON.stringify(await dispatchCanvasWrite(bridge, id, operation, exec, request))
          }
          const target = await bridge.ensureContext(sessionOf(exec), id, 'read', request + ':prepare', exec.signal)
          return JSON.stringify({ ...await bridge.dispatch(target, request + ':read', operation, exec.signal),
            requestId: request, address: canvasAddress(id) })
        }
        catch (error) {
          return JSON.stringify(reject(request, error, id))
        }
      },
    }))
}
