/** Stage one completed DSH package as flat, target-unique GitHub Release attachments. */

import { constants } from 'node:fs'
import { appendFile, copyFile, lstat, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { parse } from 'semver'
import {
  createInsightDesktopBuildManifest,
  verifyInsightDesktopBuildManifest,
  writeInsightDesktopBuildManifest,
  type InsightDesktopBuildQualification,
  type InsightDesktopBuildTarget,
} from './artifacts.ts'

/** Inputs from a successfully completed platform packaging job. */
export interface CollectInsightArtifactsInput {
  /** Existing target-owned DSH artifact directory. */
  readonly artifactDirectory: string
  /** Private job temporary directory beneath which staging is allocated. */
  readonly temporaryDirectory: string
  /** Customer-facing version written into the installed application. */
  readonly version: string
  /** Independently versioned DSH runtime embedded in this package. */
  readonly runtimeVersion: string
  /** Pinned source revision of the packaging job. */
  readonly sourceCommit: string
  /** Platform represented by this package job. */
  readonly target: InsightDesktopBuildTarget
  /** Result of the platform packaging job; hashes do not establish this status. */
  readonly qualification: InsightDesktopBuildQualification
}

/** Return the fixed attachment names for one macOS or Windows packaging output. */
function attachmentNames(input: CollectInsightArtifactsInput): readonly { source: string; destination: string }[] {
  const version = parse(input.version)
  if (version === null || version.version !== input.version || version.major !== 1 || version.build.length !== 0) {
    throw new Error('Insight release requires a canonical 1.x version without build metadata')
  }
  const windows = input.target === 'win32-x64'
  if (windows && input.qualification === 'debug-signed') throw new Error('This collector has no unsigned Windows release mode')
  const arch = input.target === 'darwin-arm64' ? 'arm64' : 'x64'
  const suffix = input.qualification === 'debug-signed' ? '-unnotarized' : ''
  const base = `insight-${input.version}-${windows ? 'win' : 'mac'}-${arch}${suffix}`
  const payload = windows ? `${base}.exe` : `${base}.zip`
  const metadata = `${version.prerelease.length > 0 ? 'nightly' : 'latest'}${windows ? '' : '-mac'}.yml`
  const filenames = windows ? [payload, `${payload}.blockmap`] : [`${base}.dmg`, payload, `${payload}.blockmap`]
  return [
    ...filenames.map(filename => ({ source: filename, destination: filename })),
    // Each architecture emits the same builder metadata name; Release attachments share one namespace.
    { source: metadata, destination: `insight-${input.version}-${input.target}.yml` },
  ]
}

/**
 * Copy completed installer bytes and write a target-unique manifest in an exclusive staging directory.
 *
 * The caller must await DSH packaging, including its signing/notarization checks, before declaring distribution.
 * This operation checks file bytes; it does not independently establish platform trust or source buildRunRecord.
 * @param input - Completed target, pinned source identity, and private staging parent.
 * @returns The exclusive staging directory and manifest basename to upload without overwriting existing assets.
 */
export async function collectInsightArtifacts(
  input: CollectInsightArtifactsInput,
): Promise<{ directory: string; manifestFilename: string }> {
  const names = attachmentNames(input)
  const source = await lstat(input.artifactDirectory)
  if (!source.isDirectory() || source.isSymbolicLink()) throw new Error('Insight artifact root must be a real directory')
  await mkdir(input.temporaryDirectory, { recursive: true })
  const directory = await mkdtemp(join(input.temporaryDirectory, 'insight-release-assets-'))
  const manifestFilename = `insight-build-${input.target}.json`
  try {
    for (const file of names) {
      const sourcePath = join(input.artifactDirectory, file.source)
      const metadata = await lstat(sourcePath)
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0) throw new Error(`Invalid packaged asset: ${file.source}`)
      await copyFile(sourcePath, join(directory, file.destination), constants.COPYFILE_EXCL)
    }
    const manifest = await createInsightDesktopBuildManifest({
      ...input, artifactDirectory: directory, manifestFilename,
      assetFilenames: names.map(file => file.destination),
    })
    await writeInsightDesktopBuildManifest(directory, manifestFilename, manifest)
    await verifyInsightDesktopBuildManifest({
      artifactDirectory: directory, manifestFilename,
      expected: { version: input.version, sourceCommit: input.sourceCommit, target: input.target },
      purpose: 'github-release',
    })
    return { directory, manifestFilename }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

function required(value: string | undefined, label: string): string {
  if (!value || value.includes('\n') || value.includes('\r') || value.includes('\0')) throw new Error(`Insight release requires ${label}`)
  return value
}

/** Run collection after the preceding job step completed platform packaging successfully. */
export async function main(environment = process.env): Promise<void> {
  const { values } = parseArgs({ options: { debug: { type: 'boolean', default: false } }, allowPositionals: false })
  const target = required(environment.INSIGHT_RELEASE_TARGET, 'INSIGHT_RELEASE_TARGET')
  if (target !== 'darwin-arm64' && target !== 'darwin-x64' && target !== 'win32-x64') throw new Error('Unsupported Insight release target')
  const runtime: unknown = JSON.parse(await readFile(new URL('../../apps/desktop/package.json', import.meta.url), 'utf8'))
  if (runtime === null || typeof runtime !== 'object' || !('version' in runtime) || typeof runtime.version !== 'string') {
    throw new Error('Desktop package has no runtime version')
  }
  const staged = await collectInsightArtifacts({
    artifactDirectory: required(environment.INSIGHT_ARTIFACT_DIRECTORY, 'INSIGHT_ARTIFACT_DIRECTORY'),
    temporaryDirectory: required(environment.RUNNER_TEMP, 'RUNNER_TEMP'),
    version: required(environment.INSIGHT_DESKTOP_VERSION, 'INSIGHT_DESKTOP_VERSION'),
    runtimeVersion: runtime.version,
    sourceCommit: required(environment.GITHUB_SHA, 'GITHUB_SHA'), target,
    qualification: values.debug ? 'debug-signed' : 'distribution',
  })
  await appendFile(required(environment.GITHUB_OUTPUT, 'GITHUB_OUTPUT'), `release_directory=${staged.directory}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
