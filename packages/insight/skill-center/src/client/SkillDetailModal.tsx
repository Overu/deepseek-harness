/** Skill detail dialog using the shared modal behavior. */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button, IconCopyOutlineRegular, IconDownloadOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillCatalogItem } from './skill-catalog-resource.ts'
import type { SkillCenterLocaleKey } from './types.ts'
import styles from './SkillDetailModal.module.css'

/** Detail dialog inputs. */
export interface SkillDetailModalProps {
  readonly skill: SkillCatalogItem | null
  readonly t: (key: SkillCenterLocaleKey) => string
  readonly onClose: () => void
  readonly onCopy: (skill: SkillCatalogItem) => void
  readonly onDownload: () => void
}

/**
 * Render the selected skill's published description as plain text.
 * @param props - The selected skill, localized text, and user actions.
 * @returns the shared detail modal, or null without a selected skill.
 */
export function SkillDetailModal({ skill, t, onClose, onCopy, onDownload }: SkillDetailModalProps): ReactNode {
  if (skill === null) return null
  const paragraphs = descriptionParagraphs(skill.descriptionMarkdown)
  const name = skill.name
  return (
    <Modal open onClose={onClose} title={name} closeLabel={t('close')} backdropBlur={false}
      className={clsx(styles.modal)} contentClassName={clsx(styles.content)}>
      <p className={styles.summary}>{skill.summary}</p>
      <dl className={styles.meta}>
        <div><dt>{t('skillId')}</dt><dd>{skill.id}</dd></div>
        <div><dt>{t('version')}</dt><dd>{t('versionValue').replace('{version}', skill.version)}</dd></div>
      </dl>
      <section aria-labelledby="skill-detail-description">
        <h3 id="skill-detail-description" className={styles.descriptionTitle}>{t('description')}</h3>
        {paragraphs.length === 0
          ? <p className={styles.paragraph}>{t('noDescription')}</p>
          : paragraphs.map(paragraph => <p key={paragraph.id} className={styles.paragraph}>{paragraph.text}</p>)}
      </section>
      <div className={styles.actions}>
        <Button variant="outline" icon={<IconDownloadOutlineRegular size={16} />} onClick={onDownload}>{t('download')}</Button>
        <Button variant="primary" icon={<IconCopyOutlineRegular size={16} />} onClick={() => { onCopy(skill) }}>{t('copy')}</Button>
      </div>
    </Modal>
  )
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
