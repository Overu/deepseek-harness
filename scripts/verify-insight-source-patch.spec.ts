import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyInsightSourcePatch } from './verify-insight-source-patch.ts'

const roots: string[] = []

function write(root: string, path: string, body: string): void {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, body)
}

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
}

interface Fixture {
  root: string
  packageDir: string
  archive: string
  patch: string
}

function fixture(extraArchiveFile = false): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'dsh-insight-patch-test-'))
  roots.push(root)
  git(root, ['init', '-q'])
  const packageRelative = 'packages/insight/memory-evolve'
  const packageDir = join(root, packageRelative)
  const archiveRoot = join(root, 'archive', 'memory-evolve-commit')
  write(archiveRoot, 'keep.txt', 'before\n')
  write(archiveRoot, 'lib/worker.js', 'export const worker = "before"\n')
  if (extraArchiveFile) write(archiveRoot, 'extra.txt', 'unexpected\n')
  const archive = join(root, 'memory-evolve.tar.gz')
  execFileSync('tar', ['-czf', archive, '-C', dirname(archiveRoot), 'memory-evolve-commit'])
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex')
  const metadata = `${JSON.stringify({
    repository: 'https://github.com/example/memory-evolve',
    commit: '1'.repeat(40),
    archiveSha256: digest,
    upstreamVersion: '1.0.0',
    patch: '../../../patches/insight/memory-evolve.patch',
  }, null, 2)}\n`
  const desired: Record<string, string> = {
    'keep.txt': 'after\n',
    'src/host/worker.js': 'export const worker = "after"\n',
    'upstream.json': metadata,
  }

  const patchRoot = join(root, 'patch-work')
  write(patchRoot, 'keep.txt', 'before\n')
  write(patchRoot, 'lib/worker.js', 'export const worker = "before"\n')
  git(patchRoot, ['init', '-q'])
  git(patchRoot, ['add', '.'])
  git(patchRoot, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'base'])
  rmSync(join(patchRoot, 'lib'), { recursive: true })
  for (const [path, body] of Object.entries(desired)) write(patchRoot, path, body)
  git(patchRoot, ['add', '-A'])
  const patch = join(root, 'patches/insight/memory-evolve.patch')
  mkdirSync(dirname(patch), { recursive: true })
  writeFileSync(patch, git(patchRoot, ['diff', '--cached', '--binary', '--no-renames', 'HEAD']))

  for (const [path, body] of Object.entries(desired)) write(packageDir, path, body)
  write(packageDir, 'lib/generated.js', 'generated target output\n')
  git(root, ['add', packageRelative])
  return { root, packageDir, archive, patch }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Insight fixed-source patch verification', () => {
  it('rejects an archive before extraction when its digest differs', async () => {
    const subject = fixture()
    writeFileSync(subject.archive, 'not the pinned archive')
    await expect(verifyInsightSourcePatch(subject.packageDir, subject.archive, subject.root))
      .rejects.toThrow('archive SHA-256 mismatch')
  })

  it('reports patch application failure', async () => {
    const subject = fixture()
    writeFileSync(subject.patch, 'not a git patch\n')
    await expect(verifyInsightSourcePatch(subject.packageDir, subject.archive, subject.root))
      .rejects.toThrow('source patch failed')
  })

  it('rejects target content drift and replayed extra files', async () => {
    const drift = fixture()
    write(drift.packageDir, 'keep.txt', 'changed after intake\n')
    await expect(verifyInsightSourcePatch(drift.packageDir, drift.archive, drift.root))
      .rejects.toThrow('source content drift: keep.txt')

    const extra = fixture(true)
    await expect(verifyInsightSourcePatch(extra.packageDir, extra.archive, extra.root))
      .rejects.toThrow('extra: extra.txt')
  })

  it('replays the complete source while ignoring generated target output', async () => {
    const subject = fixture()
    await expect(verifyInsightSourcePatch(subject.packageDir, subject.archive, subject.root)).resolves.toBeUndefined()
  })
})
