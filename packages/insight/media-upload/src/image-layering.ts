/** Authenticated image-layer generation through the enterprise skill proxy. */
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId, type FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-jobs'
import type { ProjectionDefinition, ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createInsightSkillProxyRequest, InsightSkillProxyError, skillProxyServiceBaseUrl } from '@insight-ai/desktop-integration/host'
import type { Config } from './index.ts'
import type { LayeringSource } from './upload-source.ts'
import { cacheLayeringFiles, copyLayeringFilesToCurrentDirectory, prepareResultDirectory, ResultDownloadFailure } from './result-cache.ts'

interface BoundTask {
  readonly requestKey: string
  readonly file: FileAttachmentRef
  readonly prompt: string
  readonly numLayers: number
  readonly cwd: string
  readonly accountScope: string
  readonly attempt: 1 | 2
  readonly state: 'reserved' | 'bound' | 'retry_eligible' | 'released'
  readonly handle?: string | undefined
  readonly firstHandle?: string | undefined
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Durable reservation before a potentially paid image-layering creation. */
    'insight/image-layering/task': { readonly task: BoundTask }
  }
}

const taskSchema: z.ZodType<BoundTask> = z.object({
  requestKey: z.string(), file: z.object({ attachmentId: z.string().regex(/^sha256:[a-f0-9]{64}$/u).transform(AttachmentId),
    name: z.string(), bytes: z.number().int().positive() }),
  prompt: z.string(), numLayers: z.number().int().nonnegative(), cwd: z.string(), accountScope: z.string(),
  attempt: z.union([z.literal(1), z.literal(2)]),
  state: z.enum(['reserved', 'bound', 'retry_eligible', 'released']),
  handle: z.string().optional(), firstHandle: z.string().optional(),
})

/** Session-owned creation reservations and task bindings for restart-safe recovery. */
export const layeringTasksProjection = {
  key: 'insightImageLayeringTasks', stateVersion: 1,
  stateSchema: z.record(z.string(), taskSchema),
  init: () => ({}),
  apply: (state, event: SessionEvent) => event.type === 'insight/image-layering/task'
    ? { ...state, [event.data.task.requestKey]: event.data.task } : state,
} satisfies ProjectionDefinition<'insightImageLayeringTasks', Record<string, BoundTask>>

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    /** Session-owned polling of one enterprise image-layer task. */
    'image-layering': 'image-layering'
  }
}

interface LayeringResult {
  readonly taskHandle: string
  readonly status: 'running' | 'succeeded' | 'missing_psd' | 'failed' | 'cancelled' | 'retry_eligible' | 'query_unavailable'
  readonly reason?: QueryFailureReason
  readonly businessCode?: number
  readonly remoteOutcome?: 'unknown'
  readonly psdUrls?: string[]
  readonly imageUrls?: string[]
  readonly imageListValid?: boolean
  readonly error?: string
  readonly jobId?: string
  readonly monitoring?: 'running' | 'unavailable'
  readonly proxyRequestId?: string
  readonly diagnostic?: {
    readonly field: 'psd_url' | 'image_list'
    readonly reason: string
    readonly valueType: string
    readonly psdCandidates: number
    readonly imageItems?: number
    readonly validImages?: number
    readonly invalidIndices?: number[]
    readonly queryAttempt?: number
  }
}

type QueryFailureReason = 'business_error' | 'query_timeout' | 'invalid_response' | 'transport_error'

/** Stable failures for proxy submission and status reads. */
export class ImageLayeringFailure extends Error {
  /** @param code - Failure category for callers.
   * @param message - Actionable detail without upstream response text.
   * @param options - Original Host-only cause.
   * @param query - Safe query failure details for tool and Job results.
   */
  constructor(readonly code: 'AUTH_REQUIRED' | 'SUBMISSION_UNKNOWN' | 'SUBMISSION_REJECTED'
    | 'AUTH_UNAVAILABLE' | 'STATUS_UNAVAILABLE' | 'INVALID_RESPONSE', message: string, options?: ErrorOptions,
  readonly query?: { reason: QueryFailureReason; businessCode?: number; proxyRequestId?: string }) {
    super(`${code}: ${message}`, options)
    this.name = 'ImageLayeringFailure'
  }
}

const output = {
  schema: { type: 'object', additionalProperties: false, properties: {
    taskHandle: { type: 'string', required: true },
    status: { type: 'string', enum: ['running', 'succeeded', 'missing_psd', 'failed', 'cancelled', 'retry_eligible', 'query_unavailable'],
      description: 'State of this image task; query_unavailable stops local tracking without confirming the remote outcome.', required: true },
    reason: { type: 'string', enum: ['business_error', 'query_timeout', 'invalid_response', 'transport_error'],
      description: 'Why a status query became unavailable; only query_timeout receives one automatic same-handle retry.' },
    businessCode: { type: 'integer', description: 'Safe upstream business code when a status query returned one.' },
    remoteOutcome: { type: 'string', enum: ['unknown'], description: 'Remote generation outcome is unconfirmed after a query error.' },
    psdUrls: { type: 'array', items: { type: 'string' } },
    imageUrls: { type: 'array', items: { type: 'string' } },
    imageListValid: { type: 'boolean' },
    error: { type: 'string' }, jobId: { type: 'string' }, proxyRequestId: { type: 'string' },
    monitoring: { type: 'string', enum: ['running', 'unavailable'] },
    diagnostic: { type: 'object', additionalProperties: false, properties: {
      field: { type: 'string', enum: ['psd_url', 'image_list'], required: true },
      reason: { type: 'string', required: true }, valueType: { type: 'string', required: true },
      psdCandidates: { type: 'integer', required: true }, imageItems: { type: 'integer' },
      validImages: { type: 'integer' }, invalidIndices: { type: 'array', items: { type: 'integer' } },
      queryAttempt: { type: 'integer' },
    } },
  } },
  render: (_args: unknown, value: LayeringResult) => [{ type: 'text' as const, text: JSON.stringify(value) }],
} as const

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function safeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8192) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
  } catch { return false }
}

function safeResultUrl(value: unknown): value is string {
  return safeUrl(value) && /\.(psd|png|jpe?g|webp)$/iu.test(new URL(value).pathname)
}

function valueType(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
}

function urlReason(value: unknown): string {
  if (typeof value !== 'string') return 'not_string'
  if (value.length > 8192) return 'too_long'
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return 'non_https'
    if (url.username || url.password || url.hash) return 'credentials_or_fragment'
    if (!url.pathname.toLowerCase().endsWith('.psd')) return 'not_psd_path'
    return 'valid'
  } catch { return 'invalid_url' }
}

function taskHandle(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
}

/** Read the bounded NDJSON stream through its single terminal event.
 * @param response - Authenticated proxy response.
 * @returns Terminal event and optional audit request ID.
 */
async function terminalEvent(response: Response): Promise<{ event: Record<string, unknown>; proxyRequestId?: string }> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Proxy response has no event stream.')
  const requestId = response.headers.get('X-Insight-Proxy-Request-Id')
  const proxyRequestId = requestId && /^[0-9a-f-]{36}$/iu.test(requestId) ? requestId : undefined
  const decoder = new TextDecoder()
  let pending = ''
  let bytes = 0
  let terminal: Record<string, unknown> | undefined
  const line = (value: string) => {
    if (!value.trim()) return
    if (Buffer.byteLength(value) > 8 * 1024 * 1024) throw new Error('Proxy event is too large.')
    const event = object(JSON.parse(value))
    if (!event || typeof event.type !== 'string') throw new Error('Proxy event is invalid.')
    if (terminal) throw new Error('Proxy sent more than one terminal event.')
    if (event.type === 'result' || event.type === 'error') terminal = event
    else if (event.type !== 'accepted' && event.type !== 'heartbeat') throw new Error('Proxy event type is unknown.')
  }
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 9 * 1024 * 1024) throw new Error('Proxy stream is too large.')
      pending += decoder.decode(chunk.value, { stream: true })
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        line(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
      }
      if (Buffer.byteLength(pending) > 8 * 1024 * 1024) throw new Error('Proxy event is too large.')
    }
    pending += decoder.decode()
    line(pending)
    if (!terminal) throw new Error('Proxy stream ended without a result.')
    return { event: terminal, ...(proxyRequestId ? { proxyRequestId } : {}) }
  } finally { await reader.cancel().catch(() => undefined) }
}

/** Send one authenticated operation without retrying it.
 * @param ctx - Host account capability.
 * @param base - Fixed enterprise service base.
 * @param path - Allowed upstream operation.
 * @param body - Operation-specific request fields.
 * @param timeoutMs - Proxy operation deadline.
 * @param signal - Tool, Job, and plugin cancellation.
 * @returns Validated business JSON and audit request ID.
 */
async function requestProxy(ctx: Context, base: string, path: '/v1/proxy_async_create' | '/v1/proxy_async_get_result',
  body: object, timeoutMs: number, signal: AbortSignal): Promise<{ body: Record<string, unknown>; proxyRequestId?: string }> {
  const creating = path === '/v1/proxy_async_create'
  let responseRequestId: string | undefined
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  try {
    const request = createInsightSkillProxyRequest(base, ctx.insightAccount)
    const response = await request('/api/skill-proxy/call-insight-api', {
      method: 'POST', body: JSON.stringify({ method: 'POST', path, body }),
      signal: AbortSignal.any([signal, timeoutSignal]),
    })
    const requestId = response.headers.get('X-Insight-Proxy-Request-Id')
    responseRequestId = requestId && /^[0-9a-f-]{36}$/iu.test(requestId) ? requestId : undefined
    const { event, proxyRequestId } = await terminalEvent(response)
    if (event.type === 'error') {
      const code = typeof event.code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/u.test(event.code)
        ? event.code : 'SKILL_PROXY_FAILED'
      if (code === 'LOGIN_REQUIRED' || code === 'USER_NOT_LOGIN' || event.status === 401 || event.status === 403) {
        throw new ImageLayeringFailure('AUTH_REQUIRED', 'Sign in or request access before generating image layers.')
      }
      throw new ImageLayeringFailure(creating && ((typeof event.status === 'number' && event.status >= 500)
        || /UNKNOWN|TIMEOUT/u.test(code)) ? 'SUBMISSION_UNKNOWN'
        : creating ? 'SUBMISSION_REJECTED' : 'STATUS_UNAVAILABLE',
      `${code}${proxyRequestId ? ` (request ${proxyRequestId})` : ''}.`, undefined,
      creating ? undefined : { reason: 'business_error', ...(proxyRequestId ? { proxyRequestId } : {}) })
    }
    const result = object(event.body)
    if (typeof event.status !== 'number' || event.status < 200 || event.status >= 300 || result?.code !== 0) {
      if (event.status === 401 || event.status === 403) {
        throw new ImageLayeringFailure('AUTH_REQUIRED', 'Sign in or request access before generating image layers.')
      }
      const businessCode = typeof result?.code === 'number' && Number.isSafeInteger(result.code)
        ? result.code : undefined
      throw new ImageLayeringFailure(creating && (typeof event.status !== 'number' || event.status >= 500)
        ? 'SUBMISSION_UNKNOWN' : creating ? 'SUBMISSION_REJECTED' : 'STATUS_UNAVAILABLE',
      `Proxy operation returned upstream HTTP ${String(event.status)}${businessCode === undefined ? '' : `, business code ${businessCode}`}${proxyRequestId ? ` (request ${proxyRequestId})` : ''}.`,
      undefined, creating ? undefined : { reason: 'business_error', ...(businessCode === undefined ? {} : { businessCode }),
        ...(proxyRequestId ? { proxyRequestId } : {}) })
    }
    return { body: result, ...(proxyRequestId ? { proxyRequestId } : {}) }
  } catch (error) {
    if (error instanceof ImageLayeringFailure) throw error
    if (signal.aborted) throw error
    if (error instanceof InsightSkillProxyError && (error.code === 'LOGIN_REQUIRED' || error.status === 401 || error.status === 403)) {
      throw new ImageLayeringFailure('AUTH_REQUIRED', 'Sign in or request access before generating image layers.', { cause: error })
    }
    if (error instanceof InsightSkillProxyError && error.code === 'SKILL_PROXY_AUTH_UNAVAILABLE') {
      throw new ImageLayeringFailure('AUTH_UNAVAILABLE', 'Authentication service is unavailable; stop new image submissions.', { cause: error })
    }
    if (error instanceof InsightSkillProxyError && !creating) {
      throw new ImageLayeringFailure('STATUS_UNAVAILABLE', `${error.code} (HTTP ${error.status}).`, { cause: error },
        { reason: timeoutSignal.aborted ? 'query_timeout' : 'transport_error',
          ...(responseRequestId ? { proxyRequestId: responseRequestId } : {}) })
    }
    if (error instanceof InsightSkillProxyError && error.code !== 'SKILL_PROXY_OUTCOME_UNKNOWN'
      && error.status >= 400 && error.status < 500) {
      throw new ImageLayeringFailure('SUBMISSION_REJECTED', `${error.code} (HTTP ${error.status}).`, { cause: error })
    }
    throw new ImageLayeringFailure(creating ? 'SUBMISSION_UNKNOWN' : 'STATUS_UNAVAILABLE',
      creating ? `Submission outcome is unknown${responseRequestId ? ` (request ${responseRequestId})` : ''}; check proxy audit before creating another task.`
        : `Task status could not be read${responseRequestId ? ` (request ${responseRequestId})` : ''}.`, { cause: error },
      creating ? undefined : { reason: timeoutSignal.aborted ? 'query_timeout' : 'invalid_response',
        ...(responseRequestId ? { proxyRequestId: responseRequestId } : {}) })
  }
}

/** Extract the single user-bound handle from a successful creation.
 * @param value - Successful proxy business body.
 * @returns Handle to use verbatim for status reads.
 */
export function parseTaskHandle(value: unknown): string {
  const handles = object(object(value)?.data)?.task_id_list
  if (!Array.isArray(handles) || handles.length !== 1 || !taskHandle(handles[0])) {
    throw new ImageLayeringFailure('SUBMISSION_UNKNOWN', 'Creation returned no single usable task handle; inspect proxy audit before retrying.')
  }
  return handles[0]
}

/** Locate PSD URLs in the query result's image_list or separate psd_url.
 * @param value - Successful proxy business body.
 * @param handle - Original user-bound task handle.
 * @param proxyRequestId - Optional audit identifier for this query.
 * @returns Task state with PSD candidates separated from other images.
 */
export function parseLayeringResult(value: unknown, handle: string, proxyRequestId?: string): LayeringResult {
  const row = object(value)
  const metadata = proxyRequestId ? { proxyRequestId } : {}
  if (row?.status === 'running' || row?.status === 'pending') return { taskHandle: handle, status: 'running', ...metadata }
  if (row?.status === 'failed') return { taskHandle: handle, status: 'failed',
    error: 'Upstream generation failed.', ...metadata }
  if (row?.status === 'cancelled') return { taskHandle: handle, status: 'cancelled',
    error: 'Upstream generation was cancelled.', ...metadata }
  if (row?.status !== 'success') throw new ImageLayeringFailure('STATUS_UNAVAILABLE', 'Upstream task status is unknown.')
  const data = object(row.data)
  const images = data?.image_list
  const imageListValid = Array.isArray(images) && images.length <= 128 && images.every(item => safeResultUrl(item))
  const imageListReason = imageListValid ? undefined
    : !Array.isArray(images) ? 'not_array' : images.length > 128 ? 'too_many_items' : 'invalid_item_url'
  const separatePsd = data?.psd_url
  const imageUrls = Array.isArray(images) && images.length <= 128 ? images.filter(item => safeResultUrl(item)) : []
  const psdUrls = imageUrls.filter(url => new URL(url).pathname.toLowerCase().endsWith('.psd'))
  const reason = separatePsd === undefined ? 'missing' : urlReason(separatePsd)
  if (reason === 'valid' && typeof separatePsd === 'string' && !psdUrls.includes(separatePsd)) psdUrls.push(separatePsd)
  const diagnostic = imageListReason ? { field: 'image_list' as const, reason: imageListReason,
    valueType: valueType(images), psdCandidates: psdUrls.length,
    imageItems: Array.isArray(images) ? images.length : 0, validImages: imageUrls.length,
    invalidIndices: Array.isArray(images) ? images.flatMap((item, index) => safeResultUrl(item) ? [] : [index]).slice(0, 5) : [] }
    : reason !== 'valid' && (reason !== 'missing' || psdUrls.length === 0) ? { field: 'psd_url' as const, reason,
      valueType: valueType(separatePsd), psdCandidates: psdUrls.length } : undefined
  if (psdUrls.length === 0) return { taskHandle: handle, status: 'missing_psd', imageUrls, imageListValid,
    error: diagnostic ? `Successful task has invalid ${diagnostic.field} (${diagnostic.reason}, type ${diagnostic.valueType}).`
      : 'Upstream generation completed without a PSD file.', ...metadata, ...(diagnostic ? { diagnostic } : {}) }
  return { taskHandle: handle, status: 'succeeded', psdUrls, imageUrls, imageListValid, ...metadata,
    ...(diagnostic ? { diagnostic } : {}) }
}

/** Register submission and recovery tools beside the approved OSS upload tool.
 * @param ctx - Host tool, account, Agent, and Jobs services.
 * @param config - Validated environment and tracking limits.
 * @param uploadedInTurn - Check that the URL came from this turn's successful upload.
 */
export function registerImageLayeringTools(ctx: Context, config: Config,
  uploadedInTurn: (exec: ToolRunContext, url: string) => boolean,
  source?: {
    list(exec: ToolRunContext): LayeringSource[]
    select(exec: ToolRunContext, sourceRef: string | undefined): FileAttachmentRef
    requestTurn(exec: ToolRunContext): number
    upload(exec: ToolRunContext, file: FileAttachmentRef): Promise<string>
  },
  tasks?: ProjectionHandle<Record<string, BoundTask>>): void {
  const base = skillProxyServiceBaseUrl(config.serviceEnvironment)
  const lifetime = new AbortController()
  const watching = new Map<string, string>()
  const requireAgent = (exec: ToolRunContext) => {
    const agent = exec.agent
    if (!agent || !ctx.agents.roots().includes(agent)) throw new Error('Use image layering in the original user conversation.')
    return agent
  }
  const findTask = (exec: ToolRunContext, handle: string): BoundTask | undefined => {
    if (!tasks) return undefined
    const agent = requireAgent(exec)
    const task = Object.values(tasks.stateOf(agent.session)).find(item => item.handle === handle || item.firstHandle === handle)
    if (task && task.accountScope !== ctx.insightAccount.getAccountScope()) {
      throw new ImageLayeringFailure('AUTH_REQUIRED', 'This image-layering task belongs to another signed-in account.')
    }
    return task
  }
  const appendTask = (exec: ToolRunContext, task: BoundTask): void => {
    requireAgent(exec).session.append('insight/image-layering/task', { task })
  }
  const getResult = async (handle: string, signal: AbortSignal, attempt = 1) => {
    const result = await requestProxy(ctx, base, '/v1/proxy_async_get_result',
      { task_type: 'async_tencent_multi_layer_get_result', task_id: handle }, config.generationRequestTimeoutMs, signal)
    let value: LayeringResult
    try { value = parseLayeringResult(result.body, handle, result.proxyRequestId) }
    catch (error) {
      if (!(error instanceof ImageLayeringFailure) || error.code !== 'STATUS_UNAVAILABLE') throw error
      throw new ImageLayeringFailure('STATUS_UNAVAILABLE', error.message, { cause: error },
        { reason: 'invalid_response', ...(result.proxyRequestId ? { proxyRequestId: result.proxyRequestId } : {}) })
    }
    if (!value.diagnostic) return value
    const diagnostic = { ...value.diagnostic, queryAttempt: attempt }
    ctx.logger.warn(`insight-media-upload: image-layering result diagnostic ${JSON.stringify({
      ...diagnostic, proxyRequestId: result.proxyRequestId ?? null })}`)
    return { ...value, diagnostic }
  }
  const readStatus = async (handle: string, signal: AbortSignal, deadline?: number): Promise<LayeringResult> => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { return await getResult(handle, signal, attempt) }
      catch (error) {
        if (signal.aborted || !(error instanceof ImageLayeringFailure)
          || (error.code !== 'STATUS_UNAVAILABLE' && error.code !== 'INVALID_RESPONSE')) throw error
        const reason = error.query?.reason ?? 'invalid_response'
        if (reason === 'query_timeout' && attempt === 1 && (deadline === undefined || Date.now() < deadline)) continue
        return { taskHandle: handle, status: 'query_unavailable', reason, remoteOutcome: 'unknown',
          ...(error.query?.businessCode === undefined ? {} : { businessCode: error.query.businessCode }),
          ...(error.query?.proxyRequestId ? { proxyRequestId: error.query.proxyRequestId } : {}) }
      }
    }
    throw new Error('Status query exceeded its retry limit.')
  }
  const cacheResult = async (exec: ToolRunContext, task: BoundTask, handle: string,
    initial: LayeringResult, signal: AbortSignal) => {
    const agent = requireAgent(exec)
    let result = initial
    if (result.status !== 'succeeded' && result.status !== 'missing_psd') {
      throw new Error('Image-layering result is not ready for local caching.')
    }
    const download = (value: LayeringResult) => cacheLayeringFiles(ctx, agent, config, handle,
      [...(value.psdUrls ?? []), ...(value.imageUrls ?? [])], task.cwd, signal)
    let cached: Awaited<ReturnType<typeof download>>
    try { cached = await download(result) }
    catch (error) {
      if (!(error instanceof ResultDownloadFailure) || signal.aborted) throw error
      result = await getResult(handle, signal, 2)
      if (result.status !== 'succeeded' && result.status !== 'missing_psd') {
        throw new Error('Result download failed and the task could not provide refreshed file addresses.', { cause: error })
      }
      cached = await download(result)
    }
    let files = cached
    let relocationFailed = false
    if (ctx.workingDirectory.get(agent.session) !== task.cwd) {
      try { files = await copyLayeringFilesToCurrentDirectory(ctx, agent, cached, signal) }
      catch { if (signal.aborted) throw new Error('Result transfer was cancelled.'); relocationFailed = true }
    }
    return { complete: result.status === 'succeeded' && result.imageListValid === true
      && files.some(file => file.kind === 'psd'), relocationFailed, files }
  }
  const startWatch = (exec: ToolRunContext, handle: string): string => {
    if (exec.signal.aborted || lifetime.signal.aborted) throw new Error('Local tracking is unavailable.')
    const agent = requireAgent(exec)
    const key = `${String(agent.session.id)}:${handle}`
    const active = watching.get(key)
    if (active) return active
    const id = ctx.jobs.start({ kind: 'image-layering', owner: agent.id,
      label: 'Image layering', toolCall: { callId: exec.callId, rootCallId: exec.rootCallId },
      run(job) {
        const controller = new AbortController()
        const signal = AbortSignal.any([controller.signal, lifetime.signal])
        let settled = false
        let settle!: (outcome: JobOutcome) => void
        const done = new Promise<JobOutcome>((resolve) => { settle = resolve })
        const finish = (outcome: JobOutcome) => {
          if (settled) return
          settled = true
          lifetime.signal.removeEventListener('abort', cancel)
          watching.delete(key)
          settle(outcome)
        }
        const stop = () => { finish({ status: 'killed',
          detail: 'Stopped local tracking; remote generation may continue.',
          result: JSON.stringify({ taskHandle: handle, status: 'monitoring_stopped' }) }) }
        const cancel = () => { controller.abort() }
        const poll = async () => {
          const deadline = Date.now() + config.generationWatchTimeoutMs
          try {
            while (!signal.aborted && Date.now() < deadline) {
              const value = await readStatus(handle, signal, deadline)
              if (value.status === 'query_unavailable') {
                finish({ status: 'failed', detail: 'Local tracking stopped; remote status is unknown.',
                  result: JSON.stringify(value) }); return
              }
              if (value.status === 'succeeded') {
                const task = findTask(exec, handle)
                if (task?.handle === handle) {
                  try {
                    const cache = await cacheResult(exec, task, handle, value, signal)
                    finish({ status: cache.complete ? 'completed' : 'failed',
                      ...(cache.complete ? {} : { detail: 'Image-layering files were not completely cached.' }),
                      result: JSON.stringify({ ...value, cache }) })
                  } catch (error) {
                    finish({ status: 'failed', detail: 'Image-layering result caching failed; retry local caching by task handle.',
                      result: JSON.stringify({ taskHandle: handle, status: 'cache_partial',
                        error: error instanceof Error ? error.message : 'Local caching failed.' }) })
                  }
                  return
                }
                finish({ status: 'completed', result: JSON.stringify(value) }); return
              }
              if (value.status === 'missing_psd' || value.status === 'failed') {
                const task = findTask(exec, handle)
                if (task?.handle === handle && (value.imageUrls?.length || value.psdUrls?.length)) {
                  try {
                    const cache = await cacheResult(exec, task, handle, { ...value, status: 'missing_psd' }, signal)
                    finish({ status: 'failed', detail: value.error ?? 'No complete PSD result was returned.',
                      result: JSON.stringify({ ...value, cache }) })
                  } catch {
                    finish({ status: 'failed', detail: 'Image-layering files were not completely cached; recover local files without resubmitting generation.',
                      result: JSON.stringify({ taskHandle: handle, status: 'cache_partial' }) })
                  }
                  return
                }
                finish({ status: 'failed', detail: value.error ?? 'No PSD file was returned.', result: JSON.stringify(value) }); return
              }
              if (value.status === 'cancelled') {
                finish({ status: 'failed', detail: value.error ?? 'Remote task was cancelled.', result: JSON.stringify(value) }); return
              }
              job.updateProgress('running')
              await delay(config.generationPollIntervalMs, undefined, { signal })
            }
            if (signal.aborted) stop()
            else finish({ status: 'failed', detail: 'Local tracking timed out; remote status is unknown.',
              result: JSON.stringify({ taskHandle: handle, status: 'monitoring_unknown' }) })
          } catch (error) {
            if (signal.aborted) stop()
            else finish({ status: 'failed',
              detail: error instanceof ImageLayeringFailure && error.code === 'INVALID_RESPONSE'
                ? error.message : 'Local tracking stopped; remote status is unknown.',
              result: JSON.stringify({ taskHandle: handle,
                status: error instanceof ImageLayeringFailure && (error.code === 'AUTH_REQUIRED' || error.code === 'AUTH_UNAVAILABLE')
                  ? 'auth_unavailable' : error instanceof ImageLayeringFailure && error.code === 'INVALID_RESPONSE'
                    ? 'invalid_result' : 'monitoring_unknown',
                error: error instanceof Error ? error.message : 'Status request failed.' }) })
          }
        }
        lifetime.signal.addEventListener('abort', cancel, { once: true })
        void poll()
        return { done, cancel }
      },
    })
    const jobId = String(id)
    watching.set(key, jobId)
    return jobId
  }
  const submit = defineTool({
    name: 'submit_image_layering',
    description: 'Submit one user image from the last three user turns. Use prepare_image_layering_source when multiple images exist. This tool uploads the selected original without separate upload approval. Keep taskHandle; never retry an uncertain submission.',
    parameters: {
      sourceRef: { type: 'string', description: 'Source reference from prepare_image_layering_source; omit only when exactly one eligible image exists.' },
      imageUrl: { type: 'string', description: 'Legacy OSS URL from a successful upload_attachment in this turn.' },
      prompt: { type: 'string', description: 'User processing instructions; empty when absent.' },
      numLayers: { type: 'integer', description: 'Requested layer count; 0 when unspecified.' },
    }, output,
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Submit image layering' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? 'Image layering submission failed' : 'Image layering submitted' }),
    execute: async (args, exec): Promise<LayeringResult> => {
      const agent = requireAgent(exec)
      if (args.imageUrl && args.sourceRef) throw new Error('Choose sourceRef or imageUrl, not both.')
      const layers = args.numLayers ?? 0
      if (!Number.isSafeInteger(layers) || layers < 0) throw new Error('numLayers must be a nonnegative integer.')
      let imageUrl: string
      let reservation: BoundTask | undefined
      if (args.imageUrl) {
        if (!safeUrl(args.imageUrl) || !uploadedInTurn(exec, args.imageUrl)) {
          throw new Error('Use the OSS image URL returned by upload_attachment in this turn.')
        }
        imageUrl = args.imageUrl
      } else if (source) {
        if (!tasks) throw new Error('Image-layering task registry is unavailable.')
        const file = source.select(exec, args.sourceRef)
        const requestKey = `${String(source.requestTurn(exec))}:${String(file.attachmentId)}`
        const existing = tasks.stateOf(agent.session)[requestKey]
        if (existing && existing.state !== 'released') {
          if (existing.accountScope !== ctx.insightAccount.getAccountScope()) {
            throw new ImageLayeringFailure('AUTH_REQUIRED', 'This image-layering request belongs to another signed-in account.')
          }
          if (existing.prompt !== (args.prompt ?? '') || existing.numLayers !== layers) {
            throw new Error('This image already has a task with different processing parameters in this user turn.')
          }
          if (existing.handle) return { taskHandle: existing.handle, status: 'running' }
          throw new ImageLayeringFailure('SUBMISSION_UNKNOWN', 'A creation attempt is already reserved for this request; inspect proxy audit before another submission.')
        }
        const cwd = await prepareResultDirectory(ctx, agent, exec.signal)
        const accountScope = ctx.insightAccount.getAccountScope()
        reservation = { requestKey, file, prompt: args.prompt ?? '', numLayers: layers,
          cwd, accountScope, attempt: 1, state: 'reserved' }
        appendTask(exec, reservation)
        imageUrl = await source.upload(exec, file)
      } else throw new Error('No image source is available.')
      const result = await requestProxy(ctx, base, '/v1/proxy_async_create', {
        model_id: 'decompose-1.0-flash', task_type: 'async_tencent_multi_layer_create',
        data: { prompt: args.prompt ?? '', image_url_list: [imageUrl], image_params: { num_layers: layers } },
      }, config.generationRequestTimeoutMs, AbortSignal.any([exec.signal, lifetime.signal]))
      let handle: string
      try { handle = parseTaskHandle(result.body) }
      catch (error) {
        throw new ImageLayeringFailure('SUBMISSION_UNKNOWN',
          `Creation returned no single usable task handle${result.proxyRequestId ? ` (request ${result.proxyRequestId})` : ''}; inspect proxy audit before retrying.`,
          { cause: error })
      }
      if (reservation) appendTask(exec, { ...reservation, state: 'bound', handle })
      const submitted: LayeringResult = { taskHandle: handle, status: 'running',
        ...(result.proxyRequestId ? { proxyRequestId: result.proxyRequestId } : {}) }
      try { return { ...submitted, jobId: startWatch(exec, handle), monitoring: 'running' } }
      catch { return { ...submitted, monitoring: 'unavailable' } }
    },
  })
  const get = defineTool({
    name: 'get_image_layering',
    description: 'Read an image-layer task using its enterprise taskHandle. A query_unavailable result stops this image without resubmission; only a query timeout is retried once. Set watch=true to resume local tracking when no Job is active.',
    parameters: {
      taskHandle: { type: 'string', required: true, description: 'Opaque taskHandle returned by submit_image_layering.' },
      watch: { type: 'boolean', description: 'Resume asynchronous tracking while the task is running.' },
    }, output,
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Check image layering' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? 'Image layering check failed' : 'Image layering status' }),
    execute: async (args, exec): Promise<LayeringResult> => {
      requireAgent(exec)
      if (!taskHandle(args.taskHandle)) throw new Error('Invalid taskHandle.')
      // Unbound handles remain query-only; cache and paid retry require a Session task record.
      findTask(exec, args.taskHandle)
      const signal = AbortSignal.any([exec.signal, lifetime.signal])
      const value = await readStatus(args.taskHandle, signal)
      if (!args.watch || value.status !== 'running') return value
      try { return { ...value, jobId: startWatch(exec, args.taskHandle), monitoring: 'running' } }
      catch { return { ...value, monitoring: 'unavailable' } }
    },
  })
  const retry = source && tasks && defineTool({
    name: 'retry_image_layering',
    description: 'Create one final image-layering attempt only after two confirmed terminal reads for the original task. Uses its bound image and parameters; never repeat an uncertain creation.',
    parameters: { taskHandle: { type: 'string', required: true, description: 'Original taskHandle with retry_eligible status.' } },
    output,
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Retry image layering' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? 'Image layering retry failed' : 'Image layering retried' }),
    execute: async (args, exec): Promise<LayeringResult> => {
      const agent = requireAgent(exec)
      const old = findTask(exec, args.taskHandle)
      if (!old || old.handle !== args.taskHandle || old.attempt !== 1 || old.state !== 'retry_eligible') {
        throw new Error('This task is not eligible for one automatic retry.')
      }
      await prepareResultDirectory(ctx, agent, exec.signal, old.cwd)
      const reserved: BoundTask = { requestKey: old.requestKey, file: old.file, prompt: old.prompt,
        numLayers: old.numLayers, cwd: old.cwd, accountScope: old.accountScope,
        state: 'reserved', attempt: 2, firstHandle: old.handle }
      appendTask(exec, reserved)
      const imageUrl = await source.upload(exec, old.file)
      const result = await requestProxy(ctx, base, '/v1/proxy_async_create', {
        model_id: 'decompose-1.0-flash', task_type: 'async_tencent_multi_layer_create',
        data: { prompt: old.prompt, image_url_list: [imageUrl], image_params: { num_layers: old.numLayers } },
      }, config.generationRequestTimeoutMs, AbortSignal.any([exec.signal, lifetime.signal]))
      const handle = parseTaskHandle(result.body)
      appendTask(exec, { ...reserved, state: 'bound', handle })
      const submitted: LayeringResult = { taskHandle: handle, status: 'running',
        ...(result.proxyRequestId ? { proxyRequestId: result.proxyRequestId } : {}) }
      try { return { ...submitted, jobId: startWatch(exec, handle), monitoring: 'running' } }
      catch { return { ...submitted, monitoring: 'unavailable' } }
    },
  })
  const cache = tasks && defineTool({
    name: 'cache_image_layering_result',
    description: 'Download and verify all PSD and image results of a completed Session-owned task in the bound workspace. Present every returned local file path; do not show remote URLs in the final reply.',
    parameters: { taskHandle: { type: 'string', required: true, description: 'Confirmed taskHandle returned by submit_image_layering.' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      complete: { type: 'boolean', required: true },
      relocationFailed: { type: 'boolean', required: true },
      files: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string', required: true }, kind: { type: 'string', enum: ['psd', 'png', 'jpg', 'webp'], required: true },
        sizeBytes: { type: 'integer', required: true },
      } } },
    } }, render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Cache image layering files' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? 'Image files not cached' : 'Image files cached' }),
    execute: async (args, exec) => {
      requireAgent(exec)
      const task = findTask(exec, args.taskHandle)
      if (!task || task.handle !== args.taskHandle) throw new Error('Task handle is not bound to this Session.')
      const signal = AbortSignal.any([exec.signal, lifetime.signal])
      return cacheResult(exec, task, args.taskHandle, await getResult(args.taskHandle, signal), signal)
    },
  })
  const prepare = source && defineTool({
    name: 'prepare_image_layering_source',
    description: 'List original images uploaded directly by the user in the last three user turns. If several exist, ask the user which one to process before submitting. Listing does not upload.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      candidates: { type: 'array', required: true, items: { type: 'object', additionalProperties: false,
        properties: { sourceRef: { type: 'string', required: true }, filename: { type: 'string', required: true },
          turnSeq: { type: 'integer', required: true }, messageSeq: { type: 'integer', required: true } } } },
    } }, render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Find image layering source' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? 'Image source unavailable' : 'Image sources found' }),
    execute: (_args, exec) => { requireAgent(exec); return Promise.resolve({ candidates: source.list(exec) }) },
  })
  ctx.effect(() => {
    const releaseSubmit = ctx.tools.register(submit)
    try {
      const releaseGet = ctx.tools.register(get)
      const releasePrepare = prepare ? ctx.tools.register(prepare) : () => {}
      const releaseRetry = retry ? ctx.tools.register(retry) : () => {}
      const releaseCache = cache ? ctx.tools.register(cache) : () => {}
      return () => { releaseCache(); releaseRetry(); releasePrepare(); releaseGet(); releaseSubmit(); lifetime.abort() }
    } catch (error) { releaseSubmit(); lifetime.abort(); throw error }
  }, 'insight-media-upload: image-layering tools')
}
