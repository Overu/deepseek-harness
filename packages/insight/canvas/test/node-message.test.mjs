import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nodeSelectionMessage } from '../canvas-app/src/node-message.ts'
import { parseNodeSelection } from '../src/client/message.ts'

test('selected canvas node uses the existing bounded Harness message protocol', () => {
  const message = nodeSelectionMessage('2873', {
    id: 'node-1', type: 'image', data: { title: '图片 1', value: 'https://example.test/image.png' },
  }, 'request-1')
  assert.deepEqual(parseNodeSelection(message, '2873'), {
    id: 'node-1', title: '图片 1', type: 'image', value: 'https://example.test/image.png',
  })
  assert.equal(parseNodeSelection(message, '2903'), undefined)
  assert.equal(nodeSelectionMessage('2873', { id: 'x'.repeat(101) }, 'request-2'), undefined)
})
