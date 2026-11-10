/** Authenticated image-layer generation through the enterprise skill proxy. */
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-jobs'
import { createInsightSkillProxyRequest, InsightSkillProxyError, skillProxyServiceBaseUrl } from '@insight-ai/desktop-integration/host'
import type { Config } from './index.ts'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    /** Session-owned polling of one enterprise image-layer task. */
    'image-layering': 'image-layering'
  }
}

interface LayeringResult {
  readonly taskHandle: string
  readonly status: 'running' | 'succeeded' | 'missing_psd' | 'failed'
  readonly psdUrls?: string[]
  readonly imageUrls?: string[]
  readonly error?: string
  readonly jobId?: string
  readonly monitoring?: 'running' | 'unavailable'
  readonly proxyRequestId?: string
}

/** Stable failures for proxy submission and status reads. */
export class ImageLayeringFailure extends Error {
  /** @param code - Failure category for callers.
   * @param message - Actionable detail without upstream response text.
   * @param options - Original Host-only cause.
   */
  constructor(readonly code: 'AUTH_REQUIRED' | 'SUBMISSION_UNKNOWN' | 'SUBMISSION_REJECTED'
    | 'STATUS_UNAVAILABLE' | 'INVALID_RESPONSE', message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options)
    this.name = 'ImageLayeringFailure'
  }
}

const output = {
  schema: { type: 'object', additionalProperties: false, properties: {
    taskHandle: { type: 'string', required: true },
    status: { type: 'string', enum: ['running', 'succeeded', 'missing_psd', 'failed'], required: true },
    psdUrls: { type: 'array', items: { type: 'string' } },
    imageUrls: { type: 'array', items: { type: 'string' } },
    error: { type: 'string' }, jobId: { type: 'string' }, proxyRequestId: { type: 'string' },
    monitoring: { type: 'string', enum: ['running', 'unavailable'] },
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
  try {
    const request = createInsightSkillProxyRequest(base, ctx.insightAccount)
    const response = await request('/api/skill-proxy/call-insight-api', {
      method: 'POST', body: JSON.stringify({ method: 'POST', path, body }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    })
    const requestId = response.headers.get('X-Insight-Proxy-Request-Id')
    responseRequestId = requestId && /^[0-9a-f-]{36}$/iu.test(requestId) ? requestId : undefined
    const { event, proxyRequestId } = await terminalEvent(response)
    if (event.type === 'error') {
      const code = typeof event.code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/u.test(event.code)
        ? event.code : 'SKILL_PROXY_FAILED'
      if (code === 'LOGIN_REQUIRED' || code === 'USER_NOT_LOGIN') {
        throw new ImageLayeringFailure('AUTH_REQUIRED', 'Sign in before generating image layers.')
      }
      throw new ImageLayeringFailure(creating && /UNKNOWN|TIMEOUT/u.test(code) ? 'SUBMISSION_UNKNOWN'
        : creating ? 'SUBMISSION_REJECTED' : 'STATUS_UNAVAILABLE',
      `${code}${proxyRequestId ? ` (request ${proxyRequestId})` : ''}.`)
    }
    const result = object(event.body)
    if (typeof event.status !== 'number' || event.status < 200 || event.status >= 300 || result?.code !== 0) {
      const businessCode = typeof result?.code === 'number' && Number.isSafeInteger(result.code)
        ? `, business code ${result.code}` : ''
      throw new ImageLayeringFailure(creating && (typeof event.status !== 'number' || event.status >= 500)
        ? 'SUBMISSION_UNKNOWN' : creating ? 'SUBMISSION_REJECTED' : 'STATUS_UNAVAILABLE',
      `Proxy operation returned upstream HTTP ${String(event.status)}${businessCode}${proxyRequestId ? ` (request ${proxyRequestId})` : ''}.`)
    }
    return { body: result, ...(proxyRequestId ? { proxyRequestId } : {}) }
  } catch (error) {
    if (error instanceof ImageLayeringFailure) throw error
    if (error instanceof InsightSkillProxyError && error.code === 'LOGIN_REQUIRED') {
      throw new ImageLayeringFailure('AUTH_REQUIRED', 'Sign in before generating image layers.', { cause: error })
    }
    if (error instanceof InsightSkillProxyError && !creating) {
      throw new ImageLayeringFailure('STATUS_UNAVAILABLE', `${error.code} (HTTP ${error.status}).`, { cause: error })
    }
    if (error instanceof InsightSkillProxyError && error.code !== 'SKILL_PROXY_OUTCOME_UNKNOWN'
      && error.status >= 400 && error.status < 500) {
      throw new ImageLayeringFailure('SUBMISSION_REJECTED', `${error.code} (HTTP ${error.status}).`, { cause: error })
    }
    throw new ImageLayeringFailure(creating ? 'SUBMISSION_UNKNOWN' : 'STATUS_UNAVAILABLE',
      creating ? `Submission outcome is unknown${responseRequestId ? ` (request ${responseRequestId})` : ''}; check proxy audit before creating another task.`
        : `Task status could not be read${responseRequestId ? ` (request ${responseRequestId})` : ''}.`, { cause: error })
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
  if (row?.status === 'failed' || row?.status === 'cancelled') return { taskHandle: handle, status: 'failed',
    error: 'Upstream generation failed.', ...metadata }
  if (row?.status !== 'success') throw new ImageLayeringFailure('STATUS_UNAVAILABLE', 'Upstream task status is unknown.')
  const data = object(row.data)
  const images = data?.image_list
  if (!Array.isArray(images) || images.length > 128 || images.some(item => !safeUrl(item))) {
    throw new ImageLayeringFailure('INVALID_RESPONSE', 'Successful task has no valid image_list.')
  }
  const separatePsd = data?.psd_url
  if (separatePsd !== undefined && (!safeUrl(separatePsd) || !new URL(separatePsd).pathname.toLowerCase().endsWith('.psd'))) {
    throw new ImageLayeringFailure('INVALID_RESPONSE', 'Successful task has an invalid psd_url.')
  }
  const imageUrls = images as string[]
  const psdUrls = imageUrls.filter(url => new URL(url).pathname.toLowerCase().endsWith('.psd'))
  if (typeof separatePsd === 'string' && !psdUrls.includes(separatePsd)) psdUrls.push(separatePsd)
  if (psdUrls.length === 0) return { taskHandle: handle, status: 'missing_psd', imageUrls,
    error: 'Upstream generation completed without a PSD file.', ...metadata }
  return { taskHandle: handle, status: 'succeeded', psdUrls, imageUrls, ...metadata }
}

/** Register submission and recovery tools beside the approved OSS upload tool.
 * @param ctx - Host tool, account, Agent, and Jobs services.
 * @param config - Validated environment and tracking limits.
 * @param uploadedInTurn - Check that the URL came from this turn's successful upload.
 */
export function registerImageLayeringTools(ctx: Context, config: Config,
  uploadedInTurn: (exec: ToolRunContext, url: string) => boolean): void {
  const base = skillProxyServiceBaseUrl(config.serviceEnvironment)
  const lifetime = new AbortController()
  const watching = new Map<string, string>()
  const requireAgent = (exec: ToolRunContext) => {
    const agent = exec.agent
    if (!agent || !ctx.agents.roots().includes(agent)) throw new Error('Use image layering in the original user conversation.')
    return agent
  }
  const getResult = async (handle: string, signal: AbortSignal) => {
    const result = await requestProxy(ctx, base, '/v1/proxy_async_get_result',
      { task_type: 'async_tencent_multi_layer_get_result', task_id: handle }, config.generationRequestTimeoutMs, signal)
    return parseLayeringResult(result.body, handle, result.proxyRequestId)
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
              const value = await getResult(handle, signal)
              if (value.status === 'succeeded') { finish({ status: 'completed', result: JSON.stringify(value) }); return }
              if (value.status === 'failed' || value.status === 'missing_psd') {
                finish({ status: 'failed', detail: value.error ?? 'No PSD file was returned.', result: JSON.stringify(value) }); return
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
                ? 'Upstream task completed, but its image_list was invalid.' : 'Local tracking stopped; remote status is unknown.',
              result: JSON.stringify({ taskHandle: handle,
                status: error instanceof ImageLayeringFailure && error.code === 'INVALID_RESPONSE' ? 'invalid_result' : 'monitoring_unknown',
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
    description: 'Submit one image uploaded by upload_attachment in this turn. Keep taskHandle to query status; never retry an uncertain submission.',
    parameters: {
      imageUrl: { type: 'string', required: true, description: 'OSS URL from a successful upload_attachment in this turn.' },
      prompt: { type: 'string', description: 'User processing instructions; empty when absent.' },
      numLayers: { type: 'integer', description: 'Requested layer count; 0 when unspecified.' },
    }, output,
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Submit image layering' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? 'Image layering submission failed' : 'Image layering submitted' }),
    execute: async (args, exec): Promise<LayeringResult> => {
      requireAgent(exec)
      if (!safeUrl(args.imageUrl) || !uploadedInTurn(exec, args.imageUrl)) {
        throw new Error('Use the OSS image URL returned by upload_attachment in this turn.')
      }
      const layers = args.numLayers ?? 0
      if (!Number.isSafeInteger(layers) || layers < 0) throw new Error('numLayers must be a nonnegative integer.')
      const result = await requestProxy(ctx, base, '/v1/proxy_async_create', {
        model_id: 'decompose-1.0-flash', task_type: 'async_tencent_multi_layer_create',
        data: { prompt: args.prompt ?? '', image_url_list: [args.imageUrl], image_params: { num_layers: layers } },
      }, config.generationRequestTimeoutMs, AbortSignal.any([exec.signal, lifetime.signal]))
      let handle: string
      try { handle = parseTaskHandle(result.body) }
      catch (error) {
        throw new ImageLayeringFailure('SUBMISSION_UNKNOWN',
          `Creation returned no single usable task handle${result.proxyRequestId ? ` (request ${result.proxyRequestId})` : ''}; inspect proxy audit before retrying.`,
          { cause: error })
      }
      const submitted: LayeringResult = { taskHandle: handle, status: 'running',
        ...(result.proxyRequestId ? { proxyRequestId: result.proxyRequestId } : {}) }
      try { return { ...submitted, jobId: startWatch(exec, handle), monitoring: 'running' } }
      catch { return { ...submitted, monitoring: 'unavailable' } }
    },
  })
  const get = defineTool({
    name: 'get_image_layering',
    description: 'Read an image-layer task using its enterprise taskHandle. Set watch=true to resume local tracking without resubmission.',
    parameters: {
      taskHandle: { type: 'string', required: true, description: 'Opaque taskHandle returned by submit_image_layering.' },
      watch: { type: 'boolean', description: 'Resume asynchronous tracking while the task is running.' },
    }, output,
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Check image layering' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? 'Image layering check failed' : 'Image layering status' }),
    execute: async (args, exec): Promise<LayeringResult> => {
      requireAgent(exec)
      if (!taskHandle(args.taskHandle)) throw new Error('Invalid taskHandle.')
      const value = await getResult(args.taskHandle, AbortSignal.any([exec.signal, lifetime.signal]))
      if (!args.watch || value.status !== 'running') return value
      try { return { ...value, jobId: startWatch(exec, args.taskHandle), monitoring: 'running' } }
      catch { return { ...value, monitoring: 'unavailable' } }
    },
  })
  ctx.effect(() => {
    const releaseSubmit = ctx.tools.register(submit)
    try {
      const releaseGet = ctx.tools.register(get)
      return () => { releaseGet(); releaseSubmit(); lifetime.abort() }
    } catch (error) { releaseSubmit(); lifetime.abort(); throw error }
  }, 'insight-media-upload: image-layering tools')
}
