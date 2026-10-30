/** OSS transport admission and no-overwrite behavior. */

import { describe, expect, it } from 'vitest'
import { OssWriteOutcomeUnknownError, createAliOssTransport, createGithubStsProvider } from './oss.ts'

const environment = {
  GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'Overu/deepseek-harness', GITHUB_REPOSITORY_ID: '1429559776', GITHUB_RUN_ID: '7', GITHUB_REF: 'refs/heads/insight', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_WORKFLOW_REF: 'Overu/deepseek-harness/.github/workflows/insight-publish.yml@refs/heads/insight', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.githubusercontent.com/oidc', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'token',
}

describe('Insight OSS transport', () => {
  it('rejects publishers outside the exact dispatch workflow', () => {
    expect(() => createGithubStsProvider({ environment: { ...environment, GITHUB_REF: 'refs/heads/main' } })).toThrow('restricted')
  })

  it('returns safe not-found metadata and reports uncertain pointer writes', async () => {
    const transport = createAliOssTransport({
      getStsToken: async () => ({ accessKeyId: 'id', accessKeySecret: 'secret', securityToken: 'token', expirationMs: Date.now() + 3_600_000 }),
      ossClientFactory: () => ({
        getStream: async () => { throw { status: 404 } },
        get: async () => ({ res: { status: 200, headers: { etag: 'etag' } } }),
        put: async () => { throw new Error('network') },
        multipartUpload: async () => ({}) ,
      }),
    })
    await expect(transport.getMetadata('desktop/candidate-v3/a/current.json')).resolves.toBeUndefined()
    await expect(transport.putPointer('desktop/candidate-v3/a/current.json', new Uint8Array([1]), { ifAbsent: true })).rejects.toBeInstanceOf(OssWriteOutcomeUnknownError)
  })

  it('keeps versioned objects immutable and keeps mutable pointers briefly revalidatable', async () => {
    const puts: Array<{ key: string; headers: Record<string, string> }> = []
    const multipart: Array<{ key: string; headers: Record<string, string> }> = []
    const transport = createAliOssTransport({
      getStsToken: async () => ({ accessKeyId: 'id', accessKeySecret: 'secret', securityToken: 'token', expirationMs: Date.now() + 3_600_000 }),
      ossClientFactory: () => ({
        getStream: async () => { throw new Error('not used') },
        get: async () => { throw new Error('not used') },
        put: async (key, _source, options) => { puts.push({ key, headers: options.headers }) },
        multipartUpload: async (key, _source, options) => { multipart.push({ key, headers: options.headers }) },
      }),
    })

    await transport.putImmutable('desktop/releases/v1.0.10/target.json', { bytes: new Uint8Array([1]) })
    await transport.putImmutable('desktop/releases/v1.0.10/installer.exe', { path: '/staged/installer.exe' })
    await transport.putPointer('desktop/candidate-v3/win32-x64/current.json', new Uint8Array([2]), { expectedEtag: 'prior' })
    await transport.putPointer('desktop/candidate-v3/win32-x64/current.json', new Uint8Array([3]), { ifAbsent: true })

    expect(puts[0]).toEqual({ key: 'desktop/releases/v1.0.10/target.json', headers: { 'x-oss-forbid-overwrite': 'true', 'cache-control': 'public,max-age=31536000,immutable' } })
    expect(multipart[0]).toEqual({ key: 'desktop/releases/v1.0.10/installer.exe', headers: { 'x-oss-forbid-overwrite': 'true', 'cache-control': 'public,max-age=31536000,immutable' } })
    expect(puts[1]).toEqual({ key: 'desktop/candidate-v3/win32-x64/current.json', headers: { 'cache-control': 'public,max-age=60,must-revalidate', 'If-Match': 'prior' } })
    expect(puts[2]).toEqual({ key: 'desktop/candidate-v3/win32-x64/current.json', headers: { 'cache-control': 'public,max-age=60,must-revalidate', 'If-None-Match': '*' } })
  })

  it('rejects an STS expiration beyond its approved duration', async () => {
    const now = Date.parse('2026-10-30T00:00:00.000Z')
    let call = 0
    const provider = createGithubStsProvider({ environment, now: () => now, fetch: async () => {
      if (++call === 1) return Response.json({ value: 'oidc' })
      return Response.json({ code: 'SUCCESS', data: {
        bucket: 'insight-desktop-updates', region: 'oss-cn-guangzhou', endPoint: 'oss-cn-guangzhou.aliyuncs.com', dir: '', fileType: 'file', url: null,
        repositoryId: '1429559776', runId: '7', durationSeconds: 3600, expiration: new Date(now + 3_661_000).toISOString(),
        accessKeyId: 'id', accessKeySecret: 'secret', securityToken: 'token',
      } })
    } })
    await expect(provider()).rejects.toThrow('duration exceeds')
  })
})
