/** Bounded per-page PDF text extraction for Insight Office analysis. */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type {} from '@deepseek-ai/dsh-working-directory'

/** Limits applied before bytes enter PDF.js and before text reaches the model. */
export interface PdfTextLimits {
  /** Inclusive byte cap for the complete source PDF. */
  readonly pdfMaxInputBytes: number
  /** Maximum number of physical pages returned by one call. */
  readonly pdfMaxPagesPerCall: number
  /** Inclusive UTF-8 byte cap for the complete canonical tool result. */
  readonly pdfMaxOutputBytes: number
}

/** One text extraction result, retaining the source document's physical page number. */
export interface PdfTextPage {
  readonly pageNumber: number
  readonly text: string
}

const encoder = new TextEncoder()
const pdfAssets = new URL('../../', import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'))

function encodedLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength
}

/**
 * Extract one bounded physical page range from complete PDF bytes.
 * @param data - Complete PDF bytes already checked by the filesystem limit.
 * @param startPage - One-based first physical PDF page.
 * @param endPage - One-based last physical PDF page.
 * @param maxPages - Maximum physical pages accepted by one request.
 * @param maxOutputBytes - Maximum UTF-8 bytes in the canonical result.
 * @param signal - Cancels extraction and releases the PDF.js loading task.
 * @returns Source page count and text from every requested physical page.
 */
export async function extractPdfText(
  data: Uint8Array,
  startPage: number,
  endPage: number | undefined,
  maxPages: number,
  maxOutputBytes: number,
  signal?: AbortSignal,
): Promise<{ pageCount: number; pages: PdfTextPage[] }> {
  signal?.throwIfAborted()
  const loading = getDocument({
    data: new Uint8Array(data),
    cMapUrl: new URL('cmaps/', pdfAssets).href,
    standardFontDataUrl: new URL('standard_fonts/', pdfAssets).href,
    wasmUrl: new URL('wasm/', pdfAssets).href,
    useSystemFonts: true,
    useWorkerFetch: false,
    stopAtErrors: true,
  })
  let disposal: Promise<void> | undefined
  const dispose = (): Promise<void> => disposal ??= loading.destroy()
  const cancel = (): void => { void dispose().catch(() => { /* The finally block awaits the same disposal. */ }) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const pdf = await loading.promise
    signal?.throwIfAborted()
    if (startPage > pdf.numPages) {
      throw new Error(`start_page ${String(startPage)} exceeds the PDF page count ${String(pdf.numPages)}`)
    }
    const lastPage = endPage ?? Math.min(pdf.numPages, startPage + maxPages - 1)
    if (lastPage < startPage) throw new Error('end_page must be greater than or equal to start_page')
    if (lastPage > pdf.numPages) throw new Error(`end_page ${String(lastPage)} exceeds the PDF page count ${String(pdf.numPages)}`)
    if (lastPage - startPage + 1 > maxPages) {
      throw new Error(`the requested page range exceeds the ${String(maxPages)}-page limit; request a smaller range`)
    }
    const pages: PdfTextPage[] = []
    for (let pageNumber = startPage; pageNumber <= lastPage; pageNumber++) {
      signal?.throwIfAborted()
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      signal?.throwIfAborted()
      const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : '') : '').join('').trim()
      pages.push({ pageNumber, text })
      if (encodedLength({ pageCount: pdf.numPages, pages }) > maxOutputBytes) {
        throw new Error(`the extracted text exceeds the ${String(maxOutputBytes)}-byte output limit; request fewer pages`)
      }
    }
    return { pageCount: pdf.numPages, pages }
  } finally {
    signal?.removeEventListener('abort', cancel)
    await dispose()
  }
}

/**
 * Register a PDF.js-backed text tool that reads files through the active Session filesystem.
 * @param ctx - Context providing the tool registry, filesystem, and Session working directory.
 * @param limits - Bounded source, page-range, and output limits for each tool call.
 */
export function applyPdfTextTool(ctx: Context, limits: PdfTextLimits): void {
  const { pdfMaxInputBytes: inputBytes, pdfMaxPagesPerCall: maxPages, pdfMaxOutputBytes: outputBytes } = limits
  ctx.tools.register(defineTool({
    name: 'pdf_extract_text',
    description: 'Extract selectable text from a PDF by original physical page number. Returns blank text for pages without selectable text. Request another bounded page range for remaining pages.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'PDF path, resolved by the filesystem backend.' },
      start_page: { type: 'integer', description: 'One-based first physical PDF page. Defaults to 1.' },
      end_page: { type: 'integer', description: 'One-based last physical PDF page. Omit to return as many pages as the configured limit permits.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          pageCount: { type: 'integer', required: true },
          pages: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: { pageNumber: { type: 'integer', required: true }, text: { type: 'string', required: true } },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    presentCall(args) {
      return { card: 'generic', kind: 'read', title: 'Read PDF text', rawInput: args.file_path }
    },
    async execute(args, exec) {
      if (args.file_path.trim() === '') throw new Error('file_path must be a non-empty string')
      const cwd = exec.agent === undefined ? undefined : await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const target = await ctx.fs.resolve(args.file_path, { ...cwd === undefined ? {} : { cwd }, signal: exec.signal })
      const info = await ctx.fs.stat(target, exec.signal)
      if (info === undefined) {
        ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
        throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
      }
      if (info.type !== 'file') throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      const startPage = args.start_page ?? 1
      if (!Number.isInteger(startPage) || startPage < 1) throw new Error('start_page must be a positive integer')
      if (args.end_page !== undefined && (!Number.isInteger(args.end_page) || args.end_page < 1)) {
        throw new Error('end_page must be a positive integer')
      }
      const data = await ctx.fs.readBytes(target, exec.signal, inputBytes)
      const extracted = await extractPdfText(data, startPage, args.end_page, maxPages, outputBytes, exec.signal)
      const result = { path: target.displayPath, ...extracted }
      if (encodedLength(result) > outputBytes) {
        throw new Error(`the extracted text exceeds the ${String(outputBytes)}-byte output limit; request fewer pages`)
      }
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      return result
    },
  }))
}
