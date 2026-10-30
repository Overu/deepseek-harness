import { registerCanvasRoute, type CanvasActivities } from './activities.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { parseCanvasId } from '../shared/protocol.ts'
import { requestCanvasJson } from './canvas-api.ts'
import { desktopServiceProfile } from './service-environment.ts'
import { isPublicAddress } from './remote-image-reader.ts'
const PATH = '/desktop-canvas/api/legacy/game-ai-editor-center/api/desktop/matting'
interface Connection {
  requestRejection(request: IncomingMessage): 401 | 403 | undefined
}
const validUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 4096) {
    return false
  }
  try {
    const u = new URL(value), host = u.hostname.replace(/^\[|\]$/g, '')
    return u.protocol === 'https:' && !u.username && !u.password && !u.hash && !u.port && host !== 'localhost' &&
 !host.endsWith('.localhost') && (!isIP(host) || isPublicAddress(host))
  }
  catch {
    return false
  }
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}
export function authorizedMattingSource(envelope: unknown, nodeId: string, outputIndex: number, expected: string): string {
  const response = record(envelope)
  const data = record(response?.data)
  if (response?.code !== 'SUCCESS' || !data) throw new Error('source_denied')
  const graph: unknown = typeof data.data === 'string' ? JSON.parse(data.data) : data.data
  const nodes = record(graph)?.nodes
  const node = Array.isArray(nodes) ? nodes.map(record).find(n => n?.id === nodeId && n.type === 'image') : undefined
  if (!node) throw new Error('source_denied')
  const source = record(node.data)
  const products: unknown[] = Array.isArray(source?.product) ? source.product : []
  const urls = [...new Set([source?.value, ...products.map(p => record(p)?.value)].filter((value): value is string => {
    if (typeof value !== 'string') return false
    try {
      const url = new URL(value)
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
        && ![...url.searchParams.keys()].some(key => /^(token|access_token|authorization|bridgekey)$/i.test(key))
    } catch { return false }
  }))]
  const selected = urls[outputIndex]
  if (!validUrl(selected) || selected !== expected) throw new Error('source_changed')
  return selected
}
export function mattingHandler(connection: Connection, deps: { read: (operation: 'get', body: unknown,
  signal?: AbortSignal) => Promise<unknown>
token: (signal?: AbortSignal) => Promise<string>
transport: typeof fetch }) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const answer = (status: number, value: object) => {
      if (res.destroyed) {
        return
      }
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff' })
      res.end(JSON.stringify(value))
    }
    const rejected = connection.requestRejection(req)
    if (rejected) {
      answer(rejected, { code: 'AUTH_REQUIRED', msg: 'browser session required' })
      return
    }
    if (req.url !== PATH || req.method !== 'POST') {
      answer(405, { code: 'INVALID_ARGUMENT', msg: '仅支持固定抠图POST入口' })
      return
    }
    if (!/^application\/json(?:\s*;|$)/i.test((req.headers['content-type'] ?? ''))) {
      answer(415, { code: 'INVALID_ARGUMENT', msg: '仅支持JSON' })
      return
    }
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)])
    res.once('close', () => {
      if (!res.writableEnded) {
        controller.abort()
      }
    })
    let submitted = false
    try {
      let bytes = 0
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        const value = Buffer.isBuffer(chunk) ? chunk : typeof chunk === 'string' ? Buffer.from(chunk) : undefined
        if (!value) throw new Error('invalid')
        bytes += value.length
        if (bytes > 12000) {
          throw new Error('invalid')
        }
        chunks.push(value)
      }
      const input = record(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (!input || Object.keys(input).sort().join(',') !== 'canvasId,expectedSourceUrl,outputIndex,sourceNodeId' ||
 !parseCanvasId(input.canvasId) || typeof input.sourceNodeId !== 'string' || !input.sourceNodeId.trim() ||
 input.sourceNodeId.length > 100 || typeof input.outputIndex !== 'number' || !Number.isInteger(input.outputIndex) ||
 input.outputIndex < 0 || input.outputIndex >= 20 || !validUrl(input.expectedSourceUrl)) {
        throw new Error('invalid')
      }
      const source = authorizedMattingSource(await deps.read('get', { id: input.canvasId }, signal),
        input.sourceNodeId, input.outputIndex, input.expectedSourceUrl)
      const profile = desktopServiceProfile(), token = await deps.token(signal)
      signal.throwIfAborted()
      submitted = true
      const response = await deps.transport(profile.matting + '/image/matting', { method: 'POST', headers: {
        'content-type': 'application/json', accept: 'application/json', token, origin: profile.web,
        referer: profile.web + '/' }, body: JSON.stringify({ inputImageUrl: source, clickCount: 1 }), signal, redirect: 'error' })
      const text = await response.text()
      if (text.length > 1000000) {
        throw new Error('unknown')
      }
      const result = record(JSON.parse(text))
      const output = record(result?.data)
      if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        answer(response.status, { code: 'RUN_REJECTED', msg: '抠图服务拒绝请求' })
        return
      }
      if (!response.ok || !['SUCCESS', 200, 0, '0'].some(code => code === result?.code) || !validUrl(output?.mattingImageUrl)) {
        throw new Error('unknown')
      }
      answer(200, { code: 'SUCCESS', data: { mattingImageUrl: output.mattingImageUrl } })
    }
    catch (error: unknown) {
      if (submitted) {
        answer(502, { code: 'SUBMISSION_UNKNOWN', msg: '抠图处理结果未确认，请勿重复提交' })
        return
      }
      const message = error instanceof Error ? error.message : ''
      const changed = message === 'source_changed', denied = message === 'source_denied'
      answer(changed ? 409 : denied ? 403 : message === 'invalid' ? 400 : 502, {
        code: changed ? 'VERSION_CONFLICT' : denied ? 'READ_ONLY' : 'INVALID_ARGUMENT',
        msg: changed ? '抠图来源已变化，请重新读取' : denied ? '无法确认画布图片来源权限' : '抠图前置检查未完成，尚未提交' })
    }
  }
}
export function registerMattingRoute(ctx: Context, token: (signal?: AbortSignal) => Promise<string>,
  activities?: CanvasActivities): void {
  ctx.effect(() => registerCanvasRoute(ctx, activities, { kind: 'exact', path: PATH,
    handler: mattingHandler(Reflect.get(ctx, 'connection') as Connection, { read: (operation, body,
      signal) => requestCanvasJson(operation, body, signal, { tokenProvider: token }), token, transport: fetch }) }),
  'desktop-canvas: fixed matting route')
}
