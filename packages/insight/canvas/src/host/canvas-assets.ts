import { createRequire } from 'node:module'
import { createReadStream, type ReadStream } from 'node:fs'
import type { PreparedCanvasFile } from './media-inspector.ts'
import { exceedsMediaLimit } from '../shared/canvas-media.ts'
import type { StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { CanvasAgentError, parseCanvasAsset, type ErrorCode, type Failure } from '../shared/canvas-agent-protocol.ts'
import { parseCanvasId } from '../shared/protocol.ts'
import { CanvasApiError, desktopGatewayProfile } from './canvas-api.ts'
import { desktopToken } from './desktop-token.ts'
import { UPLOAD_LIBRARY_ID, UPLOAD_TYPE } from '../shared/upload/constants.ts'
import { assertUploadFile } from '../shared/upload/policies.ts'
import { buildPublicObjectUrl, createStoredFileName, joinObjectKey } from '../shared/upload/url.ts'

export interface AssetIdentity { userId: string; token: string }
export interface UploadedCanvasMedia {
  url: string; attachmentId?: string; mediaType: string; bytes: number; width?: number; height?: number; duration?: number; hasAudio?: boolean; sha256?: string
  originalDimensions?: { width: number; height: number }
}
export type AssetRegistration = { status: 'registered' } | { status: 'rejected' | 'registration_unknown'; error: Failure }
interface Credentials { accessKeyId: string; accessKeySecret: string; securityToken: string; bucket: string; region: string; dir: string }
export interface CanvasMediaPut { credentials: Credentials; objectKey: string; data: Uint8Array | ReadStream; mediaType: string; bytes: number }
export interface CanvasAssetDependencies {
  tokenProvider: (signal?: AbortSignal) => Promise<string>
  transport: typeof fetch
  put: (request: CanvasMediaPut) => Promise<unknown>
}
export class CanvasAssetApiError extends CanvasAgentError {
  constructor(code: ErrorCode, message: string, readonly requestPhase: 'not_sent' | 'rejected' | 'submission_unknown') { super(code, message) }
}
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const success = (code: unknown) => ['SUCCESS', 200, 0, '0'].includes(code as string | number)
const authFailure = (code: unknown) => ['USER_SESSION_EXPIRED', 'USER_NOT_LOGIN', -1].includes(code as string | number)
const nonempty = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim())
const cancelled = () => new CanvasAssetApiError('CANCELLED_BEFORE_DISPATCH', '素材操作已取消，尚未发送', 'not_sent')
const unknown = () => new CanvasAssetApiError('ASSET_UPLOAD_UNKNOWN', '素材上传结果未确认，请核对后再决定，不要自动重复上传', 'submission_unknown')
const rejected = () => new CanvasAssetApiError('ASSET_UPLOAD_REJECTED', '素材上传被拒绝，请核对文件与上传权限', 'not_sent')
const putRejected = () => new CanvasAssetApiError('ASSET_UPLOAD_REJECTED', '素材上传被服务拒绝，请核对上传权限', 'rejected')
const isPutRefusal = (status: unknown): boolean => typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 500 && status !== 408
function gateway() {
  try { return desktopGatewayProfile() }
  catch (cause) { if (cause instanceof CanvasApiError) throw new CanvasAssetApiError(cause.code, cause.message, cause.requestPhase); throw cause }
}
function longId(value: unknown): string | undefined {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : typeof value === 'string' ? value : ''
  return text.length <= 19 && parseCanvasId(text) ? text : undefined
}
// Node 22.12+ preserves each numeric JSON token in the reviver's source context.
function json(text: string): unknown {
  return JSON.parse(text, (key: string, value: unknown, context?: { source: string }) => {
    if (['id', 'userId'].includes(key) && typeof value === 'number' && !Number.isSafeInteger(value) && context && /^[1-9][0-9]{0,18}$/u.test(context.source)) return context.source
    return value
  })
}
function jsonWithLongId(body: Record<string, unknown>, field: 'userId' | 'canvasId', value: string): string {
  // Validated decimal digits only; emit the API's native numeric Long without Number conversion.
  if (!longId(value)) throw new CanvasAssetApiError('INVALID_ARGUMENT', '素材操作的标识无效', 'not_sent')
  const entries = Object.entries(body).map(([key, entry]) => `${JSON.stringify(key)}:${JSON.stringify(entry)}`)
  return `{${entries.join(',')},${JSON.stringify(field)}:${value}}`
}
async function waitPut(promise: Promise<unknown>, signal?: AbortSignal): Promise<unknown> {
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(unknown()) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
async function defaultPut(request: CanvasMediaPut): Promise<unknown> {
  const require = createRequire(import.meta.url)
  const OSS = require('ali-oss') as new (options: object) => { put(key: string, data: Buffer | ReadStream, options: object): Promise<unknown> }
  const client = new OSS({ bucket: request.credentials.bucket, region: request.credentials.region,
    accessKeyId: request.credentials.accessKeyId, accessKeySecret: request.credentials.accessKeySecret,
    stsToken: request.credentials.securityToken, secure: true, retryMax: 0, timeout: request.mediaType.startsWith('video/') ? 180_000 : 60_000 })
  return client.put(request.objectKey, request.data instanceof Uint8Array ? Buffer.from(request.data) : request.data, { mime: request.mediaType, contentLength: request.bytes, headers: { 'Cache-Control': 'max-age=31536000, immutable' } })
}
export function createCanvasAssetApi({ tokenProvider = desktopToken, transport = fetch, put = defaultPut }: Partial<CanvasAssetDependencies> = {}) {
  async function request(path: string, identity: Pick<AssetIdentity, 'token'>, body: string | undefined, signal?: AbortSignal, stage: 'prepare' | 'register' = 'prepare'): Promise<Record<string, unknown>> {
    const profile = gateway()
    if (signal?.aborted) throw cancelled()
    if (!nonempty(identity.token)) throw new CanvasAssetApiError('AUTH_REQUIRED', '无法确认当前桌面用户，请重新登录', 'not_sent')
    const unavailable = () => stage === 'prepare'
      ? new CanvasAssetApiError('CONTEXT_NOT_READY', '素材上传前置服务暂不可用，尚未上传', 'not_sent')
      : new CanvasAssetApiError('SUBMISSION_UNKNOWN', '素材入库结果未确认，请勿自动重复提交', 'submission_unknown')
    const refused = () => stage === 'prepare' ? rejected()
      : new CanvasAssetApiError('ASSET_REGISTRATION_REJECTED', '素材入库被拒绝，请核对素材权限', 'rejected')
    try {
      const response = await transport(`${profile.api}${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', origin: profile.web, referer: `${profile.web}/`, token: identity.token },
        ...(body === undefined ? {} : { body }), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) })
      if (!response.ok) {
        if ([401, 403].includes(response.status)) throw new CanvasAssetApiError('AUTH_REQUIRED', '桌面登录已失效，请重新登录', stage === 'prepare' ? 'not_sent' : 'rejected')
        if (response.status >= 400 && response.status < 500 && response.status !== 408) throw refused()
        throw unavailable()
      }
      const text = await response.text()
      if (text.length > 1_000_000) throw unavailable()
      const envelope = object(json(text))
      if (!envelope || envelope.code === undefined) throw unavailable()
      if (authFailure(envelope.code)) throw new CanvasAssetApiError('AUTH_REQUIRED', '桌面登录已失效，请重新登录', stage === 'prepare' ? 'not_sent' : 'rejected')
      if (!success(envelope.code)) throw refused()
      return envelope
    } catch (cause) { if (cause instanceof CanvasAssetApiError) throw cause; if (stage === 'prepare' && signal?.aborted) throw cancelled(); throw unavailable() }
  }
  return {
    async getIdentity(signal?: AbortSignal): Promise<AssetIdentity> {
      gateway()
      let token: string
      try { signal?.throwIfAborted(); token = await tokenProvider(signal); signal?.throwIfAborted() }
      catch { if (signal?.aborted) throw cancelled(); throw new CanvasAssetApiError('AUTH_REQUIRED', '无法取得桌面登录态，请检查登录', 'not_sent') }
      const envelope = await request('/user-server/getUserDetail', { token }, undefined, signal)
      const data = object(envelope.data ?? envelope.body) ?? envelope
      const userId = longId(data.id ?? data.userId)
      if (!userId) throw new CanvasAssetApiError('AUTH_REQUIRED', '无法确认当前桌面用户，请重新登录', 'not_sent')
      return { userId, token }
    },
    async getUploadCredentials(fileName: string, identity: AssetIdentity, signal?: AbortSignal): Promise<Record<string, unknown>> {
      const envelope = await request('/game-ai-editor-center/upload/sts/token', identity,
        jsonWithLongId({ fileName, libraryId: UPLOAD_LIBRARY_ID, type: UPLOAD_TYPE }, 'userId', identity.userId), signal)
      const data = object(envelope.data)
      if (!data || longId(data.userId) !== identity.userId) throw rejected()
      return { ...envelope, code: 'SUCCESS' }
    },
    async uploadMedia(stored: StoredImageAttachment | PreparedCanvasFile, identity: AssetIdentity, signal?: AbortSignal): Promise<UploadedCanvasMedia> {
      gateway()
      if (signal?.aborted) throw cancelled()
      const prepared = 'ref' in stored ? undefined : stored
      const ref = 'ref' in stored ? stored.ref : { mediaType: stored.mimeType, bytes: stored.bytes, width: stored.width, height: stored.height }
      const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/aac': 'aac' }
      const extension = extensions[ref.mediaType], type = prepared?.mediaType ?? 'image'
      if (!extension || type === 'text' || !ref.mediaType.startsWith(type + '/') || exceedsMediaLimit(type, ref.bytes) || ('ref' in stored && (!(stored.data instanceof Uint8Array) || stored.data.byteLength !== ref.bytes)) ||
        (type === 'image' || type === 'video') && (!Number.isSafeInteger(ref.width) || Number(ref.width) <= 0 || !Number.isSafeInteger(ref.height) || Number(ref.height) <= 0) ||
        (type === 'video' || type === 'audio') && (!Number.isFinite(prepared?.duration) || Number(prepared?.duration) <= 0 || type === 'video' && Number(prepared?.duration) > 300)) {
        throw new CanvasAssetApiError('INVALID_ARGUMENT', '素材文件信息无效', 'not_sent')
      }
      const fileName = `${type}.${extension}`
      try { if ('ref' in stored) assertUploadFile(new File([Buffer.from(stored.data)], fileName, { type: ref.mediaType }),
        { maxSizeBytes: 20 * 1024 * 1024, sizeBoundary: 'exclusive', allowedMimeTypes: Object.keys(extensions) }) }
      catch { throw new CanvasAssetApiError('INVALID_ARGUMENT', '图片格式或大小不符合画布上传要求', 'not_sent') }
      const envelope = await request('/game-ai-editor-center/upload/sts/token', identity,
        jsonWithLongId({ fileName, libraryId: UPLOAD_LIBRARY_ID, type: UPLOAD_TYPE }, 'userId', identity.userId), signal)
      const data = object(envelope.data)
      if (!data || longId(data.userId) !== identity.userId || !nonempty(data.bucket) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(data.bucket) ||
        !nonempty(data.region) || !/^oss-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(data.region) || typeof data.dir !== 'string' || data.dir.length > 512 ||
        /[\\\u0000-\u001f?#%]/u.test(data.dir) || data.dir.split('/').some(part => part === '.' || part === '..') ||
        !nonempty(data.expiration) || !Number.isFinite(Date.parse(data.expiration)) || Date.parse(data.expiration) <= Date.now() ||
        !nonempty(data.accessKeyId) || !nonempty(data.accessKeySecret) || !nonempty(data.securityToken)) throw rejected()
      const credentials: Credentials = { bucket: data.bucket, region: data.region, dir: data.dir,
        accessKeyId: data.accessKeyId, accessKeySecret: data.accessKeySecret, securityToken: data.securityToken }
      const objectKey = joinObjectKey(credentials.dir, createStoredFileName(fileName))
      if (signal?.aborted) throw cancelled()
      const uploadData = 'ref' in stored ? stored.data : createReadStream(stored.path)
      try {
        const result = object(await waitPut(put({ credentials, objectKey, data: uploadData, mediaType: ref.mediaType, bytes: ref.bytes }), signal))
        if (signal?.aborted) throw unknown()
        const status = object(result?.res)?.status
        if (isPutRefusal(status)) throw putRejected()
        if (status !== 200) throw unknown()
      } catch (cause) {
        if (signal?.aborted) throw unknown()
        if (cause instanceof CanvasAssetApiError) throw cause
        if (isPutRefusal(object(cause)?.status)) throw putRejected()
        throw unknown()
      } finally { if (!(uploadData instanceof Uint8Array)) uploadData.destroy() }
      return { url: buildPublicObjectUrl(credentials.bucket, credentials.region, objectKey),
        ...('ref' in stored ? { attachmentId: String(stored.ref.attachmentId), ...(stored.ref.originalDimensions ? { originalDimensions: { ...stored.ref.originalDimensions } } : {}) } : { sha256: stored.sha256, duration: stored.duration, hasAudio: stored.hasAudio }),
        mediaType: ref.mediaType, bytes: ref.bytes, ...(ref.width ? { width: ref.width, height: ref.height } : {}) }
    },
    async registerMedia(url: string, canvasId: string, nodeId: string, identity: AssetIdentity, signal?: AbortSignal, mediaType: 'image' | 'video' | 'audio' = 'image', duration?: number): Promise<AssetRegistration> {
      try {
        if (!longId(identity.userId)) throw new CanvasAssetApiError('AUTH_REQUIRED', '无法确认当前桌面用户，请重新登录', 'not_sent')
        try { parseCanvasAsset({ url }) }
        catch { throw new CanvasAssetApiError('INVALID_ARGUMENT', '素材入库地址无效', 'not_sent') }
        if (!nodeId || nodeId.length > 100 || /[\u0000-\u001f]/u.test(nodeId)) throw new CanvasAssetApiError('INVALID_ARGUMENT', '素材入库信息无效', 'not_sent')
        if (!['image', 'video', 'audio'].includes(mediaType) || mediaType !== 'image' && (!Number.isFinite(duration) || Number(duration) <= 0 || mediaType === 'video' && Number(duration) > 300)) throw new CanvasAssetApiError('INVALID_ARGUMENT', '素材类型或时长无效', 'not_sent')
        await request('/game-ai-editor-center/upload/asset', identity,
          jsonWithLongId({ assetType: { image: 1, video: 2, audio: 3 }[mediaType], fileUrl: url, nodeId, source: 0, sourceType: 'upload', ...(mediaType !== 'image' && duration !== undefined ? { duration: Math.ceil(duration) } : {}) }, 'canvasId', canvasId), signal, 'register')
        return { status: 'registered' }
      } catch (cause) {
        const error = cause instanceof CanvasAssetApiError ? cause : new CanvasAssetApiError('SUBMISSION_UNKNOWN', '素材入库结果未确认', 'submission_unknown')
        const uncertain = error.requestPhase === 'submission_unknown'
        return { status: uncertain ? 'registration_unknown' : 'rejected', error: { code: error.code,
          message: uncertain ? '画布已保存，素材入库结果未确认，请勿自动重复提交' : '画布已保存，素材入库未完成', retry: uncertain ? 'never_auto' : error.requestPhase === 'not_sent' ? 'after_input' : 'user_decision' } }
      }
    }
  }
}
