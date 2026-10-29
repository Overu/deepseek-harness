/** Desktop-owned destinations. Pages and tool arguments cannot choose another environment. */
const PROFILES = {
  test: {
    matting: 'https://test-api-upload.idealead.com', api: 'https://gapi-test.insight-aigc.com', web: 'https://dynsight-test.insight-aigc.com',
    modelParams: 'https://game-ai-admin-test-cdn.idealead.com/model_node_setting/model_params_with_sort.json',
  },
  production: {
    matting: 'https://api-upload.idealead.com', api: 'https://gapi.insight-aigc.com', web: 'https://dynsight.insight-aigc.com',
    modelParams: 'https://game-ai-admin-prod-cdn.idealead.com/model_node_setting/model_params_with_sort.json',
  },
} as const

export function desktopServiceProfile() {
  const environment = process.env.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT
  if (environment && environment !== 'test' && environment !== 'production') throw new Error('invalid desktop service environment')
  return environment === 'production' ? PROFILES.production : PROFILES.test
}
