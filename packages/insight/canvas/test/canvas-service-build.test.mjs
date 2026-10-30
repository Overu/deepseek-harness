import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'
import { auditCanvasService } from '../canvas-app/build/canvas-service-audit.ts'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pageHandler } from '../src/host/page-route.ts'

function chunk(fileName, imports = [], moduleIds = [], exports = []) {
  return { type: 'chunk', fileName, imports, moduleIds, exports, isEntry: fileName === 'canvas-service.js' }
}

function mountedSession(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    set(next) { value = next; listeners.forEach(listener => listener()) },
    get size() { return listeners.size },
  }
}

function clientSlots(entries) {
  return {
    entriesOfSlot: name => name === 'conversation.chat.node'
      ? ['user', 'steering', 'assistant-step'].map(key => ({ options: { key }, component: () => null }))
      : [{ options: {}, component: () => null }],
    inject(_name, callback) {
      const effect = callback()
      if (typeof effect === 'function') return effect
      const disposers = [...effect]
      return () => disposers.reverse().forEach(dispose => dispose())
    },
    register(options, component) { entries.push({ options, component }); return () => {} },
  }
}
test('build audit follows static dependency closure, rejects missing exports/chunks and eager UI bootstrap', () => {
  const entry = chunk('canvas-service.js', ['assets/core.js'], [], ['createCanvasServiceRuntime'])
  assert.deepEqual(auditCanvasService({ 'canvas-service.js': entry, 'assets/core.js': chunk('assets/core.js', [], ['/src/store/flowStoreCore.ts']) }).staticChunks, ['assets/core.js', 'canvas-service.js'])
  assert.throws(() => auditCanvasService({}), /entry\/export/)
  assert.throws(() => auditCanvasService({ 'canvas-service.js': entry }), /dependency is missing/)
  for (const path of ['/src/main.tsx', '/src/canvas-router.tsx', '/legacy/src/components/canvasFlow/index.tsx', '/legacy/src/components/common/storageLimitManager.tsx', '/node_modules/sonner/dist/index.mjs']) {
    assert.throws(() => auditCanvasService({ 'canvas-service.js': entry, 'assets/core.js': chunk('assets/core.js', [], [path]) }), /eagerly includes/)
  }
})

test('build audit does not eagerly follow optional UI chunks, while preserving the service factory export', () => {
  const entry = { ...chunk('canvas-service.js', [], [], ['createCanvasServiceRuntime']), dynamicImports: ['assets/ui.js'] }
  assert.deepEqual(auditCanvasService({ 'canvas-service.js': entry, 'assets/ui.js': chunk('assets/ui.js', [], ['/src/main.tsx']) }).staticChunks, ['canvas-service.js'])
  assert.throws(() => auditCanvasService({ 'canvas-service.js': { ...entry, exports: [] } }), /entry\/export/)
})

test('real Client apply owns the service effect independently of tabs/input slots and does not open a canvas', async () => {
  const result = await build({ entryPoints: [new URL('../src/client/index.ts', import.meta.url).pathname], bundle: true, write: false, format: 'cjs', platform: 'browser', jsx: 'automatic', external: ['react', 'react/*', '@deepseek-ai/*'] })
  const host = { location: { origin: 'http://127.0.0.1:3000' } }
  let opened = 0
  const effects = new Map()
  const sandbox = { window: host, URL, crypto, AbortController, AbortSignal, clearTimeout, module: { exports: {} }, exports: {}, require: name => name === '@deepseek-ai/dsh-util-crypto' ? { randomUUID: () => crypto.randomUUID() } : ({}) }
  sandbox.exports = sandbox.module.exports
  vm.runInNewContext(result.outputFiles[0].text, sandbox)
  sandbox.module.exports.apply({
    on: () => () => {}, uiConversation: { events: { register: () => () => {} } }, locale: { register: () => () => {} },
    effect(callback, label) { effects.set(label, callback()) },
    sidebarRightTabs: { register: () => () => {} },
    slots: { inject: () => () => {}, register: () => () => {} },
    sidebarRight: { mounted: mountedSession(), openResource() { opened++ } },
  })
  assert.ok(host.__INSIGHT_CANVAS_RUNTIME_V1__)
  assert.equal(opened, 0)
  effects.get('desktop-canvas: tab body')(); effects.get('desktop-canvas: session bridge')()
  assert.ok(host.__INSIGHT_CANVAS_RUNTIME_V1__)
  effects.get('desktop-canvas: client bridge')()
  effects.get('desktop-canvas: service runtime')()
  assert.equal(host.__INSIGHT_CANVAS_RUNTIME_V1__, undefined)
  assert.equal(opened, 0)
})

test('existing authenticated page handler serves the fixed service script without a canvas/view request', async t => {
  const dist = await mkdtemp(join(tmpdir(), 'canvas-service-route-')); t.after(() => rm(dist, { recursive: true, force: true }))
  await writeFile(join(dist, 'canvas-service.js'), 'export function createCanvasServiceRuntime() {}')
  for (const rejected of [undefined, 401, 403]) {
    const res = { status: 0, headers: {}, body: null, writeHead(status, headers) { this.status = status; this.headers = headers }, end(body) { this.body = body } }
    await pageHandler({ requestRejection: () => rejected }, dist)({ method: 'GET', url: '/desktop-canvas/canvas-service.js' }, res)
    assert.equal(res.status, rejected ?? 200)
    if (!rejected) { assert.match(res.headers['content-type'], /^text\/javascript/); assert.match(res.headers['content-security-policy'], /script-src 'self'/) }
  }
})

test('real Client binds the on-screen session without input or canvas mounts, and releases only on session changes', async () => {
  const result = await build({ entryPoints: [new URL('../src/client/index.ts', import.meta.url).pathname], bundle: true, write: false, format: 'cjs', platform: 'browser', jsx: 'automatic', external: ['react', 'react/*', '@deepseek-ai/*'] })
  const effects = new Map(), entries = [], posts = [], mounted = mountedSession()
  let opened = 0, attaches = 0
  const host = { location: { origin: 'http://127.0.0.1:3000' } }
  const registration = { protocolVersion: 4, clientId: 'client', connectionId: 'connection', bridgeKey: 'k'.repeat(43) }
  const transport = async (input, init) => {
    if (input.endsWith('/attach')) { attaches++; return { ok: true, json: async () => sandbox.structuredClone(registration) } }
    if (input.endsWith('/events')) return new Response(new ReadableStream({ start(controller) {
      init.signal.addEventListener('abort', () => controller.error(new Error('disposed')), { once: true })
      controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ ...registration, type: 'bridge.connected', clientId: undefined, bridgeKey: undefined }) + '\n\n'))
    } }), { headers: { 'content-type': 'text/event-stream' } })
    if (input.endsWith('/client-event')) posts.push(JSON.parse(init.body))
    return Response.json({})
  }
  const sandbox = { window: host, URL, crypto, AbortController, AbortSignal, clearTimeout, setTimeout, TextEncoder, TextDecoder, module: { exports: {} }, exports: {}, fetch: transport, require: name => name === '@deepseek-ai/dsh-util-crypto' ? { randomUUID: () => crypto.randomUUID() } : ({}) }
  const context = vm.createContext(sandbox)
  sandbox.structuredClone = value => vm.runInContext('JSON.parse(' + JSON.stringify(JSON.stringify(value)) + ')', context)
  sandbox.exports = sandbox.module.exports; vm.runInContext(result.outputFiles[0].text, context)
  sandbox.module.exports.apply({ on: () => () => {}, uiConversation: { events: { register: () => () => {} } }, locale: { register: () => () => {} }, effect: (callback, label) => effects.set(label, callback()), sidebarRightTabs: { register: () => () => {} }, slots: clientSlots(entries), sidebarRight: { mounted, openResource: () => { opened++ } } })
  const until = async check => { for (let i = 0; !check(); i++) { assert(i < 100, 'session sync timed out'); await new Promise(resolve => setTimeout(resolve, 5)) } }
  try {
    assert.equal(attaches, 0)
    assert.equal(entries.some(entry => entry.options.name === 'conversation.input.left'), false)
    mounted.set('session-1')
    await until(() => posts.some(event => event.type === 'session.sync' && event.sessionIds.includes('session-1')))
    effects.get('desktop-canvas: tab body')()
    mounted.set('session-1')
    assert.ok(host.__INSIGHT_CANVAS_RUNTIME_V1__)
    assert.deepEqual(posts.filter(event => event.type === 'session.sync').at(-1).sessionIds, ['session-1'])
    mounted.set('session-2')
    await until(() => posts.filter(event => event.type === 'session.sync').at(-1)?.sessionIds.includes('session-2'))
    assert.deepEqual(posts.filter(event => event.type === 'session.sync').at(-1).sessionIds, ['session-2'])
    mounted.set(undefined)
    await until(() => posts.filter(event => event.type === 'session.sync').at(-1)?.sessionIds.length === 0)
    assert.equal(attaches, 1); assert.equal(opened, 0)
    assert.equal(entries.filter(entry => entry.options.name === 'conversation.input.attachments').length, 1)
  } finally { for (const dispose of [...effects.values()].reverse()) dispose?.() }
  assert.equal(mounted.size, 0)
  assert.equal(host.__INSIGHT_CANVAS_RUNTIME_V1__, undefined)
})


test('real Client registers a scoped results footer and canvas navigation only occurs on an explicit gesture', async () => {
  const result = await build({ entryPoints: [new URL('../src/client/index.ts', import.meta.url).pathname], bundle: true, write: false, format: 'cjs', platform: 'browser', jsx: 'automatic', external: ['react', 'react/*', '@deepseek-ai/*'] })
  const effects = new Map(), entries = [], navigations = [], definitions = []
  const host = { location: { origin: 'http://127.0.0.1:3000' } }
  const sandbox = { window: host, URL, crypto, AbortController, AbortSignal, clearTimeout, module: { exports: {} }, exports: {}, require: name => name === '@deepseek-ai/dsh-util-crypto' ? { randomUUID: () => crypto.randomUUID() } : ({}) }
  sandbox.exports = sandbox.module.exports
  vm.runInNewContext(result.outputFiles[0].text, sandbox)
  sandbox.module.exports.apply({
    on: () => () => {}, effect: (callback, label) => effects.set(label, callback()),
    uiConversation: { events: { register: definition => { definitions.push(definition); return () => {} } } },
    locale: { register: () => () => {} }, sidebarRightTabs: { register: () => () => {} },
    slots: clientSlots(entries),
    sidebarRight: { mounted: mountedSession(), openResource: (address, options) => navigations.push({ address, options }) },
  })
  const entry = entries.find(entry => entry.options.name === 'conversation.chat.turnTail')
  assert(entry); assert.equal(definitions[0].kind, 'desktop-canvas-results')
  const injected = entry.options.inject('actual-session')
  assert.equal(injected.canvasResultsSessionId, 'actual-session')
  assert.equal(injected.results.getSnapshot('actual-session').length, 0)
  assert.equal(navigations.length, 0)
  injected.openCanvasResult('103161', 'true-node')
  assert.equal(navigations[0].address, 'dsh-resource://canvas/103161')
  assert.equal(navigations[0].options.params.nodeId, 'true-node')
  injected.openCanvasResult('invalid')
  assert.equal(navigations.length, 1)
  const created = entries.find(item => item.options.id === '@insight-ai/desktop-canvas-plugin-created')
  assert(created)
  created.options.inject('actual-session').openCreatedCanvas('103490')
  assert.deepEqual(navigations[1], { address: 'dsh-resource://canvas/103490', options: undefined })
  created.options.inject('actual-session').openCreatedCanvas('not-an-id')
  assert.equal(navigations.length, 2)
  for (const dispose of [...effects.values()].reverse()) dispose?.()
})
