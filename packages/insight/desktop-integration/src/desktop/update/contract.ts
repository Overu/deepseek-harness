/** Signed update documents accepted by the Insight desktop update resolver. */

import { createHash, createPublicKey, verify } from 'node:crypto'
import semver from 'semver'
import { z } from 'zod'

/** Supported desktop update target. */
export const INSIGHT_UPDATE_TARGETS = ['darwin-arm64', 'darwin-x64', 'win32-x64'] as const

/** Supported desktop update target. */
export type InsightUpdateTarget = typeof INSIGHT_UPDATE_TARGETS[number]

/** Update channel selected by the caller. */
export type InsightUpdateTrack = 'stable' | 'candidate'

/** Authenticated update policy. */
export interface InsightUpdatePolicy {
  readonly mode: 'optional' | 'required'
  readonly minimumSupportedVersion: string
}

/** A target-local artifact selected from an authenticated manifest. */
export interface InsightUpdateArtifact {
  readonly platform: 'darwin' | 'win32'
  readonly arch: 'arm64' | 'x64'
  readonly kind: 'dmg' | 'zip' | 'nsis' | 'blockmap' | 'updater-metadata'
  readonly name: string
  readonly size: number
  readonly sha512: string
}

/** An authenticated target manifest. */
export interface InsightTargetManifest {
  readonly schema: 'insight-desktop-target/v2' | 'insight-desktop-target/v3'
  readonly version: string
  readonly target: { readonly platform: 'darwin' | 'win32'; readonly arch: 'arm64' | 'x64' }
  readonly shellCommit: string
  readonly coreRuntime: { readonly tag: string; readonly commit: string }
  readonly compatibility: {
    readonly profileSchema: number
    readonly accountStorageSchema: number
    readonly readsDataSchema: { readonly minimum: number; readonly maximum: number }
    readonly writesDataSchema: number
  }
  readonly artifacts: readonly InsightUpdateArtifact[]
}

/** A signed update pointer decoded after Ed25519 verification. */
export interface InsightRollout {
  readonly schema: 'insight-desktop-rollout/v2' | 'insight-desktop-rollout/v3'
  readonly state: 'active' | 'rejected'
  readonly track: InsightUpdateTrack
  readonly version: string
  readonly target?: InsightUpdateTarget | undefined
  readonly referencedSha512: string
  readonly policy: InsightUpdatePolicy
  readonly publishedAt: string
}

/** Signed current-pointer payload used by the source resolver. */
export interface VerifiedInsightRollout {
  readonly rollout: InsightRollout
  readonly fingerprint: string
}

const commitSchema = z.string().regex(/^[0-9a-f]{40}$/u)
const hashSchema = z.string().regex(/^[A-Za-z0-9+/]{86}==$/u)
const sizeSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const artifactNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u)
const targetSchema = z.enum(INSIGHT_UPDATE_TARGETS)
const platformSchema = z.enum(['darwin', 'win32'])
const archSchema = z.enum(['arm64', 'x64'])
const artifactSchema = z.object({
  platform: platformSchema,
  arch: archSchema,
  kind: z.enum(['dmg', 'zip', 'nsis', 'blockmap', 'updater-metadata']),
  name: artifactNameSchema,
  size: sizeSchema,
  sha512: hashSchema,
}).strict()
const runtimeSchema = z.object({ tag: z.string().min(1), commit: commitSchema }).strict()
const compatibilitySchema = z.object({
  profileSchema: z.number().int().nonnegative(),
  accountStorageSchema: z.number().int().nonnegative(),
  readsDataSchema: z.object({ minimum: z.number().int().nonnegative(), maximum: z.number().int().nonnegative() }).strict(),
  writesDataSchema: z.number().int().nonnegative(),
}).strict()
const manifestBaseSchema = z.object({
  version: z.string().min(1),
  target: z.object({ platform: platformSchema, arch: archSchema }).strict(),
  shellCommit: commitSchema,
  coreRuntime: runtimeSchema,
  compatibility: compatibilitySchema,
  artifacts: z.array(artifactSchema).min(1),
}).strict()
const rolloutBaseSchema = z.object({
  state: z.enum(['active', 'rejected']),
  track: z.enum(['stable', 'candidate']),
  version: z.string().min(1),
  target: targetSchema.optional(),
  referencedSha512: hashSchema,
  policy: z.object({ mode: z.enum(['optional', 'required']), minimumSupportedVersion: z.string().min(1) }).strict(),
  publishedAt: z.iso.datetime({ offset: true }),
}).strict()
const v2RolloutSchema = z.object({ schema: z.literal('insight-desktop-rollout/v2'), ...rolloutBaseSchema.shape }).strict()
const v3RolloutSchema = z.object({ schema: z.literal('insight-desktop-rollout/v3'), ...rolloutBaseSchema.shape }).strict()
const envelopeSchema = z.object({
  schema: z.union([z.literal('insight-desktop-rollout-envelope/v2'), z.literal('insight-desktop-rollout-envelope/v3')]),
  payloadBase64: z.string().min(1),
  signatureBase64: z.string().min(1),
}).strict()
const releaseIndexSchema = z.object({
  schema: z.literal('insight-desktop-release/v2'),
  version: z.string().min(1),
  shellCommit: commitSchema,
  coreRuntime: runtimeSchema,
  targets: z.array(z.object({ id: targetSchema, manifestSha512: hashSchema }).strict()),
}).strict()

/**
 * Return a SHA-512 base64 digest for exact downloaded bytes.
 * @param bytes - Exact document or artifact bytes.
 * @returns Canonical base64 SHA-512 digest.
 */
export function sha512(bytes: Uint8Array): string {
  return createHash('sha512').update(bytes).digest('base64')
}

/**
 * Verify a signed v2 or v3 rollout envelope.
 * @param bytes - Exact rollout envelope bytes.
 * @param publicKeyPem - Ed25519 public key used to verify the envelope payload.
 * @param expectedTrack - Update channel and matching protocol generation.
 * @returns Authenticated rollout and its stable identity fingerprint.
 */
export function verifyInsightRollout(bytes: Uint8Array, publicKeyPem: string, expectedTrack: InsightUpdateTrack): VerifiedInsightRollout {
  const envelope = parseCanonicalJson(bytes, envelopeSchema, 'Update rollout envelope')
  const expectedSchema = expectedTrack === 'stable'
    ? 'insight-desktop-rollout-envelope/v2'
    : 'insight-desktop-rollout-envelope/v3'
  if (envelope.schema !== expectedSchema) throw new Error('Update pointer uses the wrong protocol schema.')
  const payloadBytes = decodeCanonicalBase64(envelope.payloadBase64, 'Update rollout payload')
  const signature = decodeCanonicalBase64(envelope.signatureBase64, 'Update rollout signature')
  const key = createPublicKey(publicKeyPem)
  if (!verify(null, payloadBytes, key, signature)) throw new Error('Update rollout signature is invalid.')
  const rollout = expectedTrack === 'stable'
    ? parseCanonicalJson(payloadBytes, v2RolloutSchema, 'Update rollout payload')
    : parseCanonicalJson(payloadBytes, v3RolloutSchema, 'Update rollout payload')
  validateRollout(rollout, expectedTrack)
  return {
    rollout,
    fingerprint: createHash('sha256').update(key.export({ format: 'der', type: 'spki' })).digest('hex'),
  }
}

/**
 * Verify one signed target manifest against its signed parent reference.
 * @param input - Exact manifest bytes, signature, signing key, and expected signed identity.
 * @returns Authenticated target manifest.
 */
export function verifyInsightTargetManifest(input: {
  readonly bytes: Uint8Array
  readonly signature: Uint8Array
  readonly publicKeyPem: string
  readonly expectedHash: string
  readonly expectedTarget: InsightUpdateTarget
  readonly expectedVersion: string
  readonly schema: 'v2' | 'v3'
}): InsightTargetManifest {
  if (sha512(input.bytes) !== input.expectedHash) throw new Error('Target manifest hash does not match its signed parent.')
  if (!verify(null, input.bytes, createPublicKey(input.publicKeyPem), input.signature)) throw new Error('Target manifest signature is invalid.')
  const manifest = parseCanonicalJson(
    input.bytes,
    z.object({ schema: z.literal(input.schema === 'v2' ? 'insight-desktop-target/v2' : 'insight-desktop-target/v3'), ...manifestBaseSchema.shape }).strict(),
    'Target manifest',
    input.schema === 'v3',
  )
  if (manifest.version !== input.expectedVersion || targetId(manifest.target) !== input.expectedTarget) throw new Error('Target manifest identity does not match its pointer.')
  assertVersion(manifest.version, input.schema === 'v2' ? 'final' : 'candidate')
  validateManifest(manifest)
  return manifest
}

/**
 * Verify the signed v2 stable release index and its complete ordered targets.
 * @param bytes - Exact release-index bytes.
 * @param signature - Ed25519 signature for the index bytes.
 * @param publicKeyPem - Ed25519 public key used to verify the index.
 * @param expectedHash - SHA-512 digest recorded by the stable rollout.
 * @param expectedVersion - Version recorded by the stable rollout.
 * @returns Authenticated stable release index.
 */
export function verifyInsightReleaseIndex(
  bytes: Uint8Array,
  signature: Uint8Array,
  publicKeyPem: string,
  expectedHash: string,
  expectedVersion: string,
): z.infer<typeof releaseIndexSchema> {
  if (sha512(bytes) !== expectedHash) throw new Error('Release index hash does not match its signed pointer.')
  if (!verify(null, bytes, createPublicKey(publicKeyPem), signature)) throw new Error('Release index signature is invalid.')
  const index = parseCanonicalJson(bytes, releaseIndexSchema, 'Release index', false)
  if (index.version !== expectedVersion) throw new Error('Release index version does not match its pointer.')
  assertVersion(index.version, 'final')
  if (
    index.targets.length !== INSIGHT_UPDATE_TARGETS.length
    || index.targets.some((entry, index) => entry.id !== INSIGHT_UPDATE_TARGETS[index])
  ) {
    throw new Error('Release index must include every target in the fixed order.')
  }
  return index
}

/**
 * Assert that all signed v2 target manifests share the release index identity.
 * @param index - Authenticated stable release index.
 * @param manifests - Authenticated target manifests named by the index.
 */
export function assertReleaseIndexIdentity(index: z.infer<typeof releaseIndexSchema>, manifests: readonly InsightTargetManifest[]): void {
  if (manifests.length !== INSIGHT_UPDATE_TARGETS.length) throw new Error('Release index requires every target manifest.')
  const first = manifests[0]
  if (first === undefined) throw new Error('Release index requires every target manifest.')
  const seen = new Set<InsightUpdateTarget>()
  for (const manifest of manifests) {
    const target = targetId(manifest.target)
    if (
      seen.has(target) || manifest.version !== index.version || manifest.shellCommit !== index.shellCommit
      || manifest.coreRuntime.tag !== index.coreRuntime.tag || manifest.coreRuntime.commit !== index.coreRuntime.commit
      || !sameCompatibility(manifest.compatibility, first.compatibility)
    ) {
      throw new Error('Release index and target manifests do not share one identity.')
    }
    seen.add(target)
  }
  if (INSIGHT_UPDATE_TARGETS.some(target => !seen.has(target))) throw new Error('Release index requires every target manifest.')
}

/**
 * Obtain the one required artifact by kind after target-manifest validation.
 * @param manifest - Authenticated target manifest.
 * @param kind - Required artifact role.
 * @returns Artifact assigned to the requested role.
 */
export function requiredArtifact(manifest: InsightTargetManifest, kind: InsightUpdateArtifact['kind']): InsightUpdateArtifact {
  const artifact = manifest.artifacts.find(entry => entry.kind === kind)
  if (artifact === undefined) throw new Error(`Target manifest is missing ${kind}.`)
  return artifact
}

/**
 * Convert the platform and architecture fields to a supported target ID.
 * @param target - Manifest platform and architecture fields.
 * @returns Supported update target identifier.
 */
export function targetId(target: InsightTargetManifest['target']): InsightUpdateTarget {
  const id = `${target.platform}-${target.arch}`
  if ((INSIGHT_UPDATE_TARGETS as readonly string[]).includes(id)) return id as InsightUpdateTarget
  throw new Error('Target manifest has an unsupported platform or architecture.')
}

function validateRollout(rollout: InsightRollout, expectedTrack: InsightUpdateTrack): void {
  if (rollout.track !== expectedTrack) throw new Error('Update pointer track does not match the requested track.')
  assertVersion(rollout.version, expectedTrack === 'stable' ? 'final' : 'candidate')
  assertVersion(rollout.policy.minimumSupportedVersion, 'any')
  if (semver.gt(rollout.policy.minimumSupportedVersion, rollout.version)) throw new Error('Update policy minimum version exceeds the release version.')
  if (expectedTrack === 'stable') {
    if (rollout.target !== undefined || rollout.state !== 'active') throw new Error('Stable update pointers must be active and target-neutral.')
  } else if (rollout.target === undefined || rollout.policy.mode !== 'optional') {
    throw new Error('Candidate update pointers must select one target and be optional.')
  }
}

function validateManifest(manifest: InsightTargetManifest): void {
  if (manifest.compatibility.readsDataSchema.minimum > manifest.compatibility.readsDataSchema.maximum) throw new Error('Target manifest has an invalid compatibility range.')
  const target = targetId(manifest.target)
  const expectedKinds = target.startsWith('darwin-')
    ? ['dmg', 'zip', 'blockmap', 'updater-metadata'] as const
    : ['nsis', 'blockmap', 'updater-metadata'] as const
  const kinds = new Set<string>()
  const names = new Set<string>()
  for (const artifact of manifest.artifacts) {
    if (
      artifact.platform !== manifest.target.platform || artifact.arch !== manifest.target.arch
      || kinds.has(artifact.kind) || names.has(artifact.name)
    ) {
      throw new Error('Target manifest has cross-target or duplicate artifacts.')
    }
    kinds.add(artifact.kind)
    names.add(artifact.name)
  }
  if (kinds.size !== expectedKinds.length || expectedKinds.some(kind => !kinds.has(kind))) throw new Error('Target manifest artifact roles are invalid.')
}

function sameCompatibility(left: InsightTargetManifest['compatibility'], right: InsightTargetManifest['compatibility']): boolean {
  return left.profileSchema === right.profileSchema && left.accountStorageSchema === right.accountStorageSchema
    && left.readsDataSchema.minimum === right.readsDataSchema.minimum && left.readsDataSchema.maximum === right.readsDataSchema.maximum
    && left.writesDataSchema === right.writesDataSchema
}

function assertVersion(version: string, kind: 'final' | 'candidate' | 'any'): void {
  const parsed = semver.parse(version)
  if (semver.valid(version) !== version || parsed === null || parsed.build.length !== 0 || parsed.major !== 1) throw new Error('Update version must be canonical 1.x semver without build metadata.')
  if (kind === 'final' && parsed.prerelease.length !== 0) throw new Error('V2 stable updates must use final versions.')
  if (kind === 'candidate' && parsed.prerelease.length === 0) throw new Error('V3 candidate updates must use prerelease versions.')
}

function parseCanonicalJson<T>(bytes: Uint8Array, schema: z.ZodType<T>, label: string, requireCanonical = true): T {
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${label} is not JSON: ${message}`)
  }
  const parsed = schema.parse(value)
  if (requireCanonical && !Buffer.from(JSON.stringify(parsed)).equals(Buffer.from(bytes))) throw new Error(`${label} is not canonical JSON.`)
  return parsed
}

function decodeCanonicalBase64(value: string, label: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) throw new Error(`${label} is not base64.`)
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0 || bytes.toString('base64') !== value) throw new Error(`${label} is not canonical base64.`)
  return bytes
}
