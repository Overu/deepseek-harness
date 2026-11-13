/** Account-scoped platform skill installation, discovery, and Remote control. */
import { realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProviderObservation,
} from '@deepseek-ai/dsh-skill'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Config } from '../config.ts'
import type {
  PlatformSkillInstallProgress,
  PlatformSkillInstallRequest,
  PlatformSkillOperationId,
  PlatformSkillOperationSettlement,
  PlatformSkillRemovalRequest,
  PlatformSkillSnapshot,
  SkillIdentity,
} from '../types.ts'
import { matchSkillIdentity } from '../shared/skill-identity.ts'
import { PlatformSkillStore } from './platform-skill-store.ts'

const PROVIDER_NAME = 'insight-platform'

interface ActiveOperation {
  readonly identity: SkillIdentity
  readonly controller: AbortController
  readonly settlement: Promise<PlatformSkillOperationSettlement>
}

type OperationState =
  | { readonly kind: 'pending' }
  | { readonly kind: 'settled'; readonly value: PlatformSkillOperationSettlement }
  | { readonly kind: 'failed'; readonly error: unknown }

/** Host service owning committed platform skills for the current account. */
export class InsightPlatformSkills extends TypertRemoteService {
  /** Account-owned directory containing platform skill state. */
  readonly root: string
  private readonly lifetime = new AbortController()
  private readonly store: PlatformSkillStore
  private readonly loader: FileSystemSkillProvider
  private readonly legacyLoaders: readonly FileSystemSkillProvider[]
  private readonly presetSelectors: readonly string[]
  private readonly initialization: Promise<void>
  private readonly operations = new Map<PlatformSkillOperationId, ActiveOperation>()
  private readonly mutatingSkills: SkillIdentity[] = []
  private readonly activeCalls = new Set<Promise<unknown>>()
  private readonly packagedRoots = new Set<string>()
  private invalidateSkills = (): void => {}
  private accepting = true

  /**
   * Register the platform provider and its Remote management API.
   * @param ctx - Host context with the effective skill registry.
   * @param config - Validated download and archive policy.
   */
  constructor(ctx: Context, config: Config) {
    for (const directory of config.legacySkillDirs) {
      if (!isAbsolute(directory)) throw new Error('Legacy skill directories must be absolute host paths.')
    }
    super(ctx, 'insightPlatformSkills')
    const dshHome = process.env.DSH_HOME
    if (dshHome === undefined || dshHome.length === 0) {
      throw new Error('Insight platform skills require the account-scoped DSH_HOME')
    }
    const control = { signal: this.lifetime.signal, invalidate: (): void => {} }
    this.loader = new FileSystemSkillProvider(ctx, control, {
      includeDefaultRoots: false,
      watch: false,
      providerName: PROVIDER_NAME,
    })
    this.presetSelectors = config.presetSkillIds
    this.legacyLoaders = [...new Set(config.legacySkillDirs)].map(directory => new FileSystemSkillProvider(ctx, {
      signal: this.lifetime.signal, invalidate: () => { this.invalidateSkills() },
    }, { includeDefaultRoots: false, bundledSkillDir: directory, providerName: PROVIDER_NAME }))
    this.store = new PlatformSkillStore(
      dshHome,
      {
        requestTimeoutMs: config.packageRequestTimeoutMs,
        maxArchiveBytes: config.packageMaxDownloadBytes,
        maxArchiveEntries: config.packageMaxEntries,
        maxExtractedBytes: config.packageMaxExtractedBytes,
        allowedOrigins: new Set(config.packageAllowedOrigins),
      },
      (payload, skillName, signal) => this.validatePayload(payload, skillName, signal),
      (message, error) => { ctx.logger.warn(message, error) },
    )
    this.root = this.store.root
    this.initialization = this.track(this.store.recover())
    void this.initialization.catch((error: unknown) => {
      ctx.logger.error('Insight platform skill recovery failed.', error)
    })
    ctx.skills.registerProvider((providerControl) => {
      this.invalidateSkills = providerControl.invalidate
      return {
        name: PROVIDER_NAME,
        list: async (options) => {
          const platform = normalize(await this.listCandidates(options))
          const legacy = normalize(await this.listLegacyCandidates(options))
          const candidates = [...platform.candidates, ...legacy.candidates]
          return platform.complete && legacy.complete ? candidates : { candidates, complete: false }
        },
        get: (candidate, options) => this.getCandidate(candidate, options),
      }
    })
    ctx.effect(() => async () => {
      this.accepting = false
      this.lifetime.abort(new Error('Insight platform skills stopped'))
      for (const operation of this.operations.values()) {
        operation.controller.abort(new Error('Insight platform skills stopped'))
      }
      const results = await Promise.allSettled([
        ...[...this.operations.values()].map(operation => operation.settlement),
        ...this.activeCalls,
      ])
      results.push(...await Promise.all([this.loader, ...this.legacyLoaders].map(loader => loader.dispose().then(
        () => ({ status: 'fulfilled', value: undefined } as const),
        (reason: unknown) => ({ status: 'rejected', reason } as const),
      ))))
      const failure = results.find(result => result.status === 'rejected' && !isAbortFailure(result.reason, this.lifetime.signal))
      if (failure?.status === 'rejected') throw failure.reason
    }, 'insight-skill-center: platform skills')
  }

  /** Wait until interrupted staging and unreferenced payload recovery completes. */
  initialize(): Promise<void> {
    return this.initialization
  }

  /**
   * List installed versions selected by complete atomic records.
   * @returns Current account installation state.
   */
  @Remote
  listInstalled(): Promise<PlatformSkillSnapshot> {
    this.assertAccepting()
    return this.track(this.store.list(this.lifetime.signal))
  }

  /**
   * List configured platform skills eligible for this account's first automatic installation.
   * @param catalogue - Published identities used to resolve configured selectors.
   * @returns Identities absent from both installed records and account installation history.
   */
  @Remote
  listPendingPresets(catalogue: readonly SkillIdentity[]): Promise<readonly SkillIdentity[]> {
    this.assertAccepting()
    return this.track(this.store.pendingPresets(catalogue, this.presetSelectors, this.lifetime.signal))
  }

  /**
   * Observe another client's admitted installation without cancelling its work.
   * @param identity - Skill identity whose admitted install or update must settle.
   * @param signal - Cancels only this observer's wait.
   * @returns Account installation state after the observed operations settle.
   */
  @Remote
  async waitForInstallation(identity: SkillIdentity, signal: AbortSignal): Promise<PlatformSkillSnapshot> {
    this.assertAccepting()
    const combined = AbortSignal.any([signal, this.lifetime.signal])
    combined.throwIfAborted()
    const aborted = Promise.withResolvers<void>()
    const abort = (): void => { aborted.reject(combined.reason) }
    combined.addEventListener('abort', abort, { once: true })
    try {
      const matches = [...this.operations.values()].map(operation => ({ operation, ...operation.identity }))
      const match = matchSkillIdentity(identity, matches)
      if (match.kind === 'conflict') throw badRequest('This skill identity conflicts with an active installation.')
      const observed = match.kind === 'match' ? [match.value.operation] : []
      await this.track(Promise.race([Promise.allSettled(observed.map(operation => operation.settlement)), aborted.promise]))
      combined.throwIfAborted()
      return await this.listInstalled()
    } finally {
      combined.removeEventListener('abort', abort)
    }
  }

  /**
   * Discover previous application directories without modifying their files.
   * @param options - Lookup cancellation and working-directory context.
   * @returns Legacy candidates ranked after managed platform releases.
   */
  async listLegacyCandidates(options: SkillLookupOptions): Promise<readonly SkillCandidate[] | SkillProviderObservation> {
    const signal = options.signal === undefined ? this.lifetime.signal : AbortSignal.any([options.signal, this.lifetime.signal])
    const candidates: SkillCandidate[] = []
    let complete = true
    for (const loader of this.legacyLoaders) {
      const observation = normalize(await loader.list({ ...options, signal }))
      // Account-installed replacements take precedence over the same legacy invocation name.
      candidates.push(...observation.candidates.map(candidate => ({ ...candidate, rank: candidate.rank + 1 })))
      complete &&= observation.complete
    }
    return complete ? candidates : { candidates, complete: false }
  }

  /**
   * Install or update one catalogue release and stream work through final settlement.
   * @param request - Published release and client-generated operation identity.
   * @param signal - Remote stream lifetime; disconnect requests cancellation and drains rollback.
   * @returns progress followed by exactly one committed or cancelled terminal frame.
   */
  @Remote({ name: 'installSkill', mode: 'stream' })
  async *install(
    request: PlatformSkillInstallRequest,
    signal: AbortSignal,
  ): AsyncIterable<PlatformSkillInstallProgress> {
    this.assertAccepting()
    signal.throwIfAborted()
    if (this.operations.has(request.operationId)) {
      throw badRequest('This skill operation id is already in use.')
    }
    this.claimMutation(request)
    const controller = new AbortController()
    const frames: PlatformSkillInstallProgress[] = []
    let wake: (() => void) | undefined
    const state: { value: OperationState } = { value: { kind: 'pending' } }
    const push = (frame: Exclude<PlatformSkillInstallProgress, PlatformSkillOperationSettlement>): void => {
      const downloadIndex = frame.phase === 'download'
        ? frames.findIndex(candidate => candidate.kind === 'progress' && candidate.phase === 'download')
        : -1
      if (downloadIndex === -1) frames.push(frame)
      else frames[downloadIndex] = frame
      wake?.()
    }
    const settlement = this.performInstall(
      request,
      AbortSignal.any([controller.signal, this.lifetime.signal]),
      push,
    )
    const operation: ActiveOperation = { identity: request, controller, settlement }
    this.operations.set(request.operationId, operation)
    push({
      kind: 'progress',
      operationId: request.operationId,
      phase: 'download',
      receivedBytes: 0,
    })
    void settlement.then(
      (value) => { state.value = { kind: 'settled', value }; wake?.() },
      (error: unknown) => { state.value = { kind: 'failed', error }; wake?.() },
    ).finally(() => { this.releaseMutation(request) })
    const abort = (): void => { controller.abort(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (true) {
        const frame = frames.shift()
        if (frame !== undefined) {
          yield frame
          continue
        }
        if (state.value.kind === 'settled') {
          yield state.value.value
          return
        }
        if (state.value.kind === 'failed') throw remoteInstallFailure(state.value.error)
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
      }
    } finally {
      signal.removeEventListener('abort', abort)
      if (state.value.kind === 'pending') {
        controller.abort(signal.aborted
          ? signal.reason
          : new Error('Skill installation stream closed'))
      }
      try {
        await settlement
      } catch (error) {
        throw remoteInstallFailure(error)
      } finally {
        this.operations.delete(request.operationId)
      }
    }
  }

  /**
   * Request cancellation without closing the progress stream and wait for rollback or commit.
   * @param operationId - Identity supplied when installation started.
   * @returns the actual terminal outcome; a commit that won the race remains successful.
   */
  @Remote
  async cancel(operationId: PlatformSkillOperationId): Promise<PlatformSkillOperationSettlement> {
    this.assertAccepting()
    const operation = this.operations.get(operationId)
    if (operation === undefined) throw badRequest('This skill operation is no longer active.')
    operation.controller.abort(new Error('Skill installation cancelled'))
    try {
      return await operation.settlement
    } catch (error) {
      this.ctx.logger.warn(`Insight platform skill cancellation failed for ${operation.identity.skillName}.`, error)
      throw remoteInstallFailure(error)
    }
  }

  /**
   * Remove one committed skill selection and then reclaim its immutable payload.
   * @param request - Local key and current catalogue identity of the installation to remove.
   * @param signal - Cancellation is honored before record removal commits.
   * @returns current committed installation state.
   */
  @Remote('removeSkill')
  async remove(request: PlatformSkillRemovalRequest, signal: AbortSignal): Promise<PlatformSkillSnapshot> {
    this.assertAccepting()
    this.claimMutation(request)
    const combined = AbortSignal.any([signal, this.lifetime.signal])
    try {
      const snapshot = await this.track(this.store.remove(request, combined))
      this.invalidateSkills()
      return snapshot
    } catch (error) {
      if (combined.aborted) throw combined.reason
      this.ctx.logger.warn(`Insight platform skill removal failed for ${request.skillName}.`, error)
      throw new RemoteError('gateway/internal', 'Skill removal failed. Try again.', {})
    } finally {
      this.releaseMutation(request)
    }
  }

  /**
   * List committed account candidates followed by package-owned skills, omitting a package candidate with an installed name.
   * @param options - Lookup cancellation and working-directory context.
   * @returns Complete candidates, or an explicitly incomplete observation.
   */
  async listCandidates(options: SkillLookupOptions): Promise<readonly SkillCandidate[] | SkillProviderObservation> {
    const signal = options.signal === undefined
      ? this.lifetime.signal
      : AbortSignal.any([options.signal, this.lifetime.signal])
    const lookup = { ...options, signal }
    const roots = await this.store.selectedRoots(signal)
    const candidates: SkillCandidate[] = []
    const names = new Set<string>()
    let complete = true
    for (const [index, root] of [...roots, ...this.packagedRoots].entries()) {
      signal.throwIfAborted()
      const provider = this.providerFor(root)
      try {
        const observation = normalize(await provider.list(lookup))
        for (const candidate of observation.candidates) {
          if (index >= roots.length && names.has(candidate.name)) continue
          names.add(candidate.name)
          candidates.push(candidate)
        }
        complete &&= observation.complete
      } finally {
        await provider.dispose()
      }
    }
    return complete ? candidates : { candidates, complete: false }
  }

  /** Register a trusted package's single root skill below account installations and above legacy roots.
   * @param root - Absolute package-owned skill directory containing SKILL.md.
   * @param skillName - Expected invocation name in the skill frontmatter.
   * @returns Disposer that removes this package's candidate and refreshes skill discovery.
   */
  async registerPackagedSkillRoot(root: string, skillName: string): Promise<() => void> {
    this.assertAccepting()
    if (!isAbsolute(root)) throw new Error('Packaged skill root must be an absolute host path.')
    const resolved = await realpath(root)
    if (this.packagedRoots.has(resolved)) throw new Error(`Packaged skill root already registered: ${resolved}`)
    await this.validatePayload(resolved, skillName, this.lifetime.signal)
    this.assertAccepting()
    if (this.packagedRoots.has(resolved)) throw new Error(`Packaged skill root already registered: ${resolved}`)
    this.packagedRoots.add(resolved)
    this.invalidateSkills()
    return () => {
      if (this.packagedRoots.delete(resolved)) this.invalidateSkills()
    }
  }

  /**
   * Load one candidate previously returned by {@link listCandidates}.
   * @param candidate - Candidate carrying the filesystem locator.
   * @param options - Lookup cancellation and working-directory context.
   * @returns The complete parsed skill, or undefined when its file was removed.
   */
  getCandidate(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    const signal = options.signal === undefined
      ? this.lifetime.signal
      : AbortSignal.any([options.signal, this.lifetime.signal])
    return this.track(this.loader.get(candidate, { ...options, signal }))
  }

  private providerFor(root: string): FileSystemSkillProvider {
    const lifetime = new AbortController()
    return new FileSystemSkillProvider(
      this.ctx,
      { signal: lifetime.signal, invalidate: (): void => {} },
      { includeDefaultRoots: false, watch: false, bundledSkillDir: root, providerName: PROVIDER_NAME },
    )
  }

  private async validatePayload(payload: string, skillName: string, signal: AbortSignal): Promise<void> {
    const provider = this.providerFor(payload)
    try {
      const observation = normalize(await provider.list({ signal }))
      const instructionPath = await realpath(join(payload, 'SKILL.md'))
      const [candidate] = observation.candidates
      if (!observation.complete || observation.candidates.length !== 1
        || candidate?.name !== skillName
        || candidate.path !== instructionPath
        || await provider.get(candidate, { signal }) === undefined) {
        throw new Error('Skill package does not contain one valid root SKILL.md.')
      }
    } finally {
      await provider.dispose()
    }
  }

  private async performInstall(
    request: PlatformSkillInstallRequest,
    signal: AbortSignal,
    progress: (frame: Exclude<PlatformSkillInstallProgress, PlatformSkillOperationSettlement>) => void,
  ): Promise<PlatformSkillOperationSettlement> {
    try {
      const skill = await this.store.install(request, signal, progress)
      this.invalidateSkills()
      return { kind: 'complete', operationId: request.operationId, skill }
    } catch (error) {
      if (isAbortFailure(error, signal)) {
        return { kind: 'cancelled', operationId: request.operationId }
      }
      this.ctx.logger.warn(`Insight platform skill installation failed for ${request.skillName}.`, error)
      throw error
    }
  }

  private assertAccepting(): void {
    if (!this.accepting) throw new RemoteError('gateway/internal', 'Platform skills are stopping.', {})
  }

  private claimMutation(identity: SkillIdentity): void {
    const match = matchSkillIdentity(identity, this.mutatingSkills)
    if (match.kind !== 'missing') throw badRequest(match.kind === 'conflict'
      ? 'This skill identity conflicts with an install, update, or removal in progress.'
      : 'This skill already has an install, update, or removal in progress.')
    this.mutatingSkills.push(identity)
  }

  private releaseMutation(identity: SkillIdentity): void {
    const index = this.mutatingSkills.indexOf(identity)
    if (index !== -1) this.mutatingSkills.splice(index, 1)
  }

  private track<T>(call: Promise<T>): Promise<T> {
    this.activeCalls.add(call)
    return call.finally(() => { this.activeCalls.delete(call) })
  }
}

function normalize(value: readonly SkillCandidate[] | SkillProviderObservation): SkillProviderObservation {
  return 'candidates' in value ? value : { candidates: value, complete: true }
}

function badRequest(message: string): RemoteError<'gateway/bad-request'> {
  return new RemoteError('gateway/bad-request', message, {})
}

function remoteInstallFailure(error: unknown): RemoteError<'gateway/internal'> {
  return new RemoteError('gateway/internal', 'Skill installation failed. Try again.', {}, { cause: error })
}

function isAbortFailure(error: unknown, signal: AbortSignal): boolean {
  if (!signal.aborted || error instanceof AggregateError) return false
  if (error === signal.reason) return true
  return error instanceof Error
    && (error.name === 'AbortError' || ('code' in error && error.code === 'ABORT_ERR'))
}
