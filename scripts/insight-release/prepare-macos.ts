/** Prepare and remove the private macOS signing inputs used by Insight Actions packaging. */

import { appendFile, chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEMPORARY_PREFIX = 'insight-macos-release-'
const MACOS_TARGETS = new Set(['mac-arm64', 'mac-x64'])

/** Inputs required to prepare one signed Insight macOS package invocation. */
export interface PrepareInsightMacOSInput {
  /** GitHub Actions temporary root. */
  readonly runnerTemp: string
  /** Checked-out repository root. */
  readonly workspace: string
  /** macOS target accepted by the Desktop packager. */
  readonly target: 'mac-arm64' | 'mac-x64'
  /** Whether this run deliberately omits notarization. */
  readonly skipNotarization: boolean
  /** Base64-encoded P12 signing certificate. */
  readonly certificateBase64: string
  /** P12 export password. */
  readonly certificatePassword: string
  /** Apple Developer Team ID. */
  readonly teamId: string
  /** Certificate identity without Electron's Developer ID prefix. */
  readonly signingIdentity: string
  /** Raw Apple API private-key PEM. */
  readonly appleApiKey: string
  /** Apple API key identifier. */
  readonly appleApiKeyId: string
  /** Apple API issuer identifier. */
  readonly appleApiIssuer: string
  /** Optional GitHub Actions output file. */
  readonly outputFile?: string
  /** Optional GitHub Actions environment file. */
  readonly environmentFile?: string
}

/** Private configuration and artifact location produced for one package job. */
export interface PreparedInsightMacOSConfiguration {
  /** Private directory to remove when the job ends. */
  readonly temporaryDirectory: string
  /** Directory selected by DSH_PACKAGING_CONFIG_DIR. */
  readonly packagingConfigDirectory: string
  /** Desktop artifact output for the requested qualification. */
  readonly artifactDirectory: string
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === '') throw new Error(`Insight macOS packaging requires ${name}`)
  if (value.includes('\0') || value.includes('\r') || value.includes('\n')) throw new Error(`Insight macOS packaging rejects line breaks in ${name}`)
  return value
}

function requiredPem(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === '') throw new Error(`Insight macOS packaging requires ${name}`)
  if (value.includes('\0')) throw new Error(`Insight macOS packaging rejects a NUL character in ${name}`)
  return value
}

function credential(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`Insight macOS packaging requires ${name}`)
  if (value.includes('\0') || value.includes('\r') || value.includes('\n')) throw new Error(`Insight macOS packaging rejects line breaks in ${name}`)
  return value
}

function absoluteDirectory(value: string, name: string): string {
  if (!isAbsolute(value) || value.includes('\0')) throw new Error(`Insight macOS packaging requires an absolute ${name}`)
  return resolve(value)
}

function decodeCertificate(value: string): Buffer {
  const source = required(value, 'DESKTOP_CSC_LINK').trim()
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(source)) {
    throw new Error('Insight macOS packaging requires DESKTOP_CSC_LINK to be base64 P12 data')
  }
  const decoded = Buffer.from(source, 'base64')
  if (decoded.length === 0 || decoded.toString('base64') !== source) {
    throw new Error('Insight macOS packaging requires DESKTOP_CSC_LINK to be canonical base64 P12 data')
  }
  return decoded
}

/**
 * Encode a value for Node's dotenv parser without allowing it to change the following setting.
 * @param value - One credential value; an empty P12 password is represented explicitly.
 * @returns Double-quoted dotenv source.
 */
export function quoteDotenvValue(value: string): string {
  credential(value, 'credential value')
  if (value.includes('"')) throw new Error('Insight macOS packaging cannot represent a double quote in a dotenv credential')
  return `"${value}"`
}

function validateInput(input: PrepareInsightMacOSInput): void {
  absoluteDirectory(input.runnerTemp, 'RUNNER_TEMP')
  absoluteDirectory(input.workspace, 'GITHUB_WORKSPACE')
  if (!MACOS_TARGETS.has(input.target)) throw new Error('Insight macOS packaging requires a supported macOS target')
  decodeCertificate(input.certificateBase64)
  credential(input.certificatePassword, 'DESKTOP_CSC_KEY_PASSWORD')
  if (!/^[A-Z0-9]{10}$/u.test(required(input.teamId, 'DESKTOP_APPLE_TEAM_ID'))) {
    throw new Error('Insight macOS packaging requires a ten-character DESKTOP_APPLE_TEAM_ID')
  }
  const identity = required(input.signingIdentity, 'DSH_DESKTOP_MACOS_SIGNING_IDENTITY')
  if (identity.startsWith('Developer ID Application:')) {
    throw new Error('Insight macOS packaging identity must omit the "Developer ID Application:" prefix')
  }
  requiredPem(input.appleApiKey, 'DESKTOP_APPLE_API_KEY')
  required(input.appleApiKeyId, 'DESKTOP_APPLE_API_KEY_ID')
  required(input.appleApiIssuer, 'DESKTOP_APPLE_API_ISSUER')
}

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
}

async function privateFile(path: string, contents: string | Buffer): Promise<void> {
  await writeFile(path, contents, { mode: 0o600 })
  await chmod(path, 0o600)
}

function outputDirectory(workspace: string, target: PrepareInsightMacOSInput['target'], skipNotarization: boolean): string {
  return join(workspace, 'apps', 'desktop', '.desktop-build', 'targets', target, skipNotarization ? 'unnotarized-artifacts' : 'artifacts')
}

/**
 * Materialize private signing and notarization files that DSH's existing package loader consumes.
 * @param input - GitHub Actions environment values and one selected package target.
 * @returns Private paths for DSH_PACKAGING_CONFIG_DIR and the target artifact directory.
 */
export async function prepareInsightMacOSConfiguration(input: PrepareInsightMacOSInput): Promise<PreparedInsightMacOSConfiguration> {
  validateInput(input)
  const runnerTemp = absoluteDirectory(input.runnerTemp, 'RUNNER_TEMP')
  const workspace = absoluteDirectory(input.workspace, 'GITHUB_WORKSPACE')
  const temporaryDirectory = await mkdtemp(join(runnerTemp, TEMPORARY_PREFIX))
  try {
    await chmod(temporaryDirectory, 0o700)
    const packagingConfigDirectory = join(temporaryDirectory, 'config')
    const presets = join(packagingConfigDirectory, 'presets')
    const secrets = join(packagingConfigDirectory, 'secrets')
    await Promise.all([privateDirectory(presets), privateDirectory(secrets)])

    const certificate = join(temporaryDirectory, 'signing-certificate.p12')
    const apiKey = join(temporaryDirectory, 'notarization-api-key.p8')
    await Promise.all([
      privateFile(certificate, decodeCertificate(input.certificateBase64)),
      privateFile(apiKey, input.appleApiKey),
      privateFile(join(presets, 'test.env'), [
        'DSH_DESKTOP_APP_ID=com.insight-aigc.desktop',
        'DSH_DESKTOP_AUTO_UPDATE_ENV=test',
        'DSH_DESKTOP_MACOS_ZIP_COMPRESSION_LEVEL=3',
        '',
      ].join('\n')),
      privateFile(join(secrets, 'macos-signing.env'), [
        `DSH_DESKTOP_MACOS_SIGNING_IDENTITY=${quoteDotenvValue(input.signingIdentity)}`,
        `DSH_DESKTOP_MACOS_TEAM_ID=${input.teamId}`,
        `CSC_LINK=${quoteDotenvValue(certificate)}`,
        `CSC_KEY_PASSWORD=${quoteDotenvValue(input.certificatePassword)}`,
        `APPLE_API_KEY=${quoteDotenvValue(apiKey)}`,
        `APPLE_API_KEY_ID=${quoteDotenvValue(input.appleApiKeyId)}`,
        `APPLE_API_ISSUER=${quoteDotenvValue(input.appleApiIssuer)}`,
        '',
      ].join('\n')),
    ])
    const prepared = {
      temporaryDirectory,
      packagingConfigDirectory,
      artifactDirectory: outputDirectory(workspace, input.target, input.skipNotarization),
    }
    if (input.outputFile !== undefined) {
      await appendFile(input.outputFile, [
        `artifact_directory=${prepared.artifactDirectory}`,
        '',
      ].join('\n'))
    }
    if (input.environmentFile !== undefined) {
      await appendFile(input.environmentFile, [
        `DSH_PACKAGING_CONFIG_DIR=${prepared.packagingConfigDirectory}`,
        `INSIGHT_MACOS_RELEASE_TEMP=${prepared.temporaryDirectory}`,
        '',
      ].join('\n'))
    }
    return prepared
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true })
    throw error
  }
}

/**
 * Remove a private configuration only when it is one of this helper's children of RUNNER_TEMP.
 * @param runnerTemp - GitHub Actions temporary root.
 * @param temporaryDirectory - Directory previously returned by prepareInsightMacOSConfiguration.
 * @returns Resolves after the private files no longer exist.
 */
export async function removeInsightMacOSConfiguration(runnerTemp: string, temporaryDirectory: string): Promise<void> {
  const root = absoluteDirectory(runnerTemp, 'RUNNER_TEMP')
  const candidate = absoluteDirectory(temporaryDirectory, 'INSIGHT_MACOS_RELEASE_TEMP')
  const child = relative(root, candidate)
  if (child === '' || child.startsWith(`..${sep}`) || child === '..' || isAbsolute(child) || !child.startsWith(TEMPORARY_PREFIX)) {
    throw new Error('Insight macOS packaging refuses to remove a directory outside its private RUNNER_TEMP child')
  }
  await rm(candidate, { recursive: true, force: true })
}

function environmentInput(environment: NodeJS.ProcessEnv): PrepareInsightMacOSInput {
  const target = environment.INSIGHT_MACOS_TARGET
  if (target !== 'mac-arm64' && target !== 'mac-x64') throw new Error('Insight macOS packaging requires INSIGHT_MACOS_TARGET')
  return {
    runnerTemp: required(environment.RUNNER_TEMP, 'RUNNER_TEMP'),
    workspace: required(environment.GITHUB_WORKSPACE, 'GITHUB_WORKSPACE'),
    target,
    skipNotarization: environment.INSIGHT_SKIP_NOTARIZATION === 'true',
    certificateBase64: required(environment.DESKTOP_CSC_LINK, 'DESKTOP_CSC_LINK'),
    certificatePassword: credential(environment.DESKTOP_CSC_KEY_PASSWORD, 'DESKTOP_CSC_KEY_PASSWORD'),
    teamId: required(environment.DESKTOP_APPLE_TEAM_ID, 'DESKTOP_APPLE_TEAM_ID'),
    signingIdentity: required(environment.DSH_DESKTOP_MACOS_SIGNING_IDENTITY, 'DSH_DESKTOP_MACOS_SIGNING_IDENTITY'),
    appleApiKey: requiredPem(environment.DESKTOP_APPLE_API_KEY, 'DESKTOP_APPLE_API_KEY'),
    appleApiKeyId: required(environment.DESKTOP_APPLE_API_KEY_ID, 'DESKTOP_APPLE_API_KEY_ID'),
    appleApiIssuer: required(environment.DESKTOP_APPLE_API_ISSUER, 'DESKTOP_APPLE_API_ISSUER'),
    outputFile: required(environment.GITHUB_OUTPUT, 'GITHUB_OUTPUT'),
    environmentFile: required(environment.GITHUB_ENV, 'GITHUB_ENV'),
  }
}

/** Run the GitHub Actions prepare or cleanup operation without exposing credential values. */
export async function main(environment = process.env): Promise<void> {
  const action = environment.INSIGHT_MACOS_CONFIGURATION_ACTION
  if (action === 'prepare') {
    await prepareInsightMacOSConfiguration(environmentInput(environment))
    return
  }
  if (action === 'cleanup') {
    await removeInsightMacOSConfiguration(
      required(environment.RUNNER_TEMP, 'RUNNER_TEMP'),
      required(environment.INSIGHT_MACOS_RELEASE_TEMP, 'INSIGHT_MACOS_RELEASE_TEMP'),
    )
    return
  }
  throw new Error('Insight macOS packaging requires INSIGHT_MACOS_CONFIGURATION_ACTION=prepare or cleanup')
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main()
}
