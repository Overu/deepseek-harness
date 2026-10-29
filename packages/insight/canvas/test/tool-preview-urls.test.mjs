import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('tool previews stay HTTPS inside the HTTP desktop canvas frame', () => {
  const desktopFrame = 'http://127.0.0.1:3000/desktop-canvas/view?id=2873'
  const config = readFileSync(new URL('../canvas-app/legacy/src/components/canvasFlow/settings/toolListConfig.tsx', import.meta.url), 'utf8')
  const urls = [...config.matchAll(/gift:\s*'([^']+)'/gu)].map(match => match[1])
  assert.ok(urls.length > 0)
  for (const url of urls) {
    assert.equal(new URL(url, desktopFrame).protocol, 'https:', url)
  }
})
