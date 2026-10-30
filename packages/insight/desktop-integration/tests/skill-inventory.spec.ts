import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SkillCandidate, SkillProviderObservation } from '@deepseek-ai/dsh-skill'
import { InsightSkillInventory } from '../src/host/skill-inventory.ts'

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
  it('projects isolated temporary roots against the active Session winner without reading bundled skill content', async () => {
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
    vi.stubEnv('DSH_BUNDLED_SKILL_DIR', bundled)
    vi.stubEnv('DSH_AGENTS_HOME', shared)
    const ctx = new Context()
    roots.push({ ctx, home })
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
      expect.objectContaining({ name: 'tikhub', origin: 'account', availability: 'shadowed' }),
      expect.objectContaining({ name: 'disabled-skill', origin: 'account', availability: 'disabled' }),
      expect.objectContaining({ name: 'shared-skill', origin: 'shared', availability: 'unavailable' }),
    ]))

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
    if (root === undefined) throw new Error('expected account inventory root')
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
