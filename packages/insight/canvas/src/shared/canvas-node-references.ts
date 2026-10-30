import { parseCanvasId } from './protocol.ts'

export type CanvasJsonValue = null | boolean | number | string | CanvasJsonValue[] | { [key: string]: CanvasJsonValue }
export interface CanvasReferenceNode {
  id: string
  data: { [key: string]: CanvasJsonValue }
  position: { x: number
    y: number }
  type?: string
  [key: string]: CanvasJsonValue | undefined
}
export const MAX_REFERENCE_BYTES = 2 * 1024 * 1024
export interface CanvasReferenceUpdate {
  protocolVersion: 1
  type: 'canvas.references.changed'
  canvasId: string
  viewId: string
  subscriptionId: string
  revision: number
  reason: 'select' | 'update'
  nodes: CanvasReferenceNode[]
  error?: 'unserializable' | 'too_large'
}
export const isReferenceId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 100
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Copy all serializable node fields; never pass a live Store object across the view boundary. */
export function snapshotReferenceNodes(nodes: readonly unknown[]): { nodes: CanvasReferenceNode[]
  error?: CanvasReferenceUpdate['error'] } {
  try {
    const json = JSON.stringify(nodes)
    if (new TextEncoder().encode(json).length > MAX_REFERENCE_BYTES) return { nodes: [], error: 'too_large' }
    const copy: unknown = JSON.parse(json)
    if (!Array.isArray(copy) || copy.some(node => !record(node) || !isReferenceId(node.id) || !record(node.data)
      || !record(node.position) || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)
      || node.type !== undefined && (typeof node.type !== 'string' || node.type.length > 100))
      || new Set(copy.map((node: unknown) => record(node) ? node.id : undefined)).size !== copy.length) return {
      nodes: [], error: 'unserializable' }
    return { nodes: copy as CanvasReferenceNode[] }
  } catch { return { nodes: [], error: 'unserializable' } }
}

export function parseReferenceUpdate(value: unknown, identity: { canvasId: string
  viewId: string
  subscriptionId: string }): CanvasReferenceUpdate | undefined {
  if (!record(value) || value.protocolVersion !== 1 || value.type !== 'canvas.references.changed'
    || parseCanvasId(value.canvasId) !== identity.canvasId || value.viewId !== identity.viewId ||
 value.subscriptionId !== identity.subscriptionId
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !['select',
    'update'].some(reason => reason === value.reason)
    || !Array.isArray(value.nodes) || value.error !== undefined && !['unserializable',
    'too_large'].some(error => error === value.error)) return undefined
  const snapshot = snapshotReferenceNodes(value.nodes)
  if (snapshot.error) return undefined
  return { protocolVersion: 1, type: 'canvas.references.changed', ...identity, revision: Number(value.revision),
    reason: value.reason as CanvasReferenceUpdate['reason'], nodes: snapshot.nodes,
    ...(value.error === undefined ? {} : { error: value.error as CanvasReferenceUpdate['error'] }) }
}

export function referenceNodeTitle(node: CanvasReferenceNode): string {
  return typeof node.data.title === 'string' && node.data.title.trim() ? node.data.title : '未命名节点'
}

export interface ReferenceProduct { kind: 'image' | 'video' | 'audio' | 'text'
  value: string }
export function referenceProducts(node: CanvasReferenceNode): ReferenceProduct[] {
  const kind = node.type === 'text' ? 'text' : /audio/i.test(node.type ?? '') ? 'audio'
    : /video/i.test(node.type ?? '') ? 'video' : 'image'
  const candidates: unknown[] = [node.data.value, ...(Array.isArray(node.data.product)
    ? node.data.product.map(product => record(product) ? product.value : undefined) : [])]
  const values = [...new Set(candidates.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))]
  return values.filter((value) => {
    if (kind === 'text') return true
    try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
  }).map(value => ({ kind, value }))
}

export interface CanvasReferenceItem {
  canvasId: string
  nodeId: string
  title: string
  type?: string
  data: Record<string, CanvasJsonValue>
  products: ReferenceProduct[]
  node?: CanvasReferenceNode
}

export function toReferenceItems(references: readonly { canvasId: string
  node: CanvasReferenceNode }[]): CanvasReferenceItem[] {
  return references.map(ref => ({
    canvasId: ref.canvasId,
    nodeId: ref.node.id,
    title: referenceNodeTitle(ref.node),
    type: ref.node.type,
    data: ref.node.data,
    products: referenceProducts(ref.node),
    node: ref.node,
  }))
}

export function isCanvasReferenceItem(ref: unknown): ref is CanvasReferenceItem {
  if (!record(ref) || !parseCanvasId(ref.canvasId) || !isReferenceId(ref.nodeId)
    || typeof ref.title !== 'string' || ref.type !== undefined && typeof ref.type !== 'string'
    || !record(ref.data) || !Array.isArray(ref.products)
    || ref.products.some(product => !record(product) || !['image', 'video', 'audio', 'text'].includes(String(product.kind))
      || typeof product.value !== 'string')) return false
  return ref.node === undefined || record(ref.node) && !snapshotReferenceNodes([ref.node]).error && ref.node.id === ref.nodeId
}

/** One standalone text block in the original user message, never in the composer. */
export interface NodeRefsPayload { version: 1
  nodes: CanvasReferenceItem[] }
export function serializeNodeRefs(nodes: readonly CanvasReferenceItem[]): string {
  const json = JSON.stringify({ version: 1, nodes }).replace(/[<>&]/g, char =>
    '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'))
  const text = `<node-refs version="1">\n${json}\n</node-refs>`
  if (new TextEncoder().encode(text).length > MAX_REFERENCE_BYTES) throw new Error('节点引用数据过大，无法加入消息')
  return text
}

/** Only consume a complete, valid protocol block. Unknown or damaged text stays visible. */
export function parseNodeRefs(text: string): NodeRefsPayload | undefined {
  const match = /^<node-refs version="1">\n([\s\S]*)\n<\/node-refs>$/.exec(text)
  if (!match || new TextEncoder().encode(text).length > MAX_REFERENCE_BYTES) return undefined
  try {
    const payload: unknown = JSON.parse(match[1])
    if (!record(payload) || payload.version !== 1 || !Array.isArray(payload.nodes)
      || !payload.nodes.length || payload.nodes.length > 64) return undefined
    if (!payload.nodes.every(isCanvasReferenceItem)) return undefined
    return { ...payload, version: 1, nodes: payload.nodes }
  } catch { return undefined }
}

export function splitNodeRefs<T extends { type: string
  text?: string }>(content: readonly T[]): { content: readonly T[]
  nodes: CanvasReferenceItem[] } {
  const nodes: CanvasReferenceItem[] = []
  const visible = content.filter((block) => {
    const payload = block.type === 'text' && typeof block.text === 'string' ? parseNodeRefs(block.text) : undefined
    if (!payload) return true
    nodes.push(...payload.nodes)
    return false
  })
  return { content: nodes.length ? visible : content, nodes }
}
