import { build } from 'vite'
import { clientBundle } from '../../client/tsdown.client.ts'

/** Build portable Main/Host entries and the standalone login library before Desktop's renderer. */
export default clientBundle(import.meta.dirname, ['lib/types/index.js', 'lib/types/desktop.js', 'lib/types/host.js', 'lib/types/protocol.js'], {
  hostPhase: true,
  lib: {
    hooks: {
      'build:done': async () => {
        for (const entry of ['login', 'update']) await build({
          configFile: false, root: import.meta.dirname,
          build: {
            outDir: 'lib', emptyOutDir: false,
            lib: { entry: `src/client/${entry}.ts`, formats: ['es'], fileName: () => `${entry}.js`, cssFileName: entry },
            rollupOptions: { external: [/^react(?:-dom)?(?:\/|$)/, /^@deepseek-ai\//] },
          },
          esbuild: { jsx: 'automatic' },
        })
      },
    },
  },
})
