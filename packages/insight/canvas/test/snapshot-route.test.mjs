import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { snapshotHandler } from '../src/host/snapshot-route.ts'

function response() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    status: undefined,
    body: undefined,
    destroyed: false,
    writeHead(status) { this.status = status },
    end(body) { this.body = body }
  })
}

test('snapshot route checks browser session before fetching remote canvas', async () => {
  let called = false
  const handler = snapshotHandler({ requestRejection: () => 401 }, async () => { called = true })
  const res = response()
  await handler({ method: 'GET', url: '/desktop-canvas/api/snapshot?id=2873' }, res)
  assert.equal(res.status, 401)
  assert.equal(called, false)
})

test('snapshot route validates ID and returns only adapter data', async () => {
  const handler = snapshotHandler({ requestRejection: () => undefined }, async id => ({ canvasId: id, name: 'A', nodeCount: 0, nodes: [] }))
  const bad = response()
  await handler({ method: 'GET', url: '/desktop-canvas/api/snapshot?id=0' }, bad)
  assert.equal(bad.status, 400)
  const valid = response()
  await handler({ method: 'GET', url: '/desktop-canvas/api/snapshot?id=2873' }, valid)
  assert.equal(valid.status, 200)
  assert.deepEqual(JSON.parse(valid.body), { canvasId: '2873', name: 'A', nodeCount: 0, nodes: [] })
})
