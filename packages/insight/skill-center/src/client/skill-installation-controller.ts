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

/** Progress retained between individual operations in one automatic installation. */
export interface PresetInstallationProgress {
  readonly completed: number
  readonly total: number
  readonly cancelling: boolean
}

/** Root-owned controller view and actions shared by the page and shell overlay. */
export interface SkillInstallationController {
  readonly hooks: {
    readonly active: HostObservable<SkillInstallationView | null>
    readonly presets: HostObservable<PresetInstallationProgress | null>
    /** Changes after every settled operation so resource consumers re-read installed versions. */
    readonly revision: HostObservable<number>
  }
  /** Begin an install when no operation is already active. */
  install(skill: SkillCatalogItem, updating: boolean, reportOutcome?: boolean): Promise<SkillInstallationResult> | undefined
  /** Run one automatic queue, skipping failed skills without retry; cancellation ends the queue. */
  installPresets(remote: PresetSkillRemote, catalogue: readonly SkillCatalogItem[]): Promise<void>
  /** Report a configured-catalogue failure through the existing shared toast. */
  reportFailure(): void
  /** Ask the Host to cancel the active operation after admission. */
  cancel(): void
  /** Abort active work during plugin disposal and wait for Host rollback. */
  dispose(): Promise<void>
}

/** Host reads needed to reconcile configured first-install skills. */
export interface PresetSkillRemote {
  readonly pending: (this: void, catalogue: readonly SkillIdentity[], signal?: AbortSignal) =>
  Promise<RemoteResult<readonly SkillIdentity[]>>
  /** Wait for a concurrent same-identity Host operation without cancelling its owner. */
  readonly settled: (this: void, identity: SkillIdentity, signal?: AbortSignal) => Promise<RemoteResult<PlatformSkillSnapshot>>
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
  const presets = createSnapshotStore<PresetInstallationProgress | null>(null)
  const lifetime = new AbortController()
  let presetQueue: Promise<void> | undefined
  let current: { readonly controller: AbortController; readonly settlement: Promise<SkillInstallationResult> } | undefined
  let accepting = true
  const isAccepting = (): boolean => accepting

  const install = (
    skill: SkillCatalogItem,
    updating: boolean,
    reportOutcome = true,
  ): Promise<SkillInstallationResult> | undefined => {
    if (!accepting || current !== undefined) return undefined
    const controller = new AbortController()
    const operationId = brandString<PlatformSkillOperationId>(randomUUID())
    active.set({ skill, updating, operationId, progress: null, admitted: false, cancelling: false })
    const settlement = (async (): Promise<SkillInstallationResult> => {
      let complete = false
      let cancelled = false
      try {
        const request: PlatformSkillInstallRequest = {
          id: skill.id, version: skill.version, downloadUrl: skill.downloadUrl, operationId,
        }
        for await (const progress of remote.install(request, controller.signal)) {
          if (progress.kind === 'complete') complete = true
          if (progress.kind === 'cancelled') cancelled = true
          const visible = active.getSnapshot()
          if (visible?.operationId === operationId) active.set({ ...visible, admitted: true, progress })
        }
        if (complete) {
          if (reportOutcome) report(updating ? 'updateSuccess' : 'installSuccess')
          return { kind: 'complete', skill }
        }
        if (cancelled || controller.signal.aborted) return { kind: 'cancelled' }
        if (reportOutcome) report('installFailure')
        return { kind: 'failed' }
      } catch (_error) {
        if (controller.signal.aborted) return { kind: 'cancelled' }
        if (reportOutcome) report('installFailure')
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

  const installPresets = (remote: PresetSkillRemote, catalogue: readonly SkillCatalogItem[]): Promise<void> => {
    if (!accepting) return Promise.resolve()
    if (presetQueue !== undefined) return presetQueue
    presetQueue = (async () => {
      const failed = new Set<string>()
      let outcome: 'presetSuccess' | 'presetFailure' | 'presetCancelled' | undefined
      try {
        while (isAccepting()) {
          const pending = await remote.pending(catalogue, lifetime.signal)
          if (!isAccepting()) return
          if (presets.getSnapshot()?.cancelling) { outcome = 'presetCancelled'; break }
          if (!pending.ok) { outcome = 'presetFailure'; break }
          const remaining = pending.value.filter(identity => !failed.has(identity.id))
          const [identity] = remaining
          if (identity === undefined) break
          if (current !== undefined) { await current.settlement; continue }
          const completed = presets.getSnapshot()?.completed ?? 0
          presets.set({ completed, total: completed + remaining.length, cancelling: false })
          const matched = matchSkillIdentity(identity, catalogue)
          if (matched.kind !== 'match') {
            failed.add(identity.id)
            presets.set({ completed: completed + 1, total: completed + remaining.length, cancelling: false })
            outcome = 'presetFailure'
            continue
          }
          const operation = install(matched.value, false, false)
          if (operation === undefined) return
          const result = await operation
          if (!isAccepting()) return
          if (result.kind === 'cancelled' || presets.getSnapshot()?.cancelling) { outcome = 'presetCancelled'; break }
          if (result.kind !== 'complete') {
            const other = await remote.settled(identity, lifetime.signal)
            if (!isAccepting()) return
            if (!other.ok || matchSkillIdentity(identity, other.value.skills).kind !== 'match') {
              failed.add(identity.id)
            }
          }
          const progress = presets.getSnapshot()
          if (progress !== null) presets.set({ ...progress, completed: completed + 1 })
          outcome = failed.size === 0 ? 'presetSuccess' : 'presetFailure'
        }
      } catch (_error) {
        if (isAccepting()) outcome = 'presetFailure'
      } finally {
        const cancelling = presets.getSnapshot()?.cancelling
        presets.set(null)
        if (isAccepting() && outcome !== undefined) report(cancelling ? 'presetCancelled' : outcome)
      }
    })()
    return presetQueue
  }

  const cancel = (): void => {
    const progress = presets.getSnapshot()
    if (progress !== null) {
      presets.set({ ...progress, cancelling: true })
      lifetime.abort(new Error('Preset installation cancelled'))
    }
    const visible = active.getSnapshot()
    if (visible === null || visible.cancelling || !visible.admitted) return
    active.set({ ...visible, cancelling: true })
    void remote.cancel(visible.operationId).then((result) => {
      if (result.ok || active.getSnapshot()?.operationId !== visible.operationId) return
      const retryable = active.getSnapshot()
      if (retryable !== null) active.set({ ...retryable, cancelling: false })
      if (presets.getSnapshot() === null) report('installFailure')
    }, () => {
      if (active.getSnapshot()?.operationId !== visible.operationId) return
      const retryable = active.getSnapshot()
      if (retryable !== null) active.set({ ...retryable, cancelling: false })
      if (presets.getSnapshot() === null) report('installFailure')
    })
  }

  return {
    hooks: { active, revision, presets }, install, installPresets, cancel,
    reportFailure: () => { if (accepting) report('installFailure') },
    async dispose(): Promise<void> {
      accepting = false
      lifetime.abort(new Error('Skill center client stopped'))
      current?.controller.abort(new Error('Skill center client stopped'))
      await current?.settlement
      await presetQueue
    },
  }
}
