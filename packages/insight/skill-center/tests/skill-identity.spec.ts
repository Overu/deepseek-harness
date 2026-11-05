/** ID-first identity matching and unambiguous legacy technical-name fallback. */
import { expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { InsightSkillId, SkillIdentity } from '../src/shared/skill-installation.ts'
import { matchSkillIdentity, normalizeSkillId, skillIdentityKey } from '../src/shared/skill-identity.ts'

const id = (value: string): InsightSkillId => brandString<InsightSkillId>(value)

it('normalizes numeric and opaque string IDs without using them as technical names', () => {
  expect(normalizeSkillId(1)).toBe('1')
  expect(normalizeSkillId(' 1 ')).toBe('1')
  expect(normalizeSkillId('REMOTE/ID')).toBe('REMOTE/ID')
  for (const absent of [undefined, null, '', ' ']) expect(normalizeSkillId(absent)).toBeUndefined()
  for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, {}, true, []]) {
    expect(() => normalizeSkillId(invalid)).toThrow()
  }
  expect(skillIdentityKey({ id: id('1'), skillName: 'first' })).toBe('id:1')
  expect(skillIdentityKey({ skillName: '1' })).toBe('name:1')
})

it('matches the same ID after a technical rename and keeps different IDs distinct', () => {
  const existing = { id: id('1'), skillName: 'old-name' }
  expect(matchSkillIdentity({ id: id('1'), skillName: 'new-name' }, [existing]))
    .toEqual({ kind: 'match', value: existing })
  expect(matchSkillIdentity({ id: id('2'), skillName: 'old-name' }, [existing]))
    .toEqual({ kind: 'conflict' })
})

it('uses an exact technical name when either side lacks an ID', () => {
  const legacy = { skillName: 'activity-search' }
  const current = { id: id('1'), skillName: 'activity-search' }
  expect(matchSkillIdentity(current, [legacy])).toEqual({ kind: 'match', value: legacy })
  expect(matchSkillIdentity(legacy, [current])).toEqual({ kind: 'match', value: current })
  expect(matchSkillIdentity(legacy, [legacy])).toEqual({ kind: 'match', value: legacy })
  expect(matchSkillIdentity({ skillName: 'Activity-search' }, [legacy])).toEqual({ kind: 'missing' })
})

it('rejects ambiguous fallback names and duplicate IDs instead of choosing the first record', () => {
  const records: readonly SkillIdentity[] = [
    { id: id('1'), skillName: 'shared-name' },
    { id: id('2'), skillName: 'shared-name' },
  ]
  expect(matchSkillIdentity({ skillName: 'shared-name' }, records)).toEqual({ kind: 'conflict' })
  expect(matchSkillIdentity({ id: id('1'), skillName: 'renamed' }, records)).toEqual({ kind: 'match', value: records[0] })
  expect(matchSkillIdentity({ id: id('1'), skillName: 'shared-name' }, [
    { id: id('1'), skillName: 'first' }, { id: id('1'), skillName: 'second' },
  ]))
    .toEqual({ kind: 'conflict' })
})

it('does not attach one name-only record to two distinct catalogue IDs', () => {
  const one = { id: id('1'), skillName: 'shared-name' }
  const two = { id: id('2'), skillName: 'shared-name' }
  const record = { skillName: 'shared-name' }
  expect(matchSkillIdentity(one, [record], [one, two])).toEqual({ kind: 'conflict' })
  expect(matchSkillIdentity(two, [record], [one, two])).toEqual({ kind: 'conflict' })
  expect(matchSkillIdentity(one, [one], [one, two])).toEqual({ kind: 'match', value: one })
})
