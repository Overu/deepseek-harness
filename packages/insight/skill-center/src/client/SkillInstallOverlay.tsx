/** Root overlay retaining platform-skill installation progress across navigation. */
import type { ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { SkillInstallProgressModal } from './SkillInstallProgressModal.tsx'
import type { SkillInstallationController, SkillInstallationView } from './skill-installation-controller.ts'

/** Props injected by the root skill-center client registration. */
export type SkillInstallOverlayInjected = Pick<SkillInstallationController, 'cancel'> & {
  readonly hooks: { readonly active: HostObservable<SkillInstallationView | null> }
}

/** Render the active root-owned installation, if any. */
export function SkillInstallOverlay({ useActive, cancel, t }: PropsRuntime<'shell.overlay'>
  & PropsLocale<'insight.skillCenter'> & InjectFace<SkillInstallOverlayInjected>): ReactNode {
  const active = useActive(value => value)
  if (active === null) return null
  return <SkillInstallProgressModal updating={active.updating} progress={active.progress}
    cancelling={active.cancelling} cancellable={active.admitted} t={t} onCancel={cancel} />
}
