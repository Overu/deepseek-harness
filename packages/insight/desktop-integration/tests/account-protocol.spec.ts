import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import {
  INSIGHT_ACCOUNT_ACCESS_TOKEN_MAX_LENGTH,
  insightAccountRequestId,
  parseInsightAccountHostMessage,
  parseInsightAccountMainMessage,
  type InsightAccountRequestId,
} from '../src/shared/account-protocol.ts'

const requestId = 'c254ab28-97c9-4382-95e6-2db9c66f98c8'

describe('Insight account IPC protocol', () => {
  it('parses exactly the declared Host request and cancellation messages', () => {
    expect(parseInsightAccountHostMessage({ kind: 'insight-account-request', requestId, operation: 'access-token' })).toEqual({
      kind: 'insight-account-request', requestId: brandString<InsightAccountRequestId>(requestId), operation: 'access-token',
    })
    expect(parseInsightAccountHostMessage({ kind: 'insight-account-cancel', requestId })).toEqual({
      kind: 'insight-account-cancel', requestId: brandString<InsightAccountRequestId>(requestId),
    })
    expect(parseInsightAccountHostMessage({ kind: 'insight-account-request', requestId, operation: 'access-token', token: 'leak' })).toBeUndefined()
    expect(parseInsightAccountHostMessage({ kind: 'insight-account-request', requestId: 'not-an-id', operation: 'access-token' })).toBeUndefined()
  })

  it('parses only bounded non-diagnostic Main responses', () => {
    expect(parseInsightAccountMainMessage({ kind: 'insight-account-response', requestId, result: { ok: true, accessToken: 'token' } })).toEqual({
      kind: 'insight-account-response', requestId: brandString<InsightAccountRequestId>(requestId), result: { ok: true, accessToken: 'token' },
    })
    expect(parseInsightAccountMainMessage({ kind: 'insight-account-response', requestId, result: { ok: false, reason: 'expired' } })).toEqual({
      kind: 'insight-account-response', requestId: brandString<InsightAccountRequestId>(requestId), result: { ok: false, reason: 'expired' },
    })
    expect(parseInsightAccountMainMessage({ kind: 'insight-account-response', requestId, result: { ok: false, reason: 'failed', diagnostic: 'https://service/?token=leak' } })).toBeUndefined()
    expect(parseInsightAccountMainMessage({ kind: 'insight-account-response', requestId, result: { ok: true, accessToken: 'x'.repeat(INSIGHT_ACCOUNT_ACCESS_TOKEN_MAX_LENGTH + 1) } })).toBeUndefined()
    expect(parseInsightAccountMainMessage({ kind: 'insight-account-response', requestId, result: { ok: false, reason: 'network' } })).toBeUndefined()
    expect(parseInsightAccountMainMessage(null)).toBeUndefined()
  })

  it('brands only valid UUID request identifiers', () => {
    expect(insightAccountRequestId(requestId)).toBe(requestId)
    expect(insightAccountRequestId('C254AB28-97C9-4382-95E6-2DB9C66F98C8')).toBe('C254AB28-97C9-4382-95E6-2DB9C66F98C8')
    expect(insightAccountRequestId('c254ab28-97c9-0382-95e6-2db9c66f98c8')).toBeUndefined()
  })
})
