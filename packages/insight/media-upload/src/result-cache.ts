/** Sandboxed text manifest for remotely generated image-layer files. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Config } from './index.ts'
import type { LayeringFile } from './shared/layering-files.ts'

const TEST_HOST = 'game-ai-editor-videoassets-test.oss-cn-guangzhou.aliyuncs.com'

/** Validate one service URL against the configured result hosts. */
export function allowedResultUrl(raw: string, config: Config): { url: URL; kind: LayeringFile['kind'] } {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Result file URL is invalid.') }
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

/** Confirm workspace text-write permission before paid task creation. */
export async function prepareResultDirectory(ctx: Context, agent: Agent, signal: AbortSignal): Promise<string> {
  const cwd = ctx.workingDirectory.get(agent.session)
  const root = await ctx.fs.resolve(cwd, { signal })
  if ((await ctx.fs.stat(root, signal))?.type !== 'directory') throw new Error('Current workspace directory is unavailable.')
  const probe = await ctx.fs.resolve(join('generated', 'image-layering', '.write-probe'), { cwd, signal })
  await ctx.fs.writeText(probe, '', undefined, signal, ctx.sandboxPolicy.resolve({ session: agent.session }))
  return cwd
}

/** Save bounded service URLs as a text file; no generated binary is fetched here.
 * @param ctx - Session filesystem and sandbox services.
 * @param agent - Root Agent owning the workspace.
 * @param config - Environment-specific result host allowlist.
 * @param handle - Enterprise task handle used for a stable manifest name.
 * @param urls - Service-returned PSD candidates followed by layer images.
 * @param signal - Cancellation for the sandboxed write.
 * @returns Verified manifest path and deduplicated remote file descriptors.
 */
export async function saveLayeringManifest(ctx: Context, agent: Agent, config: Config, handle: string,
  urls: readonly string[], signal: AbortSignal): Promise<{ path: string; files: LayeringFile[] }> {
  const unique = new Map<string, { url: URL; kind: LayeringFile['kind'] }>()
  for (const raw of urls) {
    const item = allowedResultUrl(raw, config)
    unique.set(`${item.url.origin}${item.url.pathname}`, item)
  }
  if (unique.size > 129) throw new Error('Result contains too many files.')
  let imageIndex = 0
  const files: LayeringFile[] = [...unique.values()].map(({ url, kind }) => ({
    kind, url: url.href, name: kind === 'psd' ? 'layered.psd' : `layer-${++imageIndex}.${kind}`,
  }))
  if (files.length === 0) throw new Error('Completed task returned no usable result URLs.')
  const cwd = ctx.workingDirectory.get(agent.session)
  const key = createHash('sha256').update(handle).digest('hex').slice(0, 16)
  const target = await ctx.fs.resolve(join('generated', 'image-layering', `${key}.json`), { cwd, signal })
  const content = `${JSON.stringify({ taskHandle: handle, files }, null, 2)}\n`
  await ctx.fs.writeText(target, content, undefined, signal, ctx.sandboxPolicy.resolve({ session: agent.session }))
  if (await ctx.fs.readText(target, signal) !== content) throw new Error('Result URL manifest failed local verification.')
  return { path: ctx.fs.processPath(target), files }
}
