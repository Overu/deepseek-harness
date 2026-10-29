import type { GenerationCounts } from './canvas-agent-protocol.ts'

/** Audio is optional on the wire so historical schemaVersion=1 records stay readable. */
export function isGenerationCounts(value: unknown): value is GenerationCounts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const counts = value as Record<string, unknown>
  return Object.keys(counts).every(key => ['images', 'videos', 'audios'].includes(key))
    && ['images', 'videos'].every(key => Object.hasOwn(counts, key))
    && Object.values(counts).every(count => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
    && Number.isSafeInteger(Number(counts.images) + Number(counts.videos) + Number(counts.audios ?? 0))
}
export function normalizeGenerationCounts(value: GenerationCounts): Required<GenerationCounts> {
  if (!isGenerationCounts(value)) throw new RangeError('生成计数必须为范围内的非负安全整数')
  return { images: value.images, videos: value.videos, audios: value.audios ?? 0 }
}
export function sameGenerationCounts(a: GenerationCounts, b: GenerationCounts): boolean {
  if (!isGenerationCounts(a) || !isGenerationCounts(b)) return false
  return a.images === b.images && a.videos === b.videos && (a.audios ?? 0) === (b.audios ?? 0)
}
export function addGenerationCounts(a: GenerationCounts, b: GenerationCounts): GenerationCounts {
  const left = normalizeGenerationCounts(a), right = normalizeGenerationCounts(b)
  const total = { images: left.images + right.images, videos: left.videos + right.videos,
    ...(a.audios !== undefined || b.audios !== undefined ? { audios: left.audios + right.audios } : {}) }
  normalizeGenerationCounts(total)
  return total
}
export function generationOutputCount(value: GenerationCounts): number {
  const counts = normalizeGenerationCounts(value)
  return counts.images + counts.videos + counts.audios
}
