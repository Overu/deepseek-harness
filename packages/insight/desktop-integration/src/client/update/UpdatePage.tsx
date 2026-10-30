/** Insight's isolated native update-window renderer. */

import { useEffect, useRef, useState } from 'react'
import type { InsightUpdateApi, InsightUpdateSnapshot } from '../../shared/update-api.ts'
import css from './update.module.css'

/** Inputs supplied by the safe preload bridge and static product artwork. */
export interface UpdatePageProps {
  api: InsightUpdateApi
  logoUrl: string
}

function detail(state: InsightUpdateSnapshot): string {
  if (state.message !== undefined) return state.message
  if (state.phase === 'idle') return `当前版本 ${state.currentVersion}`
  if (state.phase === 'checking') return '正在检查可用更新'
  if (state.phase === 'available') return `${state.currentVersion} → ${state.version ?? '新版本'}`
  if (state.phase === 'downloading') return `正在下载${state.percent === undefined ? '' : ` ${Math.round(state.percent)}%`}`
  if (state.phase === 'verifying') return '正在校验下载内容'
  if (state.phase === 'ready') return `版本 ${state.version ?? '新版本'} 已准备就绪`
  if (state.phase === 'installing') return '正在启动安装'
  if (state.phase === 'unsupported') return '当前客户端不支持在线更新'
  return '更新暂时未完成，请重试'
}

function title(state: InsightUpdateSnapshot): string {
  if (state.phase === 'idle') return '检查客户端更新'
  if (state.phase === 'checking') return '正在检查更新'
  if (state.phase === 'available') return state.required ? '需要更新因赛AI' : '发现新版本'
  if (state.phase === 'downloading') return '正在下载更新'
  if (state.phase === 'verifying') return '正在校验更新'
  if (state.phase === 'ready') return '更新已准备就绪'
  if (state.phase === 'installing') return '正在准备安装'
  if (state.phase === 'unsupported') return '无法在线更新'
  return '更新暂时中断'
}

function initial(): InsightUpdateSnapshot {
  return { currentVersion: '—', phase: 'idle', track: 'stable', required: false, canDownloadFullInstaller: false }
}

/** Render update status and Main-owned actions without receiving a URL or installer path. */
export function UpdatePage({ api, logoUrl }: UpdatePageProps) {
  const [state, setState] = useState<InsightUpdateSnapshot>(initial)
  const [commandError, setCommandError] = useState<string>()
  const clicks = useRef({ count: 0, startedAt: 0, pending: false })

  useEffect(() => {
    let active = true
    const unsubscribe = api.subscribe((snapshot) => { if (active) setState(snapshot) })
    void api.status().then((snapshot) => { if (active) setState(snapshot) }, () => { if (active) setCommandError('无法读取更新状态，请重试') })
    return () => { active = false; unsubscribe() }
  }, [api])

  const execute = (operation: () => Promise<void>): void => {
    setCommandError(undefined)
    void operation().catch(() => { setCommandError('操作未完成，请重试') })
  }

  const checkCandidate = (): void => {
    const click = clicks.current
    if (click.pending) return
    const now = Date.now()
    if (now - click.startedAt > 3_000) { click.count = 0; click.startedAt = now }
    click.count += 1
    if (click.count < 5) return
    click.count = 0
    click.pending = true
    setCommandError(undefined)
    void api.checkCandidate().catch(() => { setCommandError('内测更新检查未完成，请重试') }).finally(() => { click.pending = false })
  }

  const busy = ['checking', 'downloading', 'verifying', 'installing'].includes(state.phase)
  const availableVersion = state.version
  return <main className={css.page} aria-live="polite">
    <section className={css.summary}>
      <button className={css.logo} type="button" onClick={checkCandidate} aria-label="因赛AI 标志">
        <img src={logoUrl} alt="" />
      </button>
      <div className={css.content}>
        <div className={css.title}><h1>{title(state)}</h1>{state.track === 'candidate' && <span>内测版本</span>}</div>
        <p>{detail(state)}</p>
        {commandError !== undefined && <p className={css.error}>{commandError}</p>}
        {state.phase === 'downloading' && <progress max="100" value={state.percent} aria-label="下载进度" />}
        {(state.phase === 'checking' || state.phase === 'verifying' || state.phase === 'installing') && <progress aria-label="正在处理" />}
      </div>
    </section>
    <footer className={css.actions}>
      {state.phase === 'available' && !state.required && availableVersion !== undefined && <button type="button" onClick={() =>{  execute(() => api.skip(availableVersion)) }}>跳过这个版本</button>}
      {state.canDownloadFullInstaller && <button type="button" onClick={() =>{  execute(() => api.fullInstaller()) }}>下载完整安装包</button>}
      <span />
      {state.phase === 'idle' || state.phase === 'error' || state.phase === 'unsupported'
        ? <button className={css.primary} type="button" onClick={() =>{  execute(() => api.checkStable()) }}>检查更新</button>
        : state.phase === 'available'
          ? <button className={css.primary} type="button" onClick={() =>{  execute(() => api.download()) }}>下载更新</button>
          : state.phase === 'ready'
            ? <button className={css.primary} type="button" onClick={() =>{  execute(() => api.install()) }}>立即安装</button>
            : <button type="button" onClick={() =>{  execute(() => api.close()) }} disabled={busy}>关闭</button>}
    </footer>
  </main>
}
