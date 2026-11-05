/** A compact overview card for one published skill. */
import type { ReactNode } from 'react'
import { Button, IconCopyOutlineRegular, IconDownloadOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillCatalogItem } from './skill-catalog-resource.ts'
import type { SkillCenterLocaleKey } from './types.ts'
import styles from './SkillCard.module.css'

/** Inputs for one catalogue card. */
export interface SkillCardProps {
  readonly skill: SkillCatalogItem
  readonly t: (key: SkillCenterLocaleKey) => string
  readonly onDetail: (skill: SkillCatalogItem) => void
  readonly onCopy: (skill: SkillCatalogItem) => void
  readonly onDownload: () => void
}

/**
 * Render a skill card with secondary exploration and primary copy actions.
 * @param props - The skill, localized text, and card actions.
 * @returns the skill's catalogue card.
 */
export function SkillCard({ skill, t, onDetail, onCopy, onDownload }: SkillCardProps): ReactNode {
  const { name } = skill
  return (
    <article className={styles.card}>
      <div className={styles.top}>
        <span className={styles.glyph} aria-hidden>{Array.from(name)[0]}</span>
        <h3 className={styles.name}>{name}</h3>
        <span className={styles.version}>{t('versionValue').replace('{version}', skill.version)}</span>
      </div>
      <p className={styles.summary}>{skill.summary}</p>
      <div className={styles.actions}>
        <div className={styles.secondary}>
          <Button variant="ghost" size="sm" onClick={() => { onDetail(skill) }}>{t('detail')}</Button>
          <Button variant="ghost" size="sm" icon={<IconDownloadOutlineRegular size={14} />} onClick={onDownload}>{t('download')}</Button>
        </div>
        <Button variant="primary" size="sm" icon={<IconCopyOutlineRegular size={14} />} onClick={() => { onCopy(skill) }}>{t('copy')}</Button>
      </div>
    </article>
  )
}
