/** PDF text extraction runs through the repository's locked PDF.js implementation. */
import { expect, it } from 'vitest'
import { extractPdfText } from '../src/pdf-text.ts'

function fixture(): Uint8Array {
  const streams = ['BT /F1 12 Tf 14 TL 72 700 Td (First page) Tj T* (Second line) Tj ET', 'BT /F1 12 Tf 72 700 Td (Second page) Tj ET', '']
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  for (const stream of streams) {
    const page = objects.length + 1
    const content = page + 1
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(content)} 0 R >>`)
    objects.push(`<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`)
  }
  let text = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(text.length)
    text += `${String(index + 1)} 0 obj\n${object}\nendobj\n`
  }
  const xref = text.length
  text += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, '0')} 00000 n \n`
  text += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`
  return new TextEncoder().encode(text)
}

it('accepts filesystem bytes and returns source page numbers, text, and a blank physical page', async () => {
  await expect(extractPdfText(Buffer.from(fixture()), 1, 3, 3, 2_000)).resolves.toEqual({
    pageCount: 3,
    pages: [
      { pageNumber: 1, text: 'First page\nSecond line' },
      { pageNumber: 2, text: 'Second page' },
      { pageNumber: 3, text: '' },
    ],
  })
})

it('enforces page and output bounds before returning text', async () => {
  const source = fixture()
  await expect(extractPdfText(source, 1, 3, 2, 2_000)).rejects.toThrow('2-page limit')
  await expect(extractPdfText(source, 1, 1, 3, 10)).rejects.toThrow('output limit')
})
