/** Pure renderer-result parsing and the upper retry boundary. */
import { expect, it, vi } from 'vitest'
import { failureCode, imagesFromManifest, renderBatch } from '../src/pptx-visual-review.ts'

const cap = 160 * 1024 * 1024
const tooLarge = { exitCode: 1, stdout: '', stderr: '{"code":"input-too-large"}' }
const rendered = {
  exitCode: 0, stdout: '{"images":[{"page":1,"path":"/preview/1.png"},{"page":3,"path":"/preview/3.png"}]}', stderr: '',
}

it('reads only a structured renderer failure code', () => {
  expect(failureCode('diagnostic\n{"code":"input-too-large","error":"limited"}\n')).toBe('input-too-large')
  expect(failureCode('input-too-large')).toBeUndefined()
})

it('accepts only slide-numbered image paths from a renderer manifest', () => {
  expect(imagesFromManifest('{"images":[{"page":1,"path":"/workspace/page-0001.png"}]}'))
    .toEqual([{ page: 1, path: '/workspace/page-0001.png' }])
  expect(imagesFromManifest('{"images":[{}]}')).toBeUndefined()
})

it('measures after the first size rejection and retries once at the ceiling', async () => {
  const run = vi.fn().mockResolvedValueOnce(tooLarge).mockResolvedValueOnce(rendered)
  const result = await renderBatch(run, async () => cap, cap, [1, 3])
  expect(result).toMatchObject({ kind: 'rendered', retried: true, images: [{ page: 1 }, { page: 3 }] })
  expect(run.mock.calls).toEqual([[], [cap]])
})

it('keeps zero previews when the file is over the retry ceiling', async () => {
  const run = vi.fn().mockResolvedValue(tooLarge)
  await expect(renderBatch(run, async () => cap + 1, cap, [1, 3])).resolves.toEqual({
    kind: 'unavailable', reason: 'input-too-large', retried: false, images: [],
  })
  expect(run.mock.calls).toEqual([[]])
})

it('stops after the first non-size error or after one failed size retry', async () => {
  const failed = { exitCode: 1, stdout: '', stderr: '{"code":"timeout"}' }
  const run = vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(tooLarge).mockResolvedValueOnce(failed)
  const measure = vi.fn(async () => cap)
  await expect(renderBatch(run, measure, cap, [1, 3])).resolves.toMatchObject({ reason: 'render-failed', retried: false })
  expect(measure).not.toHaveBeenCalled()
  await expect(renderBatch(run, measure, cap, [1, 3])).resolves.toMatchObject({ reason: 'retry-failed', retried: true })
  expect(run.mock.calls).toEqual([[], [], [cap]])
})
