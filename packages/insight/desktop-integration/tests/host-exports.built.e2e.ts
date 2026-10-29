/** Built-package checks for the public Insight Host service subpath. */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const fixture = fileURLToPath(new URL('./fixtures/host-exports-built.mjs', import.meta.url))
const hostEntry = fileURLToPath(new URL('../lib/host.js', import.meta.url))
const execFileAsync = promisify(execFile)

it.skipIf(process.env.DSH_EXAMPLE_MODE !== 'lib' || !existsSync(hostEntry))(
  'keeps Host service classes out of the plugin root while sharing their built identity',
  async () => {
    const { stderr, stdout } = await execFileAsync(process.execPath, [fixture])
    expect(stderr).toBe('')
    expect(stdout).toBe('INSIGHT_HOST_EXPORTS_OK\n')
  },
)
