import assert from 'node:assert/strict'
import test from 'node:test'
import { desktopToken } from '../src/host/desktop-token.ts'

test('desktop token aborts pending IPC and removes its listener', async () => {
  const previousSend = process.send
  const previousConnected = process.connected
  const baseline = process.listenerCount('message')
  const requests = []
  process.connected = true
  process.send = request => { requests.push(request) }
  try {
    const controller = new AbortController()
    const pending = desktopToken(controller.signal)
    assert.equal(requests.length, 1)
    assert.equal(process.listenerCount('message'), baseline + 1)
    controller.abort()
    await assert.rejects(pending, { name: 'AbortError' })
    assert.equal(process.listenerCount('message'), baseline)

    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    await assert.rejects(desktopToken(alreadyAborted.signal), { name: 'AbortError' })
    assert.equal(requests.length, 1)
  } finally {
    if (previousSend === undefined) delete process.send
    else process.send = previousSend
    if (previousConnected === undefined) delete process.connected
    else process.connected = previousConnected
  }
})
