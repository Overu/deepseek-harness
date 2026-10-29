/** Authentication endpoint and cookie-partition selection for the desktop build. */
import type { AuthEnvironment } from '../shared/auth-contracts.ts'
import { desktopServiceEnvironment } from '../shared/service-environment.ts'

/** API origin and isolated cookie partition selected by the desktop build. */
export interface AuthEnvironmentConfig {
  name: AuthEnvironment
  baseUrl: string
  partition: string
}

/** Resolve the fixed authentication environment for this desktop build.
 *
 * @param input Packaging state supplied by Electron.
 * @returns The matching API origin and cookie partition.
 */
export function resolveAuthEnvironment(input: { packaged: boolean }): AuthEnvironmentConfig {
  const service = desktopServiceEnvironment(input.packaged ? 'production' : 'test')
  return {
    name: service.name,
    baseUrl: service.authOrigin,
    partition: input.packaged
      ? 'persist:insight-auth-production'
      : 'insight-auth-test',
  }
}
