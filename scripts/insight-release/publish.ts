/** Authenticated, target-local candidate publication for the Insight desktop update feed. */

import { sign, type KeyObject } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import semver from 'semver'
import {
  sha512,
  verifyInsightRollout,
  verifyInsightTargetManifest,
  type InsightTargetManifest,
  type InsightUpdateArtifact,
  type InsightUpdateTarget,
} from '@insight-ai/desktop-integration/desktop'
import {
  verifyInsightDesktopBuildManifest,
  type InsightDesktopBuildAsset,
  type InsightDesktopBuildTarget,
} from './artifacts.ts'
import {
  canonicalJson,
  exactlyOneBuildAsset,
  immutableUploadSource,
  publishPointer,
  remoteMatches,
  selectUpdateAssets,
  signingKeyFor,
  targetFields,
  verifyUpdaterMetadata,
  type PublishImmutableObject,
} from './publish-common.ts'

const CANDIDATE_MINIMUM_VERSION = '1.0.9'
const TARGET_MANIFEST_NAME = 'insight-target.json'
const TARGET_MANIFEST_SIGNATURE_NAME = 'insight-target.json.sig'
const MAX_METADATA_BYTES = 4 * 1024 * 1024

/** Metadata returned for a small OSS object. */
export interface InsightRemoteMetadata {
  /** Complete object bytes. */
  readonly bytes: Uint8Array
  /** Opaque object revision used for compare-and-swap. */
  readonly etag: string
}

/** Result of streaming one OSS object into a caller-owned file. */
export interface InsightRemoteDownload {
  /** Downloaded byte length. */
  readonly size: number
  /** SHA-512 digest encoded as base64. */
  readonly sha512: string
  /** Opaque object revision observed by the download. */
  readonly etag: string
}

/** OSS operations required by candidate publication. */
export interface PublishInsightTransport {
  /** Read one metadata-sized object; an absent object returns `undefined`. */
  getMetadata(key: string): Promise<InsightRemoteMetadata | undefined>
  /** Stream one object to `destination`; an absent object returns `undefined`. */
  download(key: string, destination: string): Promise<InsightRemoteDownload | undefined>
  /** Create one immutable object without replacing an existing key. */
  putImmutable(key: string, source: { readonly bytes: Uint8Array } | { readonly path: string }): Promise<void>
  /** Replace the mutable pointer only when the supplied compare-and-swap condition holds. */
  putPointer(
    key: string,
    bytes: Uint8Array,
    condition: { readonly expectedEtag: string } | { readonly ifAbsent: true },
  ): Promise<void>
}

/** Data-compatibility declaration embedded in a target manifest. */
export type InsightReleaseCompatibility = InsightTargetManifest['compatibility']

/** Inputs for publishing one signed candidate target. */
export interface PublishInsightCandidateInput {
  /** Directory produced by the collection stage. */
  readonly directory: string
  /** Canonical 1.x prerelease version. */
  readonly version: string
  /** Complete source revision that produced the build. */
  readonly sourceCommit: string
  /** Platform and architecture represented by the directory. */
  readonly target: InsightDesktopBuildTarget
  /** Explicit data compatibility of this client. */
  readonly compatibility: InsightReleaseCompatibility
  /** Ed25519 private signing key in PEM form. */
  readonly privateKeyPem: string
  /** Pinned Ed25519 public verification key in PEM form. */
  readonly publicKeyPem: string
  /** OSS implementation; it owns authentication and conditional-write details. */
  readonly transport: PublishInsightTransport
  /** Clock used only when advancing the candidate pointer to a new version. */
  readonly now?: () => number
}

/** Published target and pointer identities. */
export interface PublishedInsightCandidate {
  /** Immutable target manifest key. */
  readonly manifestKey: string
  /** Mutable candidate pointer key. */
  readonly pointerKey: string
  /** Published application version. */
  readonly version: string
}

/**
 * Publish one independently signed candidate target, switching its pointer only after remote verification.
 *
 * Immutable uploads left by a failed attempt are retained and verified on retry. A failed or unknown
 * conditional write is never retried inside this operation.
 * @param input - Verified local build identity, signing keys, compatibility, and OSS transport.
 * @returns Immutable manifest and mutable pointer keys after a byte-identical pointer readback.
 */
export async function publishInsightCandidate(input: PublishInsightCandidateInput): Promise<PublishedInsightCandidate> {
  requireCandidateVersion(input.version)
  const signingKey = signingKeyFor(input.privateKeyPem, input.publicKeyPem)
  const manifestFilename = `insight-build-${input.target}.json`
  const build = await verifyInsightDesktopBuildManifest({
    artifactDirectory: input.directory,
    manifestFilename,
    expected: { version: input.version, sourceCommit: input.sourceCommit, target: input.target },
    purpose: 'publish',
  })
  const selected = selectArtifacts(input.directory, build.assets, input.version, input.target)
  if (selected.metadata.asset.size > MAX_METADATA_BYTES) throw new Error('Insight updater metadata exceeds the size limit.')
  verifyUpdaterMetadata(await readFile(selected.metadata.path), input.version, selected.payload.asset)

  const manifest: InsightTargetManifest = {
    schema: 'insight-desktop-target/v3',
    version: input.version,
    target: targetFields(input.target),
    shellCommit: input.sourceCommit,
    coreRuntime: { tag: build.runtimeVersion, commit: input.sourceCommit },
    compatibility: input.compatibility,
    artifacts: selected.ordered.map(entry => artifactRecord(entry.asset, input.target, entry.kind)),
  }
  const manifestBytes = canonicalJson(manifest)
  const manifestHash = sha512(manifestBytes)
  const manifestSignature = new Uint8Array(sign(null, manifestBytes, signingKey))
  verifyInsightTargetManifest({
    bytes: manifestBytes,
    signature: manifestSignature,
    publicKeyPem: input.publicKeyPem,
    expectedHash: manifestHash,
    expectedTarget: input.target,
    expectedVersion: input.version,
    schema: 'v3',
  })

  const releasePrefix = `desktop/native/releases/v${input.version}/targets/${input.target}/`
  const manifestKey = `${releasePrefix}${TARGET_MANIFEST_NAME}`
  const pointerKey = `desktop/candidate-v3/${input.target}/current.json`
  const current = await input.transport.getMetadata(pointerKey)
  if (current !== undefined && current.etag === '') throw new Error('Candidate pointer has no usable ETag.')
  const currentRollout = current === undefined
    ? undefined
    : verifyInsightRollout(current.bytes, input.publicKeyPem, 'candidate').rollout
  if (currentRollout !== undefined) {
    if (currentRollout.target !== input.target) throw new Error('Existing candidate pointer targets a different platform.')
    if (semver.gt(currentRollout.version, input.version)) throw new Error('Candidate publication would move the pointer backwards.')
    if (currentRollout.version === input.version && currentRollout.referencedSha512 !== manifestHash) {
      throw new Error('An existing candidate version refers to different target manifest bytes.')
    }
    if (currentRollout.version === input.version && currentRollout.state !== 'active') {
      throw new Error('A withdrawn candidate version must not be republished.')
    }
  }

  const sameVersion = currentRollout?.version === input.version
  const pointerBytes = sameVersion && current !== undefined
    ? current.bytes
    : signedCandidatePointer(input, manifestHash, signingKey)
  verifyInsightRollout(pointerBytes, input.publicKeyPem, 'candidate')

  const immutable: PublishImmutableObject[] = [
    ...selected.ordered.map(entry => ({
      key: `${releasePrefix}${entry.asset.filename}`,
      size: entry.asset.size,
      sha512: entry.asset.sha512,
      source: { path: entry.path },
    })),
    { key: manifestKey, size: manifestBytes.byteLength, sha512: manifestHash, source: { bytes: manifestBytes } },
    {
      key: `${releasePrefix}${TARGET_MANIFEST_SIGNATURE_NAME}`,
      size: manifestSignature.byteLength,
      sha512: sha512(manifestSignature),
      source: { bytes: manifestSignature },
    },
  ]
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'insight-release-publish-'))
  try {
    for (const [index, object] of immutable.entries()) {
      if (!await remoteMatches(input.transport, object, join(temporaryDirectory, `existing-${String(index)}`), 'release')) {
        const snapshot = join(temporaryDirectory, `upload-${String(index)}`)
        try {
          await input.transport.putImmutable(
            object.key,
            await immutableUploadSource(object, snapshot, 'release'),
          )
        } finally {
          await rm(snapshot, { force: true })
        }
      }
    }
    for (const [index, object] of immutable.entries()) {
      if (!await remoteMatches(input.transport, object, join(temporaryDirectory, `verified-${String(index)}`), 'release')) {
        throw new Error(`Immutable release object is missing after upload: ${object.key}`)
      }
    }

    await publishPointer(input.transport, pointerKey, pointerBytes, current, sameVersion, 'Candidate')
    return { manifestKey, pointerKey, version: input.version }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

function requireCandidateVersion(version: string): void {
  const parsed = semver.parse(version)
  if (semver.valid(version) !== version || parsed === null || parsed.major !== 1 ||
    parsed.build.length !== 0 || parsed.prerelease.length === 0) {
    throw new Error('Insight candidate publication requires a canonical 1.x prerelease version without build metadata.')
  }
}

function signedCandidatePointer(input: PublishInsightCandidateInput, manifestHash: string, signingKey: KeyObject): Uint8Array {
  const milliseconds = (input.now ?? Date.now)()
  if (!Number.isFinite(milliseconds)) throw new Error('Candidate publication clock returned an invalid timestamp.')
  const publishedAt = new Date(milliseconds).toISOString()
  const payload = canonicalJson({
    schema: 'insight-desktop-rollout/v3',
    state: 'active',
    track: 'candidate',
    version: input.version,
    target: input.target,
    referencedSha512: manifestHash,
    policy: { mode: 'optional', minimumSupportedVersion: CANDIDATE_MINIMUM_VERSION },
    publishedAt,
  })
  return canonicalJson({
    schema: 'insight-desktop-rollout-envelope/v3',
    payloadBase64: Buffer.from(payload).toString('base64'),
    signatureBase64: sign(null, payload, signingKey).toString('base64'),
  })
}

function artifactRecord(
  asset: InsightDesktopBuildAsset,
  target: InsightUpdateTarget,
  kind: InsightUpdateArtifact['kind'],
): InsightUpdateArtifact {
  return { ...targetFields(target), kind, name: asset.filename, size: asset.size, sha512: asset.sha512 }
}

function selectArtifacts(
  directory: string,
  assets: readonly InsightDesktopBuildAsset[],
  version: string,
  target: InsightDesktopBuildTarget,
): {
  readonly metadata: { readonly asset: InsightDesktopBuildAsset; readonly path: string }
  readonly payload: { readonly asset: InsightDesktopBuildAsset; readonly path: string }
  readonly ordered: readonly {
    readonly asset: InsightDesktopBuildAsset
    readonly path: string
    readonly kind: InsightUpdateArtifact['kind']
  }[]
} {
  const { metadata, payload, blockmap } = selectUpdateAssets(assets, version, target)
  const ordered = target === 'win32-x64'
    ? [withKind(payload, 'nsis'), withKind(blockmap, 'blockmap'), withKind(metadata, 'updater-metadata')]
    : [
      withKind(exactlyOneBuildAsset(assets, asset => asset.filename.endsWith('.dmg'), 'macOS installer'), 'dmg'),
      withKind(payload, 'zip'),
      withKind(blockmap, 'blockmap'),
      withKind(metadata, 'updater-metadata'),
    ]
  if (ordered.length !== assets.length) throw new Error('Insight build contains unrecognized release assets.')
  const local = (asset: InsightDesktopBuildAsset) => ({ asset, path: join(directory, asset.filename) })
  return {
    metadata: local(metadata),
    payload: local(payload),
    ordered: ordered.map(entry => ({ ...entry, path: join(directory, entry.asset.filename) })),
  }
}

function withKind(asset: InsightDesktopBuildAsset, kind: InsightUpdateArtifact['kind']): {
  readonly asset: InsightDesktopBuildAsset
  readonly kind: InsightUpdateArtifact['kind']
} {
  return { asset, kind }
}
