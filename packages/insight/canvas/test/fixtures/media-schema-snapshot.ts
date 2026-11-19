/** Deterministic native Canvas responses for the headless schema transcript. */
import type { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { registerCanvasTools } from '../../src/host/canvas-tools.ts'
import { registerCanvasRunTools } from '../../src/host/canvas-run-tools.ts'
import type { CanvasHostBridge } from '../../src/host/canvas-bridge.ts'
import type { BridgeTarget } from '../../src/shared/canvas-bridge-protocol.ts'
import type { NodeDetail, ParamHint } from '../../src/shared/canvas-agent-protocol.ts'

export const name = 'canvas-media-schema-fixture'
export const inject = ['tools', 'sessionPersistence']

/** Provide the external native Canvas responses without network calls. */
export async function apply(ctx: Context): Promise<void> {
  const session = await ctx.sessionPersistence.create({ id: SessionId('canvas-media-schema-snapshot'), version: SESSION_FORMAT_VERSION,
    createdAt: 0, cwd: process.cwd(), isSeeded: false, delegationDepth: 0 })
  try { await session.flush() } finally { await session.close() }
  let version = 1
  let mime = 'png'
  let resolution = '2K'
  let frameCount = 9
  let frameDuration = 200
  const target: BridgeTarget = { canvasId: '2873', contextId: 'image-context', connectionId: 'image-connection',
    sessionId: 'canvas-media-schema-snapshot', readiness: { phase: 'ready', version: '1', capabilities: { read: true, edit: true, run: true } } }
  const bridge: CanvasHostBridge = {
    async ensureContext() { return target },
    async dispatch(_target, _requestId, operation) {
      if (operation.action === 'node.configure') {
        const params = operation.configuration.params ?? {}
        if (params.resolution === '2K') {
          version++
          return { status: 'saved', canvasId: '2873', version: String(version), affectedNodeIds: [operation.nodeId], unchanged: false }
        }
        if (params.mime_type !== 'gif' || params.frame_count !== 12 || params.frame_duration_ms !== 300) {
          throw new Error('fixture expects the GIF configuration in the recorded task')
        }
        mime = 'gif'; resolution = 'auto'; frameCount = 12; frameDuration = 300; version++
        return { status: 'saved', canvasId: '2873', version: String(version), affectedNodeIds: [operation.nodeId], unchanged: false }
      }
      if (operation.action !== 'canvas.read') throw new Error('fixture supports node reads and configuration')
      const paramHints: ParamHint[] = [
        { field: 'mime_type', editable: true, choices: ['png', 'gif'] },
        { field: 'resolution', editable: true, choices: mime === 'gif' ? ['auto'] : ['1K', '2K'] },
        { field: 'future', editable: false, choices: [] },
        ...(mime === 'gif' ? [
          { field: 'frame_count', editable: true, min: 2, max: 16, step: 1, default: 9 },
          { field: 'frame_duration_ms', editable: true, min: 20, max: 2000, step: 10, default: 200 },
        ] : []),
        { field: 'gen_count', editable: true, choices: [1] },
      ]
      const node: NodeDetail = { id: 'image-1', type: 'image', title: '图片节点', contentType: null, text: null, prompt: '',
        params: { modelType: 'reference_image_to_image', model: 'gpt-image-2.6-sunburst-i2i', mime_type: mime,
          resolution, frame_count: frameCount, frame_duration_ms: frameDuration, future: 'native', gen_count: 1 },
        paramHints, status: 'success', inputs: [], outputs: [], generation: { images: 1, videos: 0 }, truncatedFields: [] }
      return { status: 'read', canvasId: '2873', version: String(version), consistency: 'confirmed',
        nodeCount: 1, nodes: [node], missingNodeIds: [] }
    },
    subscribeRun() { throw new Error('fixture does not generate') },
    getPendingReferences() { return undefined },
    consumeReferences() {},
    dispose() {},
  }
  registerCanvasTools(ctx, bridge, {
    async createCanvas() { throw new Error('fixture uses an existing Canvas') },
    async getCanvas() { throw new Error('fixture uses native node reads') },
  })
  registerCanvasRunTools(ctx, bridge)
  ctx.effect(() => () => bridge.dispose())
}
