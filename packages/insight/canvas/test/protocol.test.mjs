import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCanvasId, canvasAddress, canvasIdFromAddress } from '../src/shared/protocol.ts'

test('canvas resource identity preserves signed Long IDs', () => {
  for (const raw of ['2873', '9223372036854775807']) {
    const id = parseCanvasId(raw)
    assert.equal(id, raw)
    assert.equal(canvasIdFromAddress(canvasAddress(id)), raw)
  }
})

test('canvas identity rejects ambiguous and out-of-range input', () => {
  for (const raw of ['0', '01', '-1', '9223372036854775808', 2873, '', '1?x=2']) {
    assert.equal(parseCanvasId(raw), undefined)
  }
  assert.equal(canvasIdFromAddress('dsh-resource://canvas/2873?x=2'), undefined)
  assert.equal(canvasIdFromAddress('dsh-resource://other/2873'), undefined)
})
