/** Browser-safe types for the Insight categorized skill picker. */

/** Product-visible source groups. */
export type InsightSkillOrigin = 'platform' | 'account' | 'shared'

/** Whether a discovered entry can be inserted into an explicit user draft. */
export type InsightSkillAvailability = 'callable' | 'shadowed' | 'disabled' | 'invalid' | 'unavailable' | 'unconfirmed'

/** One observed product skill, including non-callable entries needed for user feedback. */
export interface InsightSkillInventoryEntry {
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
