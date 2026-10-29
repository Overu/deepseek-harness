import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { AuthExpiredError, request } from '../canvas-app/src/request.ts'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test('canvas request keeps the full response and sends no iframe token', async () => {
  let call
  globalThis.fetch = async (url, options) => {
    call = { url, options }
    return new Response(JSON.stringify({ code: 'SUCCESS', data: { id: '2873', data: '{"nodes":[]}' } }), {
      headers: { 'content-type': 'application/json' },
    })
  }
  const result = await request('game-ai-editor-center/api/canvas/get', { id: '2873' }, {
    headers: { token: 'iframe-token' },
  })
  assert.equal(call.url, '/desktop-canvas/api/legacy/game-ai-editor-center/api/canvas/get')
  assert.equal(call.options.method, 'POST')
  assert.equal(call.options.credentials, 'same-origin')
  assert.equal(new Headers(call.options.headers).has('token'), false)
  assert.deepEqual(JSON.parse(call.options.body), { id: '2873' })
  assert.equal(result.data.data, '{"nodes":[]}')
})

test('canvas request forwards the legacy editor PUT as JSON through the desktop gateway', async () => {
  let call
  globalThis.fetch = async (url, options) => {
    call = { url, options }
    return new Response(JSON.stringify({ code: 'SUCCESS', data: { id: 'editor-1' } }), {
      headers: { 'content-type': 'application/json' },
    })
  }
  await request('game-ai-editor-center/api/editor', { id: 'editor-1' }, { method: 'PUT' })
  assert.equal(call.url, '/desktop-canvas/api/legacy/game-ai-editor-center/api/editor')
  assert.equal(call.options.method, 'PUT')
  assert.deepEqual(JSON.parse(call.options.body), { id: 'editor-1' })
})

test('canvas request preserves business conflict response for the legacy save queue', async () => {
  const conflict = { code: 'VERSION_CONFLICT', msg: 'version changed', data: { versionNumber: 4 } }
  globalThis.fetch = async () => new Response(JSON.stringify(conflict), {
    headers: { 'content-type': 'application/json' },
  })
  await assert.rejects(request('game-ai-editor-center/api/canvas/partialUpdate', { id: '2873' }, {
    silentError: true,
  }), error => { assert.deepEqual(error, conflict); return true })
})

test('canvas request exposes an HTTP 409 business code to the legacy mutation queue', async () => {
  const conflict = { code: 5011, msg: 'version changed', data: { versionNumber: 4 } }
  globalThis.fetch = async () => new Response(JSON.stringify(conflict), {
    status: 409,
    headers: { 'content-type': 'application/json' },
  })
  await assert.rejects(request('game-ai-editor-center/api/canvas/partialUpdate', { id: '2873' }), error => {
    assert.equal(error.status, 409)
    assert.equal(error.code, 5011)
    assert.deepEqual(error.raw, conflict)
    return true
  })
})

test('canvas request reports expired desktop login and rejects direct remote URL', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'login required' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
  await assert.rejects(request('game-ai-editor-center/api/canvas/get', { id: '2873' }), AuthExpiredError)
  await assert.rejects(request('https://gapi.insight-aigc.com/game-ai-editor-center/api/canvas/get', {}),
    /必须经桌面客户端转发/u)
})

test('canvas request treats a successful HTTP response with expired business session as logged out', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'USER_SESSION_EXPIRED', msg: 'expired' }), {
    headers: { 'content-type': 'application/json' },
  })
  await assert.rejects(request('game-ai-editor-center/api/canvas/get', { id: '2873' }), AuthExpiredError)
})

test('canvas get rejects a null canvas before the legacy route can navigate away', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'SUCCESS', data: null }), {
    headers: { 'content-type': 'application/json' },
  })
  await assert.rejects(request('game-ai-editor-center/api/canvas/get', { id: '2873' }),
    /画布不存在或无访问权限/u)
})
