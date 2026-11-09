import type { AuthEnvironment } from './auth-contracts.ts'

/** Fixed service endpoints published with the desktop application. */
export interface DesktopServiceEnvironment {
  readonly name: AuthEnvironment
  readonly authOrigin: string
  readonly modelBaseUrl: string
}

const ENVIRONMENTS: Readonly<Record<AuthEnvironment, DesktopServiceEnvironment>> = Object.freeze({
  test: Object.freeze({
    name: 'test',
    authOrigin: 'https://gapi-test.insight-aigc.com',
    modelBaseUrl: 'https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1',
  }),
  production: Object.freeze({
    name: 'production',
    authOrigin: 'https://gapi.insight-aigc.com',
    modelBaseUrl: 'https://gapi.insight-aigc.com/insight-harness-llm-gateway/v1',
  }),
})

/** Return a build-selected service pair without a user-editable runtime override. */
export function desktopServiceEnvironment(name: AuthEnvironment): DesktopServiceEnvironment {
  return ENVIRONMENTS[name]
}

/** Return the fixed enterprise gateway base for authenticated Host services.
 * @param name - Product-selected authentication environment.
 * @returns HTTPS service base including the enterprise gateway path.
 */
export function skillProxyServiceBaseUrl(name: AuthEnvironment): string {
  return `${desktopServiceEnvironment(name).authOrigin}/insight-harness-service`
}

/** Return the fixed upload-center gateway base for direct Desktop uploads.
 * @param name - Product-selected authentication environment.
 * @returns HTTPS service base including the upload-center gateway path.
 */
export function uploadCenterServiceBaseUrl(name: AuthEnvironment): string {
  return `${desktopServiceEnvironment(name).authOrigin}/game-ai-editor-center`
}
