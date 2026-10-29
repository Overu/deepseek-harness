import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'
import { canvasResultProducts, canvasResultGroups, canvasResultColumns, canvasResultLayout, CANVAS_RESULT_PREVIEW_LIMIT,
  CANVAS_RESULT_CARD_INSET, CANVAS_RESULT_TILE_SIZE, CANVAS_RESULT_TILE_GAP } from '../src/client/canvas-result-gallery.ts'

const source = (changes = {}) => ({ requestId: 'request', nodeId: 'node', generation: { images: 1, videos: 0 },
  outputs: ['https://example.com/opaque'], ...changes })

test('result headings use node type names and hide for a single group regardless of product count', async () => {
  const result = await build({ entryPoints: [new URL('../src/client/CanvasResults.tsx', import.meta.url).pathname],
    bundle: true, write: false, format: 'cjs', platform: 'browser', jsx: 'automatic', external: ['react', 'react/*', '@deepseek-ai/*'] })
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props }
  const react = { useState: value => [value, () => {}], useRef: () => ({ current: null }), useEffect() {},
    useCallback: callback => callback, useSyncExternalStore: (_subscribe, snapshot) => snapshot() }
  const sandbox = { module: { exports: {} }, require: name => {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: 'button' }
    throw new Error(`unexpected import: ${name}`)
  } }
  sandbox.exports = sandbox.module.exports
  vm.runInNewContext(result.outputFiles[0].text, sandbox)
  const { CanvasResults, resultsZh } = sandbox.module.exports
  const headings = sources => {
    const tree = CanvasResults({ canvasResultsSessionId: 'session', seq: 1,
      turn: { turn: 1, data: new Map([['desktop-canvas-results', { calls: [{ callId: 'root', seq: 1 }] }]]) },
      results: { getSnapshot: () => sources.map(row => ({ sessionId: 'session', turn: 1, rootCallId: 'root', rootCallSeq: 1, canvasId: '1', ...row })) },
      t: key => resultsZh[key] })
    const labels = []
    const visit = node => {
      if (Array.isArray(node)) node.forEach(visit)
      else if (node?.props) { if (node.type === 'h3') labels.push(node.props.children); visit(node.props.children) }
    }
    visit(tree)
    return labels
  }
  const audio = source({ generation: { images: 0, videos: 0, audios: 1 } })
  const video = source({ generation: { images: 0, videos: 1 } })
  for (const row of [audio, source(), video]) assert.deepEqual(headings([row]), [])
  assert.deepEqual(headings([source({ outputs: ['https://example.com/1', 'https://example.com/2'] })]), [])
  assert.deepEqual(headings([audio, audio]), [])
  assert.deepEqual(headings([video, video]), [])
  assert.deepEqual(headings([source(), audio]), ['音频', '图片'])
  assert.deepEqual(headings([source(), video, audio]), ['音频', '图片', '视频'])
  assert.deepEqual(headings([]), [])
})

test('actual output count governs focus even when several products come from one node', () => {
  const products = canvasResultProducts([source({ outputs: ['https://example.com/1', 'https://example.com/2'] })])
  assert.equal(products.length, 2)
  assert.deepEqual(products.map(product => product.nodeId), ['node', 'node'])
  assert.deepEqual(products.map(product => product.key), ['request:0', 'request:1'])
  const many = canvasResultProducts([source({ outputs: Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`) })])
  assert.equal(many.length, 6)
  assert.equal(many.slice(0, CANVAS_RESULT_PREVIEW_LIMIT).length, 4)
})

test('gallery keeps source/node identity and classifies native generation, not filename extensions', () => {
  assert.deepEqual(canvasResultProducts([
    source({ outputs: ['https://example.com/no-extension?temporary=1'] }),
    source({ requestId: 'video', nodeId: 'video-node', generation: { images: 0, videos: 1 }, outputs: ['https://example.com/a.png'] }),
    source({ requestId: 'mixed', generation: { images: 1, videos: 1 } }),
    source({ requestId: 'audio', nodeId: 'tts-node', generation: { images: 0, videos: 0, audios: 1 } }),
  ]), [
    { key: 'request:0', nodeId: 'node', url: 'https://example.com/no-extension?temporary=1', kind: 'image' },
    { key: 'video:0', nodeId: 'video-node', url: 'https://example.com/a.png', kind: 'video' },
    { key: 'mixed:0', nodeId: 'node', url: 'https://example.com/opaque', kind: 'unknown' },
    { key: 'audio:0', nodeId: 'tts-node', url: 'https://example.com/opaque', kind: 'audio' },
  ])
  assert.deepEqual(canvasResultProducts([]), [])
})

test('result categories put audio before images and video, preserve order within each category and omit empty groups', () => {
  const products = canvasResultProducts([
    source({ requestId: 'image1' }),
    source({ requestId: 'video', generation: { images: 0, videos: 1 } }),
    source({ requestId: 'audio1', generation: { images: 0, videos: 0, audios: 1 } }),
    source({ requestId: 'image2' }),
    source({ requestId: 'audio2', generation: { images: 0, videos: 0, audios: 1 } }),
  ])
  const original = [...products]
  assert.deepEqual(canvasResultGroups(products), [
    { kind: 'audio', products: [products[2], products[4]] },
    { kind: 'image', products: [products[0], products[3]] },
    { kind: 'video', products: [products[1]] },
  ])
  assert.deepEqual(products, original)
  assert.deepEqual(canvasResultGroups([products[0]]), [{ kind: 'image', products: [products[0]] }])
  assert.deepEqual(canvasResultGroups([]), [])
  const unknown = { ...products[0], kind: 'unknown' }
  assert.deepEqual(canvasResultGroups([unknown, products[2]]), [
    { kind: 'audio', products: [products[2]] }, { kind: 'unknown', products: [unknown] },
  ])
})

test('each category has its own preview limit so later audio and video remain visible', () => {
  const products = canvasResultProducts([
    source({ outputs: Array.from({ length: 6 }, (_, i) => `https://example.com/image${i}`) }),
    source({ requestId: 'audio', generation: { images: 0, videos: 0, audios: 6 },
      outputs: Array.from({ length: 6 }, (_, i) => `https://example.com/audio${i}`) }),
    source({ requestId: 'video', generation: { images: 0, videos: 1 } }),
  ])
  const groups = canvasResultGroups(products)
  assert.deepEqual(groups.map(group => [group.kind, group.products.length]), [['audio', 4], ['image', 4], ['video', 1]])
  assert.deepEqual(groups[0].products, products.slice(6, 10))
  assert.deepEqual(groups[1].products, products.slice(0, 4))
  assert.equal(products.length, 13)
})

test('wide four-image layout becomes 2+2, never 3+1, and three becomes 2+1', () => {
  const width = columns => CANVAS_RESULT_CARD_INSET + columns * CANVAS_RESULT_TILE_SIZE + (columns - 1) * CANVAS_RESULT_TILE_GAP
  assert.equal(canvasResultColumns(1, width(4)), 1)
  assert.equal(canvasResultColumns(2, width(4)), 2)
  assert.equal(canvasResultColumns(4, width(4)), 4)
  assert.equal(canvasResultColumns(8, width(4)), 4)
  assert.equal(canvasResultColumns(4, width(4) - 1), 2)
  assert.equal(canvasResultColumns(4, width(3)), 2)
  assert.equal(canvasResultColumns(3, width(3)), 3)
  assert.equal(canvasResultColumns(3, width(3) - 1), 2)
  assert.equal(canvasResultColumns(4, width(2) - 1), 1)
  assert.equal(canvasResultColumns(2, 100), 1)
})

test('audio gets a wide row without changing visual tile columns or exceeding conversation width', () => {
  const audio = canvasResultProducts([source({ generation: { images: 0, videos: 0, audios: 1 } })])[0]
  const image = canvasResultProducts([source()])[0]
  assert.deepEqual(canvasResultLayout([audio], 800), { columns: 1, width: 320 })
  assert.deepEqual(canvasResultLayout([audio, audio, audio], 800), { columns: 1, width: 320 })
  assert.deepEqual(canvasResultLayout([image, audio], 800), { columns: 1, width: 320 })
  assert.deepEqual(canvasResultLayout([image, audio, image], 800), { columns: 2, width: 328 })
  assert.deepEqual(canvasResultLayout([image, image, image, audio], 800), { columns: 3, width: 496 })
  assert.deepEqual(canvasResultLayout([image, audio], 300), { columns: 1, width: 278 })
  assert.deepEqual(canvasResultLayout([audio], 0), { columns: 1, width: 0 })
  assert.deepEqual(canvasResultLayout([image], 800), { columns: 1, width: 160 })
  assert.deepEqual(canvasResultLayout([image, image, image, image], 600), { columns: 2, width: 328 })
  assert.deepEqual(canvasResultLayout([image, image, image, image, audio], 800), { columns: 4, width: 664 })
})
