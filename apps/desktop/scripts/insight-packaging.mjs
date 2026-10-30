/** Resolve the Insight product settings used by the Desktop packaging pipeline. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'semver'

export const INSIGHT_PACKAGING_PRODUCT = 'insight'
export const INSIGHT_PACKAGING_APP_ID = 'com.insight-aigc.desktop'
export const INSIGHT_PACKAGING_PRODUCT_NAME = '因赛AI'
export const INSIGHT_PACKAGING_ARTIFACT_PREFIX = 'insight'
export const INSIGHT_DESKTOP_VERSION_ENV = 'INSIGHT_DESKTOP_VERSION'
export const INSIGHT_UPDATE_RESOURCE_ROOT = fileURLToPath(new URL('../../../packages/insight/desktop-integration/resources/update/', import.meta.url))

/**
 * Read the checked-in, public Insight update origin.
 * @returns {string} Valid HTTPS origin without a path, query, credentials, or fragment.
 */
function readInsightUpdateOrigin() {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(new URL('../../../packages/insight/desktop-integration/resources/update/update-distribution.json', import.meta.url), 'utf8'))
  } catch {
    throw new Error('desktop package: cannot read Insight update distribution configuration')
  }
  if (parsed === null || typeof parsed !== 'object' || parsed.schema !== 1 || typeof parsed.updateOrigin !== 'string') {
    throw new Error('desktop package: invalid Insight update distribution configuration')
  }
  let origin
  try { origin = new URL(parsed.updateOrigin) } catch { throw new Error('desktop package: Insight update origin must be a valid HTTPS origin') }
  if (origin.protocol !== 'https:' || origin.origin !== parsed.updateOrigin || origin.pathname !== '/' || origin.search !== '' || origin.hash !== '' || origin.username !== '' || origin.password !== '') {
    throw new Error('desktop package: Insight update origin must be an HTTPS origin without a path or credentials')
  }
  return origin.origin
}

/**
 * Resolve one native release target Insight distributes.
 * @param {NodeJS.Platform} platform - Electron-builder target platform.
 * @param {string} arch - Electron-builder target architecture.
 * @returns {'darwin-arm64' | 'darwin-x64' | 'win32-x64'} Immutable native release target.
 */
export function resolveInsightPackagingTarget(platform, arch) {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) return `darwin-${arch}`
  if (platform === 'win32' && arch === 'x64') return 'win32-x64'
  throw new Error('desktop package: Insight distribution requires macOS arm64 or x64, or Windows x64')
}

/**
 * Resolve an Insight product release only when it is explicitly selected.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {NodeJS.Platform} platform - Electron-builder target platform.
 * @param {string} arch - Electron-builder target architecture.
 * @param {{ requireAppId?: boolean, requireNativeTarget?: boolean }} options - Require the dotenv application identifier or signed native target when release validation owns them.
 * @returns {{ appId: string, productName: string, artifactPrefix: string, productVersion: string, target: 'darwin-arm64' | 'darwin-x64' | 'win32-x64' | undefined, update: { channel: 'nightly' | 'latest', publicUrl: string } | undefined } | undefined} Insight product settings.
 */
export function resolveInsightPackaging(env, platform, arch, options = {}) {
  const selected = env.DSH_DESKTOP_PRODUCT?.trim()
  if (selected === undefined || selected === '') return undefined
  if (selected !== INSIGHT_PACKAGING_PRODUCT) throw new Error(`desktop package: DSH_DESKTOP_PRODUCT must be ${INSIGHT_PACKAGING_PRODUCT}`)
  const value = env[INSIGHT_DESKTOP_VERSION_ENV]?.trim()
  const version = value === undefined || value === '' ? null : parse(value, { loose: false })
  if (version === null || version.build.length > 0 || version.major !== 1) {
    throw new Error(`desktop package: ${INSIGHT_DESKTOP_VERSION_ENV} must be a 1.x semantic version without build metadata`)
  }
  const configuredAppId = env.DSH_DESKTOP_APP_ID?.trim()
  if (options.requireAppId && configuredAppId !== INSIGHT_PACKAGING_APP_ID) {
    throw new Error(`desktop package: DSH_DESKTOP_APP_ID must be ${INSIGHT_PACKAGING_APP_ID} for Insight packaging`)
  }
  if (!options.requireAppId && configuredAppId !== undefined && configuredAppId !== '' && configuredAppId !== INSIGHT_PACKAGING_APP_ID) {
    throw new Error(`desktop package: DSH_DESKTOP_APP_ID must be ${INSIGHT_PACKAGING_APP_ID} for Insight packaging`)
  }
  const target = (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) || (platform === 'win32' && arch === 'x64')
    ? resolveInsightPackagingTarget(platform, arch) : undefined
  if (options.requireNativeTarget && target === undefined) resolveInsightPackagingTarget(platform, arch)
  const origin = target === undefined ? undefined : readInsightUpdateOrigin()
  const channel = version.prerelease.length === 0 ? 'latest' : 'nightly'
  const releaseRoot = channel === 'nightly' ? 'desktop/native/releases' : 'desktop/releases'
  return {
    appId: INSIGHT_PACKAGING_APP_ID,
    productName: INSIGHT_PACKAGING_PRODUCT_NAME,
    artifactPrefix: INSIGHT_PACKAGING_ARTIFACT_PREFIX,
    productVersion: version.version,
    target,
    update: target === undefined || origin === undefined ? undefined : {
      channel,
      publicUrl: `${origin}/${releaseRoot}/v${version.version}/targets/${target}/`,
    },
  }
}
