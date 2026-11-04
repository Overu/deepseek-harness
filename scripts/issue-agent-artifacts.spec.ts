import { readFileSync } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { execFile as executeFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { applyChanges, collectChanges, validateChanges, validateOutcome, validateResult } from '../.github/issue-agent/artifacts.mjs'

const execFile = promisify(executeFile)
const roots: string[] = []
const compliantPrBody = readFileSync(new URL('./fixtures/issue-agent/pr-body.md', import.meta.url), 'utf8')
// The production helper runs in Ubuntu Actions and deliberately uses /usr/bin/git and POSIX file modes.
const ubuntuIntegration = it.skipIf(process.platform === 'win32')

async function git(workdir: string, ...args: string[]) {
  await execFile('/usr/bin/git', args, { cwd: workdir })
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-issue-agent-'))
  roots.push(root)
  await git(root, 'init')
  await git(root, 'config', 'user.email', 'issue-agent@example.test')
  await git(root, 'config', 'user.name', 'Issue Agent test')
  await writeFile(join(root, '.gitignore'), 'ignored/\n')
  await writeFile(join(root, 'modified.txt'), 'before\n')
  await writeFile(join(root, 'deleted.txt'), 'delete me\n')
  await writeFile(join(root, 'executable.sh'), '#!/bin/sh\necho old\n')
  await chmod(join(root, 'executable.sh'), 0o644)
  await git(root, 'add', '.')
  await git(root, 'commit', '-m', 'baseline')
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function replyResult() {
  return { mode: 'reply', reply: 'I found the cause.', pr_title: '', pr_body: '', kind: '', areas: [] }
}

function changeResult() {
  return {
    mode: 'change',
    reply: 'I prepared a draft pull request.',
    pr_title: 'Fix issue behavior',
    pr_body: compliantPrBody,
    kind: 'kind/bug-fix',
    areas: ['area/core'],
  }
}

describe('Issue Agent artifacts', () => {
  ubuntuIntegration('collects modified, deleted, executable, hidden untracked, and ignores ignored files', async () => {
    const root = await fixture()
    await writeFile(join(root, 'modified.txt'), 'after\n')
    await unlink(join(root, 'deleted.txt'))
    await chmod(join(root, 'executable.sh'), 0o755)
    await writeFile(join(root, '.new-hidden'), 'hidden\n')
    await writeFile(join(root, 'added.txt'), 'added\n')
    await mkdir(join(root, 'ignored'))
    await writeFile(join(root, 'ignored', 'skip.txt'), 'ignored\n')

    const changes = await collectChanges(root)

    expect(changes).toEqual([
      { path: '.new-hidden', content: Buffer.from('hidden\n').toString('base64'), mode: '100644' },
      { path: 'added.txt', content: Buffer.from('added\n').toString('base64'), mode: '100644' },
      { path: 'deleted.txt', content: null, mode: '100644' },
      { path: 'executable.sh', content: Buffer.from('#!/bin/sh\necho old\n').toString('base64'), mode: '100755' },
      { path: 'modified.txt', content: Buffer.from('after\n').toString('base64'), mode: '100644' },
    ])
  })

  ubuntuIntegration('applies validated file data to a clean checkout', async () => {
    const root = await fixture()
    await applyChanges(root, [
      { path: 'modified.txt', content: Buffer.from('after\n').toString('base64'), mode: '100644' },
      { path: 'deleted.txt', content: null, mode: '100644' },
      { path: 'new/command.sh', content: Buffer.from('#!/bin/sh\necho new\n').toString('base64'), mode: '100755' },
    ])

    expect(await readFile(join(root, 'modified.txt'), 'utf8')).toBe('after\n')
    await expect(readFile(join(root, 'deleted.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(root, 'new/command.sh'), 'utf8')).toContain('echo new')
    expect((await lstat(join(root, 'new/command.sh'))).mode & 0o111).not.toBe(0)
  })

  it('rejects unsafe paths, malformed payloads, and duplicate changes', () => {
    for (const path of ['../escape', '/absolute', 'a\\b', 'a//b', '.git/config', '.GIT/config', '.github/workflows/x.yml', '.agents/x', 'AGENTS.md', '.env.local']) {
      expect(() => validateChanges([{ path, content: '', mode: '100644' }])).toThrow()
    }
    expect(() => validateChanges([
      { path: 'a.txt', content: 'not base64!', mode: '100644' },
    ])).toThrow()
    expect(() => validateChanges([
      { path: 'a.txt', content: '', mode: '100644' },
      { path: 'a.txt', content: '', mode: '100644' },
    ])).toThrow()
  })

  ubuntuIntegration('rejects symlink reads and writes', async () => {
    const root = await fixture()
    await symlink('../outside', join(root, 'link'))
    await expect(collectChanges(root)).rejects.toThrow(/regular file/u)
    await git(root, 'clean', '-fd')
    await symlink('../outside', join(root, 'link'))
    await git(root, 'add', 'link')
    await git(root, 'commit', '-m', 'tracked link')
    await expect(applyChanges(root, [{ path: 'link/file.txt', content: '', mode: '100644' }])).rejects.toThrow(/real directory/u)
  })

  it('requires replies and file artifacts to agree', () => {
    expect(validateOutcome(replyResult(), [])).toMatchObject({ result: replyResult(), changes: [] })
    expect(() => validateOutcome(replyResult(), [{ path: 'a.txt', content: '', mode: '100644' }])).toThrow(/reply/u)
    expect(() => validateOutcome(changeResult(), [])).toThrow(/require file changes/u)
    expect(validateOutcome(changeResult(), [{ path: 'a.txt', content: '', mode: '100644' }])).toMatchObject({ result: changeResult() })
  })

  it('requires canonical result metadata and PR sections', () => {
    const result = replyResult()
    expect(validateResult(result)).toBe(result)
    expect(() => validateResult({ ...replyResult(), pr_title: 'unexpected' })).toThrow(/PR metadata/u)
    expect(() => validateResult({ ...replyResult(), reply: '<!-- issue-agent:completion -->' })).toThrow(/reserved/u)
    expect(() => validateResult({ ...changeResult(), kind: 'kind/other' })).toThrow(/kind/u)
    expect(() => validateResult({ ...changeResult(), pr_body: '## Motivation\n## Changes\n## Testing\n## AI Usage' })).toThrow(/AI declaration/u)
    expect(() => validateResult({ ...changeResult(), pr_body: compliantPrBody.replace('https://ai-declaration.md)', 'https://example.test)') })).toThrow(/format/u)
    expect(() => validateResult({ ...changeResult(), pr_body: compliantPrBody.replace('| review 评审处理 | n/a 暂不适用 | — | 尚未处理评审意见。 |\n', '') })).toThrow(/format/u)
    expect(() => validateResult({ ...changeResult(), pr_body: `${changeResult().pr_body}\n<!-- issue-agent:owned-pr -->` })).toThrow(/reserved/u)
    expect(() => validateResult({ ...changeResult(), areas: [] })).toThrow(/areas/u)
  })
})
