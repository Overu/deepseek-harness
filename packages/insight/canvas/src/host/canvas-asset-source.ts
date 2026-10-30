import { canvasAgent } from './canvas-tools.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { FileAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { CanvasAgentError, parseCanvasAsset, type CanvasAssetInput } from '../shared/canvas-agent-protocol.ts'
import type { CanvasMediaType } from '../shared/canvas-media.ts'
import { readSessionImage, sessionAttachments } from './asset-resolver.ts'
import { snapshotAsset } from './asset-snapshot.ts'
import { conversationMedia } from './conversation-media-source.ts'
import { inspectCanvasMedia, type PreparedCanvasFile } from './media-inspector.ts'
import { downloadRemoteImage } from './remote-image-reader.ts'
import { downloadRemoteMedia } from './remote-media-reader.ts'
import { readWorkspaceAsset } from './workspace-asset-source.ts'
import type { CanvasHostBridge } from './canvas-bridge.ts'

export type CanvasAssetSource = { type: 'attachment'
  attachmentId: string } | { type: 'conversation_asset'
    assetRef: string }
  | { type: 'workspace_file'
    path: string } | { type: 'canvas_node'
      canvasId: string
      nodeId: string
      outputIndex?: number }
export interface PreparedAssetSource {
  mediaType: CanvasMediaType
  file?: PreparedCanvasFile | StoredImageAttachment
  input?: CanvasAssetInput
  cleanup(): Promise<void>
}
export interface AssetSourceReaders { downloadImage: typeof downloadRemoteImage
  downloadMedia: typeof downloadRemoteMedia }
export const defaultAssetSourceReaders: AssetSourceReaders = { downloadImage: downloadRemoteImage, downloadMedia: downloadRemoteMedia }

export async function prepareCanvasAssetSource(ctx: Context, bridge: CanvasHostBridge, source: CanvasAssetSource,
  exec: ToolRunContext, request: string, readers = defaultAssetSourceReaders): Promise<PreparedAssetSource | { needsOutput: number }> {
  const signal = exec.signal
  const inspect = async (snapshot: Awaited<ReturnType<typeof snapshotAsset>>,
    mediaType: CanvasMediaType): Promise<PreparedAssetSource> => {
    try {
      const file = await inspectCanvasMedia(snapshot, mediaType, ctx.attachments, signal)
      return { mediaType, file, ...(mediaType === 'text' ? { input: parseCanvasAsset({ mediaType,
        text: file.text }) } : {}), cleanup: () => snapshot.cleanup() }
    } catch (error) { await snapshot.cleanup(); throw error }
  }
  const readRemote = async (url: string, mediaType: 'image' | 'video' | 'audio'): Promise<PreparedAssetSource> => {
    if (mediaType !== 'image') return inspect(await readers.downloadMedia(url, `generated-${mediaType}`, mediaType, signal), mediaType)
    try {
      const image = await readers.downloadImage(url, signal)
      const ref = await ctx.attachments.saveImage({ ...image, name: 'generated-image' })
      signal.throwIfAborted()
      return { mediaType, file: await ctx.attachments.readImage(ref, signal), cleanup: async () => {} }
    } catch (error) {
      if (signal.aborted) throw new CanvasAgentError('CANCELLED_BEFORE_DISPATCH', '素材读取已取消')
      if (error instanceof CanvasAgentError && error.code !== 'ASSET_NOT_FOUND') throw error
      throw new CanvasAgentError('ASSET_READ_REJECTED', '远端图片读取或校验失败，尚未上传，不需要重新生图')
    }
  }
  if (source.type === 'workspace_file') {
    const loaded = await readWorkspaceAsset(ctx.get('fs'), exec.agent?.session.header?.cwd, source.path, signal)
    return inspect(loaded.snapshot, loaded.mediaType)
  }
  if (source.type === 'attachment') {
    const item = sessionAttachments(exec).find(item => String(item.ref.attachmentId) === source.attachmentId)
    if (!item) throw new CanvasAgentError('ASSET_NOT_FOUND', '素材引用不在当前可见用户消息中')
    if (!item.mediaType) throw new CanvasAgentError('ASSET_VALIDATION_REJECTED', '该附件不是受支持的文本、图片或音视频文件')
    if (item.kind === 'image') return { mediaType: 'image', file: await readSessionImage(ctx.attachments, exec,
      source.attachmentId), cleanup: async () => {} }
    let snapshot
    try { snapshot = await snapshotAsset(ctx.attachments.readFileStream(item.ref as FileAttachmentRef, signal),
      item.ref.name ?? 'attachment', item.mediaType, signal) }
    catch (error) { if (error instanceof CanvasAgentError) throw error
      throw new CanvasAgentError(signal.aborted ? 'CANCELLED_BEFORE_DISPATCH' : 'ASSET_READ_REJECTED', '附件文件无法完整读取，尚未上传') }
    if (snapshot.bytes !== item.ref.bytes) { await snapshot.cleanup(); throw new CanvasAgentError('ASSET_READ_REJECTED', '附件长度与可信引用不一致') }
    return inspect(snapshot, item.mediaType)
  }
  if (source.type === 'conversation_asset') {
    const generated = (await conversationMedia(ctx, exec)).find(item => item.assetRef === source.assetRef)
    if (!generated) throw new CanvasAgentError('ASSET_NOT_FOUND', '生成素材引用不属于当前对话或来源已不可用')
    return readRemote(generated.url, generated.mediaType)
  }
  const target = await bridge.ensureContext(String(canvasAgent(exec).id), source.canvasId, 'read', request + ':source-prepare', signal)
  const read = await bridge.dispatch(target, request + ':source-read', { action: 'canvas.read', nodeIds: [source.nodeId] }, signal)
  if (read.status === 'rejected') throw new CanvasAgentError(read.error.code, read.error.message)
  if (read.status !== 'read' || read.consistency !== 'confirmed') throw new CanvasAgentError('ASSET_READ_REJECTED', '来源画布尚未确认，请先核对原节点')
  const node = read.nodes.find(node => node.id === source.nodeId)
  if (!node || !['text', 'image', 'video', 'audio'].includes(node.type)) throw new CanvasAgentError('ASSET_NOT_FOUND', '来源节点没有受支持的素材内容')
  const mediaType = node.type as CanvasMediaType
  if (mediaType === 'text') {
    if (!node.text || node.truncatedFields.includes('text')) throw new CanvasAgentError('ASSET_VALIDATION_REJECTED', '来源文本为空或已截断，不能完整导入')
    return { mediaType, input: parseCanvasAsset({ mediaType, text: node.text }), cleanup: async () => {} }
  }
  if (!node.outputs.length || node.truncatedFields.includes('outputs')) throw new CanvasAgentError('ASSET_NOT_FOUND', '来源节点没有可确认的媒体产物')
  if (source.outputIndex === undefined && node.outputs.length > 1) return { needsOutput: node.outputs.length }
  const url = node.outputs[source.outputIndex ?? 0]
  if (!url) throw new CanvasAgentError('ASSET_NOT_FOUND', '指定的产物不存在')
  const input = parseCanvasAsset(mediaType === 'image' ? { url } : { mediaType, url })
  if (mediaType === 'image') return { mediaType, input, cleanup: async () => {} }
  // Reuse the OSS URL, but verify track/duration before registering another audio/video asset.
  const loaded = await readRemote(url, mediaType)
  return { ...loaded, input }
}
