/** Plugin-owned browser lane using the repository's real Web scaffold. */
import { fileURLToPath } from 'node:url'
import webConfig from '../../../../vitest.web.config.ts'

export default {
  ...webConfig,
  root: fileURLToPath(new URL('../../../..', import.meta.url)),
  test: { ...webConfig.test, include: ['packages/insight/skill-center/tests/*.e2e.ts'] },
}
