import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'

const CLIENT_SOURCE_TSCONFIG = fileURLToPath(new URL('../../../tsconfig.base.json', import.meta.url))

/**
 * Resolve renderer workspace imports through the repository source aliases during a cold Desktop bundle.
 * @returns The Vite plugin that applies the repository source paths.
 */
export function desktopRendererSourcePaths() {
  return tsconfigPaths({ projects: [CLIENT_SOURCE_TSCONFIG] })
}
