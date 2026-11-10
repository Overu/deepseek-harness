/** Insight Desktop's approved OSS upload and authenticated image-layer tools. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import { uploadCenterServiceBaseUrl } from '@insight-ai/desktop-integration/host'
import { currentTurnUploadsProjection, selectUploadSource, uploadTurnSeq } from './upload-source.ts'
import { requestUploadSession, UploadFailure } from './upload-center.ts'
import { putOssObject } from './oss-put.ts'
import { registerImageLayeringTools } from './image-layering.ts'

/** Cordis loader identity for the Insight media upload capability. */
export const name = 'insight-media-upload'
/** Host capabilities required before the tool can be registered. */
export const inject = ['tools', 'attachments', 'insightAccount', 'approval', 'agents', 'sessionProjections', 'jobs']

/** Product environment and bounded network deadlines. */
export interface Config {
  /** Selected fixed upload-center service environment. */
  serviceEnvironment: 'test' | 'production'
  /** Deadline for the upload-center STS request. */
  requestTimeoutMs: number
  /** Deadline for the OSS PUT. */
  ossTimeoutMs: number
  /** Deadline for each enterprise generation request. */
  generationRequestTimeoutMs: number
  /** Interval between generation status checks. */
  generationPollIntervalMs: number
  /** Maximum duration of local generation tracking. */
  generationWatchTimeoutMs: number
}

/** Loader-validated deployment values. */
export const Config: z<Partial<Config>, Config> = z.object({
  serviceEnvironment: z.union(['test', 'production']).required(),
  requestTimeoutMs: z.number().step(1).min(1000).max(120_000).default(15_000),
  ossTimeoutMs: z.number().step(1).min(1000).max(3_600_000).default(180_000),
  generationRequestTimeoutMs: z.number().step(1).min(1000).max(1_250_000).default(1_250_000),
  generationPollIntervalMs: z.number().step(1).min(1000).max(300_000).default(10_000),
  generationWatchTimeoutMs: z.number().step(1).min(60_000).max(7_200_000).default(3_900_000),
})

/** Canonical successful result; `url` is an OSS object address with unverified read access. */
export interface UploadAttachmentResult {
  /** OSS object address built from the upload-center STS response. */
  readonly url: string
  /** The plugin does not test whether the object can be read. */
  readonly urlAccess: 'unverified'
  /** Sanitized filename of the stored original bytes. */
  readonly filename: string
  /** Number of exact original bytes uploaded. */
  readonly sizeBytes: number
}

/** Declare a MIME type from the stored filename for the OSS PUT.
 * @param name - Sanitized local filename.
 * @returns Known media type or `application/octet-stream` for another extension.
 */
function mimeType(name: string): string {
  const ext = name.toLowerCase().split('.').pop()
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
    txt: 'text/plain', md: 'text/markdown', pdf: 'application/pdf' } as Record<string, string>)[ext ?? '']
    ?? 'application/octet-stream'
}

/** Register upload and image-layer tools with the Host-only current-turn projection.
 * @param ctx - Host services for tools, attachments, approval, account, Agent and Session projection.
 * @param config - Validated upload-center environment and request deadlines.
 * @returns When the projection and tools have registered under the plugin fiber.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const projection = await ctx.sessionProjections.register(currentTurnUploadsProjection)
  ctx.effect(() => () => projection.dispose(), 'insight-media-upload: current-turn attachment projection')
  const baseUrl = uploadCenterServiceBaseUrl(config.serviceEnvironment)
  const lifetime = new AbortController()
  const pending = new Set<Promise<UploadAttachmentResult>>()
  const uploaded = new WeakMap<object, { turnSeq: number; urls: Set<string> }>()
  const definition = defineTool({
    name: 'upload_attachment',
    description: 'Upload one file attached by the user in the current turn to OSS. Use when the user requests an image, video, audio, or other file upload. Ask for transfer approval. Do not use for pasted text, local paths, Canvas assets, or attachments from earlier turns. The returned URL identifies an OSS object, not an enterprise attachment; read access is unverified.',
    parameters: {
      attachmentIndex: { type: 'integer', description: '1-based position among direct-user attachments in this turn. Required when there is more than one.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        url: { type: 'string', required: true },
        urlAccess: { type: 'string', enum: ['unverified'], required: true },
        filename: { type: 'string', required: true }, sizeBytes: { type: 'integer', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    presentCall: args => ({ card: 'generic', kind: 'other', title: 'Upload attachment to OSS',
      ...(args.attachmentIndex === undefined ? {} : { rawInput: { attachmentIndex: args.attachmentIndex } }) }),
    presentResult: (_args, result) => ({ card: 'generic',
      title: result.isError ? 'Attachment upload failed' : 'Attachment uploaded to OSS' }),
    execute: (args, exec): Promise<UploadAttachmentResult> => {
      const signal = AbortSignal.any([exec.signal, lifetime.signal])
      const work = (async () => {
        signal.throwIfAborted()
        const agent = exec.agent
        if (!agent || !ctx.agents.roots().includes(agent)) throw new UploadFailure('AGENT_REQUIRED', 'Use this tool in the original user conversation.')
        const file = selectUploadSource(agent, args.attachmentIndex, projection)
        const outcome = await ctx.approval.request({ agent, toolName: 'upload_attachment', callId: exec.callId,
          reason: `Upload ${file.name} (${String(file.bytes)} bytes) to OSS and disclose its object address.`,
          displayReason: { en: `Upload ${file.name} (${String(file.bytes)} bytes) to OSS? Its object address will appear in this conversation.`,
            zh: `将 ${file.name}（${String(file.bytes)} 字节）上传至 OSS？对象地址会出现在当前对话中。` }, signal })
        if (outcome !== 'allowed-once') throw new UploadFailure('APPROVAL_DENIED', 'Attachment upload was not approved.')
        const turnSeq = uploadTurnSeq(agent, projection)
        if (turnSeq === undefined) throw new UploadFailure('AGENT_REQUIRED', 'The upload turn has ended.')
        const result = await uploadAttachment(ctx, baseUrl, file, config, signal)
        if (mimeType(file.name).startsWith('image/') && uploadTurnSeq(agent, projection) === turnSeq) {
          const previous = uploaded.get(agent.session)
          const urls = previous?.turnSeq === turnSeq ? previous.urls : new Set<string>()
          urls.add(result.url)
          uploaded.set(agent.session, { turnSeq, urls })
        }
        return result
      })()
      pending.add(work)
      void work.then(() => pending.delete(work), (error: unknown) => {
        pending.delete(work)
        if (error instanceof UploadFailure && error.code === 'OSS_RESULT_UNKNOWN') {
          ctx.logger.warn(`insight-media-upload: ${error.code} for call ${String(exec.callId)}`)
        }
      })
      return work
    },
  })
  ctx.effect(() => {
    const release = ctx.tools.register(definition)
    return async () => { release(); lifetime.abort(); await Promise.allSettled([...pending]) }
  }, 'insight-media-upload: upload_attachment tool')
  registerImageLayeringTools(ctx, config, (exec, url) => {
    const agent = exec.agent
    if (!agent) return false
    const record = uploaded.get(agent.session)
    return record !== undefined && record.turnSeq === uploadTurnSeq(agent, projection) && record.urls.has(url)
  })
}

/** Transfer one approved current-turn file, then return its non-secret OSS address.
 * @param ctx - Host attachment reader and account-token owner.
 * @param baseUrl - Fixed upload-center base including its gateway path.
 * @param file - Selected current-turn original file.
 * @param config - Validated STS and OSS request deadlines.
 * @param signal - Combined tool and plugin-lifetime cancellation.
 * @returns Unverified OSS object address after a confirmed write.
 */
async function uploadAttachment(ctx: Context, baseUrl: string,
  file: import('@deepseek-ai/dsh-attachment').FileAttachmentRef, config: Config,
  signal: AbortSignal): Promise<UploadAttachmentResult> {
  let token: string
  try { token = await ctx.insightAccount.getAccessToken(signal) }
  catch { throw new UploadFailure('AUTH_REQUIRED', 'Desktop login is required before uploading an attachment.') }
  if (!token) throw new UploadFailure('AUTH_REQUIRED', 'Desktop login is required before uploading an attachment.')
  const type = mimeType(file.name)
  const session = await requestUploadSession(baseUrl, token, file,
    AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMs)]))
  await putOssObject(ctx.attachments, file, session, type, config.ossTimeoutMs, signal)
  return { url: session.uploadUrl, urlAccess: 'unverified', filename: file.name, sizeBytes: file.bytes }
}
