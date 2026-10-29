/** Manifest discovery for the npm baseline's vendor, harness, and application packages. */

import { globSync } from 'node:fs'
import { PRIVATE_EXPERIMENTAL_PACKAGE_DIRECTORIES } from './experimental-package-policy.ts'
import { INSIGHT_PRODUCT_PACKAGES } from './insight-package-policy.ts'

const PACKAGE_PATTERNS = [
  'vendor/*/package.json',
  'packages/*/*/package.json',
  'apps/*/package.json',
] as const

/**
 * Discover baseline manifests while excluding private experimental and Insight product inputs.
 * @param root - repository root to scan.
 * @param privateDirectories - repository-relative experimental directories excluded from publication.
 * @returns Sorted repository-relative manifest paths with forward slashes.
 */
export function discoverNpmBaselineManifests(
  root: string,
  privateDirectories: readonly string[] = PRIVATE_EXPERIMENTAL_PACKAGE_DIRECTORIES,
): string[] {
  return globSync(PACKAGE_PATTERNS, {
    cwd: root,
    exclude: [...privateDirectories, ...Object.keys(INSIGHT_PRODUCT_PACKAGES)].map(directory => `${directory}/package.json`),
  }).map(path => path.replaceAll('\\', '/')).sort()
}
