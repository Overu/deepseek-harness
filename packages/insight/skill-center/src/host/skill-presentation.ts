/** Optional installed-skill labels, independent of instructions and invocation identity. */
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { InsightSkillInventoryEntry } from '../shared/skill-inventory.ts'

type Presentation = Pick<InsightSkillInventoryEntry, 'displayName' | 'shortDescription'>
const MAX_BYTES = 8192
const NAME_LIMIT = 60
const DESCRIPTION_LIMIT = 160
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/gu

function label(value: unknown, limit: number, allowEmpty = false): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return (allowEmpty || text.length > 0) && Array.from(text).length <= limit
    && !/[\u0000-\u001f\u007f\u0085\u2028\u2029]/u.test(text) ? text : undefined
}

/**
 * Replace an unpublished installation's UI labels with single-line catalogue text.
 * Labels retain at most 60 and 160 Unicode code points; an empty summary clears the description.
 * @param directory - Private payload directory before its installation record commits.
 * @param presentation - Catalogue name and summary selected for this installation.
 * @returns Completion after atomic label replacement; failures reject installation.
 */
export async function writeSkillPresentation(directory: string, presentation: Required<Presentation>): Promise<void> {
  const normalize = (value: string, limit: number): string => Array.from(value.replace(CONTROL_CHARACTERS, ' ').trim()).slice(0, limit).join('')
  await writeFileAtomic(join(directory, 'ui.json'), `${JSON.stringify({
    displayName: normalize(presentation.displayName, NAME_LIMIT),
    shortDescription: normalize(presentation.shortDescription, DESCRIPTION_LIMIT),
  })}\n`, { mode: 0o600 })
}

/**
 * Read optional presentation beside a discovered skill; unavailable labels use native name/description.
 * @param skillPath - Provider-owned instruction path, absent for a virtual skill.
 * @param signal - Inventory call cancellation.
 * @returns Admitted UI labels, without reading or changing the instruction body.
 */
export async function readSkillPresentation(skillPath: string | undefined, signal: AbortSignal): Promise<Presentation> {
  if (skillPath === undefined) return {}
  signal.throwIfAborted()
  try {
    const path = join(dirname(skillPath), 'ui.json')
    const entry = await lstat(path)
    if (!entry.isFile() || entry.size > MAX_BYTES) return {}
    signal.throwIfAborted()
    await using file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    signal.throwIfAborted()
    const current = await file.stat()
    if (!current.isFile() || current.size > MAX_BYTES) return {}
    const buffer = new Uint8Array(MAX_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      signal.throwIfAborted()
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null)
      if (bytesRead === 0) break
      length += bytesRead
    }
    signal.throwIfAborted()
    if (length > MAX_BYTES) return {}
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const displayName = label('displayName' in value ? value.displayName : undefined, NAME_LIMIT)
    const shortDescription = label('shortDescription' in value ? value.shortDescription : undefined, DESCRIPTION_LIMIT, true)
    return { ...displayName === undefined ? {} : { displayName }, ...shortDescription === undefined ? {} : { shortDescription } }
  } catch (_unavailablePresentation) {
    // Optional UI metadata must not hide an otherwise discovered skill.
    signal.throwIfAborted()
    return {}
  }
}
