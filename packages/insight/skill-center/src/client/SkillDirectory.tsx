/** Directory heading, empty state, and skill card grid. */
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ResourceStatus } from '@deepseek-ai/dsh-client-resources/client'
import { SkillCard } from './SkillCard.tsx'
import type { SkillCatalogItem } from './skill-catalog-resource.ts'
import type { SkillCenterTranslate } from './types.ts'

/** One catalogue or independently removable local skill row. */
export interface ListedSkill {
  readonly skill: SkillCatalogItem
  readonly key: string
  readonly installationKey?: string
}
import styles from './SkillCenterPage.module.css'

/** Inputs for the catalogue directory. */
interface SkillDirectoryProps {
  readonly t: SkillCenterTranslate
  readonly query: string
  readonly skills: readonly ListedSkill[]
  readonly status: ResourceStatus
  readonly installationStatus: ResourceStatus
  readonly onDetail: (skill: ListedSkill) => void
  readonly stateOf: (skill: ListedSkill) => 'install' | 'installed' | 'update' | 'loading' | 'conflict'
  readonly onInstall: (skill: ListedSkill) => void
  readonly onRetry: () => void
  readonly onInstallationRetry: () => void
}

/**
 * Render the visible skill count and a responsive set of cards.
 * @param props - Filtered skills, localized copy, and actions.
 * @returns the catalogue directory.
 */
export function SkillDirectory({
  t, query, skills, status, installationStatus, onDetail, stateOf, onInstall, onRetry, onInstallationRetry,
}: SkillDirectoryProps): ReactNode {
  return (
    <div className={styles.content}>
      <header className={styles.directoryHeader}>
        <div><p className={styles.directoryEyebrow}>{t('directoryEyebrow')}</p><h2>{t('directoryTitle')}</h2></div>
        {status === 'live' && <p className={styles.count} aria-live="polite">
          {t('resultCount').replace('{count}', String(skills.length))}
        </p>}
      </header>
      {installationStatus === 'failed' && <div className={styles.empty} role="status"><p>{t('installStateLoadFailed')}</p><Button variant="outline" size="sm" onClick={onInstallationRetry}>{t('retry')}</Button></div>}
      {status === 'failed' && skills.length > 0 && <div className={styles.empty} role="status"><p>{t('catalogLoadFailed')}</p><Button variant="outline" size="sm" onClick={onRetry}>{t('retry')}</Button></div>}
      {status === 'loading'
        ? <div className={styles.grid} aria-busy="true" aria-label={t('catalogLoading')}>
          <p className={styles.srOnly} role="status">{t('catalogLoading')}</p>
          {[0, 1, 2].map(slot => <div key={`catalogue-loading-${slot}`} className={styles.skeleton} aria-hidden />)}
        </div>
        : status === 'failed' && skills.length === 0
          ? <div className={styles.empty} role="status"><p>{t('catalogLoadFailed')}</p><Button variant="outline" size="sm" onClick={onRetry}>{t('retry')}</Button></div>
          : skills.length === 0
            ? <p className={styles.empty} role="status">{query.trim() === '' ? t('catalogEmpty') : t('noResults').replace('{query}', query)}</p>
            : <div className={styles.grid}>{skills.map(skill => (
              <SkillCard
                key={skill.key}
                skill={skill.skill}
                t={t}
                onDetail={() => { onDetail(skill) }}
                state={stateOf(skill)}
                onInstall={() => { onInstall(skill) }}
              />
            ))}</div>}
    </div>
  )
}
