import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import svgr from 'vite-plugin-svgr'
import { canvasServiceAudit } from './build/canvas-service-audit'

const legacySrc = fileURLToPath(new URL('./legacy/src', import.meta.url))

export default defineConfig({
  base: '/desktop-canvas/',
  resolve: {
    alias: [
      { find: /^@\/contexts\/AuthContext$/, replacement: fileURLToPath(new URL('./src/auth-context.tsx', import.meta.url)) },
      { find: /^@\/routes$/, replacement: fileURLToPath(new URL('./src/canvas-router.tsx', import.meta.url)) },
      { find: '@', replacement: legacySrc },
      { find: /^~/, replacement: '' },
    ],
  },
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  worker: { format: 'es' },
  css: { preprocessorOptions: { less: { javascriptEnabled: true } } },
  plugins: [tailwindcss(), react(), svgr(), canvasServiceAudit()],
  build: {
    sourcemap: false,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        'canvas-service': fileURLToPath(new URL('./src/canvas-service-entry.ts', import.meta.url)),
      },
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: chunk => chunk.name === 'canvas-service' ? 'canvas-service.js' : 'assets/[name]-[hash].js' },
    },
  },
})
