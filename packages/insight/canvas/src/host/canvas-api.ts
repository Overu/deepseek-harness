import type { ErrorCode } from '../shared/canvas-agent-protocol.ts'
import { MAX_TITLE_LENGTH } from '../shared/canvas-agent-protocol.ts'
import { parseCanvasId, type CanvasId } from '../shared/protocol.ts'
import { desktopToken } from './desktop-token.ts'
import { desktopServiceProfile } from './service-environment.ts'

export function desktopGatewayProfile(): { api: string; web: string } {
  try { const { api, web } = desktopServiceProfile(); return { api, web } }
  catch { throw new CanvasApiError('CONFIGURATION_ERROR', '桌面服务环境配置无效', 'not_sent') }
}
export interface CanvasApiDependencies { tokenProvider: (signal?: AbortSignal) => Promise<string>; transport: typeof fetch }
export interface CreatedCanvas { canvasId: CanvasId; name: string; version: string | null }
export class CanvasHttpError extends Error {
  constructor(readonly status: number) { super(`画布请求失败：HTTP ${status}`) }
}
export class CanvasApiError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly requestPhase: 'not_sent' | 'rejected' | 'submission_unknown') { super(message) }
}
export function canvasName(value: unknown = '新画布'): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_TITLE_LENGTH) {
    throw new CanvasApiError('INVALID_ARGUMENT', '画布名称需为1–100字符', 'not_sent')
  }
  return value.trim()
}
const unknown = () => new CanvasApiError('SUBMISSION_UNKNOWN', '画布创建结果未确认；请核对画布列表，不要自动重新创建', 'submission_unknown')
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** Only the existing list/get/saveOrUpdate endpoints, using the current desktop identity. */
export async function requestCanvasJson(
  operation: 'get' | 'create' | 'list', body: unknown, signal?: AbortSignal,
  { tokenProvider = desktopToken, transport = fetch }: Partial<CanvasApiDependencies> = {}
): Promise<unknown> {
  const profile = desktopGatewayProfile()
  let token: string
  try {
    signal?.throwIfAborted(); token = await tokenProvider(signal); signal?.throwIfAborted()
  } catch (cause) {
    if (operation !== 'create') throw cause
    throw new CanvasApiError(signal?.aborted ? 'CANCELLED_BEFORE_DISPATCH' : 'AUTH_REQUIRED', signal?.aborted ? '创建已取消，尚未发送' : '无法取得桌面登录态，请检查登录', 'not_sent')
  }
  let response: Response
  let text: string
  try {
    response = await transport(`${profile.api}/game-ai-editor-center/api/canvas/${operation === 'get' ? 'get' : operation === 'list' ? 'list' : 'saveOrUpdate'}`, {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', origin: profile.web, referer: `${profile.web}/`, token },
      body: JSON.stringify(body), redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
    })
    if (!response.ok) {
      if (operation !== 'create') throw new CanvasHttpError(response.status)
      if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        throw new CanvasApiError([401, 403].includes(response.status) ? 'AUTH_REQUIRED' : 'SAVE_REJECTED', `画布创建被拒绝：HTTP ${response.status}`, 'rejected')
      }
      throw unknown()
    }
    text = await response.text()
    if (text.length > 10_000_000) throw new Error('画布响应过大')
  } catch (cause) {
    if (operation !== 'create' || cause instanceof CanvasApiError) throw cause
    throw unknown()
  }
  try { return JSON.parse(text, (key: string, value: unknown, context?: { source: string }) => key === 'id' && typeof value === 'number' && !Number.isSafeInteger(value) && context && /^[1-9][0-9]{0,18}$/.test(context.source) ? context.source : value) }
  catch { if (operation === 'create') throw unknown(); throw new Error('画布服务响应不是有效 JSON') }
}

export async function createEmptyCanvas(name: string, signal?: AbortSignal, dependencies?: Partial<CanvasApiDependencies>): Promise<CreatedCanvas> {
  name = canvasName(name)
  const envelope = object(await requestCanvasJson('create', { name, temp: false, canvasType: 0, version: 'comfyui', data: '{"nodes":[],"edges":[]}' }, signal, dependencies))
  if (['USER_SESSION_EXPIRED', 'USER_NOT_LOGIN', -1].some(code => code === envelope?.code)) {
    throw new CanvasApiError('AUTH_REQUIRED', '桌面登录已失效，请重新登录后操作', 'rejected')
  }
  if (!envelope || typeof envelope.code !== 'string') throw unknown()
  if (envelope.code !== 'SUCCESS') throw new CanvasApiError('SAVE_REJECTED', '画布服务拒绝创建，请核对权限和名称', 'rejected')
  const data = object(envelope.data)
  const rawId = data ? data.id : envelope.data
  const id = typeof rawId === 'number' && Number.isSafeInteger(rawId) ? parseCanvasId(String(rawId))
    : typeof rawId === 'string' && rawId.length <= 19 ? parseCanvasId(rawId) : undefined
  if (!id) throw unknown()
  const rawVersion = data?.versionNumber
  const version = typeof rawVersion === 'number' && Number.isSafeInteger(rawVersion) && rawVersion >= 0 ? String(rawVersion)
    : typeof rawVersion === 'string' && rawVersion.trim() && rawVersion.length <= 100 ? rawVersion : null
  return { canvasId: id, name, version }
}
