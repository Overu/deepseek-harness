/** Authenticated, all-target stable publication compatible with the Insight V2 update protocol. */

import { sign, type KeyObject } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import semver from 'semver'
import {
  INSIGHT_UPDATE_TARGETS,
  assertReleaseIndexIdentity,
  sha512,
  targetId,
  verifyInsightReleaseIndex,
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
import type { InsightReleaseCompatibility, PublishInsightTransport } from './publish.ts'

const STABLE_MINIMUM_VERSION = '1.0.9'
const TARGET_MANIFEST_NAME = 'insight-target.json'
const TARGET_MANIFEST_SIGNATURE_NAME = 'insight-target.json.sig'
const RELEASE_INDEX_NAME = 'insight-release.json'
const RELEASE_INDEX_SIGNATURE_NAME = 'insight-release.json.sig'
const MAX_METADATA_BYTES = 4 * 1024 * 1024

/** Inputs for one complete stable release publication. */
export interface PublishInsightStableInput {
  /** Collected artifact directory for every supported target. */
  readonly directories: Readonly<Record<InsightDesktopBuildTarget, string>>
  /** Canonical final 1.x application version. */
  readonly version: string
  /** Complete common source revision for every target. */
  readonly sourceCommit: string
  /** Common data compatibility declaration for every target. */
  readonly compatibility: InsightReleaseCompatibility
  /** Ed25519 private signing key in PEM form. */
  readonly privateKeyPem: string
  /** Pinned matching Ed25519 public key in PEM form. */
  readonly publicKeyPem: string
  /** OSS transport used for immutable objects and pointer CAS. */
  readonly transport: PublishInsightTransport
  /** Clock used only when advancing to a new stable version. */
  readonly now?: () => number
}

/** Published stable index and pointer identities. */
export interface PublishedInsightStable {
  /** Immutable signed release-index key. */
  readonly indexKey: string
  /** Mutable stable pointer key. */
  readonly pointerKey: string
  /** Published application version. */
  readonly version: string
}

interface LocalArtifact {
  readonly asset: InsightDesktopBuildAsset
  readonly path: string
  readonly name: string
  readonly kind: InsightUpdateArtifact['kind']
}

interface SignedTarget {
  readonly id: InsightUpdateTarget
  readonly manifest: InsightTargetManifest
  readonly bytes: Uint8Array
  readonly signature: Uint8Array
  readonly hash: string
  readonly artifacts: readonly LocalArtifact[]
}

/**
 * Publish one complete final release and switch the V2 stable pointer after every target is verified remotely.
 * @param input - Three collected target directories, common release identity, signing keys, and OSS transport.
 * @returns Immutable release index and mutable stable pointer keys after byte-identical readback.
 */
export async function publishInsightStable(input: PublishInsightStableInput): Promise<PublishedInsightStable> {
  requireFinalVersion(input.version)
  const signingKey = signingKeyFor(input.privateKeyPem, input.publicKeyPem)
  const targets: SignedTarget[] = []
  let runtimeVersion: string | undefined
  for (const target of INSIGHT_UPDATE_TARGETS) {
    const directory = input.directories[target]
    if (typeof directory !== 'string' || directory === '') throw new Error(`Stable publication is missing ${target}.`)
    const build = await verifyInsightDesktopBuildManifest({
      artifactDirectory: directory,
      manifestFilename: `insight-build-${target}.json`,
      expected: { version: input.version, sourceCommit: input.sourceCommit, target },
      purpose: 'publish',
    })
    if (runtimeVersion === undefined) runtimeVersion = build.runtimeVersion
    else if (runtimeVersion !== build.runtimeVersion) throw new Error('Stable target builds do not share one runtime version.')
    const artifacts = selectArtifacts(directory, build.assets, input.version, target)
    const metadata = exactlyOneArtifact(artifacts, artifact => artifact.kind === 'updater-metadata', 'updater metadata')
    const payload = exactlyOneArtifact(
      artifacts,
      artifact => artifact.kind === (target === 'win32-x64' ? 'nsis' : 'zip'),
      'update payload',
    )
    if (metadata.asset.size > MAX_METADATA_BYTES) throw new Error('Insight updater metadata exceeds the size limit.')
    verifyUpdaterMetadata(await readFile(metadata.path), input.version, payload.asset)
    const manifest: InsightTargetManifest = {
      schema: 'insight-desktop-target/v2',
      version: input.version,
      target: targetFields(target),
      shellCommit: input.sourceCommit,
      coreRuntime: { tag: build.runtimeVersion, commit: input.sourceCommit },
      compatibility: input.compatibility,
      artifacts: artifacts.map(artifact => artifactRecord(artifact, target)),
    }
    const bytes = canonicalJson(manifest)
    const hash = sha512(bytes)
    const signature = new Uint8Array(sign(null, bytes, signingKey))
    const verified = verifyInsightTargetManifest({
      bytes, signature, publicKeyPem: input.publicKeyPem, expectedHash: hash,
      expectedTarget: target, expectedVersion: input.version, schema: 'v2',
    })
    targets.push({ id: target, manifest: verified, bytes, signature, hash, artifacts })
  }
  if (runtimeVersion === undefined) throw new Error('Stable publication requires every target.')

  const index = {
    schema: 'insight-desktop-release/v2' as const,
    version: input.version,
    shellCommit: input.sourceCommit,
    coreRuntime: { tag: runtimeVersion, commit: input.sourceCommit },
    targets: targets.map(target => ({ id: target.id, manifestSha512: target.hash })),
  }
  const indexBytes = canonicalJson(index)
  const indexHash = sha512(indexBytes)
  const indexSignature = new Uint8Array(sign(null, indexBytes, signingKey))
  const verifiedIndex = verifyInsightReleaseIndex(
    indexBytes, indexSignature, input.publicKeyPem, indexHash, input.version,
  )
  assertReleaseIndexIdentity(verifiedIndex, targets.map(target => target.manifest))

  const releasePrefix = `desktop/releases/v${input.version}/`
  const indexKey = `${releasePrefix}${RELEASE_INDEX_NAME}`
  const pointerKey = 'desktop/stable/current.json'
  const current = await input.transport.getMetadata(pointerKey)
  if (current !== undefined && current.etag === '') throw new Error('Stable pointer has no usable ETag.')
  const currentRollout = current === undefined
    ? undefined
    : verifyInsightRollout(current.bytes, input.publicKeyPem, 'stable').rollout
  if (currentRollout !== undefined) {
    if (semver.gt(currentRollout.version, input.version)) throw new Error('Stable publication would move the pointer backwards.')
    if (currentRollout.version === input.version && currentRollout.referencedSha512 !== indexHash) {
      throw new Error('An existing stable version refers to different release-index bytes.')
    }
  }
  const sameVersion = currentRollout?.version === input.version
  const pointerBytes = sameVersion && current !== undefined
    ? current.bytes
    : signedStablePointer(input, indexHash, signingKey)
  verifyInsightRollout(pointerBytes, input.publicKeyPem, 'stable')

  const immutable: PublishImmutableObject[] = []
  for (const target of targets) {
    const id = targetId(target.manifest.target)
    if (id !== target.id) throw new Error('Verified target manifest changed target identity.')
    const targetPrefix = `${releasePrefix}targets/${id}/`
    immutable.push(...target.artifacts.map(artifact => ({
      key: `${targetPrefix}${artifact.name}`,
      size: artifact.asset.size,
      sha512: artifact.asset.sha512,
      source: { path: artifact.path },
    })))
    immutable.push(
      { key: `${targetPrefix}${TARGET_MANIFEST_NAME}`, size: target.bytes.byteLength, sha512: target.hash, source: { bytes: target.bytes } },
      { key: `${targetPrefix}${TARGET_MANIFEST_SIGNATURE_NAME}`, size: target.signature.byteLength, sha512: sha512(target.signature), source: { bytes: target.signature } },
    )
  }
  immutable.push(
    { key: indexKey, size: indexBytes.byteLength, sha512: indexHash, source: { bytes: indexBytes } },
    { key: `${releasePrefix}${RELEASE_INDEX_SIGNATURE_NAME}`, size: indexSignature.byteLength, sha512: sha512(indexSignature), source: { bytes: indexSignature } },
  )

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'insight-stable-publish-'))
  try {
    for (const [position, object] of immutable.entries()) {
      if (!await remoteMatches(input.transport, object, join(temporaryDirectory, `existing-${String(position)}`), 'stable')) {
        const snapshot = join(temporaryDirectory, `upload-${String(position)}`)
        try {
          await input.transport.putImmutable(
            object.key,
            await immutableUploadSource(object, snapshot, 'stable'),
          )
        } finally {
          await rm(snapshot, { force: true })
        }
      }
    }
    for (const [position, object] of immutable.entries()) {
      if (!await remoteMatches(input.transport, object, join(temporaryDirectory, `verified-${String(position)}`), 'stable')) {
        throw new Error(`Immutable stable object is missing after upload: ${object.key}`)
      }
    }
    await publishPointer(input.transport, pointerKey, pointerBytes, current, sameVersion, 'Stable')
    return { indexKey, pointerKey, version: input.version }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

function requireFinalVersion(version: string): void {
  const parsed = semver.parse(version)
  if (semver.valid(version) !== version || parsed === null || parsed.major !== 1 ||
    parsed.build.length !== 0 || parsed.prerelease.length !== 0) {
    throw new Error('Insight stable publication requires a canonical final 1.x version without build metadata.')
  }
}

function signedStablePointer(input: PublishInsightStableInput, indexHash: string, signingKey: KeyObject): Uint8Array {
  const milliseconds = (input.now ?? Date.now)()
  if (!Number.isFinite(milliseconds)) throw new Error('Stable publication clock returned an invalid timestamp.')
  const payload = canonicalJson({
    schema: 'insight-desktop-rollout/v2',
    state: 'active',
    track: 'stable',
    version: input.version,
    referencedSha512: indexHash,
    policy: { mode: 'optional', minimumSupportedVersion: STABLE_MINIMUM_VERSION },
    publishedAt: new Date(milliseconds).toISOString(),
  })
  return canonicalJson({
    schema: 'insight-desktop-rollout-envelope/v2',
    payloadBase64: Buffer.from(payload).toString('base64'),
    signatureBase64: sign(null, payload, signingKey).toString('base64'),
  })
}

function artifactRecord(artifact: LocalArtifact, target: InsightUpdateTarget): InsightUpdateArtifact {
  return {
    ...targetFields(target), kind: artifact.kind, name: artifact.name,
    size: artifact.asset.size, sha512: artifact.asset.sha512,
  }
}

function selectArtifacts(
  directory: string,
  assets: readonly InsightDesktopBuildAsset[],
  version: string,
  target: InsightDesktopBuildTarget,
): readonly LocalArtifact[] {
  const { metadata: localMetadata, payload, blockmap } = selectUpdateAssets(assets, version, target)
  const metadataName = target === 'win32-x64' ? 'latest.yml' : 'latest-mac.yml'
  const records: Array<{ asset: InsightDesktopBuildAsset; name: string; kind: InsightUpdateArtifact['kind'] }> = target === 'win32-x64'
    ? [
      { asset: payload, name: payload.filename, kind: 'nsis' },
      { asset: blockmap, name: blockmap.filename, kind: 'blockmap' },
      { asset: localMetadata, name: metadataName, kind: 'updater-metadata' },
    ]
    : [
      macInstaller(assets),
      { asset: payload, name: payload.filename, kind: 'zip' },
      { asset: blockmap, name: blockmap.filename, kind: 'blockmap' },
      { asset: localMetadata, name: metadataName, kind: 'updater-metadata' },
    ]
  if (records.length !== assets.length) throw new Error(`Stable ${target} build contains unrecognized release assets.`)
  return records.map(record => ({ ...record, path: join(directory, record.asset.filename) }))
}

function macInstaller(
  assets: readonly InsightDesktopBuildAsset[],
): { readonly asset: InsightDesktopBuildAsset; readonly name: string; readonly kind: 'dmg' } {
  const asset = exactlyOneBuildAsset(assets, candidate => candidate.filename.endsWith('.dmg'), 'macOS installer')
  return { asset, name: asset.filename, kind: 'dmg' }
}

function exactlyOneArtifact(
  artifacts: readonly LocalArtifact[],
  predicate: (artifact: LocalArtifact) => boolean,
  label: string,
): LocalArtifact {
  const found = artifacts.filter(predicate)
  const [artifact] = found
  if (found.length !== 1 || artifact === undefined) throw new Error(`Stable build must contain exactly one ${label}.`)
  return artifact
}
