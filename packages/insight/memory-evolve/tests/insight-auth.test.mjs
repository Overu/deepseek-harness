import assert from 'node:assert/strict'
import test from 'node:test'
import { authorizeMemoryRequest } from '../src/host/insight-auth.js'

function response() {
  return {
    status: undefined,
    ended: false,
    writeHead(status) { this.status = status },
    end() { this.ended = true },
  }
}

test('allows a request accepted by the DSH connection service', () => {
  const res = response()
  const allowed = authorizeMemoryRequest({ get: () => ({ requestRejection: () => undefined }) }, {}, res)
  assert.equal(allowed, true)
  assert.equal(res.status, undefined)
  assert.equal(res.ended, false)
})

test('writes the connection rejection before ending the response', () => {
  const res = response()
  const allowed = authorizeMemoryRequest({ get: () => ({ requestRejection: () => 403 }) }, {}, res)
  assert.equal(allowed, false)
  assert.equal(res.status, 403)
  assert.equal(res.ended, true)
})

test('rejects when the connection service is unavailable', () => {
  const res = response()
  const allowed = authorizeMemoryRequest({ get: () => undefined }, {}, res)
  assert.equal(allowed, false)
  assert.equal(res.status, 401)
  assert.equal(res.ended, true)
})
