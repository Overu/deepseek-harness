import assert from 'node:assert/strict'
import test from 'node:test'
import { installCanvasRuntime } from '../src/client/canvas-service.ts'

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const target = () => ({ location: { origin: 'http://127.0.0.1:3000' } })
const runtime = () => {
  let disposed = 0
  return { execute() {}, registerView() { return () => {} }, attachView() {}, detachView() {}, ensureContext() {}, getContextInfo() {}, subscribeReadiness() {}, subscribeRun() {}, reloadContext() {}, closeContext() {}, dispose() { disposed++ }, get disposed() { return disposed } }
}

test('Client installs one lazy handle and loads the fixed same-origin service URL once', async () => {
  const host = target(); const service = runtime(); let loads = 0; let factories = 0
  const stop = installCanvasRuntime(host, async url => {
    const parsed = new URL(url)
    assert.equal(parsed.origin, 'http://127.0.0.1:3000'); assert.equal(parsed.pathname, '/desktop-canvas/canvas-service.js'); assert.ok(parsed.searchParams.get('runtime')); loads++
    return { createCanvasServiceRuntime() { factories++; return service } }
  })
  assert.equal(loads, 0)
  const a = host.__INSIGHT_CANVAS_RUNTIME_V1__.ready; const b = host.__INSIGHT_CANVAS_RUNTIME_V1__.ready
  assert.equal(a, b); assert.equal(await a, service); assert.equal(loads, 1); assert.equal(factories, 1)
  stop(); stop(); assert.equal(service.disposed, 1); assert.equal(host.__INSIGHT_CANVAS_RUNTIME_V1__, undefined)
})

test('disposal before any request does not import or create a runtime', async () => {
  const host = target(); let loads = 0
  const stop = installCanvasRuntime(host, async () => { loads++; throw new Error('must not load') })
  const handle = host.__INSIGHT_CANVAS_RUNTIME_V1__; stop()
  await assert.rejects(handle.ready, { code: 'CLIENT_UNAVAILABLE' }); assert.equal(loads, 0)
})

test('a late import after Client disposal cannot create or install a runtime', async () => {
  const host = target(); const gate = deferred(); let factories = 0
  const stop = installCanvasRuntime(host, () => gate.promise)
  const waiting = host.__INSIGHT_CANVAS_RUNTIME_V1__.ready; await Promise.resolve(); stop()
  const rejected = assert.rejects(waiting, { code: 'CLIENT_UNAVAILABLE' })
  await rejected
  gate.resolve({ createCanvasServiceRuntime() { factories++; return runtime() } })
  await Promise.resolve(); await Promise.resolve(); assert.equal(factories, 0); assert.equal(host.__INSIGHT_CANVAS_RUNTIME_V1__, undefined)
})

test('a later request recovers a failed import with a fresh URL, without retrying within a request', async () => {
  const host = target(); const urls = []; const service = runtime()
  const stop = installCanvasRuntime(host, async url => { urls.push(url); if (urls.length === 1) throw new Error('asset unavailable'); return { createCanvasServiceRuntime: () => service } })
  const handle = host.__INSIGHT_CANVAS_RUNTIME_V1__
  await assert.rejects(handle.ready, { code: 'CLIENT_UNAVAILABLE' })
  assert.equal(urls.length, 1)
  const next = handle.ready
  assert.equal(next, handle.ready)
  assert.equal(await next, service)
  assert.equal(await handle.ready, service)
  assert.equal(urls.length, 2); assert.notEqual(urls[0], urls[1])
  stop()
})

test('duplicate installation cannot overwrite another owner; stale cleanup cannot remove a replacement', async () => {
  const host = target(); const stop = installCanvasRuntime(host, async () => ({ createCanvasServiceRuntime: runtime }))
  const original = host.__INSIGHT_CANVAS_RUNTIME_V1__
  assert.throws(() => installCanvasRuntime(host), { code: 'CLIENT_AMBIGUOUS' }); assert.equal(host.__INSIGHT_CANVAS_RUNTIME_V1__, original)
  const replacement = { ready: Promise.resolve(runtime()) }
  Object.defineProperty(host, '__INSIGHT_CANVAS_RUNTIME_V1__', { value: replacement, configurable: true })
  stop(); assert.equal(host.__INSIGHT_CANVAS_RUNTIME_V1__, replacement)
})

test('a malformed module is rejected instead of exposing a partial or fake ready service', async () => {
  for (const module of [{}, { createCanvasServiceRuntime: () => ({}) }]) {
    const host = target(); const stop = installCanvasRuntime(host, async () => module)
    await assert.rejects(host.__INSIGHT_CANVAS_RUNTIME_V1__.ready, { code: 'CLIENT_UNAVAILABLE' }); stop()
  }
})

test('reinstalling in the same window uses a fresh ESM URL while keeping the fixed service path', async () => {
  const host = target(); const urls = []
  const load = async url => { urls.push(url); return { createCanvasServiceRuntime: runtime } }
  const a = installCanvasRuntime(host, load); await host.__INSIGHT_CANVAS_RUNTIME_V1__.ready; a()
  const b = installCanvasRuntime(host, load); await host.__INSIGHT_CANVAS_RUNTIME_V1__.ready; b()
  assert.notEqual(urls[0], urls[1]); assert.equal(new URL(urls[0]).pathname, new URL(urls[1]).pathname)
})

test('partial view registration failure rolls back the loaded service immediately', async () => {
  const host = target(), service = runtime()
  let registrations = 0, releases = 0
  service.registerView = () => { if (++registrations === 2) throw new Error('view changed'); return () => { releases++ } }
  const stop = installCanvasRuntime(host, async () => ({ createCanvasServiceRuntime: () => service }))
  const handle = host.__INSIGHT_CANVAS_RUNTIME_V1__
  handle.registerView({ viewId: 'first', canvasId: '2873', frame: {} })
  handle.registerView({ viewId: 'second', canvasId: '2874', frame: {} })
  await assert.rejects(handle.ready, { code: 'CLIENT_UNAVAILABLE' })
  assert.equal(releases, 1)
  assert.equal(service.disposed, 1)
  stop()
  assert.equal(releases, 1)
  assert.equal(service.disposed, 1)
})
