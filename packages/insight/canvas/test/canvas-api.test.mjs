import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmptyCanvas } from '../src/host/canvas-api.ts'

const controller = () => new AbortController()
const envelope = data => new Response(JSON.stringify({ code: 'SUCCESS', data }))
function fixture(response = () => envelope({ id: '103136', versionNumber: 0 })) {
  const calls = []
  const dependencies = { tokenProvider: async () => 'private-token', transport: async (url, init) => {
    calls.push({ url, init }); return response()
  } }
  return { calls, dependencies }
}
test('create uses the existing empty canvas payload, fixed environment and current desktop identity', async () => {
  const previous = process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT
  try {
    for (const [environment, domain] of [['test', '-test'], ['production', '']]) {
      process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT = environment
      const f = fixture()
      assert.deepEqual(await createEmptyCanvas('  产品项目  ', controller().signal, f.dependencies), { canvasId: '103136', name: '产品项目', version: '0' })
      assert.equal(f.calls.length, 1)
      const { url, init } = f.calls[0]
      assert.equal(url, `https://gapi${domain}.insight-aigc.com/game-ai-editor-center/api/canvas/saveOrUpdate`)
      assert.equal(init.headers.origin, `https://dynsight${domain}.insight-aigc.com`)
      assert.equal(init.headers.token, 'private-token'); assert.equal(init.redirect, 'error')
      assert.deepEqual(JSON.parse(init.body), { name: '产品项目', temp: false, canvasType: 0, version: 'comfyui', data: '{"nodes":[],"edges":[]}' })
    }
  } finally {
    if (previous === undefined) delete process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT
    else process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT = previous
  }
})
test('create preserves exact Long strings, scalar IDs and optional versions', async () => {
  for (const [data, id, version] of [
    ['9223372036854775807', '9223372036854775807', null],
    [103136, '103136', null],
    [{ id: '103136', versionNumber: '5' }, '103136', '5'],
    [{ id: '103136', versionNumber: null }, '103136', null],
  ]) {
    const f = fixture(() => envelope(data))
    assert.deepEqual(await createEmptyCanvas('测试', undefined, f.dependencies), { canvasId: id, name: '测试', version })
  }
})
test('create refuses invalid names before any credential lookup or request', async () => {
  for (const name of ['', '  ', 'a'.repeat(101)]) {
    const f = fixture()
    await assert.rejects(createEmptyCanvas(name, undefined, f.dependencies), { code: 'INVALID_ARGUMENT', requestPhase: 'not_sent' })
    assert.equal(f.calls.length, 0)
  }
})
test('cancellation and login failure before send cannot create a canvas or expose credential error text', async () => {
  const f = fixture(); const c = controller(); c.abort()
  await assert.rejects(createEmptyCanvas('测试', c.signal, f.dependencies), { requestPhase: 'not_sent' }); assert.equal(f.calls.length, 0)
  const during = controller()
  await assert.rejects(createEmptyCanvas('测试', during.signal, { ...f.dependencies, tokenProvider: async () => { during.abort(); return 'private-token' } }), { requestPhase: 'not_sent' })
  await assert.rejects(createEmptyCanvas('测试', undefined, { ...f.dependencies, tokenProvider: async () => { throw new Error('private-token') } }), error => error.requestPhase === 'not_sent' && !error.message.includes('private-token'))
  assert.equal(f.calls.length, 0)
})
test('unsafe or missing creation IDs and malformed successful envelopes are unknown, with no retry', async () => {
  for (const response of [
    () => envelope(Number.MAX_SAFE_INTEGER + 1), () => envelope({ id: 0 }), () => envelope(null),
    () => envelope({ id: '9223372036854775808' }), () => new Response('{'), () => new Response('{}'),
  ]) {
    const f = fixture(response)
    await assert.rejects(createEmptyCanvas('测试', undefined, f.dependencies), { code: 'SUBMISSION_UNKNOWN', requestPhase: 'submission_unknown' })
    assert.equal(f.calls.length, 1)
  }
})
test('creation transport loss and 5xx are unknown; explicit HTTP or business denials reject without retry', async () => {
  for (const response of [() => { throw new Error('private-token') }, () => new Response('server', { status: 502 }), () => new Response('', { status: 408 })]) {
    const f = fixture(response)
    await assert.rejects(createEmptyCanvas('测试', undefined, f.dependencies), error => error.requestPhase === 'submission_unknown' && !error.message.includes('private-token'))
    assert.equal(f.calls.length, 1)
  }
  for (const [response, code] of [
    [() => new Response('', { status: 401 }), 'AUTH_REQUIRED'],
    [() => new Response(JSON.stringify({ code: 'USER_SESSION_EXPIRED' })), 'AUTH_REQUIRED'],
    [() => new Response(JSON.stringify({ code: -1 })), 'AUTH_REQUIRED'],
    [() => new Response('', { status: 422 }), 'SAVE_REJECTED'],
    [() => new Response(JSON.stringify({ code: 'ERROR', msg: 'private-token' })), 'SAVE_REJECTED'],
  ]) {
    const f = fixture(response)
    await assert.rejects(createEmptyCanvas('测试', undefined, f.dependencies), error => error.code === code && error.requestPhase === 'rejected' && !error.message.includes('private-token'))
    assert.equal(f.calls.length, 1)
  }
})
