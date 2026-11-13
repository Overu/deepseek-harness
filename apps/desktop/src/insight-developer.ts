/** Release implementation of the build-selected Insight developer controls. */
import type { BrowserWindow, MenuItemConstructorOptions, RelaunchOptions } from 'electron'
import type { AuthEnvironment } from '@insight-ai/desktop-integration/protocol'
import type { AuthEnvironmentConfig } from '@insight-ai/desktop-integration/desktop'

/** Main-process hooks for internal Insight builds. */
export interface InsightDeveloperControls {
  /** Read a validated environment override, or use the normal startup default. */
  launchEnvironment(): AuthEnvironmentConfig | undefined
  /** Drop any environment override on ordinary restarts. */
  relaunchOptions(): RelaunchOptions | undefined
  /** Offer an environment switch in the login window or authenticated workspace. */
  menu(environment: AuthEnvironment, parent: () => BrowserWindow | undefined,
    switchEnvironment: (options: RelaunchOptions) => Promise<void>, report: (error: unknown) => void): MenuItemConstructorOptions[]
  /** Add the developer menu item to the existing Insight application menu before login. */
  installLoginMenu(items: MenuItemConstructorOptions[]): void
}

/** Whether this bundle includes the internal RC implementation. */
export const insightDeveloperEnabled: boolean = false

/** Release builds provide no runtime environment override or developer menu. */
export const insightDeveloper: InsightDeveloperControls = {
  launchEnvironment: () => undefined,
  relaunchOptions: () => undefined,
  menu: () => [],
  installLoginMenu: () => {},
}
