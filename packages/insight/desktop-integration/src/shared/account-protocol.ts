/** Private account-token IPC messages between the Insight Host and Desktop Main. */
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Maximum concurrent Host credential requests accepted by either IPC peer. */
export const INSIGHT_ACCOUNT_MAX_PENDING_REQUESTS = 16
/** Maximum serialized request identifier length. */
export const INSIGHT_ACCOUNT_REQUEST_ID_MAX_LENGTH = 64
/** Maximum access-token length accepted from Desktop Main. */
export const INSIGHT_ACCOUNT_ACCESS_TOKEN_MAX_LENGTH = 16 * 1024

/** Opaque identifier for one account-token request. */
export type InsightAccountRequestId = Branded<'InsightAccountRequestId'>

/** Host request for the account access token held by Desktop Main. */
export interface InsightAccountRequest {
  readonly kind: 'insight-account-request'
  readonly requestId: InsightAccountRequestId
  readonly operation: 'access-token'
}

/** Host withdrawal of a request which can no longer use a response. */
export interface InsightAccountCancel {
  readonly kind: 'insight-account-cancel'
  readonly requestId: InsightAccountRequestId
}

/** One access-token request outcome supplied by Desktop Main. */
export type InsightAccountResult =
  | { readonly ok: true; readonly accessToken: string }
  | { readonly ok: false; readonly reason: 'unavailable' | 'expired' | 'cancelled' | 'failed' }

/** Desktop Main response for one Host request. */
export interface InsightAccountResponse {
  readonly kind: 'insight-account-response'
  readonly requestId: InsightAccountRequestId
  readonly result: InsightAccountResult
}

/** Messages Desktop Main accepts from the Host process. */
export type InsightAccountHostMessage = InsightAccountRequest | InsightAccountCancel

/**
 * Create a validated opaque request identifier.
 * @param value - UUID text received from a trusted local producer.
 * @returns the branded identifier, or undefined when the text is not a permitted UUID.
 */
export function insightAccountRequestId(value: string): InsightAccountRequestId | undefined {
  return isInsightAccountRequestId(value) ? brandString<InsightAccountRequestId>(value) : undefined
}

/**
 * Check the identifier format before branding a value received over IPC.
 * @param value - UUID text from an IPC message.
 * @returns whether the value may be used as an Insight account request identifier.
 */
export function isInsightAccountRequestId(value: string): value is InsightAccountRequestId {
  return value.length <= INSIGHT_ACCOUNT_REQUEST_ID_MAX_LENGTH
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}

/**
 * Parse a strictly shaped Host-to-Main message at the IPC boundary.
 * @param value - Untrusted child-process IPC value.
 * @returns the accepted message, or undefined when fields or values do not match the private protocol.
 */
export function parseInsightAccountHostMessage(value: unknown): InsightAccountHostMessage | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string') return undefined
  const requestId = typeof value.requestId === 'string' ? insightAccountRequestId(value.requestId) : undefined
  if (requestId === undefined) return undefined
  if (value.kind === 'insight-account-request') {
    return hasOnlyKeys(value, ['kind', 'requestId', 'operation']) && value.operation === 'access-token'
      ? { kind: 'insight-account-request', requestId, operation: 'access-token' }
      : undefined
  }
  return value.kind === 'insight-account-cancel' && hasOnlyKeys(value, ['kind', 'requestId'])
    ? { kind: 'insight-account-cancel', requestId }
    : undefined
}

/**
 * Parse a strictly shaped Main-to-Host response at the IPC boundary.
 * @param value - Untrusted Desktop Main IPC value.
 * @returns the accepted response, or undefined when fields or values do not match the private protocol.
 */
export function parseInsightAccountMainMessage(value: unknown): InsightAccountResponse | undefined {
  if (!isRecord(value) || value.kind !== 'insight-account-response' || !hasOnlyKeys(value, ['kind', 'requestId', 'result'])) return undefined
  const requestId = typeof value.requestId === 'string' ? insightAccountRequestId(value.requestId) : undefined
  const result = parseResult(value.result)
  return requestId === undefined || result === undefined ? undefined : { kind: 'insight-account-response', requestId, result }
}

/** Validate the explicitly non-diagnostic result vocabulary. */
function parseResult(value: unknown): InsightAccountResult | undefined {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return undefined
  if (value.ok) {
    return hasOnlyKeys(value, ['ok', 'accessToken'])
      && typeof value.accessToken === 'string'
      && value.accessToken.length > 0
      && value.accessToken.length <= INSIGHT_ACCOUNT_ACCESS_TOKEN_MAX_LENGTH
      ? { ok: true, accessToken: value.accessToken }
      : undefined
  }
  return hasOnlyKeys(value, ['ok', 'reason'])
    && (value.reason === 'unavailable' || value.reason === 'expired' || value.reason === 'cancelled' || value.reason === 'failed')
    ? { ok: false, reason: value.reason }
    : undefined
}

/** Identify an object whose fields can be checked without inheriting IPC data. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require exactly the protocol's declared fields. */
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every(key => keys.includes(key))
}
