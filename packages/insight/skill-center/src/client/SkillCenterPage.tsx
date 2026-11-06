/** Published skill catalogue rendered in the main content column. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { SkillDetailModal } from './SkillDetailModal.tsx'
import { SkillDirectory, type ListedSkill } from './SkillDirectory.tsx'
import { SkillMarketHero } from './SkillMarketHero.tsx'
import type { SkillCenterToastSource } from './SkillCenterToast.tsx'
import type { SkillInstallationController } from './skill-installation-controller.ts'
import { skillCatalogAddress, type SkillCatalogItem } from './skill-catalog-resource.ts'
import { platformSkillInstallationAddress } from './skill-installation-resource.ts'
import type { SkillCenterLocaleKey } from './types.ts'
import type {
  InstalledPlatformSkill, PlatformSkillRemovalRequest, PlatformSkillSnapshot,
} from '../shared/skill-installation.ts'
import { matchSkillIdentity } from '../shared/skill-identity.ts'
import styles from './SkillCenterPage.module.css'

type SkillCenterPageProps = PropsRuntime<'main'> & PropsLocale<'insight.skillCenter'>
  & InjectFace<Pick<SkillCenterToastSource, 'report'> & {
    readonly installations: SkillInstallationController
    readonly hooks: Pick<SkillInstallationController['hooks'], 'revision'>
    readonly remove: (
      this: void,
      request: PlatformSkillRemovalRequest,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<PlatformSkillSnapshot>>
  }>

/**
 * Render the published catalogue with local filtering and platform-skill actions.
 * @param props - The localized main-panel props and feedback report action.
 * @returns the skill catalogue page.
 */
export function SkillCenterPage({ t, report, installations, remove, useResource, useRevision }: SkillCenterPageProps): ReactNode {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [installationAttempt, setInstallationAttempt] = useState(0)
  const installationRevision = useRevision(value => value)
  const catalogue = useResource<'insight-skill-catalog'>(skillCatalogAddress(attempt))
  const installedResource = useResource<'insight-platform-skills'>(platformSkillInstallationAddress(installationRevision + installationAttempt))
  const text = (key: SkillCenterLocaleKey): string => t(key)
  const value = query.trim().toLocaleLowerCase('zh-CN')
  const catalogSkills = catalogue.value ?? []
  const installed = installedResource.value?.skills ?? []
  const allSkills: readonly ListedSkill[] = [
    ...catalogSkills.map(skill => ({ skill, key: skill.id })),
    ...installed
      .filter(installedSkill => matchSkillIdentity(installedSkill, catalogSkills).kind !== 'match')
      .map(installedSkill => ({
        skill: retiredCatalogItem(installedSkill, text('removedCatalogSkill')),
        key: `installed:${installedSkill.id}`,
        installationKey: installedSkill.id,
      })),
  ]
  const skills = value === '' ? allSkills : allSkills.filter(({ skill }) => [skill.id, skill.name, skill.summary]
    .some(candidate => candidate.toLocaleLowerCase('zh-CN').includes(value)))
  const selected = allSkills.find(skill => skill.key === selectedKey) ?? null
  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(draft) }, 250)
    return () => { window.clearTimeout(timer) }
  }, [draft])
  const search = (event: FormEvent<HTMLFormElement>): void => { event.preventDefault(); setQuery(draft) }
  const stateOf = (listed: ListedSkill): 'install' | 'installed' | 'update' | 'loading' | 'conflict' => {
    if (installedResource.status !== 'live') return 'loading'
    if (listed.installationKey !== undefined) return 'installed'
    const skill = listed.skill
    const matched = matchSkillIdentity(skill, installed)
    if (matched.kind === 'conflict') return 'conflict'
    if (matched.kind === 'missing') return 'install'
    return matched.value.version === skill.version ? 'installed' : 'update'
  }
  const startInstall = (listed: ListedSkill): void => {
    const state = stateOf(listed)
    if (state !== 'install' && state !== 'update') return
    const skill = listed.skill
    void installations.install(skill, state === 'update')
  }
  const removeSkill = async (listed: ListedSkill): Promise<void> => {
    const direct = listed.installationKey === undefined ? undefined : installed.find(skill => skill.id === listed.installationKey)
    const resolved = direct === undefined ? matchSkillIdentity(listed.skill, installed) : { kind: 'match' as const, value: direct }
    if (resolved.kind !== 'match') return
    const matched = resolved.value
    try {
      const result = await remove({ id: matched.id })
      if (!result.ok) throw new Error(result.error.message)
      setInstallationAttempt(current => current + 1)
      setSelectedKey(null)
      report('removeSuccess')
    } catch (_error) {
      report('removeFailure')
      return
    }
  }
  return (
    <section className={styles.page} aria-label={text('title')}>
      <SkillMarketHero t={text} query={draft} onQueryChange={setDraft} onSearch={search} />
      <SkillDirectory t={text} query={query} skills={skills} status={catalogue.status}
        installationStatus={installedResource.status} onDetail={(skill) => { setSelectedKey(skill.key) }}
        onRetry={() => { setAttempt(current => current + 1) }}
        onInstallationRetry={() => { setInstallationAttempt(current => current + 1) }}
        stateOf={stateOf} onInstall={startInstall} />
      <SkillDetailModal skill={selected?.skill ?? null} t={text} onClose={() => { setSelectedKey(null) }} state={selected === null ? 'install' : stateOf(selected)} onInstall={() => { if (selected !== null) startInstall(selected) }} onRemove={() => { if (selected !== null) void removeSkill(selected) }} />
    </section>
  )
}

/** Represent an installed skill removed from the currently published catalogue. */
function retiredCatalogItem(skill: InstalledPlatformSkill, removedMessage: string): SkillCatalogItem {
  return {
    id: skill.id,
    name: skill.id,
    summary: removedMessage,
    version: skill.version,
    descriptionMarkdown: removedMessage,
    downloadUrl: '',
  }
}
