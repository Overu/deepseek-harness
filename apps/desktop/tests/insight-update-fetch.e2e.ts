/**
 * Electron's net.fetch may omit Response.url, while update verification needs the requested URL.
 * Built-artifact regression: run after `pnpm run build:lib:host`, which emits
 * apps/desktop/lib/types/insight-update-fetch.js for the Electron fixture.
 */
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const repository = fileURLToPath(new URL('../../../', import.meta.url))
const builtFetch = join(repository, 'apps/desktop/lib/types/insight-update-fetch.js')
const hasDisplay = process.platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)

interface FixtureResult {
  readonly rawUrl: string
  readonly direct: { readonly url: string; readonly status: number; readonly redirected: boolean; readonly body: string }
  readonly redirect: { readonly rejected: boolean }
  readonly missing: { readonly url: string; readonly status: number; readonly redirected: boolean }
}

function isFixtureResult(value: unknown): value is FixtureResult {
  if (value === null || typeof value !== 'object') return false
  const result = value as Partial<FixtureResult>
  return typeof result.rawUrl === 'string'
    && result.direct !== undefined
    && typeof result.direct.url === 'string'
    && typeof result.direct.status === 'number'
    && typeof result.direct.redirected === 'boolean'
    && typeof result.direct.body === 'string'
    && result.redirect !== undefined
    && typeof result.redirect.rejected === 'boolean'
    && result.missing !== undefined
    && typeof result.missing.url === 'string'
    && typeof result.missing.status === 'number'
    && typeof result.missing.redirected === 'boolean'
}

// Linux Electron needs a display server; headless runs skip unless the caller provides one.
it.skipIf(!hasDisplay)('normalizes the missing Electron net.fetch response URL without following redirects', { retry: 0 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-insight-update-fetch-'))
  let redirectRequests = 0
  let destinationRequests = 0
  const server = createServer((request, response) => {
    switch (request.url) {
      case '/direct':
        response.end('direct update')
        return
      case '/redirect':
        redirectRequests += 1
        response.writeHead(302, { location: '/destination' })
        response.end()
        return
      case '/destination':
        destinationRequests += 1
        response.end('redirect destination')
        return
      case '/missing':
        response.writeHead(404)
        response.end('missing update')
        return
      default:
        response.writeHead(500)
        response.end(`unexpected request ${request.url ?? ''}`)
    }
  })
  let listening = false
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        listening = true
        resolve()
      })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing Insight update fixture listener')
    const origin = `http://127.0.0.1:${String(address.port)}`
    if (!existsSync(builtFetch)) throw new Error(`missing built Insight update fetch helper ${builtFetch}; run pnpm run build:lib:host`)
    const userData = join(root, 'user-data')
    await mkdir(userData)
    const electron: unknown = require('electron')
    if (typeof electron !== 'string') throw new Error('Electron executable is unavailable')
    const fixture = fileURLToPath(new URL('./fixtures/insight-update-fetch.mjs', import.meta.url))
    const result = await execa(electron, [fixture, builtFetch, userData, origin], {
      env: { ELECTRON_RUN_AS_NODE: undefined },
      timeout: 45_000,
      forceKillAfterDelay: 5_000,
      reject: false,
    })
    expect(result.timedOut, result.stderr).toBe(false)
    expect(result.signal, result.stderr).toBeUndefined()
    expect(result.exitCode, result.stderr).toBe(0)
    const line = result.stdout.split('\n').find(value => value.startsWith('INSIGHT_UPDATE_FETCH_RESULT '))
    if (line === undefined) throw new Error(`Missing Electron result: ${result.stdout}\n${result.stderr}`)
    const observed: unknown = JSON.parse(line.slice('INSIGHT_UPDATE_FETCH_RESULT '.length))
    if (!isFixtureResult(observed)) throw new Error('Invalid Electron Insight update fetch result')
    expect(observed.direct).toEqual({ url: `${origin}/direct`, status: 200, redirected: false, body: 'direct update' })
    expect(observed.redirect.rejected).toBe(true)
    expect(redirectRequests).toBe(1)
    expect(destinationRequests).toBe(0)
    expect(observed.missing).toEqual({ url: `${origin}/missing`, status: 404, redirected: false })
  } finally {
    if (listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error) reject(error); else resolve() })
        server.closeAllConnections()
      })
    }
    await rm(root, { recursive: true, force: true })
  }
})
