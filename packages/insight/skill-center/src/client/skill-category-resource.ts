/** Account-authenticated A-line category configuration for official skills. */
import { brandNumber, type BrandedNumber } from '@deepseek-ai/dsh-brand'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { Config } from '../config.ts'
import { SKILL_CATEGORIES_PATH } from '../shared/catalog-api.ts'

/** Identifier assigned to one business-line category configuration. */
export type SkillCategoryId = BrandedNumber<'InsightSkillCategoryId'>

/** One enabled A-line category; the UI supplies its own All option. */
export interface SkillCategory {
  readonly id: SkillCategoryId
  readonly code: string
  readonly name: string
  readonly filters: {
    readonly scene?: string
    readonly source?: 'OFFICIAL' | 'CREATOR'
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    /** Enabled skill categories for the Insight desktop business line. */
    'insight-skill-categories': readonly SkillCategory[]
  }
}

/**
 * Address a fresh, page-owned category read.
 * @param attempt - User-requested retry number.
 * @returns the category resource address.
 */
export function skillCategoryAddress(attempt: number): string {
  return `dsh-resource://insight-skill-categories/categories?attempt=${attempt}`
}

/** Check JSON records without accepting arrays or null. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An invalid category document that must not produce partial filter options. */
class InvalidCategoriesError extends Error {}

/**
 * Validate user-facing categories and preserve the server's display order.
 * @param payload - The API envelope's data value.
 * @returns distinct A-line categories, excluding the server's All option.
 * @throws {InvalidCategoriesError} when the response or a category is malformed.
 */
export function normalizeCategories(payload: unknown): readonly SkillCategory[] {
  if (!isRecord(payload) || !Array.isArray(payload.records)) {
    throw new InvalidCategoriesError('Skill categories must contain a records array.')
  }
  const categories: SkillCategory[] = []
  const ids = new Set<number>()
  for (const entry of payload.records) {
    if (!isRecord(entry) || typeof entry.id !== 'number' || !Number.isSafeInteger(entry.id) || entry.id <= 0
      || ids.has(entry.id) || entry.businessChannel !== 'A'
      || typeof entry.code !== 'string' || !entry.code.trim()
      || typeof entry.name !== 'string' || !entry.name.trim()
      || typeof entry.sort !== 'number' || !Number.isFinite(entry.sort)
      || !isRecord(entry.filters)) {
      throw new InvalidCategoriesError('Invalid skill category configuration.')
    }
    const { scene, source } = entry.filters
    if (Object.keys(entry.filters).some(key => key !== 'scene' && key !== 'source')
      || (scene !== undefined && (typeof scene !== 'string' || !scene.trim()))
      || (source !== undefined && source !== 'OFFICIAL' && source !== 'CREATOR')) {
      throw new InvalidCategoriesError('Invalid skill category filters.')
    }
    ids.add(entry.id)
    if (entry.code === 'ALL') continue
    categories.push({
      id: brandNumber<SkillCategoryId>(entry.id), code: entry.code, name: entry.name,
      filters: { ...scene === undefined ? {} : { scene }, ...source === undefined ? {} : { source } },
    })
  }
  return categories
}

/** Check the resource scheme and resource name before starting a request. */
function isCategoryAddress(address: string): boolean {
  try {
    const url = new URL(address)
    return url.protocol === 'dsh-resource:' && url.hostname === 'insight-skill-categories' && url.pathname === '/categories'
  } catch {
    return false
  }
}

/**
 * Read categories independently of the installable skill catalogue.
 * @param config - Validated request deadline shared with catalogue reads.
 * @param fetchImplementation - Transport used for the same-origin Host request.
 * @returns a provider whose release aborts the read and suppresses late results.
 */
export function skillCategoryResourceProvider(
  config: Config, fetchImplementation: typeof fetch = fetch,
): ResourceProvider<'insight-skill-categories'> {
  return {
    protocol: 'insight-skill-categories',
    async *open(address, { signal }): AsyncIterable<RemoteResult<readonly SkillCategory[]>> {
      const aborted = (): boolean => signal.aborted
      if (aborted()) return
      if (!isCategoryAddress(address)) {
        yield { ok: false, error: new RemoteError('gateway/bad-request', 'Invalid skill category resource address.', {}) }
        return
      }
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(config.catalogRequestTimeoutMs)])
      try {
        const response = await fetchImplementation(`${SKILL_CATEGORIES_PATH}?businessChannels=A`, {
          headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: requestSignal,
        })
        requestSignal.throwIfAborted()
        if (!response.ok) throw new Error(`Skill categories request failed with HTTP ${response.status}.`)
        const payload: unknown = await response.json()
        requestSignal.throwIfAborted()
        if (!isRecord(payload) || (payload.code !== 'SUCCESS' && payload.code !== 200 && payload.code !== 0)) {
          throw new InvalidCategoriesError('Skill categories API request failed.')
        }
        yield { ok: true, value: normalizeCategories(payload.data) }
      } catch (error) {
        if (!aborted()) yield { ok: false, error: new RemoteError(
          error instanceof InvalidCategoriesError ? 'gateway/bad-request' : 'gateway/internal',
          error instanceof Error ? error.message : String(error), {},
        ) }
      }
    },
  }
}
