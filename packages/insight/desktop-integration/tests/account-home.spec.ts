import { afterEach, describe, expect, it } from 'vitest'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareInsightAccountHome } from '../src/desktop/account-home.ts'
import { accountPaths, accountScopeKey } from '../src/desktop/account-scope.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; insightRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), 'insight-account-home-'))
  roots.push(root)
  return { root, insightRoot: join(root, 'insight') }
}

function paths(insightRoot: string, environment: 'test' | 'production', userId: string) {
  return accountPaths(insightRoot, accountScopeKey(environment, userId))
}

describe('Insight account Home preparation', () => {
  it('creates and reuses the same marked native Home for a new account', async () => {
    const { insightRoot } = await fixture()
    const expected = paths(insightRoot, 'test', 'user-a')

    await expect(prepareInsightAccountHome({ insightRoot, environment: 'test', userId: 'user-a' }))
      .resolves.toEqual({ kind: 'ready', dshHome: expected.harnessNative })
    const markerPath = join(expected.harnessNative, '.insight-native-home.json')
    const marker = await readFile(markerPath, 'utf8')

    await expect(prepareInsightAccountHome({ insightRoot, environment: 'test', userId: 'user-a' }))
      .resolves.toEqual({ kind: 'ready', dshHome: expected.harnessNative })
    expect(await readFile(markerPath, 'utf8')).toBe(marker)
    expect(JSON.parse(marker)).toEqual({
      version: 1,
      scope: accountScopeKey('test', 'user-a'),
      environment: 'test',
    })
  })

  it('keeps account and service environments in separate native Homes', async () => {
    const { insightRoot } = await fixture()
    const inputs = [
      { environment: 'test' as const, userId: 'user-a' },
      { environment: 'test' as const, userId: 'user-b' },
      { environment: 'production' as const, userId: 'user-a' },
    ]
    const results = await Promise.all(inputs.map(input => prepareInsightAccountHome({ insightRoot, ...input })))
    const homes = results.map(result => result.kind === 'ready' ? result.dshHome : undefined)

    expect(homes.every(home => home !== undefined)).toBe(true)
    expect(new Set(homes).size).toBe(inputs.length)
  })

  it('does not inspect or modify a legacy Home', async () => {
    const { insightRoot } = await fixture()
    const account = paths(insightRoot, 'test', 'legacy-user')
    const session = join(account.harness, 'sessions', 'legacy.jsonl')
    const bytes = Buffer.from([0, 1, 2, 255, 7])
    await mkdir(join(account.harness, 'sessions'), { recursive: true })
    await writeFile(session, bytes)

    await expect(prepareInsightAccountHome({ insightRoot, environment: 'test', userId: 'legacy-user' }))
      .resolves.toEqual({ kind: 'migration-required' })
    expect(await readFile(session)).toEqual(bytes)
    await expect(lstat(account.harnessNative)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('initializes an empty native Home but preserves unknown native data', async () => {
    const { insightRoot } = await fixture()
    const empty = paths(insightRoot, 'test', 'empty-user')
    await mkdir(empty.harnessNative, { recursive: true })
    await expect(prepareInsightAccountHome({ insightRoot, environment: 'test', userId: 'empty-user' }))
      .resolves.toEqual({ kind: 'ready', dshHome: empty.harnessNative })

    const unknown = paths(insightRoot, 'test', 'unknown-user')
    const payload = Buffer.from('unknown-native-data\0', 'utf8')
    await mkdir(unknown.harnessNative, { recursive: true })
    await writeFile(join(unknown.harnessNative, 'unknown.bin'), payload)
    const before = await readdir(unknown.harnessNative)

    await expect(prepareInsightAccountHome({ insightRoot, environment: 'test', userId: 'unknown-user' }))
      .resolves.toEqual({ kind: 'migration-required' })
    expect(await readFile(join(unknown.harnessNative, 'unknown.bin'))).toEqual(payload)
    expect(await readdir(unknown.harnessNative)).toEqual(before)
  })

  it('does not replace a mismatched native Home marker', async () => {
    const { insightRoot } = await fixture()
    const account = paths(insightRoot, 'production', 'marked-user')
    const markerPath = join(account.harnessNative, '.insight-native-home.json')
    const marker = '{"version":1,"scope":"wrong","environment":"production"}\n'
    await mkdir(account.harnessNative, { recursive: true })
    await writeFile(markerPath, marker)

    await expect(prepareInsightAccountHome({ insightRoot, environment: 'production', userId: 'marked-user' }))
      .resolves.toEqual({ kind: 'migration-required' })
    expect(await readFile(markerPath, 'utf8')).toBe(marker)
  })

  it('rejects linked account, legacy, and native paths without changing their targets', async () => {
    const cases = ['scope', 'legacy', 'native'] as const
    for (const kind of cases) {
      const { root, insightRoot } = await fixture()
      const account = paths(insightRoot, 'test', `linked-${kind}`)
      const target = join(root, `target-${kind}`)
      const sentinel = join(target, 'sentinel')
      await mkdir(target, { recursive: true })
      await writeFile(sentinel, kind)
      if (kind === 'scope') {
        await mkdir(join(insightRoot, 'accounts'), { recursive: true })
        await symlink(target, account.root, process.platform === 'win32' ? 'junction' : 'dir')
      } else {
        await mkdir(account.root, { recursive: true })
        await symlink(target, kind === 'legacy' ? account.harness : account.harnessNative,
          process.platform === 'win32' ? 'junction' : 'dir')
      }

      await expect(prepareInsightAccountHome({ insightRoot, environment: 'test', userId: `linked-${kind}` }))
        .rejects.toThrow('symbolic link')
      expect(await readFile(sentinel, 'utf8')).toBe(kind)
      expect(await readdir(target)).toEqual(['sentinel'])
    }
  })
})
