/** Historical Electron appData location used by Insight Shell development builds. */
import { posix, win32 } from 'node:path'

/** Inputs normally supplied by the development launcher. */
export interface InsightDevelopmentDataInput {
  platform: NodeJS.Platform
  environment: NodeJS.ProcessEnv
  home: string
  directoryName: string
}

/**
 * Resolve the Shell-compatible default without starting Electron or touching its data.
 * @param input - Platform, inherited appData environment, home, and product directory name.
 * @returns Absolute default userData directory; explicit launcher overrides are handled by the caller.
 */
export function insightDevelopmentUserData(input: InsightDevelopmentDataInput): string {
  const paths = input.platform === 'win32' ? win32 : posix
  const appData = input.platform === 'darwin' ? posix.join(input.home, 'Library', 'Application Support')
    : input.platform === 'win32' ? input.environment.APPDATA || win32.join(input.home, 'AppData', 'Roaming')
      : input.environment.XDG_CONFIG_HOME || posix.join(input.home, '.config')
  if (!paths.isAbsolute(appData)) throw new Error('Insight development appData must be absolute')
  return paths.join(appData, input.directoryName)
}
