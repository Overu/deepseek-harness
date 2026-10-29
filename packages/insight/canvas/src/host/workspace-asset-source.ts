import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { CanvasAgentError } from '../shared/canvas-agent-protocol.ts'
import { exceedsMediaLimit, mediaTypeFromName } from '../shared/canvas-media.ts'
import { snapshotAsset } from './asset-snapshot.ts'

/** Reads only through the execution world's public filesystem; targetKey remains opaque. */
export async function readWorkspaceAsset(fs: FileSystem | undefined, cwd: string | undefined, path: string, signal: AbortSignal) {
  if (!fs || typeof fs.readByteRange !== 'function' || !cwd) throw new CanvasAgentError('CONFIGURATION_ERROR', '当前执行环境未提供工作区文件范围读取能力')
  if (!path || path.length > 4096 || /[\u0000-\u001f]/u.test(path) || /^[a-z][a-z0-9+.-]*:\/\//iu.test(path)) throw new CanvasAgentError('INVALID_ARGUMENT', '请提供工作区内的普通文件路径')
  const type = mediaTypeFromName(path)
  if (!type) throw new CanvasAgentError('ASSET_VALIDATION_REJECTED', '仅支持TXT/Markdown、图片及受支持的音视频文件')
  signal.throwIfAborted()
  let snapshot
  try {
    const directory = await fs.resolve(cwd, { signal }), target = await fs.resolve(path, { cwd, signal })
    if (!fs.contains(directory, target)) throw new CanvasAgentError('INVALID_ARGUMENT', '来源文件位于当前会话工作区之外')
    const before = await fs.stat(target, signal)
    if (!before) throw new CanvasAgentError('ASSET_NOT_FOUND', '工作区来源文件不存在')
    const size = before.size
    if (before.type !== 'file' || typeof size !== 'number' || exceedsMediaLimit(type, size)) throw new CanvasAgentError('ASSET_VALIDATION_REJECTED', '来源必须是大小合规的普通文件')
    snapshot = await snapshotAsset((async function* () {
      for (let offset = 0; offset < size;) {
        const length = Math.min(256 * 1024, size - offset)
        const data = await fs.readByteRange(target, { offset, length }, signal)
        if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > length) throw new CanvasAgentError('ASSET_READ_REJECTED', '工作区文件读取不完整')
        offset += data.byteLength; yield data
      }
    })(), path.split(/[/\\]/u).pop()!, type, signal)
    const after = await fs.stat(target, signal), resolved = await fs.resolve(path, { cwd, signal })
    if (!after || after.type !== 'file' || after.version !== before.version || after.size !== size || snapshot.bytes !== size || resolved.targetKey !== target.targetKey || !fs.contains(directory, resolved)) throw new CanvasAgentError('ASSET_READ_REJECTED', '文件读取期间发生变化，请重新确认来源')
    return { snapshot, mediaType: type }
  } catch (error) {
    await snapshot?.cleanup()
    if (signal.aborted) throw new CanvasAgentError('CANCELLED_BEFORE_DISPATCH', '文件读取已取消')
    if (error instanceof CanvasAgentError) throw error
    throw new CanvasAgentError((error as { code?: string })?.code === 'FS_NOT_FOUND' ? 'ASSET_NOT_FOUND' : 'ASSET_READ_REJECTED', '工作区文件暂不可读取，尚未上传')
  }
}
