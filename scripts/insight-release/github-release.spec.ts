/** GitHub Release finalization streams installer bytes and verifies retry state. */

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createInsightDesktopBuildManifest, writeInsightDesktopBuildManifest } from './artifacts.ts'
import { finalizeInsightGitHubRelease, main as runGitHubRelease } from './github-release.ts'

const sourceCommit = '0123456789abcdef0123456789abcdef01234567'
const repository = 'Overu/deepseek-harness'
const upload = `https://uploads.github.com/repos/${repository}/releases/1/assets{?name,label}`
const assetUrl = (id: number) => `https://api.github.com/repos/${repository}/releases/assets/${String(id)}`

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'insight-release-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  await writeFile(join(directory, 'a.zip'), 'a')
  const manifest = await createInsightDesktopBuildManifest({ artifactDirectory: directory, manifestFilename: 'insight-build-darwin-arm64.json', version: '1.0.10-rc.1', runtimeVersion: '1.0.9', sourceCommit, target: 'darwin-arm64', qualification: 'distribution', assetFilenames: ['a.zip'] })
  await writeInsightDesktopBuildManifest(directory, 'insight-build-darwin-arm64.json', manifest)
  return { directory, asset: Buffer.from('a'), manifest: await readFile(join(directory, 'insight-build-darwin-arm64.json')) }
}

interface ReleaseAssetFixture { readonly id: number; readonly name: string; readonly size: number; readonly url: string; readonly state?: 'uploaded' | 'starter' }

function release(assets: readonly ReleaseAssetFixture[] = [], target = sourceCommit, draft = true) {
  return { id: 1, draft, target_commitish: target, upload_url: upload, assets: assets.map(asset => ({ ...asset, state: asset.state ?? 'uploaded' })) }
}

function requestUrl(value: RequestInfo | URL): string {
  if (value instanceof URL || typeof value === 'string') return value.toString()
  return value.url
}

it('pins a newly created release and streams each upload body', async () => {
  const data = await fixture()
  const uploaded: Uint8Array[] = []
  let createdDraft: boolean | undefined
  const finalAssets: ReleaseAssetFixture[] = [{ id: 1, name: 'a.zip', size: 1, url: assetUrl(1) }, { id: 2, name: 'insight-build-darwin-arm64.json', size: data.manifest.byteLength, url: assetUrl(2) }]
  const request = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const value = requestUrl(url)
    if (value.includes('/tags/')) return new Response('', { status: 404 })
    if (value.endsWith('/releases')) {
      if (typeof init?.body !== 'string') throw new Error('Release creation body is not JSON.')
      createdDraft = init.body.includes('"draft":true')
      return Response.json(release())
    }
    if (value.endsWith('/releases/1')) return Response.json(release(finalAssets, sourceCommit, init?.method === 'PATCH' ? false : true))
    if (value === assetUrl(1)) return new Response(data.asset)
    if (value === assetUrl(2)) return new Response(data.manifest)
    if (value.startsWith('https://uploads.github.com/')) {
      if (!(init?.body instanceof ReadableStream)) throw new Error('release upload was not streamed')
      expect(new Headers(init.headers).get('content-length')).toMatch(/^\d+$/u)
      uploaded.push(new Uint8Array(await new Response(init.body).arrayBuffer()))
      return Response.json({})
    }
    throw new Error(`Unexpected request: ${value}`)
  })
  const fetch: typeof globalThis.fetch = (url, init) => request(url, init)
  await finalizeInsightGitHubRelease({ repository, token: 'x', tag: 'insight-v1.0.10-rc.1', version: '1.0.10-rc.1', sourceCommit, releaseDirectories: [data.directory], targets: ['darwin-arm64'], qualification: 'distribution', draft: false, fetch })
  const digest = (bytes: Uint8Array) => createHash('sha512').update(bytes).digest('base64')
  expect(uploaded.map(digest).sort()).toEqual([data.asset, data.manifest].map(digest).sort())
  expect(createdDraft).toBe(true)
  expect(request.mock.calls.at(-1)?.[1]).toMatchObject({ method: 'PATCH' })
})

it('leaves a new release as a draft when an upload fails', async () => {
  const data = await fixture()
  const methods: Array<string | undefined> = []
  await expect(finalizeInsightGitHubRelease({ repository, token: 'x', tag: 'insight-v1.0.10-rc.1', version: '1.0.10-rc.1', sourceCommit, releaseDirectories: [data.directory], targets: ['darwin-arm64'], qualification: 'distribution', draft: false,
    fetch: async (url, init) => { methods.push(init?.method); if (requestUrl(url).includes('/tags/')) return new Response('', { status: 404 }); if (requestUrl(url).endsWith('/releases')) return Response.json(release()); return new Response('', { status: 502 }) } })).rejects.toThrow('upload failed')
  expect(methods).not.toContain('PATCH')
})

it('reuses identical build-run bytes when a later workflow attempt recovers a failed publication', async () => {
  const data = await fixture()
  const recordEnvironment: NodeJS.ProcessEnv = {
    INSIGHT_RELEASE_MODE: 'record-build-run',
    INSIGHT_RELEASE_QUALIFICATION: 'distribution',
    INSIGHT_DESKTOP_VERSION: '1.0.10-rc.1',
    INSIGHT_RELEASE_TARGETS: 'darwin-arm64',
    INSIGHT_RELEASE_DIRECTORIES: data.directory,
    GITHUB_RUN_ID: '41',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SHA: sourceCommit,
  }
  await runGitHubRelease(recordEnvironment)
  const recordPath = join(data.directory, 'insight-build-run.json')
  const attemptOneRecord = await readFile(recordPath)
  expect(attemptOneRecord.toString('utf8')).not.toContain('workflowRunAttempt')

  let created = false
  let uploadCalls = 0
  let patchCalls = 0
  const remoteAssets: ReleaseAssetFixture[] = []
  const remoteBytes = new Map<string, Uint8Array>()
  const request = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const value = requestUrl(url)
    if (value.includes('/tags/')) return created ? Response.json(release(remoteAssets)) : new Response('', { status: 404 })
    if (value.endsWith('/releases') && init?.method === 'POST') {
      created = true
      return Response.json(release())
    }
    if (value.startsWith('https://uploads.github.com/')) {
      if (!(init?.body instanceof ReadableStream)) throw new Error('release upload was not streamed')
      const name = new URL(value).searchParams.get('name')
      if (name === null) throw new Error('release upload has no name')
      const bytes = new Uint8Array(await new Response(init.body).arrayBuffer())
      const id = remoteAssets.length + 1
      remoteAssets.push({ id, name, size: bytes.byteLength, url: assetUrl(id) })
      remoteBytes.set(name, bytes)
      uploadCalls += 1
      return Response.json({})
    }
    if (value.endsWith('/releases/1')) {
      if (init?.method !== 'PATCH') return Response.json(release(remoteAssets))
      patchCalls += 1
      if (patchCalls === 1) return new Response('', { status: 502 })
      return Response.json(release(remoteAssets, sourceCommit, false))
    }
    const asset = remoteAssets.find(candidate => candidate.url === value)
    if (asset !== undefined) {
      const bytes = remoteBytes.get(asset.name)
      if (bytes === undefined) throw new Error('release fixture is missing asset bytes')
      return new Response(Buffer.from(bytes))
    }
    throw new Error(`Unexpected request: ${value}`)
  })
  const fetch: typeof globalThis.fetch = (url, init) => request(url, init)
  const finalize = () => finalizeInsightGitHubRelease({
    repository,
    token: 'x',
    tag: 'insight-v1.0.10-rc.1',
    version: '1.0.10-rc.1',
    sourceCommit,
    releaseDirectories: [data.directory],
    targets: ['darwin-arm64'],
    qualification: 'distribution',
    draft: false,
    fetch,
  })
  await expect(finalize()).rejects.toThrow('publication failed')
  const uploadsAfterAttemptOne = uploadCalls

  await runGitHubRelease({ ...recordEnvironment, GITHUB_RUN_ATTEMPT: '2' })
  expect(await readFile(recordPath)).toEqual(attemptOneRecord)
  await expect(finalize()).resolves.toBeUndefined()
  expect(uploadCalls).toBe(uploadsAfterAttemptOne)
  expect(patchCalls).toBe(2)
})

it('removes only a matching starter asset before retrying its upload', async () => {
  const data = await fixture()
  const starter: ReleaseAssetFixture[] = [{ id: 1, name: 'a.zip', size: 0, state: 'starter', url: assetUrl(1) }]
  const methods: string[] = []
  await expect(finalizeInsightGitHubRelease({ repository, token: 'x', tag: 'insight-v1.0.10-rc.1', version: '1.0.10-rc.1', sourceCommit, releaseDirectories: [data.directory], targets: ['darwin-arm64'], qualification: 'distribution', draft: true,
    fetch: async (url, init) => { methods.push(init?.method ?? 'GET'); if (requestUrl(url).includes('/tags/')) return Response.json(release(starter)); if (init?.method === 'DELETE' || requestUrl(url).startsWith('https://uploads.github.com/')) return Response.json({}); throw new Error('stop after starter cleanup') } })).rejects.toThrow('stop after starter cleanup')
  expect(methods).toContain('DELETE')
  expect(methods).toContain('POST')
})

it('rejects a release tag that points at another commit', async () => {
  const data = await fixture()
  await expect(finalizeInsightGitHubRelease({ repository, token: 'x', tag: 'insight-v1.0.10-rc.1', version: '1.0.10-rc.1', sourceCommit, releaseDirectories: [data.directory], targets: ['darwin-arm64'], qualification: 'distribution', draft: false, fetch: async () => Response.json(release([], 'f'.repeat(40))) })).rejects.toThrow('different source commit')
})

it('rejects a foreign upload endpoint before posting installer bytes', async () => {
  const data = await fixture()
  let requests = 0
  await expect(finalizeInsightGitHubRelease({ repository, token: 'x', tag: 'insight-v1.0.10-rc.1', version: '1.0.10-rc.1', sourceCommit, releaseDirectories: [data.directory], targets: ['darwin-arm64'], qualification: 'distribution', draft: false,
    fetch: async (url) => { requests += 1; if (requestUrl(url).includes('/tags/')) return Response.json({ ...release(), upload_url: 'https://example.test/upload{?name,label}' }); throw new Error('unexpected credential-bearing request') } })).rejects.toThrow('upload URL')
  expect(requests).toBe(1)
})

it('follows one trusted binary redirect without forwarding the GitHub token', async () => {
  const data = await fixture()
  const assets: ReleaseAssetFixture[] = [{ id: 1, name: 'a.zip', size: 1, url: assetUrl(1) }, { id: 2, name: 'insight-build-darwin-arm64.json', size: data.manifest.byteLength, url: assetUrl(2) }]
  const forwardedHeaders: HeadersInit[] = []
  await finalizeInsightGitHubRelease({ repository, token: 'secret', tag: 'insight-v1.0.10-rc.1', version: '1.0.10-rc.1', sourceCommit, releaseDirectories: [data.directory], targets: ['darwin-arm64'], qualification: 'distribution', draft: false,
    fetch: async (url, init) => {
      const value = requestUrl(url)
      if (value.includes('/tags/')) return Response.json(release(assets))
      if (value.endsWith('/releases/1')) return Response.json(release(assets, sourceCommit, init?.method === 'PATCH' ? false : true))
      if (value === assetUrl(1)) return new Response('', { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/a' } })
      if (value === assetUrl(2)) return new Response('', { status: 302, headers: { location: 'https://objects.githubusercontent.com/m' } })
      if (value === 'https://release-assets.githubusercontent.com/a') { forwardedHeaders.push(init?.headers ?? {}); return new Response(data.asset) }
      if (value === 'https://objects.githubusercontent.com/m') { forwardedHeaders.push(init?.headers ?? {}); return new Response(data.manifest) }
      throw new Error(`Unexpected request: ${value}`)
    } })
  expect(forwardedHeaders).toHaveLength(4)
  for (const headers of forwardedHeaders) expect(new Headers(headers).has('authorization')).toBe(false)
})

it.each(['https://attacker.example.test/a', 'https://release-assets.githubusercontent.com/a'])('rejects unsafe or chained asset redirects', async (redirect) => {
  const data = await fixture()
  const assets: ReleaseAssetFixture[] = [{ id: 1, name: 'a.zip', size: 1, url: assetUrl(1) }, { id: 2, name: 'insight-build-darwin-arm64.json', size: data.manifest.byteLength, url: assetUrl(2) }]
  await expect(finalizeInsightGitHubRelease({ repository, token: 'secret', tag: 'insight-v1.0.10-rc.1', version: '1.0.10-rc.1', sourceCommit, releaseDirectories: [data.directory], targets: ['darwin-arm64'], qualification: 'distribution', draft: false,
    fetch: async (url) => {
      const value = requestUrl(url)
      if (value.includes('/tags/') || value.endsWith('/releases/1')) return Response.json(release(assets))
      if (value === assetUrl(1)) return new Response('', { status: 302, headers: { location: redirect } })
      if (value === 'https://release-assets.githubusercontent.com/a') return new Response('', { status: 302, headers: { location: 'https://objects.githubusercontent.com/a' } })
      throw new Error(`Unexpected request: ${value}`)
    } })).rejects.toThrow('attachment')
})

async function expectExistingAssetsRejected(assets: readonly ReleaseAssetFixture[], message: string): Promise<void> {
  const data = await fixture()
  await expect(finalizeInsightGitHubRelease({ repository, token: 'x', tag: 'insight-v1.0.10-rc.1', version: '1.0.10-rc.1', sourceCommit, releaseDirectories: [data.directory], targets: ['darwin-arm64'], qualification: 'distribution', draft: false, fetch: async () => Response.json(release(assets)) })).rejects.toThrow(message)
}

it('rejects an extra existing Release attachment', async () => {
  await expectExistingAssetsRejected([{ id: 9, name: 'extra.exe', size: 1, url: assetUrl(9) }], 'unexpected attachment')
})

it('rejects duplicate existing Release attachment names', async () => {
  await expectExistingAssetsRejected([{ id: 9, name: 'a.zip', size: 1, url: assetUrl(9) }, { id: 10, name: 'a.zip', size: 1, url: assetUrl(10) }], 'attachment is invalid')
})

it('rejects a final release whose uploaded attachment reads back with different bytes', async () => {
  const data = await fixture()
  const finalAssets: ReleaseAssetFixture[] = [{ id: 1, name: 'a.zip', size: 1, url: assetUrl(1) }, { id: 2, name: 'insight-build-darwin-arm64.json', size: data.manifest.byteLength, url: assetUrl(2) }]
  await expect(finalizeInsightGitHubRelease({ repository, token: 'x', tag: 'insight-v1.0.10-rc.1', version: '1.0.10-rc.1', sourceCommit, releaseDirectories: [data.directory], targets: ['darwin-arm64'], qualification: 'distribution', draft: false,
    fetch: async (url, init) => {
      const value = requestUrl(url)
      if (value.includes('/tags/')) return new Response('', { status: 404 })
      if (value.endsWith('/releases')) return Response.json(release())
      if (value.endsWith('/releases/1')) return Response.json(release(finalAssets))
      if (value.startsWith('https://uploads.github.com/')) return Response.json({})
      if (value === assetUrl(1)) return new Response('b')
      if (value === assetUrl(2)) return new Response(data.manifest)
      void init
      throw new Error(`Unexpected request: ${value}`)
    } })).rejects.toThrow('attachment differs')
})
