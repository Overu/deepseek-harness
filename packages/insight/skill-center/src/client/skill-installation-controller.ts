/** Shared lifetime for manual and configured platform-skill installations. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult, RemoteStreamHandle } from '@deepseek-ai/dsh-typert-protocol'
import type { SkillCatalogItem } from './skill-catalog-resource.ts'
import type { SkillCenterToastSource } from './SkillCenterToast.tsx'
import type {
  PlatformSkillInstallProgress, PlatformSkillInstallRequest, PlatformSkillOperationId,
  PlatformSkillOperationSettlement, PlatformSkillSnapshot, SkillIdentity,
} from '../shared/skill-installation.ts'
import { matchSkillIdentity } from '../shared/skill-identity.ts'

/** One installation currently retained by the root client plugin. */
export interface SkillInstallationView {
  readonly skill: SkillCatalogItem
  readonly updating: boolean
  readonly operationId: PlatformSkillOperationId
  readonly progress: PlatformSkillInstallProgress | null
  readonly admitted: boolean
  readonly cancelling: boolean
}

/** Settled result returned to a configured installation queue. */
export type SkillInstallationResult =
  | { readonly kind: 'complete'; readonly skill: SkillCatalogItem }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed' }

/** Remote calls used by one root-owned installation lifetime. */
export interface SkillInstallationRemote {
  readonly install: (this: void, request: PlatformSkillInstallRequest, signal?: AbortSignal) =>
  RemoteStreamHandle<PlatformSkillInstallProgress, never>
  readonly cancel: (this: void, operationId: PlatformSkillOperationId) => Promise<RemoteResult<PlatformSkillOperationSettlement>>
}

/** Root-owned controller view and actions shared by the page and shell overlay. */
export interface SkillInstallationController {
  readonly hooks: {
    readonly active: HostObservable<SkillInstallationView | null>
    /** Changes after every settled operation so resource consumers re-read installed versions. */
    readonly revision: HostObservable<number>
  }
  /** Begin an install when no operation is already active. */
  install(skill: SkillCatalogItem, updating: boolean, key?: PlatformSkillInstallRequest['key'], reportFailure?: boolean): Promise<SkillInstallationResult> | undefined
  /** Report a configured-catalogue failure through the existing shared toast. */
  reportFailure(): void
  /** Ask the Host to cancel the active operation after admission. */
  cancel(): void
  /** Abort active work during plugin disposal and wait for Host rollback. */
  dispose(): Promise<void>
}

/** Host reads needed to reconcile configured first-install skills. */
export interface PresetSkillRemote {
  readonly pending: (this: void, catalogue: readonly SkillIdentity[]) => Promise<RemoteResult<readonly SkillIdentity[]>>
  /** Wait for a concurrent same-identity Host operation without cancelling its owner. */
  readonly settled: (this: void, identity: SkillIdentity) => Promise<RemoteResult<PlatformSkillSnapshot>>
}

/**
 * Install configured skills once their published catalogue is available.
 * Each iteration re-reads Host eligibility because another page may have
 * completed or removed an installation while this client was waiting.
 * @param controller - Shared operation owner used by manual installs too.
 * @param remote - Host reads for eligibility and cross-page completion checks.
 * @param catalogue - Settled catalogue entries keyed by their management IDs.
 * @returns when every pending identity settled, or when one failure/cancellation stops this client run.
 */
export async function reconcilePresetSkills(
  controller: SkillInstallationController,
  remote: PresetSkillRemote,
  catalogue: readonly SkillCatalogItem[],
): Promise<void> {
  while (true) {
    const pending = await remote.pending(catalogue)
    if (!pending.ok) {
      controller.reportFailure()
      return
    }
    if (pending.value.length === 0) return
    const [identity] = pending.value
    if (identity === undefined) return
    const matched = matchSkillIdentity(identity, catalogue)
    if (matched.kind !== 'match') {
      controller.reportFailure()
      return
    }
    const skill = matched.value
    const result = controller.install(skill, false, undefined, false)
    if (result === undefined) return
    const settled = await result
    if (settled.kind === 'complete') continue
    if (settled.kind === 'cancelled') return
    const settledAfterConflict = await remote.settled(identity)
    if (settledAfterConflict.ok && matchSkillIdentity(identity, settledAfterConflict.value.skills, catalogue).kind === 'match') continue
    controller.reportFailure()
    return
  }
}

/**
 * Keep the operation outside the market panel so navigation cannot abandon its stream.
 * @param remote - Typed Host installation methods.
 * @param report - Root toast reporter for settled outcomes.
 * @returns one controller owned for the client plugin lifetime.
 */
export function createSkillInstallationController(
  remote: SkillInstallationRemote,
  report: SkillCenterToastSource['report'],
): SkillInstallationController {
  const active = createSnapshotStore<SkillInstallationView | null>(null)
  const revision = createSnapshotStore(0)
  let current: { readonly controller: AbortController; readonly settlement: Promise<SkillInstallationResult> } | undefined
  let accepting = true

  const install = (
    skill: SkillCatalogItem,
    updating: boolean,
    key?: PlatformSkillInstallRequest['key'],
    reportFailure = true,
  ): Promise<SkillInstallationResult> | undefined => {
    if (!accepting || current !== undefined) return undefined
    const controller = new AbortController()
    const operationId = brandString<PlatformSkillOperationId>(randomUUID())
    active.set({ skill, updating, operationId, progress: null, admitted: false, cancelling: false })
    const settlement = (async (): Promise<SkillInstallationResult> => {
      let complete = false
      let cancelled = false
      try {
        const identity: SkillIdentity = skill.id === undefined
          ? { skillName: skill.skillName }
          : { id: skill.id, skillName: skill.skillName }
        const request: PlatformSkillInstallRequest = {
          ...identity, ...(key === undefined ? {} : { key }), version: skill.version, downloadUrl: skill.downloadUrl, operationId,
        }
        for await (const progress of remote.install(request, controller.signal)) {
          if (progress.kind === 'complete') complete = true
          if (progress.kind === 'cancelled') cancelled = true
          const visible = active.getSnapshot()
          if (visible?.operationId === operationId) active.set({ ...visible, admitted: true, progress })
        }
        if (complete) {
          report(updating ? 'updateSuccess' : 'installSuccess')
          return { kind: 'complete', skill }
        }
        if (cancelled || controller.signal.aborted) return { kind: 'cancelled' }
        if (reportFailure) report('installFailure')
        return { kind: 'failed' }
      } catch (_error) {
        if (controller.signal.aborted) return { kind: 'cancelled' }
        if (reportFailure) report('installFailure')
        return { kind: 'failed' }
      } finally {
        revision.set(revision.getSnapshot() + 1)
        if (active.getSnapshot()?.operationId === operationId) active.set(null)
      }
    })()
    current = { controller, settlement }
    void settlement.finally(() => {
      if (current?.settlement === settlement) current = undefined
    })
    return settlement
  }

  const cancel = (): void => {
    const visible = active.getSnapshot()
    if (visible === null || visible.cancelling || !visible.admitted) return
    active.set({ ...visible, cancelling: true })
    void remote.cancel(visible.operationId).then((result) => {
      if (result.ok || active.getSnapshot()?.operationId !== visible.operationId) return
      const retryable = active.getSnapshot()
      if (retryable !== null) active.set({ ...retryable, cancelling: false })
      report('installFailure')
    }, () => {
      if (active.getSnapshot()?.operationId !== visible.operationId) return
      const retryable = active.getSnapshot()
      if (retryable !== null) active.set({ ...retryable, cancelling: false })
      report('installFailure')
    })
  }

  return {
    hooks: { active, revision }, install, cancel,
    reportFailure: () => { if (accepting) report('installFailure') },
    async dispose(): Promise<void> {
      accepting = false
      current?.controller.abort(new Error('Skill center client stopped'))
      await current?.settlement
    },
  }
}
