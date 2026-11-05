/** One-time configured platform-skill reconciliation after the catalogue settles. */
import { useEffect, useRef, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { skillCatalogAddress } from './skill-catalog-resource.ts'
import type { SkillInstallationController } from './skill-installation-controller.ts'
import { reconcilePresetSkills } from './skill-installation-controller.ts'
import type { PlatformSkillSnapshot, SkillIdentity } from '../shared/skill-installation.ts'

/** Root-owned calls used to establish current configured installation eligibility. */
export interface PresetSkillBootstrapInjected {
  readonly installations: SkillInstallationController
  readonly listPendingPresets: (this: void, catalogue: readonly SkillIdentity[]) => Promise<RemoteResult<readonly SkillIdentity[]>>
  readonly waitForInstallation: (this: void, identity: SkillIdentity) => Promise<RemoteResult<PlatformSkillSnapshot>>
}

/**
 * Start a configured queue exactly once once the normal catalogue resource has settled.
 * @param props - Root resource hook and registered Host methods.
 * @returns no visible element; the independent progress overlay presents active work.
 */
export function PresetSkillBootstrap({ useResource, installations, listPendingPresets, waitForInstallation }: PropsRuntime<'shell.overlay'>
  & InjectFace<PresetSkillBootstrapInjected>): ReactNode {
  const catalogue = useResource<'insight-skill-catalog'>(skillCatalogAddress(0))
  const started = useRef(false)
  useEffect(() => {
    if (started.current || catalogue.status === 'loading' || catalogue.status === 'none') return
    started.current = true
    if (catalogue.status !== 'live' || catalogue.value === undefined) {
      installations.reportFailure()
      return
    }
    void reconcilePresetSkills(installations, {
      pending: listPendingPresets,
      settled: waitForInstallation,
    }, catalogue.value).catch(() => { installations.reportFailure() })
  }, [catalogue.status, catalogue.value, installations, listPendingPresets, waitForInstallation])
  return null
}
