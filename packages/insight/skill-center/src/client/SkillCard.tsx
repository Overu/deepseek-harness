/** A compact horizontal overview card for one skill. */
import type { ReactNode } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillPresentation } from './skill-presentation.ts'
import type { SkillCenterLocaleKey } from './types.ts'
import styles from './SkillCard.module.css'

/** The official-installation action shown on an official card. */
export type SkillCardState = 'install' | 'installed' | 'update' | 'loading' | 'conflict'

/** Inputs for one directory card. */
export interface SkillCardProps {
  readonly skill: SkillPresentation
  readonly source?: 'account' | 'shared' | undefined
  readonly t: (key: SkillCenterLocaleKey) => string
  readonly onDetail: () => void
  readonly state?: SkillCardState | undefined
  readonly onInstall?: (() => void) | undefined
}

/**
 * Render the skill's first display character, summary, and actions.
 * @param props - The displayed skill and its available action callbacks.
 * @returns the skill directory card.
 */
export function SkillCard({ skill, source, t, onDetail, state, onInstall }: SkillCardProps): ReactNode {
  const { name, version } = skill
  const detailLabel = t('detail').replace('{name}', name)
  const custom = source !== undefined
  const action = state === undefined ? undefined : t(state === 'loading' ? 'installStateLoading' : state === 'conflict' ? 'identityConflict' : state)
  const actionable = state === 'install' || state === 'update'
  return (
    <article className={styles.card}>
      <span className={styles.glyph} aria-hidden>{Array.from(name)[0]}</span>
      <div className={styles.copy}>
        <div className={styles.titleRow}>
          <h3 className={styles.heading} aria-label={name}>
            {custom
              ? <span className={styles.name}>{name}</span>
              : <Button variant="ghost" className={styles.detail} aria-haspopup="dialog"
                aria-label={detailLabel} onClick={onDetail}>{name}</Button>}
          </h3>
          {version !== undefined && <Tag tone="quiet" className={styles.version}>{t('versionValue').replace('{version}', version)}</Tag>}
        </div>
        <p className={styles.summary}>{skill.summary}</p>
      </div>
      {actionable && <Button className={styles.trailing} variant="primary" size="sm" onClick={onInstall}>{action}</Button>}
      {!actionable && action !== undefined && <Tag tone="neutral" className={styles.status}>{action}</Tag>}
      {custom && <Button variant="outline" size="sm" className={styles.detailAction} aria-haspopup="dialog"
        aria-label={detailLabel} onClick={onDetail}>{t('details')}</Button>}
    </article>
  )
}
