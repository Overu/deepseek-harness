/** Immutable artifact manifest support for the Insight desktop release pipeline. */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { finished } from 'node:stream/promises'
import { valid, parse } from 'semver'

/** The only accepted Insight desktop artifact manifest schema. */
export const INSIGHT_DESKTOP_BUILD_SCHEMA = 'insight-desktop-build/v1'

/** Largest accepted manifest, preventing malformed release input from consuming unbounded memory. */
export const INSIGHT_DESKTOP_BUILD_MANIFEST_MAX_BYTES = 256 * 1024

const TARGETS = ['darwin-arm64', 'darwin-x64', 'win32-x64'] as const
const QUALIFICATIONS = ['debug-signed', 'distribution'] as const
const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/u
const SOURCE_COMMIT = /^[0-9a-f]{40}$/u

/** Supported Insight desktop build target. */
export type InsightDesktopBuildTarget = typeof TARGETS[number]

/** Build qualification declared by the packaging caller. */
export type InsightDesktopBuildQualification = typeof QUALIFICATIONS[number]

/** One byte-addressed packaged file. */
export interface InsightDesktopBuildAsset {
  /** Filename in the artifact directory, without path components. */
  readonly filename: string
  /** Exact byte length of the file. */
  readonly size: number
  /** SHA-512 digest encoded as base64, without an integrity prefix. */
  readonly sha512: string
}

/** Immutable release input produced for one Insight desktop target. */
export interface InsightDesktopBuildManifest {
  /** Fixed schema discriminator. */
  readonly schema: typeof INSIGHT_DESKTOP_BUILD_SCHEMA
  /** Fixed product discriminator. */
  readonly product: 'insight'
  /** Fixed macOS and Windows application identifier. */
  readonly appId: 'com.insight-aigc.desktop'
  /** Insight application version. */
  readonly version: string
  /** DSH runtime version used to build this artifact. */
  readonly runtimeVersion: string
  /** Complete source revision that built this artifact. */
  readonly sourceCommit: string
  /** Operating system and CPU target. */
  readonly target: InsightDesktopBuildTarget
  /** Packaging caller's signing/notarization completion declaration. */
  readonly qualification: InsightDesktopBuildQualification
  /** Files that the publish stage must verify before upload. */
  readonly assets: readonly InsightDesktopBuildAsset[]
}

/** Values required to calculate a build manifest from a local artifact directory. */
export interface CreateInsightDesktopBuildManifestInput {
  /** Directory containing only this target's release artifacts. */
  readonly artifactDirectory: string
  /** Manifest filename that will be written beside the assets. */
  readonly manifestFilename: string
  /** Insight application version. */
  readonly version: string
  /** DSH runtime version used for the build. */
  readonly runtimeVersion: string
  /** Complete source revision used for the build. */
  readonly sourceCommit: string
  /** Target represented by this artifact directory. */
  readonly target: InsightDesktopBuildTarget
  /** Packaging caller's qualification declaration. */
  readonly qualification: InsightDesktopBuildQualification
  /** Asset filenames to measure and hash. */
  readonly assetFilenames: readonly string[]
}

/** Expected identity when accepting a manifest from a GitHub Release. */
export interface InsightDesktopBuildManifestExpectation {
  /** Expected Insight application version. */
  readonly version: string
  /** Expected source revision. */
  readonly sourceCommit: string
  /** Expected artifact target. */
  readonly target: InsightDesktopBuildTarget
}

/** Verification settings for one downloaded or locally staged manifest. */
export interface VerifyInsightDesktopBuildManifestInput {
  /** Directory containing the manifest and downloaded assets. */
  readonly artifactDirectory: string
  /** Basename of the manifest in the artifact directory. */
  readonly manifestFilename: string
  /** Identity required by the caller's selected release. */
  readonly expected: InsightDesktopBuildManifestExpectation
  /** `publish` rejects debug-signed inputs before any external upload. */
  readonly purpose: 'github-release' | 'publish'
}

/** Reject an unsafe name before it is joined to an artifact directory. */
function requireBasename(filename: string, label: string): void {
  if (filename === '' || filename === '.' || filename === '..' || basename(filename) !== filename || filename.includes('\\')) {
    throw new Error(`${label} must be a non-empty basename without path components: ${JSON.stringify(filename)}`)
  }
}

/** Reject non-directory roots and symlink roots before locating artifacts in them. */
async function requireArtifactDirectory(directory: string): Promise<void> {
  const metadata = await lstat(directory)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Artifact directory must be a real directory: ${JSON.stringify(directory)}`)
  }
}

/** Read a regular, non-empty, non-linked asset and calculate its immutable measurements. */
async function measureAsset(directory: string, filename: string): Promise<InsightDesktopBuildAsset> {
  requireBasename(filename, 'Asset filename')
  const path = join(directory, filename)
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0) {
    throw new Error(`Asset must be a non-empty regular file, not a directory or link: ${JSON.stringify(filename)}`)
  }
  const hash = createHash('sha512')
  let size = 0
  const stream = createReadStream(path)
  stream.on('data', (chunk: string | Buffer) => {
    size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength
    hash.update(chunk)
  })
  await finished(stream)
  if (size !== metadata.size) {
    throw new Error(`Asset changed while it was measured: ${JSON.stringify(filename)}`)
  }
  return {
    filename,
    size,
    sha512: hash.digest('base64'),
  }
}

/** Validate the semver form used in the immutable manifest. */
function requireVersion(version: string, field: 'version' | 'runtimeVersion'): void {
  const parsed = parse(version)
  if (valid(version) !== version || parsed === null || parsed.build.length !== 0 || (field === 'version' && parsed.major !== 1)) {
    throw new Error(`${field} must be a canonical semver${field === 'version' ? ' in the 1.x line' : ''} without build metadata: ${JSON.stringify(version)}`)
  }
}

/** Parse an object only after rejecting arrays, null, and inherited fields. */
function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be a JSON object`)
  }
  const object: Record<string, unknown> = {}
  for (const [key, property] of Object.entries(value)) object[key] = property
  return object
}

/** Require the exact JSON fields for a manifest object. */
function requireExactFields(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const actual = Object.keys(value)
  if (actual.length !== fields.length || actual.some(field => !fields.includes(field))) {
    throw new Error(`${label} has unknown or missing fields`)
  }
}

/** Whether an untrusted JSON value is one supported build target. */
function isTarget(value: unknown): value is InsightDesktopBuildTarget {
  return typeof value === 'string' && TARGETS.some(target => target === value)
}

/** Whether an untrusted JSON value is one supported qualification declaration. */
function isQualification(value: unknown): value is InsightDesktopBuildQualification {
  return typeof value === 'string' && QUALIFICATIONS.some(qualification => qualification === value)
}

/** Decode and validate untrusted JSON manifest data. */
function decodeManifest(value: unknown): InsightDesktopBuildManifest {
  const object = requireObject(value, 'Manifest')
  const fields = ['schema', 'product', 'appId', 'version', 'runtimeVersion', 'sourceCommit', 'target', 'qualification', 'assets'] as const
  requireExactFields(object, fields, 'Manifest')
  const { schema, product, appId, version, runtimeVersion, sourceCommit, target, qualification, assets } = object
  if (schema !== INSIGHT_DESKTOP_BUILD_SCHEMA || product !== 'insight' || appId !== 'com.insight-aigc.desktop') {
    throw new Error('Manifest identifies a different product or schema')
  }
  if (typeof version !== 'string' || typeof runtimeVersion !== 'string' || typeof sourceCommit !== 'string') {
    throw new Error('Manifest version and source fields must be strings')
  }
  requireVersion(version, 'version')
  requireVersion(runtimeVersion, 'runtimeVersion')
  if (!SOURCE_COMMIT.test(sourceCommit)) throw new Error(`Manifest sourceCommit must be a complete lowercase Git object ID: ${JSON.stringify(sourceCommit)}`)
  if (!isTarget(target)) throw new Error(`Manifest target is unsupported: ${JSON.stringify(target)}`)
  if (!isQualification(qualification)) throw new Error(`Manifest qualification is unsupported: ${JSON.stringify(qualification)}`)
  if (!Array.isArray(assets) || assets.length === 0) throw new Error('Manifest assets must be a non-empty array')

  const filenames = new Set<string>()
  const decodedAssets = assets.map((value, index): InsightDesktopBuildAsset => {
    const asset = requireObject(value, `Manifest asset ${String(index)}`)
    requireExactFields(asset, ['filename', 'size', 'sha512'], `Manifest asset ${String(index)}`)
    const { filename, size, sha512 } = asset
    if (typeof filename !== 'string' || typeof size !== 'number' || typeof sha512 !== 'string') {
      throw new Error(`Manifest asset ${String(index)} has invalid field types`)
    }
    requireBasename(filename, 'Manifest asset filename')
    if (!Number.isSafeInteger(size) || size <= 0 || !SHA512_BASE64.test(sha512)) {
      throw new Error(`Manifest asset ${String(index)} has invalid size or sha512`)
    }
    if (filenames.has(filename)) throw new Error(`Manifest contains duplicate asset filename: ${JSON.stringify(filename)}`)
    filenames.add(filename)
    return { filename, size, sha512 }
  })
  return {
    schema,
    product,
    appId,
    version,
    runtimeVersion,
    sourceCommit,
    target,
    qualification,
    assets: decodedAssets,
  }
}

/**
 * Calculate a manifest for explicitly named local artifacts.
 * @param input - Immutable identity values and artifact filenames.
 * @returns A manifest whose asset measurements match the files at calculation time.
 */
export async function createInsightDesktopBuildManifest(
  input: CreateInsightDesktopBuildManifestInput,
): Promise<InsightDesktopBuildManifest> {
  await requireArtifactDirectory(input.artifactDirectory)
  requireBasename(input.manifestFilename, 'Manifest filename')
  requireVersion(input.version, 'version')
  requireVersion(input.runtimeVersion, 'runtimeVersion')
  if (!SOURCE_COMMIT.test(input.sourceCommit)) throw new Error(`sourceCommit must be a complete lowercase Git object ID: ${JSON.stringify(input.sourceCommit)}`)
  if (!isTarget(input.target)) throw new Error(`Unsupported target: ${JSON.stringify(input.target)}`)
  if (!isQualification(input.qualification)) throw new Error(`Unsupported qualification: ${JSON.stringify(input.qualification)}`)
  if (input.assetFilenames.length === 0) throw new Error('At least one artifact asset is required')
  if (input.assetFilenames.some(filename => filename === input.manifestFilename)) {
    throw new Error('A manifest must not list itself as an asset')
  }
  const assets = await Promise.all(input.assetFilenames.map(filename => measureAsset(input.artifactDirectory, filename)))
  return decodeManifest({
    schema: INSIGHT_DESKTOP_BUILD_SCHEMA,
    product: 'insight',
    appId: 'com.insight-aigc.desktop',
    version: input.version,
    runtimeVersion: input.runtimeVersion,
    sourceCommit: input.sourceCommit,
    target: input.target,
    qualification: input.qualification,
    assets,
  })
}

/**
 * Serialize a validated manifest in a deterministic form for a GitHub Release asset.
 * @param manifest - Manifest produced by this module or decoded from untrusted JSON.
 * @returns UTF-8 JSON followed by one newline.
 */
export function serializeInsightDesktopBuildManifest(manifest: InsightDesktopBuildManifest): string {
  return `${JSON.stringify(decodeManifest(manifest))}\n`
}

/**
 * Write a manifest beside its assets after refusing a symlink or directory destination.
 * @param directory - Existing artifact directory.
 * @param filename - Manifest basename in the artifact directory.
 * @param manifest - Validated manifest to write.
 * @returns Resolves after the complete manifest is written.
 */
export async function writeInsightDesktopBuildManifest(
  directory: string,
  filename: string,
  manifest: InsightDesktopBuildManifest,
): Promise<void> {
  await requireArtifactDirectory(directory)
  requireBasename(filename, 'Manifest filename')
  if (manifest.assets.some(asset => asset.filename === filename)) throw new Error('A manifest must not list itself as an asset')
  const path = join(directory, filename)
  try {
    const metadata = await lstat(path)
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Manifest destination must not be a directory or link: ${JSON.stringify(filename)}`)
  } catch (error: unknown) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  await writeFile(path, serializeInsightDesktopBuildManifest(manifest), { encoding: 'utf8', flag: 'w' })
}

/**
 * Verify a downloaded build manifest and every named artifact byte-for-byte.
 *
 * The SHA-512 values only prove byte equality with this manifest. They do not prove signing, notarization, or release origin.
 * @param input - Location, expected release identity, and intended use.
 * @returns The verified manifest.
 */
export async function verifyInsightDesktopBuildManifest(
  input: VerifyInsightDesktopBuildManifestInput,
): Promise<InsightDesktopBuildManifest> {
  await requireArtifactDirectory(input.artifactDirectory)
  requireBasename(input.manifestFilename, 'Manifest filename')
  const manifestPath = join(input.artifactDirectory, input.manifestFilename)
  const metadata = await lstat(manifestPath)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0 || metadata.size > INSIGHT_DESKTOP_BUILD_MANIFEST_MAX_BYTES) {
    throw new Error(`Manifest must be a non-empty regular file no larger than ${String(INSIGHT_DESKTOP_BUILD_MANIFEST_MAX_BYTES)} bytes`)
  }
  const bytes = await readFile(manifestPath)
  if (bytes.length !== metadata.size) throw new Error('Manifest changed while it was read')
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Manifest is not valid JSON: ${message}`)
  }
  const manifest = decodeManifest(parsed)
  if (manifest.assets.some(asset => asset.filename === input.manifestFilename)) throw new Error('A manifest must not list itself as an asset')
  if (
    manifest.version !== input.expected.version || manifest.sourceCommit !== input.expected.sourceCommit
    || manifest.target !== input.expected.target
  ) {
    throw new Error('Manifest identity does not match the selected release')
  }
  if (input.purpose === 'publish' && manifest.qualification === 'debug-signed') {
    throw new Error('A debug-signed build must not be published')
  }
  for (const asset of manifest.assets) {
    const measured = await measureAsset(input.artifactDirectory, asset.filename)
    if (measured.size !== asset.size || measured.sha512 !== asset.sha512) {
      throw new Error(`Asset bytes do not match manifest: ${JSON.stringify(asset.filename)}`)
    }
  }
  return manifest
}
