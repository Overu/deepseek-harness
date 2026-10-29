import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePackagedApplicationPaths } from '../scripts/smoke-packaged-runtime.ts'

describe('packaged runtime smoke paths', () => {
  it.each([
    ['mac-arm64', '/artifacts', {}, join('/artifacts', 'mac-arm64', 'DeepSeek Harness.app', 'Contents', 'MacOS', 'DeepSeek Harness')],
    ['win-x64', '/artifacts', {}, join('/artifacts', 'win-unpacked', 'DeepSeek Harness.exe')],
    ['mac-x64', '/artifacts', { DSH_DESKTOP_PRODUCT: 'insight', INSIGHT_DESKTOP_VERSION: '1.3.0' },
      join('/artifacts', 'mac', '因赛AI.app', 'Contents', 'MacOS', '因赛AI')],
    ['win-x64', '/artifacts', { DSH_DESKTOP_PRODUCT: 'insight', INSIGHT_DESKTOP_VERSION: '1.3.0' },
      join('/artifacts', 'win-unpacked', '因赛AI.exe')],
  ] as const)('selects the product executable for %s', (target, artifacts, environment, executable) => {
    const paths = resolvePackagedApplicationPaths(target, artifacts, environment)

    expect(paths.executable).toBe(executable)
    expect(paths.resources).toBe(join(paths.application, target === 'win-x64' ? 'resources' : 'Resources'))
  })
})
