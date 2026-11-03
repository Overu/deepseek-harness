/** Electron transport adaptation for Insight's authenticated update metadata. */
import { net } from 'electron'

/**
 * Fetch update metadata without following redirects, retaining Electron's session and proxy handling.
 * Electron can return an empty Response.url; only that missing value on a nonredirected response is filled.
 * The caller still validates the response URL, status, signatures, and payload identity before consuming it.
 * @param input - Absolute metadata URL or request supplied by the update resolver.
 * @param init - Fetch options with an explicit `redirect: 'error'`; other modes and omission are rejected.
 * @returns The original response with its missing URL filled from the canonical request URL.
 */
export async function fetchInsightUpdate(input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit): Promise<Response> {
  if (init?.redirect !== 'error') throw new Error('Insight update requests must reject redirects')
  const request = input instanceof Request ? input : String(input)
  const requestedUrl = input instanceof Request ? input.url : new URL(String(input)).href
  const response = await net.fetch(request, init)
  if (response.url === '' && !response.redirected) {
    Object.defineProperty(response, 'url', { value: requestedUrl })
  }
  return response
}
