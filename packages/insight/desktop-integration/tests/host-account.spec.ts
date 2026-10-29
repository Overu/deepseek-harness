import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { afterEach, describe, expect, it } from 'vitest'
import {
  INSIGHT_ACCOUNT_MAX_PENDING_REQUESTS,
  type InsightAccountHostMessage,
  type InsightAccountRequestId,
} from '../src/shared/account-protocol.ts'
import {
  InsightAccount,
  InsightAccountAccessError,
  type InsightAccountScheduler,
  type InsightAccountTransport,
} from '../src/host.ts'

const roots: Context[] = []

afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

class TestTransport implements InsightAccountTransport {
  readonly sent: InsightAccountHostMessage[] = []
  private listener: ((value: unknown) => void) | undefined
  sendResult = true
  private delivery: ((error: Error | null) => void) | undefined
  private disconnectListener: (() => void) | undefined

  send(message: InsightAccountHostMessage, callback: (error: Error | null) => void): boolean {
    this.sent.push(message)
    this.delivery = callback
    return this.sendResult
  }

  onMessage(listener: (value: unknown) => void): () => void {
    this.listener = listener
    return () => { this.listener = undefined }
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListener = listener
    return () => { this.disconnectListener = undefined }
  }

  emit(value: unknown): void { this.listener?.(value) }
  completeDelivery(): void { this.delivery?.(null) }
  failDelivery(): void { this.delivery?.(new Error('IPC delivery failed')) }
  disconnect(): void { this.disconnectListener?.() }
  get listening(): boolean { return this.listener !== undefined }
}

class TestScheduler implements InsightAccountScheduler {
  private readonly callbacks = new Map<ReturnType<typeof setTimeout>, () => void>()

  set(_delayMs: number, callback: () => void): ReturnType<typeof setTimeout> {
    const handle = setTimeout(() => {}, 2_147_483_647)
    this.callbacks.set(handle, callback)
    return handle
  }

  clear(handle: ReturnType<typeof setTimeout>): void {
    clearTimeout(handle)
    this.callbacks.delete(handle)
  }

  fireAll(): void {
    for (const callback of [...this.callbacks.values()]) callback()
  }
}

function fixture(options: { requestId?: () => InsightAccountRequestId } = {}) {
  const ctx = new Context()
  roots.push(ctx)
  const transport = new TestTransport()
  const scheduler = new TestScheduler()
  const service = new InsightAccount(ctx, { requestTimeoutMs: 10_000, transport, scheduler, ...options })
  return { ctx, transport, scheduler, service }
}

function lastRequest(transport: TestTransport): Extract<InsightAccountHostMessage, { kind: 'insight-account-request' }> {
  const message = transport.sent.at(-1)
  if (message?.kind !== 'insight-account-request') throw new Error('expected an access-token request')
  return message
}

describe('InsightAccount', () => {
  it('provides Host-only token access and resolves a matching response', async () => {
    const { ctx, transport } = fixture()
    expect(ctx.insightAccount).toBeInstanceOf(InsightAccount)
    const token = ctx.insightAccount.getAccessToken()
    const request = lastRequest(transport)
    transport.emit({ kind: 'insight-account-response', requestId: request.requestId, result: { ok: true, accessToken: 'access-token' } })
    await expect(token).resolves.toBe('access-token')
  })

  it('returns a structured Main failure without preserving a diagnostic payload', async () => {
    const { transport, service } = fixture()
    const pending = service.getAccessToken()
    const request = lastRequest(transport)
    transport.emit({ kind: 'insight-account-response', requestId: request.requestId, result: { ok: false, reason: 'expired' } })
    await expect(pending).rejects.toMatchObject({ name: 'InsightAccountAccessError', reason: 'expired' })
  })

  it('cancels an aborted request and ignores its late response', async () => {
    const { transport, service } = fixture()
    const controller = new AbortController()
    const pending = service.getAccessToken(controller.signal)
    const request = lastRequest(transport)
    controller.abort()
    expect(transport.sent.at(-1)).toEqual({ kind: 'insight-account-cancel', requestId: request.requestId })
    transport.emit({ kind: 'insight-account-response', requestId: request.requestId, result: { ok: true, accessToken: 'late-token' } })
    await expect(pending).rejects.toMatchObject({ reason: 'cancelled' })
  })

  it('times out through the injected scheduler and tells Main to cancel', async () => {
    const { transport, scheduler, service } = fixture()
    const pending = service.getAccessToken()
    const request = lastRequest(transport)
    scheduler.fireAll()
    expect(transport.sent.at(-1)).toEqual({ kind: 'insight-account-cancel', requestId: request.requestId })
    await expect(pending).rejects.toMatchObject({ reason: 'timeout' })
  })

  it('rejects a duplicate request id instead of overwriting pending state', async () => {
    const duplicate = brandString<InsightAccountRequestId>('c254ab28-97c9-4382-95e6-2db9c66f98c8')
    const { transport, service } = fixture({ requestId: () => duplicate })
    const first = service.getAccessToken()
    await expect(service.getAccessToken()).rejects.toMatchObject({ reason: 'failed' })
    const request = lastRequest(transport)
    transport.emit({ kind: 'insight-account-response', requestId: request.requestId, result: { ok: false, reason: 'cancelled' } })
    await expect(first).rejects.toBeInstanceOf(InsightAccountAccessError)
  })

  it('caps concurrent requests using the shared protocol limit', async () => {
    const { transport, service } = fixture()
    const pending = Array.from({ length: INSIGHT_ACCOUNT_MAX_PENDING_REQUESTS }, () => service.getAccessToken())
    await expect(service.getAccessToken()).rejects.toMatchObject({ reason: 'unavailable' })
    for (const message of transport.sent) {
      if (message.kind === 'insight-account-request') transport.emit({ kind: 'insight-account-response', requestId: message.requestId, result: { ok: false, reason: 'cancelled' } })
    }
    await expect(Promise.allSettled(pending)).resolves.toHaveLength(INSIGHT_ACCOUNT_MAX_PENDING_REQUESTS)
  })

  it('treats a false send return as backpressure and still accepts a successful callback response', async () => {
    const { transport, service } = fixture()
    transport.sendResult = false
    const pending = service.getAccessToken()
    const request = lastRequest(transport)
    transport.completeDelivery()
    transport.emit({ kind: 'insight-account-response', requestId: request.requestId, result: { ok: true, accessToken: 'access-token' } })
    await expect(pending).resolves.toBe('access-token')
  })

  it('contains an asynchronous IPC delivery failure as unavailable', async () => {
    const { transport, service } = fixture()
    const pending = service.getAccessToken()
    transport.failDelivery()
    await expect(pending).rejects.toMatchObject({ reason: 'unavailable' })
  })

  it('rejects pending work when the Desktop Main IPC channel disconnects', async () => {
    const { transport, service } = fixture()
    const pending = service.getAccessToken()
    transport.disconnect()
    await expect(pending).rejects.toMatchObject({ reason: 'unavailable' })
    await expect(service.getAccessToken()).rejects.toMatchObject({ reason: 'unavailable' })
  })

  it('cancels pending work and removes the IPC listener during Context disposal', async () => {
    const { ctx, transport, service } = fixture()
    const pending = service.getAccessToken()
    const request = lastRequest(transport)
    await ctx.fiber.dispose()
    expect(transport.listening).toBe(false)
    expect(transport.sent.at(-1)).toEqual({ kind: 'insight-account-cancel', requestId: request.requestId })
    transport.emit({ kind: 'insight-account-response', requestId: request.requestId, result: { ok: true, accessToken: 'late-token' } })
    await expect(pending).rejects.toMatchObject({ reason: 'disposed' })
  })
})
