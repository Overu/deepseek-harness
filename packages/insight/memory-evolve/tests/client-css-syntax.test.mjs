import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { transform } from 'lightningcss'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

for (const relativePath of ['src/client/broadcast-styles.css', 'src/client/styles.css']) {
  test(`Lightning CSS parses ${relativePath}`, async () => {
    const code = await readFile(join(packageRoot, relativePath))
    const result = transform({ filename: relativePath, code })
    assert.ok(result.code.length > 0)
  })
}
