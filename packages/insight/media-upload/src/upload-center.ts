/** Authenticated upload-center STS requests for direct OSS writes. */

import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'

/** Temporary OSS write authority for an uploaded object, kept in Host memory. */
export interface UploadSession {
  readonly credentials: {
    readonly bucket: string
    readonly region: string
    readonly accessKeyId: string
    readonly accessKeySecret: string
    readonly securityToken: string
  }
  /** Object key derived from the upload center's returned directory and file name. */
  readonly objectKey: string
  /** OSS object address; read access is not verified. */
  readonly uploadUrl: string
}

/** A safe, user-facing failure without response bodies or temporary credentials. */
export class UploadFailure extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const invalid = () => new UploadFailure('STS_RESPONSE_INVALID', 'Upload-center authorization is invalid; no OSS upload was started.')

/** Choose the upload-center routing category from the committed filename.
 * @param name - Filename of the selected stored attachment.
 * @returns The upload-center file type, independent of model arguments.
 */
export function objectFileType(name: string): 'image' | 'video' | 'audio' | 'file' {
  const ext = name.toLowerCase().split('.').pop()
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext ?? '')) return 'image'
  if (['mp4', 'mov', 'mkv', 'webm'].includes(ext ?? '')) return 'video'
  if (['mp3', 'wav', 'm4a', 'aac'].includes(ext ?? '')) return 'audio'
  return 'file'
}

/** Read a bounded JSON response without exposing raw service content.
 * @param response - Upload-center HTTP response with a readable body.
 * @returns Parsed JSON value, still untrusted until checked.
 */
async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw invalid()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > 131_072) throw invalid()
      chunks.push(next.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch { throw invalid() }
  finally { await reader.cancel().catch(() => undefined) }
}

/** Validate the upload-center credentials and construct the matching HTTPS OSS address.
 * @param value - Untrusted upload-center STS JSON value.
 * @param requestedType - Category requested for the selected attachment.
 * @returns Short-lived write credentials and the returned object's key and address.
 */
function parseSession(value: unknown, requestedType: ReturnType<typeof objectFileType>): UploadSession {
  const data = object(object(value)?.data)
  if (!data) throw invalid()
  const { bucket, region, endPoint, dir, fileName, fileType, expiration,
    accessKeyId, accessKeySecret, securityToken } = data
  if (!nonempty(bucket) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(bucket) ||
    !nonempty(region) || !/^oss-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(region) ||
    !nonempty(endPoint) || typeof dir !== 'string' || !nonempty(fileName) ||
    fileType !== requestedType || !nonempty(expiration) ||
    !Number.isFinite(Date.parse(expiration)) || Date.parse(expiration) <= Date.now() + 30_000 ||
    !nonempty(accessKeyId) || !nonempty(accessKeySecret) || !nonempty(securityToken) ||
    /[\\\u0000-\u001f?#%]/u.test(dir) || /[\\/\u0000-\u001f?#%]/u.test(fileName) ||
    fileName === '.' || fileName === '..') throw invalid()
  const normalizedDir = dir.replace(/^\/+|\/+$/gu, '')
  const parts = normalizedDir ? normalizedDir.split('/') : []
  if (parts.some(part => !part || part === '.' || part === '..')) throw invalid()
  const key = [...parts, fileName].join('/')
  if (key.length > 512) throw invalid()
  let endpoint: URL
  try { endpoint = new URL(endPoint.startsWith('https://') ? endPoint : `https://${endPoint}`) }
  catch { throw invalid() }
  if (endpoint.protocol !== 'https:' || endpoint.hostname !== `${region}.aliyuncs.com` || endpoint.port ||
    endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw invalid()
  const encoded = key.split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/gu,
    char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join('/')
  return { credentials: { bucket, region, accessKeyId, accessKeySecret, securityToken },
    objectKey: key, uploadUrl: `https://${bucket}.${endpoint.hostname}/${encoded}` }
}

/** Request one short-lived OSS upload session for a selected stored file.
 * @param baseUrl - Fixed HTTPS upload-center base including its gateway path.
 * @param token - Current Desktop account access token, never logged or returned.
 * @param file - Committed file or normalized-image copy.
 * @param signal - Cancellation and request deadline.
 * @param transport - HTTP implementation, replaced only in protocol tests.
 * @returns Validated temporary OSS authority and object address.
 */
export async function requestUploadSession(baseUrl: string, token: string, file: FileAttachmentRef,
  signal: AbortSignal, transport: typeof fetch = fetch): Promise<UploadSession> {
  signal.throwIfAborted()
  const type = objectFileType(file.name)
  const url = new URL('upload/sts/token', `${baseUrl}/`)
  if (url.protocol !== 'https:' || url.origin !== new URL(baseUrl).origin || url.username || url.password ||
    url.pathname !== '/game-ai-editor-center/upload/sts/token') {
    throw new UploadFailure('CONFIGURATION_ERROR', 'Upload-center service URL is invalid.')
  }
  let response: Response
  try {
    response = await transport(url, { method: 'POST', redirect: 'error', signal,
      headers: { token, accept: 'application/json', 'accept-language': 'zh_CN', 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, libraryId: '1001', type: 1, fileType: type }) })
  } catch { throw new UploadFailure('STS_UNAVAILABLE', 'Upload-center authorization is unavailable; no OSS upload was started.') }
  let body: unknown
  try { body = await readJson(response) }
  catch (error) { if (response.ok) throw error }
  const envelope = object(body)
  const rawCode = envelope?.code ?? object(envelope?.error)?.code
  const serviceCode = typeof rawCode === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/u.test(rawCode) ? rawCode : undefined
  if (!response.ok || rawCode !== 'SUCCESS') {
    const auth = response.status === 401 || response.status === 403 ||
      rawCode === 'USER_NOT_LOGIN' || rawCode === 'USER_SESSION_EXPIRED'
    throw new UploadFailure(auth ? 'AUTH_REQUIRED' : 'STS_REJECTED',
      `Upload-center authorization failed (HTTP ${response.status}${serviceCode ? `, ${serviceCode}` : ''}); no OSS upload was started.`)
  }
  return parseSession(envelope, type)
}
