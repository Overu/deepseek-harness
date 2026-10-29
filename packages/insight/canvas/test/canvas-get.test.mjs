import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchCanvas, parseCanvasGet } from '../src/host/canvas-get.ts'
import { parseCanvasId } from '../src/shared/protocol.ts'

const id = parseCanvasId('2873')
const envelope = {
  code: 'SUCCESS',
  data: { name: '项目 36', data: JSON.stringify({ nodes: [
    { id: 'node-1', title: '图片 1', type: 'image', data: { value: 'https://example.com/a.jpg' } }
  ], edges: [] }) }
}

test('canvas/get parses string graph without changing the requested canvas ID', () => {
  assert.deepEqual(parseCanvasGet(id, envelope), {
    canvasId: '2873', name: '项目 36', nodeCount: 1,
    nodes: [{ id: 'node-1', title: '图片 1', type: 'image', value: 'https://example.com/a.jpg' }]
  })
  assert.throws(() => parseCanvasGet(id, { code: 'ERROR' }), /成功状态/)
  assert.throws(() => parseCanvasGet(id, { code: 'SUCCESS', data: { data: '{' } }), /有效 JSON/)
})

test('canvas/get rejects node IDs that cannot round-trip through selection messages', () => {
  const longId = 'n'.repeat(101)
  const response = { code: 'SUCCESS', data: { data: JSON.stringify({ nodes: [{ id: longId }] }) } }
  assert.throws(() => parseCanvasGet(id, response), /节点 ID 过长/)
})

test('canvas/get uses current Token and the fixed test Gateway', async () => {
  const previous = process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT
  process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT = 'test'
  const calls = []
  try {
    const result = await fetchCanvas(id, async () => 'current-token', async (url, init) => {
      calls.push({ url, init })
      return new Response(JSON.stringify(envelope), { status: 200 })
    })
    assert.equal(result.canvasId, '2873')
    assert.equal(calls[0].url, 'https://gapi-test.insight-aigc.com/game-ai-editor-center/api/canvas/get')
    assert.equal(calls[0].init.headers.token, 'current-token')
    assert.equal(calls[0].init.redirect, 'error')
    assert.equal(calls[0].init.body, '{"id":"2873"}')
  } finally {
    if (previous === undefined) delete process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT
    else process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT = previous
  }
})

test('canvas/get in a packaged client uses the production Gateway and Web origin', async () => {
  const previous = process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT
  process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT = 'production'
  try {
    let call
    await fetchCanvas(id, async () => 'production-token', async (url, init) => {
      call = { url, init }
      return new Response(JSON.stringify(envelope), { status: 200 })
    })
    assert.equal(call.url, 'https://gapi.insight-aigc.com/game-ai-editor-center/api/canvas/get')
    assert.equal(call.init.headers.origin, 'https://dynsight.insight-aigc.com')
    assert.equal(call.init.headers.token, 'production-token')
  } finally {
    if (previous === undefined) delete process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT
    else process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT = previous
  }
})

test('canvas/get never calls Gateway when desktop credentials are unavailable', async () => {
  let called = false
  await assert.rejects(fetchCanvas(id, async () => { throw new Error('login required') }, async () => {
    called = true
    return new Response('{}')
  }), /login required/)
  assert.equal(called, false)
})

test('canvas/get stops before Gateway when cancelled during credential lookup', async () => {
  const controller = new AbortController()
  let called = false
  await assert.rejects(fetchCanvas(id, async signal => {
    assert.equal(signal, controller.signal)
    controller.abort()
    return 'token'
  }, async () => {
    called = true
    return new Response('{}')
  }, controller.signal), { name: 'AbortError' })
  assert.equal(called, false)
})

test('summary prefers native data.title, preserves legacy titles and total count after clipping', () => {
  const nodes = Array.from({ length: 101 }, (_, index) => ({ id: 'node-' + index, type: 'text', title: 'legacy', data: { title: 'native-' + index, value: 'text' } }))
  const result = parseCanvasGet(id, { code: 'SUCCESS', data: { data: JSON.stringify({ nodes, edges: [] }) } })
  assert.equal(result.nodeCount, 101); assert.equal(result.nodes.length, 100); assert.equal(result.nodes[0].title, 'native-0')
  assert.equal(parseCanvasGet(id, envelope).nodes[0].title, '图片 1')
})
