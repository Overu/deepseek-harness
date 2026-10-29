import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

test('keeps the copied Host entry outside the node bundle', async () => {
  const configUrl = pathToFileURL(join(packageRoot, 'tsdown.config.ts')).href
  const program = [
    `import config from ${JSON.stringify(configUrl)};`,
    'const entries = config({ env: {} });',
    "const host = entries.find(entry => entry.name === 'dsh-memory-evolve');",
    "if (host?.deps?.neverBundle?.('./host/index.js') !== true) throw new Error('Host entry is bundled');",
    "if (host.deps.neverBundle('@deepseek-ai/cordis') !== true) throw new Error('default dependency filter was replaced');",
  ].join('\n')
  const { stdout } = await execFileAsync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '--eval', program], { cwd: packageRoot })
  assert.equal(stdout, '')
})
