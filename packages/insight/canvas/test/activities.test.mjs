import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { CanvasActivities } from '../src/host/activities.ts'

function deferred() {
  let resolve
  const promise = new Promise(accept => { resolve = accept })
  return { promise, resolve }
}

test('unload stops tool admission and waits for aborted execution cleanup', async () => {
  const activities = new CanvasActivities(), started = deferred(), finish = deferred()
  let tool, released = false, signal
  const ctx = { tools: { register(definition) { tool = definition; return () => { released = true } } } }
  activities.tool(ctx, { name: 'test', async execute(_input, exec) {
    signal = exec.signal
    started.resolve()
    await finish.promise
    return 'settled'
  } })
  const execution = tool.execute({}, { signal: new AbortController().signal })
  await started.promise
  let closed = false
  const closing = activities.dispose().then(() => { closed = true })
  assert.equal(released, true)
  assert.equal(signal.aborted, true)
  await assert.rejects(tool.execute({}, { signal: new AbortController().signal }), { code: 'CLIENT_UNAVAILABLE' })
  assert.equal(closed, false)
  finish.resolve()
  assert.equal(await execution, 'settled')
  await closing
  assert.equal(closed, true)
  await activities.dispose()
})

test('unload closes streams and waits for active HTTP handler settlement', async () => {
  const activities = new CanvasActivities(), started = deferred(), finish = deferred()
  let route, released = false
  const ctx = { webServer: { register(value) { route = value; return () => { released = true } } } }
  activities.route(ctx, { kind: 'exact', path: '/test', async handler() { started.resolve(); await finish.promise } })
  const request = { destroyed: false, destroy() { this.destroyed = true } }
  const response = Object.assign(new EventEmitter(), { destroyed: false, destroy() { this.destroyed = true; this.emit('close') } })
  const execution = route.handler(request, response)
  await started.promise
  let closed = false
  const closing = activities.dispose().then(() => { closed = true })
  assert.equal(released, true)
  assert.equal(request.destroyed, true)
  assert.equal(response.destroyed, true)
  assert.equal(closed, false)
  const denied = { writeHead(status) { this.status = status }, end() {} }
  route.handler({}, denied)
  assert.equal(denied.status, 503)
  finish.resolve()
  await execution
  await closing
})


test('drain waits for completion work spawned by admitted operations after admission stops', async () => {
  const activities = new CanvasActivities(), first = deferred(), second = deferred()
  const work = activities.track(first.promise.then(async () => {
    await activities.track(second.promise)
  }))
  activities.stop()
  let drained = false
  const closing = activities.drain().then(() => { drained = true })
  first.resolve()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(drained, false)
  second.resolve()
  await Promise.all([work, closing])
  assert.equal(drained, true)
})
