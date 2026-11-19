/** Workflow guidance that supplements the built-in skills in Insight Desktop. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'
import { applyPdfTextTool } from './pdf-text.ts'
import { applyPptxVisualReviewTool } from './pptx-visual-review.ts'

/** Loader identity for the Insight skill extensions. */
export const name = 'insight-builtin-skill-extensions'

/** Prompt, tool, and workspace file services used by the extension. */
export const inject = ['systemPrompt', 'tools', 'fs', 'workingDirectory', 'sandbox', 'sandboxPolicy', 'subprocess']

/** Resource limits for Office tools. */
export interface Config {
  /** Maximum PDF input bytes read per call. */
  readonly pdfMaxInputBytes: number
  /** Maximum consecutive pages read per call. */
  readonly pdfMaxPagesPerCall: number
  /** Maximum UTF-8 bytes in one extraction result. */
  readonly pdfMaxOutputBytes: number
  /** Maximum size of a saved PPTX eligible for one render retry, in bytes. */
  readonly pptxRetryMaxInputBytes: number
  /** Deadline in milliseconds for the complete visual review command. */
  readonly pptxRenderTimeoutMs: number
  /** Grace period in milliseconds before forced termination. */
  readonly pptxRenderGraceMs: number
}

/** Validate resource limits before advertising the tools. */
export const Config = z.object({
  pdfMaxInputBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  pdfMaxPagesPerCall: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  pdfMaxOutputBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  pptxRetryMaxInputBytes: z.number().step(1).min(1).max(160 * 1024 * 1024).required(),
  pptxRenderTimeoutMs: z.number().step(1).min(1).max(2_147_483_647).required(),
  pptxRenderGraceMs: z.number().step(1).min(1).max(2_147_483_647).required(),
})

/**
 * Register paged PDF extraction, bounded PPTX rendering, and Office workflow guidance.
 * @param ctx - Plugin scope that owns the tools and prompt contribution.
 * @param config - Validated tool limits.
 */
export function apply(ctx: Context, config: Config): void {
  applyPdfTextTool(ctx, config)
  applyPptxVisualReviewTool(ctx, config)
  ctx.systemPrompt.context({
    name,
    order: 0,
    interpolate: false,
    text: [
      'Office skill extensions:',
      'For PDF content analysis, summaries, or questions, call pdf_extract_text first. Cite the original PDF page numbers. Render only relevant pages that lack usable text or need visual inspection of figures or layout.',
      'For an edited PPTX, reopen the saved file with python-pptx to verify its structure. If the model accepts images and visual review is needed, call office_render_pptx with the saved PPTX and all selected slide numbers in one batch. Use a fresh preview directory in the workspace, inspect the returned images, then remove those previews.',
      'office_render_pptx handles size retries. If it cannot render the batch, stop the visual review, deliver the structurally verified PPTX, and state that visual inspection was not completed. On success, report which slides you inspected.',
    ].join('\n'),
  })
}
