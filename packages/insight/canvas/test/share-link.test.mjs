import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCanvasShareLink, copyCanvasShareLink } from '../canvas-app/src/share-link.ts'

test('share response code becomes a complete environment-specific Web URL', () => {
  const code = 'vAEbTKM4vOVdv'
  assert.equal(buildCanvasShareLink('https://dynsight-test.insight-aigc.com', code),
    'https://dynsight-test.insight-aigc.com/share/vAEbTKM4vOVdv')
  assert.equal(buildCanvasShareLink('https://dynsight.insight-aigc.com', code),
    'https://dynsight.insight-aigc.com/share/vAEbTKM4vOVdv')
})

test('share link requires the share code and configured Web origin', () => {
  assert.throws(() => buildCanvasShareLink(undefined, 'vAEbTKM4vOVdv'), /分享域名不可用/u)
  assert.throws(() => buildCanvasShareLink('https://dynsight.insight-aigc.com', undefined), /分享码无效/u)
  assert.throws(() => buildCanvasShareLink('https://example.com', 'vAEbTKM4vOVdv'), /分享域名不可用/u)
})

test('clipboard fallback copies the complete link when iframe clipboard access is denied', async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const link = 'https://dynsight.insight-aigc.com/share/vAEbTKM4vOVdv'
  let copied = ''
  let onCopy
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    clipboard: { writeText: async () => { throw new Error('permission denied') } }
  } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ value: '', style: {}, select() {}, remove() {} }),
    body: { appendChild() {} },
    addEventListener: (_event, listener) => { onCopy = listener },
    removeEventListener: () => { onCopy = undefined },
    execCommand: () => {
      onCopy({ preventDefault() {}, clipboardData: { setData: (_type, value) => { copied = value } } })
      return true
    }
  } })
  try {
    assert.equal(await copyCanvasShareLink(link), true)
    assert.equal(copied, link)
    assert.equal(onCopy, undefined)
    globalThis.document.execCommand = () => false
    assert.equal(await copyCanvasShareLink(link), false)
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    else delete globalThis.navigator
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor)
    else delete globalThis.document
  }
})
