import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pageHandler } from '../src/host/page-route.ts'

function response() {
  return {
    status: undefined,
    headers: undefined,
    body: undefined,
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = body }
  }
}

async function fixture(t) {
  const temp = await mkdtemp(join(tmpdir(), 'canvas-page-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const dist = join(temp, 'dist')
  await mkdir(join(dist, 'assets'), { recursive: true })
  await writeFile(join(dist, 'index.html'), '<html><head></head><body>Vite canvas</body></html>')
  await writeFile(join(dist, 'assets', 'app-12345678.js'), 'import "./app.css"')
  await writeFile(join(dist, 'assets', 'app-12345678.css'), 'body { color: black }')
  await writeFile(join(dist, 'assets', 'font-12345678.woff2'), 'font')
  await writeFile(join(temp, 'outside.js'), 'secret')
  await symlink(join(temp, 'outside.js'), join(dist, 'assets', 'outside.js'))
  return dist
}

test('page route authenticates before touching the bundle', async () => {
  const handler = pageHandler({ requestRejection: () => 401 }, '/bundle/does/not/exist')
  const res = response()
  await handler({ method: 'GET', url: '/desktop-canvas/view?id=2873' }, res)
  assert.equal(res.status, 401)
})

test('page route serves Vite HTML and asset types with a restrictive CSP', async t => {
  const handler = pageHandler({ requestRejection: () => undefined }, await fixture(t))
  for (const [url, mime] of [
    ['/desktop-canvas/view?id=2873', 'text/html'],
    ['/desktop-canvas/assets/app-12345678.js', 'text/javascript'],
    ['/desktop-canvas/assets/app-12345678.css', 'text/css'],
    ['/desktop-canvas/assets/font-12345678.woff2', 'font/woff2']
  ]) {
    const res = response()
    await handler({ method: 'GET', url }, res)
    assert.equal(res.status, 200, url)
    assert.match(res.headers['content-type'], new RegExp('^' + mime))
    assert.equal(res.headers['x-content-type-options'], 'nosniff')
    assert.ok(res.body.length > 0)
  }
  const res = response()
  await handler({ method: 'GET', url: '/desktop-canvas/view?id=2873' }, res)
  assert.match(res.headers['content-security-policy'], /style-src 'self'/)
  assert.match(res.headers['content-security-policy'], /font-src 'self'/)
  const directives = res.headers['content-security-policy'].split(';').map(value => value.trim())
  assert.equal(directives.find(value => value.startsWith('connect-src ')), "connect-src 'self' blob: data: https://*.aliyuncs.com")
  assert.equal(directives.find(value => value.startsWith('media-src ')), "media-src 'self' blob: data: https:")
  assert.ok(directives.includes("script-src 'self'"))
  assert.ok(directives.includes("default-src 'none'"))
})

test('canvas page exposes the current public share origin, not the local server', async t => {
  const handler = pageHandler({ requestRejection: () => undefined }, await fixture(t))
  const previous = process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT
  try {
    for (const [environment, origin] of [
      ['test', 'https://dynsight-test.insight-aigc.com'],
      ['production', 'https://dynsight.insight-aigc.com']
    ]) {
      process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT = environment
      const res = response()
      await handler({ method: 'GET', url: '/desktop-canvas/view?id=2873' }, res)
      assert.equal(res.status, 200)
      assert.match(String(res.body), new RegExp(`<meta name="desktop-canvas-web-origin" content="${origin}"`))
    }
  } finally {
    if (previous === undefined) delete process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT
    else process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT = previous
  }
})

test('page route rejects invalid IDs, methods, missing files, traversal and escaped assets', async t => {
  const handler = pageHandler({ requestRejection: () => undefined }, await fixture(t))
  for (const [url, method, status] of [
    ['/desktop-canvas/view?id=0', 'GET', 400],
    ['/desktop-canvas/view?id=2873', 'POST', 405],
    ['/desktop-canvas/assets/missing.js', 'GET', 404],
    ['/desktop-canvas/assets/app.js.map', 'GET', 404],
    ['/desktop-canvas/assets/outside.js', 'GET', 404],
    ['/desktop-canvas/assets/../assets/app-12345678.js', 'GET', 404],
    ['/desktop-canvas/assets/%2e%2e/assets/app-12345678.js', 'GET', 404],
    ['/desktop-canvas/assets/%2foutside.js', 'GET', 404],
    ['/desktop-canvas/api/missing.js', 'GET', 404]
  ]) {
    const res = response()
    await handler({ method, url }, res)
    assert.equal(res.status, status, url)
  }
})

test('invalid desktop environment cannot silently inject the test share origin', async t => {
  const previous = process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT
  try {
    process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT = 'invalid'
    const res = response()
    await pageHandler({ requestRejection: () => undefined }, await fixture(t))({ method: 'GET', url: '/desktop-canvas/view?id=2873' }, res)
    assert.equal(res.status, 500)
  } finally {
    if (previous === undefined) delete process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT
    else process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT = previous
  }
})
