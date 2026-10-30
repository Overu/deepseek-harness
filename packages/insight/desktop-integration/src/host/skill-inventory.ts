/** Read-only projection of the product's three supported skill locations. */
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveAgentsHome } from '@deepseek-ai/dsh-home-paths'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import type { SkillCandidate, SkillProviderObservation, SkillSummary } from '@deepseek-ai/dsh-skill'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-working-directory'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { InsightSkillAvailability, InsightSkillInventoryEntry, InsightSkillInventorySnapshot, InsightSkillOrigin } from '../shared/skill-inventory.ts'
import { readSkillPresentation } from './skill-presentation.ts'

export type { InsightSkillAvailability, InsightSkillInventoryEntry, InsightSkillInventorySnapshot, InsightSkillOrigin } from '../shared/skill-inventory.ts'

interface InventoryRoot {
  readonly origin: InsightSkillOrigin
  readonly provider: FileSystemSkillProvider
  readonly lifetime: AbortController
}

interface RememberedEntry extends Pick<InsightSkillInventoryEntry, 'displayName' | 'shortDescription'> {
  readonly name: string
  readonly description: string
  /** Canonical provider path used only as the stable candidate identity. */
  readonly path: string
  /** Original installed entry path used to distinguish invalid content from deletion. */
  readonly entryPath: string
}

type RememberedPathState = 'present' | 'absent' | 'unknown'

/** Session-scoped Remote inventory used only for Insight's categorized skill picker. */
export class InsightSkillInventory extends TypertRemoteService {
  static inject = ['agents', 'sessionQuery', 'workingDirectory', 'typert']
  private readonly lifetime = new AbortController()
  private readonly roots: readonly InventoryRoot[]
  private readonly remembered = new Map<InsightSkillOrigin, readonly RememberedEntry[]>()
  private readonly activeCalls = new Set<Promise<InsightSkillInventorySnapshot>>()
  private accepting = true

  /** @param ctx - Host services used to resolve the Session's exact effective skill registry. */
  constructor(ctx: Context) {
    super(ctx, 'insightSkillInventory', { namespace: 'insightSkills' })
    const home = process.env.DSH_HOME
    if (home === undefined || home.length === 0) throw new Error('Insight skill inventory requires DSH_HOME')
    const create = (origin: InsightSkillOrigin, config: ConstructorParameters<typeof FileSystemSkillProvider>[2]): InventoryRoot => {
      const lifetime = new AbortController()
      return {
        origin,
        lifetime,
        provider: new FileSystemSkillProvider(ctx, { signal: lifetime.signal, invalidate: () => {} }, config),
      }
    }
    const bundled = process.env.DSH_BUNDLED_SKILL_DIR
    this.roots = [
      ...bundled === undefined ? [] : [create('platform', { includeDefaultRoots: false, watch: false, bundledSkillDir: bundled })],
      create('account', { includeDefaultRoots: false, watch: false, customSkillDirs: [join(home, 'skills')] }),
      create('shared', { includeDefaultRoots: false, watch: false, customSkillDirs: [join(resolveAgentsHome(), 'skills')] }),
    ]
    ctx.effect(() => async () => {
      this.accepting = false
      this.lifetime.abort(new Error('Insight skill inventory stopped'))
      await Promise.allSettled([...this.activeCalls])
      for (const root of this.roots) root.lifetime.abort(new Error('Insight skill inventory provider stopped'))
      const results = await Promise.allSettled(this.roots.map(async ({ provider }) => { await provider.dispose() }))
      const failed = results.find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    }, 'insight-desktop: skill inventory')
  }

  /**
   * Read supported roots and compare them to DSH's active Session composition.
   * @param request - Session selecting cwd and agent preset.
   * @param signal - caller cancellation.
   * @returns supported roots with selectable and unavailable states.
   */
  @Remote({ name: 'list', resources: { session: request => request.sessionId } })
  async list(request: { readonly sessionId: SessionId }, signal: AbortSignal): Promise<InsightSkillInventorySnapshot> {
    if (!this.accepting) throw new RemoteError('gateway/internal', '技能目录正在停止，请稍后重试。', {})
    const combined = AbortSignal.any([signal, this.lifetime.signal])
    combined.throwIfAborted()
    const call = this.readInventory(request.sessionId, combined)
    this.activeCalls.add(call)
    try {
      return await call
    } finally {
      this.activeCalls.delete(call)
    }
  }

  /** Read one admitted inventory call through a single caller-and-lifetime signal. */
  private async readInventory(sessionId: SessionId, signal: AbortSignal): Promise<InsightSkillInventorySnapshot> {
    const { cwd, effective } = await this.effectiveSkills(sessionId, signal)
    const entries: InsightSkillInventoryEntry[] = []
    let complete = true
    for (const root of this.roots) {
      signal.throwIfAborted()
      try {
        const observation = normalize(await root.provider.list({ cwd, signal }))
        signal.throwIfAborted()
        let rootComplete = observation.complete
        const observed: Array<{ candidate: SkillCandidate; presentation: Pick<InsightSkillInventoryEntry, 'displayName' | 'shortDescription'> }> = []
        for (const candidate of observation.candidates) {
          observed.push({ candidate, presentation: await readSkillPresentation(candidate.path, signal) })
        }
        const current = observed.flatMap(({ candidate, presentation }): RememberedEntry[] => candidate.path === undefined ? [] : [{
          name: candidate.name,
          description: candidate.description,
          ...presentation,
          path: candidate.path,
          entryPath: candidateEntryPath(candidate) ?? candidate.path,
        }])
        const retained: Array<RememberedEntry & { readonly availability: 'invalid' | 'unconfirmed' }> = []
        if (observation.complete) {
          if (root.origin !== 'platform') {
            const currentPaths = new Set(current.map(entry => skillPathKey(entry.path)))
            for (const entry of this.remembered.get(root.origin) ?? []) {
              if (currentPaths.has(skillPathKey(entry.path))) continue
              const state = await rememberedPathState(entry.entryPath, signal)
              if (state === 'present') retained.push({ ...entry, availability: 'invalid' })
              else if (state === 'unknown') {
                rootComplete = false
                retained.push({ ...entry, availability: 'unconfirmed' })
              }
            }
          }
          this.remembered.set(root.origin, [...current, ...retained.map(({ availability: _availability, ...entry }) => entry)])
        }
        complete &&= rootComplete
        for (const { candidate, presentation } of observed) {
          entries.push({
            name: candidate.name,
            description: candidate.description,
            ...presentation,
            origin: root.origin,
            availability: availabilityOf(candidate, effective, rootComplete, root.origin),
          })
        }
        entries.push(...retained.map(entry => rememberedInventoryEntry(entry, root.origin, entry.availability)))
        if (!rootComplete && !observation.complete) {
          const observedPaths = new Set(current.map(entry => skillPathKey(entry.path)))
          for (const entry of this.remembered.get(root.origin) ?? []) {
            if (!observedPaths.has(skillPathKey(entry.path))) entries.push(rememberedInventoryEntry(entry, root.origin, 'unconfirmed'))
          }
        }
      } catch (_error) {
        if (signal.aborted) throw signal.reason
        complete = false
        this.ctx.logger.warn(`Insight skill inventory could not read ${root.origin} skills.`)
        for (const entry of this.remembered.get(root.origin) ?? []) {
          entries.push(rememberedInventoryEntry(entry, root.origin, 'unconfirmed'))
        }
      }
    }
    return { entries, complete }
  }

  /** Resolve the exact cold/live registry selection used by the regular DSH skill catalog. */
  private async effectiveSkills(sessionId: SessionId, signal: AbortSignal): Promise<{
    cwd: string
    effective: readonly SkillSummary[]
  }> {
    let cwd: string
    let preset: string | undefined
    try {
      const observation = await this.ctx.sessionQuery.observeSession(sessionId, { signal })
      try {
        signal.throwIfAborted()
        if (observation.projections === undefined) throw new Error('session projections unavailable')
        cwd = observation.projections.values.workingDirectory ?? observation.header.cwd ?? this.ctx.workingDirectory.defaultDirectory
        preset = observation.projections.values.agentPreset ?? undefined
        const live = this.ctx.agents.get(sessionId)
        if (live !== undefined) cwd = await this.ctx.workingDirectory.ensure(live, signal)
        const presets = this.ctx.get('agentPresets')
        let acquired: Awaited<ReturnType<NonNullable<typeof presets>['acquireScope']>> | undefined
        try {
          if (live === undefined && presets !== undefined) {
            try {
              acquired = await presets.acquireScope(preset)
              signal.throwIfAborted()
            } catch {
              signal.throwIfAborted()
              // A recorded preset may have been removed; the native catalog falls
              // back to the global registry rather than making its drafts unreadable.
            }
          }
          const registry = (live === undefined ? undefined : presets?.serviceFor(live, 'skills')) ?? this.ctx.get('skills')
          if (registry === undefined) throw new Error('skill registry unavailable')
          const snapshot = await registry.snapshot({ cwd, scope: live ?? acquired?.key, signal })
          signal.throwIfAborted()
          return { cwd, effective: snapshot.skills }
        } finally {
          await acquired?.[Symbol.asyncDispose]()
        }
      } finally {
        observation[Symbol.dispose]()
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason
      this.ctx.logger.warn('Insight skill inventory could not resolve the current Session skill view.', error)
      throw new RemoteError('gateway/internal', '无法读取当前会话的技能目录，请稍后重试。', {})
    }
  }
}

/** Reuse installed labels without publishing provider file paths. */
function rememberedInventoryEntry(
  entry: RememberedEntry, origin: InsightSkillOrigin, availability: 'invalid' | 'unconfirmed',
): InsightSkillInventoryEntry {
  return {
    name: entry.name, description: entry.description, origin, availability,
    ...entry.displayName === undefined ? {} : { displayName: entry.displayName },
    ...entry.shortDescription === undefined ? {} : { shortDescription: entry.shortDescription },
  }
}

/** Read the filesystem provider's opaque original entry path when available. */
function candidateEntryPath(candidate: SkillCandidate): string | undefined {
  const locator = candidate.locator
  return typeof locator === 'object' && locator !== null && 'path' in locator && typeof locator.path === 'string'
    ? locator.path
    : undefined
}

/** Preserve path identity across parser failures without treating inaccessible paths as removed. */
async function rememberedPathState(path: string, signal: AbortSignal): Promise<RememberedPathState> {
  signal.throwIfAborted()
  try {
    const info = await stat(path)
    signal.throwIfAborted()
    return info.isFile() ? 'present' : 'absent'
  } catch (error) {
    signal.throwIfAborted()
    if (typeof error === 'object' && error !== null && 'code' in error
      && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return 'absent'
    return 'unknown'
  }
}

/** Normalize filesystem path identity while preserving the provider's original path. */
function skillPathKey(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  return process.platform === 'win32' || /^[a-z]:\//iu.test(normalized) ? normalized.toLowerCase() : normalized
}

/** Normalize the public provider shorthand into the complete-observation form. */
function normalize(value: readonly SkillCandidate[] | SkillProviderObservation): SkillProviderObservation {
  return 'candidates' in value ? value : { candidates: value, complete: true }
}

/** Compare a source candidate against the active registry winner without changing its precedence. */
function availabilityOf(
  candidate: SkillCandidate,
  effective: readonly SkillSummary[],
  complete: boolean,
  origin: InsightSkillOrigin,
): InsightSkillAvailability {
  if (!complete) return 'unconfirmed'
  if (!candidate.invocation.userInvocable) return 'disabled'
  const winner = effective.find(entry => entry.name === candidate.name)
  if (winner === undefined) return 'unavailable'
  const expectedSource = origin === 'platform' ? 'bundled' : origin === 'account' ? 'user-dsh' : 'user-agents'
  if (winner.path === candidate.path && winner.source === expectedSource) return 'callable'
  return 'shadowed'
}
