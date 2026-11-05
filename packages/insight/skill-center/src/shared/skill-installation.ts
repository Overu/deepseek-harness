/** Values shared by the platform-skill Host service and its browser client. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Account-local storage keys admit no filesystem separators. */
export const PLATFORM_SKILL_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** Stable identifier published by the Insight skill catalogue. */
export type InsightSkillId = Branded<'InsightSkillId'>

/** Account-local installation key, independent of a catalogue's identifier. */
export type PlatformSkillKey = Branded<'PlatformSkillKey'>

/** Management identity; exact technical names are used only when either side lacks an ID. */
export interface SkillIdentity {
  readonly id?: InsightSkillId
  readonly skillName: string
}

/** Client-generated identity for one install or update attempt. */
export type PlatformSkillOperationId = Branded<'PlatformSkillOperationId'>

/** One committed account installation. */
export interface InstalledPlatformSkill extends SkillIdentity { readonly key: PlatformSkillKey; readonly version: string }

/** Complete committed installation state for the current account. */
export interface PlatformSkillSnapshot { readonly skills: readonly InstalledPlatformSkill[] }

/** Catalogue release selected for installation or update. */
export interface PlatformSkillInstallRequest extends SkillIdentity {
  /** Existing target for an update; omission resolves by identity or creates a new local key. */
  readonly key?: PlatformSkillKey
  readonly version: string
  readonly operationId: PlatformSkillOperationId
  readonly downloadUrl: string
}

/** Remove one local installation while retaining its currently matched catalogue identity. */
export interface PlatformSkillRemovalRequest extends SkillIdentity {
  readonly key: PlatformSkillKey
}

/** Observable work emitted until installation commits. */
export type PlatformSkillInstallProgress =
  | { readonly kind: 'progress'; readonly operationId: PlatformSkillOperationId; readonly phase: 'download'; readonly receivedBytes: number; readonly totalBytes?: number }
  | { readonly kind: 'progress'; readonly operationId: PlatformSkillOperationId; readonly phase: 'validate' | 'commit' }
  | PlatformSkillOperationSettlement

/** Final state after cancellation has drained or installation has committed. */
export type PlatformSkillOperationSettlement =
  | { readonly kind: 'complete'; readonly operationId: PlatformSkillOperationId; readonly skill: InstalledPlatformSkill }
  | { readonly kind: 'cancelled'; readonly operationId: PlatformSkillOperationId }
