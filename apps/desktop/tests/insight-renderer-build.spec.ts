/** Insight renderers resolve workspace source during a cold Desktop bundle. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { build, normalizePath, type Plugin, version as viteVersion } from 'vite'
import { desktopRendererSourcePaths } from '../scripts/desktop-renderer-source-paths.mjs'

const desktopRoot = resolve(import.meta.dirname, '..')
const primitivesSource = normalizePath(resolve(desktopRoot, '../../packages/client/ui-primitives/src/index.ts'))
const primitivesBuild = normalizePath(resolve(desktopRoot, '../../packages/client/ui-primitives/lib'))
const outputs: string[] = []

afterEach(async () => { await Promise.all(outputs.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

describe('Insight renderer bundle', () => {
  it('builds the login renderer through workspace source aliases without a prebuilt primitives library', async () => {
    expect(viteVersion).toMatch(/^6\./u)
    const output = await mkdtemp(join(tmpdir(), 'insight-renderer-cold-build-'))
    outputs.push(output)
    const resolved = new Set<string>()
    const observeSourceResolution: Plugin = {
      name: 'insight-renderer-source-resolution',
      transform(_source, id) {
        if (id.startsWith(primitivesBuild)) throw new Error('Insight renderer must not resolve prebuilt ui-primitives')
        resolved.add(normalizePath(id))
        return undefined
      },
    }
    await build({
      configFile: false,
      root: desktopRoot,
      plugins: [desktopRendererSourcePaths(), observeSourceResolution],
      esbuild: { jsx: 'automatic' },
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      logLevel: 'silent',
      build: {
        outDir: output,
        emptyOutDir: true,
        lib: {
          entry: 'src/client/insight-login.tsx',
          formats: ['iife'],
          name: 'InsightLogin',
          fileName: () => 'insight-login.js',
          cssFileName: 'insight-login',
        },
      },
    })
    expect(resolved).toContain(primitivesSource)
  })
})
