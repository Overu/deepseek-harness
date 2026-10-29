import assert from 'node:assert/strict'
import test from 'node:test'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { createdCanvasLinks } from '../src/client/canvas-created-links.ts'

const receipt = (changes = {}) => ({ status: 'created', requestId: 'canvas-create-actual', canvasId: '103490', address: 'dsh-resource://canvas/103490', name: '未命名画布', version: '0', runtime: 'ready', ...changes })
const result = (value = receipt(), changes = {}) => ({ kind: 'tool-result', callId: 'create', seq: 5, name: 'canvas_create', isError: false, content: [{ type: 'text', text: JSON.stringify(value) }], subCalls: [], ...changes })

test('successful creation includes empty canvases and an unready runtime', () => {
  assert.deepEqual(createdCanvasLinks([{ root: result() }], 10), [{ canvasId: '103490', name: '未命名画布' }])
  assert.equal(createdCanvasLinks([{ root: result(receipt({ runtime: 'not_ready' })) }], 10).length, 1)
  assert.equal(createdCanvasLinks([{ root: result(receipt({ canvasId: '9007199254740993', address: 'dsh-resource://canvas/9007199254740993' })) }], 10)[0].canvasId, '9007199254740993')
})
test('prose, other tools, failure, uncertainty and invalid identities cannot mint entries', () => {
  const invalid = [result(receipt(), { name: 'canvas_get' }), result(receipt(), { name: '' }), result(receipt(), { isError: true }), result(receipt({ status: 'create_unknown' })), result(receipt({ status: 'rejected' })), result(receipt({ canvasId: 'invalid' })), result(receipt({ canvasId: 103490 })), result(receipt({ address: 'https://example.com' })), result(receipt({ requestId: '' })), result(receipt({ runtime: 'unknown' })), result(receipt(), { content: [{ type: 'text', text: '已创建画布，ID：103490' }] }), { phase: 'start', name: 'canvas_create', subCalls: [] }]
  for (const call of invalid) assert.deepEqual(createdCanvasLinks([{ root: call }], 10), [])
})
test('nested PTC receipts survive parent errors, deduplicate and honor the closing sequence', () => {
  const second = result(receipt({ canvasId: '103491', address: 'dsh-resource://canvas/103491' }), { callId: 'second', seq: 8 })
  const root = result({}, { name: 'run_code', isError: true, subCalls: [result(), result(), second] })
  assert.deepEqual(createdCanvasLinks([{ root }], 6).map(link => link.canvasId), ['103490'])
  assert.deepEqual(createdCanvasLinks([{ root }, { root: result() }], 10).map(link => link.canvasId), ['103490', '103491'])
})
async function nativeAssembler() {
  const base = new URL('../../../client/', import.meta.url)
  const [{ ConversationNodeAssembler }, { toolDefinition }, { chatViewDefinition }] = await Promise.all([
    import(new URL('ui-conversation/src/client/conversation/assembler.ts', base).href),
    import(new URL('ui-chat/src/client/conversation-nodes/tool.ts', base).href),
    import(new URL('ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts', base).href),
  ])
  const assembler = new ConversationNodeAssembler({ entries: () => [toolDefinition], fallbackEntry: () => undefined }, { entries: () => [chatViewDefinition] })
  assembler.activateTarget('chat')
  return { assembler, read: (turn = 1) => createdCanvasLinks(assembler.snapshot('chat').nodes.turnDataSource(turn, 'tool-call').getSnapshot(), 100) }
}
const at = (seq, type, data) => ({ type: 'event', event: { type, data, seq, time: seq + 100, ...(type === 'tool/result' ? { surfaceOp: 'append' } : {}) } })
const call = at(3, 'tool/call', { turn: 1, step: 1, callId: 'create', name: 'canvas_create', arguments: '{}' })
const settled = at(5, 'tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: 'create', content: [{ type: 'text', text: JSON.stringify(receipt()) }], isError: false }) })
test('workspace DSH restores cold history, missing-call prepend, Turn and Session scope', async () => {
  const native = await nativeAssembler();
  native.assembler.replaceWindow([at(1, 'turn/start', { turn: 1 }), call, settled, at(9, 'turn/end', { turn: 1, reason: { kind: 'completed' } })], false)
  native.assembler.flush(); assert.equal(native.read()[0].canvasId, '103490'); assert.deepEqual(native.read(2), [])
  native.assembler.replaceWindow([settled], true); native.assembler.flush(); assert.deepEqual(native.read(), [])
  native.assembler.prepend([at(1, 'turn/start', { turn: 1 }), call], false); native.assembler.flush(); assert.equal(native.read()[0].canvasId, '103490')
  const other = await nativeAssembler(); other.assembler.replaceWindow([], false); other.assembler.flush(); assert.deepEqual(other.read(), [])
})
test('workspace DSH PTC projection publishes nested creation before its outer program settles', async () => {
  const native = await nativeAssembler();
  const ids = { rootCallId: 'outer', parentCallId: 'outer', subCallId: 'nested', name: 'canvas_create', arguments: {} }
  const start = at(1, 'turn/start', { turn: 1 }), outer = at(2, 'tool/call', { turn: 1, step: 1, callId: 'outer', name: 'run_code', arguments: '{}' })
  native.assembler.replaceWindow([start, outer, at(3, 'tool/ptc-dispatch-start', ids)], false)
  native.assembler.flush(); assert.deepEqual(native.read(), [])
  const dispatch = at(4, 'tool/ptc-dispatch', { ...ids, isError: false, content: [{ type: 'text', text: JSON.stringify(receipt()) }] })
  native.assembler.append(dispatch); native.assembler.flush(); assert.equal(native.read()[0].canvasId, '103490')
  native.assembler.replaceWindow([start, outer, dispatch], false); native.assembler.flush(); assert.equal(native.read()[0].canvasId, '103490')
})
