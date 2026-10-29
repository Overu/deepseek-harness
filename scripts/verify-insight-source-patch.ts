/** Verify that one pinned Insight source archive and its patch reproduce the checked-in package. */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReadStream, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { INSIGHT_PRODUCT_PACKAGES } from './insight-package-policy.ts'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..')
const GENERATED_TARGET_DIRECTORIES = new Set(['lib', 'node_modules'])

interface UpstreamRecord {
  archiveSha256?: unknown
  patch?: unknown
}

function command(command: string, args: readonly string[], cwd: string, label: string): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.error !== undefined) throw new Error(`${label}: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`${label}: ${(result.stderr || result.stdout).trim() || `exit ${String(result.status)}`}`)
  return result.stdout
}

async function sha256(path: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer)
  return digest.digest('hex')
}

function packageFiles(root: string, packageRelative: string): string[] {
  const output = command('git', [
    '-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', packageRelative,
  ], root, 'cannot list checked-in Insight source')
  const prefix = `${packageRelative}/`
  return output.split('\0').filter(Boolean).map((path) => {
    if (!path.startsWith(prefix)) throw new Error(`git returned an out-of-package path: ${path}`)
    return path.slice(prefix.length)
  }).filter(path => !GENERATED_TARGET_DIRECTORIES.has(path.split('/')[0] ?? '')).sort()
}

function replayFiles(root: string, prefix = ''): string[] {
  const files: string[] = []
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (path.split('/')[0] === 'node_modules') continue
    if (entry.isDirectory()) files.push(...replayFiles(root, path))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`replayed source contains unsupported entry ${path}`)
  }
  return files.sort()
}

function compareTrees(replay: string, target: string, expected: readonly string[]): void {
  const actual = replayFiles(replay)
  const missing = expected.filter(path => !actual.includes(path))
  const extra = actual.filter(path => !expected.includes(path))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`source file set drift${missing.length > 0 ? `; missing: ${missing.join(', ')}` : ''}${extra.length > 0 ? `; extra: ${extra.join(', ')}` : ''}`)
  }
  for (const path of expected) {
    if (!readFileSync(join(replay, path)).equals(readFileSync(join(target, path)))) {
      throw new Error(`source content drift: ${path}`)
    }
  }
}

/**
 * Replay one declared Insight source patch from a digest-pinned local archive.
 * @param packageDir - Absolute or repository-relative Insight package directory.
 * @param archivePath - Local GitHub source archive.
 * @param repositoryRoot - Repository root override used by isolated tests.
 */
export async function verifyInsightSourcePatch(
  packageDir: string,
  archivePath: string,
  repositoryRoot: string = REPOSITORY_ROOT,
): Promise<void> {
  const root = realpathSync(repositoryRoot)
  const target = realpathSync(resolve(root, packageDir))
  const packageRelative = relative(root, target).split(sep).join('/')
  if (isAbsolute(packageRelative) || packageRelative.startsWith('../') || INSIGHT_PRODUCT_PACKAGES[packageRelative] === undefined) {
    throw new Error(`${packageRelative}: not a declared Insight product package`)
  }
  const metadata = JSON.parse(readFileSync(join(target, 'upstream.json'), 'utf8')) as UpstreamRecord
  if (typeof metadata.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(metadata.archiveSha256)) {
    throw new Error(`${packageRelative}/upstream.json: archiveSha256 is required`)
  }
  if (typeof metadata.patch !== 'string' || metadata.patch === '') {
    throw new Error(`${packageRelative}/upstream.json: patch is required`)
  }
  const archive = realpathSync(archivePath)
  const actualDigest = await sha256(archive)
  if (actualDigest !== metadata.archiveSha256) {
    throw new Error(`archive SHA-256 mismatch: expected ${metadata.archiveSha256}, received ${actualDigest}`)
  }
  const patch = resolve(target, metadata.patch)
  const patchRelative = relative(root, patch)
  if (isAbsolute(patchRelative) || patchRelative.startsWith(`..${sep}`) || patchRelative === '..') {
    throw new Error(`${packageRelative}/upstream.json: patch must stay inside the repository`)
  }

  const temporary = await mkdtemp(join(tmpdir(), 'dsh-insight-source-'))
  try {
    command('tar', ['-xzf', archive, '-C', temporary], root, 'source archive extraction failed')
    const entries = await readdir(temporary)
    const [topLevel] = entries
    if (topLevel === undefined || entries.length !== 1 || !lstatSync(join(temporary, topLevel)).isDirectory()) {
      throw new Error('source archive must contain exactly one top-level directory')
    }
    const replay = join(temporary, topLevel)
    command('git', ['apply', '--binary', '--whitespace=nowarn', patch], replay, 'source patch failed')
    compareTrees(replay, target, packageFiles(root, packageRelative))
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const [packageDir, archivePath, ...extra] = process.argv.slice(2)
  if (packageDir === undefined || archivePath === undefined || extra.length > 0) {
    throw new Error('usage: verify-insight-source-patch <package-dir> <local-archive.tar.gz>')
  }
  await verifyInsightSourcePatch(packageDir, archivePath)
  console.log(`verify-insight-source-patch: ${packageDir} matches its pinned archive and patch.`)
}
