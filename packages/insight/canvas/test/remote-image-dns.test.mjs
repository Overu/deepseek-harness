import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { isFakeAddress, resolvePublicImageHost } from '../src/host/remote-image-dns.ts'

function fixture({ answers, status = 200, question, payload, chunks, headers = {}, hold = false, truncated = false } = {}) {
  const calls = []
  const request = (url, options, callback) => {
    const type = Number(url.searchParams.get('type'))
    const call = { url, options, destroyed: false }
    calls.push(call)
    const req = new EventEmitter()
    req.destroy = () => { call.destroyed = true; return req }
    req.end = () => {
      if (hold) return
      const body = payload === undefined ? JSON.stringify({ Status: 0, TC: truncated,
        Question: question ?? [{ name: url.searchParams.get('name'), type }],
        Answer: answers ?? [{ name: url.searchParams.get('name'), type, data: type === 1 ? '8.134.229.106' : '2606:4700:4700::1111' }],
      }) : payload
      const res = Readable.from(chunks ?? [Buffer.from(body)])
      res.statusCode = status
      res.headers = headers
      queueMicrotask(() => callback(res))
    }
    return req
  }
  return { request, calls }
}

test('recognizes exactly IPv4 Fake-IP benchmark range without admitting mapped or other addresses', () => {
  for (const address of ['198.18.0.0', '198.18.0.119', '198.19.255.255']) assert.equal(isFakeAddress(address), true, address)
  for (const address of ['198.17.255.255', '198.20.0.0', '127.0.0.1', '10.0.0.1', '8.8.8.8', '::ffff:198.18.0.119', '198.18.1', 'not-an-ip']) assert.equal(isFakeAddress(address), false, address)
})

test('queries A and AAAA through fixed TLS authority and pinned public resolver, with no credentials', async () => {
  const f = fixture()
  const addresses = await resolvePublicImageHost('Images.Example.com', new AbortController().signal, f.request)
  assert.deepEqual(addresses, [{ address: '8.134.229.106', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }])
  assert.deepEqual(f.calls.map(call => call.url.searchParams.get('type')), ['1', '28'])
  for (const { url, options } of f.calls) {
    assert.equal(url.protocol, 'https:')
    assert.equal(url.hostname, 'cloudflare-dns.com')
    assert.equal(url.pathname, '/dns-query')
    assert.equal(url.searchParams.get('name'), 'images.example.com')
    assert.equal(url.username, ''); assert.equal(url.password, '')
    assert.equal(options.agent, false); assert.equal(options.family, 4)
    assert.equal(options.servername, 'cloudflare-dns.com'); assert.equal(options.rejectUnauthorized, true)
    assert.deepEqual(options.headers, { accept: 'application/dns-json', host: 'cloudflare-dns.com' })
    options.lookup('cloudflare-dns.com', {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, '1.1.1.1'); assert.equal(family, 4) })
  }
})

test('preserves syntactically valid private answers for the caller public-address guard', async () => {
  const f = fixture({ answers: [{ name: 'images.example.com', type: 5, data: 'cdn.example.com.' }, { name: 'cdn.example.com', type: 1, data: '10.0.0.1' }] })
  assert.deepEqual(await resolvePublicImageHost('images.example.com', new AbortController().signal, f.request), [{ address: '10.0.0.1', family: 4 }])
})

test('rejects bad authority input, mismatched questions and non-success or malformed DNS envelopes', async () => {
  for (const hostname of ['127.0.0.1', '198.18.0.119', 'https://images.example.com/path?token=private', 'images.example.com/secret', 'bad host', '-bad.example']) {
    const f = fixture()
    await assert.rejects(resolvePublicImageHost(hostname, new AbortController().signal, f.request)); assert.equal(f.calls.length, 0)
  }
  for (const options of [
    { question: [{ name: 'other.example.com', type: 1 }] },
    { question: [{ name: 'images.example.com', type: 16 }] },
    { payload: '{"Status":2,"Question":[{"name":"images.example.com","type":1}]}' },
    { payload: '{"Status":0,"Question":[],"Answer":[]}' },
    { payload: '<html>not DNS</html>' },
    { payload: '{"Status":0,"Question":[{"name":"images.example.com","type":1}],"Answer":{}}' },
  ]) await assert.rejects(resolvePublicImageHost('images.example.com', new AbortController().signal, fixture(options).request))
})

test('rejects malformed nonempty answers instead of filtering them into apparent success', async () => {
  for (const answers of [
    [null], [{ name: 'images.example.com', type: 1, data: 'not-an-address' }],
    [{ name: 'images.example.com', type: 28, data: '8.8.8.8' }],
    [{ name: 'images.example.com', type: 5, data: '' }],
    [{ name: 'images.example.com', type: 5, data: 'https://cdn.example.com/path' }],
    [{ name: 'images.example.com', type: 1, data: '8.8.8.8' }, { name: 'images.example.com', type: 1, data: 'invalid' }],
    Array.from({ length: 129 }, () => ({ name: 'images.example.com', type: 1, data: '8.8.8.8' })),
  ]) await assert.rejects(resolvePublicImageHost('images.example.com', new AbortController().signal, fixture({ answers }).request))
  await assert.rejects(resolvePublicImageHost('images.example.com', new AbortController().signal, fixture({ answers: [] }).request))
})

test('rejects redirects, error HTTP and 32 KiB response overflow without following locations', async () => {
  for (const options of [{ status: 302, headers: { location: 'http://127.0.0.1/metadata' } }, { status: 500 }, { headers: { 'content-length': String(32 * 1024 + 1) } }, { chunks: [Buffer.alloc(16 * 1024), Buffer.alloc(16 * 1024 + 1)] }]) {
    const f = fixture(options)
    await assert.rejects(resolvePublicImageHost('images.example.com', new AbortController().signal, f.request))
    assert.equal(f.calls.length, 2)
    assert(f.calls.some(call => call.destroyed))
  }
})

test('pre-cancellation makes no request and cancellation destroys both in-flight queries', async () => {
  const before = new AbortController(); before.abort(); const first = fixture()
  await assert.rejects(resolvePublicImageHost('images.example.com', before.signal, first.request)); assert.equal(first.calls.length, 0)
  const during = new AbortController(), second = fixture({ hold: true })
  const pending = resolvePublicImageHost('images.example.com', during.signal, second.request)
  assert.equal(second.calls.length, 2); during.abort()
  await assert.rejects(pending); assert(second.calls.every(call => call.destroyed))
})

test('bounds stalled resolver queries to eight seconds and destroys both connections', async t => {
  const actualTimeout = AbortSignal.timeout
  const waits = []
  t.mock.method(AbortSignal, 'timeout', milliseconds => { waits.push(milliseconds); return actualTimeout(5) })
  const f = fixture({ hold: true })
  const keepAlive = setTimeout(() => {}, 1000)
  try { await assert.rejects(resolvePublicImageHost('images.example.com', new AbortController().signal, f.request)) }
  finally { clearTimeout(keepAlive) }
  assert.deepEqual(waits, [8000]); assert(f.calls.every(call => call.destroyed))
})


test('rejects DNS truncation even when the answer otherwise contains a valid address', async () => {
  const f = fixture({ truncated: true })
  await assert.rejects(resolvePublicImageHost('images.example.com', new AbortController().signal, f.request))
})

test('rejects address owners outside the question and its CNAME chain', async () => {
  for (const answers of [
    [{ name: 'other.example.com', type: 1, data: '8.8.8.8' }],
    [{ name: 'images.example.com', type: 1, data: '8.8.8.8' }, { name: 'other.example.com', type: 28, data: '2606:4700:4700::1111' }],
    [{ name: 'other.example.com', type: 5, data: 'cdn.example.com' }, { name: 'cdn.example.com', type: 1, data: '8.8.8.8' }],
  ]) await assert.rejects(resolvePublicImageHost('images.example.com', new AbortController().signal, fixture({ answers }).request))
})

test('accepts address owners in a valid multi-hop CNAME chain regardless of record ordering', async () => {
  const f = fixture({ answers: [
    { name: 'cdn.example.com', type: 1, data: '8.134.229.106' },
    { name: 'alias.example.com.', type: 5, data: 'CDN.EXAMPLE.COM.' },
    { name: 'images.example.com', type: 5, data: 'alias.example.com' },
  ] })
  assert.deepEqual(await resolvePublicImageHost('images.example.com', new AbortController().signal, f.request), [{ address: '8.134.229.106', family: 4 }])
})

test('rejects cyclic or conflicting CNAME chains', async () => {
  for (const aliases of [
    [{ name: 'images.example.com', type: 5, data: 'alias.example.com' }, { name: 'alias.example.com', type: 5, data: 'images.example.com' }],
    [{ name: 'images.example.com', type: 5, data: 'alias.example.com' }, { name: 'images.example.com', type: 5, data: 'other.example.com' }],
  ]) await assert.rejects(resolvePublicImageHost('images.example.com', new AbortController().signal, fixture({ answers: [...aliases, { name: 'images.example.com', type: 1, data: '8.8.8.8' }] }).request))
})
