/** Compact authenticated-account entry for the DSH sidebar footer. */
import { useState } from 'react'
import { IconUserOutlineRegular, Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InsightAccountSnapshot } from './account-source.ts'
import css from './AccountFooter.module.css'

/** Injected data and one deliberately narrow Main-process account action. */
export interface InsightAccountFooterInjected {
  signOut: () => Promise<void>
  openSettings: () => void
  hooks: { account: { getSnapshot(): InsightAccountSnapshot; subscribe(listener: () => void): () => void } }
}

/** Slot-composed props for the Insight account footer. */
export type InsightAccountFooterProps = PropsRuntime<'sidebar.footer.action'>
  & InjectFace<InsightAccountFooterInjected>

/** Render summary data only; sensitive account credentials never reach this component. */
const HANDBOOK_URL = 'https://desktop.insight-aigc.com/insight-ai-product-bluebook.html'

export function InsightAccountFooter({ wide, signOut, openSettings, useAccount }: InsightAccountFooterProps) {
  const { summary, failed } = useAccount(snapshot => snapshot)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutFailed, setSignOutFailed] = useState(false)
  const [open, setOpen] = useState(false)
  if (summary === null) return null
  const label = summary.displayName || summary.maskedPhone
  const requestSignOut = async (): Promise<void> => {
    if (signingOut) return
    setSigningOut(true)
    setSignOutFailed(false)
    try { await signOut() } catch { setSignOutFailed(true) } finally { setSigningOut(false) }
  }
  const control = (
    <button type="button" className={css.trigger} aria-haspopup="menu" aria-expanded={open}
      aria-label={label} onClick={() => { setOpen(value => !value) }}>
      {summary.avatarUrl ? <img className={css.avatar} src={summary.avatarUrl} alt="" /> : <IconUserOutlineRegular size={wide ? 16 : 18} />}
      {wide && <span className={css.detail}><span>{label}</span><small>{signOutFailed ? '退出失败，请重试' : failed ? '账号信息暂不可用' : summary.maskedPhone}</small></span>}
    </button>
  )
  const menu = <Menu open={open} anchor={wide ? control : <Tooltip label={label} delayMs={500}>{control}</Tooltip>}
    onClose={() => { setOpen(false) }} side="top" align="start" portal autoFocus selection="fill"
    items={[
      { id: 'handbook', label: '使用手册' },
      { id: 'settings', label: '设置' },
      { id: 'sign-out', label: signingOut ? '正在退出…' : '退出', disabled: signingOut, danger: true },
    ]}
    onSelect={(id) => {
      setOpen(false)
      if (id === 'handbook') window.open(HANDBOOK_URL, '_blank', 'noopener,noreferrer')
      if (id === 'settings') openSettings()
      if (id === 'sign-out') void requestSignOut()
    }} />
  return <div className={css.root} data-wide={wide}>{menu}</div>
}
