import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { desktopServiceProfile } from './service-environment.ts'

const PATH = '/desktop-canvas/api/model-params'
const MAX_RESPONSE_BYTES = 30_000_000
interface BrowserConnection {
  requestRejection(request: IncomingMessage): 401 | 403 | undefined
}

function send(res: ServerResponse, status: number, error: string): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  res.end(JSON.stringify({ error }))
}

async function readLimited(response: Response): Promise<Buffer> {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new Error('model params too large')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('empty model params')
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('model params too large')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

/** Read the same model configuration as the published canvas, through the plugin origin. */
export function modelParamsHandler(connection: BrowserConnection, transport: typeof fetch = fetch) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const rejection = connection.requestRejection(req)
    if (rejection !== undefined) { send(res, rejection, 'browser session required'); return }
    if (req.url !== PATH) { send(res, 404, 'unknown model params URL'); return }
    if (req.method !== 'GET') { send(res, 405, 'GET required'); return }

    let source: string
    try { source = desktopServiceProfile().modelParams }
    catch { send(res, 500, 'invalid desktop service environment'); return }
    const clientAbort = new AbortController()
    res.once('close', () => { if (!res.writableEnded) clientAbort.abort() })
    const signal = AbortSignal.any([clientAbort.signal, AbortSignal.timeout(30000)])
    try {
      const upstream = await transport(source, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal
      })
      if (clientAbort.signal.aborted) return
      if (!upstream.ok) { send(res, 502, 'model params unavailable'); return }
      const bytes = await readLimited(upstream)
      JSON.parse(bytes.toString('utf8'))
      if (clientAbort.signal.aborted) return
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      })
      res.end(bytes)
    } catch {
      if (clientAbort.signal.aborted || res.destroyed) return
      send(res, signal.aborted ? 504 : 502, signal.aborted ? 'model params timeout' : 'model params unavailable')
    }
  }
}

export function registerModelParamsRoute(ctx: Context): void {
  const connection = Reflect.get(ctx, 'connection') as BrowserConnection
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: PATH,
    handler: modelParamsHandler(connection) }), 'desktop-canvas: model params')
}
