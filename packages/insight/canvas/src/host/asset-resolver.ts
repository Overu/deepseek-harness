import type { AttachmentStore, FileAttachmentRef, ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { CanvasAgentError } from '../shared/canvas-agent-protocol.ts'
import { mediaTypeFromName } from '../shared/canvas-media.ts'

export function sessionAttachments(exec: Pick<ToolRunContext, 'agent'>) {
  if (!exec.agent) throw new CanvasAgentError('AGENT_CONTEXT_REQUIRED', '请从当前Harness对话使用素材')
  const refs = new Map<string, { kind: 'image' | 'file'; ref: ImageAttachmentRef | FileAttachmentRef }>()
  for (const message of exec.agent.session.deriveMessages()) {
    if (message.role !== 'user') continue
    for (const part of message.content) {
      if (part.type !== 'image' && part.type !== 'file') continue
      const id = String(part.attachment.attachmentId)
      refs.delete(id); refs.set(id, { kind: part.type, ref: part.attachment })
    }
  }
  return [...refs.values()].reverse().map(item => ({ ...item, mediaType: item.kind === 'image' ? 'image' as const : mediaTypeFromName(item.ref.name ?? '') }))
}

/** Only images carried by currently visible user messages authorize an attachment read. */
export function sessionImages(exec: Pick<ToolRunContext, 'agent'>): ImageAttachmentRef[] {
  if (!exec.agent) throw new CanvasAgentError('AGENT_CONTEXT_REQUIRED', '请从当前Harness对话使用图片素材')
  const refs = new Map<string, ImageAttachmentRef>()
  for (const message of exec.agent.session.deriveMessages()) {
    if (message.role !== 'user') continue
    for (const part of message.content) {
      if (part.type !== 'image') continue
      const id = String(part.attachment.attachmentId)
      refs.delete(id); refs.set(id, part.attachment)
    }
  }
  return [...refs.values()].reverse()
}

export async function readSessionImage(attachments: Pick<AttachmentStore, 'readImage'>, exec: ToolRunContext, attachmentId: string): Promise<StoredImageAttachment> {
  const ref = sessionImages(exec).find(image => String(image.attachmentId) === attachmentId)
  if (!ref) throw new CanvasAgentError('ASSET_NOT_FOUND', '此图片不在当前可见用户消息中，请提供当前聊天图片或明确画布节点引用')
  if (exec.signal.aborted) throw new CanvasAgentError('CANCELLED_BEFORE_DISPATCH', '读取图片已取消')
  try { return await attachments.readImage(ref, exec.signal) }
  catch { throw new CanvasAgentError(exec.signal.aborted ? 'CANCELLED_BEFORE_DISPATCH' : 'ASSET_READ_REJECTED', exec.signal.aborted ? '读取图片已取消' : '当前聊天图片暂时无法读取，尚未上传，请保留原引用') }
}
