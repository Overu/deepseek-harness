/** Local capability proxy for bundled skill helper processes. */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { InsightSkillProxyError, type InsightSkillProxyRequest } from './skill-proxy-request.ts'

/** Per-request protocol limit shared with the bundled proxy client. */
export const INSIGHT_SKILL_PROXY_MAX_REQUEST_BYTES = 2 * 1024 * 1024
const LOCAL_PROXY_REQUEST_UPLOAD_TIMEOUT_MS = 30_000
const LOCAL_PROXY_HEADER_TIMEOUT_MS = 10_000

/** Product-selected admission and lifetime budgets for the local proxy. */
export interface InsightSkillProxyLimits {
  /** Maximum number of admitted requests, including response streaming. */
  readonly maxActiveRequests: number
  /** Maximum aggregate bytes retained for admitted request bodies. */
  readonly maxBufferedRequestBytes: number
  /** Maximum lifetime of one admitted request. */
  readonly requestTimeoutMs: number
}

interface SkillProxyDrainTarget {
  once(event: 'drain' | 'close', listener: () => void): unknown
  off(event: 'drain' | 'close', listener: () => void): unknown
}

/** Wait for local response backpressure without outliving cancellation or the request deadline. */
export async function waitForInsightSkillProxyDrain(
  output: SkillProxyDrainTarget,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  await new Promise<void>((resolve) => {
    const done = () => {
      output.off('drain', done)
      output.off('close', done)
      signal.removeEventListener('abort', done)
      resolve()
    }
    output.once('drain', done)
    output.once('close', done)
    signal.addEventListener('abort', done, { once: true })
    if (signal.aborted) done()
  })
  signal.throwIfAborted()
}

/** Start a loopback-only proxy and publish its one-launch descriptor beneath the account Home. */
export async function startInsightSkillProxy(
  request: InsightSkillProxyRequest,
  home: string,
  limits: InsightSkillProxyLimits,
): Promise<() => Promise<void>> {
  const capability = randomBytes(32).toString('hex')
  const directory = join(home, 'skill-proxy')
  const descriptor = join(directory, 'connection.json')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const activeControllers = new Set<AbortController>()
  const activeHandlers = new Set<Promise<void>>()
  let activeRequests = 0
  let bufferedRequestBytes = 0
  let closing = false
  let host = ''
  let stopping: Promise<void> | undefined

  const fail = (response: ServerResponse, status: number, code: string): void => {
    if (response.headersSent) { response.destroy(); return }
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify({ error: { code } }))
  }
  const isAuthorized = (input: IncomingMessage): boolean => {
    const expected = `Bearer ${capability}`
    const supplied = input.headers.authorization ?? ''
    return !input.headers.origin && !input.headers['sec-fetch-site'] && input.headers.host === host
      && Buffer.byteLength(supplied) === Buffer.byteLength(expected)
      && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  }
  const handle = async (input: IncomingMessage, output: ServerResponse): Promise<void> => {
    let reservedBytes = 0
    let admitted = false
    let forwarding = false
    const controller = new AbortController()
    const deadline = AbortSignal.timeout(limits.requestTimeoutMs)
    const signal = AbortSignal.any([controller.signal, deadline])
    output.once('close', () => { controller.abort(new Error('Local skill proxy client closed')) })
    try {
      const match = /^\/proxy\/([a-z][a-z0-9-]{0,63})$/u.exec(input.url ?? '')
      if (!isAuthorized(input)) { fail(output, 403, 'LOCAL_PROXY_FORBIDDEN'); return }
      if (input.method !== 'POST' || match === null || !input.headers['content-type']?.startsWith('application/json')) {
        fail(output, 400, 'INVALID_PROXY_REQUEST'); return
      }
      if (closing) { fail(output, 503, 'SKILL_PROXY_STOPPING'); return }
      if (activeRequests >= limits.maxActiveRequests) { fail(output, 429, 'SKILL_PROXY_OVERLOADED'); return }
      activeRequests++
      admitted = true
      activeControllers.add(controller)

      const declaredLength = input.headers['content-length']
      if (declaredLength !== undefined) {
        const length = Number(declaredLength)
        if (!Number.isSafeInteger(length) || length < 0) { fail(output, 400, 'INVALID_PROXY_REQUEST'); return }
        if (length > INSIGHT_SKILL_PROXY_MAX_REQUEST_BYTES) { fail(output, 413, 'REQUEST_TOO_LARGE'); return }
        if (bufferedRequestBytes + length > limits.maxBufferedRequestBytes) {
          fail(output, 429, 'SKILL_PROXY_OVERLOADED'); return
        }
      }

      const chunks: Buffer[] = []
      for await (const chunk of input as AsyncIterable<Uint8Array>) {
        const value = Buffer.from(chunk)
        if (reservedBytes + value.byteLength > INSIGHT_SKILL_PROXY_MAX_REQUEST_BYTES) {
          fail(output, 413, 'REQUEST_TOO_LARGE'); return
        }
        if (bufferedRequestBytes + value.byteLength > limits.maxBufferedRequestBytes) {
          fail(output, 429, 'SKILL_PROXY_OVERLOADED'); return
        }
        reservedBytes += value.byteLength
        bufferedRequestBytes += value.byteLength
        chunks.push(value)
      }
      const body = Buffer.concat(chunks).toString('utf8')
      try { JSON.parse(body) } catch { fail(output, 400, 'INVALID_JSON'); return }
      signal.throwIfAborted()
      forwarding = true
      const upstream = await request(`/api/skill-proxy/${match[1]}`, {
        method: 'POST', body, signal, redirect: 'error',
      })
      output.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store', 'x-accel-buffering': 'no',
      })
      const reader = upstream.body?.getReader()
      if (reader !== undefined) {
        try {
          while (!signal.aborted) {
            const item = await reader.read()
            if (item.done) break
            if (!output.write(Buffer.from(item.value))) {
              await waitForInsightSkillProxyDrain(output, signal)
            }
          }
          signal.throwIfAborted()
        } finally { await reader.cancel().catch(() => undefined) }
      }
      output.end()
    } catch (error) {
      const status = error instanceof InsightSkillProxyError ? error.status : forwarding ? 502 : 503
      const code = error instanceof InsightSkillProxyError
        ? error.code
        : forwarding ? 'SKILL_PROXY_OUTCOME_UNKNOWN' : 'SKILL_PROXY_NOT_SUBMITTED'
      fail(output, status, code)
    } finally {
      bufferedRequestBytes -= reservedBytes
      if (admitted) activeRequests--
      activeControllers.delete(controller)
    }
  }

  const server = createServer((input, output) => {
    const handler = handle(input, output)
    activeHandlers.add(handler)
    void handler.finally(() => { activeHandlers.delete(handler) }).catch((error: unknown) => {
      console.error('Insight skill proxy request cleanup failed', error)
    })
  })
  // These loopback ingress limits contain slow clients independently of the
  // longer configured deadline for an admitted media operation.
  server.requestTimeout = Math.min(limits.requestTimeoutMs, LOCAL_PROXY_REQUEST_UPLOAD_TIMEOUT_MS)
  server.headersTimeout = Math.min(server.requestTimeout, LOCAL_PROXY_HEADER_TIMEOUT_MS)

  const closeServer = (): Promise<void> => new Promise((resolve) => {
    server.close(() => { resolve() })
  })
  const drainHandlers = async (): Promise<void> => {
    while (activeHandlers.size > 0) await Promise.allSettled([...activeHandlers])
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Insight skill proxy did not bind a TCP port')
  host = `127.0.0.1:${address.port}`
  try {
    const temporary = `${descriptor}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify({ version: 1, url: `http://${host}`, capability }), { mode: 0o600 })
    await rename(temporary, descriptor)
  } catch (error) {
    closing = true
    await closeServer()
    throw error
  }
  return () => stopping ??= (async () => {
    closing = true
    const serverClosed = closeServer()
    for (const controller of activeControllers) controller.abort(new Error('Insight skill proxy stopped'))
    server.closeAllConnections()
    await Promise.all([serverClosed, drainHandlers()])
    try {
      const record = JSON.parse(await readFile(descriptor, 'utf8')) as { capability?: unknown }
      if (record.capability === capability) await rm(descriptor, { force: true })
    } catch {
      // Another launch may already own or remove this descriptor.
    }
  })()
}
