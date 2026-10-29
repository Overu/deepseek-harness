import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { serializeNodeRefs } from '../src/shared/canvas-node-references.ts'

test('shared services remain peers while reviewed value helpers are runtime dependencies', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(manifest.dependencies).filter(name => name.startsWith('@deepseek-ai/')).sort(), [
    '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-storage-domain', '@deepseek-ai/dsh-util-crypto',
  ])
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-tools'], 'workspace:*')
  assert.equal(manifest.dependencies['ali-oss'], '6.20.0')
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-client-ui-attachment'], 'workspace:*')
  for (const [name, version] of Object.entries(manifest.peerDependencies)) assert.equal(manifest.devDependencies[name], version)
})

test('reference messages use the public content Factory with authorized images and ordered attachments', async () => {
  const result = await build({ entryPoints: [new URL('../src/client/CanvasReferenceMessage.tsx', import.meta.url).pathname],
    bundle: true, write: false, format: 'cjs', platform: 'browser', jsx: 'automatic', external: ['react', 'react/*', '@deepseek-ai/*'] })
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props }
  const sandbox = { URL, TextEncoder, module: { exports: {} }, require: name => {
    if (name === 'react') return { useRef: () => ({ current: null }) }
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { HoverCard: 'hover-card' }
    throw Error('Unexpected import: ' + name)
  } }
  sandbox.exports = sandbox.module.exports
  vm.runInNewContext(result.outputFiles[0].text, sandbox)
  const native = [], factories = [], loadImage = () => {}
  const View = sandbox.module.exports.createCanvasReferenceMessageView(props => { native.push(props); return null }, () => {})
  const text = { type: 'text', text: 'keep my message' }
  const image = { id: 'image-id', mediaType: 'image/png', bytes: 42 }
  const file = { id: 'file-id', name: 'notes.txt', bytes: 10 }
  const unknown = { type: 'image', url: 'https://example.test/unmanaged.png' }
  const refs = { type: 'text', text: serializeNodeRefs([{ canvasId: '2873', nodeId: 'n1', title: 'Node', data: {}, products: [] }]) }
  const props = { node: { kind: 'user', data: { content: [text, { type: 'image', attachment: image }, { type: 'file', attachment: file }, unknown, refs] } }, loadImage,
    renderFactorySlot(name, input) { factories.push({ name, input }); return null } }
  View(props)
  assert.equal(factories.length, 1)
  assert.equal(factories[0].name, 'conversation.chat.user.content')
  assert.equal(factories[0].input.loadImage, loadImage)
  assert.deepEqual(JSON.parse(JSON.stringify(factories[0].input.content)), { text: '', extraBlocks: [], attachments: [{ type: 'image', image: { attachment: image } }, { type: 'file', file }] })
  assert.deepEqual(Array.from(native[0].node.data.content), [text, unknown])
  assert.equal(props.node.data.content.length, 5)
  View({ ...props, node: { ...props.node, data: { content: [text] } } })
  assert.equal(native[1].node.data.content[0], text)
  assert.equal(factories.length, 1)
})
