/** Select a new Insight account Home without opening legacy or unrecognized data. */

import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { AuthEnvironment } from '../shared/auth-contracts.ts'
import { accountPaths, accountScopeKey } from './account-scope.ts'

const MARKER_FILE = '.insight-native-home.json'
const MARKER_VERSION = 1

interface NativeHomeMarker {
  readonly version: typeof MARKER_VERSION
  readonly scope: string
  readonly environment: AuthEnvironment
}

/** Input required to select one authenticated account's native DSH Home. */
export interface PrepareInsightAccountHomeInput {
  /** Absolute Insight data root beneath the product's historical Electron userData. */
  readonly insightRoot: string
  /** Product service environment included in the historical account scope. */
  readonly environment: AuthEnvironment
  /** Stable Main-process account identifier returned by the Insight user service. */
  readonly userId: string
}

/** Safe outcome of checking an Insight account's legacy and native Home locations. */
export type InsightAccountHomePreparation =
  | { readonly kind: 'ready'; readonly dshHome: string }
  | { readonly kind: 'migration-required' }

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function pathKind(path: string, label: string): Promise<'missing' | 'directory' | 'file'> {
  try {
    const details = await lstat(path)
    if (details.isSymbolicLink()) throw new Error(`Insight account Home: ${label} must not be a symbolic link`)
    if (details.isDirectory()) return 'directory'
    if (details.isFile()) return 'file'
    throw new Error(`Insight account Home: ${label} has an unsupported filesystem type`)
  } catch (error) {
    if (isMissing(error)) return 'missing'
    throw error
  }
}

async function ensureDirectory(path: string, label: string): Promise<void> {
  const kind = await pathKind(path, label)
  if (kind === 'directory') return
  if (kind === 'file') throw new Error(`Insight account Home: ${label} must be a directory`)
  try {
    await mkdir(path, { mode: 0o700 })
  } catch (error) {
    if (!isMissing(error) && error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      if (await pathKind(path, label) === 'directory') return
    }
    throw error
  }
}

function markerContent(marker: NativeHomeMarker): string {
  return `${JSON.stringify(marker)}\n`
}

function isMarker(value: unknown, expected: NativeHomeMarker): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return Object.keys(candidate).length === 3
    && candidate.version === expected.version
    && candidate.scope === expected.scope
    && candidate.environment === expected.environment
}

async function readMarker(path: string, expected: NativeHomeMarker): Promise<'missing' | 'matching' | 'mismatched'> {
  const kind = await pathKind(path, 'native Home marker')
  if (kind === 'missing') return 'missing'
  if (kind !== 'file') throw new Error('Insight account Home: native Home marker must be a regular file')
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    return isMarker(value, expected) ? 'matching' : 'mismatched'
  } catch (error) {
    if (error instanceof SyntaxError) return 'mismatched'
    throw error
  }
}

async function createMarker(path: string, marker: NativeHomeMarker): Promise<'matching' | 'mismatched'> {
  try {
    await writeFile(path, markerContent(marker), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return 'matching'
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      const existing = await readMarker(path, marker)
      return existing === 'matching' ? 'matching' : 'mismatched'
    }
    throw error
  }
}

/**
 * Prepare the isolated native Home for one Insight account.
 *
 * A legacy `harness` path or an unrecognized non-empty `harness-native` path requires the later
 * migration stage. This function never reads files below the legacy Home and writes only a marker
 * into a newly created or empty native Home. Existing directory permissions and contents remain unchanged.
 *
 * @param input - Trusted product root, service environment, and stable Main-process user identifier.
 * @returns The native DSH Home for a new account, or a migration requirement without a usable path.
 */
export async function prepareInsightAccountHome(
  input: PrepareInsightAccountHomeInput,
): Promise<InsightAccountHomePreparation> {
  if (!isAbsolute(input.insightRoot)) throw new Error('Insight account Home: insightRoot must be absolute')
  if (input.userId.length === 0) throw new Error('Insight account Home: userId must not be empty')

  const scope = accountScopeKey(input.environment, input.userId)
  const paths = accountPaths(input.insightRoot, scope)
  const accountsRoot = join(input.insightRoot, 'accounts')

  await ensureDirectory(input.insightRoot, 'Insight root')
  await ensureDirectory(accountsRoot, 'accounts root')
  await ensureDirectory(paths.root, 'account scope')

  if (await pathKind(paths.harness, 'legacy Home') !== 'missing') return { kind: 'migration-required' }

  const nativeKind = await pathKind(paths.harnessNative, 'native Home')
  if (nativeKind === 'file') throw new Error('Insight account Home: native Home must be a directory')
  if (nativeKind === 'missing') await ensureDirectory(paths.harnessNative, 'native Home')

  const marker: NativeHomeMarker = { version: MARKER_VERSION, scope, environment: input.environment }
  const markerPath = join(paths.harnessNative, MARKER_FILE)
  const existingMarker = await readMarker(markerPath, marker)
  if (existingMarker === 'matching') return { kind: 'ready', dshHome: paths.harnessNative }
  if (existingMarker === 'mismatched') return { kind: 'migration-required' }

  const entries = await readdir(paths.harnessNative)
  if (entries.length !== 0) return { kind: 'migration-required' }
  return await createMarker(markerPath, marker) === 'matching'
    ? { kind: 'ready', dshHome: paths.harnessNative }
    : { kind: 'migration-required' }
}
