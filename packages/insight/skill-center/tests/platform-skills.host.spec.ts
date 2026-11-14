/** Atomic platform-skill installation, account state, and payload cleanup behavior. */
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
import type { InsightSkillId, PlatformSkillInstallProgress, PlatformSkillOperationId } from '../src/types.ts'

const origin = 'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com'
const id = brandString<InsightSkillId>('expert-tool')

function archive(body: string, name = 'expert-tool'): Uint8Array {
  return new Uint8Array(zipSync({
    'release/SKILL.md': strToU8(`---\nname: ${name}\ndescription: Installed expert\n---\n\n${body}\n`),
  }))
}

function response(bytes: Uint8Array, url: string): Response {
  const value = new Response(new Uint8Array(bytes))
  Object.defineProperty(value, 'url', { value: url })
  return value
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function request(version: string, operation: string) {
  return { id, version, operationId: brandString<PlatformSkillOperationId>(operation), downloadUrl: `${origin}/desktop/skills/expert-tool.zip` }
}

async function fixture(fetcher: typeof fetch, config: Partial<Config> = {}) {
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
  await writeFile(join(root, 'SKILL.md'), '---\nname: expert-tool\ndescription: Packaged expert\n---\n\nPackage instructions\n')
  const dispose = await service.registerPackagedSkillRoot(root, 'expert-tool')
  expect((await ctx.skills.get('expert-tool'))?.content).toContain('Package instructions')
  await collect(service.install(request('1.0.0', 'packaged-override'), new AbortController().signal))
  const observation = await service.listCandidates({})
  const candidates = 'candidates' in observation ? observation.candidates : observation
  expect(candidates.filter(candidate => candidate.name === 'expert-tool')).toHaveLength(1)
  expect((await ctx.skills.get('expert-tool'))?.content).toContain('Account instructions')
  await service.remove({ id }, new AbortController().signal)
  expect((await ctx.skills.get('expert-tool'))?.content).toContain('Package instructions')
  dispose()
  expect(await ctx.skills.get('expert-tool')).toBeUndefined()
})

it('rejects a package root whose declared skill name differs', async () => {
  const { home, service } = await fixture(async url => response(archive('unused'), requestUrl(url)))
  const root = join(home, 'invalid-package')
  await mkdir(root)
  await writeFile(join(root, 'SKILL.md'), '---\nname: another-name\ndescription: Invalid expert\n---\n\nBody\n')
  await expect(service.registerPackagedSkillRoot(root, 'invoked-name')).rejects.toThrow('valid root SKILL.md')
})

it('installs and updates a technical-name record with a callable payload', async () => {
  let bytes = archive('First release')
  const { home, ctx, service } = await fixture(async url => response(bytes, requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'first'), signal))
  expect(await service.listInstalled()).toEqual({ skills: [{ id, version: '1.0.0' }] })
  expect(JSON.parse(await readFile(join(home, 'platform-skills', 'installed', 'expert-tool.json'), 'utf8'))).toMatchObject({ id: 'expert-tool', version: '1.0.0' })
  expect((await ctx.skills.get('expert-tool'))?.content).toContain('First release')
  bytes = archive('Updated release')
  await collect(service.install(request('1.1.0', 'update'), signal))
  expect(await service.listInstalled()).toEqual({ skills: [{ id, version: '1.1.0' }] })
  expect((await ctx.skills.get('expert-tool'))?.content).toContain('Updated release')
})

it('records an explicit removal by technical name and reclaims its payload', async () => {
  const { home, service } = await fixture(async url => response(archive('Release'), requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'install'), signal))
  const record = JSON.parse(await readFile(join(home, 'platform-skills', 'installed', 'expert-tool.json'), 'utf8')) as { payload: string }
  await service.remove({ id }, signal)
  expect(await service.listInstalled()).toEqual({ skills: [] })
  expect(JSON.parse(await readFile(join(home, 'platform-skills', 'auto-install-history', 'expert-tool.json'), 'utf8'))).toEqual({ id: 'expert-tool' })
  await expect(stat(join(home, 'platform-skills', record.payload))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('does not retry presets which were previously installed and removed', async () => {
  const { service } = await fixture(async url => response(archive('Release'), requestUrl(url)), { presetSkillIds: ['expert-tool'] })
  const catalogue = [{ id }]
  const signal = new AbortController().signal
  expect(await service.listPendingPresets(catalogue)).toEqual(catalogue)
  await collect(service.install(request('1.0.0', 'install'), signal))
  await service.remove({ id }, signal)
  expect(await service.listPendingPresets(catalogue)).toEqual([])
})

it('keeps a missing configured preset eligible without blocking catalogue presets', async () => {
  const missing = brandString<InsightSkillId>('missing-skill')
  const { service } = await fixture(
    async url => response(archive('Release'), requestUrl(url)),
    { presetSkillIds: ['missing-skill', 'expert-tool'] },
  )
  const catalogue = [{ id }]
  const signal = new AbortController().signal
  expect(await service.listPendingPresets(catalogue)).toEqual([{ id: missing }, { id }])
  await collect(service.install(request('1.0.0', 'install'), signal))
  expect(await service.listPendingPresets(catalogue)).toEqual([{ id: missing }])
  await service.remove({ id }, signal)
  expect(await service.listPendingPresets(catalogue)).toEqual([{ id: missing }])
})

it('treats a changed technical name as a distinct installation', async () => {
  let bytes = archive('First release')
  const { service } = await fixture(async url => response(bytes, requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'first'), signal))
  const renamed = brandString<InsightSkillId>('renamed-tool')
  bytes = archive('Renamed release', 'renamed-tool')
  await collect(service.install({ ...request('1.0.0', 'renamed'), id: renamed }, signal))
  expect(await service.listInstalled()).toEqual({ skills: [{ id, version: '1.0.0' }, { id: renamed, version: '1.0.0' }] })
})

it('rejects old record fields rather than inferring a technical identity', async () => {
  const { home, service } = await fixture(async url => response(archive('Release'), requestUrl(url)))
  await collect(service.install(request('1.0.0', 'install'), new AbortController().signal))
  const path = join(home, 'platform-skills', 'installed', 'expert-tool.json')
  const record = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  await writeFile(path, JSON.stringify({ ...record, key: 'old-local-key', skillName: 'expert-tool' }))
  await expect(service.listInstalled()).rejects.toThrow('Platform skill record for expert-tool is invalid.')
})

it('rejects traversal payload records before cleanup can reach another directory', async () => {
  const { home, service } = await fixture(async url => response(archive('Release'), requestUrl(url)))
  await collect(service.install(request('1.0.0', 'install'), new AbortController().signal))
  await writeFile(join(home, 'platform-skills', 'installed', 'expert-tool.json'), JSON.stringify({ id: 'expert-tool', version: '1.0.0', payload: '../outside' }))
  await expect(service.listInstalled()).rejects.toThrow('selects an invalid payload')
})

it('rejects symbolic-link payload records before they reach the skill provider', async () => {
  const { home, service } = await fixture(async url => response(archive('Release'), requestUrl(url)))
  await collect(service.install(request('1.0.0', 'install'), new AbortController().signal))
  const path = join(home, 'platform-skills', 'installed', 'expert-tool.json')
  const record = JSON.parse(await readFile(path, 'utf8')) as { payload: string }
  const payload = join(home, 'platform-skills', record.payload)
  await rm(payload, { recursive: true })
  await symlink(home, payload)
  await expect(service.listInstalled()).rejects.toThrow('symbolic-link payload')
})

it('admits preset installation only once during an account Host lifetime', async () => {
  const { service } = await fixture(vi.fn<typeof fetch>())
  expect(service.claimPresetInstallation()).toBe(true)
  expect(service.claimPresetInstallation()).toBe(false)
})

it('keeps the committed release when an update package is invalid', async () => {
  let bytes = archive('First release')
  const { ctx, service } = await fixture(async url => response(bytes, requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'first'), signal))
  bytes = new Uint8Array(zipSync({ 'release/README.md': strToU8('missing instructions') }))
  await expect(collect(service.install(request('2.0.0', 'invalid'), signal))).rejects.toThrow('Skill installation failed')
  expect(await service.listInstalled()).toEqual({ skills: [{ id, version: '1.0.0' }] })
  expect((await ctx.skills.get('expert-tool'))?.content).toContain('First release')
})

it('keeps the committed release when an update declares another technical name', async () => {
  let bytes = archive('First release')
  const { ctx, service } = await fixture(async url => response(bytes, requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'first'), signal))
  bytes = archive('Mismatched release', 'another-tool')

  await expect(collect(service.install(request('2.0.0', 'mismatched-name'), signal)))
    .rejects.toThrow('Skill installation failed')

  expect(await service.listInstalled()).toEqual({ skills: [{ id, version: '1.0.0' }] })
  expect((await ctx.skills.get('expert-tool'))?.content).toContain('First release')
  expect(await ctx.skills.get('another-tool')).toBeUndefined()
})

it('leaves failed first installations eligible for the next preset attempt', async () => {
  const { service } = await fixture(
    async url => response(new Uint8Array([0]), requestUrl(url)),
    { presetSkillIds: ['expert-tool'] },
  )
  await expect(collect(service.install(request('1.0.0', 'failed-preset'), new AbortController().signal)))
    .rejects.toThrow('Skill installation failed')
  expect(await service.listPendingPresets([{ id }])).toEqual([{ id }])
})

it('keeps installed content when removal cannot preserve the account choice', async () => {
  const { home, ctx, service } = await fixture(
    async url => response(archive('Protected release'), requestUrl(url)),
    { presetSkillIds: ['expert-tool'] },
  )
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'protected-preset'), signal))
  const marker = join(home, 'platform-skills', 'auto-install-history', 'expert-tool.json')
  await unlink(marker)
  await mkdir(marker)

  await expect(service.remove({ id }, signal)).rejects.toThrow('Skill removal failed')

  expect(await service.listInstalled()).toEqual({ skills: [{ id, version: '1.0.0' }] })
  expect((await ctx.skills.get('expert-tool'))?.content).toContain('Protected release')
})

it('cancels an active download without publishing an installation', async () => {
  const { service } = await fixture(async (url, init) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x50, 0x4b]))
        init?.signal?.addEventListener('abort', () => { controller.error(init.signal?.reason) }, { once: true })
      },
    })
    const value = new Response(body)
    Object.defineProperty(value, 'url', { value: requestUrl(url) })
    return value
  })
  const input = request('1.0.0', 'cancelled')
  const iterator = service.install(input, new AbortController().signal)[Symbol.asyncIterator]()
  await iterator.next()
  const cancellation = service.cancel(input.operationId)
  const frames: PlatformSkillInstallProgress[] = []
  for (;;) {
    const frame = await iterator.next()
    if (frame.done) break
    frames.push(frame.value)
  }
  await expect(cancellation).resolves.toEqual({ kind: 'cancelled', operationId: input.operationId })
  expect(frames.at(-1)).toEqual({ kind: 'cancelled', operationId: input.operationId })
  expect(await service.listInstalled()).toEqual({ skills: [] })
})

it('lets an observer cancel without cancelling the installation owner', async () => {
  const started = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const { service } = await fixture(async (url) => {
    started.resolve(undefined)
    await release.promise
    return response(archive('Concurrent release'), requestUrl(url))
  })
  const iterator = service.install(request('1.0.0', 'owner'), new AbortController().signal)[Symbol.asyncIterator]()
  await iterator.next()
  await started.promise
  const observer = new AbortController()
  const waiting = service.waitForInstallation({ id }, observer.signal)
  observer.abort(new Error('Observer closed'))
  await expect(waiting).rejects.toThrow('Observer closed')
  release.resolve(undefined)
  for (;;) {
    const frame = await iterator.next()
    if (frame.done) break
  }
  expect(await service.listInstalled()).toEqual({ skills: [{ id, version: '1.0.0' }] })
})

it('settles an active installation when the account plugin stops', async () => {
  const started = Promise.withResolvers<undefined>()
  const { ctx, service } = await fixture(async (_url, init) => new Promise<Response>((_resolve, reject) => {
    started.resolve(undefined)
    init?.signal?.addEventListener('abort', () => {
      if (init.signal?.reason instanceof Error) reject(init.signal.reason)
      else reject(new Error('Download cancelled'))
    }, { once: true })
  }))
  const iterator = service.install(request('1.0.0', 'stopping'), new AbortController().signal)[Symbol.asyncIterator]()
  await iterator.next()
  await started.promise
  const drained = collect({
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const frame = await iterator.next()
        if (frame.done) return
        yield frame.value
      }
    },
  })
  await expect(ctx.fiber.dispose()).resolves.toBeUndefined()
  expect((await drained).at(-1)).toMatchObject({ kind: 'cancelled' })
})

it('rejects symbolic-link ZIP entries before publishing them', async () => {
  const bytes = new Uint8Array(zipSync({
    'release/SKILL.md': [strToU8('outside-target'), { attrs: 0o120777 << 16, os: 3 }],
  }))
  const { service } = await fixture(async url => response(bytes, requestUrl(url)))
  await expect(collect(service.install(request('1.0.0', 'unsafe-link'), new AbortController().signal))).rejects.toThrow('Skill installation failed')
  expect(await service.listInstalled()).toEqual({ skills: [] })
})

it('preserves legacy files and gives account installations priority over legacy names', async () => {
  const legacy = await mkdtemp(join(tmpdir(), 'insight-legacy-skills-'))
  onTestFinished(async () => { await rm(legacy, { recursive: true, force: true }) })
  const instruction = join(legacy, 'custom', 'SKILL.md')
  await mkdir(join(legacy, 'custom'))
  const original = '---\nname: expert-tool\ndescription: Hand-installed legacy expert\n---\n\nLegacy user content.\n'
  await writeFile(instruction, original)
  const { ctx, service } = await fixture(
    async url => response(archive('Managed replacement'), requestUrl(url)),
    { legacySkillDirs: [legacy] },
  )
  expect((await ctx.skills.get('expert-tool'))?.content).toContain('Legacy user content.')
  expect(await service.listInstalled()).toEqual({ skills: [] })
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'legacy-replacement'), signal))
  expect((await ctx.skills.get('expert-tool'))?.content).toContain('Managed replacement')

  await service.remove({ id }, signal)

  expect((await ctx.skills.get('expert-tool'))?.content).toContain('Legacy user content.')
  expect(await readFile(instruction, 'utf8')).toBe(original)
})

it('treats a manually deleted selected payload as uninstalled and permits reinstall', async () => {
  const { home, service } = await fixture(async url => response(archive('Installed release'), requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'install-before-delete'), signal))
  const record = JSON.parse(await readFile(
    join(home, 'platform-skills', 'installed', 'expert-tool.json'),
    'utf8',
  )) as { payload: string }
  await unlink(join(home, 'platform-skills', record.payload, 'SKILL.md'))
  expect(await service.listInstalled()).toEqual({ skills: [] })

  expect((await collect(service.install(request('1.0.1', 'reinstall'), signal))).at(-1))
    .toMatchObject({ kind: 'complete', skill: { id, version: '1.0.1' } })
})

it('removes stale releases for the selected technical name without deleting another skill', async () => {
  let bytes = archive('First release')
  const { home, service } = await fixture(async url => response(bytes, requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'first'), signal))
  const other = brandString<InsightSkillId>('other-tool')
  bytes = archive('Other release', 'other-tool')
  await collect(service.install({ ...request('1.0.0', 'other'), id: other }, signal))
  const root = join(home, 'platform-skills', 'payloads', 'expert-tool')
  await mkdir(join(root, 'stale'), { recursive: true })
  await service.remove({ id }, signal)
  await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await stat(join(home, 'platform-skills', 'payloads', 'other-tool'))).isDirectory()).toBe(true)
})

it('unlinks a replaced skill directory without deleting its external target', async () => {
  const { home, service } = await fixture(async url => response(archive('Release'), requestUrl(url)))
  await collect(service.install(request('1.0.0', 'install'), new AbortController().signal))
  const root = join(home, 'platform-skills', 'payloads', 'expert-tool')
  const target = join(home, 'external-target')
  await rename(root, target)
  await writeFile(join(target, 'retained.txt'), 'Keep this external directory')
  await symlink(target, root, process.platform === 'win32' ? 'junction' : 'dir')
  await service.remove({ id }, new AbortController().signal)
  await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(target, 'retained.txt'), 'utf8')).toBe('Keep this external directory')
})

it.each(['update', 'first-install'] as const)('rejects a linked payload parent during %s without changing external files', async (mode) => {
  const { home, service } = await fixture(async url => response(archive('Release'), requestUrl(url)))
  const signal = new AbortController().signal
  await service.initialize()
  const root = join(home, 'platform-skills', 'payloads', 'expert-tool')
  const target = join(home, 'external-target')
  const record = join(home, 'platform-skills', 'installed', 'expert-tool.json')
  if (mode === 'update') {
    await collect(service.install(request('1.0.0', 'initial-install'), signal))
    await rename(root, target)
  } else {
    await mkdir(target)
  }
  await writeFile(join(target, 'retained.txt'), 'Keep this external directory')
  await symlink(target, root, process.platform === 'win32' ? 'junction' : 'dir')
  const entries = (await readdir(target, { recursive: true })).sort()
  const contents = await Promise.all(entries.map(async (entry) => {
    const path = join(target, entry)
    return (await lstat(path)).isFile() ? await readFile(path, 'utf8') : null
  }))
  const previous = mode === 'update' ? await readFile(record, 'utf8') : undefined

  await expect(collect(service.install(request('1.1.0', 'linked-install'), signal))).rejects.toThrow('Skill installation failed')

  expect((await readdir(target, { recursive: true })).sort()).toEqual(entries)
  for (const [index, entry] of entries.entries()) {
    if (contents[index] !== null) expect(await readFile(join(target, entry), 'utf8')).toBe(contents[index])
  }
  expect((await lstat(root)).isSymbolicLink()).toBe(true)
  if (previous === undefined) await expect(stat(record)).rejects.toMatchObject({ code: 'ENOENT' })
  else expect(await readFile(record, 'utf8')).toBe(previous)
})

it('cleans empty skill directories and abandoned releases when reopening the account', async () => {
  const { home, ctx, service } = await fixture(async url => response(archive('Retained release'), requestUrl(url)))
  await collect(service.install(request('1.0.0', 'retained-install'), new AbortController().signal))
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

  expect((await readdir(payloads)).sort()).toEqual(['expert-tool'])
  expect(await replacement.listInstalled()).toEqual({ skills: [{ id, version: '1.0.0' }] })
  expect((await reopened.skills.get('expert-tool'))?.content).toContain('Retained release')
})

it('refuses a record selecting another skill directory before removal can delete any content', async () => {
  let bytes = archive('Installed release')
  const { home, service } = await fixture(async url => response(bytes, requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'owned-install'), signal))
  const other = brandString<InsightSkillId>('other-tool')
  bytes = archive('Protected release', 'other-tool')
  await collect(service.install({ ...request('1.0.0', 'protected-install'), id: other }, signal))
  const installed = join(home, 'platform-skills', 'installed')
  const foreign = JSON.parse(await readFile(join(installed, 'other-tool.json'), 'utf8')) as { payload: string }
  await writeFile(join(installed, 'expert-tool.json'), JSON.stringify({
    id: 'expert-tool',
    version: '1.0.0',
    payload: foreign.payload,
  }))

  await expect(service.remove({ id }, signal)).rejects.toThrow('Skill removal failed')

  expect((await stat(join(home, 'platform-skills', foreign.payload, 'SKILL.md'))).isFile()).toBe(true)
  expect((await stat(join(installed, 'expert-tool.json'))).isFile()).toBe(true)
})

it('rejects a package that publishes more than the selected root skill', async () => {
  let bytes = archive('First release')
  const { ctx, service } = await fixture(async url => response(bytes, requestUrl(url)))
  const signal = new AbortController().signal
  await collect(service.install(request('1.0.0', 'single-skill'), signal))
  bytes = new Uint8Array(zipSync({
    'release/SKILL.md': strToU8('---\nname: expert-tool\ndescription: Updated\n---\n'),
    'release/extra/SKILL.md': strToU8('---\nname: hidden-tool\ndescription: Hidden\n---\n'),
  }))

  await expect(collect(service.install(request('2.0.0', 'extra-skill'), signal)))
    .rejects.toThrow('Skill installation failed')

  expect(await service.listInstalled()).toEqual({ skills: [{ id, version: '1.0.0' }] })
  expect((await ctx.skills.get('expert-tool'))?.content).toContain('First release')
})

it('counts metadata entries against the archive entry limit', async () => {
  const bytes = new Uint8Array(zipSync({
    '__MACOSX/release': strToU8('metadata'),
    'release/SKILL.md': strToU8('---\nname: expert-tool\ndescription: Installed\n---\n'),
  }))
  const { service } = await fixture(
    async url => response(bytes, requestUrl(url)),
    { packageMaxEntries: 1 },
  )

  await expect(collect(service.install(request('1.0.0', 'metadata-over-limit'), new AbortController().signal)))
    .rejects.toThrow('Skill installation failed')
  expect(await service.listInstalled()).toEqual({ skills: [] })
})

it.runIf(process.platform !== 'win32')('preserves private owner execution for executable package files', async () => {
  const bytes = new Uint8Array(zipSync({
    'release/SKILL.md': strToU8('---\nname: expert-tool\ndescription: Installed\n---\n'),
    'release/scripts/run.sh': [strToU8('#!/bin/sh\n'), { attrs: 0o100755 << 16, os: 3 }],
  }))
  const { home, service } = await fixture(async url => response(bytes, requestUrl(url)))
  await collect(service.install(request('1.0.0', 'executable'), new AbortController().signal))
  const record = JSON.parse(await readFile(
    join(home, 'platform-skills', 'installed', 'expert-tool.json'),
    'utf8',
  )) as { payload: string }
  const details = await stat(join(home, 'platform-skills', record.payload, 'scripts', 'run.sh'))
  expect(details.mode & 0o777).toBe(0o700)
})

it('coalesces download progress while a stream consumer is paused', async () => {
  const bytes = archive('Chunked release')
  let offset = 0
  const streamed = Promise.withResolvers<undefined>()
  const { service } = await fixture(async (url) => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.byteLength) {
          controller.close()
          streamed.resolve(undefined)
          return
        }
        controller.enqueue(bytes.subarray(offset, ++offset))
      },
    })
    const value = new Response(body)
    Object.defineProperty(value, 'url', { value: requestUrl(url) })
    return value
  })
  const iterator = service.install(request('1.0.0', 'coalesced-progress'), new AbortController().signal)[Symbol.asyncIterator]()
  const first = await iterator.next()
  expect(first.value).toMatchObject({ kind: 'progress', phase: 'download' })
  await streamed.promise
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

  await expect(collect(service.install(request('1.0.0', 'server-rejection'), new AbortController().signal)))
    .rejects.toThrow('Skill installation failed')
  expect(cancelled).toBe(true)
})

it('cancels before extraction publishes a large entry', async () => {
  const bytes = new Uint8Array(zipSync({
    'release/SKILL.md': strToU8('---\nname: expert-tool\ndescription: Installed\n---\n'),
    'release/assets/large.bin': new Uint8Array(16 * 1024 * 1024),
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

it('cancels while waiting for the mutation lock', async () => {
  const { home, service } = await fixture(async url => response(archive('Release'), requestUrl(url)))
  await service.initialize()
  const acquired = Promise.withResolvers<undefined>()
  const released = Promise.withResolvers<undefined>()
  const holder = withFileLock(join(home, 'platform-skills', '.mutations'), async () => {
    acquired.resolve(undefined)
    await released.promise
  })
  await acquired.promise
  try {
    const input = request('1.0.0', 'lock-wait')
    const iterator = service.install(input, new AbortController().signal)[Symbol.asyncIterator]()
    await iterator.next()
    const cancelled = service.cancel(input.operationId)
    for (;;) {
      const frame = await iterator.next()
      if (frame.done) break
    }
    await expect(cancelled).resolves.toEqual({ kind: 'cancelled', operationId: input.operationId })
  } finally {
    released.resolve(undefined)
    await holder
  }
})
