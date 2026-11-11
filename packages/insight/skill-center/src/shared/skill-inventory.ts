/** Browser-safe types for Insight skill discovery. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Product-visible source groups. */
export type InsightSkillOrigin = 'platform' | 'legacy' | 'account' | 'shared'

/** Sources where users install and maintain their own skills. */
export type InsightCustomSkillOrigin = Extract<InsightSkillOrigin, 'account' | 'shared'>

/**
 * Classify user-installed sources for both the directory and the composer picker.
 * @param origin - Skill source from the Host.
 * @returns Whether the source is a user skill directory.
 */
export function isCustomSkillOrigin(origin: InsightSkillOrigin): origin is InsightCustomSkillOrigin {
  return origin === 'account' || origin === 'shared'
}

/** Whether a discovered entry can be inserted into an explicit user draft. */
export type InsightSkillAvailability = 'callable' | 'shadowed' | 'disabled' | 'invalid' | 'unavailable' | 'unconfirmed'

/** One observed product skill, including non-callable entries needed for user feedback. */
export interface InsightSkillInventoryEntry {
  /** Stable identity for a custom installation, including same-name installations. */
  readonly customId?: InsightCustomSkillId
  readonly name: string
  readonly description: string
  /** Optional label from this installed skill's sibling ui.json. */
  readonly displayName?: string
  /** Optional concise description for the picker; never changes model routing. */
  readonly shortDescription?: string
  readonly origin: InsightSkillOrigin
  readonly availability: InsightSkillAvailability
}

/** Read-only inventory returned to the product skill picker. */
export interface InsightSkillInventorySnapshot {
  readonly entries: readonly InsightSkillInventoryEntry[]
  /** False when discovery could not establish an authoritative current view. */
  readonly complete: boolean
}

/** Opaque identity for one locally discovered custom skill. */
export type InsightCustomSkillId = Branded<'InsightCustomSkillId'>

/** A custom skill available from an account or shared skill directory. */
export interface InsightCustomSkillEntry {
  readonly id: InsightCustomSkillId
  readonly name: string
  readonly description: string
  readonly displayName?: string
  readonly shortDescription?: string
  readonly origin: InsightCustomSkillOrigin
  /** Whether discovery confirmed the installation can be selected for removal. */
  readonly removable: boolean
}

/** Current discovery result for skills outside the published catalogue. */
export interface InsightCustomSkillSnapshot {
  readonly entries: readonly InsightCustomSkillEntry[]
  /** False when discovery could not establish an authoritative current view. */
  readonly complete: boolean
}
