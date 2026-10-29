import type { CanvasId } from '../shared/protocol.ts'
import { requestCanvasJson } from './canvas-api.ts'
import { desktopToken } from './desktop-token.ts'
export { CanvasHttpError } from './canvas-api.ts'

export interface CanvasNodeSummary {
  id: string
  title: string
  type: string
  value: string
}

export interface CanvasSnapshot {
  canvasId: CanvasId
  name: string
  nodeCount: number
  nodes: CanvasNodeSummary[]
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function bounded(value: unknown, fallback: string, max: number): string {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : fallback
}

/** Parse the current canvas/get envelope into a bounded read-only preview. */
export function parseCanvasGet(canvasId: CanvasId, body: unknown): CanvasSnapshot {
  const envelope = record(body)
  const data = record(envelope?.data)
  if (envelope?.code !== 'SUCCESS' || !data) throw new Error('画布服务未返回成功状态')
  const raw = data.data
  let graph: unknown
  try { graph = typeof raw === 'string' ? JSON.parse(raw) : raw }
  catch { throw new Error('画布图数据不是有效 JSON') }
  const nodes = record(graph)?.nodes
  if (!Array.isArray(nodes)) throw new Error('画布节点数据格式不正确')
  const preview = nodes.slice(0, 100).map((value: unknown): CanvasNodeSummary => {
    const node = record(value)
    if (!node || typeof node.id !== 'string' || !node.id) throw new Error('画布节点缺少 ID')
    if (node.id.length > 100) throw new Error('画布节点 ID 过长')
    return {
      id: node.id,
      title: bounded(record(node.data)?.title ?? node.title, '未命名节点', 100),
      type: bounded(node.type, 'unknown', 40),
      value: bounded(record(node.data)?.value ?? node.value, '', 1000)
    }
  })
  return { canvasId, name: bounded(data.name, '未命名画布', 100), nodeCount: nodes.length, nodes: preview }
}

/** Call only the configured canvas Gateway with the current desktop identity. */
export async function fetchCanvas(
  id: CanvasId,
  tokenProvider: (signal?: AbortSignal) => Promise<string> = desktopToken,
  transport: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<CanvasSnapshot> {
  return parseCanvasGet(id, await requestCanvasJson('get', { id }, signal, { tokenProvider, transport }))
}
