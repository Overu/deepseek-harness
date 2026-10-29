import { describe, expect, it, vi } from 'vitest'
import { AuthApiClient, AuthApiError, type FetchLike } from '../src/desktop/auth-api-client.ts'
import type { AuthEnvironmentConfig } from '../src/desktop/auth-environment.ts'

const environment: AuthEnvironmentConfig = {
  name: 'test',
  baseUrl: 'https://gapi-test.insight-aigc.com',
  partition: 'insight-auth-test',
}

function jsonResponse(payload: object, status = 200): Response {
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' }, status })
}

function requestInit(fetch: ReturnType<typeof vi.fn<FetchLike>>, index: number): RequestInit {
  const call = fetch.mock.calls[index]
  if (!call?.[1]) throw new Error(`Missing request ${index}.`)
  return call[1]
}

function requestJsonBody(fetch: ReturnType<typeof vi.fn<FetchLike>>, index: number): unknown {
  const body = requestInit(fetch, index).body
  if (typeof body !== 'string') throw new Error(`Missing JSON request body ${index}.`)
  const parsed: unknown = JSON.parse(body)
  return parsed
}

describe('Insight auth API client', () => {
  it('retains the desktop headers and the legacy SMS/password request payloads', async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ code: 'SUCCESS', data: {} }))
      .mockResolvedValueOnce(jsonResponse({ code: 'SUCCESS', data: { accessToken: 'sms-token' } }))
      .mockResolvedValueOnce(jsonResponse({ code: 'SUCCESS', body: { accessToken: 'password-token' } }))
    const client = new AuthApiClient(fetch, environment, () => 'stored-token')

    await client.sendSmsCode('13800138000')
    await client.loginSms({ phone: '13800138000', code: '123456' })
    await client.loginPassword({
      phone: '13800138000', password: 'secret123', uuid: 'captcha-uuid', imageCode: 'abcd',
    })

    expect(fetch.mock.calls.map(([input]) => input)).toEqual([
      `${environment.baseUrl}/user-server/mobile/getSmsCode`,
      `${environment.baseUrl}/user-server/loginV3`,
      `${environment.baseUrl}/user-server/loginV3`,
    ])
    expect(requestJsonBody(fetch, 0)).toEqual({
      scene: 'LOGIN', phoneNumber: '13800138000',
    })
    expect(requestJsonBody(fetch, 1)).toEqual({
      type: 'PHONE_NUM', info: { phoneNo: '13800138000', code: '123456' },
    })
    expect(requestJsonBody(fetch, 2)).toEqual({
      type: 'PHONE_PASS',
      info: { phoneNo: '13800138000', password: 'secret123', uuid: 'captcha-uuid', imgCode: 'abcd' },
    })
    const firstRequest = requestInit(fetch, 0)
    const headers = new Headers(firstRequest.headers)
    expect(headers.get('accept-language')).toBe('zh_CN')
    expect(headers.get('extinfo')).toBe(JSON.stringify({ client_type: 'Desktop' }))
    expect(headers.get('token')).toBe('stored-token')
    expect(firstRequest.credentials).toBe('include')
  })

  it('projects a user summary without returning a token or stable account id in it', async () => {
    const client = new AuthApiClient(vi.fn().mockResolvedValue(jsonResponse({
      code: 'SUCCESS',
      data: {
        id: 42,
        userName: 'Alice',
        avatarUrl: 'https://assets.example/a.png',
        phoneNo: '13800138000',
        accessToken: 'must-not-leak',
      },
    })), environment, () => 'stored-token')

    const account = await client.currentUser()
    expect(account).toEqual({
      userId: '42',
      summary: {
        displayName: 'Alice',
        avatarUrl: 'https://assets.example/a.png',
        maskedPhone: '138****8000',
      },
    })
    expect(JSON.stringify(account.summary)).not.toContain('42')
    expect(JSON.stringify(account.summary)).not.toContain('must-not-leak')
  })

  it('preserves a large string account id and rejects an unsafe JSON number instead of rounding it', async () => {
    const exact = '9223372036854775807'
    const stringId = new AuthApiClient(vi.fn().mockResolvedValue(jsonResponse({
      code: 'SUCCESS', data: { id: exact, userName: 'Alice', phoneNo: '13800138000' },
    })), environment, () => 'stored-token')
    const unsafeNumber = new AuthApiClient(vi.fn().mockResolvedValue(new Response(
      '{"code":"SUCCESS","data":{"id":9223372036854775807,"userName":"Alice","phoneNo":"13800138000"}}',
    )), environment, () => 'stored-token')

    await expect(stringId.currentUser()).resolves.toMatchObject({ userId: exact })
    await expect(unsafeNumber.currentUser()).rejects.toMatchObject({
      kind: 'service-error',
    } satisfies Partial<AuthApiError>)
  })

  it('classifies an expired session and avoids diagnostics that contain credential text', async () => {
    const diagnostic = vi.fn()
    const expired = new AuthApiClient(vi.fn().mockResolvedValue(jsonResponse({
      code: 'USER_SESSION_EXPIRED', message: 'expired',
    })), environment, () => 'stored-token')
    const offline = new AuthApiClient(
      vi.fn().mockRejectedValue(new Error('net::ERR_CONNECTION_RESET https://host/?token=secret')),
      environment,
      () => 'stored-token',
      diagnostic,
    )
    await expect(expired.currentUser()).rejects.toMatchObject({ kind: 'expired' } satisfies Partial<AuthApiError>)
    await expect(offline.currentUser()).rejects.toMatchObject({ kind: 'offline' } satisfies Partial<AuthApiError>)
    expect(diagnostic.mock.calls[0]?.[0]).not.toContain('secret')
  })

  it('does not accept a business success envelope from an HTTP error response', async () => {
    const unauthorized = new AuthApiClient(vi.fn().mockResolvedValue(jsonResponse({
      code: 'SUCCESS', data: { id: '42' },
    }, 401)), environment, () => 'stored-token')
    const unavailable = new AuthApiClient(vi.fn().mockResolvedValue(jsonResponse({
      code: 'SUCCESS', data: { id: '42' },
    }, 500)), environment, () => 'stored-token')

    await expect(unauthorized.currentUser()).rejects.toMatchObject({ kind: 'expired' } satisfies Partial<AuthApiError>)
    await expect(unavailable.currentUser()).rejects.toMatchObject({ kind: 'service-error' } satisfies Partial<AuthApiError>)
  })
})
