/** Read and normalize the published Insight skill catalogue. */
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { Config } from '../config.ts'
import { SKILL_CATALOG_PATH } from '../shared/catalog-api.ts'
import type { InsightSkillId, SkillIdentity } from '../shared/skill-installation.ts'
import { normalizeSkillId } from '../shared/skill-identity.ts'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** Authenticated catalogue route owned by the skill-center Host plugin. */
export const SKILL_CATALOG_URL = SKILL_CATALOG_PATH

/** A published skill identifier admitted by the catalogue parser. */
export type { InsightSkillId } from '../shared/skill-installation.ts'

/** One enabled skill shown in the marketplace. */
export interface SkillCatalogItem extends SkillIdentity {
  readonly name: string
  readonly summary: string
  readonly version: string
  readonly descriptionMarkdown: string
  readonly downloadUrl: string
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    /** The installable official Insight skills published to the desktop channel. */
    'insight-skill-catalog': readonly SkillCatalogItem[]
  }
}


/**
 * Build a resource address scoped to the page or one-time preset initialization.
 * @param attempt - The user-requested read attempt number.
 * @param reader - The consumer whose subscription owns the read lifetime.
 * @returns the address consumed by the catalogue resource provider.
 */
export function skillCatalogAddress(attempt: number, reader: 'page' | 'presets'): string {
  return `dsh-resource://insight-skill-catalog/catalog?reader=${reader}&attempt=${attempt}`
}

/** A known-invalid catalogue document. */
class InvalidCatalogError extends Error {}

/** Check whether a JSON value is a record, excluding arrays and null. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a string field, with an empty value for absent or non-string data. */
function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  return typeof value === 'string' ? value : ''
}

/** Return a sortable numeric value while preserving the catalogue's zero fallback. */
function sortValue(record: Record<string, unknown>): number {
  const value = Number(record.sort ?? 0)
  return Number.isFinite(value) ? value : 0
}

/**
 * Normalize the external JSON document into data the UI can safely render.
 * @param payload - Decoded JSON from the catalogue endpoint.
 * @returns enabled, distinct skills in their published sort order.
 * @throws {InvalidCatalogError} when the document lacks the required catalogue structure.
 */
export function normalizeCatalog(payload: unknown): readonly SkillCatalogItem[] {
  if (!isRecord(payload) || !Array.isArray(payload.records)) {
    throw new InvalidCatalogError('The skill catalogue must contain a records array.')
  }
  const skills: Array<SkillCatalogItem & { readonly sort: number }> = []
  const ids = new Set<string>()
  for (const entry of payload.records) {
    if (!isRecord(entry) || Number(entry.enabled) !== 1) continue
    let id: InsightSkillId
    try {
      id = normalizeSkillId(stringField(entry, 'skillId'))
    } catch (error) {
      throw new InvalidCatalogError(error instanceof Error ? error.message : String(error))
    }
    if (ids.has(id)) throw new InvalidCatalogError(`The skill catalogue repeats the technical name ${id}.`)
    ids.add(id)
    const name = stringField(entry, 'name').trim() || id
    const version = stringField(entry, 'packageVersion').trim()
    const downloadUrl = stringField(entry, 'packageUrl').trim()
    if (!version || !downloadUrl) continue
    skills.push({
      id,
      name,
      summary: stringField(entry, 'summary').trim(),
      version,
      descriptionMarkdown: stringField(entry, 'skill_desc').trim(),
      downloadUrl,
      sort: sortValue(entry),
    })
  }
  skills.sort((left, right) => left.sort - right.sort)
  return skills.map(({ sort: _sort, ...skill }) => skill)
}

/** Check that an address names this provider's only resource. */
function isCatalogAddress(address: string): boolean {
  try {
    const resource = new URL(address)
    return resource.protocol === 'dsh-resource:'
      && resource.hostname === 'insight-skill-catalog'
      && resource.pathname === '/catalog'
  } catch {
    return false
  }
}

/**
 * Read all desktop-channel API pages through the skill-center Host route.
 * @param config - Validated deadline for the complete catalogue read.
 * @param fetchImplementation - Fetch implementation, injectable for focused provider tests.
 * @returns the single-read provider; releasing its resource aborts the request.
 */
export function skillCatalogResourceProvider(
  config: Config, fetchImplementation: typeof fetch = fetch,
): ResourceProvider<'insight-skill-catalog'> {
  return {
    protocol: 'insight-skill-catalog',
    async *open(address, { signal }): AsyncIterable<RemoteResult<readonly SkillCatalogItem[]>> {
      const aborted = (): boolean => signal.aborted
      if (aborted()) return
      if (!isCatalogAddress(address)) {
        yield { ok: false, error: new RemoteError('gateway/bad-request', 'Invalid skill catalogue resource address.', {}) }
        return
      }
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(config.catalogRequestTimeoutMs)])
      const records: unknown[] = []
      const read = async (url: string): Promise<unknown> => {
        const response = await fetchImplementation(url, {
          headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: requestSignal,
        })
        requestSignal.throwIfAborted()
        if (!response.ok) throw new Error(`Skill catalogue request failed with HTTP ${response.status}.`)
        const payload: unknown = await response.json()
        requestSignal.throwIfAborted()
        if (!isRecord(payload) || (payload.code !== 'SUCCESS' && payload.code !== 200 && payload.code !== 0)) {
          throw new Error('Skill catalogue API request failed.')
        }
        return payload.data
      }
      try {
        for (let page = 1; ; page++) {
          const query = new URLSearchParams({ businessChannel: 'A', source: 'OFFICIAL', page: String(page), pageSize: '50' })
          const data = await read(`${SKILL_CATALOG_URL}?${query}`)
          if (!isRecord(data) || !Array.isArray(data.records)
            || typeof data.total !== 'number' || !Number.isSafeInteger(data.total) || data.total < 0) {
            throw new InvalidCatalogError('Invalid skill catalogue page.')
          }
          const pageRecords: readonly unknown[] = data.records
          records.push(...pageRecords)
          if (records.length >= data.total) break
          if (data.records.length === 0 || page >= 10000) throw new InvalidCatalogError('Incomplete skill catalogue pages.')
        }
        yield { ok: true, value: normalizeCatalog({ records }) }
      } catch (error) {
        if (!aborted()) {
          yield { ok: false, error: new RemoteError(
            error instanceof InvalidCatalogError ? 'gateway/bad-request' : 'gateway/internal',
            error instanceof Error ? error.message : String(error), {},
          ) }
        }
      }
    },
  }
}
