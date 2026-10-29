import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { callsForClosing, canvasResultsClosingSeq, CanvasResultsStore, groupCanvasResults, resultsForClosing } from './canvas-results.ts'
import { CANVAS_RESULT_AUDIO_WIDTH, CANVAS_RESULT_CARD_INSET, CANVAS_RESULT_TILE_GAP, CANVAS_RESULT_TILE_SIZE,
  canvasResultGroups, canvasResultLayout, canvasResultProducts, type CanvasResultProduct } from './canvas-result-gallery.ts'
import type { CanvasResultSource } from '../shared/canvas-result-source.ts'

export const CANVAS_RESULTS_NS = 'desktop-canvas-results'
export const resultsZh = {
  title: '画布 {id}',
  canvasIdLabel: '画布 ID：',
  openCanvas: '打开画布',
  pictureAlt: '画布图片',
  videoAlt: '画布视频',
  audioAlt: '画布音频',
  audio: '音频',
  image: '图片',
  video: '视频',
  unknown: '其他',
  previewUnavailable: '预览不可用',
}
export type CanvasResultsKey = keyof typeof resultsZh
export const resultsEn: Record<CanvasResultsKey, string> = {
  title: 'Canvas {id}',
  canvasIdLabel: 'Canvas ID: ',
  openCanvas: 'Open canvas',
  pictureAlt: 'Canvas image',
  videoAlt: 'Canvas video',
  audioAlt: 'Canvas audio',
  audio: 'Audio',
  image: 'Image',
  video: 'Video',
  unknown: 'Other',
  previewUnavailable: 'Preview unavailable',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop-canvas-results': CanvasResultsKey }
}

type ResultsLocale = PropsLocale<typeof CANVAS_RESULTS_NS>
export interface CanvasResultsInjected {
  canvasResultsSessionId: string
  results: CanvasResultsStore
  openCanvasResult: (canvasId: string, nodeId?: string) => void
}

function ResultThumbnail({ product, t }: { product: CanvasResultProduct } & ResultsLocale) {
  const [failed, setFailed] = useState(false)
  const audio = product.kind === 'audio'
  const mediaStyle = { position: 'absolute' as const, inset: 0, display: 'block', width: '100%', height: '100%', objectFit: 'contain' as const }
  return <div data-canvas-result-thumbnail style={{ position: 'relative', aspectRatio: audio ? undefined : '1',
    gridColumn: audio ? '1 / -1' : undefined, width: '100%', maxWidth: audio ? CANVAS_RESULT_AUDIO_WIDTH : CANVAS_RESULT_TILE_SIZE,
    minHeight: audio ? 54 : undefined, justifySelf: 'start', minWidth: 0, overflow: 'hidden', borderRadius: 6,
    background: 'color-mix(in srgb, currentColor 5%, transparent)', display: 'grid', placeItems: 'center' }}>
    {failed || product.kind === 'unknown'
      ? <span style={{ fontSize: 12, opacity: 0.65, padding: 8 }}>{t('previewUnavailable')}</span>
      : product.kind === 'image'
        ? <img src={product.url} alt={t('pictureAlt')} loading="lazy" decoding="async" referrerPolicy="no-referrer"
          style={mediaStyle} onError={() => setFailed(true)} />
        : product.kind === 'audio'
          ? <audio src={product.url} aria-label={t('audioAlt')} preload="metadata" controls style={{ width: '100%', minWidth: 0 }} onError={() => setFailed(true)} />
          : <video src={product.url} aria-label={t('videoAlt')} preload="metadata" muted playsInline
            style={mediaStyle} onError={() => setFailed(true)} />}
  </div>
}

/** Measure the available conversation space, while the bordered card itself wraps its contents. */
function CanvasResultCard({ canvasId, sources, results, openCanvasResult, t }:
  { canvasId: string; sources: readonly CanvasResultSource[] } & Pick<CanvasResultsInjected, 'results' | 'openCanvasResult'> & ResultsLocale) {
  const container = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(CANVAS_RESULT_CARD_INSET + CANVAS_RESULT_TILE_SIZE)
  const [title, setTitle] = useState<string>()
  useEffect(() => {
    let active = true
    void results.getCanvasTitle(canvasId).then(value => { if (active) setTitle(value) })
    return () => { active = false }
  }, [results, canvasId])
  useEffect(() => {
    const element = container.current
    if (!element) return
    const update = () => setAvailableWidth(element.getBoundingClientRect().width)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const products = canvasResultProducts(sources)
  const groups = canvasResultGroups(products)
  const name = title ?? t('title', { id: canvasId })
  return <div ref={container} style={{ width: '100%', minWidth: 0 }}>
    <section data-canvas-result-card aria-label={name} style={{ boxSizing: 'border-box', width: 'max-content', maxWidth: '100%',
      border: '1px solid color-mix(in srgb, currentColor 16%, transparent)', borderRadius: 8, padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <strong title={name} style={{ fontSize: 14, fontWeight: 600, flex: '1 1 auto', minWidth: 0, maxWidth: 240,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</strong>
        <Button size="sm" variant="outline" style={{ flexShrink: 0 }}
          onClick={() => openCanvasResult(canvasId)}>{t('openCanvas')}</Button>
      </div>
      <div style={{ display: 'grid', gap: 16, marginTop: 12 }}>
        {groups.map(group => {
          const { columns, width } = canvasResultLayout(group.products, availableWidth)
          return <section key={group.kind} data-canvas-result-group={group.kind} aria-label={t(group.kind)} style={{ minWidth: 0 }}>
            {groups.length > 1 && <h3 style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 500, opacity: 0.65 }}>{t(group.kind)}</h3>}
            <div data-canvas-result-gallery style={{ width, maxWidth: '100%', display: 'grid',
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: CANVAS_RESULT_TILE_GAP }}>
              {group.products.map(product => <ResultThumbnail key={product.key} product={product} t={t} />)}
            </div>
          </section>
        })}
      </div>
    </section>
  </div>
}

/** An independent plugin footer; ordinary local file cards keep their native actions. */
export function CanvasResults({ turn, seq, canvasResultsSessionId, results, openCanvasResult, t }:
  PropsRuntime<'conversation.chat.turnTail'> & CanvasResultsInjected & ResultsLocale) {
  const id = canvasResultsSessionId
  const data = callsForClosing(turn)
  const closingSeq = canvasResultsClosingSeq(turn, seq)
  const hasCalls = !!data?.calls.some(call => call.seq <= closingSeq)
  const subscribe = useCallback((listener: () => void) => hasCalls ? results.subscribe(id, listener) : () => {}, [results, id, hasCalls])
  const getSnapshot = useCallback(() => results.getSnapshot(id), [results, id])
  const sources = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useEffect(() => hasCalls ? results.retainSession(id) : undefined, [results, id, hasCalls])
  const matched = data ? resultsForClosing(sources, id, turn.turn, data.calls, closingSeq) : []
  if (!matched.length) return null
  return <div data-canvas-results style={{ display: 'grid', gap: 8, marginBlock: 8, minWidth: 0 }}>
    {[...groupCanvasResults(matched)].map(([canvasId, rows]) => <CanvasResultCard key={canvasId} canvasId={canvasId}
      sources={rows} results={results} openCanvasResult={openCanvasResult} t={t} />)}
  </div>
}
