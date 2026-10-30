import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { parseCanvasRunState, type CanvasRunState } from '../shared/canvas-run-protocol.ts'
import { CANVAS_RESULT_PAGE_LIMIT, parseCanvasResultSource, type CanvasResultBinding, type CanvasResultEvent,
  type CanvasResultSource } from '../shared/canvas-result-source.ts'

const sourceSchema = z.custom<CanvasResultSource>((value) => {
  try { parseCanvasResultSource(value); return true } catch { return false }
}, { message: 'invalid canvas result source' })
export const canvasResultDomain = defineDomain({ name: 'desktop_canvas_results', version: 1, layout: 'per-record',
  invalidRecords: 'backup-and-skip', tables: { sources: domainTable<string, CanvasResultSource>(sourceSchema) } })
const PAGE_BYTES = 1024 * 1024
const keyOf = (source: Pick<CanvasResultSource,
 'sessionId' | 'requestId'>) => createHash('sha256').update(JSON.stringify([source.sessionId, source.requestId])).digest('hex')
const cursorOf = (source: CanvasResultSource) => Buffer.from(JSON.stringify([source.createdAt, keyOf(source)])).toString('base64url')
export class CanvasResultCursorError extends Error {
  constructor() { super('invalid result cursor'); this.name = 'CanvasResultCursorError' }
}
function cursorValue(cursor: string): [number, string] {
  try {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(cursor)) throw new CanvasResultCursorError()
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (!Array.isArray(value) || value.length !== 2 || !Number.isSafeInteger(value[0]) || value[0] < 0 ||
 typeof value[1] !== 'string' || !/^[a-f0-9]{64}$/.test(value[1])) throw new CanvasResultCursorError()
    return value as [number, string]
  } catch { throw new CanvasResultCursorError() }
}

export interface CanvasResultStore {
  record(binding: CanvasResultBinding, state: CanvasRunState): Promise<void>
  list(sessionId: string, options?: { after?: string
    limit?: number
    visible?: (source: CanvasResultSource) => boolean }): Promise<Extract<CanvasResultEvent, { type: 'snapshot' }>>
  subscribe(sessionId: string, listener: (source: CanvasResultSource) => void): () => void
  close(): Promise<void>
}

/** The official Domain owns the durability queue; this module only correlates and projects records. */
export function createCanvasResultStore(ctx: Context): CanvasResultStore {
  let domain: Promise<Domain<typeof canvasResultDomain>> | undefined, closed = false, closing: Promise<void> | undefined
  const pending = new Map<string, Promise<void>>(), listeners = new Map<string, Set<(source: CanvasResultSource) => void>>()
  const open = () => {
    if (closed) throw new Error('canvas result store closed')
    if (!domain) {
      const facility = ctx.get('storageDomain')
      if (!facility) throw new Error('canvas result storage unavailable')
      domain = facility.open(canvasResultDomain).catch((error: unknown) => { domain = undefined; throw error })
    }
    return domain
  }
  const store: CanvasResultStore = {
    record(binding, raw) {
      try {
        const state = parseCanvasRunState(raw)
        if (!['completed', 'failed'].includes(state.phase) || state.outputs.length === 0) return Promise.resolve()
        const source = parseCanvasResultSource({ ...binding, schemaVersion: 1, requestId: state.requestId, canvasId: state.canvasId,
          nodeId: state.nodeId, phase: state.phase, version: state.version, generation: state.generation, outputs: state.outputs,
          ...(state.workflowTaskId ? { workflowTaskId: state.workflowTaskId } : {}), ...(state.operationId ? {
            operationId: state.operationId } : {}),
          ...(state.nodeTaskId ? { nodeTaskId: state.nodeTaskId } : {}), createdAt: Date.now() })
        if (closed || closing) throw new Error('canvas result store closed')
        const key = keyOf(source), existing = pending.get(key)
        if (existing) return existing
        if (pending.size >= 256) throw new Error('canvas result writes overloaded')
        const writing = Promise.resolve().then(async () => {
          const table = (await open()).table('sources')
          if (table.get(key)) return
          await table.put(key, source)
          for (const listener of listeners.get(source.sessionId) ?? []) {
            try { listener(structuredClone(source)) } catch { ctx.logger.warn('canvas result listener failed after persistence') }
          }
        }).finally(() => pending.delete(key))
        pending.set(key, writing)
        return writing
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error('Canvas result persistence failed', { cause: error })) }
    },
    async list(sessionId, { after, limit = CANVAS_RESULT_PAGE_LIMIT, visible = () => true } = {}) {
      if (closed || closing) throw new Error('canvas result store closed')
      if (!Number.isInteger(limit) || limit < 1 || limit > CANVAS_RESULT_PAGE_LIMIT) throw new Error('invalid result page limit')
      const cursor = after === undefined ? undefined : cursorValue(after)
      const sources = [...(await open()).table('sources').entries()].map(([, value]) => value)
        .filter(source => source.sessionId === sessionId && visible(source))
        .sort((a, b) => a.createdAt - b.createdAt || keyOf(a).localeCompare(keyOf(b)))
        .filter(source => !cursor || source.createdAt > cursor[0] || source.createdAt === cursor[0] && keyOf(source) > cursor[1])
      const page: CanvasResultSource[] = []
      let bytes = 0
      for (const source of sources) {
        const size = Buffer.byteLength(JSON.stringify(source))
        if (page.length >= limit || bytes + size > PAGE_BYTES) break
        page.push(structuredClone(source)); bytes += size
      }
      return { type: 'snapshot', sources: page, ...(page.length < sources.length && page.length ? {
        nextCursor: cursorOf(page[page.length - 1]) } : {}) }
    },
    subscribe(sessionId, listener) {
      if (closed || closing) throw new Error('canvas result store closed')
      const group = listeners.get(sessionId) ?? new Set()
      group.add(listener); listeners.set(sessionId, group)
      return () => { group.delete(listener); if (!group.size) listeners.delete(sessionId) }
    },
    close() {
      if (!closing) {
        // Already admitted writes may still open the domain while draining.
        closing = Promise.allSettled([...pending.values()]).then(async () => { closed = true; listeners.clear()
          await (await domain)?.close() })
      }
      return closing
    },
  }
  return store
}
