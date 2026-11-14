/** Remote file cards with one-click download and per-file failure feedback. */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, FileTypeIcon } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LayeringCard } from './layering-results.ts'
import { RESULT_DOWNLOAD_PATH } from '../shared/layering-files.ts'
import css from './LayeringResultCards.module.css'

export const NS = 'insight-layering-results'
export const zh = { title: '{image} 的处理结果', incomplete: '结果不完整',
  download: '下载', downloading: '下载中…', downloadFailed: '下载失败，请重试' }
export const en = { title: 'Results for {image}', incomplete: 'Incomplete result',
  download: 'Download', downloading: 'Downloading…', downloadFailed: 'Download failed. Try again' }
export type LayeringResultKey = keyof typeof zh
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'insight-layering-results': LayeringResultKey }
}

function ResultFile({ sessionId, card, index, t }: { sessionId: string; card: LayeringCard; index: number }
  & PropsLocale<typeof NS>) {
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'error'>('idle')
  const file = card.files[index]
  if (!file) return null
  const download = async () => {
    if (phase === 'downloading') return
    setPhase('downloading')
    try {
      const query = new URLSearchParams({ sessionId, seq: String(card.seq), index: String(index) })
      const response = await fetch(`${RESULT_DOWNLOAD_PATH.slice(1)}?${query.toString()}`, { credentials: 'same-origin' })
      if (!response.ok) throw new Error('Download failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = file.name
      document.body.append(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setPhase('idle')
    } catch { setPhase('error') }
  }
  return <div className={css.file} data-layering-result-file>
    <span className={css.icon}><FileTypeIcon path={file.name} size={20} /></span>
    <div className={css.details}><span className={css.name}>{file.name}</span>
      {phase === 'error' && <span role="alert" className={css.error}>{t('downloadFailed')}</span>}
    </div>
    <Button size="sm" disabled={phase === 'downloading'} onClick={() => { void download() }}>
      {t(phase === 'downloading' ? 'downloading' : 'download')}
    </Button>
  </div>
}

/** Render each original image's remote result set under a separate heading. */
export function LayeringResultCards({ turn, mediaSessionId, t }: PropsRuntime<'conversation.chat.turnTail'>
  & { mediaSessionId: string } & PropsLocale<typeof NS>) {
  const cards = turn.data.get('insight-layering-results')
  if (!cards?.length) return null
  return <div className={css.root}>
    {cards.map(card => <section className={css.group} key={card.seq}>
      <h3 className={css.title}>{t('title', { image: card.imageLabel })}</h3>
      {!card.complete && <span className={css.incomplete}>{t('incomplete')}</span>}
      <div className={css.files}>{card.files.map((_file, index) => <ResultFile
        key={`${card.seq}:${index}`} sessionId={mediaSessionId} card={card} index={index} t={t} />)}</div>
    </section>)}
  </div>
}
