import { readFile } from 'node:fs/promises'
import { ALL_FORMATS, FilePathSource, Input } from 'mediabunny'
import type { AttachmentStore, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { CanvasAgentError, MAX_CONTENT_LENGTH } from '../shared/canvas-agent-protocol.ts'
import type { CanvasMediaType } from '../shared/canvas-media.ts'
import type { AssetSnapshot } from './asset-snapshot.ts'

export interface PreparedCanvasFile extends AssetSnapshot {
  mediaType: CanvasMediaType
  mimeType: string
  text?: string
  width?: number
  height?: number
  duration?: number
  hasAudio?: boolean
}
const invalid = (message: string) => new CanvasAgentError('ASSET_VALIDATION_REJECTED', message)
export function rasterType(bytes: Uint8Array): ImageMediaType | undefined {
  const data = Buffer.from(bytes)
  if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png'
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg'
  if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'))) return 'image/gif'
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
}
export async function inspectCanvasMedia(snapshot: AssetSnapshot, type: CanvasMediaType,
  attachments: Pick<AttachmentStore, 'saveImage'>, caller: AbortSignal): Promise<PreparedCanvasFile> {
  const signal = AbortSignal.any([caller, AbortSignal.timeout(15_000)])
  let input: Input | undefined
  const abort = () => input?.dispose()
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    if (type === 'text') {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(snapshot.path))
      if (!text.trim() || text.includes('\0') || text.length > MAX_CONTENT_LENGTH ||
 /[\u0001-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) throw invalid('文本需为有效UTF-8正文，最多32768字符，不能含二进制控制字符')
      return { ...snapshot, mediaType: type, mimeType: 'text/plain', text }
    }
    if (type === 'image') {
      const data = await readFile(snapshot.path), mimeType = rasterType(data)
      if (!mimeType) throw invalid('图片内容不是受支持的PNG/JPEG/GIF/WebP')
      const ref = await attachments.saveImage({ data, mediaType: mimeType, name: snapshot.name })
      signal.throwIfAborted()
      const dimensions = ref.originalDimensions ?? ref
      return { ...snapshot, mediaType: type, mimeType, width: dimensions.width, height: dimensions.height }
    }
    input = new Input({ source: new FilePathSource(snapshot.path), formats: ALL_FORMATS })
    const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()])
    if (type === 'video' ? !video : !audio || !!video) throw invalid('文件真实音视频轨道与声明类型不一致')
    const duration = await input.computeDuration(undefined, { skipLiveWait: true })
    if (!Number.isFinite(duration) || duration <= 0 || type === 'video' && duration > 300) throw invalid('媒体时长无效，视频最多300秒')
    const mimeType = (await input.getMimeType()).split(';', 1)[0]
    if (!['video/mp4', 'video/quicktime', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4',
      'audio/aac'].includes(mimeType)) throw invalid('媒体容器不在画布支持范围内')
    signal.throwIfAborted()
    return { ...snapshot, mediaType: type, mimeType, duration: Math.ceil(duration), hasAudio: !!audio, ...(video ? {
      width: await video.getDisplayWidth(), height: await video.getDisplayHeight() } : {}) }
  } catch (error) {
    if (caller.aborted) throw new CanvasAgentError('CANCELLED_BEFORE_DISPATCH', '素材校验已取消')
    if (error instanceof CanvasAgentError) throw error
    throw invalid(signal.aborted ? '媒体解析超时，尚未上传' : '文件损坏、编码或媒体内容校验失败，尚未上传')
  } finally { signal.removeEventListener('abort', abort); input?.dispose() }
}
