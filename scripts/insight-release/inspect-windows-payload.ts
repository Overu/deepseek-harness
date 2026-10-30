/** Verify the version-bearing payload format of one installed Insight application. */

import { createRequire } from 'node:module'
import { lstat, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

const desktopRequire = createRequire(new URL('../../apps/desktop/package.json', import.meta.url))
const builderRequire = createRequire(desktopRequire.resolve('app-builder-lib/package.json'))
const asar = builderRequire('@electron/asar') as { extractFile(path: string, filename: string): Buffer }

/** Installed payload formats emitted by the deployed legacy build and the current release builder. */
export type InstalledPayloadKind = 'raw' | 'asar'

/**
 * Require exactly one expected payload format and verify its packaged application version.
 * @param input - Exact owned installation root, required payload format, and expected product version.
 * @returns The verified version.
 * @throws When the expected payload is missing, both formats exist, a path is a link, or the version differs.
 */
export async function inspectInstalledPayload(input: {
  readonly installRoot: string
  readonly kind: InstalledPayloadKind
  readonly expectedVersion: string
}): Promise<string> {
  const installRoot = resolve(input.installRoot)
  const rawManifest = resolve(installRoot, 'resources/app/package.json')
  const asarArchive = resolve(installRoot, 'resources/app.asar')
  const rawExists = await pathExists(rawManifest)
  const asarExists = await pathExists(asarArchive)
  if (rawExists && asarExists) throw new Error('Installed Insight payload contains conflicting raw and ASAR application formats')

  const expectedPath = input.kind === 'raw' ? rawManifest : asarArchive
  const expectedExists = input.kind === 'raw' ? rawExists : asarExists
  const unexpectedExists = input.kind === 'raw' ? asarExists : rawExists
  if (!expectedExists || unexpectedExists) throw new Error(`Installed Insight ${input.kind} application payload is missing or has the wrong format`)
  await assertRegularPathWithoutLinks(expectedPath, installRoot)

  const manifestBytes = input.kind === 'raw'
    ? await readFile(expectedPath)
    : asar.extractFile(expectedPath, 'package.json')
  const manifest: unknown = JSON.parse(manifestBytes.toString('utf8'))
  if (!hasVersion(manifest) || manifest.version !== input.expectedVersion) {
    throw new Error('Installed Insight application payload version does not match the expected release')
  }
  return manifest.version
}

async function assertRegularPathWithoutLinks(path: string, root: string): Promise<void> {
  if (relative(root, path).startsWith('..')) throw new Error('Installed Insight payload is outside InstallLocation')
  let current = path
  for (;;) {
    const entry = await lstat(current)
    if (entry.isSymbolicLink()) throw new Error('Installed Insight payload path contains a link')
    if (current === path && !entry.isFile()) throw new Error('Installed Insight payload is not a regular file')
    if (current === root) {
      if (!entry.isDirectory()) throw new Error('Installed Insight InstallLocation is not a directory')
      return
    }
    const parent = dirname(current)
    if (parent === current) throw new Error('Installed Insight payload did not reach InstallLocation')
    current = parent
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

function hasVersion(value: unknown): value is { readonly version: string } {
  return value !== null && !Array.isArray(value) && typeof value === 'object'
    && 'version' in value && typeof value.version === 'string'
}

if (import.meta.main) {
  const [installRoot, kind, expectedVersion] = process.argv.slice(2)
  if (installRoot === undefined || (kind !== 'raw' && kind !== 'asar') || expectedVersion === undefined || expectedVersion === '') {
    throw new Error('Installed Insight payload inspection requires an installation root, payload format, and expected version')
  }
  process.stdout.write(`${await inspectInstalledPayload({ installRoot, kind, expectedVersion })}\n`)
}
