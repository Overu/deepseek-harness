/** Trusted metadata discovery for Insight desktop updates. */

import { load } from 'js-yaml'
import { z } from 'zod'
import semver from 'semver'
import {
  INSIGHT_UPDATE_TARGETS,
  assertReleaseIndexIdentity,
  requiredArtifact,
  sha512,
  targetId,
  verifyInsightReleaseIndex,
  verifyInsightRollout,
  verifyInsightTargetManifest,
  type InsightTargetManifest,
  type InsightUpdateArtifact,
  type InsightUpdatePolicy,
  type InsightRolloutProtocol,
  type InsightUpdateTarget,
  type InsightUpdateTrack,
} from './contract.ts'

/** Largest signed pointer, manifest, index, or updater metadata document. */
const MAX_METADATA_BYTES = 4 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 20_000
const metadataSchema = z.object({
  version: z.string().min(1),
  files: z.array(z.object({ url: z.string(), sha512: z.string(), size: z.number().int().positive() }).strict()).length(1),
  path: z.string(),
  sha512: z.string(),
  releaseDate: z.string().optional(),
  releaseName: z.string().optional(),
  minimumSystemVersion: z.string().refine(value => semver.valid(value) === value).optional(),
}).strict()

/** Strictly validated updater metadata; it contains only one downloadable payload. */
export type InsightUpdateMetadata = z.infer<typeof metadataSchema>

/** Product update resolver input. */
export interface ResolveInsightUpdateInput {
  readonly track: InsightUpdateTrack
  readonly target: InsightUpdateTarget
  readonly distributionOrigin: string | URL
  readonly publicKeyPem: string
  readonly fetch?: typeof globalThis.fetch
  readonly signal?: AbortSignal
  /** Persist the authenticated pointer before accepting its state or requesting referenced documents. */
  readonly acceptRollout?: (input: {
    readonly track: InsightUpdateTrack
    readonly target?: InsightUpdateTarget
    readonly version: string
    readonly state: 'active' | 'rejected'
    readonly fingerprint: string
  }) => Promise<void>
}

/** Trusted result for the desktop update consumer. This resolver never downloads the payload. */
export interface ResolvedInsightUpdate {
  readonly version: string
  readonly sourceCommit: string
  readonly track: InsightUpdateTrack
  readonly policy: InsightUpdatePolicy
  readonly releaseBaseUrl: URL
  readonly metadataAsset: InsightUpdateArtifact
  readonly installerAsset: InsightUpdateArtifact
  readonly payloadAsset: InsightUpdateArtifact
  readonly metadata: InsightUpdateMetadata
  readonly identityFingerprint: string
}

/**
 * Resolve signed Insight desktop update metadata without downloading payload bytes or executing any updater tool.
 * @param input - Requested track, platform target, distribution origin, and signing key.
 * @returns Authenticated update metadata and target-local payload identity.
 */
export async function resolveInsightUpdate(input: ResolveInsightUpdateInput): Promise<ResolvedInsightUpdate> {
  const origin = parseOrigin(input.distributionOrigin)
  const target = assertTarget(input.target)
  const fetchImplementation = input.fetch ?? globalThis.fetch
  if (typeof fetchImplementation !== 'function') throw new Error('No fetch implementation is available for update discovery.')
  const request = createRequest(fetchImplementation, input.signal)
  const selected = input.track === 'stable'
    ? await resolveStableRollout({ request, origin, publicKeyPem: input.publicKeyPem })
    : await resolveCandidateRollout({ request, origin, target, publicKeyPem: input.publicKeyPem })
  const { protocol, pointerBytes, verified } = selected
  await input.acceptRollout?.({ track: input.track, version: verified.rollout.version, state: verified.rollout.state,
    fingerprint: sha512(pointerBytes), ...(input.track === 'candidate' ? { target } : {}) })
  if (verified.rollout.state === 'rejected') throw new Error('Candidate update has been withdrawn.')

  const version = verified.rollout.version
  const targetBase = targetUrl(origin, protocol === 'v3'
    ? `desktop/native/releases/v${version}/targets/${target}/`
    : `desktop/releases/v${version}/targets/${target}/`)
  const manifest = input.track === 'stable'
    ? await resolveStableManifest({
      request, origin, target, version, hash: verified.rollout.referencedSha512, publicKeyPem: input.publicKeyPem,
    })
    : await resolveTargetManifest({
      request, targetBase, target, version, hash: verified.rollout.referencedSha512, publicKeyPem: input.publicKeyPem, schema: protocol,
    })
  const metadataAsset = requiredArtifact(manifest, 'updater-metadata')
  const payloadAsset = requiredArtifact(manifest, target.startsWith('darwin-') ? 'zip' : 'nsis')
  if (protocol === 'v3' && metadataAsset.name !== candidateMetadataFilename(version, target)) {
    throw new Error('Candidate target manifest updater metadata name is not version-target derived.')
  }
  const metadataBytes = await request(assetUrl(targetBase, metadataAsset.name), 'Updater metadata')
  if (metadataBytes.byteLength !== metadataAsset.size || sha512(metadataBytes) !== metadataAsset.sha512) throw new Error('Updater metadata bytes do not match the target manifest.')
  const metadata = parseMetadata(metadataBytes, manifest, payloadAsset)
  return {
    version,
    sourceCommit: manifest.shellCommit,
    track: input.track,
    policy: verified.rollout.policy,
    releaseBaseUrl: targetBase,
    metadataAsset,
    installerAsset: requiredArtifact(manifest, target.startsWith('darwin-') ? 'dmg' : 'nsis'),
    payloadAsset,
    metadata,
    identityFingerprint: verified.fingerprint,
  }
}

async function resolveStableRollout(input: {
  readonly request: MetadataRequest
  readonly origin: URL
  readonly publicKeyPem: string
}): Promise<ResolvedRollout> {
  const pointerBytes = await input.request(targetUrl(input.origin, 'desktop/stable/current.json'), 'Stable update pointer')
  return {
    protocol: 'v2',
    pointerBytes,
    verified: verifyInsightRollout(pointerBytes, input.publicKeyPem, { track: 'stable', protocol: 'v2' }),
  }
}

async function resolveCandidateRollout(input: {
  readonly request: MetadataRequest
  readonly origin: URL
  readonly target: InsightUpdateTarget
  readonly publicKeyPem: string
}): Promise<ResolvedRollout> {
  const optional = createOptionalRequest(input.request)
  const candidates = await Promise.all([
    resolveCandidatePointer({ optional, url: targetUrl(input.origin, `desktop/candidate-v2/${input.target}/current.json`), protocol: 'v2', target: input.target, publicKeyPem: input.publicKeyPem }),
    resolveCandidatePointer({ optional, url: targetUrl(input.origin, `desktop/candidate-v3/${input.target}/current.json`), protocol: 'v3', target: input.target, publicKeyPem: input.publicKeyPem }),
  ])
  const available = candidates.filter((candidate): candidate is ResolvedRollout => candidate !== undefined)
  if (available.length === 0) throw new Error('No candidate update pointer is available for this platform.')
  available.sort((left, right) => semver.rcompare(left.verified.rollout.version, right.verified.rollout.version))
  const [selected, next] = available
  if (selected === undefined) throw new Error('No candidate update pointer is available for this platform.')
  if (next !== undefined && selected.verified.rollout.version === next.verified.rollout.version) {
    throw new Error('Candidate update pointers use the same version across protocols.')
  }
  return selected
}

async function resolveCandidatePointer(input: {
  readonly optional: OptionalMetadataRequest
  readonly url: URL
  readonly protocol: InsightRolloutProtocol
  readonly target: InsightUpdateTarget
  readonly publicKeyPem: string
}): Promise<ResolvedRollout | undefined> {
  const pointerBytes = await input.optional(input.url, 'Candidate update pointer')
  if (pointerBytes === undefined) return undefined
  const verified = verifyInsightRollout(pointerBytes, input.publicKeyPem, { track: 'candidate', protocol: input.protocol })
  if (verified.rollout.target !== input.target) throw new Error('Candidate update pointer targets a different platform.')
  return { protocol: input.protocol, pointerBytes, verified }
}

interface ResolvedRollout {
  readonly protocol: InsightRolloutProtocol
  readonly pointerBytes: Uint8Array
  readonly verified: ReturnType<typeof verifyInsightRollout>
}

async function resolveStableManifest(input: {
  readonly request: MetadataRequest
  readonly origin: URL
  readonly target: InsightUpdateTarget
  readonly version: string
  readonly hash: string
  readonly publicKeyPem: string
}): Promise<InsightTargetManifest> {
  const releaseBase = targetUrl(input.origin, `desktop/releases/v${input.version}/`)
  const [indexBytes, indexSignature] = await Promise.all([
    input.request(assetUrl(releaseBase, 'insight-release.json'), 'Release index'),
    input.request(assetUrl(releaseBase, 'insight-release.json.sig'), 'Release index signature'),
  ])
  const index = verifyInsightReleaseIndex(indexBytes, indexSignature, input.publicKeyPem, input.hash, input.version)
  const manifests = await Promise.all(INSIGHT_UPDATE_TARGETS.map(async (target) => {
    const base = targetUrl(input.origin, `desktop/releases/v${input.version}/targets/${target}/`)
    const reference = index.targets.find(entry => entry.id === target)
    if (reference === undefined) throw new Error('Release index does not include its required target.')
    return resolveTargetManifest({ request: input.request, targetBase: base, target, version: input.version, hash: reference.manifestSha512, publicKeyPem: input.publicKeyPem, schema: 'v2' })
  }))
  assertReleaseIndexIdentity(index, manifests)
  const selected = manifests.find(manifest => targetId(manifest.target) === input.target)
  if (selected === undefined) throw new Error('Release index does not include the requested target.')
  return selected
}

async function resolveTargetManifest(input: {
  readonly request: MetadataRequest
  readonly targetBase: URL
  readonly target: InsightUpdateTarget
  readonly version: string
  readonly hash: string
  readonly publicKeyPem: string
  readonly schema: 'v2' | 'v3'
}): Promise<InsightTargetManifest> {
  const [bytes, signature] = await Promise.all([
    input.request(assetUrl(input.targetBase, 'insight-target.json'), 'Target manifest'),
    input.request(assetUrl(input.targetBase, 'insight-target.json.sig'), 'Target manifest signature'),
  ])
  return verifyInsightTargetManifest({
    bytes,
    signature,
    publicKeyPem: input.publicKeyPem,
    expectedHash: input.hash,
    expectedTarget: input.target,
    expectedVersion: input.version,
    schema: input.schema,
  })
}

type MetadataRequest = (url: URL, label: string) => Promise<Uint8Array>
type OptionalMetadataRequest = (url: URL, label: string) => Promise<Uint8Array | undefined>

function createRequest(fetchImplementation: typeof globalThis.fetch, inheritedSignal: AbortSignal | undefined): MetadataRequest {
  return async (url, label) => {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const signal = inheritedSignal === undefined ? timeout : AbortSignal.any([inheritedSignal, timeout])
    if (signal.aborted) throw signal.reason
    let response: Response
    try {
      response = await fetchImplementation(url, { redirect: 'error', signal, headers: { 'Cache-Control': 'no-cache' } })
    } catch (error: unknown) {
      throw new Error(`${label} request failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (response.url !== url.href || response.redirected) throw new Error(`${label} response is not a trusted successful same-origin response.`)
    if (response.status === 404) throw new MissingUpdateDocumentError(label)
    if (!response.ok) throw new Error(`${label} response is not a trusted successful same-origin response.`)
    return readBounded(response, label, signal)
  }
}

/** Exact same-origin 404 for an optional update document. */
class MissingUpdateDocumentError extends Error {
  constructor(label: string) {
    super(`${label} is not available.`)
  }
}

function createOptionalRequest(request: MetadataRequest): OptionalMetadataRequest {
  return async (url, label) => {
    try {
      return await request(url, label)
    } catch (error) {
      if (error instanceof MissingUpdateDocumentError) return undefined
      throw error
    }
  }
}

async function readBounded(response: Response, label: string, signal: AbortSignal): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null && (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_METADATA_BYTES)) throw new Error(`${label} exceeds the metadata size limit.`)
  if (response.body === null) throw new Error(`${label} has no response body.`)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    if (signal.aborted) throw signal.reason
    const next = await readChunk(reader, signal)
    if (next.done) break
    length += next.value.byteLength
    if (length > MAX_METADATA_BYTES) {
      try { await reader.cancel('metadata too large') } catch (error) { void error }
      throw new Error(`${label} exceeds the metadata size limit.`)
    }
    chunks.push(next.value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

/** Await one stream read while preserving the request abort deadline after headers arrive. */
function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason instanceof Error ? signal.reason : new Error('Update metadata request aborted', { cause: signal.reason }))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    reader.read().then(resolve, reject).finally(() => { signal.removeEventListener('abort', onAbort) })
  })
}

function parseMetadata(bytes: Uint8Array, manifest: InsightTargetManifest, payload: InsightUpdateArtifact): InsightUpdateMetadata {
  let value: unknown
  try { value = load(Buffer.from(bytes).toString('utf8')) } catch (error: unknown) {
    throw new Error(`Updater metadata is not YAML: ${error instanceof Error ? error.message : String(error)}`)
  }
  const metadata = metadataSchema.parse(value)
  const [file] = metadata.files
  if (
    file === undefined || metadata.version !== manifest.version || file.url !== payload.name
    || file.sha512 !== payload.sha512 || file.size !== payload.size || metadata.path !== payload.name
    || metadata.sha512 !== payload.sha512
  ) {
    throw new Error('Updater metadata does not name exactly the signed payload.')
  }
  return metadata
}

function parseOrigin(value: string | URL): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Update distribution origin is invalid.') }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') throw new Error('Update distribution origin must be a bare HTTPS origin.')
  return url
}

function assertTarget(target: InsightUpdateTarget): InsightUpdateTarget {
  if (!(INSIGHT_UPDATE_TARGETS as readonly string[]).includes(target)) throw new Error('Update target is unsupported.')
  return target
}

function targetUrl(origin: URL, path: string): URL {
  const url = new URL(path, origin)
  if (url.origin !== origin.origin || url.search !== '' || url.hash !== '') throw new Error('Update URL escapes the configured origin.')
  return url
}

function assetUrl(base: URL, name: string): URL {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(name)) throw new Error('Update artifact name is unsafe.')
  const url = new URL(name, base)
  if (!url.href.startsWith(base.href) || url.search !== '' || url.hash !== '') throw new Error('Update artifact URL escapes its target directory.')
  return url
}

function candidateMetadataFilename(version: string, target: InsightUpdateTarget): string {
  return `insight-${version}-${target}.yml`
}
