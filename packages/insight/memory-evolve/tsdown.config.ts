import { clientBundle } from '../../client/tsdown.client.ts'
import { copyRuntimeResources } from './scripts/copy-runtime-resources.mjs'

const config = clientBundle(import.meta.dirname, ['lib/types/index.js'], {
  lib: {
    // The Host snapshot is copied as an ESM module tree. Keeping it external
    // preserves each module's import.meta.url resource anchor at runtime.
    hooks: {
      'build:done': async () => { await copyRuntimeResources() },
    },
  },
})

/** Keep the Host wrapper as an import without replacing the shared node dependency filter. */
export default (inlineConfig: Parameters<typeof config>[0]) => config(inlineConfig).map((entry) => {
  if (entry.name !== 'dsh-memory-evolve') return entry
  const neverBundle = entry.deps?.neverBundle
  if (typeof neverBundle !== 'function') {
    throw new Error('dsh-memory-evolve: clientLibraryConfig must provide deps.neverBundle')
  }
  return {
    ...entry,
    deps: {
      ...entry.deps,
      neverBundle: (specifier: string) => specifier === './host/index.js' || neverBundle(specifier),
    },
  }
})
