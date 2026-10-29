import assert from 'node:assert/strict'
import test from 'node:test'
import { isGenerationCounts, normalizeGenerationCounts, sameGenerationCounts, addGenerationCounts, generationOutputCount } from '../src/shared/canvas-generation-counts.ts'

test('old two-field counts remain valid and compare to explicit zero audio', () => {
  const old = { images: 1, videos: 0 }
  assert(isGenerationCounts(old)); assert.deepEqual(normalizeGenerationCounts(old), { images: 1, videos: 0, audios: 0 })
  assert(sameGenerationCounts(old, { ...old, audios: 0 })); assert(!sameGenerationCounts(old, { ...old, audios: 1 }))
  assert.deepEqual(addGenerationCounts(old, { images: 0, videos: 2 }), { images: 1, videos: 2 })
  assert.deepEqual(addGenerationCounts(old, { images: 0, videos: 0, audios: 3 }), { images: 1, videos: 0, audios: 3 })
  assert.equal(generationOutputCount({ images: 1, videos: 2, audios: 3 }), 6)
})
test('invalid, extra and overflowing counts are refused', () => {
  for (const value of [{ images: 0, videos: 0, audios: -1 }, { images: 1, videos: 0, audios: 1.1 }, { images: 1, videos: 0, audios: '1' }, { images: 1, videos: 0, token: 1 }, { images: Number.MAX_SAFE_INTEGER, videos: 1 }]) {
    assert.equal(isGenerationCounts(value), false); assert.throws(() => normalizeGenerationCounts(value))
  }
  assert.throws(() => addGenerationCounts({ images: Number.MAX_SAFE_INTEGER, videos: 0 }, { images: 0, videos: 0, audios: 1 }))
})
