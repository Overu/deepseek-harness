import assert from 'node:assert/strict'
import test from 'node:test'
import { parseNodeSelection } from '../src/client/message.ts'
import { parseCanvasId } from '../src/shared/protocol.ts'

const id = parseCanvasId('2873')
const message = {
  protocolVersion: 1,
  type: 'canvas.node.select',
  canvasId: '2873',
  requestId: 'sample-1',
  payload: { id: 'node-1', title: '图片', type: 'image', value: 'https://example.com/a.jpg' }
}

test('node selection accepts only the active canvas and protocol', () => {
  assert.deepEqual(parseNodeSelection(message, id), message.payload)
  assert.equal(parseNodeSelection({ ...message, canvasId: '2903' }, id), undefined)
  assert.equal(parseNodeSelection({ ...message, protocolVersion: 2 }, id), undefined)
})

test('node selection rejects incomplete or unbounded payloads', () => {
  assert.equal(parseNodeSelection({ ...message, payload: { ...message.payload, id: '' } }, id), undefined)
  assert.equal(parseNodeSelection({ ...message, payload: { ...message.payload, value: 'x'.repeat(1001) } }, id), undefined)
  assert.equal(parseNodeSelection({ ...message, requestId: '' }, id), undefined)
})
