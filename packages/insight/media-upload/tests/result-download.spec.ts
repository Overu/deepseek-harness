import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { registerResultDownload } from '../src/result-download.ts'
import { RESULT_DOWNLOAD_PATH } from '../src/shared/layering-files.ts'

const host = 'game-ai-editor-videoassets-test.oss-cn-guangzhou.aliyuncs.com'
const oldUrl = `https://${host}/result.psd?old`
const newUrl = `https://${host}/result.psd?new`
const config = { serviceEnvironment: 'test' as const, requestTimeoutMs: 15_000, ossTimeoutMs: 180_000,
  generationRequestTimeoutMs: 1_250_000, generationPollIntervalMs: 10_000, generationWatchTimeoutMs: 3_900_000 }
const delivery = { taskHandle: 'task-1', accountScope: 'account-1', imageLabel: '图片 1', manifestPath: 'C:/workspace/manifest.json',
  complete: true, files: [{ url: oldUrl, kind: 'psd', name: 'layered.psd' }] }

function setup(toolName = 'cache_image_layering_result', accountScope = 'account-1') {
  const ctx = new Context()
  let route: ConnectionFetchRoute | undefined
  const events = [
    { type: 'tool/call', seq: 0, data: { callId: 'call-1', name: toolName } },
    { type: 'tool/result', seq: 1, data: { message: { source: { callId: 'call-1' },
      content: [{ type: 'text', text: JSON.stringify(delivery) }] } } },
  ]
  ctx.provide('connection', { fetch: { register(value: ConnectionFetchRoute) { route = value; return () => {} } } } as never)
  ctx.provide('sessionQuery', { readSession: async () => ({ events }) } as never)
  ctx.provide('insightAccount', { getAccountScope: () => accountScope } as never)
  return { ctx, handle: (query = 'sessionId=session-1&seq=1&index=0') => route!.fetch(
    new Request(`http://localhost${RESULT_DOWNLOAD_PATH}?${query}`)) }
}

describe('image-layer result download', () => {
  it('streams the current service URL for an authenticated session result coordinate', async () => {
    const { ctx, handle } = setup()
    const query = vi.fn(async () => ({ status: 'succeeded', psdUrls: [newUrl], imageUrls: [newUrl] }))
    const psd = new Uint8Array(26); psd.set([56, 66, 80, 83, 0, 1])
    const fetcher = vi.fn(async (_url: URL) => new Response(psd,
      { headers: { 'content-type': 'image/vnd.adobe.photoshop' } }))
    vi.stubGlobal('fetch', fetcher)
    try {
      registerResultDownload(ctx, config, query)
      const response = await handle()
      expect(response.status).toBe(200)
      expect(response.headers.get('content-disposition')).toContain('attachment')
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...psd])
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(fetcher.mock.calls[0]![0].href).toBe(newUrl)
      expect(query).toHaveBeenCalledWith('task-1', expect.any(AbortSignal))
    } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
  })

  it('rejects unrecorded calls, invalid coordinates, and missing remote task results', async () => {
    const wrong = setup('unrelated_tool')
    registerResultDownload(wrong.ctx, config, async () => ({ status: 'succeeded', psdUrls: [newUrl] }))
    expect((await wrong.handle()).status).toBe(404)
    expect((await wrong.handle('sessionId=session-1&seq=1&index=99')).status).toBe(404)
    await wrong.ctx.fiber.dispose()
    const valid = setup()
    registerResultDownload(valid.ctx, config, async () => ({ status: 'failed' }))
    expect((await valid.handle()).status).toBe(409)
    expect((await valid.handle('sessionId=session-1&seq=oops&index=0')).status).toBe(400)
    await valid.ctx.fiber.dispose()
  })

  it('rejects a result recorded under another account without querying or fetching it', async () => {
    const { ctx, handle } = setup('cache_image_layering_result', 'account-2')
    const query = vi.fn()
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    try {
      registerResultDownload(ctx, config, query)
      expect((await handle()).status).toBe(403)
      expect(query).not.toHaveBeenCalled()
      expect(fetcher).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
  })
})
