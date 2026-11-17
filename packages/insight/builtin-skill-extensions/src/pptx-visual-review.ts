/** Bounded LibreOffice Kit visual checks for saved PPTX files. */

import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-working-directory'

/** Limits and process lifetime for one PPTX visual review. */
export interface PptxVisualReviewConfig {
  /** Largest saved PPTX eligible for one retry after the renderer rejects its default input cap. */
  readonly pptxRetryMaxInputBytes: number
  /** Renderer process deadline in milliseconds. */
  readonly pptxRenderTimeoutMs: number
  /** Subprocess termination grace period in milliseconds. */
  readonly pptxRenderGraceMs: number
}

type RenderImage = { readonly page: number; readonly path: string }
type RenderUnavailableReason = 'input-too-large' | 'retry-failed' | 'render-failed'
type RenderResult =
  | { readonly kind: 'rendered'; readonly images: RenderImage[]; readonly retried: boolean }
  | { readonly kind: 'unavailable'; readonly images: []; readonly retried: boolean; readonly reason: RenderUnavailableReason }
type ProcessResult = { readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }

const OUTPUT_BYTES = 2 * 1024 * 1024
const RENDERER_MAX_PAGES = 100

function failureCode(stderr: string): string | undefined {
  for (const line of stderr.trim().split('\n').reverse()) {
    try {
      const value: unknown = JSON.parse(line)
      if (typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string') return value.code
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  return undefined
}

function imagesFromManifest(stdout: string): RenderImage[] | undefined {
  try {
    const manifest: unknown = JSON.parse(stdout)
    if (typeof manifest !== 'object' || manifest === null || !('images' in manifest) || !Array.isArray(manifest.images)) return undefined
    const images = manifest.images.map((image) => {
      if (typeof image !== 'object' || image === null || !('path' in image) || !('page' in image)) return undefined
      return typeof image.path === 'string' && typeof image.page === 'number' && Number.isSafeInteger(image.page) && image.page > 0
        ? { page: image.page, path: image.path } : undefined
    })
    return images.every((image): image is RenderImage => image !== undefined) ? images : undefined
  } catch { return undefined }
}

function unavailable(reason: RenderUnavailableReason, retried = false): RenderResult {
  return { kind: 'unavailable', images: [], retried, reason }
}

/**
 * Render a batch with at most one input-size retry.
 * @param run - Runs the same batch, optionally with a measured byte limit.
 * @param measure - Reads the current saved PPTX size after an input-size rejection.
 * @param retryCap - Maximum eligible size in bytes, inclusive.
 * @param pages - Slide numbers the manifest must account for.
 * @returns Image paths for the complete batch, or an explicit failure with no images.
 */
export async function renderBatch(
  run: (maxInputBytes?: number) => Promise<ProcessResult>,
  measure: () => Promise<number | undefined>,
  retryCap: number,
  pages: readonly number[],
): Promise<RenderResult> {
  const first = await run()
  let result = first
  let retried = false
  if (first.exitCode !== 0) {
    if (failureCode(first.stderr) !== 'input-too-large') return unavailable('render-failed')
    const size = await measure()
    if (size === undefined || size < 1 || size > retryCap) return unavailable('input-too-large')
    retried = true
    result = await run(size)
    if (result.exitCode !== 0) return unavailable('retry-failed', retried)
  }
  const images = imagesFromManifest(result.stdout)
  const covered = new Set(images?.map(image => image.page))
  if (images?.length !== pages.length || pages.some(page => !covered.has(page))) return unavailable('render-failed', retried)
  return { kind: 'rendered', images, retried }
}

function cliPath(): string {
  const path = fileURLToPath(import.meta.resolve('@deepseek-ai/libreoffice-kit/cli'))
  return path.includes(`${sep}app.asar${sep}`) ? path.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`) : path
}

/**
 * Register a saved-PPTX renderer with one enforced bounded retry.
 * @param ctx - Context with the active Session filesystem and process services.
 * @param config - Validated render size and process-lifetime limits.
 */
export function applyPptxVisualReviewTool(ctx: Context, config: PptxVisualReviewConfig): void {
  const { pptxRetryMaxInputBytes: retryCap, pptxRenderTimeoutMs: timeout, pptxRenderGraceMs: grace } = config
  ctx.tools.register(defineTool({
    name: 'office_render_pptx',
    description: 'Render selected physical slides from a saved PPTX for visual review. The output directory must be a new directory in the current workspace. On failure, finish structure checks and report that visual inspection was not completed.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Saved PPTX path, resolved in the current workspace.' },
      pages: { type: 'array', required: true, items: { type: 'integer' }, description: 'Up to 100 one-based physical slide numbers, batched in one call.' },
      output_dir: { type: 'string', required: true, description: 'New output directory in the current workspace.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          kind: { type: 'string', required: true, enum: ['rendered', 'unavailable'] },
          images: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            page: { type: 'integer', required: true }, path: { type: 'string', required: true },
          } } },
          retried: { type: 'boolean', required: true },
          reason: { type: 'string', enum: ['input-too-large', 'retry-failed', 'render-failed'] },
        },
      },
      render: (_args, result) => [{ type: 'text', text: result.kind === 'rendered'
        ? result.images.map(image => `Slide ${String(image.page)}: ${image.path}`).join('\n')
          + (result.retried ? '\nRendered after one input-size retry.' : '')
        : `Visual inspection was not completed (${result.reason}). Provide the structurally verified PPTX and state the visual inspection coverage.` }],
    },
    presentCall(args) {
      return { card: 'generic', kind: 'read', title: 'Render selected PPTX slides', rawInput: args.file_path }
    },
    async execute(args, exec): Promise<RenderResult> {
      if (exec.agent === undefined) throw new Error('office_render_pptx requires an agent Session')
      if (!args.file_path.toLowerCase().endsWith('.pptx')) throw new Error('file_path must name a .pptx file')
      if (!Array.isArray(args.pages) || args.pages.length === 0 || args.pages.some(page => !Number.isSafeInteger(page) || page < 1)) {
        throw new Error('pages must contain one or more positive integer slide numbers')
      }
      if (args.pages.length > RENDERER_MAX_PAGES) throw new Error('pages must contain no more than 100 slide numbers')
      if (new Set(args.pages).size !== args.pages.length) throw new Error('pages must not repeat a slide number')
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const source = await ctx.fs.resolve(args.file_path, { cwd, signal: exec.signal })
      const output = await ctx.fs.resolve(args.output_dir, { cwd, signal: exec.signal })
      const root = await ctx.fs.resolve(cwd, { signal: exec.signal })
      if (!ctx.fs.contains(root, output)) throw new Error('output_dir must be inside the current workspace')
      const sourceInfo = await ctx.fs.stat(source, exec.signal)
      if (sourceInfo?.type !== 'file') throw new FsError(`cannot render "${source.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      if (await ctx.fs.stat(output, exec.signal) !== undefined) throw new Error('output_dir must not already exist')
      const cli = cliPath()
      const baseArgv = [process.execPath, cli, 'render', '--input', ctx.fs.processPath(source), '--output-dir', ctx.fs.processPath(output), '--pages', args.pages.join(',')]
      const policy = ctx.sandboxPolicy.resolve({ session: exec.agent.session })
      const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(timeout)])
      const run = async (maxInputBytes?: number): Promise<ProcessResult> => {
        signal.throwIfAborted()
        const argv = maxInputBytes === undefined ? baseArgv : [...baseArgv, '--max-input-bytes', String(maxInputBytes)]
        const invocation = policy.mode === 'danger-full-access'
          ? { argv: [...argv] }
          : await ctx.sandbox.confine(argv, {
            mode: policy.mode,
            workspaceRoot: policy.workspaceRoot,
            ...policy.additionalWritableRoots === undefined ? {} : { additionalWritableRoots: policy.additionalWritableRoots },
            ...policy.sessionId === undefined ? {} : { sessionId: policy.sessionId },
          }, signal)
        const child = ctx.subprocess.spawn({ argv: invocation.argv, cwd: ctx.fs.processPath(root), signal, graceMs: grace,
          stdio: { stdin: 'ignore', stdout: { maxBytes: OUTPUT_BYTES }, stderr: { maxBytes: OUTPUT_BYTES } },
          env: process.versions.electron === undefined ? {} : { ELECTRON_RUN_AS_NODE: '1' } })
        const outcome = await child.done
        exec.signal.throwIfAborted()
        if (signal.aborted) return { exitCode: null, stdout: '', stderr: '' }
        return { exitCode: outcome.exitCode, stdout: child.collected.stdout?.readFrom(0).text ?? '', stderr: child.collected.stderr?.readFrom(0).text ?? '' }
      }
      const result = await renderBatch(run, async () => {
        const currentSource = await ctx.fs.stat(source, signal)
        return currentSource?.type === 'file' ? currentSource.size : undefined
      }, retryCap, args.pages)
      if (result.kind === 'unavailable') return result
      for (const image of result.images) {
        const target = await ctx.fs.resolve(image.path, { cwd, signal })
        if (!ctx.fs.contains(output, target) || (await ctx.fs.stat(target, signal))?.type !== 'file') {
          return unavailable('render-failed', result.retried)
        }
      }
      ctx.emit('fs/observed', source, { kind: 'present', version: sourceInfo.version }, exec)
      return result
    },
  }))
}

export { failureCode, imagesFromManifest }
