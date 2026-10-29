/**
 * Minimal JSON body/response helpers for the plugin's host route, following
 * the describe-image route family's conventions: one strict bounded reader
 * and one JSON writer with family-default headers.
 * @module dsh-prompt-enhance/http
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Read a request body of at most `maxBytes` and parse it as JSON. On overflow
 * the reader stops consuming and throws WITHOUT destroying the request — the
 * route still owes the client a deliverable 413 response. Node discards the
 * unread remainder and closes the connection after the response ends.
 * @throws 'body too large' past the cap, or the JSON.parse error otherwise.
 */
export async function readBoundedJson(req: IncomingMessage, maxBytes: number, signal?: AbortSignal): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  const iterator = req[Symbol.asyncIterator]()
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error('body aborted'))
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
  try {
    while (true) {
      const next = await Promise.race([iterator.next(), aborted])
      if (next.done) break
      const buffer = next.value as Buffer
      size += buffer.length
      if (size > maxBytes) throw new Error('body too large')
      chunks.push(buffer)
    }
  } finally {
    if (onAbort !== undefined && !signal?.aborted) signal?.removeEventListener('abort', onAbort)
    if (signal?.aborted) {
      try {
        await iterator.return?.()
      } catch {
        // Destruction owns the transport; a reader that rejects while closing
        // must not keep the route's teardown from completing.
      }
    }
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Write one JSON response with family-default headers. Responses are dynamic
 * per-request results and must never be cached.
 */
export function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}
