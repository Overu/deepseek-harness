import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/contexts\/AuthContext$/, replacement: fileURLToPath(new URL('./src/auth-context.tsx', import.meta.url)) },
      { find: /^@\/routes$/, replacement: fileURLToPath(new URL('./src/canvas-router.tsx', import.meta.url)) },
      { find: '@', replacement: fileURLToPath(new URL('./legacy/src', import.meta.url)) },
    ],
  },
  test: { environment: 'node', include: ['test/agent-*.test.ts'], setupFiles: ['./test/agent-test-setup.ts'] },
});
