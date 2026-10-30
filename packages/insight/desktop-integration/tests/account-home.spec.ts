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
  it('creates and reuses the historical harness directory for a new account', async () => {
    const { insightRoot } = await fixture()
    const expected = paths(insightRoot, 'test', 'user-a')
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(prepareInsightAccountHome({ insightRoot, environment: 'test', userId: 'user-a' }))
        .resolves.toEqual({ kind: 'ready', dshHome: expected.harness })
    }
    expect(await readdir(expected.harness)).toEqual([])
    await expect(lstat(expected.harnessNative)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps account and service environments in separate historical Homes', async () => {
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

  it('reuses an existing Home without reading or changing its data', async () => {
    const { insightRoot } = await fixture()
    const account = paths(insightRoot, 'test', 'legacy-user')
    const session = join(account.harness, 'sessions', 'legacy.jsonl')
    const bytes = Buffer.from([0, 1, 2, 255, 7])
    await mkdir(join(account.harness, 'sessions'), { recursive: true })
    await writeFile(session, bytes)

    await expect(prepareInsightAccountHome({ insightRoot, environment: 'test', userId: 'legacy-user' }))
      .resolves.toEqual({ kind: 'ready', dshHome: account.harness })
    expect(await readFile(session)).toEqual(bytes)
    await expect(lstat(account.harnessNative)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves pre-release data rather than creating an empty historical default', async () => {
    const { insightRoot } = await fixture()
    const account = paths(insightRoot, 'test', 'pre-release')
    await mkdir(account.harnessNative, { recursive: true })
    await writeFile(join(account.harnessNative, 'session.jsonl'), 'pre-release history')
    await expect(prepareInsightAccountHome({ insightRoot, environment: 'test', userId: 'pre-release' }))
      .resolves.toEqual({ kind: 'pre-release-data' })
    expect(await readFile(join(account.harnessNative, 'session.jsonl'), 'utf8')).toBe('pre-release history')
    await expect(lstat(account.harness)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('prefers the historical Home and leaves a separate pre-release Home unchanged', async () => {
    const { insightRoot } = await fixture()
    const account = paths(insightRoot, 'test', 'both-homes')
    await mkdir(account.harness, { recursive: true })
    await mkdir(account.harnessNative)
    await writeFile(join(account.harnessNative, 'retained'), 'unchanged')
    await expect(prepareInsightAccountHome({ insightRoot, environment: 'test', userId: 'both-homes' }))
      .resolves.toEqual({ kind: 'ready', dshHome: account.harness })
    expect(await readFile(join(account.harnessNative, 'retained'), 'utf8')).toBe('unchanged')
  })

  it('does not replace a mismatched native Home marker', async () => {
    const { insightRoot } = await fixture()
    const account = paths(insightRoot, 'production', 'marked-user')
    const markerPath = join(account.harnessNative, '.insight-native-home.json')
    const marker = '{"version":1,"scope":"wrong","environment":"production"}\n'
    await mkdir(account.harnessNative, { recursive: true })
    await writeFile(markerPath, marker)

    await expect(prepareInsightAccountHome({ insightRoot, environment: 'production', userId: 'marked-user' }))
      .resolves.toEqual({ kind: 'pre-release-data' })
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
