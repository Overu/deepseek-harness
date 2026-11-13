/** Technical-name matching shared by the catalogue and account installations. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { PLATFORM_SKILL_ID_PATTERN } from './skill-installation.ts'
import type { InsightSkillId, SkillIdentity } from './skill-installation.ts'

/** Result of an unambiguous technical-name lookup. */
export type SkillIdentityMatch<T> =
  | { readonly kind: 'match'; readonly value: T }
  | { readonly kind: 'missing' }
  | { readonly kind: 'conflict' }

/**
 * Validate a technical name read from catalogue or persisted data.
 * @param value - Technical name; numeric catalogue identifiers are not accepted.
 * @returns The validated technical identifier.
 * @throws {Error} when the value is not a kebab-case technical name.
 */
export function normalizeSkillId(value: unknown): InsightSkillId {
  if (typeof value !== 'string' || !PLATFORM_SKILL_ID_PATTERN.test(value.trim())) {
    throw new Error('Skill technical name must be a nonempty kebab-case string.')
  }
  return brandString<InsightSkillId>(value.trim())
}

/**
 * Match an installation solely by technical name.
 * @param identity - Technical name to resolve.
 * @param candidates - Available records, each identified by technical name.
 * @returns A single match, absence, or duplicate-name conflict.
 */
export function matchSkillIdentity<T extends SkillIdentity>(
  identity: SkillIdentity, candidates: readonly T[],
): SkillIdentityMatch<T> {
  const matches = candidates.filter(candidate => candidate.id === identity.id)
  if (matches.length > 1) return { kind: 'conflict' }
  const [matched] = matches
  return matched === undefined ? { kind: 'missing' } : { kind: 'match', value: matched }
}
