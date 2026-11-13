/** Atomic platform-skill installation and cancellation behavior. */
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { strToU8, zipSync } from 'fflate'
import { expect, it, onTestFinished, vi } from 'vitest'
import { Config } from '../src/config.ts'
import { InsightPlatformSkills } from '../src/host/platform-skills.ts'
import type {
  InstalledPlatformSkill,
  InsightSkillId,
  PlatformSkillInstallProgress,
  PlatformSkillOperationId,
  SkillIdentity,
} from '../src/types.ts'

const origin = 'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com'

function archive(body: string, skillName = 'invoked-name', root = 'catalog-id'): Uint8Array {
  return new Uint8Array(zipSync({
    [`${root}/SKILL.md`]: strToU8(`---\nname: ${skillName}\ndescription: Installed expert\n---\n\n${body}\n`),
  }))
}

function response(bytes: Uint8Array, url: string): Response {
  const value = new Response(new Uint8Array(bytes))
  Object.defineProperty(value, 'url', { value: url })
  return value
}

async function fixture(fetcher: typeof fetch, config: Partial<Config> = {}): Promise<{
  readonly home: string
  readonly ctx: Context
  readonly service: InsightPlatformSkills
}> {
  const home = await mkdtemp(join(tmpdir(), 'insight-platform-skills-'))
  const ctx = new Context()
  vi.stubEnv('DSH_HOME', home)
  vi.stubGlobal('fetch', fetcher)
  await ctx.plugin(SkillRegistry)
  const service = new InsightPlatformSkills(ctx, Config(config))
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true })
  })
  return { home, ctx, service }
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

function request(version: string, operation: string) {
  return {
    id: brandString<InsightSkillId>('catalog-id'),
    skillName: 'invoked-name',
    version,
    operationId: brandString<PlatformSkillOperationId>(operation),
    downloadUrl: `${origin}/desktop/skills/catalog-id.zip`,
  }
}

function identityRequest(
  version: string,
  operation: string,
  identity: SkillIdentity,
) {
  const common = {
    skillName: identity.skillName,
    version,
    operationId: brandString<PlatformSkillOperationId>(operation),
    downloadUrl: `${origin}/desktop/skills/catalog-id.zip`,
  }
  return identity.id === undefined ? common : { ...common, id: identity.id }
}

async function onlyInstalled(service: InsightPlatformSkills): Promise<InstalledPlatformSkill> {
  const skills = (await service.listInstalled()).skills
  if (skills.length !== 1 || skills[0] === undefined) throw new Error('Expected exactly one installed skill.')
  return skills[0]
}

function removalRequest(skill: InstalledPlatformSkill) {
  const request = { key: skill.key, skillName: skill.skillName }
  return skill.id === undefined ? request : { ...request, id: skill.id }
}

async function removeInstalled(service: InsightPlatformSkills, signal: AbortSignal): Promise<void> {
  const [skill] = (await service.listInstalled()).skills
  if (skill === undefined) throw new Error('Expected an installed skill.')
  await service.remove(removalRequest(skill), signal)
}

async function collect(iterable: AsyncIterable<PlatformSkillInstallProgress>): Promise<PlatformSkillInstallProgress[]> {
  const frames: PlatformSkillInstallProgress[] = []
  for await (const frame of iterable) frames.push(frame)
  return frames
}

it('discovers a package-owned skill, prefers an account installation, and withdraws the package on unload', async () => {
  const bytes = archive('Account instructions')
  const { home, ctx, service } = await fixture(async url => response(bytes, requestUrl(url)))
  const root = join(home, 'package-image-layering')
  await mkdir(root)
  await writeFile(join(root, 'SKILL.md'), '---\nname: invoked-name\ndescription: Packaged expert\n---\n\nPackage instructions\n')
  const dispose = await service.registerPackagedSkillRoot(root, 'invoked-name')
  expect((await ctx.skills.get('invoked-name'))?.content).toContain('Package instructions')
  await collect(service.install(request('1.0.0', 'packaged-override'), new AbortController().signal))
  const observation = await service.listCandidates({})
  const candidates = 'candidates' in observation ? observation.candidates : observation
  expect(candidates.filter(candidate => candidate.name === 'invoked-name')).toHaveLength(1)
  expect((await ctx.skills.get('invoked-name'))?.content).toContain('Account instructions')
  await removeInstalled(service, new AbortController().signal)
  expect((await ctx.skills.get('invoked-name'))?.content).toContain('Package instructions')
  dispose()
  expect(await ctx.skills.get('invoked-name')).toBeUndefined()
})

it('rejects a package root whose declared skill name differs', async () => {
  const { home, service } = await fixture(async url => response(archive('unused'), requestUrl(url)))
  const root = join(home, 'invalid-package')
  await mkdir(root)
  await writeFile(join(root, 'SKILL.md'), '---\nname: another-name\ndescription: Invalid expert\n---\n\nBody\n')
  await expect(service.registerPackagedSkillRoot(root, 'invoked-name')).rejects.toThrow('valid root SKILL.md')
})

it('keeps the committed release when an update package is invalid', async () => {
  let bytes = archive('First release')
  const { ctx, service } = await fixture(async url => response(bytes, requestUrl(url)))
  const signal = new AbortController().signal
  expect((await collect(service.install(request('1.0.0', 'first'), signal))).at(-1))
    .toMatchObject({ kind: 'complete', skill: { version: '1.0.0' } })
  const installed = await onlyInstalled(service)
  bytes = new Uint8Array(zipSync({ 'catalog-id/README.md': strToU8('missing instructions') }))
  await expect(collect(service.install(request('2.0.0', 'invalid-update'), signal)))
    .rejects.toThrow('Skill installation failed')
  expect(await service.listInstalled()).toEqual({ skills: [installed] })
  expect((await ctx.skills.get('invoked-name'))?.content).toContain('First release')
})

it('keeps the committed release when an update declares another technical name', async () => {
  let bytes = archive('First release')
  const { ctx, service } = await fixture(async url => response(bytes, requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'matching-name'), signal))
  const installed = await onlyInstalled(service)
  bytes = archive('Mismatched release', 'another-name', 'another-root')

  await expect(collect(service.install(request('2.0.0', 'mismatched-name'), signal)))
    .rejects.toThrow('Skill installation failed')

  expect(await service.listInstalled()).toEqual({ skills: [installed] })
  expect((await ctx.skills.get('invoked-name'))?.content).toContain('First release')
  expect(await ctx.skills.get('another-name')).toBeUndefined()
})

it('remembers installations and explicit removals across account restarts', async () => {
  const bytes = archive('Handled release')
  const presetSkillIds = ['catalog-id', 'new-preset', 'catalog-id']
  const { home, ctx, service } = await fixture(async url => response(bytes, requestUrl(url)), { presetSkillIds })
  const catalogue = [{ id: brandString<InsightSkillId>('catalog-id'), skillName: 'invoked-name' }, { id: brandString<InsightSkillId>('new-preset'), skillName: 'new-preset' }]
  expect(await service.listPendingPresets(catalogue)).toEqual(catalogue)
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'preset-history'), signal))
  expect(await service.listPendingPresets(catalogue)).toEqual([catalogue[1]])
  const installed = (await service.listInstalled()).skills[0]!
  expect(JSON.parse(await readFile(join(home, 'platform-skills', 'auto-install-history', `${installed.key}.json`), 'utf8')))
    .toEqual({ key: installed.key, id: 'catalog-id', skillName: 'invoked-name' })
  await service.remove(removalRequest(installed), signal)
  await ctx.fiber.dispose()
  const reopened = new Context()
  onTestFinished(async () => { await reopened.fiber.dispose() })
  await reopened.plugin(SkillRegistry)
  const replacement = new InsightPlatformSkills(reopened, Config({ presetSkillIds }))
  await replacement.initialize()
  expect(await replacement.listInstalled()).toEqual({ skills: [] })
  expect(await replacement.listPendingPresets(catalogue)).toEqual([catalogue[1]])
})

it('leaves failed first installations eligible for the next preset attempt', async () => {
  const { service } = await fixture(async url => response(new Uint8Array([0]), requestUrl(url)), { presetSkillIds: ['catalog-id'] })
  await expect(collect(service.install(request('1.0.0', 'failed-preset'), new AbortController().signal)))
    .rejects.toThrow('Skill installation failed')
  expect(await service.listPendingPresets([{ id: brandString<InsightSkillId>('catalog-id'), skillName: 'invoked-name' }])).toEqual([{ id: brandString<InsightSkillId>('catalog-id'), skillName: 'invoked-name' }])
})

it('rejects ambiguous preset fallback through both a name-only installation and its removal history', async () => {
  const skillName = 'shared-name'
  const catalogue = [
    { id: brandString<InsightSkillId>('first-id'), skillName },
    { id: brandString<InsightSkillId>('second-id'), skillName },
  ]
  const bytes = archive('Name-only release', skillName, 'shared-root')
  const { service } = await fixture(
    async url => response(bytes, requestUrl(url)),
    { presetSkillIds: ['first-id'] },
  )
  const signal = new AbortController().signal
  await collect(service.install(identityRequest('1.0.0', 'ambiguous-name-only', { skillName }), signal))

  await expect(service.listPendingPresets(catalogue)).rejects.toThrow('conflicting installed identities')

  const installed = await onlyInstalled(service)
  await service.remove({ key: installed.key, skillName }, signal)
  await expect(service.listPendingPresets(catalogue)).rejects.toThrow('conflicting installation history')
})

it('matches an exact installed id but rejects the other same-name catalogue preset', async () => {
  const skillName = 'shared-name'
  const firstId = brandString<InsightSkillId>('first-id')
  const catalogue = [
    { id: firstId, skillName },
    { id: brandString<InsightSkillId>('second-id'), skillName },
  ]
  const bytes = archive('Exact identity', skillName, 'exact-root')
  const { ctx, service } = await fixture(
    async url => response(bytes, requestUrl(url)),
    { presetSkillIds: ['first-id'] },
  )
  await collect(service.install(identityRequest('1.0.0', 'exact-first-id', {
    id: firstId,
    skillName,
  }), new AbortController().signal))

  expect(await service.listPendingPresets(catalogue)).toEqual([])

  await ctx.fiber.dispose()
  const reopened = new Context()
  onTestFinished(async () => { await reopened.fiber.dispose() })
  await reopened.plugin(SkillRegistry)
  const replacement = new InsightPlatformSkills(reopened, Config({ presetSkillIds: ['second-id'] }))
  await replacement.initialize()
  await expect(replacement.listPendingPresets(catalogue)).rejects.toThrow('conflicting installed identities')
})

it('updates a renamed technical skill with the same catalogue id and preserves its local key', async () => {
  let bytes = archive('First release')
  const { ctx, service } = await fixture(async url => response(bytes, requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'before-rename'), signal))
  const previous = await onlyInstalled(service)
  bytes = archive('Renamed release', 'renamed-skill', 'renamed-root')

  await collect(service.install({
    ...identityRequest('2.0.0', 'after-rename', {
      id: brandString<InsightSkillId>('catalog-id'),
      skillName: 'renamed-skill',
    }),
    key: previous.key,
  }, signal))

  expect(await service.listInstalled()).toEqual({
    skills: [{
      key: previous.key,
      id: brandString<InsightSkillId>('catalog-id'),
      skillName: 'renamed-skill',
      version: '2.0.0',
    }],
  })
  expect(await ctx.skills.get('invoked-name')).toBeUndefined()
  expect((await ctx.skills.get('renamed-skill'))?.content).toContain('Renamed release')
})

it('adds a catalogue id to a name-only installation and its history without changing its local key', async () => {
  let bytes = archive('Name-only release', 'name-only', 'name-only-root')
  const { home, service } = await fixture(async url => response(bytes, requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(identityRequest('1.0.0', 'name-only', { skillName: 'name-only' }), signal))
  const previous = await onlyInstalled(service)
  bytes = archive('Identified release', 'name-only', 'identified-root')

  await collect(service.install(identityRequest('2.0.0', 'identified', {
    id: brandString<InsightSkillId>('added-id'),
    skillName: 'name-only',
  }), signal))

  expect(await service.listInstalled()).toEqual({
    skills: [{
      key: previous.key,
      id: brandString<InsightSkillId>('added-id'),
      skillName: 'name-only',
      version: '2.0.0',
    }],
  })
  expect(JSON.parse(await readFile(
    join(home, 'platform-skills', 'auto-install-history', `${previous.key}.json`),
    'utf8',
  ))).toEqual({ key: previous.key, id: 'added-id', skillName: 'name-only' })
})

it('retains an installed catalogue id when a name-matched update omits it', async () => {
  let bytes = archive('Identified release')
  const { service } = await fixture(async url => response(bytes, requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'identified-release'), signal))
  const previous = await onlyInstalled(service)
  bytes = archive('Name-matched update')

  await collect(service.install({
    ...identityRequest('2.0.0', 'name-matched-update', { skillName: 'invoked-name' }),
    key: previous.key,
  }, signal))

  expect(await service.listInstalled()).toEqual({
    skills: [{
      key: previous.key,
      id: brandString<InsightSkillId>('catalog-id'),
      skillName: 'invoked-name',
      version: '2.0.0',
    }],
  })
})

it('rejects a same-id rename that would collide with another installed technical name', async () => {
  let bytes = archive('First identity')
  const { service } = await fixture(async url => response(bytes, requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'first-before-collision'), signal))
  const first = await onlyInstalled(service)
  bytes = archive('Second identity', 'occupied-name', 'second-root')
  await collect(service.install(identityRequest('1.0.0', 'second-before-collision', {
    id: brandString<InsightSkillId>('second-id'),
    skillName: 'occupied-name',
  }), signal))
  const before = await service.listInstalled()
  bytes = archive('Colliding rename', 'occupied-name', 'colliding-root')

  await expect(collect(service.install({
    ...identityRequest('2.0.0', 'colliding-rename', {
      id: brandString<InsightSkillId>('catalog-id'),
      skillName: 'occupied-name',
    }),
    key: first.key,
  }, signal))).rejects.toThrow('Skill installation failed')

  expect(await service.listInstalled()).toEqual(before)
})

it('does not overwrite a same-name installation when both catalogue ids differ', async () => {
  const bytes = archive('First identity')
  const { service } = await fixture(async url => response(bytes, requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'first-identity'), signal))
  const previous = await onlyInstalled(service)

  await expect(collect(service.install(identityRequest('2.0.0', 'different-identity', {
    id: brandString<InsightSkillId>('different-id'),
    skillName: 'invoked-name',
  }), signal))).rejects.toThrow('Skill installation failed')

  expect(await service.listInstalled()).toEqual({ skills: [previous] })
})

it('keeps opaque catalogue ids out of local record and payload paths', async () => {
  const id = brandString<InsightSkillId>('../../remote/id')
  const bytes = archive('Opaque identity')
  const { home, service } = await fixture(async url => response(bytes, requestUrl(url)))
  await collect(service.install(identityRequest('1.0.0', 'opaque-id', { id, skillName: 'invoked-name' }), new AbortController().signal))
  const installed = await onlyInstalled(service)

  expect(installed.id).toBe(id)
  expect(installed.key).not.toContain('remote')
  expect(await readdir(join(home, 'platform-skills', 'installed'))).toEqual([`${installed.key}.json`])
  expect(await readdir(join(home, 'platform-skills', 'payloads'))).toEqual([installed.key])
})

it('uses the removed installation identity to suppress its configured preset', async () => {
  const identity = { id: brandString<InsightSkillId>('catalog-id'), skillName: 'renamed-preset' }
  let bytes = archive('Initial preset')
  const { home, service } = await fixture(
    async url => response(bytes, requestUrl(url)),
    { presetSkillIds: ['catalog-id'] },
  )
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'initial-preset'), signal))
  const initial = await onlyInstalled(service)
  bytes = archive('Renamed preset', identity.skillName, 'renamed-preset-root')
  await collect(service.install({
    ...identityRequest('2.0.0', 'renamed-preset', identity),
    key: initial.key,
  }, signal))
  const installed = await onlyInstalled(service)
  await service.remove(removalRequest(installed), signal)

  expect(await service.listPendingPresets([identity])).toEqual([])
  expect(JSON.parse(await readFile(
    join(home, 'platform-skills', 'auto-install-history', `${installed.key}.json`),
    'utf8',
  ))).toEqual({ key: installed.key, id: 'catalog-id', skillName: 'renamed-preset' })
})

it('waits for another page installation and lets observers cancel without cancelling its owner', async () => {
  const started = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const bytes = archive('Concurrent page release')
  const { service } = await fixture(async (url) => {
    started.resolve(undefined)
    await release.promise
    return response(bytes, requestUrl(url))
  }, { presetSkillIds: ['catalog-id'] })
  const signal = new AbortController().signal
  const operation = service.install(request('1.0.0', 'other-page'), signal)[Symbol.asyncIterator]()
  try {
    await operation.next()
    await started.promise
    expect(await service.listInstalled()).toEqual({ skills: [] })
    const observer = new AbortController()
    const identity = { id: brandString<InsightSkillId>('catalog-id'), skillName: 'invoked-name' }
    const cancelled = service.waitForInstallation(identity, observer.signal)
    observer.abort(new Error('Observer closed'))
    await expect(cancelled).rejects.toThrow('Observer closed')
    const waiting = service.waitForInstallation(identity, signal)
    release.resolve(undefined)
    const frames: PlatformSkillInstallProgress[] = []
    let next = await operation.next()
    while (!next.done) {
      frames.push(next.value)
      next = await operation.next()
    }
    expect(frames.at(-1)).toMatchObject({ kind: 'complete' })
    const installed = await onlyInstalled(service)
    expect(await waiting).toEqual({ skills: [installed] })
    expect(await service.listPendingPresets([identity])).toEqual([])
  } finally {
    release.resolve(undefined)
    await operation.return?.(undefined)
  }
})

it('keeps installed content when removal cannot preserve the account choice', async () => {
  const bytes = archive('Protected release')
  const { home, ctx, service } = await fixture(async url => response(bytes, requestUrl(url)), { presetSkillIds: ['catalog-id'] })
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'protected-preset'), signal))
  const installed = await onlyInstalled(service)
  const marker = join(home, 'platform-skills', 'auto-install-history', `${installed.key}.json`)
  await unlink(marker)
  await mkdir(marker)
  await expect(removeInstalled(service, signal)).rejects.toThrow('Skill removal failed')
  expect(await service.listInstalled()).toEqual({ skills: [installed] })
  expect((await ctx.skills.get('invoked-name'))?.content).toContain('Protected release')
})

it('settles the owner and its observers when the account plugin stops during a download', async () => {
  const started = Promise.withResolvers<undefined>()
  const { ctx, service } = await fixture(async (_url, options) => {
    const signal = options?.signal
    if (signal === undefined || signal === null) throw new Error('Download requires cancellation')
    started.resolve(undefined)
    return await new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const reason: unknown = signal.reason
        reject(reason instanceof Error ? reason : new Error('Download cancelled', { cause: reason }))
      }, { once: true })
    })
  })
  const errors = vi.spyOn(ctx.logger, 'error').mockImplementation(() => undefined)
  onTestFinished(() => { errors.mockRestore() })
  const signal = new AbortController().signal
  const stream = service.install(request('1.0.0', 'stopping-account'), signal)
  const iterator = stream[Symbol.asyncIterator]()
  await iterator.next()
  await started.promise
  const observer = service.waitForInstallation({ id: brandString<InsightSkillId>('catalog-id'), skillName: 'invoked-name' }, signal)
  const observation = expect(observer).rejects.toThrow('Insight platform skills stopped')
  const drained = collect(stream)

  await expect(ctx.fiber.dispose()).resolves.toBeUndefined()
  await observation
  expect((await drained).at(-1)).toMatchObject({ kind: 'cancelled' })
  expect(errors).not.toHaveBeenCalled()
})

it('preserves legacy files and gives account installations priority over legacy names', async () => {
  const legacy = await mkdtemp(join(tmpdir(), 'insight-legacy-skills-'))
  onTestFinished(async () => { await rm(legacy, { recursive: true, force: true }) })
  const instruction = join(legacy, 'custom', 'SKILL.md')
  await mkdir(join(legacy, 'custom'))
  const original = '---\nname: invoked-name\ndescription: Hand-installed legacy expert\n---\n\nLegacy user content.\n'
  await writeFile(instruction, original)
  const bytes = archive('Managed replacement')
  const { ctx, service } = await fixture(async url => response(bytes, requestUrl(url)), { legacySkillDirs: [legacy] })
  expect((await ctx.skills.get('invoked-name'))?.content).toContain('Legacy user content.')
  expect(await service.listInstalled()).toEqual({ skills: [] })
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'legacy-replacement'), signal))
  expect((await ctx.skills.get('invoked-name'))?.content).toContain('Managed replacement')
  await removeInstalled(service, signal)
  expect((await ctx.skills.get('invoked-name'))?.content).toContain('Legacy user content.')
  expect(await readFile(instruction, 'utf8')).toBe(original)
})

it('waits for explicit cancellation cleanup and publishes no installation', async () => {
  const { service } = await fixture(async (url, init) => {
    const signal = init?.signal
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x50, 0x4b]))
        signal?.addEventListener('abort', () => { controller.error(signal.reason) }, { once: true })
      },
    })
    const value = new Response(body)
    Object.defineProperty(value, 'url', { value: requestUrl(url) })
    return value
  })
  const input = request('1.0.0', 'cancelled-install')
  const iterator = service.install(input, new AbortController().signal)[Symbol.asyncIterator]()
  await expect(iterator.next()).resolves.toMatchObject({ value: { kind: 'progress', phase: 'download' } })
  const settlement = service.cancel(input.operationId)
  const remaining: PlatformSkillInstallProgress[] = []
  for (;;) {
    const frame = await iterator.next()
    if (frame.done) break
    remaining.push(frame.value)
  }
  await expect(settlement).resolves.toEqual({ kind: 'cancelled', operationId: input.operationId })
  expect(remaining.at(-1)).toEqual({ kind: 'cancelled', operationId: input.operationId })
  expect(await service.listInstalled()).toEqual({ skills: [] })
})

it('rejects symbolic-link archive entries before publishing them', async () => {
  const bytes = new Uint8Array(zipSync({
    'catalog-id/SKILL.md': [strToU8('outside-target'), { attrs: 0o120777 << 16, os: 3 }],
  }))
  const { service } = await fixture(async url => response(bytes, requestUrl(url)))
  await expect(collect(service.install(
    request('1.0.0', 'unsafe-symlink'),
    new AbortController().signal,
  ))).rejects.toThrow('Skill installation failed')
  expect(await service.listInstalled()).toEqual({ skills: [] })
})

it('treats a manually deleted selected payload as uninstalled and permits reinstall', async () => {
  const bytes = archive('Installed release')
  const { home, service } = await fixture(async url => response(bytes, requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'install-before-delete'), signal))
  const installed = await onlyInstalled(service)
  const record = JSON.parse(await readFile(
    join(home, 'platform-skills', 'installed', `${installed.key}.json`),
    'utf8',
  )) as { payload: string }
  await unlink(join(home, 'platform-skills', record.payload, 'SKILL.md'))
  expect(await service.listInstalled()).toEqual({ skills: [] })
  expect((await collect(service.install(request('1.0.1', 'reinstall'), signal))).at(-1))
    .toMatchObject({ kind: 'complete', skill: { version: '1.0.1' } })
})

it('removes every release of the selected skill without deleting another installed skill', async () => {
  let bytes = archive('Installed release')
  const { home, service } = await fixture(async url => response(bytes, requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'first-install'), signal))
  const first = await onlyInstalled(service)
  bytes = archive('Other installed release', 'other-name', 'other-root')
  await collect(service.install({
    ...request('1.0.0', 'other-install'),
    id: brandString<InsightSkillId>('other-id'),
    skillName: 'other-name',
  }, signal))
  const other = (await service.listInstalled()).skills.find(skill => skill.id === 'other-id')!
  const skillRoot = join(home, 'platform-skills', 'payloads', first.key)
  const stale = join(skillRoot, 'unselected-release')
  await mkdir(stale)
  await writeFile(join(stale, 'leftover.txt'), 'Old release')

  await service.remove(removalRequest(first), signal)

  await expect(stat(skillRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(stat(join(home, 'platform-skills', 'installed', `${first.key}.json`))).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await stat(join(home, 'platform-skills', 'payloads', other.key))).isDirectory()).toBe(true)
  expect(await service.listInstalled()).toEqual({ skills: [other] })
  await expect(stat(join(home, 'platform-skills', '.staging'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('unlinks a replaced skill directory without deleting its external target', async () => {
  const bytes = archive('Retained external release')
  const { home, service } = await fixture(async url => response(bytes, requestUrl(url)))
  await collect(service.install(request('1.0.0', 'link-install'), new AbortController().signal))
  const installed = await onlyInstalled(service)
  const root = join(home, 'platform-skills', 'payloads', installed.key)
  const target = join(home, 'external-target')
  await rename(root, target)
  await writeFile(join(target, 'retained.txt'), 'Keep this external directory')
  await symlink(target, root, process.platform === 'win32' ? 'junction' : 'dir')
  const entries = await readdir(target)

  await removeInstalled(service, new AbortController().signal)

  await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(target, 'retained.txt'), 'utf8')).toBe('Keep this external directory')
  expect(await readdir(target)).toEqual(entries)
  expect(await service.listInstalled()).toEqual({ skills: [] })
})

it('cleans empty skill directories and abandoned releases when reopening the account', async () => {
  const bytes = archive('Retained release')
  const { home, ctx, service } = await fixture(async url => response(bytes, requestUrl(url)))
  await collect(service.install(request('1.0.0', 'retained-install'), new AbortController().signal))
  const installed = await onlyInstalled(service)
  const payloads = join(home, 'platform-skills', 'payloads')
  await mkdir(join(payloads, 'empty-skill'))
  await mkdir(join(payloads, 'orphan-skill', 'abandoned'), { recursive: true })
  await writeFile(join(payloads, 'orphan-skill', 'abandoned', 'leftover.txt'), 'Interrupted install')
  await ctx.fiber.dispose()
  const reopened = new Context()
  onTestFinished(async () => { await reopened.fiber.dispose() })
  await reopened.plugin(SkillRegistry)
  const replacement = new InsightPlatformSkills(reopened, Config({}))
  await replacement.initialize()

  expect(await readdir(payloads)).toEqual([installed.key])
  expect(await replacement.listInstalled()).toEqual({ skills: [installed] })
  expect((await reopened.skills.get('invoked-name'))?.content).toContain('Retained release')
})

it('refuses a record selecting another skill directory before removal can delete any content', async () => {
  let bytes = archive('Installed release')
  const { home, service } = await fixture(async url => response(bytes, requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'owned-install'), signal))
  const owned = await onlyInstalled(service)
  bytes = archive('Protected release', 'protected-name', 'protected-root')
  await collect(service.install({
    ...request('1.0.0', 'protected-install'),
    id: brandString<InsightSkillId>('other-id'),
    skillName: 'protected-name',
  }, signal))
  const protectedSkill = (await service.listInstalled()).skills.find(skill => skill.id === 'other-id')!
  const installed = join(home, 'platform-skills', 'installed')
  const foreign = JSON.parse(await readFile(join(installed, `${protectedSkill.key}.json`), 'utf8')) as { payload: string }
  await writeFile(join(installed, `${owned.key}.json`), JSON.stringify({
    key: owned.key,
    id: owned.id,
    skillName: owned.skillName,
    version: owned.version,
    payload: foreign.payload,
  }))

  await expect(service.remove(removalRequest(owned), signal)).rejects.toThrow('Skill removal failed')
  expect((await stat(join(home, 'platform-skills', foreign.payload, 'SKILL.md'))).isFile()).toBe(true)
  expect((await stat(join(installed, `${owned.key}.json`))).isFile()).toBe(true)
})

it('rejects a package that publishes more than the selected root skill', async () => {
  let bytes = archive('First release')
  const { ctx, service } = await fixture(async url => response(bytes, requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'single-skill'), signal))
  const installed = await onlyInstalled(service)
  bytes = new Uint8Array(zipSync({
    'catalog-id/SKILL.md': strToU8('---\nname: invoked-name\ndescription: Updated\n---\n'),
    'catalog-id/extra/SKILL.md': strToU8('---\nname: hidden-skill\ndescription: Hidden\n---\n'),
  }))
  await expect(collect(service.install(request('2.0.0', 'extra-skill'), signal)))
    .rejects.toThrow('Skill installation failed')
  expect(await service.listInstalled()).toEqual({ skills: [installed] })
  expect((await ctx.skills.get('invoked-name'))?.content).toContain('First release')
})

it('counts metadata entries against the archive entry limit', async () => {
  const bytes = new Uint8Array(zipSync({
    '__MACOSX/catalog-id': strToU8('metadata'),
    'catalog-id/SKILL.md': strToU8('---\nname: invoked-name\ndescription: Installed\n---\n'),
  }))
  const { service } = await fixture(
    async url => response(bytes, requestUrl(url)),
    { packageMaxEntries: 1 },
  )
  await expect(collect(service.install(
    request('1.0.0', 'metadata-over-limit'),
    new AbortController().signal,
  ))).rejects.toThrow('Skill installation failed')
  expect(await service.listInstalled()).toEqual({ skills: [] })
})

it('preserves private owner execution for executable package files', async () => {
  const bytes = new Uint8Array(zipSync({
    'catalog-id/SKILL.md': strToU8('---\nname: invoked-name\ndescription: Installed\n---\n'),
    'catalog-id/scripts/run.sh': [strToU8('#!/bin/sh\n'), { attrs: 0o100755 << 16, os: 3 }],
  }))
  const { home, service } = await fixture(async url => response(bytes, requestUrl(url)))
  await collect(service.install(request('1.0.0', 'executable'), new AbortController().signal))
  const installed = await onlyInstalled(service)
  const record = JSON.parse(await readFile(
    join(home, 'platform-skills', 'installed', `${installed.key}.json`),
    'utf8',
  )) as { payload: string }
  const details = await stat(join(home, 'platform-skills', record.payload, 'scripts', 'run.sh'))
  expect(details.mode & 0o777).toBe(0o700)
})

it('coalesces download progress while a stream consumer is paused', async () => {
  const bytes = archive('Chunked release')
  let offset = 0
  let finish!: () => void
  const streamed = new Promise<void>((resolvePromise) => { finish = resolvePromise })
  const { service } = await fixture(async (url) => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.byteLength) {
          controller.close()
          finish()
          return
        }
        controller.enqueue(bytes.subarray(offset, ++offset))
      },
    })
    const value = new Response(body)
    Object.defineProperty(value, 'url', { value: requestUrl(url) })
    return value
  })
  const iterator = service.install(
    request('1.0.0', 'coalesced-progress'),
    new AbortController().signal,
  )[Symbol.asyncIterator]()
  const first = await iterator.next()
  expect(first.value).toMatchObject({ kind: 'progress', phase: 'download' })
  await streamed
  const remaining: PlatformSkillInstallProgress[] = []
  for (;;) {
    const frame = await iterator.next()
    if (frame.done) break
    remaining.push(frame.value)
  }
  expect(remaining.filter(frame => frame.kind === 'progress' && frame.phase === 'download').length).toBeLessThanOrEqual(2)
  expect(remaining.at(-1)).toMatchObject({ kind: 'complete' })
})

it('cancels a response body when the server rejects a download', async () => {
  let cancelled = false
  const { service } = await fixture(async (url) => {
    const body = new ReadableStream<Uint8Array>({
      cancel() { cancelled = true },
    })
    const value = new Response(body, { status: 503 })
    Object.defineProperty(value, 'url', { value: requestUrl(url) })
    return value
  })
  await expect(collect(service.install(
    request('1.0.0', 'server-rejection'),
    new AbortController().signal,
  ))).rejects.toThrow('Skill installation failed')
  expect(cancelled).toBe(true)
})

it('cancels before extraction publishes a large entry', async () => {
  const bytes = new Uint8Array(zipSync({
    'catalog-id/SKILL.md': strToU8('---\nname: invoked-name\ndescription: Installed\n---\n'),
    'catalog-id/assets/large.bin': new Uint8Array(16 * 1024 * 1024),
  }))
  const { service } = await fixture(async url => response(bytes, requestUrl(url)))
  const input = request('1.0.0', 'cancel-extraction')
  const iterator = service.install(input, new AbortController().signal)[Symbol.asyncIterator]()
  for (;;) {
    const frame = await iterator.next()
    if (frame.done) throw new Error('Installation ended before extraction started.')
    if (frame.value.kind === 'progress' && frame.value.phase === 'validate') break
  }
  const settlement = service.cancel(input.operationId)
  const remaining: PlatformSkillInstallProgress[] = []
  for (;;) {
    const frame = await iterator.next()
    if (frame.done) break
    remaining.push(frame.value)
  }
  await expect(settlement).resolves.toEqual({ kind: 'cancelled', operationId: input.operationId })
  expect(remaining.at(-1)).toEqual({ kind: 'cancelled', operationId: input.operationId })
  expect(await service.listInstalled()).toEqual({ skills: [] })
})

it('admits cancellation while an installation waits for the mutation lock', async () => {
  const bytes = archive('Queued release')
  const { home, service } = await fixture(async url => response(bytes, requestUrl(url)))
  await service.initialize()
  let acquired!: () => void
  let release!: () => void
  const lockAcquired = new Promise<void>((resolvePromise) => { acquired = resolvePromise })
  const lockReleased = new Promise<void>((resolvePromise) => { release = resolvePromise })
  const holder = withFileLock(join(home, 'platform-skills', '.mutations'), async () => {
    acquired()
    await lockReleased
  })
  await lockAcquired
  try {
    const input = request('1.0.0', 'cancel-lock-wait')
    const iterator = service.install(input, new AbortController().signal)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({
      value: { kind: 'progress', phase: 'download', receivedBytes: 0 },
    })
    const cancellation = service.cancel(input.operationId)
    const remaining: PlatformSkillInstallProgress[] = []
    for (;;) {
      const frame = await iterator.next()
      if (frame.done) break
      remaining.push(frame.value)
    }
    await expect(cancellation).resolves.toEqual({ kind: 'cancelled', operationId: input.operationId })
    expect(remaining.at(-1)).toEqual({ kind: 'cancelled', operationId: input.operationId })
  } finally {
    release()
    await holder
  }
})
