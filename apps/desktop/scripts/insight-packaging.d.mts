/** Insight product packaging selection. */
export const INSIGHT_PACKAGING_PRODUCT: 'insight'
export const INSIGHT_PACKAGING_APP_ID: 'com.insight-aigc.desktop'
export const INSIGHT_PACKAGING_PRODUCT_NAME: '因赛AI'
export const INSIGHT_PACKAGING_ARTIFACT_PREFIX: 'insight'
export const INSIGHT_DESKTOP_VERSION_ENV: 'INSIGHT_DESKTOP_VERSION'
export const INSIGHT_UPDATE_RESOURCE_ROOT: string

/** Resolve one signed Insight native release target. */
export function resolveInsightPackagingTarget(platform: NodeJS.Platform, arch: string): 'darwin-arm64' | 'darwin-x64' | 'win32-x64'

/** Resolve Insight product settings when DSH_DESKTOP_PRODUCT=insight. */
export function resolveInsightPackaging(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  arch: string,
  options?: { requireAppId?: boolean, requireNativeTarget?: boolean },
): {
  readonly appId: 'com.insight-aigc.desktop'
  readonly productName: '因赛AI'
  readonly artifactPrefix: 'insight'
  readonly productVersion: string
  readonly target: 'darwin-arm64' | 'darwin-x64' | 'win32-x64' | undefined
  readonly update: { readonly channel: 'nightly' | 'latest', readonly publicUrl: string } | undefined
} | undefined
