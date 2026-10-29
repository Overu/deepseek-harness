import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import test from 'node:test'
import { gatewayHandler } from '../src/host/gateway-route.ts'
import { LoginRequiredError } from '../src/host/desktop-token.ts'

const prefix = '/desktop-canvas/api/legacy'

function request(method, url, body = '', headers = {}) {
  return Object.assign(Readable.from(body ? [body] : []), { method, url, headers })
}

function response() {
  return Object.assign(new EventEmitter(), {
    status: undefined,
    headers: undefined,
    body: undefined,
    destroyed: false,
    writableEnded: false,
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = body; this.writableEnded = true }
  })
}

function text(res) {
  return Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.body)
}

test('gateway authenticates before reading a request or obtaining credentials', async () => {
  let read = false
  let token = false
  let upstream = false
  const req = request('POST', `${prefix}/game-ai-editor-center/api/canvas/get`, '', { 'content-type': 'application/json' })
  req[Symbol.asyncIterator] = async function* () { read = true; yield '{}' }
  const res = response()
  await gatewayHandler(
    { requestRejection: () => 401 },
    async () => { token = true; return 'token' },
    async () => { upstream = true; return new Response('{}') }
  )(req, res)
  assert.equal(res.status, 401)
  assert.equal(read, false)
  assert.equal(token, false)
  assert.equal(upstream, false)
})

test('gateway rejects unsupported methods and unsafe paths before obtaining a token', async () => {
  let token = false
  const handler = gatewayHandler(
    { requestRejection: () => undefined },
    async () => { token = true; return 'token' },
    async () => { throw new Error('unexpected upstream request') }
  )
  for (const [method, url, headers, status] of [
    ['DELETE', `${prefix}/game-ai-editor-center/api/canvas/get`, {}, 405],
    ['POST', `${prefix}/user-server/deregister`, {}, 404],
    ['GET', `${prefix}/user-server/getUserDetail`, {}, 404],
    ['POST', `${prefix}/game-ai-editor-center/api/canvas/%2Fdelete`, {}, 404],
    ['POST', `${prefix}/game-ai-editor-center/api/canvas/../canvas/get`, {}, 404],
    ['POST', `${prefix}/game-ai-editor-center/api/canvas/%2e%2e/canvas/get`, {}, 404],
    ['POST', `${prefix}/game-ai-editor-center/api/canvas/get?token=forged`, {}, 400],
    ['POST', `${prefix}/game-ai-editor-center/api/canvas/get`, { 'content-type': 'text/plain' }, 415],
    ['POST', `${prefix}/game-ai-editor-center/api/canvas/get`, { 'content-length': '20000001' }, 413]
  ]) {
    const res = response()
    await handler(request(method, url, '{}', headers), res)
    assert.equal(res.status, status, url)
  }
  assert.equal(token, false)
})

test('gateway forwards exact JSON and query with the current desktop Token', async () => {
  const calls = []
  const raw = JSON.stringify({ code: 'SUCCESS', data: { data: JSON.stringify({ nodes: [], edges: [] }) } })
  const handler = gatewayHandler(
    { requestRejection: () => undefined },
    async () => 'current-token',
    async (url, init) => {
      calls.push({ url, init })
      return new Response(raw, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } })
    }
  )
  const res = response()
  const body = '{"id":"2873"}'
  await handler(request('POST', `${prefix}/game-ai-editor-center/api/canvas/get?source=desktop`, body,
    { 'content-type': 'application/json', token: 'forged' }), res)
  assert.equal(res.status, 200)
  assert.equal(text(res), raw)
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://gapi-test.insight-aigc.com/game-ai-editor-center/api/canvas/get?source=desktop')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.token, 'current-token')
  assert.equal(calls[0].init.headers.origin, 'https://dynsight-test.insight-aigc.com')
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(calls[0].init.body.toString('utf8'), body)
})

test('gateway forwards canvas business APIs without per-endpoint registration', async () => {
  const calls = []
  let tokenLookups = 0
  const raw = '{"code":"SUCCESS","data":{"dataList":[],"total":0}}'
  const handler = gatewayHandler(
    { requestRejection: () => undefined },
    async () => { tokenLookups += 1; return 'current-token' },
    async (url, init) => {
      calls.push({ url, init })
      return new Response(raw, { status: 200, headers: { 'content-type': 'application/json' } })
    }
  )
  const listBody = JSON.stringify({ type: 1, pageSize: 15, pageIndex: 1, isPublic: 0, isDesc: 1 })
  for (const [method, path, body] of [
    ['GET', '/material-server/asset/getLabelTree', ''],
    ['POST', '/material-server/asset/aggregateQuery', listBody],
    ['POST', '/material-server/asset/deleteAsset', '{}'],
    ['POST', '/game-ai-editor-center/workflow-tool/getImgPose', '{}'],
    ['POST', '/order-server/api/cost/externalTask', '{}'],
    ['POST', '/account-service/api/account/balance', '{}'],
    ['POST', '/game-ai-editor-center/api/canvas/share', '{"canvasId":"2873","canvasData":"{}","canvasName":"测试画布","thumbnailUrl":""}'],
    ['PUT', '/game-ai-editor-center/api/editor', '{}']
  ]) {
    const res = response()
    await handler(request(method, `${prefix}${path}`, body), res)
    assert.equal(res.status, 200, `${method} ${path}`)
    assert.equal(text(res), raw)
  }
  assert.deepEqual(calls.map(call => call.url), [
    'https://gapi-test.insight-aigc.com/material-server/asset/getLabelTree',
    'https://gapi-test.insight-aigc.com/material-server/asset/aggregateQuery',
    'https://gapi-test.insight-aigc.com/material-server/asset/deleteAsset',
    'https://gapi-test.insight-aigc.com/game-ai-editor-center/workflow-tool/getImgPose',
    'https://gapi-test.insight-aigc.com/order-server/api/cost/externalTask',
    'https://gapi-test.insight-aigc.com/account-service/api/account/balance',
    'https://gapi-test.insight-aigc.com/game-ai-editor-center/api/canvas/share',
    'https://gapi-test.insight-aigc.com/game-ai-editor-center/api/editor'
  ])
  assert.deepEqual(calls.map(call => call.init.method), ['GET', 'POST', 'POST', 'POST', 'POST', 'POST', 'POST', 'PUT'])
  assert.equal(calls[1].init.body.toString('utf8'), listBody)
  assert.match(calls[6].init.body.toString('utf8'), /"canvasId":"2873"/)
  assert.ok(calls.every(call => call.init.headers.token === 'current-token'))
  assert.equal(tokenLookups, 8)
})

test('gateway uses the fixed production host and preserves a JSON conflict response', async () => {
  const previous = process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT
  process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT = 'production'
  const calls = []
  try {
    const raw = '{"code":"VERSION_CONFLICT","msg":"版本冲突"}'
    const handler = gatewayHandler(
      { requestRejection: () => undefined },
      async () => 'current-token',
      async (url, init) => {
        calls.push({ url, init })
        return new Response(raw, { status: 409, headers: { 'content-type': 'application/json' } })
      }
    )
    const res = response()
    await handler(request('POST', `${prefix}/game-ai-editor-center/api/canvas/saveOrUpdate`, '{}'), res)
    assert.equal(res.status, 409)
    assert.equal(text(res), raw)
    assert.equal(calls[0].url, 'https://gapi.insight-aigc.com/game-ai-editor-center/api/canvas/saveOrUpdate')
    assert.equal(calls[0].init.headers.origin, 'https://dynsight.insight-aigc.com')
  } finally {
    if (previous === undefined) delete process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT
    else process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT = previous
  }
})

test('gateway maps missing desktop login, timeout and non-JSON upstream errors', async () => {
  const url = `${prefix}/game-ai-editor-center/api/canvas/get`
  let upstream = false
  const missing = response()
  await gatewayHandler(
    { requestRejection: () => undefined },
    async () => { throw new LoginRequiredError('login required') },
    async () => { upstream = true; return new Response('{}') }
  )(request('POST', url), missing)
  assert.equal(missing.status, 401)
  assert.equal(upstream, false)

  const timedOut = response()
  await gatewayHandler(
    { requestRejection: () => undefined },
    async () => 'token',
    async () => { throw new DOMException('timed out', 'TimeoutError') }
  )(request('POST', url), timedOut)
  assert.equal(timedOut.status, 504)

  const nonJson = response()
  await gatewayHandler(
    { requestRejection: () => undefined },
    async () => 'token',
    async () => new Response('<html>upstream error</html>', { status: 403, headers: { 'content-type': 'text/html' } })
  )(request('POST', url), nonJson)
  assert.equal(nonJson.status, 403)
  assert.doesNotMatch(text(nonJson), /upstream error/)
})

test('gateway rejects an oversized upstream response before reading its body', async () => {
  const res = response()
  await gatewayHandler(
    { requestRejection: () => undefined },
    async () => 'token',
    async () => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': '30000001' }
    })
  )(request('POST', `${prefix}/game-ai-editor-center/api/canvas/get`), res)
  assert.equal(res.status, 502)
  assert.match(text(res), /响应过大/)
})

test('gateway aborts the upstream request when the browser closes', async () => {
  const res = response()
  let signal
  const pending = gatewayHandler(
    { requestRejection: () => undefined },
    async () => 'token',
    async (_url, init) => {
      signal = init.signal
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      throw new Error('unreachable')
    }
  )(request('POST', `${prefix}/game-ai-editor-center/api/canvas/get`), res)
  await new Promise(resolve => setImmediate(resolve))
  res.emit('close')
  await pending
  assert.equal(signal.aborted, true)
  assert.equal(res.status, undefined)
})

test('manual upload resolves each desktop account and replaces iframe user IDs without losing Long precision', async () => {
  const calls = []
  let tokenLookups = 0
  const ids = { 'account-1': '9223372036854775807', 'account-2': '104' }
  const handler = gatewayHandler(
    { requestRejection: () => undefined },
    async () => `account-${++tokenLookups}`,
    async (url, init) => {
      calls.push({ url, init })
      const id = ids[init.headers.token]
      return new Response(url.endsWith('/getUserDetail')
        ? `{"code":0,"data":{"id":${id}}}`
        : `{"code":"SUCCESS","data":{"userId":${id},"securityToken":"sts-${id}"}}`)
    }
  )
  for (let i = 1; i <= 2; i++) {
    const res = response()
    const params = { fileName: 'voice.wav', libraryId: '1001', type: 1, ...(i === 1 ? { userId: 999 } : {}) }
    await handler(request('POST', `${prefix}/game-ai-editor-center/upload/sts/token`, JSON.stringify(params)), res)
    assert.equal(res.status, 200)
    const result = JSON.parse(text(res))
    assert.equal(String(result.data.userId), ids[`account-${i}`])
    assert.equal(result.data.securityToken, `sts-${ids[`account-${i}`]}`)
  }
  assert.equal(tokenLookups, 2)
  assert.equal(calls.length, 4)
  for (const [index, token] of [[0, 'account-1'], [2, 'account-2']]) {
    assert.equal(calls[index].url, 'https://gapi-test.insight-aigc.com/user-server/getUserDetail')
    assert.equal(calls[index].init.method, 'GET')
    assert.equal(calls[index + 1].url, 'https://gapi-test.insight-aigc.com/game-ai-editor-center/upload/sts/token')
    assert.equal(calls[index].init.headers.token, token)
    assert.equal(calls[index + 1].init.headers.token, token)
    assert.equal(calls[index + 1].init.body, `{"fileName":"voice.wav","libraryId":"1001","type":1,"userId":${ids[token]}}`)
  }
})

test('manual upload rejects malformed payloads and alternative methods before resolving identity', async () => {
  let tokens = 0
  const handler = gatewayHandler({ requestRejection: () => undefined }, async () => { tokens++; return 'token' },
    async () => { throw new Error('unexpected request') })
  for (const [method, query, body, status] of [
    ['GET', '', '', 405], ['PUT', '', '{}', 405], ['POST', '?userId=999', '{}', 400],
    ...['{', 'null', '[]', '{}', '{"fileName":"","libraryId":"1001","type":1}',
      '{"fileName":"voice.wav","libraryId":"9999","type":1}'].map(body => ['POST', '', body, 400])
  ]) {
    const res = response()
    await handler(request(method, `${prefix}/game-ai-editor-center/upload/sts/token${query}`, body), res)
    assert.equal(res.status, status)
  }
  assert.equal(tokens, 0)
})

test('manual upload rejects missing login, identity failure and foreign STS credentials without leaking secrets', async () => {
  const payload = JSON.stringify({ fileName: 'voice.wav', libraryId: '1001', type: 1 })
  for (const scenario of ['missing-token', 'expired-identity', 'invalid-identity', 'foreign-sts', 'expired-sts']) {
    let calls = 0
    const res = response()
    const handler = gatewayHandler({ requestRejection: () => undefined }, async () => {
      if (scenario === 'missing-token') throw new LoginRequiredError('private-token')
      return 'private-token'
    }, async url => {
      calls++
      if (url.endsWith('/getUserDetail')) {
        if (scenario === 'expired-identity') return new Response('private-token', { status: 401 })
        return Response.json({ code: 0, data: { id: scenario === 'invalid-identity' ? null : 103 } })
      }
      if (scenario === 'expired-sts') return Response.json({ code: 'USER_SESSION_EXPIRED', msg: 'private-token' })
      return Response.json({ code: 'SUCCESS', data: { userId: 999, accessKeySecret: 'private-secret' } })
    })
    await handler(request('POST', `${prefix}/game-ai-editor-center/upload/sts/token`, payload), res)
    assert.equal(res.status, scenario === 'foreign-sts' ? 502 : 401, scenario)
    assert.equal(calls, scenario === 'missing-token' ? 0 : ['foreign-sts', 'expired-sts'].includes(scenario) ? 2 : 1)
    assert.doesNotMatch(text(res), /private-/)
  }
})
