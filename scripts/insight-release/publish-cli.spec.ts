import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { load } from 'js-yaml'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createInsightDesktopBuildManifest, writeInsightDesktopBuildManifest } from './artifacts.ts'
import { extractInsightArtifact, insightReleaseSubprocessEnvironment, parseInsightBuildRunRecord, publishVerifiedInsightRelease } from './publish-cli.ts'
import type { InsightOssTransport } from './oss.ts'
import type { publishInsightCandidate } from './publish.ts'

const sourceCommit = '0123456789abcdef0123456789abcdef01234567'
const version = '1.0.10-rc.1'
const target = 'darwin-arm64' as const
const manifestFilename = `insight-build-${target}.json`
const artifactName = `insight-package-${target}-${version}`
const hash = (bytes: Uint8Array | string) => createHash('sha512').update(bytes).digest('base64')

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'insight-stage-two-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const original = join(root, 'original')
  await mkdir(original)
  await writeFile(join(original, 'payload.bin'), 'trusted payload')
  const manifest = await createInsightDesktopBuildManifest({
    artifactDirectory: original, manifestFilename, version, runtimeVersion: '0.2.2-alpha.2', sourceCommit,
    target, qualification: 'distribution', assetFilenames: ['payload.bin'],
  })
  await writeInsightDesktopBuildManifest(original, manifestFilename, manifest)
  const manifestBytes = await readFile(join(original, manifestFilename))
  const buildRunRecord = Buffer.from(`${JSON.stringify({
    schema: 'insight-build-run/v1', repositoryId: 1_429_559_776, workflowPath: '.github/workflows/insight-package.yml',
    workflowRunId: 41, workflowRunAttempt: 2, headSha: sourceCommit, version, qualification: 'distribution',
    targets: [{ target, artifactName, manifestFilename, manifestSha512: hash(manifestBytes) }],
  })}\n`)
  const releaseFiles = new Map<string, Uint8Array>([
    ['insight-build-run.json', buildRunRecord], ['payload.bin', await readFile(join(original, 'payload.bin'))],
    [manifestFilename, manifestBytes],
  ])
  const assets = [...releaseFiles.entries()].map(([name, bytes], index) => ({
    id: index + 1, name, size: bytes.byteLength,
    url: `https://api.github.com/repos/Overu/deepseek-harness/releases/assets/${String(index + 1)}`,
  }))
  const artifactBytes = Buffer.from('zip placeholder')
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input)
    if (url.endsWith(`/releases/tags/insight-v${version}`)) {
      return Response.json({ tag_name: `insight-v${version}`, draft: false, assets })
    }
    if (url.endsWith(`/git/ref/tags/insight-v${version}`)) return Response.json({ object: { type: 'commit', sha: sourceCommit } })
    if (url.endsWith('/actions/runs/41')) return Response.json({ id: 41, run_attempt: 2, event: 'workflow_dispatch', head_branch: 'insight',
      head_sha: sourceCommit, status: 'completed', conclusion: 'success', path: '.github/workflows/insight-package.yml@refs/heads/insight',
      repository: { id: 1_429_559_776, full_name: 'Overu/deepseek-harness' } })
    if (url.endsWith('/actions/runs/41/artifacts?per_page=100')) return Response.json({ total_count: 1, artifacts: [{ id: 99, name: artifactName,
      size_in_bytes: artifactBytes.byteLength, expired: false,
      archive_download_url: 'https://api.github.com/repos/Overu/deepseek-harness/actions/artifacts/99/zip',
      workflow_run: { id: 41, head_sha: sourceCommit } }] })
    if (url.endsWith('/actions/artifacts/99/zip')) return new Response(artifactBytes)
    const asset = assets.find(item => item.url === url)
    if (asset !== undefined) {
      const bytes = releaseFiles.get(asset.name)
      if (bytes === undefined) throw new Error('Release fixture is missing asset bytes.')
      return new Response(Buffer.from(bytes))
    }
    return new Response('missing', { status: 404 })
  })
  return { root, original, buildRunRecord, releaseFiles, assets, fetch }
}

const transport = {} as InsightOssTransport

it('rejects forged, duplicated, or mismatched Release buildRunRecord', () => {
  const canonical = { schema: 'insight-build-run/v1', repositoryId: 1_429_559_776, workflowPath: '.github/workflows/insight-package.yml',
    workflowRunId: 1, headSha: sourceCommit, version, qualification: 'distribution',
    targets: [{ target, artifactName, manifestFilename, manifestSha512: hash('x') }] }
  const base = { ...canonical, workflowRunAttempt: 1 }
  expect(() => parseInsightBuildRunRecord(Buffer.from(JSON.stringify(canonical)), version, sourceCommit)).not.toThrow()
  expect(() => parseInsightBuildRunRecord(Buffer.from(JSON.stringify(base)), version, sourceCommit)).not.toThrow()
  expect(() => parseInsightBuildRunRecord(Buffer.from(JSON.stringify({ ...base, workflowRunAttempt: 0 })), version, sourceCommit)).toThrow()
  expect(() => parseInsightBuildRunRecord(Buffer.from(JSON.stringify({ ...base, forged: true })), version, sourceCommit)).toThrow()
  expect(() => parseInsightBuildRunRecord(Buffer.from(JSON.stringify(base)), '1.0.11-rc.1', sourceCommit)).toThrow('does not match')
  expect(() => parseInsightBuildRunRecord(Buffer.from(JSON.stringify({ ...base, targets: [base.targets[0], base.targets[0]] })), version, sourceCommit)).toThrow('duplicate')
})

it('binds the tag, successful source run, original artifact, Release bytes, and candidate publisher', async () => {
  const f = await fixture()
  const published: Parameters<typeof publishInsightCandidate>[0][] = []
  const publishCandidate: typeof import('./publish.ts').publishInsightCandidate = async (input) => {
    expect((await readdir(dirname(input.directory))).filter(name => name.endsWith('.zip') || name.startsWith('original-'))).toEqual([])
    published.push(input)
    return { manifestKey: 'manifest', pointerKey: 'pointer', version }
  }
  await publishVerifiedInsightRelease({ version, sourceCommit, candidateTarget: target, githubToken: 'token', privateKeyPem: 'private', publicKeyPem: 'public',
    temporaryDirectory: f.root, transport, fetch: f.fetch,
    extractArtifact: async (_archive, destination) => {
      await copyFile(join(f.original, 'payload.bin'), join(destination, 'payload.bin'))
      await copyFile(join(f.original, manifestFilename), join(destination, manifestFilename))
    }, publishCandidate })
  expect(published).toHaveLength(1)
  expect(published[0]).toMatchObject({ version, sourceCommit, target,
    compatibility: { profileSchema: 1, accountStorageSchema: 1, readsDataSchema: { minimum: 1, maximum: 2 }, writesDataSchema: 2 } })
})

it('refuses a draft Release before inspecting or publishing its artifacts', async () => {
  const f = await fixture()
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (requestUrl(input).endsWith(`/releases/tags/insight-v${version}`)) {
      return Response.json({ tag_name: `insight-v${version}`, draft: true, assets: f.assets })
    }
    return f.fetch(input)
  })
  const extractArtifact = vi.fn()
  const publishCandidate = vi.fn()
  await expect(publishVerifiedInsightRelease({
    version,
    sourceCommit,
    candidateTarget: target,
    githubToken: 'token',
    privateKeyPem: 'private',
    publicKeyPem: 'public',
    temporaryDirectory: f.root,
    transport,
    fetch,
    extractArtifact,
    publishCandidate,
  })).rejects.toThrow()
  expect(extractArtifact).not.toHaveBeenCalled()
  expect(publishCandidate).not.toHaveBeenCalled()
})

it('refuses changed Release payload bytes before any OSS publication', async () => {
  const f = await fixture()
  f.releaseFiles.set('payload.bin', Buffer.from('changed payload'))
  const publishCandidate = vi.fn()
  await expect(publishVerifiedInsightRelease({ version, sourceCommit, candidateTarget: target, githubToken: 'token', privateKeyPem: 'private', publicKeyPem: 'public',
    temporaryDirectory: f.root, transport, fetch: f.fetch,
    extractArtifact: async (_archive, destination) => {
      await copyFile(join(f.original, 'payload.bin'), join(destination, 'payload.bin'))
      await copyFile(join(f.original, manifestFilename), join(destination, manifestFilename))
    }, publishCandidate })).rejects.toThrow()
  expect(publishCandidate).not.toHaveBeenCalled()
})

it('accepts legacy buildRunRecord bytes after the same source run advances to a later attempt', async () => {
  const f = await fixture()
  const originalFetch = f.fetch
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const response = await originalFetch(input)
    if (requestUrl(input).endsWith('/actions/runs/41')) {
      const value = await response.json() as Record<string, unknown>
      return Response.json({ ...value, run_attempt: 3 })
    }
    return response
  })
  let publications = 0
  const publishCandidate: typeof import('./publish.ts').publishInsightCandidate = async () => {
    publications += 1
    return { manifestKey: 'manifest', pointerKey: 'pointer', version }
  }
  await publishVerifiedInsightRelease({ version, sourceCommit, candidateTarget: target, githubToken: 'token', privateKeyPem: 'private', publicKeyPem: 'public',
    temporaryDirectory: f.root, transport, fetch,
    extractArtifact: async (_archive, destination) => {
      await copyFile(join(f.original, 'payload.bin'), join(destination, 'payload.bin'))
      await copyFile(join(f.original, manifestFilename), join(destination, manifestFilename))
    }, publishCandidate })
  expect(publications).toBe(1)
})

it.each([
  ['run ID', { id: 42 }],
  ['head SHA', { head_sha: 'f'.repeat(40) }],
  ['workflow path', { path: '.github/workflows/other.yml@refs/heads/insight' }],
] as const)('refuses a source run with a changed %s', async (_label, override) => {
  const f = await fixture()
  const originalFetch = f.fetch
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const response = await originalFetch(input)
    if (requestUrl(input).endsWith('/actions/runs/41')) {
      const value = await response.json() as Record<string, unknown>
      return Response.json({ ...value, ...override })
    }
    return response
  })
  const extractArtifact = vi.fn()
  const publishCandidate = vi.fn()
  await expect(publishVerifiedInsightRelease({
    version,
    sourceCommit,
    candidateTarget: target,
    githubToken: 'token',
    privateKeyPem: 'private',
    publicKeyPem: 'public',
    temporaryDirectory: f.root,
    transport,
    fetch,
    extractArtifact,
    publishCandidate,
  })).rejects.toThrow()
  expect(extractArtifact).not.toHaveBeenCalled()
  expect(publishCandidate).not.toHaveBeenCalled()
})

it('keeps the publishing key in the final isolated-runtime step', async () => {
  const workflow = load(await readFile(resolve(import.meta.dirname, '../../.github/workflows/insight-publish.yml'), 'utf8')) as {
    permissions: Record<string, string>
    jobs: {
      publish: {
        env?: Record<string, string>
        steps: { name?: string; run?: string; env?: Record<string, string>; with?: Record<string, string> }[]
      }
    }
  }
  expect(workflow.permissions).toEqual({ contents: 'read', actions: 'read', 'id-token': 'write' })
  expect(workflow.jobs.publish.env).toBeUndefined()
  expect(workflow.jobs.publish.steps[0]?.with?.ref).toBe('${{ github.sha }}')
  const install = workflow.jobs.publish.steps.find(step => step.name === 'Install the isolated publisher runtime')
  expect(install?.run).toContain('npm ci --prefix scripts/insight-release/runtime --ignore-scripts')
  const publish = workflow.jobs.publish.steps.find(step => step.name === 'Publish verified GitHub Release bytes to OSS')
  expect(publish?.env?.DESKTOP_UPDATE_SIGNING_PRIVATE_KEY).toBe('${{ secrets.DESKTOP_UPDATE_SIGNING_PRIVATE_KEY }}')
  expect(publish?.env?.INSIGHT_RELEASE_TARGET).toBe('${{ inputs.target }}')
})

it('does not expose workflow credentials to archive subprocesses', () => {
  const environment = insightReleaseSubprocessEnvironment()
  expect(environment).toEqual({})
  expect(environment).not.toHaveProperty('DESKTOP_UPDATE_SIGNING_PRIVATE_KEY')
  expect(environment).not.toHaveProperty('GITHUB_TOKEN')
  expect(environment).not.toHaveProperty('ACTIONS_ID_TOKEN_REQUEST_TOKEN')
})

it('rejects an oversized central-directory member before extracting any file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'insight-zip-quota-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const archive = join(root, 'artifact.zip')
  const destination = join(root, 'output')
  await mkdir(destination)
  const bytes = Buffer.from('UEsDBAoAAAAAACmRXl2DFtyMAQAAAAEAAAABABwAYVVUCQADzmzkas5s5Gp1eAsAAQT1AQAABAAAAAB4UEsBAh4DCgAAAAAAKZFeXYMW3IwBAAAAAQAAAAEAGAAAAAAAAAAAAKSBAAAAAGFVVAUAA85s5Gp1eAsAAQT1AQAABAAAAABQSwUGAAAAAAEAAQBHAAAAPAAAAAAA', 'base64')
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  expect(central).toBeGreaterThan(0)
  bytes.writeUInt32LE(3 * 1024 * 1024 * 1024 + 1, central + 24)
  await writeFile(archive, bytes)
  await expect(extractInsightArtifact(archive, destination)).rejects.toThrow('unsafe member')
  expect(await readdir(destination)).toEqual([])
})
