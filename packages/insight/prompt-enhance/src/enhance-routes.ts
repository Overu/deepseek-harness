/** Authenticated Fetch routes for prompt enhancement. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { ENHANCE_ENDPOINT, ENHANCE_STREAM_ENDPOINT, type EnhanceError, type EnhanceRequestBody, type EnhanceResponse } from './shared/protocol.ts'
import { createStreamNormalizer } from './shared/stream-text.ts'
import { checkInputText } from './shared/validate.ts'
import type { Config } from './config.ts'
import { toEnhanceError } from './enhancer.ts'
import { runEnhance, sessionRouteOf } from './orchestrate.ts'

const encoder = new TextEncoder()
interface AdmissionGate { stamps: number[]; active: number }
function failure(status: number, error: EnhanceError, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('cache-control', 'no-store')
  return Response.json({ ok: false, error } satisfies EnhanceResponse, { status, headers: responseHeaders })
}
function bodyCapOf(maxInputChars: number): number { return maxInputChars * 6 + 4096 }
async function readBody(request: Request, cap: number): Promise<EnhanceRequestBody | Response> {
  const contentType = request.headers.get('content-type')
  if (contentType !== null && !contentType.toLowerCase().startsWith('application/json')) return failure(415, { code: 'rejected', message: '仅支持 application/json 请求体。' })
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > cap) return failure(413, { code: 'rejected', message: '请求体超过大小上限。' })
  let raw: ArrayBuffer
  try { raw = await request.arrayBuffer() } catch { return failure(422, { code: 'rejected', message: '请求体不是有效的 JSON。' }) }
  if (raw.byteLength > cap) return failure(413, { code: 'rejected', message: '请求体超过大小上限。' })
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder().decode(raw)) } catch { return failure(422, { code: 'rejected', message: '请求体不是有效的 JSON。' }) }
  if (parsed === null || typeof parsed !== 'object' || !('text' in parsed) || typeof parsed.text !== 'string') return failure(422, { code: 'rejected', message: '请求体必须是 { sessionId?, text } JSON。' })
  const sessionId = 'sessionId' in parsed && typeof parsed.sessionId === 'string' && parsed.sessionId !== '' ? parsed.sessionId : undefined
  return { text: parsed.text, ...(sessionId === undefined ? {} : { sessionId }) }
}
function admit(gate: AdmissionGate, config: Config): Response | undefined {
  const now = Date.now(); const cut = now - 60_000; const first = gate.stamps.findIndex(stamp => stamp >= cut)
  if (first > 0) gate.stamps.splice(0, first); else if (first === -1) gate.stamps.length = 0
  if (gate.stamps.length >= config.rateLimitPerMinute) {
    const retryAfterSeconds = Math.max(1, Math.ceil((60_000 - (now - (gate.stamps[0] ?? now))) / 1000))
    return failure(429, { code: 'rate-limit', params: { limit: config.rateLimitPerMinute, retryAfterSeconds } }, { 'retry-after': String(retryAfterSeconds) })
  }
  if (gate.active >= config.maxConcurrent) return failure(429, { code: 'concurrency-limit', params: { max: config.maxConcurrent } })
  gate.active += 1
}
async function prepare(
  readConfig: () => Config,
  gate: AdmissionGate,
  request: Request,
): Promise<{ body: EnhanceRequestBody; config: Config } | Response> {
  let config: Config
  try { config = readConfig() } catch (error) { return failure(500, { code: 'internal', message: `prompt-enhance 配置无效：${error instanceof Error ? error.message : String(error)}` }) }
  if (!config.enabled) return failure(403, { code: 'rejected', message: '提示词增强已在设置中关闭。' })
  const body = await readBody(request, bodyCapOf(config.maxInputChars)); if (body instanceof Response) return body
  const checked = checkInputText(body.text, config.maxInputChars)
  if (!checked.ok) return failure(422, checked.code === 'too-long' ? { code: 'rejected', params: { count: checked.count, max: checked.max } } : { code: 'rejected' })
  return admit(gate, config) ?? { body, config }
}
function options(ctx: Context, body: EnhanceRequestBody, request: Request) {
  const sessionRoute = sessionRouteOf(ctx, body.sessionId)
  return {
    text: body.text,
    signal: request.signal,
    ...(body.sessionId === undefined ? {} : { sessionId: body.sessionId }),
    ...(sessionRoute === undefined ? {} : { sessionRoute }),
  }
}
function statusOf(error: EnhanceError): number { return error.code === 'timeout' ? 504 : error.code === 'unconfigured' ? 409 : 502 }
async function serveOnce(ctx: Context, readConfig: () => Config, gate: AdmissionGate, request: Request): Promise<Response> {
  const prepared = await prepare(readConfig, gate, request); if (prepared instanceof Response) return prepared
  try {
    const value = await runEnhance(ctx, prepared.config, options(ctx, prepared.body, request)); gate.stamps.push(Date.now())
    return Response.json({ ok: true, value } satisfies EnhanceResponse, { headers: { 'cache-control': 'no-store' } })
  } catch (error) { const wire = toEnhanceError(error); return failure(statusOf(wire), wire) } finally { gate.active -= 1 }
}
async function serveStream(ctx: Context, readConfig: () => Config, gate: AdmissionGate, request: Request): Promise<Response> {
  const prepared = await prepare(readConfig, gate, request); if (prepared instanceof Response) return prepared
  const stream = new TransformStream<Uint8Array, Uint8Array>(); const writer = stream.writable.getWriter()
  const write = async (event: string, value: unknown): Promise<void> => writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`))
  void (async () => {
    try {
      const display = createStreamNormalizer()
      const value = await runEnhance(ctx, prepared.config, {
        ...options(ctx, prepared.body, request),
        onDelta: async (delta) => {
          const text = display.push(delta)
          if (text !== '') await write('delta', { type: 'delta', text })
        },
      })
      const tail = display.finish(); if (tail !== '') await write('delta', { type: 'delta', text: tail }); await write('done', { type: 'done', value }); gate.stamps.push(Date.now())
    } catch (error) { try { await write('error', { type: 'error', error: toEnhanceError(error) }) } catch { /* client cancelled */ } } finally { gate.active -= 1; try { await writer.close() } catch { /* already cancelled */ } }
  })()
  return new Response(stream.readable, { headers: { 'cache-control': 'no-store', 'content-type': 'text/event-stream; charset=utf-8' } })
}
/** Register exact routes inside Connection's owner-authenticated Fetch channel. */
export function registerEnhanceRoute(ctx: Context, readConfig: () => Config): void {
  const gate: AdmissionGate = { stamps: [], active: 0 }
  ctx.effect(() => ctx.connection.fetch.register({ path: ENHANCE_ENDPOINT, methods: ['POST'], requestBody: 'buffered', fetch: request => serveOnce(ctx, readConfig, gate, request) }), `prompt-enhance: ${ENHANCE_ENDPOINT}`)
  ctx.effect(() => ctx.connection.fetch.register({ path: ENHANCE_STREAM_ENDPOINT, methods: ['POST'], requestBody: 'buffered', fetch: request => serveStream(ctx, readConfig, gate, request) }), `prompt-enhance: ${ENHANCE_STREAM_ENDPOINT}`)
}
