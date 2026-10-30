/** Durable update preferences and authenticated rollout history for this Insight installation. */

import { chmod, mkdir, open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import semver from 'semver'
import { z } from 'zod'

const MAX_DOCUMENT_BYTES = 1024 * 1024
const fingerprintSchema = z.string().regex(/^[A-Za-z0-9+/]{86}==$/u)
const preferencesSchema = z.object({ schema: z.literal(1), candidateOptIn: z.boolean() }).strict()
const skippedVersionSchema = z.object({ schema: z.literal(1), version: z.string() }).strict()
const historyEntrySchema = z.object({ version: z.string(), envelopeSha512: fingerprintSchema, state: z.enum(['active', 'rejected']).default('active') }).strict()
const historySchema = z.object({ schema: z.literal(1), pointers: z.record(z.string(), historyEntrySchema) }).strict()

type Preferences = z.infer<typeof preferencesSchema>
type History = z.infer<typeof historySchema>

/** Verified rollout supplied by the update source after it verifies the signed envelope. */
export interface InsightAcceptedRollout {
  track: 'stable' | 'candidate'
  target?: string
  version: string
  state: 'active' | 'rejected'
  /** Canonical base64 SHA-512 of the already verified rollout envelope. */
  fingerprint: string
}

/** Durable installation state used by the Insight update provider. */
export class InsightUpdateStateStore {
  private readonly directory: string
  private readonly preferencesPath: string
  private readonly skippedPath: string
  private readonly historyPath: string

  /** @param userData - Electron user-data directory for this Insight installation. */
  constructor(userData: string) {
    this.directory = join(userData, 'updates')
    this.preferencesPath = join(this.directory, 'preferences.json')
    this.skippedPath = join(this.directory, 'skipped-version.json')
    this.historyPath = join(this.directory, 'rollout-history.json')
  }

  /**
   * Read the existing candidate consent without creating a new preferences file.
   * @returns Stored preference, or the unwritten default.
   */
  async readPreferences(): Promise<Preferences> {
    const raw = await readOptional(this.preferencesPath)
    if (raw === undefined) return { schema: 1, candidateOptIn: false }
    return preferencesSchema.parse(parseDocument(raw, '更新偏好'))
  }

  /** Record an explicit user opt-in for candidate update discovery. */
  async enableCandidate(): Promise<void> {
    await this.write(this.preferencesPath, () => ({ schema: 1, candidateOptIn: true }))
  }

  /**
   * Read the exact optional version the user chose to skip.
   * @returns Skipped version, if one is stored.
   */
  async skippedVersion(): Promise<string | undefined> {
    const raw = await readOptional(this.skippedPath)
    if (raw === undefined) return undefined
    const value = skippedVersionSchema.parse(parseDocument(raw, '跳过版本'))
    assertVersion(value.version, '本地跳过版本')
    return value.version
  }

  /**
   * Persist one user-selected optional version to suppress.
   * @param version - Exact optional semantic version selected by the user.
   */
  async skip(version: string): Promise<void> {
    assertVersion(version, '跳过版本')
    await this.write(this.skippedPath, () => ({ schema: 1, version }))
  }

  /**
   * Reject rollback or pointer substitution, then commit an authenticated rollout observation.
   * @param rollout - Signed rollout identity already accepted by the source resolver.
   */
  async acceptRollout(rollout: InsightAcceptedRollout): Promise<void> {
    assertVersion(rollout.version, '更新投放版本')
    fingerprintSchema.parse(rollout.fingerprint)
    const key = pointerKey(rollout.track, rollout.target)
    await this.write(this.historyPath, async () => {
      const history = await this.readHistory()
      const previous = history.pointers[key]
      if (previous !== undefined && semver.gt(previous.version, rollout.version)) {
        throw new Error('更新投放版本低于此设备已验证的版本，已拒绝可能的回放。')
      }
      if (previous?.version === rollout.version) {
        if (previous.state === 'active' && rollout.state === 'rejected') {
          return { schema: 1, pointers: { ...history.pointers, [key]: {
            version: rollout.version, envelopeSha512: rollout.fingerprint, state: rollout.state,
          } } }
        }
        if (previous.envelopeSha512 !== rollout.fingerprint) {
          throw new Error('同一更新版本的投放内容发生变化，已拒绝不一致的指针。')
        }
        if (previous.state === 'rejected' && rollout.state === 'active') {
          throw new Error('已撤回的更新版本不能重新激活。')
        }
        if (previous.state === rollout.state) return history
      }
      return { schema: 1, pointers: { ...history.pointers, [key]: {
        version: rollout.version, envelopeSha512: rollout.fingerprint, state: rollout.state,
      } } }
    })
  }

  private async readHistory(): Promise<History> {
    const raw = await readOptional(this.historyPath)
    const history: History = raw === undefined ? { schema: 1, pointers: {} } : historySchema.parse(parseDocument(raw, '更新投放记录'))
    for (const entry of Object.values(history.pointers)) assertVersion(entry.version, '本地更新投放记录')
    return history
  }

  private async write<T extends object>(path: string, update: () => T | Promise<T>): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    await withFileLock(path, async () => {
      const document = await update()
      await writeFileAtomic(path, `${JSON.stringify(document)}\n`, { mode: 0o600, dirMode: 0o700 })
    })
  }
}

function assertVersion(version: string, label: string): void {
  if (semver.valid(version) !== version) throw new Error(`${label}必须是合法语义版本。`)
}

function pointerKey(track: InsightAcceptedRollout['track'], target: string | undefined): string {
  if (track === 'stable') {
    if (target !== undefined) throw new Error('Stable 投放记录不能指定目标。')
    return 'stable'
  }
  if (target === undefined || target === '') throw new Error('Candidate 投放记录必须指定目标。')
  return `candidate-v3/${target}`
}

function parseDocument(raw: string, label: string): unknown {
  try { return JSON.parse(raw) } catch { throw new Error(`${label}无效，未修改原文件。`) }
}

async function readOptional(path: string): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>>
  try { handle = await open(path, 'r') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    const size = (await stat(path)).size
    if (size > MAX_DOCUMENT_BYTES) throw new Error('本地更新状态文件过大，未修改原文件。')
    const buffer = Buffer.alloc(size + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > MAX_DOCUMENT_BYTES) throw new Error('本地更新状态文件过大，未修改原文件。')
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally { await handle.close() }
}
