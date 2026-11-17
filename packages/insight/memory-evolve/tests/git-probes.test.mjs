import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { renderSnapshot } from '../src/host/index.js'
import { ENTRY_DELIMITER, MemoryStore, gitBranchList, projectHash } from '../src/host/store.js'
import { resolveProjectId } from '../src/host/sync/identity.js'
import { makeProjectDirResolver } from '../src/host/sync/index.js'

test('macOS memory snapshots bypass the installer and use available Git', { skip: process.platform !== 'darwin' }, (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-memory-git-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const originalPath = process.env.PATH
  const spawnSync = childProcess.spawnSync
  const stub = join(cwd, 'shim', 'git')
  mkdirSync(join(cwd, 'shim'))
  symlinkSync('/usr/bin/git', stub)
  const launches = []
  let developerDir
  t.mock.method(childProcess, 'spawnSync', (program, args, options) => {
    if (program === '/usr/bin/xcode-select') {
      return developerDir ? { status: 0, stdout: developerDir + '\n' } : { status: 1, stdout: '' }
    }
    launches.push(program)
    if (['git', '/usr/bin/git', stub].includes(program)) return { status: 1, stdout: '' }
    return spawnSync(program, args, options)
  })
  syncBuiltinESMExports()
  try {
    process.env.PATH = 'shim'
    const config = { memoryDir: join(cwd, 'memory') }
    const agent = { session: { header: { cwd } } }
    const projectDirResolver = makeProjectDirResolver(config)
    const store = new MemoryStore(config.memoryDir, { projectDirResolver })
    const entries = ['[branch:main] Primary branch fact', '[branch:other] Other branch fact'].join(ENTRY_DELIMITER)
    const memoryPath = join(config.memoryDir, 'projects', projectHash(cwd))
    mkdirSync(memoryPath, { recursive: true })
    writeFileSync(join(memoryPath, 'KEY.md'), entries)
    assert.match(renderSnapshot(config, store, agent), /Other branch fact/u)
    assert.deepEqual(gitBranchList(cwd), [])
    assert.equal(resolveProjectId(cwd).kind, 'fallback')
    assert.deepEqual(launches, [])

    const installedDeveloperDir = join(cwd, 'Developer')
    const gitDir = join(installedDeveloperDir, 'usr', 'bin')
    mkdirSync(gitDir, { recursive: true })
    writeFileSync(join(gitDir, 'git'), `#!/bin/sh
case "$*" in
  'branch --show-current') printf 'main\\n' ;;
  'branch --format=%(refname:short)') printf 'main\\nother\\n' ;;
  'remote get-url origin') printf 'https://example.com/team/project.git\\n' ;;
  'rev-parse --show-toplevel') pwd ;;
  *) exit 1 ;;
esac
`, { mode: 0o700 })
    for (const [path, selectedDir] of [
      ['shim', installedDeveloperDir],
      ['Developer/usr/bin:shim', undefined],
      ['shim:Developer/usr/bin', join(cwd, 'missing-developer-tools')],
    ]) {
      process.env.PATH = path
      developerDir = selectedDir
      const identity = resolveProjectId(cwd)
      assert.equal(identity.key, 'example.com/team/project')
      const snapshot = renderSnapshot(config, store, agent)
      assert.match(snapshot, /Primary branch fact/u)
      assert.doesNotMatch(snapshot, /Other branch fact/u)
      assert.deepEqual(gitBranchList(cwd), ['main', 'other'])
    }
    assert.deepEqual([...new Set(launches)], [join(gitDir, 'git')])
  } finally {
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
})
