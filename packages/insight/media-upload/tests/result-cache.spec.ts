import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { Config } from '../src/index.ts'
import { prepareResultDirectory, saveLayeringManifest } from '../src/result-cache.ts'

const host = 'game-ai-editor-videoassets-test.oss-cn-guangzhou.aliyuncs.com'
const config = Config({ serviceEnvironment: 'test' })
const agent = { session: Session.create(SessionId('cache-session')) } as Agent

function manifestContext() {
  const ctx = new Context()
  const files = new Map<string, string>()
  const writeText = vi.fn(async (target: { displayPath: string }, content: string) => {
    files.set(target.displayPath, content)
    return { size: content.length, version: 'v1' }
  })
  ctx.provide('fs', { resolve: async (path: string, opts?: { cwd?: string }) => ({
    displayPath: opts?.cwd ? `${opts.cwd}/${path.replaceAll('\\', '/')}` : path, targetKey: path }),
  processPath: (target: { displayPath: string }) => target.displayPath,
  stat: async (target: { displayPath: string }) => target.displayPath === 'C:/workspace'
    ? { type: 'directory' } : undefined,
  writeText, readText: async (target: { displayPath: string }) => files.get(target.displayPath),
  } as never)
  ctx.provide('workingDirectory', { get: () => 'C:/workspace' } as never)
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write', workspaceRoot: 'C:/workspace' }) } as never)
  return { ctx, files, writeText }
}

describe('sandboxed image-layering URL manifest', () => {
  it('writes and verifies PSD and image URLs without fetching their bytes', async () => {
    const { ctx, files, writeText } = manifestContext()
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    try {
      await prepareResultDirectory(ctx, agent, new AbortController().signal)
      const saved = await saveLayeringManifest(ctx, agent, config, 'task-1',
        [`https://${host}/result.psd?old`, `https://${host}/result.psd?new`,
          `https://${host}/layer.png`], new AbortController().signal)
      expect(saved.files.map(file => [file.kind, file.name])).toEqual([
        ['psd', 'layered.psd'], ['png', 'layer-1.png'],
      ])
      expect(JSON.parse(files.get(saved.path)!)).toMatchObject({ taskHandle: 'task-1', files: saved.files })
      expect(writeText).toHaveBeenCalledTimes(2)
      expect(fetcher).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals(); await ctx.fiber.dispose() }
  })

  it('rejects an unconfigured host before writing a manifest', async () => {
    const { ctx, writeText } = manifestContext()
    try {
      await expect(saveLayeringManifest(ctx, agent, config, 'task-1',
        ['https://other.example/result.psd'], new AbortController().signal))
        .rejects.toThrow('not configured')
      expect(writeText).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })

  it('requires an explicit result host in production', async () => {
    const { ctx } = manifestContext()
    const url = `https://${host}/result.psd`
    try {
      await expect(saveLayeringManifest(ctx, agent, Config({ serviceEnvironment: 'production' }),
        'task-1', [url], new AbortController().signal)).rejects.toThrow('not configured')
      const saved = await saveLayeringManifest(ctx, agent,
        Config({ serviceEnvironment: 'production', generationResultHosts: [host] }),
        'task-1', [url], new AbortController().signal)
      expect(saved.files).toMatchObject([{ kind: 'psd' }])
    } finally { await ctx.fiber.dispose() }
  })
})
