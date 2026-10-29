import type { Plugin, Rollup } from 'vite'

export function auditCanvasService(bundle: Rollup.OutputBundle) {
  const entry = bundle['canvas-service.js']
  if (!entry || entry.type !== 'chunk' || !entry.isEntry || !entry.exports.includes('createCanvasServiceRuntime')) {
    throw new Error('Canvas service entry/export is missing')
  }
  const visited = new Set<string>()
  const visit = (filename: string) => {
    if (visited.has(filename)) return
    const chunk = bundle[filename]
    if (!chunk || chunk.type !== 'chunk') throw new Error(`Canvas service dependency is missing: ${filename}`)
    visited.add(filename)
    for (const id of chunk.moduleIds) {
      const path = id.replaceAll('\\', '/')
      if (['/src/main.tsx', '/src/canvas-router.tsx', '/components/canvasFlow/index.tsx', '/common/storageLimitManager.tsx', '/sonner/dist/'].some(forbidden => path.includes(forbidden))) {
        throw new Error(`Canvas service eagerly includes a UI bootstrap/feedback module: ${id}`)
      }
    }
    chunk.imports.forEach(visit)
  }
  visit(entry.fileName)
  return { version: 1, entry: entry.fileName, exports: entry.exports, staticChunks: [...visited].sort() }
}

export function canvasServiceAudit(): Plugin {
  return {
    name: 'desktop-canvas-service-audit',
    generateBundle(_options, bundle) {
      const manifest = auditCanvasService(bundle)
      this.emitFile({ type: 'asset', fileName: 'canvas-service-manifest.json', source: JSON.stringify(manifest, null, 2) })
    },
  }
}
