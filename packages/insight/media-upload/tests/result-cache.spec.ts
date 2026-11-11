import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { Config } from '../src/index.ts'
import { cacheLayeringFiles, prepareResultDirectory } from '../src/result-cache.ts'

const host = 'game-ai-editor-videoassets-test.oss-cn-guangzhou.aliyuncs.com'
const config = Config({ serviceEnvironment: 'test' })
const agent = { session: Session.create(SessionId('cache-session')) } as Agent
const psd = Buffer.alloc(26)
psd.write('8BPS', 0, 'ascii')
psd[5] = 1
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])

function cacheContext() {
  const ctx = new Context()
  const files = new Map<string, Uint8Array>()
  const writeBytes = vi.fn(async (target: { displayPath: string }, bytes: Uint8Array) => {
    files.set(target.displayPath, bytes)
    return { size: bytes.length, version: 'v1' }
  })
  ctx.provide('fs', { resolve: async (path: string, opts?: { cwd?: string }) => ({
    displayPath: opts?.cwd ? `${opts.cwd}/${path.replaceAll('\\', '/')}` : path, targetKey: path }),
  processPath: (target: { displayPath: string }) => target.displayPath,
  stat: async (target: { displayPath: string }) => target.displayPath === 'C:/workspace'
    ? { type: 'directory' } : files.has(target.displayPath)
      ? { type: 'file', size: files.get(target.displayPath)!.length } : undefined,
  writeBytes, readByteRange: async (target: { displayPath: string }, range: { length: number }) =>
    files.get(target.displayPath)!.subarray(0, range.length),
  readBytes: async (target: { displayPath: string }) => files.get(target.displayPath)!,
  } as never)
  ctx.provide('workingDirectory', { get: () => 'C:/workspace' } as never)
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write', workspaceRoot: 'C:/workspace' }) } as never)
  return { ctx, files, writeBytes }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('sandboxed image-layering cache', () => {
  it('publishes and re-reads every PSD and image result', async () => {
    const { ctx, writeBytes } = cacheContext()
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => new Response(url.pathname.endsWith('.psd') ? psd : png,
      { headers: { 'content-type': url.pathname.endsWith('.psd') ? 'image/vnd.adobe.photoshop' : 'image/png' } })))
    const cwd = await prepareResultDirectory(ctx, agent, new AbortController().signal)
    const files = await cacheLayeringFiles(ctx, agent, config, 'task-1',
      [`https://${host}/result.psd`, `https://${host}/layer.png`], cwd, new AbortController().signal)
    expect(files.map(file => file.kind)).toEqual(['psd', 'png'])
    expect(files.map(file => file.sizeBytes)).toEqual([psd.length, png.length])
    expect(writeBytes).toHaveBeenCalledTimes(3)
  })

  it('rejects an unconfigured host before any network request', async () => {
    const { ctx, writeBytes } = cacheContext()
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(cacheLayeringFiles(ctx, agent, config, 'task-1',
      ['https://other.example/result.psd'], 'C:/workspace', new AbortController().signal))
      .rejects.toThrow('not configured')
    expect(fetcher).not.toHaveBeenCalled()
    expect(writeBytes).not.toHaveBeenCalled()
  })

  it('requires an explicit result host in production', async () => {
    const { ctx } = cacheContext()
    const fetcher = vi.fn(async () => new Response(psd,
      { headers: { 'content-type': 'image/vnd.adobe.photoshop' } }))
    vi.stubGlobal('fetch', fetcher)
    const url = `https://${host}/result.psd`
    await expect(cacheLayeringFiles(ctx, agent, Config({ serviceEnvironment: 'production' }),
      'task-1', [url], 'C:/workspace', new AbortController().signal))
      .rejects.toThrow('not configured')
    expect(fetcher).not.toHaveBeenCalled()
    const files = await cacheLayeringFiles(ctx, agent,
      Config({ serviceEnvironment: 'production', generationResultHosts: [host] }),
      'task-1', [url], 'C:/workspace', new AbortController().signal)
    expect(files).toMatchObject([{ kind: 'psd' }])
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('reuses a verified partial cache when signed result URLs are refreshed', async () => {
    const { ctx, writeBytes } = cacheContext()
    const fetcher = vi.fn(async (url: URL) => url.pathname.endsWith('.png') && url.search === '?old'
      ? new Response(null, { status: 403 })
      : new Response(url.pathname.endsWith('.psd') ? psd : png,
        { headers: { 'content-type': url.pathname.endsWith('.psd') ? 'image/vnd.adobe.photoshop' : 'image/png' } }))
    vi.stubGlobal('fetch', fetcher)
    const first = [`https://${host}/result.psd?old`, `https://${host}/layer.png?old`]
    await expect(cacheLayeringFiles(ctx, agent, config, 'task-1', first,
      'C:/workspace', new AbortController().signal)).rejects.toThrow('could not be downloaded')
    const refreshed = [`https://${host}/result.psd?new`, `https://${host}/layer.png?new`]
    const files = await cacheLayeringFiles(ctx, agent, config, 'task-1', refreshed,
      'C:/workspace', new AbortController().signal)
    expect(files.map(file => file.kind)).toEqual(['psd', 'png'])
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(writeBytes).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid PSD bytes before publishing a file', async () => {
    const { ctx, writeBytes } = cacheContext()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.alloc(26),
      { headers: { 'content-type': 'image/vnd.adobe.photoshop' } })))
    await expect(cacheLayeringFiles(ctx, agent, config, 'task-1',
      [`https://${host}/result.psd`], 'C:/workspace', new AbortController().signal))
      .rejects.toThrow('invalid PSD bytes')
    expect(writeBytes).not.toHaveBeenCalled()
  })
})
