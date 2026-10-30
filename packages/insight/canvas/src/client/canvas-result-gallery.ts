import type { CanvasResultSource } from '../shared/canvas-result-source.ts'

export const CANVAS_RESULT_PREVIEW_LIMIT = 4
export const CANVAS_RESULT_TILE_SIZE = 160
export const CANVAS_RESULT_AUDIO_WIDTH = 320
export const CANVAS_RESULT_TILE_GAP = 8
export const CANVAS_RESULT_CARD_INSET = 22 // Two borders and 10px padding on both sides.

export interface CanvasResultProduct {
  key: string
  nodeId: string
  url: string
  kind: 'image' | 'video' | 'audio' | 'unknown'
}

/** Keep all output identities even when previews are truncated. */
export function canvasResultProducts(sources: readonly CanvasResultSource[]): CanvasResultProduct[] {
  return sources.flatMap(source => source.outputs.map((url, index) => ({
    key: `${source.requestId}:${index}`, nodeId: source.nodeId, url,
    kind: source.generation.images > 0 && source.generation.videos === 0 && !source.generation.audios ? 'image'
      : source.generation.videos > 0 && source.generation.images === 0 && !source.generation.audios ? 'video'
        : (source.generation.audios ?? 0) > 0 && source.generation.images === 0 && source.generation.videos === 0 ? 'audio' : 'unknown',
  })))
}

export function canvasResultGroups(products: readonly CanvasResultProduct[]) {
  return (['audio', 'image', 'video', 'unknown'] as const)
    .map(kind => ({ kind, products: products.filter(product => product.kind === kind).slice(0, CANVAS_RESULT_PREVIEW_LIMIT) }))
    .filter(group => group.products.length > 0)
}

/** Prefer one complete row, otherwise two columns; never create a 3+1 gallery. */
export function canvasResultColumns(count: number, availableWidth: number): number {
  const visible = Math.min(CANVAS_RESULT_PREVIEW_LIMIT, count)
  const fits = (columns: number) => availableWidth >= CANVAS_RESULT_CARD_INSET
    + columns * CANVAS_RESULT_TILE_SIZE + (columns - 1) * CANVAS_RESULT_TILE_GAP
  if (visible <= 1) return 1
  if (fits(visible)) return visible
  return fits(2) ? 2 : 1
}

export function canvasResultLayout(products: readonly CanvasResultProduct[], availableWidth: number) {
  const previews = products.slice(0, CANVAS_RESULT_PREVIEW_LIMIT)
  const columns = canvasResultColumns(previews.filter(product => product.kind !== 'audio').length, availableWidth)
  const contentWidth = Math.max(0, availableWidth - CANVAS_RESULT_CARD_INSET)
  const tileSize = Math.min(CANVAS_RESULT_TILE_SIZE, contentWidth)
  const width = Math.min(contentWidth, Math.max(columns * tileSize + (columns - 1) * CANVAS_RESULT_TILE_GAP,
    previews.some(product => product.kind === 'audio') ? CANVAS_RESULT_AUDIO_WIDTH : 0))
  return { columns, width }
}
