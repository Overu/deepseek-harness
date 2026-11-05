/** Published skill catalogue rendered in the main content column. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import { SkillDetailModal } from './SkillDetailModal.tsx'
import { SkillDirectory } from './SkillDirectory.tsx'
import { SkillMarketHero } from './SkillMarketHero.tsx'
import type { SkillCenterToastSource } from './SkillCenterToast.tsx'
import { skillCatalogAddress, type SkillCatalogItem } from './skill-catalog-resource.ts'
import type { SkillCenterLocaleKey } from './types.ts'
import styles from './SkillCenterPage.module.css'

type SkillCenterPageProps = PropsRuntime<'main'> & PropsLocale<'insight.skillCenter'>
  & InjectFace<Pick<SkillCenterToastSource, 'report'>>

/**
 * Render the published catalogue with local filtering and demonstration actions.
 * @param props - The localized main-panel props and feedback report action.
 * @returns the skill catalogue page.
 */
export function SkillCenterPage({ t, report, useResource }: SkillCenterPageProps): ReactNode {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<SkillCatalogItem['id'] | null>(null)
  const [attempt, setAttempt] = useState(0)
  const catalogue = useResource<'insight-skill-catalog'>(skillCatalogAddress(attempt))
  const text = (key: SkillCenterLocaleKey): string => t(key)
  const value = query.trim().toLocaleLowerCase('zh-CN')
  const allSkills = catalogue.value ?? []
  const skills = value === '' ? allSkills : allSkills.filter(skill => [skill.id, skill.name, skill.summary]
    .some(candidate => candidate.toLocaleLowerCase('zh-CN').includes(value)))
  const selected = allSkills.find(skill => skill.id === selectedId) ?? null
  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(draft) }, 250)
    return () => { window.clearTimeout(timer) }
  }, [draft])
  const search = (event: FormEvent<HTMLFormElement>): void => { event.preventDefault(); setQuery(draft) }
  const copy = async (skill: SkillCatalogItem): Promise<void> => {
    const instruction = text('installInstruction').replace('{name}', skill.name).replace('{id}', skill.id)
    try {
      await navigator.clipboard.writeText(instruction)
    } catch (error) {
      // Clipboard access can be denied without changing any page state.
      void error
      report('copyFailure')
      return
    }
    report('copySuccess')
  }
  return (
    <section className={styles.page} aria-label={text('title')}>
      <SkillMarketHero t={text} query={draft} onQueryChange={setDraft} onSearch={search} />
      <SkillDirectory t={text} query={query} skills={skills} status={catalogue.status} onDetail={(skill) => { setSelectedId(skill.id) }}
        onRetry={() => { setAttempt(current => current + 1) }}
        onCopy={(skill) => { void copy(skill) }} onDownload={() => { report('downloadNotice') }} />
      <SkillDetailModal skill={selected} t={text} onClose={() => { setSelectedId(null) }} onCopy={(skill) => { void copy(skill) }} onDownload={() => { report('downloadNotice') }} />
    </section>
  )
}
