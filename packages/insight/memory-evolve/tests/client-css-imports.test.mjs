import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

test('imports lifecycle-managed styles as inline CSS text', async () => {
  const files = ['src/client/index.ts', 'src/client/canvas-grok/index.ts']
  for (const relativePath of files) {
    const source = await readFile(join(packageRoot, relativePath), 'utf8')
    assert.doesNotMatch(source, /import\s+\w+\s+from\s+['"][^'"]+\.css['"]/)
    assert.match(source, /\.css\?inline['"]/, `${relativePath} must import inline CSS text`)
  }
  const declarations = await readFile(join(packageRoot, 'src/client/css.d.ts'), 'utf8')
  assert.match(declarations, /declare module '\*\.css\?inline'/)
})
