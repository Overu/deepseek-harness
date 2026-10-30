/** Retain the Shell account data location for native Insight Desktop. */

import { lstat, mkdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { AuthEnvironment } from '../shared/auth-contracts.ts'
import { accountPaths, accountScopeKey } from './account-scope.ts'

/** Input required to select one authenticated account's native DSH Home. */
export interface PrepareInsightAccountHomeInput {
  /** Absolute Insight data root beneath the product's historical Electron userData. */
  readonly insightRoot: string
  /** Product service environment included in the historical account scope. */
  readonly environment: AuthEnvironment
  /** Stable Main-process account identifier returned by the Insight user service. */
  readonly userId: string
}

/** Safe outcome of selecting the historical Home while retaining pre-release data. */
export type InsightAccountHomePreparation =
  | { readonly kind: 'ready'; readonly dshHome: string }
  | { readonly kind: 'pre-release-data' }

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

/**
 * Reuse the account's historical Shell Home as the native DSH Home.
 *
 * Existing Home contents are never read, converted, moved, or overwritten here. A pre-release
 * native-only Home requires explicit handling so switching defaults cannot hide its data.
 *
 * @param input - Trusted product root, service environment, and stable account identifier.
 * @returns The historical Home, or a notice for pre-release data without a historical Home.
 */
export async function prepareInsightAccountHome(
  input: PrepareInsightAccountHomeInput,
): Promise<InsightAccountHomePreparation> {
  if (!isAbsolute(input.insightRoot)) throw new Error('Insight account Home: insightRoot must be absolute')
  if (input.userId.length === 0) throw new Error('Insight account Home: userId must not be empty')
  const paths = accountPaths(input.insightRoot, accountScopeKey(input.environment, input.userId))
  await ensureDirectory(input.insightRoot, 'Insight root')
  await ensureDirectory(join(input.insightRoot, 'accounts'), 'accounts root')
  await ensureDirectory(paths.root, 'account scope')
  const historical = await pathKind(paths.harness, 'historical Home')
  if (historical === 'file') throw new Error('Insight account Home: historical Home must be a directory')
  if (historical === 'directory') return { kind: 'ready', dshHome: paths.harness }
  if (await pathKind(paths.harnessNative, 'pre-release Home') !== 'missing') return { kind: 'pre-release-data' }
  await ensureDirectory(paths.harness, 'historical Home')
  return { kind: 'ready', dshHome: paths.harness }
}
