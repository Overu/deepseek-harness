import { afterEach, describe, expect, it, vi } from 'vitest'
import { lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SkillCandidate, SkillLookupOptions, SkillProviderObservation } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { InsightSkillInventory } from '../src/host/skill-inventory.ts'
import { isCustomSkillOrigin, type InsightCustomSkillId } from '../src/shared/skill-inventory.ts'

const roots: Array<{ readonly ctx: Context; readonly home: string }> = []

function controlled<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(async ({ ctx, home }) => {
    await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  }))
})

async function skill(root: string, name: string, description: string, frontmatter = ''): Promise<string> {
  const directory = join(root, name)
  const path = join(directory, 'SKILL.md')
  await mkdir(directory, { recursive: true })
  await writeFile(path, `---\nname: ${name}\ndescription: ${description}\n${frontmatter}---\n\n# ${name}\n`)
  return path
}

describe('InsightSkillInventory', () => {
  it('projects installed and legacy bundled skills against the active Session winner', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-insight-inventory-'))
    const bundled = join(home, 'bundled')
    const account = join(home, 'account')
    const shared = join(home, 'shared')
    const bundledTikhub = await skill(bundled, 'tikhub', '内置检索')
    await writeFile(join(dirname(bundledTikhub), 'ui.json'), JSON.stringify({ displayName: '内置检索专家', shortDescription: '查询公开信息' }))
    await skill(join(account, 'skills'), 'tikhub', '账号同名版本')
    await skill(join(account, 'skills'), 'disabled-skill', '禁用技能', 'user-invocable: false\n')
    await skill(join(shared, 'skills'), 'shared-skill', '共享技能')
    vi.stubEnv('DSH_HOME', account)
    const legacy = join(home, 'legacy-bundled')
    await skill(legacy, 'legacy-only', 'Removed bundled skill')
    vi.stubEnv('DSH_BUNDLED_SKILL_DIR', legacy)
    vi.stubEnv('DSH_AGENTS_HOME', shared)
    const ctx = new Context()
    roots.push({ ctx, home })
    const platform = new FileSystemSkillProvider(ctx, {
      signal: new AbortController().signal, invalidate: () => {},
    }, { includeDefaultRoots: false, watch: false, bundledSkillDir: bundled })
    ctx.effect(() => async () => { await platform.dispose() })
    const legacyProvider = new FileSystemSkillProvider(ctx, {
      signal: new AbortController().signal, invalidate: () => {},
    }, { includeDefaultRoots: false, watch: false, bundledSkillDir: legacy })
    ctx.effect(() => async () => { await legacyProvider.dispose() })
    const legacyListed = await legacyProvider.list({ cwd: home })
    const legacyCandidates = 'candidates' in legacyListed ? legacyListed.candidates : legacyListed
    const legacyPath = legacyCandidates.find(candidate => candidate.name === 'legacy-only')?.path
    if (legacyPath === undefined) throw new Error('expected legacy bundled skill')
    ctx.provide('insightPlatformSkills', {
      listCandidates: async (options: SkillLookupOptions) => await platform.list(options),
      listLegacyCandidates: async (options: SkillLookupOptions) => await legacyProvider.list(options),
    } as never)
    const sessionId = brandString<SessionId>('session-inventory')
    let winnerPath = bundledTikhub
    ctx.provide('agents', { get: () => undefined } as never)
    ctx.provide('sessionQuery', {
      observeSession: async () => ({
        header: { cwd: home }, projections: { values: {} },
        [Symbol.dispose]: () => {},
      }),
    } as never)
    ctx.provide('workingDirectory', { defaultDirectory: home } as never)
    ctx.provide('skills', {
      snapshot: async () => ({
        complete: true,
        skills: [{
          name: 'tikhub', description: '内置检索', path: winnerPath, source: 'bundled', provider: 'filesystem',
          invocation: { modelInvocable: true, userInvocable: true },
        }, {
          name: 'legacy-only', description: 'Removed bundled skill', path: legacyPath, source: 'bundled', provider: 'filesystem',
          invocation: { modelInvocable: true, userInvocable: true },
        }],
      }),
    } as never)
    const inventory = new InsightSkillInventory(ctx)
    const root = (Reflect.get(inventory, 'roots') as readonly {
      provider: { list(options: { cwd: string }): Promise<readonly SkillCandidate[] | SkillProviderObservation> }
    }[])[0]
    if (root === undefined) throw new Error('expected temporary bundled inventory root')
    const listed = await root.provider.list({ cwd: home })
    const candidates = 'candidates' in listed ? listed.candidates : listed
    winnerPath = candidates.find(candidate => candidate.name === 'tikhub')?.path ?? bundledTikhub

    const warn = vi.spyOn(ctx.logger, 'warn')
    let snapshot
    try {
      snapshot = await inventory.list({ sessionId }, new AbortController().signal)
    } catch {
      throw new Error(String(warn.mock.calls.at(-1)))
    }
    expect(warn).not.toHaveBeenCalled()

    expect(snapshot.complete).toBe(true)
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'tikhub', origin: 'platform', availability: 'callable', displayName: '内置检索专家', shortDescription: '查询公开信息' }),
      expect.objectContaining({ name: 'legacy-only', origin: 'legacy', availability: 'callable' }),
      expect.objectContaining({ name: 'tikhub', origin: 'account', availability: 'shadowed' }),
      expect.objectContaining({ name: 'disabled-skill', origin: 'account', availability: 'disabled' }),
      expect.objectContaining({ name: 'shared-skill', origin: 'shared', availability: 'unavailable' }),
    ]))
    const custom = await inventory.listCustom(new AbortController().signal)
    expect(custom.entries.map(({ id, removable: _removable, ...entry }) => ({ ...entry, customId: id })))
      .toEqual(snapshot.entries.filter(entry => isCustomSkillOrigin(entry.origin))
        .map(({ availability: _availability, ...entry }) => entry))
    expect(custom.entries.every(entry => entry.removable)).toBe(true)

    vi.spyOn(root.provider, 'list').mockResolvedValueOnce({ candidates: [], complete: false })
    const incomplete = await inventory.list({ sessionId }, new AbortController().signal)
    expect(incomplete.complete).toBe(false)
    expect(incomplete.entries).toContainEqual(expect.objectContaining({
      name: 'tikhub', origin: 'platform', availability: 'unconfirmed',
    }))

    vi.spyOn(root.provider, 'list').mockRejectedValueOnce(new Error('temporary read failure'))
    const failed = await inventory.list({ sessionId }, new AbortController().signal)
    expect(failed.complete).toBe(false)
    expect(failed.entries).toContainEqual(expect.objectContaining({
      name: 'tikhub', origin: 'platform', availability: 'unconfirmed',
    }))
  })

  it.each([
    { origin: 'account' as const, source: 'user-dsh' as const },
    { origin: 'shared' as const, source: 'user-agents' as const },
  ])('keeps a known $origin skill invalid until it is repaired or truly deleted', async ({ origin, source }) => {
    const home = await mkdtemp(join(tmpdir(), `dsh-insight-inventory-invalid-${origin}-`))
    const agentsHome = join(home, 'agents')
    const root = origin === 'account' ? join(home, 'skills') : join(agentsHome, 'skills')
    const file = await skill(root, 'recoverable-skill', 'Recoverable skill')
    await writeFile(join(dirname(file), 'ui.json'), JSON.stringify({ displayName: '可恢复技能', shortDescription: '保留展示文案' }))
    const canonical = await realpath(file)
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_AGENTS_HOME', agentsHome)
    const ctx = new Context()
    roots.push({ ctx, home })
    const sessionId = brandString<SessionId>(`session-invalid-${origin}`)
    let effective: readonly {
      name: string
      description: string
      path: string
      source: 'user-dsh' | 'user-agents'
      provider: string
      invocation: { modelInvocable: boolean; userInvocable: boolean }
    }[] = [{
      name: 'recoverable-skill',
      description: 'Recoverable skill',
      path: canonical,
      source,
      provider: 'filesystem',
      invocation: { modelInvocable: true, userInvocable: true },
    }]
    ctx.provide('agents', { get: () => undefined } as never)
    ctx.provide('sessionQuery', {
      observeSession: async () => ({
        header: { cwd: home }, projections: { values: {} },
        [Symbol.dispose]: () => {},
      }),
    } as never)
    ctx.provide('workingDirectory', { defaultDirectory: home } as never)
    ctx.provide('skills', { snapshot: async () => ({ complete: true, skills: effective }) } as never)
    const inventory = new InsightSkillInventory(ctx)

    const valid = await inventory.list({ sessionId }, new AbortController().signal)
    expect(valid.entries).toContainEqual(expect.objectContaining({
      name: 'recoverable-skill', origin, availability: 'callable', displayName: '可恢复技能', shortDescription: '保留展示文案',
    }))

    const sourceRoot = (Reflect.get(inventory, 'roots') as readonly {
      origin: string
      provider: { list(options: { cwd: string }): Promise<SkillProviderObservation> }
    }[]).find(entry => entry.origin === origin)
    if (sourceRoot === undefined) throw new Error('expected inventory source')
    vi.spyOn(sourceRoot.provider, 'list').mockResolvedValueOnce({ complete: false, candidates: [] })
    const partial = await inventory.list({ sessionId }, new AbortController().signal)
    expect(partial.entries).toContainEqual(expect.objectContaining({
      name: 'recoverable-skill', origin, availability: 'unconfirmed', displayName: '可恢复技能', shortDescription: '保留展示文案',
    }))

    await writeFile(file, '---\nname: [invalid yaml\n---\n')
    effective = []
    const invalid = await inventory.list({ sessionId }, new AbortController().signal)
    expect(invalid.complete).toBe(true)
    expect(invalid.entries.filter(entry => entry.name === 'recoverable-skill')).toEqual([
      expect.objectContaining({ origin, availability: 'invalid', displayName: '可恢复技能', shortDescription: '保留展示文案' }),
    ])

    await skill(root, 'recoverable-skill', 'Recovered skill')
    effective = [{
      name: 'recoverable-skill',
      description: 'Recovered skill',
      path: canonical,
      source,
      provider: 'filesystem',
      invocation: { modelInvocable: true, userInvocable: true },
    }]
    const repaired = await inventory.list({ sessionId }, new AbortController().signal)
    expect(repaired.entries.filter(entry => entry.name === 'recoverable-skill')).toEqual([
      expect.objectContaining({ description: 'Recovered skill', origin, availability: 'callable' }),
    ])

    await rm(join(root, 'recoverable-skill'), { recursive: true, force: true })
    effective = []
    const removed = await inventory.list({ sessionId }, new AbortController().signal)
    expect(removed.entries.some(entry => entry.name === 'recoverable-skill')).toBe(false)
  })

  it('stops admission and waits for active Remote reads before disposing their providers', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-insight-inventory-drain-'))
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_AGENTS_HOME', join(home, 'agents'))
    const ctx = new Context()
    roots.push({ ctx, home })
    const sessionId = brandString<SessionId>('session-inventory-drain')
    let sessionSignal: AbortSignal | undefined
    let registrySignal: AbortSignal | undefined
    ctx.provide('agents', { get: () => undefined } as never)
    ctx.provide('sessionQuery', {
      observeSession: async (_id: SessionId, options: { signal: AbortSignal }) => {
        sessionSignal = options.signal
        options.signal.throwIfAborted()
        return {
          header: { cwd: home }, projections: { values: {} },
          [Symbol.dispose]: () => {},
        }
      },
    } as never)
    ctx.provide('workingDirectory', { defaultDirectory: home } as never)
    ctx.provide('skills', {
      snapshot: async (options: { signal: AbortSignal }) => {
        registrySignal = options.signal
        return { complete: true, skills: [] }
      },
    } as never)
    const inventory = new InsightSkillInventory(ctx)
    const root = (Reflect.get(inventory, 'roots') as readonly {
      provider: { list(options: { signal: AbortSignal }): Promise<readonly SkillCandidate[]>; dispose(): Promise<void> }
    }[])[0]
    if (root === undefined) throw new Error('expected platform inventory root')
    const started = controlled<AbortSignal>()
    const release = controlled<readonly SkillCandidate[]>()
    vi.spyOn(root.provider, 'list').mockImplementation(async (options) => {
      started.resolve(options.signal)
      return await release.promise
    })
    const disposeProvider = vi.spyOn(root.provider, 'dispose')
    const pending = inventory.list({ sessionId }, new AbortController().signal)
    const operationSignal = await started.promise

    expect(sessionSignal).toBe(operationSignal)
    expect(registrySignal).toBe(operationSignal)

    let disposed = false
    const disposal = ctx.fiber.dispose().then(() => { disposed = true })
    await Promise.resolve()

    expect(operationSignal.aborted).toBe(true)
    expect(disposed).toBe(false)
    expect(disposeProvider).not.toHaveBeenCalled()

    release.resolve([])
    await expect(pending).rejects.toThrow('Insight skill inventory stopped')
    await disposal
    expect(disposeProvider).toHaveBeenCalled()
  })
})

describe('InsightCustomSkillInventory', () => {
  it('returns account and shared skills with stable opaque ids', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-insight-custom-inventory-'))
    const agents = join(home, 'agents')
    const accountPath = await skill(join(home, 'skills'), 'same-name', '账号技能')
    await writeFile(join(dirname(accountPath), 'ui.json'), JSON.stringify({ displayName: '账号展示名', shortDescription: '账号简介' }))
    await symlink(join(home, 'skills', 'same-name'), join(home, 'skills', 'same-name-alias'), 'dir')
    await skill(join(agents, 'skills'), 'same-name', '共享技能')
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_AGENTS_HOME', agents)
    const ctx = new Context()
    roots.push({ ctx, home })
    const inventory = new InsightSkillInventory(ctx)

    const first = await inventory.listCustom(new AbortController().signal)
    const second = await inventory.listCustom(new AbortController().signal)

    expect(first.complete).toBe(true)
    expect(first.entries).toHaveLength(2)
    expect(first.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'same-name', description: '账号技能', origin: 'account', displayName: '账号展示名', shortDescription: '账号简介' }),
      expect.objectContaining({ name: 'same-name', description: '共享技能', origin: 'shared' }),
    ]))
    expect(first.entries.map(entry => entry.id)).toEqual(second.entries.map(entry => entry.id))
    expect(JSON.stringify(first)).not.toContain(home)
  })

  it('deletes only the selected installation and unlinks a linked skill without touching its target', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-insight-custom-remove-'))
    const agents = join(home, 'agents')
    const account = join(home, 'skills')
    const accountPath = await skill(account, 'same-name', '账号技能')
    const shared = join(agents, 'skills')
    await mkdir(shared, { recursive: true })
    const sharedPath = join(shared, 'standalone.md')
    await writeFile(sharedPath, '---\nname: same-name\ndescription: 共享技能\n---\n')
    const outside = await skill(join(home, 'external'), 'linked', '链接技能')
    await symlink(dirname(outside), join(account, 'linked'), 'junction')
    const owned = await skill(account, 'owned', '独立技能')
    await symlink(dirname(outside), join(dirname(owned), 'linked-resource'), 'junction')
    const system = join(account, '.system', 'SKILL.md')
    await mkdir(dirname(system))
    await writeFile(system, '---\nname: built-in\ndescription: 系统技能\n---\n')
    await symlink(dirname(system), join(account, 'system-alias'), 'junction')
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_AGENTS_HOME', agents)
    const ctx = new Context()
    roots.push({ ctx, home })
    const legacyLink = join(account, 'legacy-link')
    const inventory = new InsightSkillInventory(ctx, [legacyLink])
    const { signal } = new AbortController()
    const listed = await inventory.listCustom(signal)
    const entries = Object.fromEntries(listed.entries.map(entry => [entry.description, entry.id]))
    expect(Object.keys(entries)).toEqual(['链接技能', '独立技能', '账号技能', '共享技能'])

    await expect(inventory.removeCustom({ id: brandString<InsightCustomSkillId>(outside) }, signal)).rejects.toThrow()
    await symlink(dirname(accountPath), legacyLink, 'junction')
    await expect(inventory.removeCustom({ id: entries['账号技能']! }, signal)).rejects.toThrow()
    await inventory.removeCustom({ id: entries['链接技能']! }, signal)
    await inventory.removeCustom({ id: entries['独立技能']! }, signal)
    await inventory.removeCustom({ id: entries['共享技能']! }, signal)

    await expect(lstat(join(account, 'linked'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(dirname(owned))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(sharedPath)).rejects.toMatchObject({ code: 'ENOENT' })
    for (const path of [accountPath, outside, system, legacyLink]) await expect(lstat(path)).resolves.toBeDefined()
    expect((await inventory.listCustom(signal)).entries).toEqual([])
  })

  it('keeps readable custom roots visible when another root is incomplete or fails', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-insight-custom-inventory-partial-'))
    const agents = join(home, 'agents')
    await skill(join(home, 'skills'), 'account-skill', '账号技能')
    await skill(join(agents, 'skills'), 'shared-skill', '共享技能')
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_AGENTS_HOME', agents)
    const ctx = new Context()
    roots.push({ ctx, home })
    const inventory = new InsightSkillInventory(ctx)
    const customRoots = Reflect.get(inventory, 'roots') as readonly {
      readonly origin: 'account' | 'shared'
      readonly provider: { list(options: { signal: AbortSignal }): Promise<SkillProviderObservation> }
    }[]
    const shared = customRoots.find(root => root.origin === 'shared')
    if (shared === undefined) throw new Error('expected shared custom skill root')

    vi.spyOn(shared.provider, 'list').mockResolvedValueOnce({ candidates: [], complete: false })
    const incomplete = await inventory.listCustom(new AbortController().signal)
    expect(incomplete).toMatchObject({ complete: false, entries: [expect.objectContaining({ name: 'account-skill', origin: 'account' })] })

    vi.spyOn(shared.provider, 'list').mockRejectedValueOnce(new Error('unavailable'))
    const failed = await inventory.listCustom(new AbortController().signal)
    expect(failed).toMatchObject({ complete: false, entries: [expect.objectContaining({ name: 'account-skill', origin: 'account' })] })
  })

  it('marks a pathless candidate incomplete without returning an unstable entry', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-insight-custom-inventory-pathless-'))
    await skill(join(home, 'skills'), 'account-skill', '账号技能')
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_AGENTS_HOME', join(home, 'agents'))
    const ctx = new Context()
    roots.push({ ctx, home })
    const inventory = new InsightSkillInventory(ctx)
    const customRoots = Reflect.get(inventory, 'roots') as readonly {
      readonly origin: 'account' | 'shared'
      readonly provider: { list(options: { signal: AbortSignal }): Promise<readonly SkillCandidate[] | SkillProviderObservation> }
    }[]
    const account = customRoots.find(root => root.origin === 'account')
    if (account === undefined) throw new Error('expected account custom skill root')
    const listed = await account.provider.list({ signal: new AbortController().signal })
    const candidate = ('candidates' in listed ? listed.candidates : listed)[0]
    if (candidate === undefined) throw new Error('expected account custom skill candidate')

    const { path: _path, ...pathless } = candidate
    vi.spyOn(account.provider, 'list').mockResolvedValueOnce({ candidates: [pathless], complete: true })
    await expect(inventory.listCustom(new AbortController().signal)).resolves.toEqual({ complete: false, entries: [] })
  })

  it('cancels in-flight custom reads, waits for the provider, and rejects later admission', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-insight-custom-inventory-drain-'))
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_AGENTS_HOME', join(home, 'agents'))
    const ctx = new Context()
    roots.push({ ctx, home })
    const inventory = new InsightSkillInventory(ctx)
    const customRoots = Reflect.get(inventory, 'roots') as readonly {
      readonly origin: 'account' | 'shared'
      readonly provider: {
        list(options: { signal: AbortSignal }): Promise<readonly SkillCandidate[]>
        dispose(): Promise<void>
      }
    }[]
    const account = customRoots.find(root => root.origin === 'account')
    if (account === undefined) throw new Error('expected account custom skill root')
    const started = controlled<AbortSignal>()
    const release = controlled<readonly SkillCandidate[]>()
    const list = vi.spyOn(account.provider, 'list').mockImplementation(async ({ signal }) => {
      started.resolve(signal)
      return await release.promise
    })
    const disposeProvider = vi.spyOn(account.provider, 'dispose')
    const pending = inventory.listCustom(new AbortController().signal)
    const signal = await started.promise

    let disposed = false
    const disposal = ctx.fiber.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(signal.aborted).toBe(true)
    expect(disposed).toBe(false)
    expect(disposeProvider).not.toHaveBeenCalled()

    release.resolve([])
    await expect(pending).rejects.toThrow('Insight skill inventory stopped')
    await disposal
    expect(disposeProvider).toHaveBeenCalled()
    await expect(inventory.listCustom(new AbortController().signal)).rejects.toMatchObject({ code: 'gateway/internal' })
    expect(list).toHaveBeenCalledOnce()
  })
})
