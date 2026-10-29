import { createHash } from 'node:crypto'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CanvasAgentError } from '../shared/canvas-agent-protocol.ts'
import { exceedsMediaLimit, type CanvasMediaType } from '../shared/canvas-media.ts'

export interface AssetSnapshot { path: string; name: string; bytes: number; sha256: string; cleanup(): Promise<void> }
/** Host-owned bounded snapshot, never a source-path escape or a bridge payload. */
export async function snapshotAsset(chunks: AsyncIterable<Uint8Array>, name: string, type: CanvasMediaType, signal: AbortSignal): Promise<AssetSnapshot> {
  signal.throwIfAborted()
  const directory = await mkdtemp(join(tmpdir(), 'insight-canvas-asset-'))
  const path = join(directory, 'content'), hash = createHash('sha256')
  const cleanup = () => rm(directory, { recursive: true, force: true })
  let file
  try {
    file = await open(path, 'wx', 0o600); let bytes = 0
    for await (const chunk of chunks) {
      signal.throwIfAborted()
      if (!(chunk instanceof Uint8Array)) throw new CanvasAgentError('ASSET_READ_REJECTED', '文件读取未返回有效字节')
      if (!chunk.byteLength) continue
      bytes += chunk.byteLength
      if (exceedsMediaLimit(type, bytes)) throw new CanvasAgentError('ASSET_VALIDATION_REJECTED', '文件大小不符合画布导入限制')
      hash.update(chunk); await file.writeFile(chunk)
    }
    signal.throwIfAborted()
    if (!bytes) throw new CanvasAgentError('ASSET_VALIDATION_REJECTED', '不能导入空文件')
    await file.close(); file = undefined
    return { path, name, bytes, sha256: hash.digest('hex'), cleanup }
  } catch (error) { await file?.close(); await cleanup(); throw error }
}
