/** Canvas-specific destinations paired with the Desktop-selected gateway. */
import { desktopServiceEnvironment } from '@insight-ai/desktop-integration/host'

const PROFILES = {
  test: {
    matting: 'https://test-api-upload.idealead.com',
    web: 'https://dynsight-test.insight-aigc.com',
    modelParams: 'https://game-ai-admin-test-cdn.idealead.com/model_node_setting/model_params_with_sort.json',
  },
  production: {
    matting: 'https://api-upload.idealead.com',
    web: 'https://dynsight.insight-aigc.com',
    modelParams: 'https://game-ai-admin-prod-cdn.idealead.com/model_node_setting/model_params_with_sort.json',
  },
} as const

/**
 * Resolve Canvas destinations for the environment selected by Desktop Main.
 * @returns The shared gateway origin and Canvas-specific destinations.
 * @throws If the Host has no valid Insight service environment.
 */
export function desktopServiceProfile() {
  const environment = process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT
  if (environment !== 'test' && environment !== 'production') throw new Error('invalid desktop service environment')
  return { ...PROFILES[environment], api: desktopServiceEnvironment(environment).gatewayOrigin }
}
