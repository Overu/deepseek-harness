/** Verify private Insight Host artifacts behind the production Web profile. */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { bootProductionProfile } from '../../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const repository = new URL('../../../../../../', import.meta.url)
const patchPath = join(process.cwd(), 'insight-intake.patch.yml')
const components = ['canvas', 'memory-evolve', 'prompt-enhance']
const modules = components.map(component => new URL(`packages/insight/${component}/lib/index.js`, repository).href)
await writeFile(patchPath, JSON.stringify([
  { id: 'web-runtime', config: { printUrl: false, openBrowser: false } },
  { insert: modules.map((name, index) => ({
    id: `insight-${components[index]}`,
    name,
    ...(components[index] === 'memory-evolve' ? { config: {
      memoryDir: join(process.cwd(), 'memories'),
      skillDir: join(process.cwd(), 'skills'),
    } } : {}),
  })) },
]))

const readyListeners = new Set<() => void>()
const ctx = await bootProductionProfile({
  binName: 'insight-intake',
  profile: 'web',
  overlayPaths: [patchPath],
  prepare(root) {
    provideCmdline(root, {
      args: ['--port', '0', '--no-open'],
      exit(code) { throw new Error(`Unexpected application exit: ${code}`) },
      ready: { onReady(listener) {
        readyListeners.add(listener)
        return () => { readyListeners.delete(listener) }
      } },
    })
  },
})
try {
  for (const listener of readyListeners) listener()
  readyListeners.clear()
  const entries = [...ctx.loader.entries()].filter(entry => modules.includes(entry.options.name))
  assert.equal(entries.length, 3)
  assert(entries.every(entry => entry.fiber !== undefined), 'Every Insight Host entry must mount')
  const names = new Set(ctx.tools.definitions().map(tool => tool.name))
  assert(names.has('canvas_get'))
  assert(names.has('canvas_process'))
  assert(names.has('memory'))
  const origin = ctx.webServer.getOrigin()
  for (const path of ['/desktop-canvas/canvas-service.js', '/memory-evolve/api/config', '/prompt-enhance/enhance']) {
    const response = await fetch(origin + path, {
      method: path.startsWith('/prompt-enhance/') ? 'POST' : 'GET',
    })
    assert([401, 403].includes(response.status), `${path} must reject an unauthenticated request; got ${response.status}`)
    await response.body?.cancel()
  }
  process.stdout.write('Insight Host intake verified\n')
} finally {
  await ctx.fiber.dispose()
}
