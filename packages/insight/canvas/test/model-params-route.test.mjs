import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { modelParamsHandler } from '../src/host/model-params-route.ts'

const path = '/desktop-canvas/api/model-params'

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

test('model params route requires the browser session before contacting the CDN', async () => {
  let called = false
  const res = response()
  await modelParamsHandler(
    { requestRejection: () => 401 },
    async () => { called = true; throw new Error('unexpected request') }
  )({ method: 'GET', url: path }, res)
  assert.equal(res.status, 401)
  assert.equal(called, false)
})

test('model params route reads only the fixed CDN for the selected environment', async () => {
  const previous = process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT
  const calls = []
  const config = JSON.stringify({ imageLayoutTool: { models: {
    'gpt-image-layered': { model_name: 'GPT Image Layered', parameters: {
      num_layers: { default: 2 }, resolution: { default: '1K' }
    } }
  } } })
  try {
    const handler = modelParamsHandler(
      { requestRejection: () => undefined },
      async (url, options) => {
        calls.push({ url, options })
        return new Response(config, { headers: { 'content-type': 'application/json' } })
      }
    )
    for (const [environment, hostname] of [
      ['test', 'game-ai-admin-test-cdn.idealead.com'],
      ['production', 'game-ai-admin-prod-cdn.idealead.com']
    ]) {
      process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT = environment
      const res = response()
      await handler({ method: 'GET', url: path }, res)
      assert.equal(res.status, 200)
      assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
      assert.equal(String(res.body), config)
      assert.equal(calls.at(-1).url, `https://${hostname}/model_node_setting/model_params_with_sort.json`)
      assert.equal(calls.at(-1).options.headers.accept, 'application/json')
      assert.equal(calls.at(-1).options.headers.token, undefined)
      assert.equal(calls.at(-1).options.redirect, 'error')
    }
  } finally {
    if (previous === undefined) delete process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT
    else process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT = previous
  }
})

test('model params route rejects alternate paths and methods and does not relay bad CDN data', async () => {
  let called = 0
  const handler = modelParamsHandler(
    { requestRejection: () => undefined },
    async () => { called++; return new Response('<html>error</html>') }
  )
  for (const [method, url, status] of [
    ['POST', path, 405],
    ['GET', `${path}?url=https://example.com`, 404],
    ['GET', `${path}/anything`, 404]
  ]) {
    const res = response()
    await handler({ method, url }, res)
    assert.equal(res.status, status)
  }
  assert.equal(called, 0)
  const res = response()
  await handler({ method: 'GET', url: path }, res)
  assert.equal(res.status, 502)
  assert.equal(called, 1)
  assert.doesNotMatch(String(res.body), /<html>/)
})

test('model params route rejects an oversized CDN response', async () => {
  const res = response()
  await modelParamsHandler(
    { requestRejection: () => undefined },
    async () => new Response('{}', { headers: { 'content-length': '30000001' } })
  )({ method: 'GET', url: path }, res)
  assert.equal(res.status, 502)
})
