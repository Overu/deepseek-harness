import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CanvasAgentError, type CanvasBatchWriteOutput, type ToolRejection } from '../shared/canvas-agent-protocol.ts'
import { bridgeFingerprint, MAX_BRIDGE_RECORDS, parseBridgeOperation } from '../shared/canvas-bridge-protocol.ts'
import { canvasToolContracts } from '../shared/canvas-tool-contracts.ts'
import { canvasAddress, type CanvasId } from '../shared/protocol.ts'
import type { CanvasHostBridge } from './canvas-bridge.ts'
import { argumentsObject, canvasToolOutput, dispatchCanvasBatchWrite, idOf, reject, requestId, sessionOf } from './canvas-tools.ts'

/** Graph editing and model discovery extend the native service; no generation is registered. */
export function registerCanvasGraphTools(ctx: Context, bridge: CanvasHostBridge): void {
  const batches = new Map<string, { fingerprint: string; promise: Promise<CanvasBatchWriteOutput | ToolRejection> }>()
  ctx.effect(() => () => batches.clear(), 'desktop-canvas: edge edit receipts')
  ctx.tools.register(defineTool({
    ...canvasToolContracts.canvas_edges,
    output: canvasToolOutput,
    async execute(input, exec) {
      const request = requestId('canvas_edges', exec); let id: CanvasId | undefined
      try {
        const args = argumentsObject(input, ['canvasId', 'expectedVersion', 'ops']); id = idOf(args)
        if (!Array.isArray(args.ops) || args.ops.length === 0) throw new CanvasAgentError('INVALID_ARGUMENT', 'ops必须为非空数组')
        const operations = args.ops.map(raw => {
          const op = argumentsObject(raw, ['op', 'connection', 'edgeId', 'targetNodeId', 'edgeIds'])
          const fields = op.op === 'add' ? ['connection'] : op.op === 'edit' ? ['edgeId', 'connection'] : op.op === 'remove' ? ['edgeId'] : op.op === 'reorder' ? ['targetNodeId', 'edgeIds'] : null
          if (!fields) throw new CanvasAgentError('INVALID_ARGUMENT', '连线操作仅支持add/edit/remove/reorder')
          argumentsObject(op, ['op', ...fields])
          const payload = op.op === 'remove' ? { edgeIds: [op.edgeId] } : Object.fromEntries(fields.map(key => [key, op[key]]))
          return parseBridgeOperation({ action: op.op === 'edit' ? 'edge.reconnect' : op.op === 'remove' ? 'edge.delete' : `edge.${op.op}`,
            expectedVersion: args.expectedVersion, ...payload })
        })
        const fingerprint = bridgeFingerprint(args), old = batches.get(request)
        if (old) {
          if (old.fingerprint !== fingerprint) throw new CanvasAgentError('DUPLICATE_REQUEST_MISMATCH', '相同连线编辑调用的参数不同')
          return JSON.stringify(await old.promise)
        }
        if (batches.size >= MAX_BRIDGE_RECORDS) throw new CanvasAgentError('BRIDGE_OVERLOADED', '连线编辑回执缓存已达上限')
        const promise = dispatchCanvasBatchWrite(bridge, id, operations, String(args.expectedVersion), exec, request)
        batches.set(request, { fingerprint, promise })
        return JSON.stringify(await promise)
      } catch (cause) { return JSON.stringify(reject(request, cause, id)) }
    }
  }))
  ctx.tools.register(defineTool({
    ...canvasToolContracts.canvas_models,
    output: canvasToolOutput,
    async execute(input, exec) {
      const request = requestId('canvas_models', exec); let id: CanvasId | undefined
      try {
        const args = argumentsObject(input, ['canvasId', 'nodeType', 'view', 'modelType', 'model', 'modeOffset', 'modelOffset', 'limit', 'expectedCatalogVersion', 'voiceSource', 'voiceId', 'name', 'language', 'gender', 'page']); id = idOf(args)
        if (args.view !== undefined && args.view !== 'models' && args.view !== 'voices') throw new CanvasAgentError('INVALID_ARGUMENT', 'view仅支持models或voices')
        const operation = parseBridgeOperation({ action: args.view === 'voices' ? 'canvas.voices.read' : 'canvas.models.read', ...Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'canvasId' && key !== 'view')) })
        const target = await bridge.ensureContext(sessionOf(exec), id, 'read', request + ':prepare', exec.signal)
        const result = await bridge.dispatch(target, request + ':read', operation, exec.signal)
        return JSON.stringify({ ...result, requestId: request, address: canvasAddress(id), ...(result.status === 'models' ? { source: 'plugin-service' } : {}) })
      } catch (cause) { return JSON.stringify(reject(request, cause, id)) }
    }
  }))
}
