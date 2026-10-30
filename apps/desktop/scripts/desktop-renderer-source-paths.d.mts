import type tsconfigPaths from 'vite-tsconfig-paths'

/** Resolve renderer workspace imports through the repository source aliases during a cold Desktop bundle. */
export function desktopRendererSourcePaths(): ReturnType<typeof tsconfigPaths>
