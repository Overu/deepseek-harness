/** Product identity selected before Electron reads any product-scoped state. */
import { parse } from 'semver'

/** Product selector written to an Insight packaged application's manifest. */
export const INSIGHT_DESKTOP_PRODUCT = 'insight'

/** Product components selected on startup and retained by recovery. */
export const INSIGHT_REQUIRED_BUNDLES: readonly string[] = [
  '@insight-ai/desktop-integration',
  '@insight-ai/desktop-canvas-plugin',
  '@insight-ai/desktop-media-upload-plugin',
  'dsh-memory-evolve',
  'dsh-prompt-enhance',
  '@insight-ai/skill-center',
]

/** Environment variable that selects the Insight product for development. */
export const DESKTOP_PRODUCT_ENV = 'DSH_DESKTOP_PRODUCT'

/** Environment variable that supplies the Insight product version for development and packaging. */
export const INSIGHT_DESKTOP_VERSION_ENV = 'INSIGHT_DESKTOP_VERSION'

/** Packaged-manifest field recording the bundled DSH runtime version. */
export const DESKTOP_RUNTIME_VERSION_FIELD = 'dshDesktopRuntimeVersion'

/** Product branding resources relative to Electron's resources directory. */
export interface DesktopBranding {
  readonly macIcon: 'branding/icon.icns'
  readonly windowsIcon: 'branding/icon.ico'
  readonly resourceIcon: 'branding/app-icon.png'
}

/** The unchanged upstream Desktop product. */
export interface OfficialDesktopProduct {
  readonly kind: 'official'
}

/** Insight Desktop product identity and its separately-versioned DSH runtime. */
export interface InsightDesktopProduct {
  readonly kind: 'insight'
  readonly productName: '因赛AI' | '因赛AI 测试版'
  readonly appId: 'com.insight-aigc.desktop' | 'com.insight-aigc.desktop.test'
  readonly userDataName: 'insight-desktop' | 'insight-desktop-test'
  readonly developmentUserDataName: 'insight-desktop-dev'
  readonly serviceEnvironment: 'test' | 'production'
  readonly productVersion: string
  readonly runtimeVersion: string | undefined
  readonly branding: DesktopBranding
}

/** Product identity selected for this Desktop process. */
export type DesktopProduct = OfficialDesktopProduct | InsightDesktopProduct

/** Inputs that are available before Electron starts consuming user data. */
export interface ResolveDesktopProductOptions {
  readonly isPackaged: boolean
  readonly manifest?: unknown
  readonly environment?: NodeJS.ProcessEnv
}

const INSIGHT_BRANDING: DesktopBranding = {
  macIcon: 'branding/icon.icns',
  windowsIcon: 'branding/icon.ico',
  resourceIcon: 'branding/app-icon.png',
}

function objectField(value: unknown, field: string): unknown {
  if (value === null || typeof value !== 'object') return undefined
  return (value as Record<string, unknown>)[field]
}

function resolveVersion(value: unknown, label: string, major?: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`desktop product: ${label} must be set to a semantic version`)
  }
  const parsed = parse(value.trim(), { loose: false })
  if (parsed === null || parsed.build.length > 0 || (major !== undefined && parsed.major !== major)) {
    throw new Error(`desktop product: ${label} must be a ${major === undefined ? '' : `${String(major)}.x `}semantic version without build metadata`)
  }
  return parsed.version
}

/**
 * Resolve the selected Desktop product without consulting Electron globals.
 * @param options - Packaged manifest or development environment used to select the product.
 * @returns The official product, or the complete Insight product identity.
 */
export function resolveDesktopProduct(options: ResolveDesktopProductOptions): DesktopProduct {
  const environment = options.environment ?? process.env
  const developmentSelection = environment[DESKTOP_PRODUCT_ENV]?.trim()
  const selected = options.isPackaged
    ? objectField(options.manifest, 'dshDesktopProduct')
    : developmentSelection
  if (selected === undefined || selected === '') return { kind: 'official' }
  if (selected !== INSIGHT_DESKTOP_PRODUCT) {
    throw new Error(`desktop product: ${options.isPackaged ? 'dshDesktopProduct' : DESKTOP_PRODUCT_ENV} must be ${INSIGHT_DESKTOP_PRODUCT}`)
  }
  const productVersion = resolveVersion(
    options.isPackaged ? objectField(options.manifest, 'version') : environment[INSIGHT_DESKTOP_VERSION_ENV],
    options.isPackaged ? 'packaged Insight version' : INSIGHT_DESKTOP_VERSION_ENV,
    1,
  )
  const runtime = options.isPackaged ? objectField(options.manifest, DESKTOP_RUNTIME_VERSION_FIELD) : environment.DSH_CLIENT_VERSION
  const packagedService = options.isPackaged ? objectField(options.manifest, 'dshInsightServiceEnvironment') : undefined
  if (packagedService !== undefined && packagedService !== 'test') {
    throw new Error('desktop product: dshInsightServiceEnvironment must be test when present')
  }
  const testPackage = packagedService === 'test'
  if (testPackage && objectField(options.manifest, 'dshDesktopAppId') !== 'com.insight-aigc.desktop.test') {
    throw new Error('desktop product: test service environment requires the isolated test application ID')
  }
  if (options.isPackaged && !testPackage && objectField(options.manifest, 'dshDesktopAppId') === 'com.insight-aigc.desktop.test') {
    throw new Error('desktop product: test application ID requires the test service environment')
  }
  return {
    kind: 'insight',
    productName: testPackage ? '因赛AI 测试版' : '因赛AI',
    appId: testPackage ? 'com.insight-aigc.desktop.test' : 'com.insight-aigc.desktop',
    userDataName: testPackage ? 'insight-desktop-test' : 'insight-desktop',
    developmentUserDataName: 'insight-desktop-dev',
    serviceEnvironment: testPackage || !options.isPackaged ? 'test' : 'production',
    productVersion,
    runtimeVersion: runtime === undefined ? undefined : resolveVersion(runtime, DESKTOP_RUNTIME_VERSION_FIELD),
    branding: INSIGHT_BRANDING,
  }
}
