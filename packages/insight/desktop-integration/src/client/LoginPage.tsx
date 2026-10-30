/** Insight's standalone desktop sign-in surface. */
import { useEffect, useState, type FormEvent } from 'react'
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CaptchaView } from '../shared/auth-contracts.ts'
import type { InsightLoginApi, InsightLoginState } from '../shared/desktop-api.ts'
import css from './login.module.css'
import { LoginDotGrid } from './LoginDotGrid.tsx'
import { LegalDocumentDialog } from './LegalDocumentDialog.tsx'

type LoginMethod = 'sms' | 'password'

/** Inputs required to construct the native Insight login view. */
export interface LoginPageProps {
  api: InsightLoginApi
  logoUrl: string
  /** Reviewed static HTML shipped with this exact product build. */
  legalDocuments: Readonly<Record<'service' | 'privacy', string>>
}

function validPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/u.test(phone)
}

function initialState(): InsightLoginState {
  return { session: { kind: 'restoring' }, workspace: { kind: 'idle' } }
}

function sessionMessage(state: InsightLoginState): string | undefined {
  if (state.workspace.kind === 'migration-required') return '检测到历史工作区，数据已安全保留。完成迁移后才能进入工作区'
  if (state.workspace.kind === 'failed') return state.workspace.message
  if (state.session.kind === 'offline') return '暂时无法连接登录服务，请检查网络后重试'
  if (state.session.kind === 'expired') return '登录已失效，请重新登录'
  return undefined
}

/**
 * Render SMS and password login without direct access to Electron or credentials.
 * @param props - Isolated renderer bridge and Main-provided brand artwork URL.
 * @returns the complete sign-in or migration gate page.
 */
export function LoginPage({ api, logoUrl, legalDocuments }: LoginPageProps) {
  const [state, setState] = useState<InsightLoginState>(initialState)
  const [method, setMethod] = useState<LoginMethod>('sms')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [imageCode, setImageCode] = useState('')
  const [captcha, setCaptcha] = useState<CaptchaView>()
  const [agreed, setAgreed] = useState(false)
  const [legalDocument, setLegalDocument] = useState<'service' | 'privacy'>()
  const [notice, setNotice] = useState<string>()
  const [countdown, setCountdown] = useState(0)
  const [captchaLoading, setCaptchaLoading] = useState(false)

  useEffect(() => {
    let live = true
    void api.current().then(
      (value) => { if (live) setState(value) },
      () => { if (live) setNotice('无法读取登录状态，请重试') },
    )
    const dispose = api.subscribe((value) => { if (live) setState(value) })
    return () => { live = false; dispose() }
  }, [api])

  useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setInterval(() =>{  setCountdown(value => Math.max(0, value - 1)) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [countdown])

  const loadCaptcha = async (): Promise<void> => {
    setCaptchaLoading(true)
    setNotice(undefined)
    try {
      const result = await api.captcha()
      if (result.ok) {
        setCaptcha(result.captcha)
        setImageCode('')
      } else {
        setNotice(result.message)
      }
    } catch {
      setNotice('无法加载图形验证码，请重试')
    } finally {
      setCaptchaLoading(false)
    }
  }

  useEffect(() => {
    if (method === 'password' && captcha === undefined) void loadCaptcha()
  // The captcha is intentionally loaded only when entering the password form.
  }, [method])

  const busy = state.session.kind === 'restoring' || state.session.kind === 'authenticating' || state.workspace.kind === 'preparing'
  const message = notice ?? sessionMessage(state)

  const sendCode = async (): Promise<void> => {
    if (!validPhone(phone) || countdown > 0 || busy) return
    setNotice(undefined)
    try {
      const result = await api.sendSmsCode(phone)
      if (result.ok) setCountdown(60)
      else setNotice(result.message)
    } catch {
      setNotice('验证码发送失败，请重试')
    }
  }

  const submitSms = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!validPhone(phone) || !code || !agreed || busy) return
    setNotice(undefined)
    try {
      const result = await api.loginSms({ phone, code }, agreed)
      if (!result.ok) setNotice(result.message)
    } catch {
      setNotice('登录失败，请重试')
    }
  }

  const submitPassword = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!validPhone(phone) || !password || !imageCode || !captcha || !agreed || busy) return
    setNotice(undefined)
    try {
      const result = await api.loginPassword({ phone, password, uuid: captcha.uuid, imageCode }, agreed)
      if (!result.ok) {
        setNotice(result.message)
        void loadCaptcha()
      }
    } catch {
      setNotice('登录失败，请重试')
      void loadCaptcha()
    }
  }

  const resetLocal = async (): Promise<void> => {
    try {
      await api.resetLocal()
    } catch {
      setNotice('无法清除本地登录状态，请稍后重试')
    }
  }

  if (state.workspace.kind === 'migration-required') {
    return <AccountHomeGate api={api} logoUrl={logoUrl} title="历史工作区等待迁移"
      message="已保留你的历史对话、工作区、插件和配置。迁移尚未完成，因此不会创建空工作区或覆盖已有数据。"
      detail="请完成迁移后再进入工作区。你可以退出后使用其他账号重新登录。" />
  }

  if (state.workspace.kind === 'failed') {
    return <AccountHomeGate api={api} logoUrl={logoUrl} title="无法准备工作区" message={state.workspace.message}
      detail="请检查本机账号数据的访问权限后退出并重新登录。" />
  }

  return (
    <main className={css.page} data-platform={navigator.platform.toLowerCase().includes('mac') ? 'darwin' : undefined}>
      <LoginDotGrid />
      <section className={css.visual} aria-label="因赛AI">
        <header className={css.brand}>
          <img className={css.logo} src={logoUrl} alt="因赛AI" />
          <strong>因赛AI</strong>
        </header>
        <div className={css.slogan}><p>以专业为引擎</p><p>让团队与 AI 共成长</p></div>
      </section>
      <section className={css.panel}>
        <div className={css.card} aria-label="因赛AI 登录">
          <header className={css.formHeader}><h1>欢迎登录</h1></header>
          <div className={css.tabs} role="tablist" aria-label="登录方式">
            <Button role="tab" size="sm" variant={method === 'sms' ? 'outline' : 'ghost'} aria-selected={method === 'sms'}
              onClick={() =>{  setMethod('sms') }}>验证码登录</Button>
            <Button role="tab" size="sm" variant={method === 'password' ? 'outline' : 'ghost'} aria-selected={method === 'password'}
              onClick={() =>{  setMethod('password') }}>密码登录</Button>
          </div>
          {method === 'sms' ? (
            <form className={css.form} onSubmit={event => void submitSms(event)}>
              <label>手机号<Input className={css.textField as string} inputMode="numeric" autoComplete="tel" maxLength={11} value={phone}
                onChange={(event) =>{  setPhone(event.target.value.replace(/\D/gu, '')) }} placeholder="请输入手机号" /></label>
              <label>验证码<span className={css.codeField}><Input className={css.textField as string} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                onChange={(event) =>{  setCode(event.target.value.replace(/\D/gu, '')) }} placeholder="请输入验证码" />
              <Button size="sm" variant="ghost" disabled={!validPhone(phone) || countdown > 0 || busy} onClick={() => void sendCode()}>
                {countdown > 0 ? `${countdown} 秒后重试` : '获取验证码'}
              </Button></span></label>
              <Agreement agreed={agreed} setAgreed={setAgreed} onOpen={setLegalDocument} disabled={busy} />
              <Button type="submit" variant="primary" disabled={!validPhone(phone) || !code || !agreed || busy}>{busy ? '正在登录…' : '登录'}</Button>
            </form>
          ) : (
            <form className={css.form} onSubmit={event => void submitPassword(event)}>
              <label>手机号<Input className={css.textField as string} inputMode="numeric" autoComplete="tel" maxLength={11} value={phone}
                onChange={(event) =>{  setPhone(event.target.value.replace(/\D/gu, '')) }} placeholder="请输入手机号" /></label>
              <label>密码<Input className={css.textField as string} type="password" autoComplete="current-password" value={password}
                onChange={(event) =>{  setPassword(event.target.value) }} placeholder="请输入密码" /></label>
              <label>图形验证码<span className={css.captchaField}><Input className={css.textField as string} value={imageCode}
                onChange={(event) =>{  setImageCode(event.target.value) }} placeholder="请输入图形验证码" />
              {captcha ? <button className={css.captcha} type="button" onClick={() => void loadCaptcha()} aria-label="刷新图形验证码"><img src={captcha.image} alt="图形验证码" /></button>
                : <Button size="sm" variant="ghost" disabled={captchaLoading} onClick={() => void loadCaptcha()}>{captchaLoading ? '加载中…' : '重新加载'}</Button>}
              </span></label>
              <Agreement agreed={agreed} setAgreed={setAgreed} onOpen={setLegalDocument} disabled={busy} />
              <Button type="submit" variant="primary" disabled={!validPhone(phone) || !password || !imageCode || !captcha || !agreed || busy}>{busy ? '正在登录…' : '登录'}</Button>
            </form>
          )}
          <p className={css.notice} role="status">{message}</p>
          {state.session.kind === 'offline' && <Button size="sm" variant="ghost" onClick={() => void resetLocal()}>清除本地登录状态</Button>}
        </div>
      </section>
      {legalDocument === undefined ? null : <LegalDocumentDialog
        title={legalDocument === 'service' ? '软件许可及服务协议' : '隐私政策'}
        html={legalDocuments[legalDocument]} onClose={() => { setLegalDocument(undefined) }} />}
    </main>
  )
}

function Agreement({ agreed, setAgreed, onOpen, disabled }: {
  agreed: boolean
  setAgreed: (value: boolean) => void
  onOpen: (kind: 'service' | 'privacy') => void
  disabled: boolean
}) {
  return <div className={css.agreement}>
    <Checkbox checked={agreed} onChange={setAgreed} disabled={disabled} label="我已阅读" />
    <Button size="sm" variant="ghost" disabled={disabled} aria-haspopup="dialog" onClick={() => { onOpen('service') }}>软件许可及服务协议</Button>
    <span>和</span>
    <Button size="sm" variant="ghost" disabled={disabled} aria-haspopup="dialog" onClick={() => { onOpen('privacy') }}>隐私政策</Button>
  </div>
}

function AccountHomeGate({ api, logoUrl, title, message, detail }: Pick<LoginPageProps, 'api' | 'logoUrl'> & {
  title: string
  message: string
  detail: string
}) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string>()
  const signOut = async (): Promise<void> => {
    setBusy(true)
    try { await api.signOut() } catch { setNotice('退出失败，请稍后重试') } finally { setBusy(false) }
  }
  return <main className={css.page} data-platform={navigator.platform.toLowerCase().includes('mac') ? 'darwin' : undefined}>
    <LoginDotGrid />
    <section className={css.gateCard} aria-labelledby="account-home-title">
      <header className={css.brand}><img className={css.logo} src={logoUrl} alt="因赛AI" /><div><h1 id="account-home-title">{title}</h1></div></header>
      <p className={css.migrationCopy}>{message}</p>
      <p className={css.migrationCopy}>{detail}</p>
      <Button variant="outline" disabled={busy} onClick={() => void signOut()}>{busy ? '正在退出…' : '退出并重新登录'}</Button>
      {notice && <p className={css.notice} role="status">{notice}</p>}
    </section>
  </main>
}
