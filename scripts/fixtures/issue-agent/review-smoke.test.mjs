import assert from 'node:assert/strict'
import test from 'node:test'

import { isPositivePageSize } from './review-smoke.mjs'

test('isPositivePageSize accepts only positive integers', () => {
  assert.equal(isPositivePageSize(0), false)
  assert.equal(isPositivePageSize(1), true)
  assert.equal(isPositivePageSize(-1), false)
  assert.equal(isPositivePageSize(1.5), false)
})
