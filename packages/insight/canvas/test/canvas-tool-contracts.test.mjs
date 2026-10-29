// Frozen from alpha.13 before contract extraction; do not regenerate from current declarations.
// Registration only: never execute a tool or use real account credentials.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { assertCanvasCatalog } from '../scripts/canvas-catalog-check.mjs'
import { registerCanvasTools } from '../src/host/canvas-tools.ts'
import { registerCanvasGraphTools } from '../src/host/canvas-graph-tools.ts'
import { registerCanvasAssetTools } from '../src/host/canvas-asset-tools.ts'
import { registerCanvasRunTools } from '../src/host/canvas-run-tools.ts'

function capture() {
  const definitions = [], cleanups = []
  let apiCalls = 0
  const forbidden = () => {
    apiCalls++
    throw new Error('Catalog capture cannot execute business calls')
  }
  const ctx = {
    tools: { register: definition => {
      assert(!definitions.some(item => item.name === definition.name))
      definitions.push(definition)
      return () => {}
    } },
    effect: fn => {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    attachments: { readImage: forbidden },
  }
  const bridge = { ensureContext: forbidden, dispatch: forbidden }
  registerCanvasTools(ctx, bridge, { createCanvas: forbidden, getCanvas: forbidden })
  registerCanvasGraphTools(ctx, bridge)
  registerCanvasAssetTools(ctx, bridge, {
    getIdentity: forbidden, uploadMedia: forbidden, registerMedia: forbidden,
  })
  return {
    definitions,
    get apiCalls() { return apiCalls },
    dispose() { cleanups.reverse().forEach(cleanup => cleanup()) },
  }
}

test('unchanged registered tool contracts preserve the historical catalog; batch tools use their new schema', async () => {
  const baseline = JSON.parse(await readFile(
    new URL('./fixtures/canvas-tool-contracts.alpha13.json', import.meta.url), 'utf8',
  ))
  const fixture = capture()
  try {
    const actual = fixture.definitions.map(tool => ({
      name: tool.name, timeoutMs: tool.timeoutMs, description: tool.description,
      parameters: tool.parameters, outputSchema: tool.output.schema,
    }))
    // Guidance prose intentionally moved into one Skill. Keep the original fixture intact.
    const structural = value => {
      if (Array.isArray(value)) return value.map(structural)
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'description').map(([key,entry]) => [key,structural(entry)]))
      return value
    }
    const compatible = structuredClone(actual)
    const source = compatible.find(tool => tool.name === 'canvas_asset_import').parameters.properties.source
    assert.deepEqual(source.properties.type.enum, ['attachment','canvas_node','conversation_asset','workspace_file'])
    assert(source.properties.assetRef); assert(source.properties.path)
    source.properties.type.enum = source.properties.type.enum.filter(type => !['conversation_asset','workspace_file'].includes(type))
    delete source.properties.assetRef
    delete source.properties.path
    const assetImport = compatible.find(tool => tool.name === 'canvas_asset_import')
    assert.equal(assetImport.timeoutMs, 420000)
    assetImport.timeoutMs = baseline.tools.find(tool => tool.name === 'canvas_asset_import').timeoutMs
    const assets = compatible.find(tool => tool.name === 'canvas_assets')
    assert.deepEqual(assets.parameters.properties.mediaType.enum, ['text', 'image', 'video', 'audio'])
    assets.parameters = baseline.tools.find(tool => tool.name === 'canvas_assets').parameters
    const changed = new Set(['canvas_node_edit', 'canvas_edges', 'canvas_models'])
    assert.deepEqual(structural(compatible.filter(tool => !changed.has(tool.name))), structural(baseline.tools.filter(tool => !changed.has(tool.name))))
    for (const name of ['canvas_node_edit', 'canvas_edges']) assert(actual.find(tool => tool.name === name).parameters.properties.ops)
    assert.deepEqual(actual.map(tool => tool.name), baseline.registrationOrder)
    assert.equal(actual.length, 7)
    assert.equal(fixture.apiCalls, 0)
  } finally { fixture.dispose() }
})


test('seven tools preserve string output and the existing text renderer', () => {
  const fixture = capture()
  try {
    const value = JSON.stringify({ status: 'saved', canvasId: '103161', version: '19' })
    for (const tool of fixture.definitions) {
      assert.deepEqual(tool.output.schema, { type: 'string' })
      assert.deepEqual(tool.output.render({}, value), [{ type: 'text', text: value }])
    }
    assert.equal(fixture.apiCalls, 0)
  } finally { fixture.dispose() }
})

test('batch catalog verifies installed schema shape and keeps workflow instructions in the Skill', () => {
  let run
  const ctx = { tools: { register: definition => { run = definition } }, on: () => {}, effect: () => {}, logger: { warn: () => {} } }
  registerCanvasRunTools(ctx, {})
  assert.deepEqual(Object.keys(run.parameters.properties), ['canvasId', 'nodeIds', 'expectedVersion'])
  assert.equal(run.parameters.properties.nodeIds.type, 'array')
  assert.equal(run.parameters.properties.nodeIds.items.type, 'string')
  assert.match(run.description, /paused/)
  assert.doesNotMatch(run.description, /canvas_get|job_output|先.*再/)
  const fixture = capture()
  assert.doesNotMatch(fixture.definitions.find(tool => tool.name === 'canvas_models').description, /canvas_node_edit/)
  const catalog = [...fixture.definitions, run]
  assertCanvasCatalog(catalog)
  const legacy = structuredClone(catalog.map(({name, parameters}) => ({name, parameters})))
  const runProperties = legacy.find(tool => tool.name === 'canvas_run').parameters.properties
  runProperties.nodeId = { type: 'string' }; delete runProperties.nodeIds
  assert.throws(() => assertCanvasCatalog(legacy))
  const unsafe = structuredClone(catalog.map(({name, parameters}) => ({name, parameters})))
  unsafe.find(tool => tool.name === 'canvas_asset_import').parameters.properties.source.properties.url = {type:'string'}
  assert.throws(() => assertCanvasCatalog(unsafe))
  fixture.dispose()
})

test('public tool contract data has no runtime dependency or Host import', async () => {
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const entry = fileURLToPath(new URL('../src/shared/canvas-tool-contracts.ts', import.meta.url))
  const result = await build({
    entryPoints: [entry], bundle: true, write: false,
    platform: 'browser', format: 'esm', metafile: true,
  })
  const inputs = Object.keys(result.metafile.inputs)
  assert.equal(inputs.length, 1)
  assert(inputs[0].endsWith('src/shared/canvas-tool-contracts.ts'))
  assert.equal(result.outputFiles.length, 1)
})

 test('all thirteen tools retain short atomic descriptions, not workflow manuals', async () => {
  const { canvasToolContracts } = await import('../src/shared/canvas-tool-contracts.ts')
  assert.equal(Object.keys(canvasToolContracts).length, 13)
  for (const tool of Object.values(canvasToolContracts)) {
    assert(tool.description.length < 230, tool.name)
    assert(!tool.description.includes('用户要求失败停止时'), tool.name)
  }
 })
