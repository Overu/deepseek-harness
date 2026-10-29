import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { bridgeHandler } from '../src/host/bridge-route.ts'
import { createCanvasHostBridge } from '../src/host/canvas-bridge.ts'
import { CanvasAgentError } from '../src/shared/canvas-agent-protocol.ts'
test('route rejects authentication before reading request body or registry', async () => {
  let bodyRead = false
  const request = { headers: {}, method: 'POST', url: '/desktop-canvas/api/bridge/attach', async *[Symbol.asyncIterator]() { bodyRead = true; yield '{}' } }
  const response = { writeHead(status) { this.status = status }, end() {} }
  await bridgeHandler({ requestRejection: () => 401 }, {})(request, response)
  assert.equal(response.status, 401); assert.equal(bodyRead, false)
})
test('invalid bridge events expose the error code without leaking messages or request data', async () => {
  for (const cause of [new CanvasAgentError('CLIENT_AMBIGUOUS', 'private detail'), new Error('private detail')]) {
    const handler = bridgeHandler({ requestRejection: () => undefined }, {
      checkClient: () => true, acceptClientEvent() { throw cause },
    })
    const request = { method: 'POST', url: '/desktop-canvas/api/bridge/client-event',
      headers: { 'content-type': 'application/json', 'x-canvas-bridge-origin': 'https://shell.test', 'x-canvas-bridge-key': 'fixture' },
      async *[Symbol.asyncIterator]() { yield JSON.stringify({ type: 'session.sync', protocolVersion: 4, connectionId: 'connection', revision: 1, sessionIds: ['session'] }) },
    }
    const response = { writeHead(status) { this.status = status }, end(body) { this.body = JSON.parse(body) } }
    await handler(request, response)
    assert.equal(response.status, 400)
    assert.deepEqual(response.body, { error: 'invalid bridge event', ...(cause instanceof CanvasAgentError ? { code: 'CLIENT_AMBIGUOUS' } : {}) })
  }
})
test('real local HTTP route freezes origin/key, serves one SSE stream, and bounds JSON', async t => {
  const bridge = createCanvasHostBridge()
  const server = createServer(bridgeHandler({ requestRejection: req => req.headers.authorization === 'fixture' ? undefined : 401 }, bridge))
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = 'http://127.0.0.1:' + server.address().port
  t.after(() => { bridge.dispose(); server.closeAllConnections(); server.close() })
  const path = suffix => origin + '/desktop-canvas/api/bridge/' + suffix
  const base = { authorization: 'fixture', 'x-canvas-bridge-origin': origin, origin, 'content-type': 'application/json' }
  const attach = await fetch(path('attach'), { method: 'POST', headers: base, body: JSON.stringify({ protocolVersion: 4, clientId: 'client' }) }).then(r => r.json())
  const headers = { ...base, 'x-canvas-bridge-key': attach.bridgeKey }
  assert.equal((await fetch(path('client-event'), { method: 'POST', headers: { ...headers, origin: 'https://wrong.test' }, body: '{}' })).status, 403)
  assert.equal((await fetch(path('client-event'), { method: 'POST', headers: { ...headers, 'x-canvas-bridge-key': 'bad' }, body: '{}' })).status, 403)
  assert.equal((await fetch(path('attach'), { method: 'POST', headers: base, body: 'x'.repeat(2 * 1024 * 1024 + 1) })).status, 413)
  const stop = new AbortController(); const stream = await fetch(path('events'), { headers, signal: stop.signal }); const reader = stream.body.getReader()
  assert.match(stream.headers.get('content-type'), /text\/event-stream/); assert.match(new TextDecoder().decode((await reader.read()).value), /bridge.connected/)
  assert.equal((await fetch(path('client-event'), { method: 'POST', headers, body: JSON.stringify({ type: 'session.sync', protocolVersion: 4, connectionId: attach.connectionId, revision: 1, sessionIds: ['session'] }) })).status, 200)
  assert.equal((await fetch(path('events?key=' + attach.bridgeKey), { headers })).status, 404)
  stop.abort(); await reader.cancel().catch(() => {})
})

test('SSE backpressure drains buffered commands in order and overflow settles a dispatched write as unknown', async t => {
  const {EventEmitter}=await import('node:events')
  const bridge=createCanvasHostBridge();t.after(()=>bridge.dispose());const origin='http://127.0.0.1:3000';const registration=bridge.attachClient(origin, 'backpressure-client', 'web-locks-v1')
  bridge.acceptClientEvent(registration.bridgeKey,origin,{type:'session.sync',protocolVersion:4,connectionId:registration.connectionId,revision:1,sessionIds:['session']})
  const frames=[];let blocked=true
  const res=Object.assign(new EventEmitter(),{destroyed:false,headersSent:false,writableLength:0,writeHead(){},write(frame){this.headersSent=true;frames.push(frame);return !blocked},end(){this.emit('close')},destroy(){this.destroyed=true;this.emit('close')}})
  await bridgeHandler({requestRejection:()=>undefined},bridge)({method:'GET',url:'/desktop-canvas/api/bridge/events',headers:{'x-canvas-bridge-origin':origin,'x-canvas-bridge-key':registration.bridgeKey}},res)
  const preparing=bridge.ensureContext('session','2873','edit','prepare')
  assert.equal(frames.length,1)
  blocked=false;res.emit('drain');assert.match(frames[1],/canvas.prepare/)
  bridge.acceptClientEvent(registration.bridgeKey,origin,{type:'canvas.prepare.ack',protocolVersion:4,connectionId:registration.connectionId,sessionId:'session',canvasId:'2873',requestId:'prepare',status:'prepared',contextId:'ctx',state:{phase:'ready',capabilities:{read:true,edit:true,run:false},version:'18'}})
  const target=await preparing;res.writableLength=8*1024*1024
  const result=await bridge.dispatch(target,'add',{action:'node.add',expectedVersion:'18',node:{type:'text'}})
  assert.equal(result.status,'submission_unknown');assert.equal(res.destroyed,true);assert.equal(res.listenerCount('drain'),0)
})

test('Host plugin teardown closes existing command streams and leaves sent writes unknown', async t => {
  const { EventEmitter } = await import('node:events')
  const bridge = createCanvasHostBridge()
  const origin = 'http://127.0.0.1:3000', client = bridge.attachClient(origin, 'teardown-client', 'web-locks-v1')
  bridge.acceptClientEvent(client.bridgeKey, origin, { type: 'session.sync', protocolVersion: 4,
    connectionId: client.connectionId, revision: 1, sessionIds: ['session'] })
  const res = Object.assign(new EventEmitter(), { destroyed: false, headersSent: false, writableLength: 0,
    writeHead() { this.headersSent = true }, write() { return true }, end() { this.emit('close') },
    destroy() { this.destroyed = true; this.emit('close') } })
  const handler = bridgeHandler({ requestRejection: () => undefined }, bridge)
  t.after(() => { res.destroy(); bridge.dispose() })
  await handler({ method: 'GET', url: '/desktop-canvas/api/bridge/events', headers: {
    'x-canvas-bridge-origin': origin, 'x-canvas-bridge-key': client.bridgeKey } }, res)
  const preparing = bridge.ensureContext('session', '2873', 'edit', 'prepare-teardown')
  bridge.acceptClientEvent(client.bridgeKey, origin, { type: 'canvas.prepare.ack', protocolVersion: 4,
    connectionId: client.connectionId, sessionId: 'session', canvasId: '2873', requestId: 'prepare-teardown',
    status: 'prepared', contextId: 'ctx', state: { phase: 'ready', capabilities: { read: true, edit: true, run: false }, version: '1' } })
  const pending = bridge.dispatch(await preparing, 'write-teardown', { action: 'node.add', expectedVersion: '1', node: { type: 'text' } })
  handler.close(); handler.close()
  assert.equal(res.destroyed, true)
  assert.equal(res.listenerCount('drain'), 0)
  assert.equal((await pending).status, 'submission_unknown')
  const answer = { writeHead(status) { this.status = status }, end() {} }
  await handler({ method: 'POST', url: '/desktop-canvas/api/bridge/attach', headers: {} }, answer)
  assert.equal(answer.status, 503)
})
