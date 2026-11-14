/** Values shared by the platform-skill Host service and its browser client. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Technical skill identifiers admit no filesystem separators. */
export const PLATFORM_SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** Technical name shared by the catalogue skill_id and SKILL.md.name. */
export type InsightSkillId = Branded<'InsightSkillId'>

/** Installation identity independent of the catalogue numeric ID. */
export interface SkillIdentity {
  readonly id: InsightSkillId
}

/** Client-generated identity for one install or update attempt. */
export type PlatformSkillOperationId = Branded<'PlatformSkillOperationId'>

/** One committed account installation. */
export interface InstalledPlatformSkill extends SkillIdentity { readonly version: string }

/** Complete committed installation state for the current account. */
export interface PlatformSkillSnapshot { readonly skills: readonly InstalledPlatformSkill[] }

/** Catalogue release selected for installation or update. */
export interface PlatformSkillInstallRequest extends SkillIdentity {
  readonly version: string
  readonly operationId: PlatformSkillOperationId
  readonly downloadUrl: string
}

/** Remove the installation identified by its technical name. */
export type PlatformSkillRemovalRequest = SkillIdentity

/** Observable work emitted until installation commits. */
export type PlatformSkillInstallProgress =
  | { readonly kind: 'progress'; readonly operationId: PlatformSkillOperationId; readonly phase: 'download'; readonly receivedBytes: number; readonly totalBytes?: number }
  | { readonly kind: 'progress'; readonly operationId: PlatformSkillOperationId; readonly phase: 'validate' | 'commit' }
  | PlatformSkillOperationSettlement

/** Final state after cancellation has drained or installation has committed. */
export type PlatformSkillOperationSettlement =
  | { readonly kind: 'complete'; readonly operationId: PlatformSkillOperationId; readonly skill: InstalledPlatformSkill }
  | { readonly kind: 'cancelled'; readonly operationId: PlatformSkillOperationId }
