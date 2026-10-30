import { useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { HoverCard } from '@deepseek-ai/dsh-client-ui-primitives'
import { referenceNodeTitle, referenceProducts, type ReferenceProduct } from '../shared/canvas-node-references.ts'
import type { CanvasNodeReference, CanvasNodeReferences } from './canvas-node-references.ts'

export const CANVAS_REFERENCES_NS = 'desktop-canvas-references'
export const referencesZh = {
  title: '画布节点引用', remove: '移除引用：{name}', clear: '清空节点引用', focus: '定位节点：{name}',
  preview: '节点产物',
  too_large: '选中节点数据过大，无法加入引用。', unserializable: '选中节点数据无法序列化，未加入引用。',
}
export type CanvasReferencesKey = keyof typeof referencesZh
export const referencesEn: Record<CanvasReferencesKey, string> = {
  title: 'Canvas node references', remove: 'Remove reference: {name}', clear: 'Clear node references', focus: 'Focus node: {name}',
  preview: 'Node outputs',
  too_large: 'The selected node data is too large to reference.', unserializable: 'The selected node data could not be serialized.',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop-canvas-references': CanvasReferencesKey }
}
export interface CanvasReferencesInjected {
  references: CanvasNodeReferences
  referenceSessionId: string
  openReference: (reference: CanvasNodeReference) => void
}

function TypeIcon({ type }: { type?: string }) {
  if (type === 'text') return <span aria-hidden="true" style={{ fontSize: 22 }}>t</span>
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    {/audio/i.test(type ?? '') ? <path d="M4 9v6m4-11v16m4-13v10m4-14v18m4-12v6" />
      : /video/i.test(type ?? '') ? <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m10 8 6 4-6 4Z" /></>
        : <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m3 18 5-5 4 4 4-6 5 7" /></>}
  </svg>
}
export function ReferenceProductPreview({ product, preview = false }: { product: ReferenceProduct
  preview?: boolean }) {
  const [failed, setFailed] = useState(false)
  const style = preview ? undefined : { display: 'block', width: '100%', height: '100%', objectFit: 'contain' as const }
  if (failed) return <TypeIcon type={product.kind} />
  if (product.kind === 'text') return preview ? <pre style={{ margin: 0, whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere' }}>{product.value}</pre> : <TypeIcon type="text" />
  if (product.kind === 'audio') return preview ? <audio controls preload="none" src={product.value} onError={() =>{
    setFailed(true) }} style={{ maxWidth: '100%' }} /> : <TypeIcon type="audio" />
  if (product.kind === 'video') return <video src={product.value} preload="metadata" controls={preview} muted={
    !preview} playsInline style={style} onError={() =>{  setFailed(true) }} />
  return <img src={product.value} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={
    style} onError={() =>{  setFailed(true) }} />
}

export function ReferencePreview({ title, products, label }: { title: string
  products: readonly ReferenceProduct[]
  label?: string }) {
  return <div data-canvas-reference-preview aria-label={label}>
    <style>{`
      /* HoverCard portals this content and derives its width from the whole reference row. */
      div:has(> [data-canvas-reference-preview]) { max-width: min(400px, calc(100vw - 16px)); }
      [data-canvas-reference-preview] {
        box-sizing: border-box; display: flex; flex-direction: column; gap: 12px;
        max-height: 400px; min-height: 0; padding: 8px; overflow: auto;
      }
      [data-canvas-reference-preview] > strong { flex-shrink: 0; overflow-wrap: anywhere; }
      [data-canvas-reference-preview] > img, [data-canvas-reference-preview] > video {
        display: block; flex-shrink: 0; width: 100%; height: auto;
        max-height: min(344px, calc(100dvh - 80px)); object-fit: contain;
      }
      [data-canvas-reference-preview] > pre, [data-canvas-reference-preview] > audio { flex-shrink: 0; }
    `}</style>
    <strong>{title}</strong>{products.map((product, index) =>
      <ReferenceProductPreview key={`${product.kind}:${product.value}:${index}`} product={product} preview />)}
  </div>
}

export function ReferenceThumbnail({ title, label = title, type, product, onClick }: {
  title: string
  label?: string
  type?: string
  product?: ReferenceProduct
  onClick: () => void
}) {
  return <button type="button" title={title} aria-label={label} onClick={onClick}
    style={{ display: 'grid', placeItems: 'center', boxSizing: 'border-box', width: 40, height: 40, flexShrink: 0,
      padding: 5, overflow: 'hidden', borderRadius: 8, color: 'inherit', cursor: 'pointer',
      border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
      background: 'color-mix(in srgb, currentColor 5%, transparent)' }}>
    {product ? <ReferenceProductPreview key={product.value} product={product} /> : <TypeIcon type={type} />}
  </button>
}

export function CanvasReferenceDock({ references, referenceSessionId, openReference,
  t }: CanvasReferencesInjected & PropsLocale<typeof CANVAS_REFERENCES_NS>) {
  const state = useSyncExternalStore(listener => references.subscribe(listener), () => references.getSnapshot(referenceSessionId))
  const anchor = useRef<HTMLDivElement>(null)
  if (!state.references.length && !state.error) return null
  return <section aria-label={t('title')} data-canvas-references
    style={{ minWidth: 0, padding: '6px 10px 0', marginBottom: -6 }}>
    <style>{`
      [data-canvas-references] .canvas-ref-remove, [data-canvas-references] .canvas-ref-clear { opacity: 0; }
      [data-canvas-references] .canvas-ref-item:hover .canvas-ref-remove,
      [data-canvas-references] .canvas-ref-item:focus-within .canvas-ref-remove,
      [data-canvas-references]:hover .canvas-ref-clear,
      [data-canvas-references]:focus-within .canvas-ref-clear { opacity: 1; }
      @media (hover: none) { [data-canvas-references] .canvas-ref-remove, [data-canvas-references] .canvas-ref-clear { opacity: 1; } }
      [data-canvas-references] button { color: inherit; cursor: pointer; }
      [data-canvas-references] button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
    `}</style>
    <div ref={anchor} style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
        {state.references.map((reference) => {
          const name = referenceNodeTitle(reference.node)
          const products = referenceProducts(reference.node)
          const tile = <div className="canvas-ref-item" style={{ position: 'relative' }}>
            <ReferenceThumbnail title={name} label={t('focus', { name })} type={reference.node.type}
              product={products[0]} onClick={() =>{  openReference(reference) }} />
            <button className="canvas-ref-remove" type="button" aria-label={t('remove', { name })}
              onClick={(event) => { event.stopPropagation(); references.remove(referenceSessionId, reference) }}
              style={{ position: 'absolute', top: -5, right: -5, width: 18, height: 18, padding: 0, borderRadius: '50%',
                border: '1px solid currentColor', background: 'var(--dsw-alias-button-tool-bar-fill, Canvas)', fontSize: 12 }}>×</button>
          </div>
          return <HoverCard key={`${reference.viewId}:${reference.node.id}`} anchor={tile} disabled={!products.length}
            variant="preview" widthAnchorRef={anchor} openDelayMs={250}
            content={<ReferencePreview title={name} products={products} label={t('preview')} />} />
        })}
      </div>
      {!!state.references.length && <button className="canvas-ref-clear" type="button" aria-label={t('clear')}
        onClick={() =>{  references.clear(referenceSessionId) }} style={{ flexShrink: 0, border: 0,
          background: 'transparent', fontSize: 20 }}>×</button>}
    </div>
    {state.error && <div role="status">{t(state.error)}</div>}
  </section>
}
