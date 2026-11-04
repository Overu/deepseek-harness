/** External native workflow fixture for Canvas text generation through the headless profile. */
import { cp } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerCanvasTools } from '../../src/host/canvas-tools.ts'
import { registerCanvasGuidance } from '../../src/host/canvas-guidance.ts'
import type { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { registerCanvasRunTools } from '../../src/host/canvas-run-tools.ts'
import type { CanvasHostBridge } from '../../src/host/canvas-bridge.ts'
import type { CanvasRunState } from '../../src/shared/canvas-run-protocol.ts'
import type { BridgeTarget } from '../../src/shared/canvas-bridge-protocol.ts'

export const name = 'canvas-text-run-fixture'
export const inject = ['tools', 'sessionPersistence', 'skills', 'systemPrompt']

/** Mount the production tool with deterministic external completion data. */
export async function apply(ctx: Context): Promise<void> {
  // Canvas request ids derive from the real Session identity, which is fixed for replay.
  const session = await ctx.sessionPersistence.create({ id: SessionId('canvas-text-run-snapshot'), version: SESSION_FORMAT_VERSION,
    createdAt: 0, cwd: process.cwd(), isSeeded: false, delegationDepth: 0 })
  try { await session.flush() } finally { await session.close() }
  const guidance = join(process.cwd(), '.snapshot-patches', 'canvas-guidance')
  await cp(fileURLToPath(new URL('../../guidance/desktop-canvas-workflow', import.meta.url)), guidance, { recursive: true })
  registerCanvasGuidance(ctx, guidance)
  let version = 1, prompt = '', value = ''
  const listeners = new Map<string, Set<(state: CanvasRunState) => void>>()
  const target: BridgeTarget = { canvasId: '2873', contextId: 'text-context', connectionId: 'text-connection',
    sessionId: 'canvas-text-run-snapshot', readiness: { phase: 'ready', version: '1', capabilities: { read: true, edit: true, run: true } } }
  const bridge: CanvasHostBridge = {
    async ensureContext() { return target },
    async dispatch(_target, requestId, operation) {
      if (operation.action === 'node.update') {
        if (operation.changes.prompt !== undefined) prompt = operation.changes.prompt
        if (operation.changes.text !== undefined) value = operation.changes.text
        return { status: 'saved', canvasId: '2873', version: String(++version), affectedNodeIds: [operation.nodeId], unchanged: false }
      }
      if (operation.action === 'node.preflight') {
        if (!prompt || !value) throw new Error('fixture expects separate Agent prompt and value edits before generating')
        return { status: 'preflight', canvasId: '2873', version: String(version), nodeId: operation.nodeId,
          generation: { images: 0, videos: 0, texts: 1 }, quote: { points: 0, originalPoints: null } }
      }
      if (operation.action !== 'node.run') throw new Error('fixture expects one native text run')
      version++
      queueMicrotask(() => {
        const state: CanvasRunState = { requestId, canvasId: '2873', nodeId: operation.nodeId, sequence: 1, phase: 'completed', version: String(version),
          workflowTaskId: 'text-workflow', nodeTaskId: 'text-task', generation: operation.approvedGeneration, outputs: ['生成的画布文案'] }
        for (const listener of listeners.get(requestId) ?? []) listener(state)
      })
      return { status: 'submitted', canvasId: '2873', version: String(version), nodeId: operation.nodeId,
        taskId: 'text-workflow', generation: operation.approvedGeneration }
    },
    subscribeRun(_target, requestId, listener) {
      const group = listeners.get(requestId) ?? new Set<(state: CanvasRunState) => void>()
      group.add(listener); listeners.set(requestId, group)
      return () => { group.delete(listener); if (!group.size) listeners.delete(requestId) }
    },
    getPendingReferences() { return undefined },
    consumeReferences() {},
    dispose() { listeners.clear() },
  }
  registerCanvasTools(ctx, bridge, {
    async createCanvas() { throw new Error('fixture uses an existing Canvas') },
    async getCanvas() { throw new Error('fixture uses native command reads') },
  })
  registerCanvasRunTools(ctx, bridge)
  ctx.effect(() => () => bridge.dispose())
}
