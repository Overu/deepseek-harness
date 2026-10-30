/** Verify GitHub build buildRunRecord and publish those exact Insight release bytes to OSS. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { finished } from 'node:stream/promises'
import semver from 'semver'
import { z } from 'zod'
import { verifyInsightDesktopBuildManifest, type InsightDesktopBuildManifest, type InsightDesktopBuildTarget } from './artifacts.ts'
import { createAliOssTransport, createGithubStsProvider, type InsightOssTransport } from './oss.ts'
import { publishInsightCandidate, type InsightReleaseCompatibility } from './publish.ts'
import { publishInsightStable } from './publish-stable.ts'

const REPOSITORY = 'Overu/deepseek-harness'
const REPOSITORY_ID = 1_429_559_776
const WORKFLOW_PATH = '.github/workflows/insight-package.yml'
const BRANCH = 'insight'
const MAX_SMALL_DOCUMENT = 4 * 1024 * 1024
const MAX_ARTIFACT_ARCHIVE = 12 * 1024 * 1024 * 1024
const MAX_EXPANDED_FILE = 3 * 1024 * 1024 * 1024
const MAX_EXPANDED_ARCHIVE = 8 * 1024 * 1024 * 1024
const targets = ['darwin-arm64', 'darwin-x64', 'win32-x64'] as const
const targetSchema = z.enum(targets)
const sha512Schema = z.string().regex(/^[A-Za-z0-9+/]{86}==$/u)
const commitSchema = z.string().regex(/^[0-9a-f]{40}$/u)
const safeNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u)
const buildRunRecordSchema = z.object({
  schema: z.literal('insight-build-run/v1'), repositoryId: z.literal(REPOSITORY_ID), workflowPath: z.literal(WORKFLOW_PATH),
  workflowRunId: z.number().int().positive(), workflowRunAttempt: z.number().int().positive().optional(), headSha: commitSchema,
  version: z.string(), qualification: z.literal('distribution'),
  targets: z.array(z.object({ target: targetSchema, artifactName: safeNameSchema,
    manifestFilename: z.string().regex(/^insight-build-(darwin-arm64|darwin-x64|win32-x64)\.json$/u),
    manifestSha512: sha512Schema }).strict()).min(1).max(targets.length),
}).strict()
const releaseAssetSchema = z.looseObject({
  id: z.number().int().positive(),
  name: safeNameSchema,
  size: z.number().int().nonnegative(),
  url: z.url(),
})
const releaseSchema = z.looseObject({
  tag_name: z.string(),
  draft: z.literal(false),
  assets: z.array(releaseAssetSchema),
})
const gitObjectSchema = z.looseObject({
  object: z.looseObject({ type: z.enum(['commit', 'tag']), sha: commitSchema }),
})
const runSchema = z.looseObject({
  id: z.number().int().positive(),
  run_attempt: z.number().int().positive(),
  event: z.literal('workflow_dispatch'),
  head_branch: z.literal(BRANCH),
  head_sha: commitSchema,
  status: z.literal('completed'),
  conclusion: z.literal('success'),
  path: z.string(),
  repository: z.looseObject({ id: z.literal(REPOSITORY_ID), full_name: z.literal(REPOSITORY) }),
})
const artifactSchema = z.looseObject({
  id: z.number().int().positive(),
  name: safeNameSchema,
  size_in_bytes: z.number().int().positive(),
  expired: z.boolean(),
  archive_download_url: z.url(),
  workflow_run: z.looseObject({ id: z.number().int().positive(), head_sha: commitSchema }),
})
const artifactListSchema = z.looseObject({
  total_count: z.number().int().nonnegative(),
  artifacts: z.array(artifactSchema),
})

/** Compatibility declaration retained from the accepted Shell 1.x update protocol. */
export const INSIGHT_RELEASE_COMPATIBILITY: InsightReleaseCompatibility = {
  profileSchema: 1, accountStorageSchema: 1, readsDataSchema: { minimum: 1, maximum: 2 }, writesDataSchema: 2,
}

/** Verified buildRunRecord record used to bind Release attachments to their build run. */
export type InsightBuildRunRecord = z.infer<typeof buildRunRecordSchema>

/** Inputs for one workflow-owned GitHub-to-OSS publication. */
export interface PublishVerifiedInsightReleaseInput {
  readonly version: string
  readonly sourceCommit: string
  readonly candidateTarget?: InsightDesktopBuildTarget
  readonly githubToken: string
  readonly privateKeyPem: string
  readonly publicKeyPem: string
  readonly temporaryDirectory: string
  readonly transport: InsightOssTransport
  readonly fetch?: typeof globalThis.fetch
  readonly extractArtifact?: (archive: string, destination: string) => Promise<void>
  readonly publishCandidate?: typeof publishInsightCandidate
  readonly publishStable?: typeof publishInsightStable
}

/** Decode strict, untrusted buildRunRecord and bind it to the requested release identity. */
export function parseInsightBuildRunRecord(bytes: Uint8Array, version: string, sourceCommit: string): InsightBuildRunRecord {
  if (bytes.byteLength > MAX_SMALL_DOCUMENT) throw new Error('Release buildRunRecord is too large.')
  let value: unknown
  try { value = JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { throw new Error('Release buildRunRecord is not valid JSON.') }
  const buildRunRecord = buildRunRecordSchema.parse(value)
  if (buildRunRecord.version !== version || buildRunRecord.headSha !== sourceCommit) throw new Error('Release buildRunRecord does not match the requested version and source commit.')
  const seen = new Set<string>()
  for (const target of buildRunRecord.targets) {
    if (seen.has(target.target)) throw new Error('Release buildRunRecord contains a duplicate target.')
    seen.add(target.target)
    if (target.artifactName !== `insight-package-${target.target}-${version}` || target.manifestFilename !== `insight-build-${target.target}.json`) {
      throw new Error('Release buildRunRecord target names do not match their release identity.')
    }
  }
  return buildRunRecord
}

/**
 * Verify the immutable GitHub run and Release, then publish only its byte-identical attachments.
 * @param input - Workflow identity, signing key, temporary storage, and OSS transport.
 */
export async function publishVerifiedInsightRelease(input: PublishVerifiedInsightReleaseInput): Promise<void> {
  const parsed = semver.parse(input.version)
  if (semver.valid(input.version) !== input.version || parsed === null || parsed.major !== 1 || parsed.build.length !== 0) throw new Error('Insight publication requires a canonical 1.x version without build metadata.')
  commitSchema.parse(input.sourceCommit)
  if (input.githubToken === '' || input.privateKeyPem === '' || input.publicKeyPem === '') throw new Error('Insight publication credentials are missing.')
  const candidate = parsed.prerelease.length > 0
  if (candidate !== (input.candidateTarget !== undefined)) throw new Error('Candidate publication requires exactly one target; stable publication does not accept one.')
  const api = githubApi(input.fetch ?? globalThis.fetch, input.githubToken)
  const tag = `insight-v${input.version}`
  const release = releaseSchema.parse(await api.json(`/releases/tags/${encodeURIComponent(tag)}`))
  if (release.tag_name !== tag) throw new Error('GitHub Release returned a different tag.')
  if (await resolveTagCommit(api, tag) !== input.sourceCommit) throw new Error('GitHub tag does not point at the requested source commit.')
  const releaseAssets = uniqueAssets(release.assets)
  const buildRunRecordAsset = releaseAssets.get('insight-build-run.json')
  if (buildRunRecordAsset === undefined || buildRunRecordAsset.size > MAX_SMALL_DOCUMENT) throw new Error('GitHub Release buildRunRecord attachment is missing or oversized.')
  const buildRunRecord = parseInsightBuildRunRecord(
    await api.smallAsset(buildRunRecordAsset, MAX_SMALL_DOCUMENT),
    input.version,
    input.sourceCommit,
  )
  const run = runSchema.parse(await api.json(`/actions/runs/${String(buildRunRecord.workflowRunId)}`))
  if (run.id !== buildRunRecord.workflowRunId || run.head_sha !== input.sourceCommit || run.path.split('@', 1)[0] !== WORKFLOW_PATH) {
    throw new Error('GitHub Actions run does not match the Release buildRunRecord.')
  }
  const listed = artifactListSchema.parse(await api.json(`/actions/runs/${String(run.id)}/artifacts?per_page=100`))
  if (listed.total_count !== listed.artifacts.length || listed.total_count > 100) throw new Error('GitHub Actions artifact listing is incomplete.')
  const runArtifacts = new Map(listed.artifacts.map(artifact => [artifact.name, artifact]))
  if (runArtifacts.size !== listed.artifacts.length) throw new Error('GitHub Actions run contains duplicate artifact names.')
  await mkdir(input.temporaryDirectory, { recursive: true, mode: 0o700 })
  await chmod(input.temporaryDirectory, 0o700)
  const operation = await mkdtemp(join(input.temporaryDirectory, 'insight-oss-publish-'))
  try {
    const directories = new Map<InsightDesktopBuildTarget, string>()
    const expectedReleaseAssets = new Set(['insight-build-run.json'])
    for (const record of buildRunRecord.targets) {
      const artifact = runArtifacts.get(record.artifactName)
      if (artifact === undefined || artifact.expired || artifact.workflow_run.id !== run.id || artifact.workflow_run.head_sha !== input.sourceCommit || artifact.size_in_bytes > MAX_ARTIFACT_ARCHIVE) throw new Error(`Original GitHub Actions artifact is unavailable: ${record.artifactName}`)
      assertArtifactDownloadUrl(artifact.archive_download_url, artifact.id)
      const archive = join(operation, `${record.target}.zip`)
      await api.download(artifact.archive_download_url, archive, artifact.size_in_bytes, MAX_ARTIFACT_ARCHIVE)
      const original = join(operation, `original-${record.target}`)
      await mkdir(original, { mode: 0o700 })
      await (input.extractArtifact ?? extractInsightArtifact)(archive, original)
      await rm(archive, { force: true })
      await assertFlatRegularFiles(original)
      const manifest = await verifyInsightDesktopBuildManifest({ artifactDirectory: original, manifestFilename: record.manifestFilename,
        expected: { version: input.version, sourceCommit: input.sourceCommit, target: record.target }, purpose: 'publish' })
      if (await hashFile(join(original, record.manifestFilename)) !== record.manifestSha512) throw new Error(`Original build manifest differs from buildRunRecord: ${record.manifestFilename}`)
      await assertExactBuildFiles(original, manifest, record.manifestFilename)
      const manifestMetadata = await lstat(join(original, record.manifestFilename))
      await rm(original, { recursive: true, force: true })
      const destination = join(operation, `release-${record.target}`)
      await mkdir(destination, { mode: 0o700 })
      const expectedFiles = [
        ...manifest.assets,
        { filename: record.manifestFilename, size: manifestMetadata.size, sha512: record.manifestSha512 },
      ]
      for (const file of expectedFiles) {
        if (expectedReleaseAssets.has(file.filename)) throw new Error(`Release attachment name is duplicated: ${file.filename}`)
        expectedReleaseAssets.add(file.filename)
        const asset = releaseAssets.get(file.filename)
        if (asset === undefined || asset.size !== file.size) throw new Error(`GitHub Release attachment is missing or has the wrong size: ${file.filename}`)
        assertReleaseAssetUrl(asset.url, asset.id)
        const destinationFile = join(destination, file.filename)
        await api.download(asset.url, destinationFile, file.size, file.size)
        if (await hashFile(destinationFile) !== file.sha512) throw new Error(`GitHub Release attachment differs from the original build: ${file.filename}`)
      }
      await verifyInsightDesktopBuildManifest({ artifactDirectory: destination, manifestFilename: record.manifestFilename,
        expected: { version: input.version, sourceCommit: input.sourceCommit, target: record.target }, purpose: 'publish' })
      if (candidate && record.target !== input.candidateTarget) await rm(destination, { recursive: true, force: true })
      else directories.set(record.target, destination)
    }
    if (releaseAssets.size !== expectedReleaseAssets.size || [...releaseAssets.keys()].some(name => !expectedReleaseAssets.has(name))) throw new Error('GitHub Release contains attachments outside its buildRunRecord manifests.')
    if (candidate) {
      const target = input.candidateTarget
      if (target === undefined) throw new Error('Candidate publication requires one target.')
      const directory = directories.get(target)
      if (directory === undefined) throw new Error('Candidate target is absent from the verified Release.')
      await (input.publishCandidate ?? publishInsightCandidate)({
        directory,
        version: input.version,
        sourceCommit: input.sourceCommit,
        target,
        compatibility: INSIGHT_RELEASE_COMPATIBILITY,
        privateKeyPem: input.privateKeyPem,
        publicKeyPem: input.publicKeyPem,
        transport: input.transport,
      })
    } else {
      const stableDirectories = Object.fromEntries(directories) as Partial<Record<InsightDesktopBuildTarget, string>>
      if (!targets.every(target => stableDirectories[target] !== undefined)) throw new Error('Stable publication requires all three verified targets.')
      await (input.publishStable ?? publishInsightStable)({ directories: stableDirectories as Record<InsightDesktopBuildTarget, string>,
        version: input.version, sourceCommit: input.sourceCommit, compatibility: INSIGHT_RELEASE_COMPATIBILITY,
        privateKeyPem: input.privateKeyPem, publicKeyPem: input.publicKeyPem, transport: input.transport })
    }
  } finally { await rm(operation, { recursive: true, force: true }) }
}

interface GitHubApi {
  json(path: string): Promise<unknown>
  smallAsset(asset: z.infer<typeof releaseAssetSchema>, maximum: number): Promise<Uint8Array>
  download(url: string, destination: string, expected: number, maximum: number): Promise<void>
}

function githubApi(fetchImplementation: typeof globalThis.fetch, token: string): GitHubApi {
  const base = `https://api.github.com/repos/${REPOSITORY}`
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
  const request = async (url: string, accept: string, timeoutMs = 60_000): Promise<Response> => {
    const response = await fetchImplementation(url, { headers: { ...headers, accept }, signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(`GitHub request failed with status ${String(response.status)}.`)
    return response
  }
  return {
    async json(path) {
      const bytes = await boundedResponse(await request(`${base}${path}`, 'application/vnd.github+json'), MAX_SMALL_DOCUMENT)
      let value: unknown
      try { value = JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { throw new Error('GitHub returned invalid JSON.') }
      return value
    },
    async smallAsset(asset, maximum) {
      assertReleaseAssetUrl(asset.url, asset.id)
      return boundedResponse(await request(asset.url, 'application/octet-stream'), maximum)
    },
    async download(url, destination, expected, maximum) {
      const response = await request(url, 'application/octet-stream', 3_600_000)
      const handle = await open(destination, 'wx', 0o600)
      let size = 0
      try {
        if (response.body === null) throw new Error('GitHub download returned no body.')
        const reader = response.body.getReader()
        while (true) {
          const next = await reader.read()
          if (next.done) break
          size += next.value.byteLength
          if (size > maximum) { await reader.cancel(); throw new Error('GitHub download exceeds its size limit.') }
          await handle.writeFile(next.value)
        }
        if (size !== expected) throw new Error('GitHub download size differs from its expected size.')
      } catch (error) { await handle.close(); await rm(destination, { force: true }); throw error }
      await handle.close()
    },
  }
}

async function resolveTagCommit(api: GitHubApi, tag: string): Promise<string> {
  let object = gitObjectSchema.parse(await api.json(`/git/ref/tags/${encodeURIComponent(tag)}`)).object
  for (let depth = 0; object.type === 'tag' && depth < 4; depth++) object = gitObjectSchema.parse(await api.json(`/git/tags/${object.sha}`)).object
  if (object.type !== 'commit') throw new Error('GitHub tag does not resolve to a commit.')
  return object.sha
}

function uniqueAssets(assets: readonly z.infer<typeof releaseAssetSchema>[]): Map<string, z.infer<typeof releaseAssetSchema>> {
  const result = new Map(assets.map(asset => [asset.name, asset]))
  if (result.size !== assets.length) throw new Error('GitHub Release contains duplicate attachment names.')
  return result
}
function assertReleaseAssetUrl(url: string, id: number): void {
  if (url !== `https://api.github.com/repos/${REPOSITORY}/releases/assets/${String(id)}`) {
    throw new Error('GitHub Release asset URL is outside the trusted repository.')
  }
}
function assertArtifactDownloadUrl(url: string, id: number): void {
  if (url !== `https://api.github.com/repos/${REPOSITORY}/actions/artifacts/${String(id)}/zip`) {
    throw new Error('GitHub Actions artifact URL is outside the trusted repository.')
  }
}

async function boundedResponse(response: Response, maximum: number): Promise<Uint8Array> {
  if (response.body === null) throw new Error('GitHub response returned no body.')
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body.getReader()
  while (true) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > maximum) { await reader.cancel(); throw new Error('GitHub response exceeds its size limit.') }
    chunks.push(next.value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha512')
  const stream = createReadStream(path)
  stream.on('data', chunk => hash.update(chunk))
  await finished(stream)
  return hash.digest('base64')
}

/** @returns Empty archive-subprocess environment so workflow secrets cannot be inherited. */
export function insightReleaseSubprocessEnvironment(): NodeJS.ProcessEnv { return {} }

/**
 * Inspect central-directory quotas, then extract one GitHub Actions artifact.
 * @param archive - Downloaded artifact ZIP.
 * @param destination - Fresh private extraction directory.
 * @returns Completion after every archive member is extracted.
 */
export async function extractInsightArtifact(archive: string, destination: string): Promise<void> {
  validateInsightArchiveListing(await unzipListing(archive))
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('/usr/bin/unzip', ['-qq', archive, '-d', destination], {
      stdio: ['ignore', 'ignore', 'pipe'], shell: false, env: insightReleaseSubprocessEnvironment(),
    })
    const errors: Buffer[] = []
    child.stderr.on('data', (chunk: Buffer) => { errors.push(chunk) })
    child.once('error', reject)
    child.once('close', (code) => { if (code === 0) resolvePromise(); else reject(new Error(`GitHub artifact extraction failed: ${Buffer.concat(errors).toString('utf8').slice(0, 500)}`)) })
  })
}

async function unzipListing(archive: string): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn('/usr/bin/unzip', ['-Z', '-l', archive], {
      stdio: ['ignore', 'pipe', 'pipe'], shell: false, env: insightReleaseSubprocessEnvironment(),
    })
    const output: Buffer[] = []
    const errors: Buffer[] = []
    let size = 0
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= 64 * 1024) output.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => { errors.push(chunk) })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code !== 0) { reject(new Error(`GitHub artifact listing failed: ${Buffer.concat(errors).toString('utf8').slice(0, 500)}`)); return }
      if (size > 64 * 1024) { reject(new Error('GitHub artifact listing exceeds its size limit.')); return }
      resolvePromise(Buffer.concat(output).toString('utf8'))
    })
  })
}

/**
 * Validate Info-ZIP central-directory output before any archive member is extracted.
 * @param listing - Complete `unzip -Z -l` output produced without inherited environment variables.
 */
export function validateInsightArchiveListing(listing: string): void {
  const countMatch = /number of entries: ([0-9]+)/u.exec(listing)
  if (countMatch === null) throw new Error('GitHub artifact archive has no central-directory count.')
  const declaredCount = Number(countMatch[1])
  const names = new Set<string>()
  let total = 0
  let count = 0
  for (const line of listing.split(/\r?\n/u)) {
    if (!/^[dl-][rwxStTs-]{9}\s/u.test(line)) continue
    const fields = line.trim().split(/\s+/u)
    const mode = fields[0]
    const size = Number(fields[3])
    const name = fields[9]
    if (mode?.[0] !== '-' || name === undefined || fields.length !== 10 || !safeNameSchema.safeParse(name).success
      || !Number.isSafeInteger(size) || size < 0 || size > MAX_EXPANDED_FILE || names.has(name)) {
      throw new Error('GitHub artifact archive contains an unsafe member.')
    }
    names.add(name)
    total += size
    if (!Number.isSafeInteger(total) || total > MAX_EXPANDED_ARCHIVE) throw new Error('GitHub artifact archive expands beyond its size limit.')
    count++
  }
  if (declaredCount !== count || count === 0 || count > 32) throw new Error('GitHub artifact archive has an invalid member count.')
}

async function assertFlatRegularFiles(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  if (entries.length === 0 || entries.length > 32) throw new Error('GitHub Actions artifact has an invalid file count.')
  for (const entry of entries) {
    if (!safeNameSchema.safeParse(entry.name).success || !entry.isFile() || entry.isSymbolicLink()) {
      throw new Error('GitHub Actions artifact is not a flat set of regular files.')
    }
  }
}
async function assertExactBuildFiles(directory: string, manifest: InsightDesktopBuildManifest, manifestFilename: string): Promise<void> {
  const actual = (await readdir(directory)).sort()
  const expected = [...manifest.assets.map(asset => asset.filename), manifestFilename].sort()
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error('GitHub Actions artifact contains files outside its build manifest.')
  }
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]
  if (value === undefined || value === '' || value.includes('\0')) throw new Error(`Insight publication requires ${name}.`)
  return value
}
async function main(environment: NodeJS.ProcessEnv): Promise<void> {
  if (environment.GITHUB_ACTIONS !== 'true' || environment.GITHUB_REPOSITORY !== REPOSITORY || environment.GITHUB_REPOSITORY_ID !== String(REPOSITORY_ID) || environment.GITHUB_REF !== `refs/heads/${BRANCH}` || environment.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('Insight publication is restricted to the approved GitHub workflow.')
  const target = environment.INSIGHT_RELEASE_TARGET
  await publishVerifiedInsightRelease({ version: required(environment, 'INSIGHT_RELEASE_VERSION'), sourceCommit: required(environment, 'INSIGHT_SOURCE_COMMIT'),
    ...(target === 'stable' ? {} : { candidateTarget: targetSchema.parse(target) }), githubToken: required(environment, 'GITHUB_TOKEN'),
    privateKeyPem: required(environment, 'DESKTOP_UPDATE_SIGNING_PRIVATE_KEY'), publicKeyPem: await readFile(required(environment, 'INSIGHT_UPDATE_PUBLIC_KEY_FILE'), 'utf8'),
    temporaryDirectory: required(environment, 'RUNNER_TEMP'), transport: createAliOssTransport({ getStsToken: createGithubStsProvider({ environment }) }) })
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.env)
