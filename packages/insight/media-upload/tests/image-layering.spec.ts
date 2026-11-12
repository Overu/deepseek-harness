import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { JobId, type JobSpec } from '@deepseek-ai/dsh-jobs'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { layeringTasksProjection, parseLayeringResult, parseTaskHandle, registerImageLayeringTools } from '../src/image-layering.ts'

const handle = 'opaque-user-bound-handle'
const psd = 'https://game-ai-editor-videoassets-test.oss-cn-guangzhou.aliyuncs.com/result.psd'
const png = 'https://game-ai-editor-videoassets-test.oss-cn-guangzhou.aliyuncs.com/preview.png'
const input = 'https://shanghaigroup.oss-cn-guangzhou.aliyuncs.com/input.png'
const config = { serviceEnvironment: 'test' as const, requestTimeoutMs: 15_000, ossTimeoutMs: 180_000,
  generationRequestTimeoutMs: 1_250_000, generationPollIntervalMs: 10_000, generationWatchTimeoutMs: 3_900_000 }
const ndjson = (body: object) => new Response(
  `{"type":"accepted"}\n{"type":"heartbeat"}\n${JSON.stringify({ type: 'result', status: 200, body })}\n`,
  { status: 200, headers: { 'content-type': 'application/x-ndjson',
    'X-Insight-Proxy-Request-Id': '123e4567-e89b-12d3-a456-426614174000' } })
const jsonBody = (init: RequestInit): unknown => {
  if (typeof init.body !== 'string') throw new Error('Expected JSON request body.')
  return JSON.parse(init.body)
}

describe('image layering proxy', () => {
  it('stops after one query error while retaining historical retry eligibility', async () => {
    const ctx = new Context()
    const definitions: ToolDefinition[] = []
    const session = Session.create(SessionId('reserved-layering-task'))
    session.append('turn/start', { turn: 1 })
    const agent = { id: SessionId('layer-agent'), session } as Agent
    const file = { attachmentId: AttachmentId(`sha256:${'ab'.repeat(32)}`), name: 'photo.png', bytes: 8 }
    const upload = vi.fn(async () => input)
    let creates = 0
    let queries = 0
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      const request = jsonBody(init) as { path: string }
      if (request.path === '/v1/proxy_async_create') {
        creates++
        return ndjson({ code: 0, data: { task_id_list: [creates === 1 ? handle : 'second-handle'] } })
      }
      if (++queries === 1) return ndjson({ code: 3099, message: 'not available' })
      return ndjson({ code: 0, status: 'failed' })
    })
    vi.stubGlobal('fetch', transport)
    try {
      await ctx.plugin(SessionProjectionRegistry)
      const tasks = await ctx.sessionProjections.register(layeringTasksProjection)
      ctx.provide('tools', { register(definition: ToolDefinition) { definitions.push(definition); return () => {} } } as never)
      ctx.provide('agents', { roots: () => [agent] } as never)
      ctx.provide('insightAccount', { getAccessToken: async () => 'account-token', getAccountScope: () => 'account-1' } as never)
      ctx.provide('jobs', { start: () => JobId('job') } as never)
      ctx.provide('workingDirectory', { get: () => 'C:/workspace' } as never)
      ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write', workspaceRoot: 'C:/workspace' }) } as never)
      ctx.provide('fs', { resolve: async (path: string) => ({ displayPath: path, targetKey: path }),
        stat: async () => ({ type: 'directory' }), writeBytes: async () => ({ size: 0, version: 'v1' }) } as never)
      registerImageLayeringTools(ctx, config, () => false, {
        list: () => [{ sourceRef: String(file.attachmentId), filename: file.name, turnSeq: 1, messageSeq: 2 }],
        select: () => file, requestTurn: () => 1, upload,
      }, tasks)
      const exec = { agent, callId: ToolCallId('call-1'), rootCallId: ToolCallId('root-1'),
        signal: new AbortController().signal } as ToolRunContext
      const tool = (name: string) => definitions.find(item => item.name === name)!
      expect(await tool('prepare_image_layering_source').execute({}, exec)).toMatchObject({ candidates: [{ filename: 'photo.png' }] })
      expect(await tool('submit_image_layering').execute({}, exec)).toMatchObject({ taskHandle: handle })
      expect(creates).toBe(1)
      expect(await tool('get_image_layering').execute({ taskHandle: handle }, exec))
        .toMatchObject({ status: 'query_unavailable', reason: 'business_error', businessCode: 3099,
          remoteOutcome: 'unknown', taskHandle: handle,
          proxyRequestId: '123e4567-e89b-12d3-a456-426614174000' })
      expect(queries).toBe(1)
      await expect(tool('retry_image_layering').execute({ taskHandle: handle }, exec)).rejects.toThrow('not eligible')
      expect(creates).toBe(1)
      const bound = Object.values(tasks.stateOf(session))[0]!
      session.append('insight/image-layering/task', { task: { ...bound, state: 'retry_eligible' } })
      expect(await tool('retry_image_layering').execute({ taskHandle: handle }, exec))
        .toMatchObject({ taskHandle: 'second-handle' })
      expect(await tool('get_image_layering').execute({ taskHandle: 'second-handle' }, exec))
        .toMatchObject({ status: 'failed' })
      await expect(tool('retry_image_layering').execute({ taskHandle: handle }, exec)).rejects.toThrow('not eligible')
      expect(creates).toBe(2)
      expect(upload).toHaveBeenCalledTimes(2)
      await tasks.dispose()
    } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
  })
  it('keeps partial image files without creating retry eligibility for missing PSD', async () => {
    const ctx = new Context()
    const definitions: ToolDefinition[] = []
    const session = Session.create(SessionId('partial-layering-task'))
    session.append('turn/start', { turn: 1 })
    const agent = { id: SessionId('layer-agent'), session } as Agent
    const file = { attachmentId: AttachmentId(`sha256:${'ab'.repeat(32)}`), name: 'photo.png', bytes: 8 }
    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
    const local = new Map<string, Uint8Array>()
    let jobSpec: JobSpec | undefined
    const transport = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (typeof init?.body === 'string') {
        return ndjson((jsonBody(init) as { path: string }).path === '/v1/proxy_async_create'
          ? { code: 0, data: { task_id_list: [handle] } }
          : { code: 0, status: 'success', data: { image_list: [png] } })
      }
      return new Response(pngBytes, { headers: { 'content-type': 'image/png' } })
    })
    vi.stubGlobal('fetch', transport)
    try {
      await ctx.plugin(SessionProjectionRegistry)
      const tasks = await ctx.sessionProjections.register(layeringTasksProjection)
      ctx.provide('tools', { register(definition: ToolDefinition) { definitions.push(definition); return () => {} } } as never)
      ctx.provide('agents', { roots: () => [agent] } as never)
      ctx.provide('insightAccount', { getAccessToken: async () => 'account-token', getAccountScope: () => 'account-1' } as never)
      ctx.provide('jobs', { start(spec: JobSpec) { jobSpec = spec; return JobId('partial-job') } } as never)
      ctx.provide('workingDirectory', { get: () => 'C:/workspace' } as never)
      ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write', workspaceRoot: 'C:/workspace' }) } as never)
      ctx.provide('fs', {
        resolve: async (path: string, opts?: { cwd?: string }) => ({
          displayPath: opts?.cwd ? `${opts.cwd}/${path.replaceAll('\\', '/')}` : path, targetKey: path }),
        processPath: (target: { displayPath: string }) => target.displayPath,
        stat: async (target: { displayPath: string }) => target.displayPath === 'C:/workspace'
          ? { type: 'directory' } : local.has(target.displayPath)
            ? { type: 'file', size: local.get(target.displayPath)!.length } : undefined,
        writeBytes: async (target: { displayPath: string }, bytes: Uint8Array) => {
          local.set(target.displayPath, bytes)
          return { size: bytes.length, version: 'v1' }
        },
        readBytes: async (target: { displayPath: string }) => local.get(target.displayPath)!,
        readByteRange: async (target: { displayPath: string }, range: { length: number }) =>
          local.get(target.displayPath)!.subarray(0, range.length),
      } as never)
      registerImageLayeringTools(ctx, config, () => false, {
        list: () => [{ sourceRef: String(file.attachmentId), filename: file.name, turnSeq: 1, messageSeq: 2 }],
        select: () => file, requestTurn: () => 1, upload: async () => input,
      }, tasks)
      const exec = { agent, callId: ToolCallId('call-1'), rootCallId: ToolCallId('root-1'),
        signal: new AbortController().signal } as ToolRunContext
      await definitions.find(tool => tool.name === 'submit_image_layering')!.execute({}, exec)
      const job = jobSpec?.run({ id: JobId('partial-job'), append: () => {}, updateProgress: () => {} })
      const outcome = await job?.done
      expect(outcome).toMatchObject({ status: 'failed' })
      expect(JSON.parse(outcome?.result ?? '{}')).toMatchObject({ status: 'missing_psd',
        cache: { complete: false, files: [{ kind: 'png' }] } })
      expect(Object.values(tasks.stateOf(session))[0]).toMatchObject({ state: 'bound' })
      expect(local.size).toBe(2)
      expect(transport).toHaveBeenCalledTimes(3)
      await tasks.dispose()
    } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
  })
  it('requires exactly one service-issued handle', () => {
    expect(parseTaskHandle({ data: { task_id_list: [handle] } })).toBe(handle)
    expect(() => parseTaskHandle({ data: { task_id_list: [] } })).toThrow('no single usable task handle')
    expect(() => parseTaskHandle({ data: { task_id_list: [handle, 'extra'] } })).toThrow()
  })

  it('only treats an image_list PSD as the requested result', () => {
    expect(parseLayeringResult({ status: 'success', data: { image_list: [png, psd] } }, handle))
      .toEqual({ taskHandle: handle, status: 'succeeded', imageUrls: [png, psd], imageListValid: true, psdUrls: [psd] })
    expect(parseLayeringResult({ status: 'success', data: { image_list: [png] } }, handle))
      .toMatchObject({ status: 'missing_psd', imageUrls: [png],
        diagnostic: { field: 'psd_url', reason: 'missing', psdCandidates: 0 } })
    expect(parseLayeringResult({ status: 'success', data: { image_list: [png], psd_url: psd } }, handle))
      .toMatchObject({ status: 'succeeded', imageUrls: [png], psdUrls: [psd] })
    expect(parseLayeringResult({ status: 'success', data: { image_list: [png], psd_url: 'http://bad.test/x.psd' } }, handle))
      .toMatchObject({ status: 'missing_psd', diagnostic: { field: 'psd_url', reason: 'non_https' } })
    expect(parseLayeringResult({ status: 'success', data: { image_list: [png, psd], psd_url: null } }, handle))
      .toMatchObject({ status: 'succeeded', psdUrls: [psd], diagnostic: {
        field: 'psd_url', reason: 'not_string', valueType: 'null', psdCandidates: 1 } })
    expect(parseLayeringResult({ status: 'running' }, handle)).toMatchObject({ status: 'running' })
    expect(parseLayeringResult({ status: 'success', data: { image_list: ['http://bad.test/x.psd'] } }, handle))
      .toMatchObject({ status: 'missing_psd', imageListValid: false,
        diagnostic: { field: 'image_list', reason: 'invalid_item_url', imageItems: 1,
          validImages: 0, invalidIndices: [0] } })
    expect(parseLayeringResult({ status: 'success', data: { image_list: ['https://example.test/file.gif'] } }, handle))
      .toMatchObject({ status: 'missing_psd', imageListValid: false,
        diagnostic: { field: 'image_list', invalidIndices: [0] } })
  })

  it('refreshes expired result addresses by the same handle and keeps verified files', async () => {
    const ctx = new Context()
    const definitions: ToolDefinition[] = []
    const session = Session.create(SessionId('cache-layering-session'))
    session.append('insight/image-layering/task', { task: { requestKey: '1:source',
      file: { attachmentId: AttachmentId(`sha256:${'ab'.repeat(32)}`), name: 'photo.png', bytes: 8 },
      prompt: '', numLayers: 0, cwd: 'C:/workspace', accountScope: 'account-1', attempt: 1,
      state: 'bound', handle } })
    const agent = { id: SessionId('layer-agent'), session } as Agent
    const psdBytes = Buffer.alloc(26)
    psdBytes.write('8BPS', 0, 'ascii')
    psdBytes[5] = 1
    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
    const local = new Map<string, Uint8Array>()
    let queries = 0
    let jobSpec: JobSpec | undefined
    const transport = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (typeof init?.body === 'string') {
        if ((jsonBody(init) as { path: string }).path === '/v1/proxy_async_create') {
          return ndjson({ code: 0, data: { task_id_list: [handle] } })
        }
        queries++
        const suffix = queries === 1 ? 'old' : 'new'
        return ndjson({ code: 0, status: 'success', data: {
          image_list: [`${psd}?${suffix}`, `${png}?${suffix}`] } })
      }
      const result = new URL(url)
      if (result.pathname.endsWith('.png') && result.search === '?old') return new Response(null, { status: 403 })
      return new Response(result.pathname.endsWith('.psd') ? psdBytes : pngBytes,
        { headers: { 'content-type': result.pathname.endsWith('.psd') ? 'image/vnd.adobe.photoshop' : 'image/png' } })
    })
    vi.stubGlobal('fetch', transport)
    try {
      await ctx.plugin(SessionProjectionRegistry)
      const tasks = await ctx.sessionProjections.register(layeringTasksProjection)
      ctx.provide('tools', { register(definition: ToolDefinition) { definitions.push(definition); return () => {} } } as never)
      ctx.provide('agents', { roots: () => [agent] } as never)
      ctx.provide('insightAccount', { getAccessToken: async () => 'account-token', getAccountScope: () => 'account-1' } as never)
      ctx.provide('jobs', { start(spec: JobSpec) { jobSpec = spec; return JobId('cache-job') } } as never)
      ctx.provide('workingDirectory', { get: () => 'C:/workspace' } as never)
      ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write', workspaceRoot: 'C:/workspace' }) } as never)
      ctx.provide('fs', {
        resolve: async (path: string, opts?: { cwd?: string }) => ({
          displayPath: opts?.cwd ? `${opts.cwd}/${path.replaceAll('\\', '/')}` : path, targetKey: path }),
        processPath: (target: { displayPath: string }) => target.displayPath,
        stat: async (target: { displayPath: string }) => target.displayPath === 'C:/workspace'
          ? { type: 'directory' } : local.has(target.displayPath)
            ? { type: 'file', size: local.get(target.displayPath)!.length } : undefined,
        writeBytes: async (target: { displayPath: string }, bytes: Uint8Array) => {
          local.set(target.displayPath, bytes)
          return { size: bytes.length, version: 'v1' }
        },
        readBytes: async (target: { displayPath: string }) => local.get(target.displayPath)!,
        readByteRange: async (target: { displayPath: string }, range: { length: number }) =>
          local.get(target.displayPath)!.subarray(0, range.length),
      } as never)
      registerImageLayeringTools(ctx, config, () => true, undefined, tasks)
      const exec = { agent, callId: ToolCallId('call-cache'), rootCallId: ToolCallId('root-cache'),
        signal: new AbortController().signal } as ToolRunContext
      const cache = definitions.find(tool => tool.name === 'cache_image_layering_result')!
      expect(await cache.execute({ taskHandle: handle }, exec)).toMatchObject({ complete: true,
        files: [{ kind: 'psd' }, { kind: 'png' }] })
      expect(queries).toBe(2)
      expect(transport).toHaveBeenCalledTimes(5)
      expect(local.size).toBe(2)
      await definitions.find(tool => tool.name === 'submit_image_layering')!.execute({ imageUrl: input }, exec)
      const job = jobSpec?.run({ id: JobId('cache-job'), append: () => {}, updateProgress: () => {} })
      const outcome = await job?.done
      expect(outcome).toMatchObject({ status: 'completed' })
      expect(JSON.parse(outcome?.result ?? '{}')).toMatchObject({ cache: { complete: true,
        files: [{ kind: 'psd' }, { kind: 'png' }] } })
      expect(transport).toHaveBeenCalledTimes(7)
      await tasks.dispose()
    } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
  })

  it('uses one authenticated proxy POST for creation and one for query', async () => {
    const ctx = new Context()
    const definitions: ToolDefinition[] = []
    const agent = { id: SessionId('layer-agent'), session: Session.create(SessionId('layer-session')) } as Agent
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      const request = jsonBody(init) as { path: string }
      return ndjson(request.path === '/v1/proxy_async_create'
        ? { code: 0, status: 'running', data: { task_id_list: [handle] } }
        : { code: 0, status: 'success', data: { image_list: [png, psd] } })
    })
    vi.stubGlobal('fetch', transport)
    try {
      ctx.provide('tools', { register(definition: ToolDefinition) { definitions.push(definition); return () => {} } } as never)
      ctx.provide('agents', { roots: () => [agent] } as never)
      ctx.provide('insightAccount', { getAccessToken: async () => 'account-token' } as never)
      ctx.provide('jobs', { start: () => 'image-layering-job-1' } as never)
      registerImageLayeringTools(ctx, config, (_exec, url) => url === input)
      const exec = { agent, callId: ToolCallId('call-1'), rootCallId: ToolCallId('root-1'),
        signal: new AbortController().signal } as ToolRunContext
      const submit = definitions.find(tool => tool.name === 'submit_image_layering')
      await expect(submit?.execute({ imageUrl: png }, exec)).rejects.toThrow('this turn')
      const created = await submit?.execute({ imageUrl: input }, exec)
      expect(created).toMatchObject({ taskHandle: handle, status: 'running', monitoring: 'running' })
      expect(transport).toHaveBeenCalledTimes(1)
      const [submitUrl, submitInit] = transport.mock.calls[0]!
      expect(submitUrl).toBe('https://gapi-test.insight-aigc.com/insight-harness-service/api/skill-proxy/call-insight-api')
      expect(submitInit.headers).toMatchObject({ token: 'account-token', authorization: 'Bearer account-token',
        accept: 'application/x-ndjson' })
      expect(jsonBody(submitInit)).toEqual({ method: 'POST', path: '/v1/proxy_async_create',
        body: { model_id: 'decompose-1.0-flash', task_type: 'async_tencent_multi_layer_create',
          data: { prompt: '', image_url_list: [input], image_params: { num_layers: 0 } } } })
      const get = definitions.find(tool => tool.name === 'get_image_layering')
      expect(await get?.execute({ taskHandle: handle }, exec)).toMatchObject({ status: 'succeeded', psdUrls: [psd] })
      expect(jsonBody(transport.mock.calls[1]![1])).toEqual({ method: 'POST',
        path: '/v1/proxy_async_get_result',
        body: { task_type: 'async_tencent_multi_layer_get_result', task_id: handle } })
    } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
  })

  it('does not accept HTTP 200 when the NDJSON business result failed', async () => {
    const ctx = new Context()
    const definitions: ToolDefinition[] = []
    const agent = { id: SessionId('layer-agent'), session: Session.create(SessionId('layer-session')) } as Agent
    vi.stubGlobal('fetch', vi.fn(async () => ndjson({ code: 1001, message: 'failed' })))
    try {
      ctx.provide('tools', { register(definition: ToolDefinition) { definitions.push(definition); return () => {} } } as never)
      ctx.provide('agents', { roots: () => [agent] } as never)
      ctx.provide('insightAccount', { getAccessToken: async () => 'account-token' } as never)
      ctx.provide('jobs', { start: () => 'job' } as never)
      registerImageLayeringTools(ctx, config, () => true)
      const exec = { agent, callId: ToolCallId('call-1'), rootCallId: ToolCallId('root-1'),
        signal: new AbortController().signal } as ToolRunContext
      await expect(definitions.find(tool => tool.name === 'submit_image_layering')?.execute({ imageUrl: input }, exec))
        .rejects.toThrow('business code 1001')
    } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
  })

  it('stops the failed image Job while the other image Jobs finish', async () => {
    const ctx = new Context()
    const definitions: ToolDefinition[] = []
    const jobs: JobSpec[] = []
    const agent = { id: SessionId('layer-agent'), session: Session.create(SessionId('three-layering-tasks')) } as Agent
    const queries: string[] = []
    const handles = ['good-1', handle, 'good-3']
    let creates = 0
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      const request = jsonBody(init) as { path: string; body: { task_id?: string } }
      if (request.path === '/v1/proxy_async_create') {
        creates++
        return ndjson({ code: 0, data: { task_id_list: [handles[creates - 1]] } })
      }
      queries.push(request.body.task_id!)
      return ndjson(request.body.task_id === handle ? { code: 3099 } :
        { code: 0, status: 'success', data: { image_list: [psd] } })
    })
    vi.stubGlobal('fetch', transport)
    try {
      ctx.provide('tools', { register(definition: ToolDefinition) { definitions.push(definition); return () => {} } } as never)
      ctx.provide('agents', { roots: () => [agent] } as never)
      ctx.provide('insightAccount', { getAccessToken: async () => 'account-token' } as never)
      ctx.provide('jobs', { start(spec: JobSpec) { jobs.push(spec); return JobId(`job-${jobs.length}`) } } as never)
      registerImageLayeringTools(ctx, config, () => true)
      const exec = { agent, callId: ToolCallId('call-1'), rootCallId: ToolCallId('root-1'),
        signal: new AbortController().signal } as ToolRunContext
      const submit = definitions.find(tool => tool.name === 'submit_image_layering')!
      await submit.execute({ imageUrl: input }, exec)
      await submit.execute({ imageUrl: input }, exec)
      await submit.execute({ imageUrl: input }, exec)
      const outcomes = await Promise.all(jobs.map((spec, index) => spec.run({ id: JobId(`job-${index + 1}`),
        append: () => {}, updateProgress: () => {} }).done))
      expect(outcomes.map(outcome => outcome.status)).toEqual(['completed', 'failed', 'completed'])
      expect(JSON.parse(outcomes[1]?.result ?? '{}')).toMatchObject({ taskHandle: handle,
        status: 'query_unavailable', reason: 'business_error', businessCode: 3099, remoteOutcome: 'unknown' })
      expect(queries).toEqual(['good-1', handle, 'good-3'])
      expect(creates).toBe(3)
    } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
  })

  it('retries only a timed-out status query once under the same handle', async () => {
    const ctx = new Context()
    const definitions: ToolDefinition[] = []
    const agent = { id: SessionId('layer-agent'), session: Session.create(SessionId('timeout-layering-task')) } as Agent
    const transport = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => { reject(new Error('Aborted')) }, { once: true })
    }))
    vi.stubGlobal('fetch', transport)
    try {
      ctx.provide('tools', { register(definition: ToolDefinition) { definitions.push(definition); return () => {} } } as never)
      ctx.provide('agents', { roots: () => [agent] } as never)
      ctx.provide('insightAccount', { getAccessToken: async () => 'account-token' } as never)
      ctx.provide('jobs', { start: () => JobId('job') } as never)
      registerImageLayeringTools(ctx, { ...config, generationRequestTimeoutMs: 5 }, () => true)
      const exec = { agent, callId: ToolCallId('call-1'), rootCallId: ToolCallId('root-1'),
        signal: new AbortController().signal } as ToolRunContext
      expect(await definitions.find(tool => tool.name === 'get_image_layering')!.execute({ taskHandle: handle }, exec))
        .toMatchObject({ status: 'query_unavailable', reason: 'query_timeout', remoteOutcome: 'unknown' })
      expect(transport).toHaveBeenCalledTimes(2)
      for (const [, init] of transport.mock.calls) {
        expect((jsonBody(init) as { body: { task_id: string } }).body.task_id).toBe(handle)
      }
    } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
  })

  it('treats authentication service failure as a shared stop condition', async () => {
    const ctx = new Context()
    const definitions: ToolDefinition[] = []
    const agent = { id: SessionId('layer-agent'), session: Session.create(SessionId('auth-layering-task')) } as Agent
    const transport = vi.fn()
    vi.stubGlobal('fetch', transport)
    try {
      ctx.provide('tools', { register(definition: ToolDefinition) { definitions.push(definition); return () => {} } } as never)
      ctx.provide('agents', { roots: () => [agent] } as never)
      ctx.provide('insightAccount', { getAccessToken: async () => { throw new Error('Service unavailable') } } as never)
      ctx.provide('jobs', { start: () => JobId('job') } as never)
      registerImageLayeringTools(ctx, config, () => true)
      const exec = { agent, callId: ToolCallId('call-1'), rootCallId: ToolCallId('root-1'),
        signal: new AbortController().signal } as ToolRunContext
      await expect(definitions.find(tool => tool.name === 'get_image_layering')!.execute({ taskHandle: handle }, exec))
        .rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE' })
      expect(transport).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
  })

  it.each([
    { status: 504, code: 'UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN' },
    { status: 502, code: 'UPLOAD_SERVICE_UNAVAILABLE' },
  ])('does not retry an uncertain creation after an NDJSON $status event', async ({ status, code }) => {
    const ctx = new Context()
    const definitions: ToolDefinition[] = []
    const agent = { id: SessionId('layer-agent'), session: Session.create(SessionId('layer-session')) } as Agent
    const transport = vi.fn(async () => new Response(
      `{"type":"accepted"}\n${JSON.stringify({ type: 'error', status, code })}\n`,
      { status: 200, headers: { 'content-type': 'application/x-ndjson' } }))
    vi.stubGlobal('fetch', transport)
    try {
      ctx.provide('tools', { register(definition: ToolDefinition) { definitions.push(definition); return () => {} } } as never)
      ctx.provide('agents', { roots: () => [agent] } as never)
      ctx.provide('insightAccount', { getAccessToken: async () => 'account-token' } as never)
      ctx.provide('jobs', { start: () => 'job' } as never)
      registerImageLayeringTools(ctx, config, () => true)
      const exec = { agent, callId: ToolCallId('call-1'), rootCallId: ToolCallId('root-1'),
        signal: new AbortController().signal } as ToolRunContext
      await expect(definitions.find(tool => tool.name === 'submit_image_layering')?.execute({ imageUrl: input }, exec))
        .rejects.toMatchObject({ code: 'SUBMISSION_UNKNOWN' })
      expect(transport).toHaveBeenCalledOnce()
    } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
  })

  it('runs a session Job that queries the issued handle and completes with the PSD', async () => {
    const ctx = new Context()
    const definitions: ToolDefinition[] = []
    const agent = { id: SessionId('layer-agent'), session: Session.create(SessionId('layer-session')) } as Agent
    let jobSpec: JobSpec | undefined
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      const request = jsonBody(init) as { path: string }
      return ndjson(request.path === '/v1/proxy_async_create'
        ? { code: 0, data: { task_id_list: [handle] } }
        : { code: 0, status: 'success', data: { image_list: [psd] } })
    })
    vi.stubGlobal('fetch', transport)
    try {
      ctx.provide('tools', { register(definition: ToolDefinition) { definitions.push(definition); return () => {} } } as never)
      ctx.provide('agents', { roots: () => [agent] } as never)
      ctx.provide('insightAccount', { getAccessToken: async () => 'account-token' } as never)
      ctx.provide('jobs', { start(spec: JobSpec) { jobSpec = spec; return JobId('image-layering-job-1') } } as never)
      registerImageLayeringTools(ctx, config, () => true)
      const exec = { agent, callId: ToolCallId('call-1'), rootCallId: ToolCallId('root-1'),
        signal: new AbortController().signal } as ToolRunContext
      const created = await definitions.find(tool => tool.name === 'submit_image_layering')?.execute({ imageUrl: input }, exec)
      expect(created).toMatchObject({ taskHandle: handle, jobId: 'image-layering-job-1', monitoring: 'running' })
      expect(jobSpec).toMatchObject({ kind: 'image-layering', owner: agent.id })
      const hooks = jobSpec?.run({ id: JobId('image-layering-job-1'), append: () => {}, updateProgress: () => {} })
      const outcome = await hooks?.done
      expect(outcome).toMatchObject({ status: 'completed' })
      expect(JSON.parse(outcome?.result ?? '{}')).toMatchObject({ taskHandle: handle, status: 'succeeded', psdUrls: [psd] })
      expect(transport).toHaveBeenCalledTimes(2)
    } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
  })

  it('waits for an in-flight query to exit before settling a cancelled Job', async () => {
    const ctx = new Context()
    const definitions: ToolDefinition[] = []
    const agent = { id: SessionId('layer-agent'), session: Session.create(SessionId('layer-session')) } as Agent
    let jobSpec: JobSpec | undefined
    const queryStarted = Promise.withResolvers<undefined>()
    const pendingQuery = Promise.withResolvers<Response>()
    const transport = vi.fn(async (_url: string, init: RequestInit): Promise<Response> => {
      const request = jsonBody(init) as { path: string }
      if (request.path === '/v1/proxy_async_create') return ndjson({ code: 0, data: { task_id_list: [handle] } })
      queryStarted.resolve(undefined)
      return pendingQuery.promise
    })
    vi.stubGlobal('fetch', transport)
    try {
      ctx.provide('tools', { register(definition: ToolDefinition) { definitions.push(definition); return () => {} } } as never)
      ctx.provide('agents', { roots: () => [agent] } as never)
      ctx.provide('insightAccount', { getAccessToken: async () => 'account-token' } as never)
      ctx.provide('jobs', { start(spec: JobSpec) { jobSpec = spec; return JobId('image-layering-job-1') } } as never)
      registerImageLayeringTools(ctx, config, () => true)
      const exec = { agent, callId: ToolCallId('call-1'), rootCallId: ToolCallId('root-1'),
        signal: new AbortController().signal } as ToolRunContext
      await definitions.find(tool => tool.name === 'submit_image_layering')?.execute({ imageUrl: input }, exec)
      const hooks = jobSpec?.run({ id: JobId('image-layering-job-1'), append: () => {}, updateProgress: () => {} })
      await queryStarted.promise
      hooks?.cancel()
      let settled = false
      void hooks?.done.then(() => { settled = true })
      await Promise.resolve()
      expect(settled).toBe(false)
      pendingQuery.reject(new Error('Query stopped'))
      expect(await hooks?.done).toMatchObject({ status: 'killed', result: JSON.stringify({
        taskHandle: handle, status: 'monitoring_stopped' }) })
      expect(transport).toHaveBeenCalledTimes(2)
    } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
  })

  it('keeps the proxy audit ID when a submitted response stream is truncated', async () => {
    const ctx = new Context()
    const definitions: ToolDefinition[] = []
    const agent = { id: SessionId('layer-agent'), session: Session.create(SessionId('layer-session')) } as Agent
    const transport = vi.fn(async () => new Response('{"type":"accepted"}\n{"type":', { status: 200,
      headers: { 'content-type': 'application/x-ndjson',
        'X-Insight-Proxy-Request-Id': '123e4567-e89b-12d3-a456-426614174000' } }))
    vi.stubGlobal('fetch', transport)
    try {
      ctx.provide('tools', { register(definition: ToolDefinition) { definitions.push(definition); return () => {} } } as never)
      ctx.provide('agents', { roots: () => [agent] } as never)
      ctx.provide('insightAccount', { getAccessToken: async () => 'account-token' } as never)
      ctx.provide('jobs', { start: () => JobId('job') } as never)
      registerImageLayeringTools(ctx, config, () => true)
      const exec = { agent, callId: ToolCallId('call-1'), rootCallId: ToolCallId('root-1'),
        signal: new AbortController().signal } as ToolRunContext
      let failure: unknown
      try { await definitions.find(tool => tool.name === 'submit_image_layering')?.execute({ imageUrl: input }, exec) }
      catch (error) { failure = error }
      expect(failure).toMatchObject({ code: 'SUBMISSION_UNKNOWN' })
      expect(failure).toBeInstanceOf(Error)
      if (failure instanceof Error) expect(failure.message).toContain('123e4567-e89b-12d3-a456-426614174000')
      expect(transport).toHaveBeenCalledOnce()
    } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
  })
})
