/** Feedback states and the active skill-card grid. */
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ResourceStatus } from '@deepseek-ai/dsh-client-resources/client'
import type { InsightCustomSkillId } from '../shared/skill-inventory.ts'
import { SkillCard, type SkillCardState } from './SkillCard.tsx'
import type { SkillCatalogItem } from './skill-catalog-resource.ts'
import type { SkillPresentation } from './skill-presentation.ts'
import type { SkillCenterTranslate } from './types.ts'
import styles from './SkillCenterPage.module.css'

/** One official or locally maintained skill ready for card and detail rendering. */
export interface ListedSkill {
  readonly key: string
  readonly skill: SkillPresentation
  readonly catalog?: SkillCatalogItem
  readonly source?: 'account' | 'shared'
  readonly customRemovalId?: InsightCustomSkillId
  readonly installationKey?: string
}

/** Inputs for the active directory panel. */
interface SkillDirectoryProps {
  readonly t: SkillCenterTranslate
  readonly query: string
  readonly skills: readonly ListedSkill[]
  readonly status: ResourceStatus
  readonly loadingLabel: string
  readonly failureLabel: string
  readonly emptyLabel: string
  readonly installationStatus?: ResourceStatus | undefined
  readonly onDetail: (skill: ListedSkill) => void
  readonly stateOf?: ((skill: ListedSkill) => SkillCardState) | undefined
  readonly onInstall?: ((skill: ListedSkill) => void) | undefined
  readonly onRetry: () => void
  readonly onInstallationRetry?: (() => void) | undefined
}

/**
 * Render the active source's recovery states and skills.
 * @param props - The source-specific items, status, and controls.
 * @returns the active source directory.
 */
export function SkillDirectory({
  t, query, skills, status, loadingLabel, failureLabel, emptyLabel, installationStatus,
  onDetail, stateOf, onInstall, onRetry, onInstallationRetry,
}: SkillDirectoryProps): ReactNode {
  const retryInstallation = installationStatus === 'failed' && onInstallationRetry !== undefined
  return (
    <>
      {retryInstallation && <div className={styles.empty} role="status"><p>{t('installStateLoadFailed')}</p><Button variant="outline" size="sm" onClick={onInstallationRetry}>{t('retry')}</Button></div>}
      {status === 'failed' && skills.length > 0 && <div className={styles.empty} role="status"><p>{failureLabel}</p><Button variant="outline" size="sm" onClick={onRetry}>{t('retry')}</Button></div>}
      {status === 'loading'
        ? <div className={styles.grid} aria-busy="true" aria-label={loadingLabel}>
          <p className={styles.srOnly} role="status">{loadingLabel}</p>
          {[0, 1, 2, 3].map(slot => <div key={`skill-directory-loading-${slot}`} className={styles.skeleton} aria-hidden />)}
        </div>
        : status === 'failed' && skills.length === 0
          ? <div className={styles.empty} role="status"><p>{failureLabel}</p><Button variant="outline" size="sm" onClick={onRetry}>{t('retry')}</Button></div>
          : skills.length === 0
            ? <p className={styles.empty} role="status">{query.trim() === '' ? emptyLabel : t('noResults').replace('{query}', query)}</p>
            : <div className={styles.grid}>{skills.map(skill => (
              <SkillCard
                key={skill.key}
                skill={skill.skill}
                source={skill.source}
                t={t}
                onDetail={() => { onDetail(skill) }}
                state={stateOf?.(skill)}
                onInstall={onInstall === undefined ? undefined : () => { onInstall(skill) }}
              />
            ))}</div>}
    </>
  )
}
