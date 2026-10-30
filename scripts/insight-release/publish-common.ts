/** Shared validation and immutable-upload mechanics for Insight release publishers. */

import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { copyFile, lstat, rm } from 'node:fs/promises'
import { load } from 'js-yaml'
import type { InsightTargetManifest, InsightUpdateTarget } from '@insight-ai/desktop-integration/desktop'
import type { InsightDesktopBuildAsset, InsightDesktopBuildTarget } from './artifacts.ts'
import type { PublishInsightTransport } from './publish.ts'

/** One immutable object whose local source must match its declared measurements. */
export interface PublishImmutableObject {
  /** Remote object key. */
  readonly key: string
  /** Exact byte length. */
  readonly size: number
  /** SHA-512 digest encoded as base64. */
  readonly sha512: string
  /** Complete bytes or a regular local file. */
  readonly source: { readonly bytes: Uint8Array } | { readonly path: string }
}

/**
 * Validate an Ed25519 key pair and return its private signing key.
 * @param privateKeyPem - Private Ed25519 key in PEM form.
 * @param publicKeyPem - Expected matching public Ed25519 key in PEM form.
 * @returns Parsed private key after pair validation.
 */
export function signingKeyFor(privateKeyPem: string, publicKeyPem: string): KeyObject {
  let privateKey: KeyObject
  let publicKey: KeyObject
  try {
    privateKey = createPrivateKey(privateKeyPem)
    publicKey = createPublicKey(publicKeyPem)
  } catch (error: unknown) {
    throw new Error(`Insight release signing key is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Insight release signing requires Ed25519 keys.')
  }
  const derived = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
  const supplied = publicKey.export({ type: 'spki', format: 'der' })
  if (!derived.equals(supplied)) throw new Error('Insight release private and public keys do not match.')
  return privateKey
}

/**
 * Serialize one signed protocol document without insignificant JSON bytes.
 * @param value - JSON-compatible protocol value.
 * @returns Canonical UTF-8 JSON bytes.
 */
export function canonicalJson(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(value))
}

/**
 * Validate updater metadata against the one packaged payload it may select.
 * @param bytes - Complete updater metadata bytes.
 * @param version - Expected application version.
 * @param payload - Exact packaged payload the metadata must select.
 */
export function verifyUpdaterMetadata(bytes: Uint8Array, version: string, payload: InsightDesktopBuildAsset): void {
  let parsed: unknown
  try { parsed = load(Buffer.from(bytes).toString('utf8')) } catch (error: unknown) {
    throw new Error(`Insight updater metadata is not YAML: ${error instanceof Error ? error.message : String(error)}`)
  }
  const metadata = plainObject(parsed, 'Insight updater metadata')
  exactFields(
    metadata,
    ['version', 'files', 'path', 'sha512'],
    ['releaseDate', 'releaseName', 'minimumSystemVersion'],
    'Insight updater metadata',
  )
  if (!Array.isArray(metadata.files) || metadata.files.length !== 1) {
    throw new Error('Insight updater metadata must contain one payload file.')
  }
  const file = plainObject(metadata.files[0], 'Insight updater metadata file')
  exactFields(file, ['url', 'sha512', 'size'], [], 'Insight updater metadata file')
  for (const field of ['releaseDate', 'releaseName', 'minimumSystemVersion'] as const) {
    if (metadata[field] !== undefined && typeof metadata[field] !== 'string') {
      throw new Error(`Insight updater metadata ${field} must be a string.`)
    }
  }
  if (metadata.version !== version || metadata.path !== payload.filename || metadata.sha512 !== payload.sha512 ||
    file.url !== payload.filename || file.sha512 !== payload.sha512 || file.size !== payload.size) {
    throw new Error('Insight updater metadata does not name exactly the packaged payload.')
  }
}

/**
 * Check whether an immutable remote object is byte-identical to its declaration.
 * @param transport - Streaming remote object transport.
 * @param object - Expected immutable object.
 * @param destination - Fresh local path for the streamed comparison.
 * @param label - Product-safe object label for diagnostics.
 * @returns Whether the remote object exists with the expected bytes.
 */
export async function remoteMatches(
  transport: PublishInsightTransport,
  object: PublishImmutableObject,
  destination: string,
  label: 'release' | 'stable',
): Promise<boolean> {
  try {
    const downloaded = await transport.download(object.key, destination)
    if (downloaded === undefined) return false
    const measured = await measureFile(destination, label)
    if (downloaded.size !== object.size || downloaded.sha512 !== object.sha512 ||
      measured.size !== object.size || measured.sha512 !== object.sha512) {
      throw new Error(`Immutable ${label} object already exists with different bytes: ${object.key}`)
    }
    return true
  } finally {
    await rm(destination, { force: true })
  }
}

/**
 * Snapshot a path-backed immutable object and recheck it before transport upload.
 * @param object - Expected immutable object.
 * @param snapshotPath - Fresh local path for a stable upload snapshot.
 * @param label - Product-safe object label for diagnostics.
 * @returns Complete bytes or the verified snapshot path for upload.
 */
export async function immutableUploadSource(
  object: PublishImmutableObject,
  snapshotPath: string,
  label: 'release' | 'stable',
): Promise<PublishImmutableObject['source']> {
  if ('bytes' in object.source) return object.source
  await copyFile(object.source.path, snapshotPath, constants.COPYFILE_EXCL)
  const measured = await measureFile(snapshotPath, label)
  if (measured.size !== object.size || measured.sha512 !== object.sha512) {
    throw new Error(`Local ${label} object changed before upload: ${object.key}`)
  }
  return { path: snapshotPath }
}

/**
 * Conditionally switch one mutable pointer and require byte-identical readback.
 * @param transport - Conditional remote object transport.
 * @param key - Mutable pointer key.
 * @param bytes - Complete signed pointer bytes.
 * @param current - Initially observed pointer bytes and ETag, when present.
 * @param sameVersion - Whether the current pointer already names this exact version and object.
 * @param label - Product-safe pointer label for diagnostics.
 * @returns Promise that resolves only after byte-identical pointer readback.
 */
export async function publishPointer(
  transport: PublishInsightTransport,
  key: string,
  bytes: Uint8Array,
  current: { readonly bytes: Uint8Array; readonly etag: string } | undefined,
  sameVersion: boolean,
  label: 'Candidate' | 'Stable',
): Promise<void> {
  if (!sameVersion) {
    await transport.putPointer(
      key,
      bytes,
      current === undefined ? { ifAbsent: true } : { expectedEtag: current.etag },
    )
  }
  const readback = await transport.getMetadata(key)
  if (readback === undefined || !Buffer.from(readback.bytes).equals(Buffer.from(bytes))) {
    throw new Error(`${label} pointer readback does not match the signed pointer bytes.`)
  }
}

/**
 * Convert a supported update target ID into manifest platform fields.
 * @param target - Supported product update target.
 * @returns Platform and architecture fields for a target manifest.
 */
export function targetFields(target: InsightUpdateTarget): InsightTargetManifest['target'] {
  const [platform, arch] = target.split('-')
  if ((platform !== 'darwin' && platform !== 'win32') || (arch !== 'arm64' && arch !== 'x64')) {
    throw new Error('Insight release target is unsupported.')
  }
  return { platform, arch }
}

/**
 * Select one build asset and reject absent or ambiguous roles.
 * @param assets - Verified build assets.
 * @param predicate - Role predicate that must match exactly once.
 * @param label - Product-safe asset role for diagnostics.
 * @returns The uniquely matching build asset.
 */
export function exactlyOneBuildAsset(
  assets: readonly InsightDesktopBuildAsset[],
  predicate: (asset: InsightDesktopBuildAsset) => boolean,
  label: string,
): InsightDesktopBuildAsset {
  const found = assets.filter(predicate)
  const [asset] = found
  if (found.length !== 1 || asset === undefined) throw new Error(`Insight build must contain exactly one ${label}.`)
  return asset
}

/**
 * Select the shared metadata, install payload, and blockmap roles for one target build.
 * @param assets - Verified build assets.
 * @param version - Expected application version.
 * @param target - Build target represented by the assets.
 * @returns The uniquely selected updater assets.
 */
export function selectUpdateAssets(
  assets: readonly InsightDesktopBuildAsset[],
  version: string,
  target: InsightDesktopBuildTarget,
): {
  readonly metadata: InsightDesktopBuildAsset
  readonly payload: InsightDesktopBuildAsset
  readonly blockmap: InsightDesktopBuildAsset
} {
  const metadata = exactlyOneBuildAsset(
    assets,
    asset => asset.filename === `insight-${version}-${target}.yml`,
    'updater metadata',
  )
  const payload = target === 'win32-x64'
    ? exactlyOneBuildAsset(assets, asset => asset.filename.endsWith('.exe'), 'NSIS payload')
    : exactlyOneBuildAsset(assets, asset => asset.filename.endsWith('.zip'), 'macOS update payload')
  const blockmap = exactlyOneBuildAsset(
    assets,
    asset => asset.filename === `${payload.filename}.blockmap`,
    'payload blockmap',
  )
  return { metadata, payload, blockmap }
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be an object.`)
  }
  return Object.fromEntries(Object.entries(value))
}

function exactFields(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const fields = Object.keys(value)
  if (required.some(field => !(field in value)) || fields.some(field => !required.includes(field) && !optional.includes(field))) {
    throw new Error(`${label} has unknown or missing fields.`)
  }
}

async function measureFile(path: string, label: 'release' | 'stable'): Promise<{ readonly size: number; readonly sha512: string }> {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Downloaded ${label} object is not a regular file.`)
  const hash = createHash('sha512')
  let size = 0
  for await (const chunk of createReadStream(path)) {
    if (!Buffer.isBuffer(chunk)) throw new Error(`Downloaded ${label} object produced non-binary data.`)
    size += chunk.length
    hash.update(chunk)
  }
  if (size !== metadata.size) throw new Error(`Downloaded ${label} object changed while it was verified.`)
  return { size, sha512: hash.digest('base64') }
}
