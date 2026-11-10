import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { JobId, type JobSpec } from '@deepseek-ai/dsh-jobs'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { parseLayeringResult, parseTaskHandle, registerImageLayeringTools } from '../src/image-layering.ts'

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
  it('requires exactly one service-issued handle', () => {
    expect(parseTaskHandle({ data: { task_id_list: [handle] } })).toBe(handle)
    expect(() => parseTaskHandle({ data: { task_id_list: [] } })).toThrow('no single usable task handle')
    expect(() => parseTaskHandle({ data: { task_id_list: [handle, 'extra'] } })).toThrow()
  })

  it('only treats an image_list PSD as the requested result', () => {
    expect(parseLayeringResult({ status: 'success', data: { image_list: [png, psd] } }, handle))
      .toEqual({ taskHandle: handle, status: 'succeeded', imageUrls: [png, psd], psdUrls: [psd] })
    expect(parseLayeringResult({ status: 'success', data: { image_list: [png] } }, handle))
      .toMatchObject({ status: 'missing_psd', imageUrls: [png] })
    expect(parseLayeringResult({ status: 'success', data: { image_list: [png], psd_url: psd } }, handle))
      .toMatchObject({ status: 'succeeded', imageUrls: [png], psdUrls: [psd] })
    expect(() => parseLayeringResult({ status: 'success', data: { image_list: [png], psd_url: 'http://bad.test/x.psd' } }, handle))
      .toThrow('invalid psd_url')
    expect(parseLayeringResult({ status: 'running' }, handle)).toMatchObject({ status: 'running' })
    expect(() => parseLayeringResult({ status: 'success', data: { image_list: ['http://bad.test/x.psd'] } }, handle))
      .toThrow('no valid image_list')
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

  it('does not retry an uncertain creation after an NDJSON timeout event', async () => {
    const ctx = new Context()
    const definitions: ToolDefinition[] = []
    const agent = { id: SessionId('layer-agent'), session: Session.create(SessionId('layer-session')) } as Agent
    const transport = vi.fn(async () => new Response(
      '{"type":"accepted"}\n{"type":"error","status":504,"code":"UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN"}\n',
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
