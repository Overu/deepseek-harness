import { expect, it } from 'vitest'
import { assertInsightPackageSource } from './package-source.ts'

it.each(['1.0.12', '1.0.12-rc.1', '1.0.12-alpha.1'])('allows %s from insight', (version) => {
  expect(() => assertInsightPackageSource(version, 'refs/heads/insight')).not.toThrow()
})

it.each(['refs/heads/feature/rc-packaging', 'refs/heads/master'])('allows RC packages from %s', (ref) => {
  expect(() => assertInsightPackageSource('1.0.12-rc.1', ref)).not.toThrow()
})

it.each([
  '1.0.12', '1.0.12-alpha.1', '1.0.12-beta.1', '1.0.12-rc', '1.0.12-rc.01',
  '1.0.12-rc.1.extra', '1.0.12-rc.1+build', '1.00.12-rc.1', 'v1.0.12-rc.1',
  '2.0.0-rc.1', '1.9007199254740992.0-rc.1', `1.0.12-rc.${'1'.repeat(256)}`, '',
])('refuses %s outside insight', (version) => {
  expect(() => assertInsightPackageSource(version, 'refs/heads/feature/rc-packaging')).toThrow(/Only canonical/u)
})

it.each(['refs/tags/insight-v1.0.12-rc.1', 'refs/tags/insight', 'refs/pull/1/merge', 'refs/heads/', ''])('refuses package ref %s', (ref) => {
  expect(() => assertInsightPackageSource('1.0.12-rc.1', ref)).toThrow(/must originate from a branch/u)
})
