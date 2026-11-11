/** Bounded, sandboxed local caching of image-layering result files. */
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Config } from './index.ts'

const TEST_HOST = 'game-ai-editor-videoassets-test.oss-cn-guangzhou.aliyuncs.com'
const MAX_FILE_BYTES = 256 * 1024 * 1024
const MAX_TOTAL_BYTES = 512 * 1024 * 1024
type Kind = 'psd' | 'png' | 'jpg' | 'webp'

/** One verified file in the Session workspace. */
export interface CachedLayeringFile {
  /** Canonical absolute path for `present`. */
  readonly path: string
  /** Verified file kind. */
  readonly kind: Kind
  /** Exact downloaded byte count. */
  readonly sizeBytes: number
}

/** An inaccessible result URL that may be refreshed through the same task handle. */
export class ResultDownloadFailure extends Error {}

function allowedUrl(raw: string, config: Config): { url: URL; kind: Kind } {
  let url: URL
  try { url = new URL(raw) }
  catch { throw new Error('Result file URL is invalid.') }
  const hosts = config.generationResultHosts?.length ? config.generationResultHosts
    : config.serviceEnvironment === 'test' ? [TEST_HOST] : []
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash
    || !hosts.includes(url.hostname)) throw new Error('Result file host is not configured for this environment.')
  const ext = url.pathname.toLowerCase().split('.').at(-1)
  const kind = ext === 'jpeg' ? 'jpg' : ext
  if (kind !== 'psd' && kind !== 'png' && kind !== 'jpg' && kind !== 'webp') {
    throw new Error('Result file type is not supported.')
  }
  return { url, kind }
}

function validMagic(bytes: Uint8Array, kind: Kind): boolean {
  if (kind === 'psd') return bytes.length >= 26 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === '8BPS'
    && bytes[4] === 0 && bytes[5] === 1
  if (kind === 'png') return bytes.length >= 8
    && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (kind === 'jpg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  return bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
}

/** Confirm the Session can publish binary files before paid creation.
 * @param ctx - Sandboxed filesystem and Session directory services.
 * @param agent - Root Agent owning the workspace.
 * @param signal - Tool cancellation.
 * @returns Bound directory for this task's result files.
 */
export async function prepareResultDirectory(ctx: Context, agent: Agent, signal: AbortSignal,
  boundCwd?: string): Promise<string> {
  const cwd = boundCwd ?? ctx.workingDirectory.get(agent.session)
  const root = await ctx.fs.resolve(cwd, { signal })
  if ((await ctx.fs.stat(root, signal))?.type !== 'directory') throw new Error('Current workspace directory is unavailable.')
  const probe = await ctx.fs.resolve(join('generated', 'image-layering', '.write-probe'), { cwd, signal })
  await ctx.fs.writeBytes(probe, new Uint8Array(0), signal, ctx.sandboxPolicy.resolve({ session: agent.session }))
  return cwd
}

/** Download every valid PSD and image into a sandbox-approved Session directory.
 * @param ctx - Filesystem and sandbox services.
 * @param agent - Session owner.
 * @param config - Result host configuration.
 * @param handle - Service-issued task handle used only to make stable local names.
 * @param urls - Validated result URLs, with PSD entries first.
 * @param cwd - Directory bound when the task was created.
 * @param signal - Cancellation for reads and writes.
 * @returns All locally verified files in display order.
 */
export async function cacheLayeringFiles(ctx: Context, agent: Agent, config: Config, handle: string,
  urls: readonly string[], cwd: string, signal: AbortSignal): Promise<CachedLayeringFile[]> {
  const unique = new Map<string, { url: URL; kind: Kind }>()
  for (const raw of urls) {
    const item = allowedUrl(raw, config)
    unique.set(`${item.url.origin}${item.url.pathname}`, item)
  }
  if (unique.size > 129) throw new Error('Result contains too many files.')
  const key = createHash('sha256').update(handle).digest('hex').slice(0, 16)
  const files: CachedLayeringFile[] = []
  let total = 0
  for (const [index, [identity, { url, kind }]] of [...unique.entries()].entries()) {
    const objectKey = createHash('sha256').update(identity).digest('hex').slice(0, 16)
    const target = await ctx.fs.resolve(join('generated', 'image-layering', `${key}-${objectKey}.${kind}`),
      { cwd, signal })
    const existing = await ctx.fs.stat(target, signal)
    if (existing?.type === 'file' && typeof existing.size === 'number'
      && existing.size > 0 && existing.size <= MAX_FILE_BYTES) {
      const bytes = await ctx.fs.readBytes(target, signal, MAX_FILE_BYTES)
      if (bytes.length === existing.size && validMagic(bytes, kind)) {
        total += bytes.length
        if (total > MAX_TOTAL_BYTES) throw new Error('Image-layering cache size limit exceeded.')
        files.push({ path: ctx.fs.processPath(target), kind, sizeBytes: bytes.length })
        continue
      }
    }
    let response: Response
    try { response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) }) }
    catch { throw new ResultDownloadFailure(`Result file ${String(index + 1)} could not be downloaded.`) }
    if (!response.ok || !response.body) throw new ResultDownloadFailure(`Result file ${String(index + 1)} could not be downloaded.`)
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    const expectedType: Record<Kind, string> = { psd: 'image/vnd.adobe.photoshop',
      png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }
    if (contentType !== expectedType[kind] && contentType !== 'application/octet-stream') {
      throw new Error(`Result file ${String(index + 1)} has an unexpected content type.`)
    }
    const declared = response.headers.get('content-length')
    if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_FILE_BYTES)) {
      throw new Error(`Result file ${String(index + 1)} exceeds the size limit.`)
    }
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for await (const chunk of response.body) {
        size += chunk.byteLength
        if (size > MAX_FILE_BYTES || total + size > MAX_TOTAL_BYTES) throw new Error('Image-layering cache size limit exceeded.')
        chunks.push(chunk)
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Image-layering cache size limit exceeded.') throw error
      throw new Error(`Result file ${String(index + 1)} stream failed.`)
    }
    if (declared !== null && size !== Number(declared)) throw new Error('Result file size does not match the response.')
    const bytes = Buffer.concat(chunks, size)
    if (!validMagic(bytes, kind)) throw new Error(`Result file ${String(index + 1)} has invalid ${kind.toUpperCase()} bytes.`)
    const written = await ctx.fs.writeBytes(target, bytes, signal, ctx.sandboxPolicy.resolve({ session: agent.session }))
    const info = await ctx.fs.stat(target, signal)
    const header = await ctx.fs.readByteRange(target, { offset: 0, length: Math.min(size, 26) }, signal)
    if (written.size !== size || info?.type !== 'file' || info.size !== size || !validMagic(header, kind)) {
      throw new Error(`Result file ${String(index + 1)} failed local verification.`)
    }
    files.push({ path: ctx.fs.processPath(target), kind, sizeBytes: size })
    total += size
  }
  return files
}

/** Copy a fully verified result set into the Session's new working directory.
 * The originals remain available if any copy fails.
 * @param ctx - Sandboxed filesystem and working-directory services.
 * @param agent - Session owner.
 * @param files - Files verified in the task's initial directory.
 * @param signal - Copy cancellation.
 * @returns Paths in the current directory after every copy verifies.
 */
export async function copyLayeringFilesToCurrentDirectory(ctx: Context, agent: Agent,
  files: readonly CachedLayeringFile[], signal: AbortSignal): Promise<CachedLayeringFile[]> {
  const cwd = await prepareResultDirectory(ctx, agent, signal)
  const copied: CachedLayeringFile[] = []
  for (const file of files) {
    const old = await ctx.fs.resolve(file.path, { signal })
    const bytes = await ctx.fs.readBytes(old, signal, MAX_FILE_BYTES)
    if (bytes.length !== file.sizeBytes || !validMagic(bytes, file.kind)) {
      throw new Error('Original cached result file failed verification before relocation.')
    }
    const target = await ctx.fs.resolve(join('generated', 'image-layering', basename(file.path)), { cwd, signal })
    const result = await ctx.fs.writeBytes(target, bytes, signal, ctx.sandboxPolicy.resolve({ session: agent.session }))
    const header = await ctx.fs.readByteRange(target, { offset: 0, length: Math.min(bytes.length, 26) }, signal)
    if (result.size !== file.sizeBytes || (await ctx.fs.stat(target, signal))?.size !== file.sizeBytes
      || !validMagic(header, file.kind)) {
      throw new Error('Copied result file failed local verification.')
    }
    copied.push({ ...file, path: ctx.fs.processPath(target) })
  }
  return copied
}
