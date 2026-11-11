/** Skill detail dialog using the shared modal behavior. */
import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Button, IconCloseOutlineRegular, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillPresentation } from './skill-presentation.ts'
import type { SkillCenterLocaleKey } from './types.ts'
import cardStyles from './SkillCard.module.css'
import styles from './SkillDetailModal.module.css'

/** Detail dialog inputs. */
export interface SkillDetailModalProps {
  readonly skill: SkillPresentation
  readonly source?: 'account' | 'shared' | undefined
  readonly customRemovable: boolean
  readonly t: (key: SkillCenterLocaleKey) => string
  readonly onClose: () => void
  readonly state: 'install' | 'installed' | 'update' | 'loading' | 'conflict'
  readonly onInstall: (skill: SkillPresentation) => void
  readonly onRemove: () => Promise<boolean>
}

/**
 * Render the selected skill's published description as plain text.
 * @param props - The selected skill, localized text, and user actions.
 * @returns the shared detail modal and custom removal confirmation.
 */
export function SkillDetailModal({
  skill, source, customRemovable, t, onClose, state, onInstall, onRemove,
}: SkillDetailModalProps): ReactNode {
  const [confirmation, setConfirmation] = useState<'closed' | 'confirm' | 'removing' | 'failed'>('closed')
  const removing = confirmation === 'removing'
  const cancel = (): void => { if (!removing) setConfirmation('closed') }
  const confirm = async (): Promise<void> => {
    setConfirmation('removing')
    setConfirmation(await onRemove() ? 'closed' : 'failed')
  }
  const paragraphs = descriptionParagraphs(skill.descriptionMarkdown)
  const { name, version } = skill
  return (<>
    <Modal open headless onClose={onClose} title={name} className={clsx(styles.modal)}>
      <Button variant="ghost" size="sm" className={styles.close} aria-label={t('close')} onClick={onClose}>
        <IconCloseOutlineRegular size={16} />
      </Button>
      <div className={styles.content}>
        <div className={styles.intro}>
          <span className={clsx(cardStyles.glyph, styles.icon)} aria-hidden>{Array.from(name)[0]}</span>
          <div className={styles.titleRow}>
            <h2 className={styles.title}>{name}</h2>
            {version !== undefined && <Tag tone="quiet">{t('versionValue').replace('{version}', version)}</Tag>}
          </div>
          <p className={styles.summary}>{skill.summary}</p>
        </div>
        <section className={styles.instructions} aria-labelledby="skill-detail-description">
          <h3 id="skill-detail-description" className={styles.descriptionTitle}>{t(source === undefined ? 'usage' : 'description')}</h3>
          {paragraphs.length === 0
            ? <p className={styles.paragraph}>{t('noDescription')}</p>
            : paragraphs.map(paragraph => <p key={paragraph.id} className={styles.paragraph}>{paragraph.text}</p>)}
        </section>
      </div>
      {source === undefined && <div className={styles.actions}>
        {(state === 'installed' || state === 'update') && <Button variant="outline" onClick={() => { void onRemove() }}>{t('remove')}</Button>}
        {(state === 'install' || state === 'update') && <Button variant="primary" onClick={() => { onInstall(skill) }}>{t(state)}</Button>}
        {(state === 'loading' || state === 'conflict') && <Tag tone="neutral">{t(state === 'loading' ? 'installStateLoading' : 'identityConflict')}</Tag>}
      </div>}
      {source !== undefined && customRemovable && <div className={styles.actions}>
        <Button variant="outline" onClick={() => { setConfirmation('confirm') }}>{t('deleteCustom')}</Button>
      </div>}
    </Modal>
    <Modal open={confirmation !== 'closed'} onClose={cancel} title={t('deleteCustom')} closeLabel={t('close')}
      description={t('deleteCustomDescription').replace('{name}', name)}
      footer={<>
        <Button variant="outline" data-modal-autofocus disabled={removing} onClick={cancel}>{t('installCancel')}</Button>
        <Button variant="primary" disabled={removing} onClick={() => { void confirm() }}>{t(removing ? 'deletingCustom' : 'deleteCustom')}</Button>
      </>}>
      {confirmation === 'failed' && <p role="alert">{t('deleteCustomFailed')}</p>}
    </Modal>
  </>)
}

/** Drop the source's leading usage heading and retain readable Markdown text lines. */
function descriptionParagraphs(markdown: string): readonly { readonly id: string; readonly text: string }[] {
  const lines = markdown.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (/^#{1,6}\s+使用说明\s*$/.test(lines[0] ?? '')) lines.shift()
  const seen = new Map<string, number>()
  return lines.map((line) => {
    const text = line.replace(/^#{1,6}\s+/, '')
    const occurrence = seen.get(text) ?? 0
    seen.set(text, occurrence + 1)
    return { id: `${text}:${occurrence}`, text }
  })
}
