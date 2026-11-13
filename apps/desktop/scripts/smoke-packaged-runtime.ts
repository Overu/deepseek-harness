/** Validate the assembled application, including native Office conversion outside ASAR. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { desktopArtifactOutput, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { readDesktopRuntime, verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { INSIGHT_REQUIRED_BUNDLES, resolveDesktopProduct } from '../src/product.ts'
import { verifyWindowsCode } from './windows-runtime-signature.mjs'
import { smokePreparedRuntime } from './smoke-prepared-runtime.ts'
import { resolveDesktopPackageTarget } from './package-target.ts'
import { INSIGHT_WINDOWS_EXECUTABLE_NAME } from './insight-packaging.mjs'
import { readAsar } from 'app-builder-lib/out/asar/asar.js'

type DesktopBuildTarget = ReturnType<typeof resolveDesktopBuildTarget>

/** Resolve the unpacked product paths that the runtime smoke launches. */
export function resolvePackagedApplicationPaths(
  target: DesktopBuildTarget,
  artifacts: string,
  environment: NodeJS.ProcessEnv,
): { readonly application: string; readonly resources: string; readonly executable: string } {
  const windows = target === 'win-x64'
  const product = resolveDesktopProduct({ isPackaged: false, environment })
  const productName = product.kind === 'insight' ? product.productName : 'DeepSeek Harness'
  const windowsExecutableName = product.kind === 'insight' ? INSIGHT_WINDOWS_EXECUTABLE_NAME : productName
  const application = windows ? join(artifacts, 'win-unpacked')
    : join(artifacts, target === 'mac-arm64' ? 'mac-arm64' : 'mac', `${productName}.app`, 'Contents')
  return {
    application,
    resources: join(application, windows ? 'resources' : 'Resources'),
    executable: windows ? join(application, `${windowsExecutableName}.exe`) : join(application, 'MacOS', productName),
  }
}

/** Decide whether this packaged target carries an Authenticode signature to verify. */
export function shouldVerifyWindowsCode(target: DesktopBuildTarget, unsigned: boolean, environment: NodeJS.ProcessEnv): boolean {
  if (target !== 'win-x64' || unsigned) return false
  return resolveDesktopProduct({ isPackaged: false, environment }).kind !== 'insight'
}

async function main(): Promise<void> {
  const paths = resolveDesktopTargetBuildPaths()
  const { values } = parseArgs({ options: { unsigned: { type: 'boolean', default: false }, 'skip-notarization': { type: 'boolean', default: false } }, allowPositionals: false })
  const target = resolveDesktopBuildTarget()
  const artifacts = desktopArtifactOutput(paths, { unsigned: values.unsigned, skipNotarization: values['skip-notarization'] }).directory
  const { application, resources, executable } = resolvePackagedApplicationPaths(target, artifacts, process.env)
  const insight = resolveDesktopProduct({ isPackaged: false, environment: process.env }).kind === 'insight'
  if (insight) {
    const archive = await readAsar(join(resources, 'app.asar'))
    for (const file of ['SKILL.md', 'ui.json', join('scripts', 'download_psd.mjs')]) {
      const path = join('dsh', 'node_modules', '@insight-ai',
        'desktop-media-upload-plugin', 'guidance', 'image-layering', file)
      if ((await archive.readFile(path)).byteLength === 0) throw new Error(`desktop package: empty Insight skill file ${path}`)
    }
  }
  const descriptor = await verifyDesktopRuntime(paths.dsh, readDesktopRuntime(paths.dsh).release.version,
    resolveDesktopPackageTarget(target))
  if (insight) {
    const packages = new Set(descriptor.sharedPackages.map(entry => entry.name))
    for (const name of INSIGHT_REQUIRED_BUNDLES) {
      if (!packages.has(name)) throw new Error(`desktop package: missing Insight bundle ${name}`)
    }
  }
  if (shouldVerifyWindowsCode(target, values.unsigned, process.env)) await verifyWindowsCode(application)
  await smokePreparedRuntime(join(resources, 'app.asar', 'dsh'), executable, join(resources, 'runtime'), descriptor)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
