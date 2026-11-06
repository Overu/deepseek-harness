/** Technical-name identity matching for platform skills. */
import { expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { InsightSkillId, SkillIdentity } from '../src/shared/skill-installation.ts'
import { matchSkillIdentity, normalizeSkillId } from '../src/shared/skill-identity.ts'

const id = (value: string): InsightSkillId => brandString<InsightSkillId>(value)

it('normalizes a technical name and rejects OSS-style IDs', () => {
  expect(normalizeSkillId(' activity-search ')).toBe('activity-search')
  for (const invalid of [undefined, null, '', ' ', 1, 'REMOTE/ID', {}, true, []]) {
    expect(() => normalizeSkillId(invalid)).toThrow()
  }
})

it('matches only an equal technical name', () => {
  const existing = { id: id('activity-search') }
  expect(matchSkillIdentity({ id: id('activity-search') }, [existing]))
    .toEqual({ kind: 'match', value: existing })
  expect(matchSkillIdentity({ id: id('renamed-search') }, [existing])).toEqual({ kind: 'missing' })
})

it('rejects duplicate technical names rather than selecting one record', () => {
  const records: readonly SkillIdentity[] = [
    { id: id('activity-search') },
    { id: id('activity-search') },
  ]
  expect(matchSkillIdentity({ id: id('activity-search') }, records)).toEqual({ kind: 'conflict' })
})
