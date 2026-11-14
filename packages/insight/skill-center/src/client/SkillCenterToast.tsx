/** Shared feedback for actions started from the skill center page. */
import type { ReactNode } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

type NoticeKind = 'installSuccess' | 'updateSuccess' | 'removeSuccess' | 'installFailure' | 'removeFailure'
  | 'presetSuccess' | 'presetFailure' | 'presetCancelled'
type Notice = { readonly kind: NoticeKind; readonly sequence: number }

/** The narrow actions page controls use to report a settled outcome. */
export interface SkillCenterToastSource {
  readonly hooks: { readonly notice: HostObservable<Notice | null> }
  readonly report: (kind: NoticeKind) => void
  readonly dismiss: () => void
}

/**
 * Create a page-independent feedback source for the overlay host.
 * @returns the observable notice and report actions shared by the page and overlay.
 */
export function createSkillCenterToastSource(): SkillCenterToastSource {
  const store = createSnapshotStore<Notice | null>(null)
  let sequence = 0
  return {
    hooks: { notice: store },
    report: (kind) => { store.set({ kind, sequence: ++sequence }) },
    dismiss: () => { store.set(null) },
  }
}

/** Props for the root overlay feedback entry. */
export type SkillCenterToastProps = PropsRuntime<'shell.overlay'>
  & PropsLocale<'insight.skillCenter'>
  & InjectFace<Omit<SkillCenterToastSource, 'report'>>

/**
 * Render the latest action result outside the main panel's lifecycle.
 * @param props - The current notice hook, dismiss action, and localized copy.
 * @returns the current toast, or null while no notice is pending.
 */
export function SkillCenterToast({ useNotice, dismiss, t }: SkillCenterToastProps): ReactNode {
  const notice = useNotice(current => current)
  if (notice === null) return null
  const text = t(notice.kind)
  return notice.kind === 'installSuccess' || notice.kind === 'updateSuccess' || notice.kind === 'removeSuccess' || notice.kind === 'presetSuccess'
    ? <Toast key={`skill-center-${String(notice.sequence)}`} text={text} tone="success" onDone={dismiss} />
    : <Toast key={`skill-center-${String(notice.sequence)}`} text={text} icon={<IconWarningOutlineRegular />} onDone={dismiss} />
}
