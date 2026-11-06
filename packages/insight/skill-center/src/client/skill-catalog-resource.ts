/** Read and normalize the published Insight skill catalogue. */
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { Config } from '../config.ts'
import type { InsightSkillId, SkillIdentity } from '../shared/skill-installation.ts'
import { normalizeSkillId } from '../shared/skill-identity.ts'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** The original desktop catalogue endpoint. */
export const SKILL_CATALOG_URL = 'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/skills.json'

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
    /** The enabled Insight skills published to OSS. */
    'insight-skill-catalog': readonly SkillCatalogItem[]
  }
}


/**
 * Build one stable resource address. Changing the attempt explicitly requests a new read.
 * @param attempt - The user-requested read attempt number.
 * @returns the address consumed by the catalogue resource provider.
 */
export function skillCatalogAddress(attempt: number): string {
  return `dsh-resource://insight-skill-catalog/catalog?attempt=${attempt}`
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
  if (!isRecord(payload) || !Array.isArray(payload.skills)) {
    throw new InvalidCatalogError('The skill catalogue must contain a skills array.')
  }
  const skills: Array<SkillCatalogItem & { readonly sort: number }> = []
  const ids = new Set<string>()
  for (const entry of payload.skills) {
    if (!isRecord(entry) || Number(entry.enabled) !== 1) continue
    let id: InsightSkillId
    try {
      id = normalizeSkillId(stringField(entry, 'skill_id'))
    } catch (error) {
      throw new InvalidCatalogError(error instanceof Error ? error.message : String(error))
    }
    if (ids.has(id)) throw new InvalidCatalogError(`The skill catalogue repeats the technical name ${id}.`)
    ids.add(id)
    const name = stringField(entry, 'name').trim() || id
    const version = stringField(entry, 'version').trim() || '1.0.0'
    skills.push({
      id,
      name,
      summary: stringField(entry, 'skill_desc').trim(),
      version,
      descriptionMarkdown: stringField(entry, 'description_markdown').trim(),
      downloadUrl: stringField(entry, 'download_url').trim(),
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
 * Supply the OSS catalogue as a resource stream.
 * @param config - Validated request deadline.
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
      const requestUrl = new URL(SKILL_CATALOG_URL)
      requestUrl.searchParams.set('_', String(Date.now()))
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(config.catalogRequestTimeoutMs)])
      let payload: unknown
      try {
        const response = await fetchImplementation(requestUrl.toString(), { headers: { Accept: 'application/json' }, signal: requestSignal })
        if (aborted()) return
        if (!response.ok) {
          yield { ok: false, error: new RemoteError('gateway/internal', `Skill catalogue request failed with HTTP ${response.status}.`, {}) }
          return
        }
        payload = await response.json()
        requestSignal.throwIfAborted()
      } catch (error) {
        if (!aborted()) {
          yield { ok: false, error: new RemoteError('gateway/internal', error instanceof Error ? error.message : String(error), {}) }
        }
        return
      }
      try {
        yield { ok: true, value: normalizeCatalog(payload) }
      } catch (_error) {
        yield {
          ok: false,
          error: new RemoteError('gateway/bad-request', 'The skill catalogue must contain a skills array with distinct technical names.', {}),
        }
      }
    },
  }
}
