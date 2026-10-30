/** Product policy for Insight desktop update discovery and user actions. */

import type { InsightUpdateSnapshot } from '../../shared/update-api.ts'
import semver from 'semver'
import type { ResolvedInsightUpdate } from './source.ts'

/** State reported by the sole native Desktop update coordinator. */
export interface InsightNativeUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error' | 'unsupported'
  readonly version?: string
  readonly message?: string
  readonly percent?: number
  readonly failedOperation?: 'check' | 'download' | 'install'
}

/** Native update operations, with the provider selected before every check. */
export interface InsightNativeUpdateCoordinator {
  readonly state: InsightNativeUpdateState
  check(track: 'stable' | 'candidate', manual: boolean): Promise<InsightNativeUpdateState>
  download(version: string): Promise<InsightNativeUpdateState>
  install(version: string): Promise<InsightNativeUpdateState>
  dismissAvailable(version: string): InsightNativeUpdateState
}

/** Durable installation state needed by update actions. */
export interface InsightUpdateStore {
  enableCandidate(): Promise<void>
  skippedVersion(): Promise<string | undefined>
  skip(version: string): Promise<void>
}

/** Dependencies held by the Main-process owner, never exposed to the update renderer. */
export interface InsightUpdateControllerOptions {
  readonly currentVersion: string
  readonly store: InsightUpdateStore
  readonly coordinator: InsightNativeUpdateCoordinator
  /** Returns the release that the native provider accepted for its latest matching check. */
  readonly resolved: (track: 'stable' | 'candidate') => ResolvedInsightUpdate | undefined
  /** Shows the native candidate-risk confirmation. */
  readonly confirmCandidate: () => Promise<boolean>
  /** Opens only the signed manifest-derived full-installer address. */
  readonly openFullInstaller: (release: ResolvedInsightUpdate) => Promise<void>
  /** Receives a renderer-safe state only while this controller remains live. */
  readonly publish: (state: InsightUpdateSnapshot) => void
  /** Receives diagnostic errors outside the renderer. */
  readonly report: (error: unknown) => void
}

/** Main-process product actions used by the isolated Insight update window. */
export interface InsightUpdateController {
  readonly snapshot: InsightUpdateSnapshot
  /** Reflect a state emitted by the native coordinator. */
  updateState(state: InsightNativeUpdateState): void
  /** Run an explicit stable check. */
  checkStable(): Promise<void>
  /** Confirm then run one explicit candidate check. */
  checkCandidate(): Promise<void>
  /** Run a throttled automatic stable check. */
  automaticCheck(): Promise<void>
  /** Download the exact available version shown to the user. */
  download(): Promise<void>
  /** Install the exact prepared version shown to the user. */
  install(): Promise<void>
  /** Suppress the exact optional version shown to the user. */
  skip(version: string): Promise<void>
  /** Open the full installer selected from the verified manifest. */
  fullInstaller(): Promise<void>
  /** Stop later asynchronous work from publishing into a disposed window owner. */
  dispose(): void
}

/**
 * Keep Insight-only update policy above the native DSH coordinator.
 * @param options - Main-process dependencies and durable installation state.
 * @returns Product actions suitable for a dedicated update window.
 */
export function createInsightUpdateController(options: InsightUpdateControllerOptions): InsightUpdateController {
  let disposed = false
  const isDisposed = (): boolean => disposed
  let selectedTrack: 'stable' | 'candidate' = 'stable'
  let selected: ResolvedInsightUpdate | undefined
  let checkOperation: Promise<void> | undefined
  let actionOperation: Promise<void> | undefined
  let suppressAvailable = false
  let current = snapshot(options.currentVersion, selectedTrack, options.coordinator.state, selected)

  const assertLive = (): void => {
    if (disposed) throw new Error('Insight update controller is disposed.')
  }
  const publish = (): void => {
    if (!disposed) options.publish(current)
  }
  const set = (state: InsightNativeUpdateState, track = selectedTrack): void => {
    selectedTrack = track
    if (state.phase === 'error') {
      options.report(new Error(state.message ?? 'Desktop update coordinator reported an unspecified error.'))
      current = snapshot(options.currentVersion, selectedTrack, { ...state, message: '更新暂时未完成，请重试。' }, selected)
    } else {
      current = snapshot(options.currentVersion, selectedTrack, state, selected)
    }
    publish()
  }
  const required = (release: ResolvedInsightUpdate): boolean => release.policy.mode === 'required'
    && semver.lt(options.currentVersion, release.policy.minimumSupportedVersion)
  const recoverInstallationError = (state: InsightNativeUpdateState): boolean => {
    if (state.phase !== 'error' || state.failedOperation !== 'install' || selected === undefined || state.version !== selected.version) return false
    options.report(new Error(state.message ?? 'Desktop update coordinator reported an unspecified error.'))
    current = snapshot(options.currentVersion, selectedTrack, {
      phase: 'ready', version: state.version, message: '安装未完成，请重试。',
    }, selected)
    publish()
    return true
  }
  const fail = (error: unknown): void => {
    options.report(error)
    const message = '更新暂时未完成，请重试。'
    current = { ...current, phase: 'error', message }
    publish()
  }
  const check = (track: 'stable' | 'candidate', manual: boolean): Promise<void> => {
    assertLive()
    const active = checkOperation
    if (active === undefined && (current.phase === 'available' || current.phase === 'downloading' || current.phase === 'verifying' || current.phase === 'ready' || current.phase === 'installing')) return Promise.resolve()
    const run = async (): Promise<void> => {
      selectedTrack = track
      selected = undefined
      set({ phase: 'checking' }, track)
      suppressAvailable = !manual
      try {
        const state = await options.coordinator.check(track, manual)
        if (isDisposed()) return
        const release = options.resolved(track)
        if ((state.phase === 'available' || state.phase === 'unsupported') && (release === undefined || release.version !== state.version)) {
          throw new Error('Insight update provider made an update available without a matching verified release.')
        }
        selected = state.phase === 'available' || state.phase === 'unsupported' ? release : undefined
        if (!manual && state.phase === 'available' && release !== undefined && !required(release)) {
          if (await options.store.skippedVersion() === release.version) {
            if (isDisposed()) return
            const dismissed = options.coordinator.dismissAvailable(release.version)
            selected = undefined
            set(dismissed, track)
            return
          }
        }
        set(state, track)
      } catch (error) {
        if (!disposed) fail(error)
      } finally {
        suppressAvailable = false
      }
    }
    if (active === undefined) return startCheck(run())
    if (selectedTrack === track) return active
    return startCheck(active.then(async () => {
      assertLive()
      if (track === 'candidate' && current.required) throw new Error('A required stable update must be installed before checking candidates.')
      if (current.phase === 'available') {
        const version = current.version
        if (version === undefined) throw new Error('Available Insight update has no version.')
        selected = undefined
        set(options.coordinator.dismissAvailable(version), track)
      }
      await run()
    }))
  }

  const startCheck = (next: Promise<void>): Promise<void> => {
    const tracked = next.finally(() => { if (checkOperation === tracked) checkOperation = undefined })
    checkOperation = tracked
    return tracked
  }
  const startAction = (next: () => Promise<void>): Promise<void> => {
    const active = actionOperation
    if (active !== undefined) return active
    const tracked = next().finally(() => { if (actionOperation === tracked) actionOperation = undefined })
    actionOperation = tracked
    return tracked
  }

  return {
    get snapshot() { return current },
    updateState(state): void {
      if (isDisposed()) return
      if (suppressAvailable && state.phase === 'available') return
      if (recoverInstallationError(state)) return
      set(state)
    },
    async checkStable(): Promise<void> { assertLive(); await check('stable', true) },
    async checkCandidate(): Promise<void> {
      assertLive()
      await startAction(async () => {
        try {
          if (!await options.confirmCandidate() || disposed) return
          if (current.required) throw new Error('A required stable update must be installed before checking candidates.')
          await options.store.enableCandidate()
          assertLive()
          await check('candidate', true)
        } catch (error) {
          if (!disposed) fail(error)
        }
      })
    },
    async automaticCheck(): Promise<void> {
      assertLive()
      await check('stable', false)
    },
    async download(): Promise<void> {
      assertLive()
      if (checkOperation !== undefined) return
      await startAction(async () => {
        const version = current.version
        if (version === undefined || current.phase !== 'available') { fail(new Error('No Insight update is available to download.')); return }
        try {
          set({ phase: 'downloading', version, percent: 0 })
          const state = await options.coordinator.download(version)
          if (isDisposed()) return
          if (state.phase === 'error' && selected?.version === version) {
            set({ phase: 'available', version, message: '下载未完成，请重试。' })
            return
          }
          set(state)
        } catch (error) { if (!disposed) fail(error) }
      })
    },
    async install(): Promise<void> {
      assertLive()
      if (checkOperation !== undefined) return
      await startAction(async () => {
        const version = current.version
        if (version === undefined || current.phase !== 'ready') { fail(new Error('No Insight update is prepared to install.')); return }
        try {
          set({ phase: 'installing', version })
          const state = await options.coordinator.install(version)
          if (isDisposed()) return
          if (state.phase === 'error' && selected?.version === version) {
            set({ phase: 'ready', version, message: '安装未完成，请重试。' })
            return
          }
          set(state)
        } catch (error) { if (!disposed) fail(error) }
      })
    },
    async skip(version): Promise<void> {
      assertLive()
      if (checkOperation !== undefined) return
      await startAction(async () => {
        if (current.phase !== 'available' || current.version !== version || current.required) {
          fail(new Error('Insight update is not an optional matching available version.'))
          return
        }
        try {
          await options.store.skip(version)
          assertLive()
          const dismissed = options.coordinator.dismissAvailable(version)
          selected = undefined
          set(dismissed)
        } catch (error) { if (!disposed) fail(error) }
      })
    },
    async fullInstaller(): Promise<void> {
      assertLive()
      if (checkOperation !== undefined) return
      await startAction(async () => {
        if (selected === undefined || !current.canDownloadFullInstaller) { fail(new Error('No signed full installer is available.')); return }
        try { await options.openFullInstaller(selected) } catch (error) { if (!disposed) fail(error) }
      })
    },
    dispose(): void { disposed = true },
  }
}

function snapshot(currentVersion: string, track: 'stable' | 'candidate', state: InsightNativeUpdateState, release: ResolvedInsightUpdate | undefined): InsightUpdateSnapshot {
  const required = release?.policy.mode === 'required' && semver.lt(currentVersion, release.policy.minimumSupportedVersion)
  return {
    currentVersion,
    phase: state.phase,
    track,
    ...(state.version === undefined ? {} : { version: state.version }),
    ...(state.message === undefined ? {} : { message: state.message }),
    ...(state.percent === undefined ? {} : { percent: state.percent }),
    required,
    canDownloadFullInstaller: state.phase === 'available' && release !== undefined && release.payloadAsset.platform === 'darwin',
  }
}
