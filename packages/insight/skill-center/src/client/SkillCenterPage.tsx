/** Published and locally maintained skills rendered in the main content column. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { SegmentedTabs, type SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { InstalledPlatformSkill, PlatformSkillRemovalRequest, PlatformSkillSnapshot } from '../shared/skill-installation.ts'
import type { InsightCustomSkillEntry, InsightCustomSkillId } from '../shared/skill-inventory.ts'
import { SkillDetailModal } from './SkillDetailModal.tsx'
import { SkillDirectory, type ListedSkill } from './SkillDirectory.tsx'
import { SkillMarketHero } from './SkillMarketHero.tsx'
import type { SkillCenterToastSource } from './SkillCenterToast.tsx'
import type { SkillInstallationController } from './skill-installation-controller.ts'
import { skillCatalogAddress, type SkillCatalogItem } from './skill-catalog-resource.ts'
import { customSkillAddress } from './custom-skill-resource.ts'
import { platformSkillInstallationAddress } from './skill-installation-resource.ts'
import type { SkillCenterLocaleKey } from './types.ts'
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
    readonly removeCustom: (this: void, request: { readonly id: InsightCustomSkillId }) => Promise<RemoteResult<void>>
  }>

type SkillSource = 'official' | 'custom'

/**
 * Render published skills alongside the account's locally maintained skills.
 * @param props - The localized main-panel props and skill-management actions.
 * @returns the skill center page.
 */
export function SkillCenterPage({
  t, report, installations, remove, removeCustom, useResource, useRevision,
}: SkillCenterPageProps): ReactNode {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<SkillSource>('official')
  const [selected, setSelected] = useState<ListedSkill | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [customAttempt, setCustomAttempt] = useState(0)
  const [installationAttempt, setInstallationAttempt] = useState(0)
  const installationRevision = useRevision(value => value)
  const catalogue = useResource<'insight-skill-catalog'>(skillCatalogAddress(attempt))
  const installedResource = useResource<'insight-platform-skills'>(platformSkillInstallationAddress(installationRevision + installationAttempt))
  const custom = useResource<'insight-custom-skills'>(source === 'custom' ? customSkillAddress(customAttempt) : '')
  const text = (key: SkillCenterLocaleKey): string => t(key)
  const value = query.trim().toLocaleLowerCase('zh-CN')
  const catalogSkills = catalogue.value ?? []
  const installed = installedResource.value?.skills ?? []
  const allSkills: readonly ListedSkill[] = [
    ...catalogSkills.map(skill => ({ skill, catalog: skill, key: skill.id })),
    ...installed
      .filter(installedSkill => matchSkillIdentity(installedSkill, catalogSkills).kind !== 'match')
      .map((installedSkill) => {
        const skill = retiredCatalogItem(installedSkill, text('removedCatalogSkill'))
        return { skill, catalog: skill, key: `installed:${installedSkill.id}`, installationKey: installedSkill.id }
      }),
  ]
  const isOfficial = source === 'official'
  const visibleSkills = filtered(isOfficial ? allSkills : (custom.value?.entries ?? [])
    .toSorted((a, b) => a.name.localeCompare(b.name)).map(customListedSkill), value)
  const status = isOfficial ? catalogue.status : custom.value?.complete === false ? 'failed' : custom.status
  const selectedCurrent = selected !== null && selected.source === undefined
    ? allSkills.find(skill => skill.key === selected.key) ?? null
    : selected
  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(draft) }, 250)
    return () => { window.clearTimeout(timer) }
  }, [draft])
  const search = (event: FormEvent<HTMLFormElement>): void => { event.preventDefault(); setQuery(draft) }
  const stateOf = (listed: ListedSkill): 'install' | 'installed' | 'update' | 'loading' | 'conflict' => {
    if (installedResource.status !== 'live') return 'loading'
    if (listed.installationKey !== undefined) return 'installed'
    if (listed.catalog === undefined) return 'conflict'
    const matched = matchSkillIdentity(listed.catalog, installed)
    if (matched.kind === 'conflict') return 'conflict'
    if (matched.kind === 'missing') return 'install'
    return matched.value.version === listed.catalog.version ? 'installed' : 'update'
  }
  const startInstall = (listed: ListedSkill): void => {
    const state = stateOf(listed)
    if (state !== 'install' && state !== 'update') return
    if (listed.catalog !== undefined) void installations.install(listed.catalog, state === 'update')
  }
  const removeSkill = async (): Promise<boolean> => {
    if (selectedCurrent === null) return false
    try {
      if (selectedCurrent.source === undefined) {
        const direct = selectedCurrent.installationKey === undefined
          ? undefined : installed.find(skill => skill.id === selectedCurrent.installationKey)
        if (selectedCurrent.catalog === undefined) return false
        const resolved = direct === undefined ? matchSkillIdentity(selectedCurrent.catalog, installed) : { kind: 'match' as const, value: direct }
        if (resolved.kind !== 'match') return false
        const result = await remove({ id: resolved.value.id })
        if (!result.ok) throw new Error(result.error.message)
        setInstallationAttempt(current => current + 1)
      } else {
        if (selectedCurrent.customRemovalId === undefined) return false
        const result = await removeCustom({ id: selectedCurrent.customRemovalId })
        if (!result.ok) throw new Error(result.error.message)
        setCustomAttempt(current => current + 1)
      }
      setSelected(current => current?.key === selectedCurrent.key ? null : current)
      report('removeSuccess')
      return true
    } catch (_error) {
      if (selectedCurrent.source === undefined) report('removeFailure')
      else setCustomAttempt(current => current + 1)
      return false
    }
  }
  const tabs: readonly [SegmentedTab<SkillSource>, SegmentedTab<SkillSource>] = [
    { value: 'official', label: text('officialSkills'), id: 'skill-source-official', panelId: 'skill-source-official-panel' },
    { value: 'custom', label: text('customSkills'), id: 'skill-source-custom', panelId: 'skill-source-custom-panel' },
  ]
  return (
    <section className={styles.page} aria-label={text('title')}>
      <SkillMarketHero t={text} query={draft} onQueryChange={setDraft} onSearch={search} />
      <div className={styles.content}>
        <div className={styles.sourceBar}>
          <SegmentedTabs className={styles.sourceTabs} items={tabs} value={source} onChange={setSource} label={text('tabs')} />
          {status === 'live' && <p className={styles.count} aria-live="polite">{text('resultCount').replace('{count}', String(visibleSkills.length))}</p>}
        </div>
        {tabs.map(tab => (
          <div key={tab.value} id={tab.panelId} role="tabpanel" aria-labelledby={tab.id} hidden={source !== tab.value}>
            {source === tab.value && <SkillDirectory t={text} query={query} skills={visibleSkills} status={status}
              loadingLabel={text(isOfficial ? 'catalogLoading' : 'customSkillLoading')}
              failureLabel={text(isOfficial ? 'catalogLoadFailed' : 'customSkillLoadFailed')}
              emptyLabel={text(isOfficial ? 'catalogEmpty' : 'customSkillEmpty')}
              installationStatus={isOfficial ? installedResource.status : undefined} onDetail={setSelected}
              onRetry={() => { (isOfficial ? setAttempt : setCustomAttempt)(current => current + 1) }}
              onInstallationRetry={() => { setInstallationAttempt(current => current + 1) }}
              stateOf={isOfficial ? stateOf : undefined} onInstall={isOfficial ? startInstall : undefined} />}
          </div>
        ))}
      </div>
      {selectedCurrent !== null && <SkillDetailModal key={selectedCurrent.key} skill={selectedCurrent.skill} source={selectedCurrent.source}
        customRemovable={selectedCurrent.customRemovalId !== undefined} t={text} onClose={() => { setSelected(null) }}
        state={selectedCurrent.source === undefined ? stateOf(selectedCurrent) : 'installed'}
        onInstall={() => { if (selectedCurrent.source === undefined) startInstall(selectedCurrent) }} onRemove={removeSkill} />}
    </section>
  )
}

/** Filter a source list by technical name, display name, and compact summary. */
function filtered(skills: readonly ListedSkill[], query: string): readonly ListedSkill[] {
  return query === '' ? skills : skills.filter(({ skill }) => [skill.id, skill.name, skill.summary]
    .some(candidate => candidate.toLocaleLowerCase('zh-CN').includes(query)))
}

/** Present a local skill through the shared card and detail data model. */
function customListedSkill(entry: InsightCustomSkillEntry): ListedSkill {
  const name = entry.displayName ?? entry.name
  const summary = entry.shortDescription ?? entry.description
  return {
    key: entry.id,
    source: entry.origin,
    ...entry.removable ? { customRemovalId: entry.id } : {},
    skill: {
      id: entry.name,
      name,
      summary,
      descriptionMarkdown: entry.description,
    },
  }
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
