import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('upload names work when the browser has getRandomValues without randomUUID', () => {
  const moduleUrl = new URL('../src/shared/upload/url.ts', import.meta.url).href
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', `
    import assert from 'node:assert/strict'
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined })
    const { createStoredFileName } = await import(${JSON.stringify(moduleUrl)})
    const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'
    assert.match(createStoredFileName('Picture.PNG '), new RegExp('^' + uuid + '[.]png$'))
    assert.match(createStoredFileName('without-extension'), new RegExp('^' + uuid + '$'))
  `], { encoding: 'utf8' })
  assert.ifError(result.error)
  assert.equal(result.signal, null, result.stderr)
  assert.equal(result.status, 0, result.stderr)
})
