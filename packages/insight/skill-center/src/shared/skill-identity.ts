/** Shared catalogue and installation matching, independent of local storage paths. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { InsightSkillId, SkillIdentity } from './skill-installation.ts'

/** Result of an unambiguous identity lookup. */
export type SkillIdentityMatch<T> =
  | { readonly kind: 'match'; readonly value: T }
  | { readonly kind: 'missing' }
  | { readonly kind: 'conflict' }

/**
 * Normalize an OSS ID without interpreting it as a path or technical name.
 * @param value - External ID; absent, null, and empty strings mean no ID.
 * @returns Canonical opaque ID, or undefined when absent.
 * @throws {Error} for unsupported ID values.
 */
export function normalizeSkillId(value: unknown): InsightSkillId | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return brandString<InsightSkillId>(String(value))
  if (typeof value === 'string' && value.trim() !== '') return brandString<InsightSkillId>(value.trim())
  if (typeof value === 'string') return undefined
  throw new Error('Skill catalogue ID must be a string or nonnegative safe integer.')
}

/**
 * Produce a UI lookup key without conflating numeric IDs with technical names.
 * @param identity - Catalogue or installed identity.
 * @returns Namespaced key used only by in-memory views.
 */
export function skillIdentityKey(identity: SkillIdentity): string {
  return identity.id === undefined ? `name:${identity.skillName}` : `id:${identity.id}`
}

/**
 * Match IDs first; use an exact technical name only when either side lacks an ID.
 * @param identity - Identity to resolve.
 * @param candidates - Available records; ambiguous fallback names are conflicts.
 * @param catalogue - Complete source catalogue, when available; omission checks candidate uniqueness only.
 * @returns A single match, absence, or conflict; distinct nonempty IDs never match by name.
 */
export function matchSkillIdentity<T extends SkillIdentity>(
  identity: SkillIdentity, candidates: readonly T[], catalogue?: readonly SkillIdentity[],
): SkillIdentityMatch<T> {
  if (identity.id !== undefined) {
    const ids = candidates.filter(candidate => candidate.id === identity.id)
    if (ids.length > 1) return { kind: 'conflict' }
    const [matched] = ids
    if (matched !== undefined) return { kind: 'match', value: matched }
  }
  const names = candidates.filter(candidate => candidate.skillName === identity.skillName)
  if (names.length > 1) return { kind: 'conflict' }
  const [matched] = names
  if (matched === undefined) return { kind: 'missing' }
  if (identity.id !== undefined && matched.id !== undefined) return { kind: 'conflict' }
  if (catalogue !== undefined && catalogue.filter(candidate => candidate.skillName === identity.skillName).length > 1) {
    return { kind: 'conflict' }
  }
  return { kind: 'match', value: matched }
}
