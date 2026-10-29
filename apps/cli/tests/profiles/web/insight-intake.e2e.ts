/** Keyless source-intake composition; all persistent writes stay in the smoke's temporary home. */
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

it('mounts all private Insight Host artifacts and rejects unauthenticated HTTP requests', async () => {
  const driver = fileURLToPath(new URL('./fixtures/insight-intake.ts', import.meta.url))
  const result = await runLoaderSmoke({
    label: 'Insight Host intake',
    tempDirPrefix: 'dsh-insight-intake-',
    binScript: driver,
    libBinScript: driver,
    mode: 'lib',
    configPath: driver,
    sourceImport: 'tsx/esm',
    tsconfigPath: fileURLToPath(new URL('../../../../../tsconfig.json', import.meta.url)),
    env: { DSH_TELEMETRY_DISABLED: '1' },
  })
  expect(result.stdout).toContain('Insight Host intake verified')
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
