/** Blocking feedback while a platform skill is installed or updated. */
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PlatformSkillInstallProgress } from '../shared/skill-installation.ts'
import type { SkillCenterLocaleKey } from './types.ts'
import type { PresetInstallationProgress } from './skill-installation-controller.ts'
import styles from './SkillInstallProgressModal.module.css'

/** Inputs for one active platform-skill operation. */
export interface SkillInstallProgressModalProps {
  /** Aggregate progress keeps the same modal mounted between preset skills. */
  readonly presets?: PresetInstallationProgress
  /** Whether this operation replaces a previously installed version. */
  readonly updating: boolean
  /** Latest Host-reported phase. */
  readonly progress: PlatformSkillInstallProgress | null
  /** Whether cancellation has been requested and settlement is still pending. */
  readonly cancelling: boolean
  /** Whether the Host has accepted the operation and can cancel it. */
  readonly cancellable: boolean
  /** Localized copy resolver. */
  readonly t: (key: SkillCenterLocaleKey) => string
  /** Stop the operation before its Host-side commit. */
  readonly onCancel: () => void
}

/**
 * Prevent dismissal while the Host is deciding whether an installation committed.
 * @param props - Operation state and cancellation control.
 * @returns the blocking progress modal.
 */
export function SkillInstallProgressModal({
  updating, progress, cancelling, cancellable, presets, t, onCancel,
}: SkillInstallProgressModalProps): ReactNode {
  const phase = progress?.kind === 'progress' ? progress.phase : 'download'
  const loaded = progress?.kind === 'progress' && progress.phase === 'download' ? progress.receivedBytes : undefined
  const total = progress?.kind === 'progress' && progress.phase === 'download' ? progress.totalBytes : undefined
  const label = phase === 'download' ? t('installProgressDownload') : phase === 'validate' ? t('installProgressValidate') : t('installProgressCommit')
  const title = t(presets === undefined ? updating ? 'updating' : 'installing' : 'presetInstalling')
  return <Modal open headless onClose={() => {}} title={title} backdropBlur={false}
    className={styles.modal as string}>
    <section className={styles.body} aria-live="polite" aria-busy="true">
      <h2 className={styles.title}>{title}</h2>
      {presets === undefined ? null : <p className={styles.phase}>{presets.completed} / {presets.total}</p>}
      <p className={styles.phase}>{cancelling ? t('installCancelling') : label}</p>
      {loaded !== undefined && total !== undefined && total > 0
        ? <progress className={styles.progress} value={loaded} max={total}>{Math.round(loaded / total * 100)}%</progress>
        : <progress className={styles.progress} />}
    </section>
    <div className={styles.actions}>
      <Button variant="outline" disabled={cancelling || !cancellable} onClick={onCancel}>{t('installCancel')}</Button>
    </div>
  </Modal>
}
