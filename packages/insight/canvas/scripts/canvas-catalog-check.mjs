import assert from 'node:assert/strict'

// Check the installed Core-transformed schema, not the source declaration shape.
export function assertCanvasCatalog(catalog) {
  const byName = new Map(catalog.map(tool => [tool.name, tool.parameters]))
  assert.deepEqual([...byName.keys()].sort(), ['canvas_asset_import', 'canvas_assets', 'canvas_create', 'canvas_edges', 'canvas_get', 'canvas_models', 'canvas_node_edit', 'canvas_run', ...(byName.has('canvas_process') ? ['canvas_open','canvas_list','canvas_capabilities','canvas_layout','canvas_process'] : [])].sort())
  if (byName.has('canvas_process')) {
    const process = byName.get('canvas_process');
    assert.deepEqual(process.properties.kind.enum, ['image_upscale','video_upscale','image_layering','auto_matting']);
    for (const key of ['url','path','sessionId','token','confirmed','taskId']) assert(!(key in process.properties));
    assert.deepEqual([...byName.get('canvas_layout').properties.mode.enum], ['grid','horizontal','vertical']);
    assert.deepEqual([...byName.get('canvas_open').required], ['canvasId']);
  }
  assert.equal(catalog.length, byName.size, 'Duplicate canvas tools')
  const batch = (name, operations) => {
    const schema = byName.get(name)
    assert.deepEqual(Object.keys(schema.properties).sort(), ['canvasId', 'expectedVersion', 'ops'])
    assert.deepEqual([...schema.required].sort(), ['canvasId', 'expectedVersion', 'ops'])
    assert.equal(schema.properties.ops.type, 'array')
    const variants = schema.properties.ops.items.oneOf
    assert.deepEqual(variants.map(item => item.properties.op.const), operations)
    for (const variant of variants) {
      assert.equal(variant.additionalProperties, false)
      assert(variant.required.includes('op'))
    }
    return variants
  }
  const nodes = batch('canvas_node_edit', ['add', 'edit', 'remove', 'configure'])
  batch('canvas_edges', ['add', 'edit', 'remove', 'reorder'])
  const models = byName.get('canvas_models').properties
  assert.deepEqual(models.nodeType.enum, ['image', 'video', 'audio'])
  assert.deepEqual(models.view.enum, ['models', 'voices'])
  assert.deepEqual(models.voiceSource.enum, ['public', 'my'])
  assert.equal(nodes[3].properties.configuration.properties.voiceId.type, 'string')
  assert.equal(nodes[3].properties.configuration.properties.seniorParams.type, 'object')
  const asset = byName.get('canvas_asset_import').properties
  for (const key of ['url', 'path', 'sessionId', 'token']) {
    assert(!(key in asset), 'Asset input leaked ' + key)
    if (key !== 'path') assert(!(key in asset.source.properties), 'Asset source leaked ' + key)
  }
  assert.equal(asset.source.additionalProperties, false)
  assert.deepEqual(asset.source.properties.type.enum, ['attachment', 'canvas_node', 'conversation_asset', 'workspace_file'])
  assert.equal(asset.source.properties.path.type, 'string')
  assert.deepEqual(byName.get('canvas_assets').properties.mediaType.enum, ['text', 'image', 'video', 'audio'])
  const node = nodes[0].properties.node
  assert(!('position' in node.properties))
  assert.deepEqual(node.properties.placement, asset.placement)
  assert.deepEqual(asset.placement.oneOf.map(branch => branch.properties.mode.const), ['auto', 'absolute', 'after'])
  const run = byName.get('canvas_run')
  assert.deepEqual(Object.keys(run.properties).sort(), ['canvasId', 'expectedVersion', 'nodeIds'])
  assert.deepEqual([...run.required].sort(), ['canvasId', 'expectedVersion', 'nodeIds'])
  assert.equal(run.properties.nodeIds.type, 'array')
  assert.equal(run.properties.nodeIds.items.type, 'string')
}
