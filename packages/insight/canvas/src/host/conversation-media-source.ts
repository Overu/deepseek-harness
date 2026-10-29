import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session-query'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { CanvasAgentError, MAX_MESSAGE_BYTES } from '../shared/canvas-agent-protocol.ts'
import type { CanvasMediaType } from '../shared/canvas-media.ts'

export interface ConversationMedia {
  assetRef: string; origin: 'media_generator'; callId: string; outputIndex: number; url: string; mediaType: Exclude<CanvasMediaType, 'text'>
}
interface Call { id: string; seq: number; name: string; args: Record<string, unknown> }
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
function argsOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || value.length > MAX_MESSAGE_BYTES) return
  try { return object(JSON.parse(value)) } catch { return }
}
function isMediaCall(call: Call): boolean {
  const command = call.args.command
  if (call.name !== 'bash' || typeof command !== 'string') return false
  return /media-generator[/\\](?:generate\.py|run\.sh)\b/u.test(command)
    || /enterprise_proxy\.(?:mjs|py)[\s\S]{0,160}\bmedia-generator\b/u.test(command)
    || command.includes('DSH_SKILL_PROXY_CLIENT') && /\bmedia-generator\s+POST\s+\/v1\/proxy\b/u.test(command)
    || typeof call.args.workdir === 'string' && /(?:^|[/\\])media-generator\/?$/u.test(call.args.workdir) && /\b(?:generate\.py|run\.sh)\b/u.test(command)
}
function mediaUrls(text: string): { url: string; mediaType: ConversationMedia['mediaType']; outputIndex: number }[] {
  if (Buffer.byteLength(text) > MAX_MESSAGE_BYTES || /\[(?:output truncated|result truncated|output dropped|timed out|stopped|killed by signal)/iu.test(text)
    || [...text.matchAll(/\[exit code:\s*(-?\d+)\]/gu)].some(match => Number(match[1]) !== 0)) return []
  try {
    const envelope = object(JSON.parse(text.split('\n[stderr]', 1)[0].replace(/\n\[exit code: 0\]\s*$/u, '').trim()))
    if (envelope?.code !== 0 || envelope.status !== 'success') return []
    return (['image', 'video', 'audio'] as const).flatMap(mediaType => {
      const urls = object(envelope.data)?.[mediaType + '_list']
      if (!Array.isArray(urls) || urls.length > 200 || !urls.every(value => {
        if (typeof value !== 'string' || value.length > 8192) return false
        try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.hash } catch { return false }
      })) return []
      return urls.map((url: string, outputIndex: number) => ({ url, mediaType, outputIndex }))
    })
  } catch { return [] }
}

/** Reconstruct only this Session's real call/result pairs, including cold and compacted history. */
export async function conversationMedia(ctx: Pick<Context, 'sessionQuery'>, exec: ToolRunContext): Promise<ConversationMedia[]> {
  if (!exec.agent) throw new CanvasAgentError('AGENT_CONTEXT_REQUIRED', '缺少当前对话')
  if (exec.signal.aborted) throw new CanvasAgentError('CANCELLED_BEFORE_DISPATCH', '素材读取已取消')
  if (!ctx.sessionQuery) return []
  const sessionId = String(exec.agent.session.id ?? exec.agent.id)
  let cut
  try { cut = await ctx.sessionQuery.observeSession(sessionId as SessionId, { signal: exec.signal, projectionMode: 'none' }) }
  catch { throw new CanvasAgentError(exec.signal.aborted ? 'CANCELLED_BEFORE_DISPATCH' : 'ASSET_READ_REJECTED', '当前对话的素材来源记录暂不可读') }
  try {
    if (exec.signal.aborted) throw new CanvasAgentError('CANCELLED_BEFORE_DISPATCH', '素材读取已取消')
    if (cut.header.id !== sessionId) throw new CanvasAgentError('ASSET_NOT_FOUND', '素材来源对话不一致')
    const calls = new Map<string, Call>(), sources = new Map<string, { seq: number; assets: ConversationMedia[] }>()
    const jobs = new Map<string, { root: Call; text: string }>()
    const accept = (call: Call, text: string, seq: number) => {
      const assets = mediaUrls(text).map(({ url, outputIndex, mediaType }) => ({
        assetRef: `conversation-${mediaType}-` + createHash('sha256').update(JSON.stringify(mediaType === 'image' ? [sessionId, cut.header.createdAt, call.seq, call.id, outputIndex, url] : [sessionId, cut.header.createdAt, call.seq, call.id, mediaType, outputIndex, url])).digest('hex'),
        origin: 'media_generator' as const, callId: call.id, outputIndex, url, mediaType,
      }))
      sources.set(call.id, { seq, assets })
    }
    for (const event of cut.events) {
      const data = object(event.data)
      if (!data) continue
      if (event.type === 'tool/call' && typeof data.callId === 'string' && typeof data.name === 'string') {
        const args = argsOf(data.arguments)
        if (args) calls.set(data.callId, { id: data.callId, seq: Number(event.seq), name: data.name, args })
        continue
      }
      if (event.type !== 'tool/result') continue
      const message = object(data.message), source = object(message?.source)
      if (!message || message.role !== 'tool' || source?.kind !== 'tool' || typeof source.callId !== 'string' || message.toolCallId !== source.callId) continue
      const call = calls.get(source.callId)
      if (!call || !Array.isArray(message.content)) continue
      const text = message.content.map(part => { const block = object(part); return block?.type === 'text' && typeof block.text === 'string' ? block.text : '' }).join('')
      if (isMediaCall(call)) {
        sources.delete(call.id)
        if (message.isError) continue
        const jobId = text.match(/^started background job ([\w-]+)\s*$/u)?.[1]
          ?? text.match(/\[still running after \d+ms; moved to background job ([\w-]+)\]/u)?.[1]
        if (jobId) {
          if (jobs.size < 256) jobs.set(jobId, { root: call, text: text.includes('[still running after ') ? text.split('[still running after ', 1)[0] : '' })
        } else accept(call, text, Number(event.seq))
      } else if (call.name === 'job_output' && typeof call.args.job_id === 'string') {
        const job = jobs.get(call.args.job_id)
        if (!job) continue
        const status = text.match(/\n?\[status: (\w+)(?:, ([^\n]*))?\]\s*$/u)
        if (message.isError || !status || /\[(?:output truncated|result truncated|output dropped)/iu.test(text)) { jobs.delete(call.args.job_id); continue }
        const delta = text.slice(0, status.index).replace(/^\(no new output\)\s*$/u, '')
        job.text += delta
        if (Buffer.byteLength(job.text) > MAX_MESSAGE_BYTES) { jobs.delete(call.args.job_id); continue }
        if (status[1] === 'completed') { accept(job.root, job.text + (status[2]?.match(/exit code: (-?\d+)/u) ? '\n[' + status[2] + ']' : ''), Number(event.seq)); jobs.delete(call.args.job_id) }
        else if (status[1] !== 'running') jobs.delete(call.args.job_id)
      }
    }
    return [...sources.values()].sort((a,b) => b.seq-a.seq).flatMap(source => source.assets)
  } finally { cut[Symbol.dispose]() }
}
