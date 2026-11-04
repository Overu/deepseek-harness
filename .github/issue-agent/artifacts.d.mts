/** Strict model response accepted by the publisher. */
export interface AgentResult {
  mode: 'reply' | 'change' | 'update'
  reply: string
  pr_title: string
  pr_body: string
  kind: string
  areas: string[]
}

/** One bounded regular-file addition, replacement, mode change, or deletion. */
export interface FileChange {
  path: string
  content: string | null
  mode: '100644' | '100755'
}

/**
 * Read changed regular files without staging or executing repository code.
 * @param workdir Editable checkout.
 * @param limits Optional lower file and byte ceilings.
 * @returns Validated file changes.
 */
export function collectChanges(workdir: string, limits?: { maxFiles?: number; maxBytes?: number }): Promise<FileChange[]>

/**
 * Validate the model's response fields and publication mode.
 * @param value Parsed untrusted JSON.
 * @returns Validated response.
 */
export function validateResult(value: unknown): AgentResult

/**
 * Validate paths, file types, encodings, and aggregate limits.
 * @param value Parsed untrusted file changes.
 * @returns Validated regular-file changes.
 */
export function validateChanges(value: unknown): FileChange[]

/**
 * Require no changes for replies and a nonempty change set for new or existing PRs.
 * @param result Model response.
 * @param changes Collected file changes.
 * @returns Validated publication data.
 */
export function validateOutcome(result: unknown, changes: unknown): { result: AgentResult; changes: FileChange[] }

/**
 * Apply only regular-file data after validating every destination.
 * @param workdir Clean checkout of the prepared commit.
 * @param changes Untrusted regular-file changes.
 * @returns Resolves when all changes are applied.
 */
export function applyChanges(workdir: string, changes: unknown): Promise<void>
