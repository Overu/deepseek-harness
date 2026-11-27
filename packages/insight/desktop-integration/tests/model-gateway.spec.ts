/** Fixed Insight Gateway model registration and Main-token request isolation. */
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId, ImageVariantId, type AttachmentStore, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import LlmRuntime, { createAssistantMessage, createToolResultMessage, createUserMessage, expandAssistantStream, LlmError, ProviderRequestId, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { ShellEnvRegistry } from '@deepseek-ai/dsh-shell-env'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { WebRuntime } from '@deepseek-ai/dsh-web'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InsightAccount, type InsightAccountTransport } from '../src/host.ts'
import * as Integration from '../src/host/index.ts'
import { createInsightModelGatewayAdapter, INSIGHT_MODEL_ID, INSIGHT_MODEL_PROVIDER, QWEN_MODEL_ID } from '../src/host/model-gateway.ts'
import type { InsightAccountHostMessage, InsightAccountRequestId } from '../src/shared/account-protocol.ts'

const contexts: Context[] = []
const homes: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(contexts.splice(0).map(context => context.fiber.dispose()))
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

class AccountTransport implements InsightAccountTransport {
  readonly sent: InsightAccountHostMessage[] = []
  private listener: ((value: unknown) => void) | undefined

  send(message: InsightAccountHostMessage, _callback: (error: Error | null) => void): boolean {
    this.sent.push(message)
    return true
  }

  onMessage(listener: (value: unknown) => void): () => void {
    this.listener = listener
    return () => { this.listener = undefined }
  }

  onDisconnect(_listener: () => void): () => void { return () => {} }

  respond(requestId: InsightAccountRequestId, token: string): void {
    this.listener?.({ kind: 'insight-account-response', requestId, result: { ok: true, accessToken: token } })
  }

  fail(requestId: InsightAccountRequestId, reason: 'unavailable' | 'expired' | 'cancelled' | 'failed'): void {
    this.listener?.({ kind: 'insight-account-response', requestId, result: { ok: false, reason } })
  }
}

/** Bind the production Account transport seam to the test process for one test. */
function installProcessTransport(transport: AccountTransport): () => void {
  const connected = Object.getOwnPropertyDescriptor(process, 'connected')
  const send = Object.getOwnPropertyDescriptor(process, 'send')
  Object.defineProperty(process, 'connected', { configurable: true, value: true })
  Object.defineProperty(process, 'send', { configurable: true, value: transport.send.bind(transport) })
  return () => {
    if (connected === undefined) Reflect.deleteProperty(process, 'connected')
    else Object.defineProperty(process, 'connected', connected)
    if (send === undefined) delete process.send
    else Object.defineProperty(process, 'send', send)
  }
}

/** Force the production transport probe to take its unavailable branch without touching the Vitest IPC channel. */
function installUnavailableProcessTransport(): () => void {
  const connected = Object.getOwnPropertyDescriptor(process, 'connected')
  const send = Object.getOwnPropertyDescriptor(process, 'send')
  Object.defineProperty(process, 'connected', { configurable: true, value: false })
  Object.defineProperty(process, 'send', { configurable: true, value: undefined })
  return () => {
    if (connected === undefined) Reflect.deleteProperty(process, 'connected')
    else Object.defineProperty(process, 'connected', connected)
    if (send === undefined) delete process.send
    else Object.defineProperty(process, 'send', send)
  }
}

async function fixture(agentLoop = false) {
  const context = new Context()
  contexts.push(context)
  if (agentLoop) await mountAgentLoopTestDependencies(context)
  else await context.plugin(LlmRuntime)
  const transport = new AccountTransport()
  let adapter!: ReturnType<typeof createInsightModelGatewayAdapter>
  let gatewayFiber!: ReturnType<Context['inject']>
  context.effect(function* () {
    const accountFiber = context.plugin((accountCtx) => {
      new InsightAccount(accountCtx, { requestTimeoutMs: 10_000, transport })
    })
    yield accountFiber.dispose
    gatewayFiber = context.inject(['insightAccount', 'llm'], (gatewayCtx) => {
      adapter = createInsightModelGatewayAdapter(gatewayCtx, 'test')
      const unregister = gatewayCtx.llm.registerAdapter([INSIGHT_MODEL_PROVIDER], adapter)
      gatewayCtx.effect(() => async () => {
        unregister()
        await adapter.dispose()
      }, 'test: insight gateway registration')
    })
    yield gatewayFiber.dispose
  }, 'test: insight account and model gateway')
  await gatewayFiber
  return { adapter, context, transport }
}

/** Supply the real Host seams Integration now owns without creating an external business request. */
async function prepareIntegrationContext(context: Context): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-insight-integration-'))
  homes.push(home)
  vi.stubEnv('DSH_HOME', home)
  vi.stubEnv('DSH_AGENTS_HOME', join(home, 'agents'))
  vi.stubEnv('DSH_INSIGHT_SKILL_PROXY_NODE', process.execPath)
  await context.plugin(WebRuntime)
  await context.plugin(ShellEnvRegistry, { dshHome: home })
  await context.plugin(TypertRegistry)
  context.provide('agents', { get: () => undefined } as never)
  context.provide('sessionQuery', {} as never)
  context.provide('workingDirectory', { defaultDirectory: home } as never)
}

function accountRequests(transport: AccountTransport): Extract<InsightAccountHostMessage, { kind: 'insight-account-request' }>[] {
  return transport.sent.filter((message): message is Extract<InsightAccountHostMessage, { kind: 'insight-account-request' }> => message.kind === 'insight-account-request')
}

/** Consume one runtime stream and require an explicit terminal outcome. */
async function finishOf(chunks: AsyncIterable<StreamChunk>) {
  for await (const chunk of chunks) {
    if (chunk.type === 'finish') return chunk.reason
  }
  throw new Error('The model request ended without a finish chunk.')
}

/** Intercept the final SDK fetch so a wrong destination can never reach the network. */
function captureChatRequests() {
  interface ChatBody {
    model: string
    messages: { content?: string | { type: string; image_url?: { url: string } }[] }[]
  }
  const requests: { url: string; headers: Headers; body: ChatBody }[] = []
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init)
    const body = await request.json() as ChatBody
    requests.push({ url: request.url, headers: request.headers, body })
    const chunk = {
      id: `reply-${requests.length}`, model: body.model,
      choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
    }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    })
  }))
  onTestFinished(() => { vi.unstubAllGlobals() })
  return requests
}

describe('Insight Gateway model adapter', () => {
  it.each(['canvas', 'other', 'none'] as const)('adds only the Canvas strict flag to the %s request', async (kind) => {
    const tools = [{
      name: 'canvas_node_edit', description: 'Edit Canvas nodes.',
      parameters: { type: 'object', properties: { ops: { type: 'array', items: {
        oneOf: [{ type: 'object', additionalProperties: true }, { type: 'string' }],
      } } } },
    }, { name: 'canvas_get', description: 'Read Canvas.', parameters: { type: 'object' } }]
    const selected = kind === 'canvas' ? tools : kind === 'other' ? tools.slice(1) : undefined
    const requests: unknown[] = []
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url !== 'https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1/chat/completions') return originalFetch(input, init)
      if (typeof init?.body !== 'string') throw new Error('Gateway request must carry a JSON string body.')
      requests.push(JSON.parse(init.body))
      return new Response('data: {"id":"strict-probe","choices":[{"index":0,"delta":{"content":"done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    }))
    try {
      const { adapter, transport } = await fixture()
      const result = (async () => {
        const chunks: StreamChunk[] = []
        for await (const chunk of adapter.stream({
          provider: INSIGHT_MODEL_PROVIDER, model: INSIGHT_MODEL_ID, messages: [],
          ...selected === undefined ? {} : { tools: selected },
        })) chunks.push(chunk)
        return chunks
      })()
      await vi.waitFor(() => { expect(accountRequests(transport)).toHaveLength(1) })
      transport.respond(accountRequests(transport)[0]!.requestId, 'fixture-token')
      expect(await result).toContainEqual(expect.objectContaining({ type: 'finish', reason: { kind: 'stop' } }))
      expect(requests).toHaveLength(1)
      expect(requests[0]).toEqual(expect.objectContaining({
        ...selected === undefined ? {} : { tools: selected.map(tool => ({
          type: 'function', function: { ...tool, ...tool.name === 'canvas_node_edit' ? { strict: true } : {} },
        })) },
      }))
      if (selected === undefined) expect(requests[0]).not.toHaveProperty('tools')
      expect(tools[0]).not.toHaveProperty('strict')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each(['transport', 'sdk', 'finish'] as const)('persists %s diagnostics through the real Agent request', async (mode) => {
    const privateCause = Object.assign(new Error('https://private.example/?token=secret-token cookie=private-cookie'), {
      code: 'ECONNRESET', errno: 'ECONNRESET', syscall: 'connect',
    })
    const failure = new LlmError('provider transport failure', 'TRANSPORT', {
      cause: privateCause, status: 503, providerRetryAfterMs: 125, requestId: ProviderRequestId('provider-request'),
    })
    const stream = vi.spyOn(PiAiAdapter.prototype, 'stream').mockImplementation(() => ({
      async *[Symbol.asyncIterator](): AsyncGenerator<StreamChunk> {
        if (mode === 'transport') throw failure
        if (mode === 'sdk') throw new Error('provider transport failure', { cause: privateCause })
        yield { type: 'finish', reason: { kind: 'error', failure: failure.failure } }
      },
    }))
    try {
      const { context } = await fixture(true)
      const harness = await mountAgentLoopTestHarness(context)
      const agent = await harness.create(SessionId(`gateway-diagnostic-${mode}`), {
        provider: INSIGHT_MODEL_PROVIDER, model: INSIGHT_MODEL_ID,
      })
      const routed: unknown[] = []
      context.on('agent/request-error', ({ failure: routedFailure }, next) => {
        routed.push(routedFailure)
        return next()
      }, { global: true })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'test request' }], source: { kind: 'user' } }))
      await agent.whenIdle()
      const attempt = agent.session.snapshotEvents().find(event => event.type === 'assistant/attempt')
      expect(attempt).toBeDefined()
      if (attempt?.type !== 'assistant/attempt') throw new Error('failed request did not persist its stream')
      const finish = expandAssistantStream(attempt.data.stream).map(member => member.chunk)
        .find(chunk => chunk.type === 'finish')
      if (finish?.type !== 'finish' || finish.reason.kind !== 'error') throw new Error('failed request did not persist its failure')
      const message = 'provider transport failure [Insight Gateway source=model-stream'
        + (mode === 'finish' ? ']' : ' causeCode=ECONNRESET errno=ECONNRESET syscall=connect]')
      expect(finish.reason.failure.message).toMatch(/traceId=[0-9a-f-]{36}/)
      const diagnostic = { ...finish.reason.failure, message: finish.reason.failure.message.replace(/ traceId=[0-9a-f-]{36}/, '') }
      expect(diagnostic).toEqual(mode === 'sdk'
        ? { code: 'UNKNOWN', message }
        : { ...failure.failure, message })
      expect(routed).toEqual([finish.reason.failure])
      const exported = JSON.stringify(attempt)
      for (const secret of ['private.example', 'secret-token', 'private-cookie']) expect(exported).not.toContain(secret)
    } finally {
      stream.mockRestore()
    }
  })

  it('correlates concurrent failures and a successful retry with distinct request trace IDs', async () => {
    const requests: { traceId: string; result: ReturnType<typeof Promise.withResolvers<Response>> }[] = []
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_input, init) => {
      const traceId = new Headers(init?.headers).get('traceid')
      if (traceId === null) throw new Error('Gateway request must carry a trace ID.')
      const result = Promise.withResolvers<Response>()
      requests.push({ traceId, result })
      const signal = init?.signal
      const abort = () => { result.reject(new DOMException('Request cancelled', 'AbortError')) }
      signal?.addEventListener('abort', abort, { once: true })
      return result.promise.finally(() => { signal?.removeEventListener('abort', abort) })
    }))
    try {
      const { adapter, transport } = await fixture()
      const run = async () => {
        const chunks: StreamChunk[] = []
        for await (const chunk of adapter.stream({
          provider: INSIGHT_MODEL_PROVIDER, model: INSIGHT_MODEL_ID, messages: [],
        })) chunks.push(chunk)
        return chunks.find(chunk => chunk.type === 'finish')
      }
      const first = run()
      const second = run()
      await vi.waitFor(() => { expect(accountRequests(transport)).toHaveLength(2) })
      for (const request of accountRequests(transport)) transport.respond(request.requestId, 'private-token')
      await vi.waitFor(() => { expect(requests).toHaveLength(2) })
      const cause = Object.assign(new Error('Connect Timeout Error: private-address'), { code: 'UND_ERR_CONNECT_TIMEOUT' })
      for (const request of requests) request.result.reject(new TypeError('fetch failed', { cause }))
      const finishes = await Promise.all([first, second])
      for (const [index, finish] of finishes.entries()) {
        expect(finish).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'TIMEOUT' } } })
        if (finish?.type !== 'finish' || finish.reason.kind !== 'error') throw new Error('Timeout did not produce an error finish.')
        expect(finish.reason.failure.message).toContain(`traceId=${requests[index]!.traceId}`)
        expect(finish.reason.failure.message).not.toContain('private-address')
        expect(finish.reason.failure.message).not.toContain('private-token')
      }
      const retry = run()
      await vi.waitFor(() => { expect(accountRequests(transport)).toHaveLength(3) })
      transport.respond(accountRequests(transport)[2]!.requestId, 'private-token')
      await vi.waitFor(() => { expect(requests).toHaveLength(3) })
      requests[2]!.result.resolve(new Response('data: {"id":"successful-retry","choices":[{"index":0,"delta":{"content":"done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      }))
      await expect(retry).resolves.toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
      expect(new Set(requests.map(request => request.traceId)).size).toBe(3)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('advertises the two managed models and resolves historical DeepSeek IDs without listing them', async () => {
    const { adapter, transport } = await fixture()
    const listed = adapter.listModels(INSIGHT_MODEL_PROVIDER)
    await vi.waitFor(() => { expect(accountRequests(transport)).toHaveLength(1) })
    transport.respond(accountRequests(transport)[0]!.requestId, 'account-token')
    const models = await listed
    expect(models.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
      { id: 'qwen38-flash-next', name: 'Qwen3.8-Flash-Next' },
    ])
    const deepseek = await adapter.resolveModel(INSIGHT_MODEL_PROVIDER, INSIGHT_MODEL_ID)
    expect(deepseek).toMatchObject({ context: { contextWindow: 1_048_576 }, defaultMaxTokens: 256_000, inputModalities: ['text', 'image'] })
    expect(deepseek.reasoning?.efforts.map(level => level.id)).toEqual(['off', 'low', 'high', 'max'])
    for (const id of ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) {
      await expect(adapter.resolveModel(INSIGHT_MODEL_PROVIDER, id)).resolves.toEqual({ ...deepseek, id })
    }
    const qwen = await adapter.resolveModel(INSIGHT_MODEL_PROVIDER, QWEN_MODEL_ID)
    expect(qwen).toMatchObject({ context: { contextWindow: 262_144 }, defaultMaxTokens: 32_768, inputModalities: ['text', 'image'] })
    expect(qwen.reasoning?.efforts.map(level => level.id)).toEqual(['low', 'high', 'max'])
    expect(qwen.reasoning).not.toHaveProperty('defaultEffort')
  })

  it.each([
    { effort: undefined, maxTokens: undefined, expectedTokens: 32_768 },
    { effort: 'low', maxTokens: 512, expectedTokens: 512 },
    { effort: 'high', maxTokens: 65_536, expectedTokens: 32_768 },
    { effort: 'max', maxTokens: undefined, expectedTokens: 32_768 },
  ])('sends Qwen effort $effort and output cap $expectedTokens via the authenticated route', async ({ effort, maxTokens, expectedTokens }) => {
    const requests = captureChatRequests()
    const { context } = await fixture()
    vi.spyOn(context.insightAccount, 'getAccessToken').mockResolvedValue('fixture-token')
    const finish = await finishOf(context.llm.stream({
      provider: INSIGHT_MODEL_PROVIDER, model: QWEN_MODEL_ID, messages: [],
      ...effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) },
      ...maxTokens === undefined ? {} : { maxTokens },
    }))
    expect(finish).toEqual({ kind: 'stop' })
    expect(requests).toHaveLength(1)
    const request = requests[0]!
    expect(request.url).toBe('https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1/chat/completions')
    expect(request.headers.get('authorization')).toBe('Bearer fixture-token')
    expect(request.headers.get('traceid')).toMatch(/^[0-9a-f-]{36}$/i)
    expect(request.body).toMatchObject({ model: 'qwen38-flash-next', max_tokens: expectedTokens, stream: true })
    expect(request.body).not.toHaveProperty('thinking')
    if (effort === undefined) expect(request.body).not.toHaveProperty('reasoning_effort')
    else expect(request.body).toHaveProperty('reasoning_effort', effort)
  })

  it('switches an existing DeepSeek Off conversation to Qwen Default without sending Off', async () => {
    const requests = captureChatRequests()
    const { context } = await fixture(true)
    vi.spyOn(context.insightAccount, 'getAccessToken').mockResolvedValue('fixture-token')
    const harness = await mountAgentLoopTestHarness(context)
    const provider = INSIGHT_MODEL_PROVIDER
    const agent = await harness.create(SessionId('switch-to-qwen'), { provider, model: INSIGHT_MODEL_ID, reasoningEffort: ReasoningEffortId('off') })
    const message = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
    agent.followup(message('First turn'))
    await agent.whenIdle()
    agent.model.select({ provider, model: QWEN_MODEL_ID })
    agent.followup(message('Second turn'))
    await agent.whenIdle()
    expect(requests.map(request => request.body.model)).toEqual([INSIGHT_MODEL_ID, QWEN_MODEL_ID])
    expect(requests[0]!.body).toHaveProperty('thinking.type', 'disabled')
    expect(requests[1]!.body).not.toHaveProperty('thinking')
    expect(requests[1]!.body).not.toHaveProperty('reasoning_effort')
  })

  it.each([
    { model: QWEN_MODEL_ID, count: 1, offloaded: 0, allowed: true },
    { model: QWEN_MODEL_ID, count: 20, offloaded: 0, allowed: true },
    { model: QWEN_MODEL_ID, count: 21, offloaded: 0, allowed: false },
    { model: QWEN_MODEL_ID, count: 21, offloaded: 1, allowed: true },
    { model: INSIGHT_MODEL_ID, count: 21, offloaded: 0, allowed: true },
  ])('checks $model user and tool images ($count occurrences, $offloaded offloaded)', async ({ model, count, offloaded, allowed }) => {
    const requests = captureChatRequests()
    const { context } = await fixture()
    vi.spyOn(context.insightAccount, 'getAccessToken').mockResolvedValue('fixture-token')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==', 'base64')
    const attachment: ImageAttachmentRef = {
      attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`), mediaType: 'image/png', bytes: png.length, width: 1, height: 1,
    }
    // One durable object may appear several times in the provider's request.
    const store: Pick<AttachmentStore, 'imageHostPath' | 'readImageRequest'> = {
      imageHostPath: () => undefined,
      readImageRequest: async ref => ({
        variantId: ImageVariantId(`sha256:${'b'.repeat(64)}`), attachment: ref, data: png,
        mediaType: ref.mediaType, bytes: png.length, width: 1, height: 1, depth: 'uchar', space: 'srgb', hasAlpha: true,
      }),
    }
    context.provide('attachments', store as AttachmentStore)
    const image = { type: 'image' as const, attachment }
    const current = createUserMessage({ source: { kind: 'user' }, content: [image] })
    const callId = ToolCallId('read-image')
    const messages = count === 1 ? [current] : [
      createUserMessage({
        source: { kind: 'user' },
        content: Array.from({ length: count - 2 }, (_, index) => index < offloaded ? { ...image, offloaded: true as const } : image),
      }),
      createAssistantMessage({
        source: { provider: INSIGHT_MODEL_PROVIDER, model },
        content: [{ type: 'tool-call', id: callId, name: 'read_image', arguments: '{}' }],
      }),
      createToolResultMessage({ callId, isError: false, content: [image] }),
      current,
    ]
    const finish = await finishOf(context.llm.stream({ provider: INSIGHT_MODEL_PROVIDER, model, messages }))
    if (!allowed) {
      expect(finish.kind).toBe('error')
      expect(finish).toHaveProperty('failure.message', expect.stringContaining('最多 20 张图片'))
      expect(requests).toHaveLength(0)
      return
    }
    expect(finish).toEqual({ kind: 'stop' })
    expect(requests).toHaveLength(1)
    const parts = requests[0]!.body.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
    const urls = parts.filter(part => part.type === 'image_url').map(part => part.image_url?.url)
    expect(urls).toEqual(Array.from({ length: count - offloaded }, () => `data:image/png;base64,${png.toString('base64')}`))
  })

  it('binds each pending stream token request to its own abort signal', async () => {
    const { adapter, context, transport } = await fixture()
    const warn = vi.spyOn(context.logger, 'warn').mockImplementation(() => undefined)
    const first = new AbortController()
    const second = new AbortController()
    const pendingFirst = adapter.stream({ provider: INSIGHT_MODEL_PROVIDER, model: INSIGHT_MODEL_ID, messages: [], signal: first.signal })
      [Symbol.asyncIterator]().next()
    const pendingSecond = adapter.stream({ provider: INSIGHT_MODEL_PROVIDER, model: INSIGHT_MODEL_ID, messages: [], signal: second.signal })
      [Symbol.asyncIterator]().next()
    await vi.waitFor(() => { expect(accountRequests(transport)).toHaveLength(2) })
    const [firstRequest, secondRequest] = accountRequests(transport)
    first.abort()
    await expect(pendingFirst).rejects.toMatchObject({ name: 'LlmError', code: 'ABORTED' } satisfies Partial<LlmError>)
    expect(transport.sent.at(-1)).toEqual({ kind: 'insight-account-cancel', requestId: firstRequest!.requestId })
    expect(transport.sent.some(message => message.kind === 'insight-account-cancel' && message.requestId === secondRequest!.requestId)).toBe(false)
    second.abort()
    await expect(pendingSecond).rejects.toMatchObject({ name: 'LlmError', code: 'ABORTED' } satisfies Partial<LlmError>)
    expect(warn).not.toHaveBeenCalled()
  })

  it('adds a redacted account-token diagnostic without changing its LLM failure', async () => {
    const { adapter, transport } = await fixture()
    const pending = adapter.stream({
      provider: INSIGHT_MODEL_PROVIDER,
      model: INSIGHT_MODEL_ID,
      messages: [],
      sessionId: 'session-diagnostic' as never,
    })[Symbol.asyncIterator]().next()
    await vi.waitFor(() => { expect(accountRequests(transport)).toHaveLength(1) })
    transport.fail(accountRequests(transport)[0]!.requestId, 'unavailable')

    await expect(pending).rejects.toMatchObject({ code: 'TRANSPORT' } satisfies Partial<LlmError>)
    await expect(pending).rejects.toThrow('source=account-token')
  })

  it('adds a redacted diagnostic to PiAi in-band failures', async () => {
    const privateRequestValue = 'https://private.example/stream?token=private-token'
    const stream = vi.spyOn(PiAiAdapter.prototype, 'stream').mockImplementation(() => ({
      async *[Symbol.asyncIterator](): AsyncGenerator<StreamChunk> {
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: {
              code: 'TRANSPORT',
              message: 'provider failed',
              status: 503,
            },
          },
        }
      },
    }))
    try {
      const { adapter } = await fixture()
      const iterator = adapter.stream({
        provider: privateRequestValue,
        model: privateRequestValue,
        messages: [],
        sessionId: privateRequestValue as never,
      })[Symbol.asyncIterator]()

      const result = await iterator.next()
      expect(result).toMatchObject({
        done: false,
        value: { type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT', status: 503 } } },
      })
      const output = JSON.stringify(result)
      expect(output).toContain('source=model-stream')
      for (const privateValue of [privateRequestValue, 'private-token']) {
        expect(output).not.toContain(privateValue)
      }
    } finally {
      stream.mockRestore()
    }
  })

  it('does not replace a provider failure when diagnostic fields throw', async () => {
    const failure = new Error('provider failure')
    Object.defineProperty(failure, 'cause', { get: () => { throw new Error('diagnostic getter') } })
    const stream = vi.spyOn(PiAiAdapter.prototype, 'stream').mockImplementation(() => ({
      async *[Symbol.asyncIterator](): AsyncGenerator<StreamChunk> {
        throw failure
      },
    }))
    try {
      const { adapter } = await fixture()
      const pending = adapter.stream({ provider: INSIGHT_MODEL_PROVIDER, model: INSIGHT_MODEL_ID, messages: [] })
        [Symbol.asyncIterator]().next()
      await expect(pending).rejects.toMatchObject({ code: 'UNKNOWN' } satisfies Partial<LlmError>)
      await expect(pending).rejects.toThrow(/^provider failure \[Insight Gateway source=model-stream traceId=[0-9a-f-]{36}\]$/)
    } finally {
      stream.mockRestore()
    }
  })

  it('keeps in-band and thrown provider outcomes without a logger', async () => {
    const failure = new Error('provider failure')
    let calls = 0
    const stream = vi.spyOn(PiAiAdapter.prototype, 'stream').mockImplementation(() => ({
      async *[Symbol.asyncIterator](): AsyncGenerator<StreamChunk> {
        calls += 1
        if (calls === 2) throw failure
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT', message: 'provider failure' } } }
      },
    }))
    try {
      const { adapter } = await fixture()
      const first = adapter.stream({ provider: INSIGHT_MODEL_PROVIDER, model: INSIGHT_MODEL_ID, messages: [] })
        [Symbol.asyncIterator]().next()
      await expect(first).resolves.toMatchObject({
        done: false,
        value: { type: 'finish', reason: { kind: 'error' } },
      })
      const second = adapter.stream({ provider: INSIGHT_MODEL_PROVIDER, model: INSIGHT_MODEL_ID, messages: [] })
        [Symbol.asyncIterator]().next()
      await expect(second).rejects.toMatchObject({ code: 'UNKNOWN' } satisfies Partial<LlmError>)
      await expect(second).rejects.toThrow('source=model-stream')
    } finally {
      stream.mockRestore()
    }
  })

  it('uses the dispatched stream signal after model preparation', async () => {
    const { adapter, transport } = await fixture()
    const prepared = await adapter.prepareCall(INSIGHT_MODEL_PROVIDER, INSIGHT_MODEL_ID)
    const controller = new AbortController()
    const pending = prepared.stream({
      provider: INSIGHT_MODEL_PROVIDER,
      model: INSIGHT_MODEL_ID,
      messages: [],
      signal: controller.signal,
    })[Symbol.asyncIterator]().next()
    await vi.waitFor(() => { expect(accountRequests(transport)).toHaveLength(1) })
    const request = accountRequests(transport)[0]!
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'LlmError', code: 'ABORTED' } satisfies Partial<LlmError>)
    expect(transport.sent.at(-1)).toEqual({ kind: 'insight-account-cancel', requestId: request.requestId })
  })

  it('cancels a pending Main token request and waits for it before gateway disposal settles', async () => {
    const { adapter, transport } = await fixture()
    const pending = adapter.stream({
      provider: INSIGHT_MODEL_PROVIDER,
      model: INSIGHT_MODEL_ID,
      messages: [],
    })[Symbol.asyncIterator]().next()
    await vi.waitFor(() => { expect(accountRequests(transport)).toHaveLength(1) })
    const request = accountRequests(transport)[0]!

    const disposing = adapter.dispose()
    await expect(pending).rejects.toMatchObject({ name: 'LlmError', code: 'ABORTED' } satisfies Partial<LlmError>)
    await disposing
    expect(transport.sent).toContainEqual({ kind: 'insight-account-cancel', requestId: request.requestId })
    await expect(adapter.listModels(INSIGHT_MODEL_PROVIDER)).rejects.toMatchObject({ code: 'ABORTED' } satisfies Partial<LlmError>)
  })

  it('unloads the production registration before removing its Account service', async () => {
    const context = new Context()
    contexts.push(context)
    await context.plugin(LlmRuntime)
    await prepareIntegrationContext(context)
    const transport = new AccountTransport()
    const restoreProcessTransport = installProcessTransport(transport)
    try {
      const integrationFiber = context.plugin(Integration, {
        requestTimeoutMs: 10_000,
        serviceEnvironment: 'test',
        skillProxyMaxActiveRequests: 8,
        skillProxyMaxBufferedRequestBytes: 16_777_216,
        skillProxyRequestTimeoutMs: 1_250_000,
      })
      await integrationFiber
      await vi.waitFor(() => {
        expect(context.llm.listProviders()).toContainEqual(expect.objectContaining({ id: INSIGHT_MODEL_PROVIDER }))
        expect(context.insightAccount).toBeInstanceOf(InsightAccount)
      })
      expect(context.shellEnv.collect({} as never)).toMatchObject({ DSH_SKILL_PROXY_NODE: process.execPath })
      const pending = context.llm.listModels(INSIGHT_MODEL_PROVIDER)
      await vi.waitFor(() => { expect(accountRequests(transport)).toHaveLength(1) })
      const request = accountRequests(transport)[0]!

      await integrationFiber.dispose()
      await expect(pending).rejects.toMatchObject({ code: 'ABORTED' } satisfies Partial<LlmError>)
      expect(transport.sent).toContainEqual({ kind: 'insight-account-cancel', requestId: request.requestId })
      expect(context.llm.listProviders()).not.toContainEqual(expect.objectContaining({ id: INSIGHT_MODEL_PROVIDER }))
      expect(context.get('insightAccount')).toBeUndefined()
    } finally {
      restoreProcessTransport()
    }
  })

  it('fails startup and rolls back when Desktop Main IPC is unavailable', async () => {
    const context = new Context()
    contexts.push(context)
    await context.plugin(LlmRuntime)
    await prepareIntegrationContext(context)
    const restoreProcessTransport = installUnavailableProcessTransport()
    try {
      const integrationFiber = context.plugin(Integration, {
        requestTimeoutMs: 10_000,
        serviceEnvironment: 'test',
        skillProxyMaxActiveRequests: 8,
        skillProxyMaxBufferedRequestBytes: 16_777_216,
        skillProxyRequestTimeoutMs: 1_250_000,
      })
      await expect(integrationFiber).rejects.toThrow('requires a connected Desktop Main IPC channel')
      expect(context.llm.listProviders()).not.toContainEqual(expect.objectContaining({ id: INSIGHT_MODEL_PROVIDER }))
      expect(context.get('insightAccount')).toBeUndefined()
    } finally {
      restoreProcessTransport()
    }
  })

  it('closes an active upstream request when its consumer pauses after a yielded chunk', async () => {
    const upstreamStarted = Promise.withResolvers<undefined>()
    const upstreamAborted = Promise.withResolvers<undefined>()
    const encoder = new TextEncoder()
    const fetchStub: typeof fetch = async (_input, init) => {
      const signal = init?.signal
      if (!(signal instanceof AbortSignal)) throw new Error('Gateway request must carry an abort signal.')
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener('abort', () => {
            controller.close()
            upstreamAborted.resolve(undefined)
          }, { once: true })
          controller.enqueue(encoder.encode('data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":0,"model":"deepseek-flash","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null}]}\n\n'))
          upstreamStarted.resolve(undefined)
        },
      }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    vi.stubGlobal('fetch', fetchStub)
    try {
      const { adapter, context, transport } = await fixture()
      const iterator = adapter.stream({
        provider: INSIGHT_MODEL_PROVIDER,
        model: INSIGHT_MODEL_ID,
        messages: [],
      })[Symbol.asyncIterator]()
      const first = iterator.next()
      await vi.waitFor(() => { expect(accountRequests(transport)).toHaveLength(1) })
      transport.respond(accountRequests(transport)[0]!.requestId, 'account-token')
      await upstreamStarted.promise
      await expect(first).resolves.toMatchObject({ done: false })

      const disposing = context.fiber.dispose()
      await upstreamAborted.promise
      await disposing
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
