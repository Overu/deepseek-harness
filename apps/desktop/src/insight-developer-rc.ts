/** Internal RC controls for changing the environment for a single launch. */
import { app, dialog, Menu, MenuItem } from 'electron'
import { resolveAuthEnvironment } from '@insight-ai/desktop-integration/desktop'
import type { InsightDeveloperControls } from './insight-developer.ts'

const ENVIRONMENT_ARGUMENT = '--insight-rc-service-environment='
const zh = {
  menu: '开发者选项…', title: '开发者选项', cancel: '取消',
  environment: { production: '生产', test: '测试' },
  current: (name: string) => `当前环境：${name}`,
  switchTo: (name: string) => `切换到${name}环境`,
  detail: (name: string) => `切换会停止当前任务、退出登录并重启。下次手动打开客户端时恢复${name}环境。`,
} as const

function ordinaryRelaunchArguments(): string[] {
  return process.argv.slice(1).filter(argument => !argument.startsWith(ENVIRONMENT_ARGUMENT))
}

/** Whether this bundle includes the internal RC implementation. */
export const insightDeveloperEnabled: boolean = true

/** Expose a native environment picker and pass its choice to the next process only. */
export const insightDeveloper: InsightDeveloperControls = {
  launchEnvironment() {
    const argumentsWithEnvironment = process.argv.slice(1).filter(argument => argument.startsWith(ENVIRONMENT_ARGUMENT))
    if (argumentsWithEnvironment.length !== 1) return undefined
    const environment = argumentsWithEnvironment[0]?.slice(ENVIRONMENT_ARGUMENT.length)
    if (environment !== 'test' && environment !== 'production') return undefined
    return resolveAuthEnvironment({ packaged: environment === 'production' })
  },
  relaunchOptions: () => ({ args: ordinaryRelaunchArguments() }),
  installLoginMenu(items) {
    const applicationMenu = Menu.getApplicationMenu()
    const submenu = applicationMenu?.items[0]?.submenu
    if (applicationMenu === null || submenu === undefined) throw new Error('Insight login application menu is unavailable')
    for (const item of items) submenu.insert(1, new MenuItem(item))
    Menu.setApplicationMenu(applicationMenu)
  },
  menu(environment, parent, switchEnvironment, report) {
    const target = environment === 'production' ? 'test' : 'production'
    const show = async (): Promise<void> => {
      const window = parent()
      if (window === undefined || window.isDestroyed()) return
      const defaultEnvironment = resolveAuthEnvironment({ packaged: app.isPackaged }).name
      const { response } = await dialog.showMessageBox(window, {
        type: 'warning', title: zh.title, message: zh.current(zh.environment[environment]),
        detail: zh.detail(zh.environment[defaultEnvironment]),
        buttons: [zh.cancel, zh.switchTo(zh.environment[target])], defaultId: 0, cancelId: 0,
      })
      if (response === 1 && !window.isDestroyed()) {
        await switchEnvironment({ args: [...ordinaryRelaunchArguments(), `${ENVIRONMENT_ARGUMENT}${target}`] })
      }
    }
    return [{ label: zh.menu, click: () => { void show().catch(report) } }]
  },
}
