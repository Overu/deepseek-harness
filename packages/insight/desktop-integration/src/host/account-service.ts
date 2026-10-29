/** Host-only access to the Desktop Main-owned Insight account token. */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  INSIGHT_ACCOUNT_MAX_PENDING_REQUESTS,
  parseInsightAccountMainMessage,
  type InsightAccountHostMessage,
  type InsightAccountRequestId,
  type InsightAccountResponse,
} from '../shared/account-protocol.ts'

/** Reason a token request could not complete without exposing Main-process diagnostics. */
export type InsightAccountAccessFailure = 'unavailable' | 'expired' | 'cancelled' | 'failed' | 'timeout' | 'disposed'

/** Structured failure returned by the Host-only account service. */
export class InsightAccountAccessError extends Error {
  /** Stable reason for callers which need to distinguish sign-in recovery from cancellation. */
  readonly reason: InsightAccountAccessFailure

  /** @param reason - stable non-diagnostic failure reason. */
  constructor(reason: InsightAccountAccessFailure) {
    super(`Insight account access token is ${reason}`)
    this.name = 'InsightAccountAccessError'
    this.reason = reason
  }
}

/** Narrow process IPC adapter, supplied explicitly by tests and bound to `process` in production. */
export interface InsightAccountTransport {
  /**
   * Queue one validated request or cancellation; `false` signals backpressure, not delivery failure.
   * @param message - Private request or cancellation for Desktop Main.
   * @param callback - Invoked when Node knows whether the delivery failed.
   * @returns Node's backpressure signal; false does not mean the message was rejected.
   */
  send(message: InsightAccountHostMessage, callback: (error: Error | null) => void): boolean
  /**
   * Subscribe to untrusted Main-process IPC values.
   * @param listener - Receives each unvalidated value from Desktop Main.
   * @returns a disposer that removes this listener.
   */
  onMessage(listener: (value: unknown) => void): () => void
  /**
   * Subscribe to an IPC-channel disconnect.
   * @param listener - Called when Desktop Main disconnects the private IPC channel.
   * @returns a disposer that removes this listener.
   */
  onDisconnect(listener: () => void): () => void
}

/** Timer abstraction used to make request lifetimes deterministic in tests. */
export interface InsightAccountScheduler {
  /**
   * Schedule expiry of one request.
   * @param delayMs - Request deadline in milliseconds.
   * @param callback - Called when the request deadline expires.
   * @returns timer handle used to cancel the expiry.
   */
  set(delayMs: number, callback: () => void): ReturnType<typeof setTimeout>
  /**
   * Cancel an earlier expiry.
   * @param handle - Handle returned from {@link set}.
   */
  clear(handle: ReturnType<typeof setTimeout>): void
}

/** Options for an account service provider. */
export interface InsightAccountServiceOptions {
  /** Deadline already validated by the plugin Config schema. */
  readonly requestTimeoutMs: number
  /** Explicit test transport; production binds the child-process IPC channel. */
  readonly transport?: InsightAccountTransport
  /** Explicit clock for deterministic tests. */
  readonly scheduler?: InsightAccountScheduler
  /** Explicit request-id generator for duplicate-id tests. */
  readonly requestId?: () => InsightAccountRequestId
}

interface PendingRequest {
  readonly reject: (reason: InsightAccountAccessError) => void
  readonly resolve: (accessToken: string) => void
  readonly timer: ReturnType<typeof setTimeout>
  readonly signal: AbortSignal | undefined
  readonly onAbort: (() => void) | undefined
}

/** Same-process service consumed only by trusted Host plugins. It has no Remote or HTTP exposure. */
export class InsightAccount extends Service {
  private readonly transport: InsightAccountTransport
  private readonly scheduler: InsightAccountScheduler
  private readonly requestTimeoutMs: number
  private readonly requestId: () => InsightAccountRequestId
  private readonly pending = new Map<InsightAccountRequestId, PendingRequest>()
  private readonly stopListening: () => void
  private readonly stopDisconnect: () => void
  private closedReason: 'disposed' | 'unavailable' | undefined

  /** @param ctx - Context owning this service. @param options - validated deadline and optional test seams. */
  constructor(ctx: Context, options: InsightAccountServiceOptions) {
    super(ctx, 'insightAccount')
    this.requestTimeoutMs = assertTimeout(options.requestTimeoutMs)
    this.transport = options.transport ?? processTransport()
    this.scheduler = options.scheduler ?? nativeScheduler
    this.requestId = options.requestId ?? (() => brandString<InsightAccountRequestId>(randomUUID()))
    this.stopListening = this.transport.onMessage((value) => { this.receive(value) })
    this.stopDisconnect = this.transport.onDisconnect(() => { this.close('unavailable') })
    ctx.effect(() => () => { this.close('disposed') }, 'insightAccount: IPC lifecycle')
  }

  /**
   * Request the current Main-owned access token.
   * @param signal - cancellation for this request only.
   * @returns the token without persisting, logging, or exposing it through a remote service.
   */
  getAccessToken(signal?: AbortSignal): Promise<string> {
    if (this.closedReason !== undefined) return Promise.reject(new InsightAccountAccessError(this.closedReason))
    if (signal?.aborted) return Promise.reject(new InsightAccountAccessError('cancelled'))
    if (this.pending.size >= INSIGHT_ACCOUNT_MAX_PENDING_REQUESTS) return Promise.reject(new InsightAccountAccessError('unavailable'))

    const requestId = this.requestId()
    if (this.pending.has(requestId)) return Promise.reject(new InsightAccountAccessError('failed'))
    return new Promise<string>((resolve, reject) => {
      const timer = this.scheduler.set(this.requestTimeoutMs, () => { this.settleFailure(requestId, 'timeout', true) })
      const onAbort = signal === undefined ? undefined : () => { this.settleFailure(requestId, 'cancelled', true) }
      const entry: PendingRequest = { resolve, reject, timer, signal, onAbort }
      this.pending.set(requestId, entry)
      if (onAbort !== undefined && signal !== undefined) signal.addEventListener('abort', onAbort, { once: true })
      this.send({ kind: 'insight-account-request', requestId, operation: 'access-token' }, () => {
        this.settleFailure(requestId, 'unavailable', false)
      })
    })
  }

  /** Consume a Main response only after strict IPC validation. */
  private receive(value: unknown): void {
    const response = parseInsightAccountMainMessage(value)
    if (response === undefined) return
    this.settleResponse(response)
  }

  /** Settle one matching response and ignore duplicate or late messages. */
  private settleResponse(response: InsightAccountResponse): void {
    const entry = this.pending.get(response.requestId)
    if (entry === undefined) return
    this.release(response.requestId, entry)
    if (response.result.ok) entry.resolve(response.result.accessToken)
    else entry.reject(new InsightAccountAccessError(response.result.reason))
  }

  /** Reject one request and optionally tell Main it no longer needs to answer. */
  private settleFailure(requestId: InsightAccountRequestId, reason: InsightAccountAccessFailure, cancel: boolean): void {
    const entry = this.pending.get(requestId)
    if (entry === undefined) return
    this.release(requestId, entry)
    if (cancel) this.send({ kind: 'insight-account-cancel', requestId })
    entry.reject(new InsightAccountAccessError(reason))
  }

  /** Release listener and timer resources before a consumer observes settlement. */
  private release(requestId: InsightAccountRequestId, entry: PendingRequest): void {
    this.pending.delete(requestId)
    this.scheduler.clear(entry.timer)
    if (entry.signal !== undefined && entry.onAbort !== undefined) entry.signal.removeEventListener('abort', entry.onAbort)
  }

  /** Deliver a message without allowing a broken IPC connection to escape as a raw process error. */
  private send(message: InsightAccountHostMessage, onFailure?: () => void): void {
    try {
      this.transport.send(message, (error) => { if (error !== null) onFailure?.() })
    } catch {
      onFailure?.()
    }
  }

  /** Cancel all in-flight calls before context dependencies begin unloading. */
  private close(reason: 'disposed' | 'unavailable'): void {
    if (this.closedReason !== undefined) return
    this.closedReason = reason
    this.stopListening()
    this.stopDisconnect()
    for (const requestId of [...this.pending.keys()]) this.settleFailure(requestId, reason, reason === 'disposed')
  }
}

/** Validate the runtime value as well as the loader schema for programmatic construction. */
function assertTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error('insight-desktop-integration: requestTimeoutMs must be a positive finite number')
  return value
}

/** Bind the private child-process channel and fail during startup outside Desktop Main. */
function processTransport(): InsightAccountTransport {
  if (process.send === undefined || !process.connected) {
    throw new Error('insight-desktop-integration requires a connected Desktop Main IPC channel')
  }
  return {
    send(message, callback) {
      if (!process.connected || process.send === undefined) {
        callback(new Error('Insight Desktop Main IPC channel disconnected'))
        return false
      }
      return process.send(message, callback)
    },
    onMessage(listener) {
      const receive = (message: unknown): void => { listener(message) }
      process.on('message', receive)
      return () => { process.off('message', receive) }
    },
    onDisconnect(listener) {
      process.on('disconnect', listener)
      return () => { process.off('disconnect', listener) }
    },
  }
}

/** Native timer adapter with the service's callback-first argument ordering. */
const nativeScheduler: InsightAccountScheduler = {
  set(delayMs, callback) { return setTimeout(callback, delayMs) },
  clear(handle) { clearTimeout(handle) },
}
