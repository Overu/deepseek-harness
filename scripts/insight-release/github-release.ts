/** Bind verified Insight package manifests to an immutable GitHub Release. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyInsightDesktopBuildManifest, type InsightDesktopBuildTarget } from './artifacts.ts'

export interface InsightBuildRunRecord { schema: 'insight-build-run/v1'; repositoryId: 1429559776; workflowPath: '.github/workflows/insight-package.yml'; workflowRunId: number; workflowRunAttempt: number; headSha: string; version: string; qualification: 'distribution' | 'debug-signed'; targets: readonly { target: InsightDesktopBuildTarget; artifactName: string; manifestFilename: string; manifestSha512: string }[] }
export interface FinalizeInsightGitHubReleaseInput { repository: string; token: string; tag: string; version: string; sourceCommit: string; releaseDirectories: readonly string[]; targets: readonly InsightDesktopBuildTarget[]; qualification: 'distribution' | 'debug-signed'; draft: boolean; fetch?: typeof globalThis.fetch }
type Asset = { id: number; name: string; size: number; state: 'uploaded' | 'starter'; url: string }
type Release = { id: number; draft: boolean; target_commitish: string; upload_url: string; assets: Asset[] }
const commit = /^[0-9a-f]{40}$/u
const targets = new Set<InsightDesktopBuildTarget>(['darwin-arm64', 'darwin-x64', 'win32-x64'])
const MAX_METADATA_BYTES = 4 * 1024 * 1024
const hash = (bytes: Uint8Array) => createHash('sha512').update(bytes).digest('base64')
function header(token: string, extra: HeadersInit = {}): Headers {
  const result = new Headers(extra)
  result.set('Authorization', `Bearer ${token}`)
  result.set('Accept', 'application/vnd.github+json')
  result.set('X-GitHub-Api-Version', '2022-11-28')
  return result
}
function api(repository: string, path: string) { return `https://api.github.com/repos/${repository}${path}` }

function uploadUrl(repository: string, release: Release): string {
  const expected = `https://uploads.github.com/repos/${repository}/releases/${String(release.id)}/assets{?name,label}`
  if (release.upload_url !== expected) throw new Error('Insight GitHub Release upload URL is outside the trusted repository')
  return expected.slice(0, -'{?name,label}'.length)
}

/** Write the pointer that later publication verifies against the immutable Actions run. */
export async function writeInsightBuildRunRecord(directory: string, buildRunRecord: InsightBuildRunRecord): Promise<string> {
  if (!commit.test(buildRunRecord.headSha) || buildRunRecord.targets.length === 0) throw new Error('Insight Release buildRunRecord is invalid')
  const filename = join(directory, 'insight-build-run.json')
  await writeFile(filename, `${JSON.stringify(buildRunRecord)}\n`, { mode: 0o600 })
  return filename
}
/** Derive canonical per-target manifest measurements for the stage-two buildRunRecord verifier. */
export async function createInsightBuildRunRecord(input: Omit<InsightBuildRunRecord, 'schema' | 'repositoryId' | 'workflowPath' | 'targets'> & { readonly directories: Readonly<Partial<Record<InsightDesktopBuildTarget, string>>> }): Promise<InsightBuildRunRecord> {
  const order: readonly InsightDesktopBuildTarget[] = ['darwin-arm64', 'darwin-x64', 'win32-x64']
  const selected = order.filter(target => input.directories[target] !== undefined)
  return { schema: 'insight-build-run/v1', repositoryId: 1429559776, workflowPath: '.github/workflows/insight-package.yml',
    workflowRunId: input.workflowRunId, workflowRunAttempt: input.workflowRunAttempt, headSha: input.headSha,
    version: input.version, qualification: input.qualification,
    targets: await Promise.all(selected.map(async (target) => {
      const directory = input.directories[target]
      if (directory === undefined) throw new Error('Insight Release buildRunRecord is missing a target directory')
      const manifestFilename = `insight-build-${target}.json`; const bytes = await readFile(join(directory, manifestFilename))
      return { target, artifactName: `insight-package-${target}-${input.version}`, manifestFilename, manifestSha512: hash(bytes) }
    })) }
}
interface ReleaseFile { readonly name: string; readonly path: string; readonly size: number; readonly sha512: string }

async function files(input: FinalizeInsightGitHubReleaseInput): Promise<ReleaseFile[]> {
  const all: ReleaseFile[] = []
  const seen = new Set<string>()
  for (const directory of input.releaseDirectories) for (const entry of await readdir(directory)) {
    if (!/^insight-build-(darwin-arm64|darwin-x64|win32-x64)\.json$/u.test(entry)) continue
    const target = entry.slice(14, -5) as InsightDesktopBuildTarget
    if (!targets.has(target) || !input.targets.includes(target) || seen.has(target)) throw new Error('Insight GitHub Release has an unexpected target')
    seen.add(target)
    const manifest = await verifyInsightDesktopBuildManifest({ artifactDirectory: directory, manifestFilename: entry, expected: { version: input.version, sourceCommit: input.sourceCommit, target }, purpose: 'github-release' })
    if (manifest.qualification !== input.qualification) throw new Error('Insight GitHub Release qualification differs')
    for (const asset of manifest.assets) all.push(await localFile(directory, asset.filename, asset.size, asset.sha512))
    all.push(await localFile(directory, entry, undefined, undefined, MAX_METADATA_BYTES))
  }
  for (const directory of input.releaseDirectories) try { all.push(await localFile(directory, 'insight-build-run.json', undefined, undefined, MAX_METADATA_BYTES)); break } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  if (seen.size !== input.targets.length || new Set(all.map(file => file.name)).size !== all.length) throw new Error('Insight GitHub Release artifact set is incomplete')
  return all
}

async function localFile(
  directory: string, name: string, expectedSize: number | undefined, expectedHash: string | undefined, maximum?: number,
): Promise<ReleaseFile> {
  const path = join(directory, name)
  const metadata = await lstat(path)
  const mismatchedSize = expectedSize !== undefined && metadata.size !== expectedSize
  const exceedsMaximum = maximum !== undefined && metadata.size > maximum
  if (!metadata.isFile() || metadata.isSymbolicLink() || mismatchedSize || exceedsMaximum) {
    throw new Error(`Insight GitHub Release file is invalid: ${name}`)
  }
  const measured = await hashFile(path, maximum)
  if (expectedHash !== undefined && measured.sha512 !== expectedHash) {
    throw new Error(`Insight GitHub Release file differs from its manifest: ${name}`)
  }
  return { name, path, size: measured.size, sha512: measured.sha512 }
}
/** Create or retry a Release only when all manifest and existing attachment bytes match. */
export async function finalizeInsightGitHubRelease(input: FinalizeInsightGitHubReleaseInput): Promise<void> {
  if (!commit.test(input.sourceCommit)) throw new Error('Insight GitHub Release source commit is invalid')
  const fetch = input.fetch ?? globalThis.fetch; const payloads = await files(input)
  let response = await fetch(api(input.repository, `/releases/tags/${encodeURIComponent(input.tag)}`), { headers: header(input.token), signal: AbortSignal.timeout(60_000), redirect: 'error' }); let release: Release
  if (response.status === 404) { response = await fetch(api(input.repository, '/releases'), { method: 'POST', headers: header(input.token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ tag_name: input.tag, target_commitish: input.sourceCommit, name: input.tag, draft: true, prerelease: input.version.includes('-'), generate_release_notes: false }), signal: AbortSignal.timeout(60_000), redirect: 'error' }); if (!response.ok) throw new Error('Insight GitHub Release creation failed'); release = releaseRecord(await jsonResponse(response)) } else { if (!response.ok) throw new Error('Insight GitHub Release lookup failed'); release = releaseRecord(await jsonResponse(response)) }
  if (release.target_commitish !== input.sourceCommit) throw new Error('Insight GitHub Release tag points at a different source commit')
  const expected = new Map(payloads.map(payload => [payload.name, payload]))
  const existing = assetsByName(input.repository, release.assets)
  if ([...existing.keys()].some(name => !expected.has(name))) throw new Error('Insight GitHub Release contains an unexpected attachment')
  if (!release.draft && existing.size !== expected.size) throw new Error('Insight GitHub Release is published with incomplete attachments')
  const upload = uploadUrl(input.repository, release)
  for (const payload of payloads) {
    const prior = existing.get(payload.name)
    if (prior?.state === 'starter') {
      const removed = await fetch(prior.url, { method: 'DELETE', headers: header(input.token), signal: AbortSignal.timeout(60_000), redirect: 'error' })
      if (!removed.ok) throw new Error(`Insight GitHub Release starter attachment removal failed: ${payload.name}`)
    } else if (prior !== undefined) {
      if (prior.size !== payload.size || await downloadAsset(fetch, input.token, prior.url, payload.size) !== payload.sha512) {
        throw new Error(`Insight GitHub Release attachment differs: ${payload.name}`)
      }
      continue
    }
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers: header(input.token, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(payload.size) }), body: fileBody(payload.path), duplex: 'half', signal: AbortSignal.timeout(3_600_000), redirect: 'error' }
    const put = await fetch(`${upload}?name=${encodeURIComponent(payload.name)}`, init)
    if (!put.ok) throw new Error(`Insight GitHub Release upload failed: ${payload.name}`)
  }
  const finalResponse = await fetch(api(input.repository, `/releases/${String(release.id)}`), { headers: header(input.token), signal: AbortSignal.timeout(60_000), redirect: 'error' })
  if (!finalResponse.ok) throw new Error('Insight GitHub Release final attachment lookup failed')
  const final = releaseRecord(await jsonResponse(finalResponse))
  const finalized = assetsByName(input.repository, final.assets)
  if (finalized.size !== expected.size || [...expected.keys()].some(name => !finalized.has(name))) throw new Error('Insight GitHub Release did not retain every expected attachment')
  for (const payload of payloads) {
    const asset = finalized.get(payload.name)
    if (asset === undefined || asset.size !== payload.size) throw new Error(`Insight GitHub Release attachment differs: ${payload.name}`)
    if (await downloadAsset(fetch, input.token, asset.url, payload.size) !== payload.sha512) throw new Error(`Insight GitHub Release attachment differs: ${payload.name}`)
  }
  if (!input.draft && final.draft) {
    const published = await fetch(api(input.repository, `/releases/${String(final.id)}`), { method: 'PATCH', headers: header(input.token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ draft: false }), signal: AbortSignal.timeout(60_000), redirect: 'error' })
    if (!published.ok) throw new Error('Insight GitHub Release publication failed')
    const publishedRelease = releaseRecord(await jsonResponse(published))
    if (publishedRelease.id !== final.id || publishedRelease.target_commitish !== input.sourceCommit || publishedRelease.draft) {
      throw new Error('Insight GitHub Release publication did not make the verified draft visible')
    }
  }
}

function releaseRecord(value: unknown): Release {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Insight GitHub Release response is invalid')
  const record = value as Record<string, unknown>
  const { id, draft, target_commitish: targetCommitish, upload_url: uploadUrlValue, assets } = record
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || typeof draft !== 'boolean' || typeof targetCommitish !== 'string' || typeof uploadUrlValue !== 'string' || !Array.isArray(assets)) throw new Error('Insight GitHub Release response is invalid')
  return { id, draft, target_commitish: targetCommitish, upload_url: uploadUrlValue, assets: assets.map(assetRecord) }
}

function assetRecord(value: unknown): Asset {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Insight GitHub Release attachment is invalid')
  const record = value as Record<string, unknown>
  const { id, name, size, state, url } = record
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || typeof name !== 'string' || typeof size !== 'number' || !Number.isSafeInteger(size) || (state !== 'uploaded' && state !== 'starter') || typeof url !== 'string') throw new Error('Insight GitHub Release attachment is invalid')
  return { id, name, size, state, url }
}

function assetsByName(repository: string, assets: readonly Asset[]): Map<string, Asset> {
  const result = new Map<string, Asset>()
  for (const asset of assets) {
    if (asset.name === '' || asset.size < 0 || asset.url !== api(repository, `/releases/assets/${String(asset.id)}`) || result.has(asset.name)) throw new Error('Insight GitHub Release attachment is invalid')
    result.set(asset.name, asset)
  }
  return result
}

async function hashFile(path: string, maximum?: number): Promise<{ size: number; sha512: string }> {
  const digest = createHash('sha512')
  let size = 0
  const stream: AsyncIterable<Buffer> = createReadStream(path)
  for await (const chunk of stream) {
    size += chunk.byteLength
    if (maximum !== undefined && size > maximum) throw new Error('Insight GitHub Release metadata exceeds its size limit')
    digest.update(chunk)
  }
  return { size, sha512: digest.digest('base64') }
}

async function hashResponse(response: Response, expectedSize: number): Promise<string> {
  if (response.body === null) throw new Error('Insight GitHub Release attachment has no body')
  const digest = createHash('sha512'); let size = 0
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader()
  while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > expectedSize) { await reader.cancel(); throw new Error('Insight GitHub Release attachment exceeds its expected size') }; digest.update(next.value) }
  if (size !== expectedSize) throw new Error('Insight GitHub Release attachment size differs')
  return digest.digest('base64')
}

const ASSET_REDIRECT_HOSTS = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com'])

async function downloadAsset(fetch: typeof globalThis.fetch, token: string, url: string, expectedSize: number): Promise<string> {
  const initial = await fetch(url, { headers: header(token, { Accept: 'application/octet-stream' }), signal: AbortSignal.timeout(3_600_000), redirect: 'manual' })
  if (initial.status === 200) return hashResponse(initial, expectedSize)
  if (initial.status !== 302) throw new Error('Insight GitHub Release attachment download failed')
  const location = initial.headers.get('location')
  if (location === null) throw new Error('Insight GitHub Release attachment redirect has no location')
  let destination: URL
  try { destination = new URL(location) } catch { throw new Error('Insight GitHub Release attachment redirect is invalid') }
  if (destination.protocol !== 'https:' || !ASSET_REDIRECT_HOSTS.has(destination.hostname) || destination.username !== '' || destination.password !== '') {
    throw new Error('Insight GitHub Release attachment redirect is outside the trusted download hosts')
  }
  const redirected = await fetch(destination, { headers: { Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(3_600_000), redirect: 'error' })
  if (!redirected.ok) throw new Error('Insight GitHub Release attachment download failed')
  return hashResponse(redirected, expectedSize)
}

async function jsonResponse(response: Response): Promise<unknown> {
  if (response.body === null) throw new Error('Insight GitHub Release response has no body')
  const chunks: Uint8Array[] = []; let size = 0
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader()
  while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > MAX_METADATA_BYTES) { await reader.cancel(); throw new Error('Insight GitHub Release response exceeds its size limit') }; chunks.push(next.value) }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('Insight GitHub Release response is invalid JSON') }
}

function fileBody(path: string): ReadableStream<Uint8Array> {
  const stream: AsyncIterable<Buffer> = createReadStream(path)
  const iterator = stream[Symbol.asyncIterator]()
  return new ReadableStream({
    async pull(controller) {
      const next = await iterator.next()
      if (next.done) controller.close()
      else controller.enqueue(next.value)
    },
    async cancel() { await iterator.return?.() },
  })
}
/** Execute workflow-controlled buildRunRecord writing or immutable Release finalization. */
export async function main(environment = process.env): Promise<void> {
  const mode = environment.INSIGHT_RELEASE_MODE
  const qualification = environment.INSIGHT_RELEASE_QUALIFICATION === 'debug-signed' ? 'debug-signed' : 'distribution'
  const version = environment.INSIGHT_DESKTOP_VERSION ?? ''; const targets = (environment.INSIGHT_RELEASE_TARGETS ?? '').split(',').filter(Boolean) as InsightDesktopBuildTarget[]
  const directories = (environment.INSIGHT_RELEASE_DIRECTORIES ?? '').split(',').filter(Boolean)
  if (mode === 'record-build-run') {
    if (targets.length === 0 || targets.length !== directories.length) throw new Error('Insight Release buildRunRecord target directories are invalid')
    const map: Partial<Record<InsightDesktopBuildTarget, string>> = {}
    for (const [index, target] of targets.entries()) {
      const directory = directories[index]
      if (directory === undefined) throw new Error('Insight Release buildRunRecord target directories are invalid')
      map[target] = directory
    }
    const firstDirectory = directories[0]
    if (firstDirectory === undefined) throw new Error('Insight Release buildRunRecord target directories are invalid')
    const buildRunRecord = await createInsightBuildRunRecord({ workflowRunId: Number(environment.GITHUB_RUN_ID), workflowRunAttempt: Number(environment.GITHUB_RUN_ATTEMPT), headSha: environment.GITHUB_SHA ?? '', version, qualification, directories: map })
    await writeInsightBuildRunRecord(firstDirectory, buildRunRecord)
    return
  }
  if (mode === 'finalize') { await finalizeInsightGitHubRelease({ repository: environment.GITHUB_REPOSITORY ?? '', token: environment.GITHUB_TOKEN ?? '', tag: environment.INSIGHT_RELEASE_TAG ?? '', version, sourceCommit: environment.GITHUB_SHA ?? '', releaseDirectories: directories, targets, qualification, draft: environment.INSIGHT_RELEASE_DRAFT === 'true' }); return }
  throw new Error('Insight GitHub Release requires INSIGHT_RELEASE_MODE')
}
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
