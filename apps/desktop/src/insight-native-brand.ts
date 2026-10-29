/** Chinese native chrome copy for the Insight product, using the existing Desktop message roles. */
import type { DesktopLocale } from './locale.ts'

/**
 * Keep native menu and recovery branding consistent with the selected Insight application.
 * @param locale - Existing native message collection and language identity.
 * @param name - Validated product display name.
 * @returns Product-owned labels without mutating the shared official dictionaries.
 */
export function insightNativeLocale(locale: DesktopLocale, name: string): DesktopLocale {
  return { ...locale, messages: { ...locale.messages,
    aboutMenu: `关于 ${name}`, aboutProduct: name, hideApplication: `隐藏 ${name}`,
    quitApplication: `退出 ${name}`, openApplication: `打开 ${name}`, quitTitle: `退出 ${name}？`,
    startupFailed: `${name} 无法使用`, welcomeTitle: name, welcomeBrand: name,
    welcomeTaglineBrand: name, updateTitle: `${name} 更新`,
  } }
}

/**
 * Preserve the DSH conversation title while replacing its native-window product suffix.
 * @param title - Renderer-owned title using DSH's optional conversation separator.
 * @param name - Selected Insight product display name.
 * @returns The conversation title and Insight suffix, or the product name for a root page.
 */
export function insightWindowTitle(title: string, name: string): string {
  const separator = title.lastIndexOf(' — ')
  return separator < 0 ? name : `${title.slice(0, separator)} — ${name}`
}
