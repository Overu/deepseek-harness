/** Discovery and removal for the Insight skill directory and composer picker. */
import { createHash } from 'node:crypto'
import { lstat, readdir, realpath, rmdir, stat, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveAgentsHome } from '@deepseek-ai/dsh-home-paths'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import type { SkillCandidate, SkillProvider, SkillProviderObservation, SkillSummary } from '@deepseek-ai/dsh-skill'
import type {} from '@insight-ai/skill-center'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-working-directory'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {
  InsightCustomSkillId, InsightCustomSkillSnapshot,
  InsightSkillAvailability, InsightSkillInventoryEntry, InsightSkillInventorySnapshot, InsightSkillOrigin,
} from '../shared/skill-inventory.ts'
import { isCustomSkillOrigin } from '../shared/skill-inventory.ts'
import { readSkillPresentation } from './skill-presentation.ts'

export type {
  InsightCustomSkillEntry, InsightCustomSkillId, InsightCustomSkillSnapshot,
  InsightSkillAvailability, InsightSkillInventoryEntry, InsightSkillInventorySnapshot, InsightSkillOrigin,
} from '../shared/skill-inventory.ts'

interface InventoryRoot {
  readonly origin: InsightSkillOrigin
  readonly directory?: string
  readonly provider: Pick<SkillProvider, 'list'> & Pick<FileSystemSkillProvider, 'dispose'>
  readonly lifetime: AbortController
}

interface RememberedEntry extends Pick<InsightSkillInventoryEntry, 'customId' | 'displayName' | 'shortDescription'> {
  readonly name: string
  readonly description: string
  /** Canonical provider path used only as the stable candidate identity. */
  readonly path: string
  /** Original installed entry path used to distinguish invalid content from deletion. */
  readonly entryPath: string
}

type RememberedPathState = 'present' | 'absent' | 'unknown'

/** Remote inventory for the expert-skill picker and account-level custom skill page. */
export class InsightSkillInventory extends TypertRemoteService {
  static inject = ['agents', 'sessionQuery', 'workingDirectory', 'typert']
  private readonly lifetime = new AbortController()
  private readonly roots: readonly InventoryRoot[]
  private readonly systemDirectories: readonly string[]
  private readonly remembered = new Map<InsightSkillOrigin, readonly RememberedEntry[]>()
  private readonly activeCalls = new Set<Promise<unknown>>()
  private accepting = true

  /**
   * @param ctx - Host services used to resolve the Session's exact effective skill registry.
   * @param systemDirectories - Bundled and platform directories protected from custom removal.
   */
  constructor(ctx: Context, systemDirectories: readonly string[] = []) {
    super(ctx, 'insightSkillInventory', { namespace: 'insightSkills' })
    const home = process.env.DSH_HOME
    if (home === undefined || home.length === 0) throw new Error('Insight skill inventory requires DSH_HOME')
    const create = (origin: 'account' | 'shared', path: string): InventoryRoot => {
      const lifetime = new AbortController()
      const directory = resolve(path)
      return {
        origin,
        directory,
        lifetime,
        provider: new FileSystemSkillProvider(ctx, { signal: lifetime.signal, invalidate: () => {} }, {
          includeDefaultRoots: false, watch: false, customSkillDirs: [directory],
        }),
      }
    }
    this.roots = [
      {
        origin: 'platform',
        lifetime: new AbortController(),
        provider: {
          list: async options => await this.ctx.get('insightPlatformSkills')?.listCandidates(options) ?? [],
          dispose: async () => {},
        },
      },
      {
        origin: 'legacy',
        lifetime: new AbortController(),
        provider: {
          list: async options => await this.ctx.get('insightPlatformSkills')?.listLegacyCandidates(options) ?? [],
          dispose: async () => {},
        },
      },
      create('account', join(home, 'skills')),
      create('shared', join(resolveAgentsHome(), 'skills')),
    ]
    this.systemDirectories = [...systemDirectories,
      ...this.roots.flatMap(root => root.directory === undefined ? [] : [join(root.directory, '.system')]),
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

  /**
   * Read account and shared skills without resolving a Session skill registry.
   * @param signal - Caller cancellation.
   * @returns locally discovered custom skills and whether every source completed.
   */
  @Remote({ name: 'listCustom' })
  async listCustom(signal: AbortSignal): Promise<InsightCustomSkillSnapshot> {
    if (!this.accepting) throw new RemoteError('gateway/internal', '自定义技能目录正在停止，请稍后重试。', {})
    const combined = AbortSignal.any([signal, this.lifetime.signal])
    combined.throwIfAborted()
    const call = this.readInventory(undefined, combined)
    this.activeCalls.add(call)
    try {
      const { entries, complete } = await call
      return {
        complete,
        entries: entries.flatMap(({ customId, origin, availability, ...entry }) =>
          customId === undefined || !isCustomSkillOrigin(origin) ? [] : [{
            ...entry, id: customId, origin, removable: availability !== 'invalid' && availability !== 'unconfirmed',
          }]),
      }
    } finally {
      this.activeCalls.delete(call)
    }
  }

  /**
   * Delete one current custom installation without following an installed symbolic link.
   * Directory removal keeps the manifest until its other files are removed; an I/O failure may leave a partial deletion.
   * @param request - Opaque identity returned by custom skill discovery.
   * @param signal - Cancellation is honored before deletion begins.
   */
  @Remote({ name: 'removeCustom' })
  async removeCustom(request: { readonly id: InsightCustomSkillId }, signal: AbortSignal): Promise<void> {
    if (!this.accepting) throw new RemoteError('gateway/internal', '自定义技能目录正在停止，请稍后重试。', {})
    const combined = AbortSignal.any([signal, this.lifetime.signal])
    combined.throwIfAborted()
    const call = (async () => {
      for (const root of this.roots) {
        if (root.directory === undefined || !request.id.startsWith(`${root.origin}:`)) continue
        const protectedPaths = await this.systemPaths(combined)
        const observation = await this.observeRoot(root, undefined, combined, protectedPaths)
        if (!observation.complete) continue
        const candidate = observation.candidates.find(entry => customSkillId(root.origin, entry) === request.id)
        if (candidate?.path === undefined) continue
        const path = customEntryPath(root.directory, candidateEntryPath(candidate))
        if (path === undefined) continue
        const directory = await realpath(root.directory)
        const target = join(directory, path[0])
        if (!samePath(await realpath(join(directory, ...path)), candidate.path)
          || protectedPaths.some(system => pathsOverlap(system, target))) break
        const installed = await lstat(target)
        combined.throwIfAborted()
        if (installed.isSymbolicLink() || (path.length === 1 && installed.isFile())) {
          await unlink(target)
        } else if (path.length === 2 && installed.isDirectory()) {
          await removeSkillDirectory(target, true)
        } else break
        return
      }
      throw new RemoteError('gateway/internal', '找不到可删除的自定义技能，请刷新列表。', {})
    })()
    this.activeCalls.add(call)
    try {
      await call
    } catch (error) {
      if (combined.aborted && error === combined.reason) throw error
      if (error instanceof RemoteError) throw error
      this.ctx.logger.warn('Insight custom skill removal failed.', error)
      throw new RemoteError('gateway/internal', '无法删除自定义技能，请稍后重试。', {})
    } finally {
      this.activeCalls.delete(call)
    }
  }

  /** Protect configured system entry points and their resolved directories. */
  private async systemPaths(signal: AbortSignal): Promise<readonly string[]> {
    const paths = new Set<string>()
    for (const directory of this.systemDirectories) {
      signal.throwIfAborted()
      paths.add(resolve(directory))
      try {
        paths.add(await realpath(directory))
      } catch (error) {
        if (!isMissingPath(error)) throw error
      }
    }
    return [...paths]
  }

  /** Apply one custom source and identity policy to the picker, directory, and removal. */
  private async observeRoot(
    root: InventoryRoot, cwd: string | undefined, signal: AbortSignal, protectedPaths: readonly string[],
  ): Promise<SkillProviderObservation> {
    signal.throwIfAborted()
    const observation = normalize(await root.provider.list({ cwd, signal }))
    signal.throwIfAborted()
    if (root.directory === undefined) return observation
    const byPath = new Map<string, SkillCandidate>()
    let canonicalRoot: string | undefined
    let complete = observation.complete
    for (const candidate of observation.candidates) {
      if (candidate.path === undefined) {
        complete = false
        continue
      }
      const entry = customEntryPath(root.directory, candidateEntryPath(candidate))
      if (entry === undefined || isSystemEntry(root.directory, entry[0], candidate.path, protectedPaths)) continue
      const key = skillPathKey(candidate.path)
      // Prefer the installed entry over a second link to it in the same directory.
      if (byPath.has(key)) {
        canonicalRoot ??= await realpath(root.directory)
        signal.throwIfAborted()
        if (!samePath(candidate.path, join(canonicalRoot, ...entry))) continue
      }
      byPath.set(key, candidate)
    }
    return { candidates: [...byPath.values()], complete }
  }

  /** Read one admitted inventory call through a single caller-and-lifetime signal. */
  private async readInventory(sessionId: SessionId | undefined, signal: AbortSignal): Promise<InsightSkillInventorySnapshot> {
    const session = sessionId === undefined ? undefined : await this.effectiveSkills(sessionId, signal)
    const entries: InsightSkillInventoryEntry[] = []
    let complete = true
    for (const root of this.roots) {
      if (session === undefined && !isCustomSkillOrigin(root.origin)) continue
      signal.throwIfAborted()
      try {
        const protectedPaths = root.directory === undefined ? [] : await this.systemPaths(signal)
        const observation = await this.observeRoot(root, session?.cwd, signal, protectedPaths)
        const remembered = (this.remembered.get(root.origin) ?? []).filter((entry) => {
          if (root.directory === undefined) return true
          const path = customEntryPath(root.directory, entry.entryPath)
          return path !== undefined && !isSystemEntry(root.directory, path[0], entry.path, protectedPaths)
        })
        let rootComplete = observation.complete
        const observed: Array<{ candidate: SkillCandidate; presentation: Pick<InsightSkillInventoryEntry, 'customId' | 'displayName' | 'shortDescription'> }> = []
        for (const candidate of observation.candidates) {
          const presentation = await readSkillPresentation(candidate.path, signal)
          const customId = root.directory === undefined ? undefined : customSkillId(root.origin, candidate)
          observed.push({ candidate, presentation: { ...presentation, ...customId === undefined ? {} : { customId } } })
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
            for (const entry of remembered) {
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
            availability: availabilityOf(candidate, session?.effective ?? [], rootComplete, root.origin),
          })
        }
        entries.push(...retained.map(entry => rememberedInventoryEntry(entry, root.origin, entry.availability)))
        if (!rootComplete && !observation.complete) {
          const observedPaths = new Set(current.map(entry => skillPathKey(entry.path)))
          for (const entry of remembered) {
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

/** Derive a stable opaque id without exposing the local skill path to the browser. */
function customSkillId(origin: InsightSkillOrigin, candidate: SkillCandidate): InsightCustomSkillId | undefined {
  const entryPath = candidateEntryPath(candidate)
  if (entryPath === undefined || candidate.path === undefined) return undefined
  const fingerprint = createHash('sha256')
    .update(skillPathKey(entryPath)).update('\0').update(skillPathKey(candidate.path)).digest('base64url')
  return brandString<InsightCustomSkillId>(`${origin}:${fingerprint}`)
}

/** Reuse installed labels without publishing provider file paths. */
function rememberedInventoryEntry(
  entry: RememberedEntry, origin: InsightSkillOrigin, availability: 'invalid' | 'unconfirmed',
): InsightSkillInventoryEntry {
  return {
    name: entry.name, description: entry.description, origin, availability,
    ...entry.customId === undefined ? {} : { customId: entry.customId },
    ...entry.displayName === undefined ? {} : { displayName: entry.displayName },
    ...entry.shortDescription === undefined ? {} : { shortDescription: entry.shortDescription },
  }
}

/** Validate the locator as a single installed file or a single skill directory. */
function customEntryPath(root: string, path: string | undefined): [string] | [string, 'SKILL.md'] | undefined {
  if (path === undefined || !containsPath(root, path)) return undefined
  const parts = relative(root, path).split(sep)
  const name = parts[0]
  if (!name || skillPathKey(name) === '.system') return undefined
  if (parts.length === 1 && name.endsWith('.md')) return [name]
  if (parts.length === 2 && parts[1] === 'SKILL.md') return [name, 'SKILL.md']
  return undefined
}

/** Classify custom entries that overlap a configured system directory or its link. */
function isSystemEntry(root: string, entry: string, file: string, protectedPaths: readonly string[]): boolean {
  const target = join(root, entry)
  return protectedPaths.some(system => pathsOverlap(system, target) || containsPath(system, file))
}

/** Match a parent or child so neither system directories nor their ancestors can be removed. */
function pathsOverlap(left: string, right: string): boolean {
  return containsPath(left, right) || containsPath(right, left)
}

/** Check containment without accepting sibling prefixes or a different Windows volume. */
function containsPath(root: string, path: string): boolean {
  const child = relative(root, path)
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

/** Delete a payload without following links. Keep its manifest available until the other files are gone. */
async function removeSkillDirectory(directory: string, hasManifest = false): Promise<void> {
  const names = await readdir(directory)
  const manifest = hasManifest ? names.find(name => name === 'SKILL.md')
    ?? names.find(name => name.toLowerCase() === 'skill.md') : undefined
  for (const name of names) {
    if (name === manifest) continue
    const path = join(directory, name)
    const entry = await lstat(path)
    if (!entry.isSymbolicLink() && entry.isDirectory()) await removeSkillDirectory(path)
    else await unlink(path)
  }
  if (manifest !== undefined) await unlink(join(directory, manifest))
  await rmdir(directory)
}

/** Compare canonical or provider paths without changing the stored path. */
function samePath(left: string, right: string | undefined): boolean {
  return right !== undefined && skillPathKey(left) === skillPathKey(right)
}

/** Recognize a disappeared path without hiding permission or other I/O failures. */
function isMissingPath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
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
    if (isMissingPath(error)) return 'absent'
    return 'unknown'
  }
}

/** Normalize filesystem path identity while preserving the provider's original path. */
function skillPathKey(path: string): string {
  return process.platform === 'win32' ? path.replaceAll('\\', '/').toLowerCase() : path
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
  const expectedSource = origin === 'platform' || origin === 'legacy' ? 'bundled' : origin === 'account' ? 'user-dsh' : 'user-agents'
  if (winner.path === candidate.path && winner.source === expectedSource) return 'callable'
  return 'shadowed'
}
