import { readFile, realpath } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { parseCanvasId } from '../shared/protocol.ts'
import { desktopServiceProfile } from './service-environment.ts'

const PREFIX = '/desktop-canvas'
const DIST = fileURLToPath(new URL('../canvas-app/dist/', import.meta.url))
// Uploads connect to OSS; local media readers also need blob/data access.
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: data: https://*.aliyuncs.com; img-src 'self' data: https:; font-src 'self' data:; worker-src 'self'; media-src 'self' blob: data: https:; frame-ancestors 'self'; base-uri 'none'"
const MIME: Record<string, string> = {
  avif: 'image/avif', css: 'text/css; charset=utf-8', gif: 'image/gif',
  ico: 'image/x-icon', jpeg: 'image/jpeg', jpg: 'image/jpeg',
  js: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', mp3: 'audio/mpeg', mp4: 'video/mp4',
  ogg: 'audio/ogg', png: 'image/png', svg: 'image/svg+xml',
  ttf: 'font/ttf', wasm: 'application/wasm', webm: 'video/webm',
  webp: 'image/webp', woff: 'font/woff', woff2: 'font/woff2'
}

interface BrowserConnection {
  requestRejection(request: IncomingMessage): 401 | 403 | undefined
}

function connectionOf(ctx: Context): BrowserConnection {
  return Reflect.get(ctx, 'connection') as BrowserConnection
}

function answer(res: ServerResponse, status: number): void {
  res.writeHead(status, { 'cache-control': 'no-store' })
  res.end()
}

function safeAssetPath(req: IncomingMessage): string | undefined {
  const rawPath = (req.url ?? '/').split(/[?#]/u, 1)[0]
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  // Reject URL normalization and encoded separators before resolving a file.
  if (rawPath !== pathname || !pathname.startsWith(`${PREFIX}/`)) return undefined
  const asset = pathname.slice(PREFIX.length + 1)
  if (asset.startsWith('api/') || !/^[A-Za-z0-9._/-]+$/u.test(asset)) return undefined
  if (asset.split('/').some(segment => !segment || segment === '.' || segment === '..')) return undefined
  return MIME[extname(asset).slice(1).toLowerCase()] ? asset : undefined
}

async function packagedAsset(dist: string, asset: string): Promise<Buffer> {
  const root = await realpath(dist)
  const file = await realpath(resolve(root, asset))
  const within = relative(root, file)
  if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    throw new Error('asset outside canvas bundle')
  }
  return readFile(file)
}

/** Serve the Vite bundle only after Core browser authentication. */
export function pageHandler(connection: BrowserConnection, dist = DIST) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const rejection = connection.requestRejection(req)
    if (rejection !== undefined) { answer(res, rejection); return }
    if (req.method !== 'GET') { answer(res, 405); return }

    const url = new URL(req.url ?? '/', 'http://localhost')
    const rawPath = (req.url ?? '/').split(/[?#]/u, 1)[0]
    if (rawPath !== url.pathname) { answer(res, 404); return }
    let asset: string
    if (url.pathname === `${PREFIX}/view`) {
      if (!parseCanvasId(url.searchParams.get('id'))) { answer(res, 400); return }
      asset = 'index.html'
    } else {
      const selected = safeAssetPath(req)
      if (!selected) { answer(res, 404); return }
      asset = selected
    }

    let bytes: Buffer
    try { bytes = await packagedAsset(dist, asset) }
    catch { answer(res, 404); return }
    if (asset === 'index.html') {
      let webOrigin: string
      try { webOrigin = desktopServiceProfile().web }
      catch { answer(res, 500); return }
      bytes = Buffer.from(bytes.toString('utf8').replace('<head>',
        `<head><meta name="desktop-canvas-web-origin" content="${webOrigin}">`))
    }
    res.writeHead(200, {
      'content-type': asset === 'index.html' ? 'text/html; charset=utf-8' : MIME[extname(asset).slice(1).toLowerCase()],
      'cache-control': 'no-store',
      'content-security-policy': CSP,
      'x-content-type-options': 'nosniff'
    })
    res.end(bytes)
  }
}

export function registerPageRoute(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: PREFIX,
    handler: pageHandler(connectionOf(ctx)) }), 'desktop-canvas: page')
}
