/** Insight product information rendered in the shared settings shell. */
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InsightAccountSnapshot } from './account-source.ts'
import css from './AccountSettings.module.css'

/** Main-owned product facts supplied to the settings section. */
export interface InsightAccountSettingsInjected {
  hooks: { account: { getSnapshot(): InsightAccountSnapshot; subscribe(listener: () => void): () => void } }
}

/** Settings section props composed by the DSH settings shell. */
export type InsightAccountSettingsProps = PropsRuntime<'settings.section'>
  & InjectFace<InsightAccountSettingsInjected>

/** Render non-sensitive product and account facts in the standard settings panel. */
export function InsightAccountSettings({ useAccount }: InsightAccountSettingsProps) {
  const { summary, info } = useAccount(snapshot => snapshot)
  return <section className={css.root} aria-labelledby="insight-product-settings-title">
    <h2 id="insight-product-settings-title">因赛AI</h2>
    <dl>
      <div><dt>账号</dt><dd>{summary?.displayName || summary?.maskedPhone || '—'}</dd></div>
      {summary?.maskedPhone && <div><dt>手机号</dt><dd>{summary.maskedPhone}</dd></div>}
      <div><dt>客户端版本</dt><dd>{info?.productVersion ?? '—'}</dd></div>
      <div><dt>服务环境</dt><dd>{info?.environment === 'test' ? '测试环境' : info?.environment === 'production' ? '生产环境' : '—'}</dd></div>
      <div><dt>平台</dt><dd>{info?.platform ?? '—'}</dd></div>
    </dl>
    <p>客户端更新将在后续版本提供</p>
  </section>
}
