/** Fixed Insight Gateway model registration and Main-token request isolation. */
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmError } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InsightAccount, type InsightAccountTransport } from '../src/host.ts'
import * as Integration from '../src/host/index.ts'
import { createInsightModelGatewayAdapter, INSIGHT_MODEL_ID, INSIGHT_MODEL_PROVIDER } from '../src/host/model-gateway.ts'
import type { InsightAccountHostMessage, InsightAccountRequestId } from '../src/shared/account-protocol.ts'

const contexts: Context[] = []

afterEach(async () => { await Promise.all(contexts.splice(0).map(context => context.fiber.dispose())) })

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

async function fixture() {
  const context = new Context()
  contexts.push(context)
  await context.plugin(LlmRuntime)
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

function accountRequests(transport: AccountTransport): Extract<InsightAccountHostMessage, { kind: 'insight-account-request' }>[] {
  return transport.sent.filter((message): message is Extract<InsightAccountHostMessage, { kind: 'insight-account-request' }> => message.kind === 'insight-account-request')
}

describe('Insight Gateway model adapter', () => {
  it('advertises only the fixed model after Main supplies the account token', async () => {
    const { adapter, transport } = await fixture()
    const listed = adapter.listModels(INSIGHT_MODEL_PROVIDER)
    await vi.waitFor(() => { expect(accountRequests(transport)).toHaveLength(1) })
    transport.respond(accountRequests(transport)[0]!.requestId, 'account-token')
    await expect(listed).resolves.toEqual([expect.objectContaining({
      provider: INSIGHT_MODEL_PROVIDER,
      id: INSIGHT_MODEL_ID,
    })])
  })

  it('binds each pending stream token request to its own abort signal', async () => {
    const { adapter, transport } = await fixture()
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
    const transport = new AccountTransport()
    const restoreProcessTransport = installProcessTransport(transport)
    try {
      const integrationFiber = context.plugin(Integration, { requestTimeoutMs: 10_000, serviceEnvironment: 'test' })
      await integrationFiber
      await vi.waitFor(() => {
        expect(context.llm.listProviders()).toContainEqual(expect.objectContaining({ id: INSIGHT_MODEL_PROVIDER }))
        expect(context.insightAccount).toBeInstanceOf(InsightAccount)
      })
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
    const restoreProcessTransport = installUnavailableProcessTransport()
    try {
      const integrationFiber = context.plugin(Integration, { requestTimeoutMs: 10_000, serviceEnvironment: 'test' })
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
