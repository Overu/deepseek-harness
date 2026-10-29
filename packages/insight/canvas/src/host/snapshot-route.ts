import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { parseCanvasId, type CanvasId } from '../shared/protocol.ts'
import { CanvasHttpError, fetchCanvas, type CanvasSnapshot } from './canvas-get.ts'
import { LoginRequiredError } from './desktop-token.ts'

const PATH = '/desktop-canvas/api/snapshot'

interface BrowserConnection {
  requestRejection(request: IncomingMessage): 401 | 403 | undefined
}

function send(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** Authenticated read-only route shared by the first embedded page. */
export function snapshotHandler(
  connection: BrowserConnection,
  read: (id: CanvasId, signal: AbortSignal) => Promise<CanvasSnapshot>
) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const rejection = connection.requestRejection(req)
    if (rejection !== undefined) { send(res, rejection, { error: 'browser session required' }); return }
    if (req.method !== 'GET') { send(res, 405, { error: 'GET required' }); return }
    const id = parseCanvasId(new URL(req.url ?? '/', 'http://localhost').searchParams.get('id'))
    if (!id) { send(res, 400, { error: 'invalid canvas ID' }); return }
    const abort = new AbortController()
    res.once('close', () => abort.abort())
    try {
      send(res, 200, await read(id, abort.signal))
    } catch (error) {
      if (res.destroyed) return
      const status = error instanceof LoginRequiredError ? 401
        : error instanceof CanvasHttpError && [401, 403, 404, 429].includes(error.status) ? error.status : 502
      send(res, status, { error: status === 401 ? '请在桌面客户端重新登录' :
        status === 403 ? '没有画布访问权限' : status === 404 ? '画布不存在' :
        status === 429 ? '画布请求过于频繁' : '画布暂时不可用' })
    }
  }
}

export function registerSnapshotRoute(ctx: Context): void {
  const connection = Reflect.get(ctx, 'connection') as BrowserConnection
  const handler = snapshotHandler(connection, (id, signal) => fetchCanvas(id, undefined, undefined, signal))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: PATH, handler }), 'desktop-canvas: snapshot')
}
