/** Authenticated, session-bound download of one generated image-layer file. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session-query'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Config } from './index.ts'
import { allowedResultUrl } from './result-cache.ts'
import { parseLayeringDelivery, RESULT_DOWNLOAD_PATH } from './shared/layering-files.ts'

const MAX_BYTES = 256 * 1024 * 1024

type ResultQuery = (handle: string, signal: AbortSignal) => Promise<{
  status: string
  psdUrls?: readonly string[]
  imageUrls?: readonly string[]
}>

/** Register the download route inside the existing authenticated Connection channel.
 * @param ctx - Session reader and authenticated browser route owner.
 * @param config - Result host allowlist.
 * @param query - Current-account read of the remote task; creation is never retried.
 */
export function registerResultDownload(ctx: Context, config: Config, query: ResultQuery): void {
  ctx.effect(() => ctx.connection.fetch.register({ path: RESULT_DOWNLOAD_PATH, methods: ['GET'], requestBody: 'buffered',
    fetch: async (request) => {
      const params = new URL(request.url).searchParams
      const sessionId = params.get('sessionId')
      const seqRaw = params.get('seq'), indexRaw = params.get('index')
      if (!sessionId || !seqRaw || !indexRaw || !/^\d+$/u.test(seqRaw) || !/^\d+$/u.test(indexRaw)) {
        return new Response('Invalid download coordinates.', { status: 400 })
      }
      const seq = Number(seqRaw), index = Number(indexRaw)
      if (!Number.isSafeInteger(seq) || !Number.isSafeInteger(index)) return new Response('Invalid download coordinates.', { status: 400 })
      try {
        const snapshot = await ctx.sessionQuery.readSession(SessionId(sessionId))
        const event = snapshot.events[seq]
        if (event?.type !== 'tool/result' || event.seq !== seq || event.data.message.isError) {
          return new Response('Result is unavailable in this Session.', { status: 404 })
        }
        const call = snapshot.events.slice(0, seq).findLast(item => item.type === 'tool/call'
          && item.data.callId === event.data.message.source.callId && item.data.turn === event.data.turn)
        if (call?.type !== 'tool/call' || call.data.name !== 'cache_image_layering_result') {
          return new Response('Result is unavailable in this Session.', { status: 404 })
        }
        const text = event.data.message.content.find(part => part.type === 'text')
        if (text?.type !== 'text') return new Response('Result is unavailable in this Session.', { status: 404 })
        const delivery = parseLayeringDelivery(JSON.parse(text.text) as unknown)
        if (delivery?.accountScope !== ctx.insightAccount.getAccountScope()) {
          return new Response('Result is unavailable for this account.', { status: 403 })
        }
        const file = delivery?.files[index]
        if (!file) return new Response('File is unavailable in this Session.', { status: 404 })
        const saved = allowedResultUrl(file.url, config)
        if (saved.kind !== file.kind) return new Response('File type changed.', { status: 422 })
        const latest = await query(delivery.taskHandle, request.signal)
        if (latest.status !== 'succeeded' && latest.status !== 'missing_psd') {
          return new Response('Result is no longer available.', { status: 409 })
        }
        const candidates = [...(latest.psdUrls ?? []), ...(latest.imageUrls ?? [])]
        const current = candidates.map(raw => allowedResultUrl(raw, config)).find(item =>
          item.kind === file.kind && item.url.origin === saved.url.origin && item.url.pathname === saved.url.pathname)
        if (!current) return new Response('File is no longer in the task result.', { status: 404 })
        const response = await fetch(current.url, { redirect: 'error', signal: request.signal })
        if (!response.ok || !response.body) return new Response('Remote file is unavailable.', { status: 502 })
        const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
        if (contentType === 'text/html' || contentType === 'application/json' || contentType === 'application/xml') {
          await response.body.cancel()
          return new Response('Remote file has an unexpected content type.', { status: 502 })
        }
        const length = response.headers.get('content-length')
        if (length && (!/^\d+$/u.test(length) || Number(length) > MAX_BYTES)) {
          await response.body.cancel()
          return new Response('Remote file is too large.', { status: 413 })
        }
        const reader = response.body.getReader()
        const required = file.kind === 'psd' ? 26 : file.kind === 'png' ? 8 : file.kind === 'jpg' ? 3 : 12
        const prefixChunks: Uint8Array[] = []
        let prefixBytes = 0
        while (prefixBytes < required) {
          const chunk = await reader.read()
          if (chunk.done) { await reader.cancel().catch(() => undefined)
            return new Response('Remote file is incomplete.', { status: 502 }) }
          prefixChunks.push(chunk.value); prefixBytes += chunk.value.byteLength
          if (prefixBytes > MAX_BYTES) { await reader.cancel().catch(() => undefined)
            return new Response('Remote file is too large.', { status: 413 }) }
        }
        const prefix = Buffer.concat(prefixChunks.map(chunk => Buffer.from(chunk)), prefixBytes)
        const valid = file.kind === 'psd' ? prefix.toString('ascii', 0, 4) === '8BPS' && prefix[4] === 0 && prefix[5] === 1
          : file.kind === 'png' ? prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : file.kind === 'jpg' ? prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255
              : prefix.toString('ascii', 0, 4) === 'RIFF' && prefix.toString('ascii', 8, 12) === 'WEBP'
        if (!valid) { await reader.cancel().catch(() => undefined)
          return new Response('Remote file content is invalid.', { status: 502 }) }
        let bytes = prefixBytes, sentPrefix = false
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              if (!sentPrefix) { sentPrefix = true; controller.enqueue(prefix); return }
              const chunk = await reader.read()
              if (chunk.done) {
                if (length !== null && bytes !== Number(length)) throw new Error('Remote file length changed.')
                controller.close(); return
              }
              bytes += chunk.value.byteLength
              if (bytes > MAX_BYTES) throw new Error('Remote file exceeds the download limit.')
              controller.enqueue(chunk.value)
            } catch (error) { await reader.cancel().catch(() => undefined); controller.error(error) }
          },
          cancel: () => reader.cancel(),
        })
        return new Response(body, { headers: { 'content-type': 'application/octet-stream',
          'content-disposition': `attachment; filename="${file.name}"`,
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
      } catch {
        if (request.signal.aborted) return new Response('Download cancelled.', { status: 499 })
        return new Response('Result download is unavailable.', { status: 502 })
      }
    },
  }), 'insight-media-upload: result download')
}
