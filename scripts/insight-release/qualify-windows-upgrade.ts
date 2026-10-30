/** Qualify the supported current-user upgrade from the deployed Insight 1.0.9 installer. */

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { resolveInsightUpdate, type InsightUpdateArtifact } from '../../packages/insight/desktop-integration/src/desktop.ts'
import { runGate } from '../run-gates.ts'
import { verifyInsightDesktopBuildManifest } from './artifacts.ts'

const LEGACY_VERSION = '1.0.9'
const LEGACY_FIXTURE = new URL('../../packages/insight/desktop-integration/tests/fixtures/update-v2-1.0.9.json', import.meta.url)
const UPDATE_PUBLIC_KEY = new URL('../../packages/insight/desktop-integration/resources/update/update-signing-public.pem', import.meta.url)
const POWERSHELL_SCRIPT = fileURLToPath(new URL('./qualify-windows-upgrade.ps1', import.meta.url))
const PAYLOAD_VERSION_HELPER = fileURLToPath(new URL('./inspect-windows-payload.ts', import.meta.url))
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000
const QUALIFICATION_TIMEOUT_MS = 20 * 60_000
const PRODUCT_NAME = '因赛AI'
const PRODUCT_UNINSTALL_KEY = '3f22a924-0492-54e4-a8a2-dc8902eed971'
const PRODUCT_EXECUTABLE_NAME = '因赛AI.exe'

interface LegacyFixture {
  readonly origin: string
  readonly documents: Readonly<Record<string, string>>
}

/** One selected installer whose bytes have an immutable expected identity. */
export interface QualifiedWindowsInstaller {
  readonly path: string
  readonly version: string
  readonly size: number
  readonly sha512: string
}

/** Registry fields that establish the exact Insight NSIS product identity. */
export interface InsightWindowsUninstallIdentity {
  readonly key: string
  readonly displayName: string
  readonly displayIcon?: string
}

/**
 * Match the stable NSIS key or one exact display name emitted by the deployed and current builders.
 * @param record - Registry identity fields; icon paths do not establish product identity.
 * @param legacyVersion - Deployed version whose default builder display name includes the version.
 * @param releaseVersion - Current release version, accepted for builders using the default display name.
 * @returns Whether the record belongs to the exact Insight product.
 */
export function isInsightWindowsUninstallIdentity(
  record: InsightWindowsUninstallIdentity,
  legacyVersion: string,
  releaseVersion: string,
): boolean {
  const displayNames = new Set([PRODUCT_NAME, `${PRODUCT_NAME} ${legacyVersion}`, `${PRODUCT_NAME} ${releaseVersion}`])
  return record.key.toLocaleLowerCase('en-US') === PRODUCT_UNINSTALL_KEY || displayNames.has(record.displayName)
}

/**
 * Serialize the NSIS-only unquoted `/D` tail without applying ordinary argv quoting.
 * @param customRoot - Owned absolute Windows path selected for the custom legacy case.
 * @returns The exact legacy installer command line with `/D` last.
 * @throws When the path is not absolute or contains a quote, line break, or NUL.
 */
export function serializeNsisCustomInstallArguments(customRoot: string): string {
  if (!win32.isAbsolute(customRoot) || customRoot.includes('"') || /[\0\r\n]/u.test(customRoot)) {
    throw new Error('NSIS custom installation root must be an absolute unquoted single-line Windows path')
  }
  return `/S /currentuser /D=${customRoot}`
}

/**
 * Read the frozen deployed 1.0.9 update metadata through the production trust resolver.
 * @returns The authenticated release origin and Windows NSIS artifact identity.
 */
export async function resolveLegacyWindowsInstaller(): Promise<{
  readonly origin: string
  readonly artifact: InsightUpdateArtifact
}> {
  const raw: unknown = JSON.parse(await readFile(LEGACY_FIXTURE, 'utf8'))
  if (!isLegacyFixture(raw)) throw new Error('Legacy Insight update fixture is invalid')
  const responses = new Map(Object.entries(raw.documents).map(([url, encoded]) => [url, new Uint8Array(Buffer.from(encoded, 'base64'))]))
  const fetch: typeof globalThis.fetch = (input) => {
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url
    const bytes = responses.get(url)
    const response = new Response(bytes === undefined ? undefined : new Uint8Array(bytes).buffer, {
      status: bytes === undefined ? 404 : 200,
    })
    Object.defineProperty(response, 'url', { value: url })
    return Promise.resolve(response)
  }
  const release = await resolveInsightUpdate({
    track: 'stable',
    target: 'win32-x64',
    distributionOrigin: raw.origin,
    publicKeyPem: await readFile(UPDATE_PUBLIC_KEY, 'utf8'),
    fetch,
  })
  if (release.version !== LEGACY_VERSION || release.installerAsset.kind !== 'nsis') {
    throw new Error('Legacy Insight update fixture does not select the 1.0.9 Windows NSIS installer')
  }
  return { origin: raw.origin, artifact: release.installerAsset }
}

/**
 * Download one legacy installer and reject redirect, size, or SHA-512 mismatches before installation.
 * @param input - Signed artifact identity, source URL, private directory, and optional outer cancellation.
 * The five-minute download deadline also applies when no outer cancellation is supplied.
 * @returns The verified local installer identity.
 * @throws When cancellation, transport, redirect, size, or SHA-512 verification fails.
 */
export async function downloadQualifiedInstaller(input: {
  readonly url: URL
  readonly artifact: InsightUpdateArtifact
  readonly directory: string
  readonly fetch?: typeof globalThis.fetch
  readonly signal?: AbortSignal
}): Promise<QualifiedWindowsInstaller> {
  const fetch = input.fetch ?? globalThis.fetch
  const signals = [AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), ...(input.signal === undefined ? [] : [input.signal])]
  const signal = AbortSignal.any(signals)
  const response = await fetch(input.url, {
    redirect: 'error',
    headers: { 'Cache-Control': 'no-cache' },
    signal,
  })
  if (!response.ok || response.redirected || response.url !== input.url.href || response.body === null) {
    throw new Error('Legacy Insight installer download was not a trusted successful same-origin response')
  }
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && declaredLength !== String(input.artifact.size)) {
    throw new Error('Legacy Insight installer response length does not match the signed size')
  }
  const destination = join(input.directory, input.artifact.name)
  const digest = createHash('sha512')
  let size = 0
  const measure = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.byteLength
      if (size > input.artifact.size) {
        done(new Error('Legacy Insight installer exceeds its signed size'))
        return
      }
      digest.update(chunk)
      done(null, chunk)
    },
  })
  try {
    await pipeline(
      Readable.from(readResponseBody(response.body)),
      measure,
      createWriteStream(destination, { flags: 'wx' }),
      { signal },
    )
    const hash = digest.digest('base64')
    if (size !== input.artifact.size || hash !== input.artifact.sha512) {
      throw new Error('Legacy Insight installer bytes do not match the signed update metadata')
    }
    return { path: destination, version: LEGACY_VERSION, size, sha512: hash }
  } catch (error) {
    await rm(destination, { force: true })
    throw error
  }
}

/**
 * Verify a collected RC manifest and select its only Windows NSIS executable without filesystem globbing.
 * @param input - Collected release directory and the selected build identity.
 * @returns The manifest-selected local installer identity.
 */
export async function selectCollectedWindowsInstaller(input: {
  readonly directory: string
  readonly version: string
  readonly sourceCommit: string
}): Promise<QualifiedWindowsInstaller> {
  const manifest = await verifyInsightDesktopBuildManifest({
    artifactDirectory: input.directory,
    manifestFilename: 'insight-build-win32-x64.json',
    expected: { version: input.version, sourceCommit: input.sourceCommit, target: 'win32-x64' },
    purpose: 'github-release',
  })
  const installers = manifest.assets.filter(asset => asset.filename.endsWith('.exe'))
  if (installers.length !== 1) throw new Error('Collected Insight release must contain exactly one Windows installer executable')
  const installer = installers[0]
  if (installer === undefined) throw new Error('Collected Insight Windows installer is missing')
  return { path: join(input.directory, installer.filename), version: manifest.version, size: installer.size, sha512: installer.sha512 }
}

/**
 * Build the shell-free PowerShell argument vector, including the identities rechecked before every installer start.
 * @param input - Verified installers, private fixture root, and the absolute qualification deadline.
 * @returns Arguments for PowerShell 7.
 */
export function windowsQualificationArguments(input: {
  readonly legacy: QualifiedWindowsInstaller
  readonly release: QualifiedWindowsInstaller
  readonly temporaryDirectory: string
  readonly customInstallRoot: string
  readonly deadline: Date
}): string[] {
  return [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', POWERSHELL_SCRIPT,
    '-LegacyInstaller', input.legacy.path,
    '-LegacyVersion', input.legacy.version,
    '-LegacyInstallerSize', String(input.legacy.size),
    '-LegacyInstallerSha512', input.legacy.sha512,
    '-ReleaseInstaller', input.release.path,
    '-ReleaseVersion', input.release.version,
    '-ReleaseInstallerSize', String(input.release.size),
    '-ReleaseInstallerSha512', input.release.sha512,
    '-TemporaryDirectory', input.temporaryDirectory,
    '-CustomInstallRoot', input.customInstallRoot,
    '-CustomLegacyArguments', serializeNsisCustomInstallArguments(input.customInstallRoot),
    '-NodeExecutable', process.execPath,
    '-PayloadVersionHelper', PAYLOAD_VERSION_HELPER,
    '-ProductUninstallKey', PRODUCT_UNINSTALL_KEY,
    '-ProductExecutableName', PRODUCT_EXECUTABLE_NAME,
    '-UnversionedDisplayName', PRODUCT_NAME,
    '-LegacyDisplayName', `${PRODUCT_NAME} ${input.legacy.version}`,
    '-ReleaseDisplayName', `${PRODUCT_NAME} ${input.release.version}`,
    '-QualificationDeadlineUtc', input.deadline.toISOString(),
  ]
}

/**
 * Run the owner-local Windows installation qualification after collection but before artifact upload.
 * @param environment - GitHub-hosted Windows job environment; defaults to the current process environment.
 * @returns A promise that resolves only after both upgrade cases and cleanup succeed.
 * @throws When host validation, artifact verification, either case, cleanup, or the overall deadline fails.
 */
export async function main(environment = process.env): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Insight Windows upgrade qualification requires Windows')
  if (environment.GITHUB_ACTIONS !== 'true' || environment.RUNNER_ENVIRONMENT !== 'github-hosted') {
    throw new Error('Insight Windows upgrade qualification requires a GitHub-hosted runner')
  }
  const releaseDirectory = required(environment.INSIGHT_RELEASE_DIRECTORY, 'INSIGHT_RELEASE_DIRECTORY')
  const version = required(environment.INSIGHT_DESKTOP_VERSION, 'INSIGHT_DESKTOP_VERSION')
  const sourceCommit = required(environment.GITHUB_SHA, 'GITHUB_SHA')
  const temporaryDirectory = required(environment.RUNNER_TEMP, 'RUNNER_TEMP')
  const deadline = new Date(Date.now() + QUALIFICATION_TIMEOUT_MS)
  const signal = AbortSignal.timeout(QUALIFICATION_TIMEOUT_MS)
  const root = await mkdtemp(join(temporaryDirectory, 'insight-windows-upgrade-'))
  const customInstallRoot = `${root}-custom install`
  let outcome: { readonly kind: 'success' } | { readonly kind: 'failure'; readonly error: unknown }
  try {
    const legacy = await resolveLegacyWindowsInstaller()
    const url = new URL(legacy.artifact.name, `${legacy.origin}/desktop/releases/v${LEGACY_VERSION}/targets/win32-x64/`)
    const oldInstaller = await downloadQualifiedInstaller({ url, artifact: legacy.artifact, directory: root, signal })
    const newInstaller = await selectCollectedWindowsInstaller({ directory: releaseDirectory, version, sourceCommit })
    const result = await runGate({
      id: 'insight-windows-upgrade',
      label: 'Insight Windows current-user upgrade qualification',
      displayCommand: 'pwsh.exe -File scripts/insight-release/qualify-windows-upgrade.ps1',
      command: 'pwsh.exe',
      args: windowsQualificationArguments({
        legacy: oldInstaller,
        release: newInstaller,
        temporaryDirectory: root,
        customInstallRoot,
        deadline,
      }),
      streamOutput: true,
    }, signal)
    if (result.aborted === true) throw new Error('Insight Windows upgrade qualification exceeded its overall deadline')
    if (result.status !== 'passed') {
      throw new Error(`Insight Windows upgrade qualification failed (${result.error ?? `exit ${String(result.exitCode)}`})`)
    }
    outcome = { kind: 'success' }
  } catch (error) {
    outcome = { kind: 'failure', error }
  }
  try {
    await rm(root, { recursive: true, force: true })
  } catch (cleanupError) {
    if (outcome.kind === 'failure') {
      throw new AggregateError(
        [outcome.error, cleanupError],
        `Insight Windows upgrade qualification failed: ${errorMessage(outcome.error)}; private temporary cleanup failed: ${errorMessage(cleanupError)}`,
      )
    }
    throw cleanupError
  }
  if (outcome.kind === 'failure') throw outcome.error
}

async function* readResponseBody(body: NonNullable<Response['body']>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader()
  let complete = false
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) {
        complete = true
        return
      }
      yield chunk.value
    }
  } finally {
    if (!complete) await reader.cancel()
    reader.releaseLock()
  }
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === '' || value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    throw new Error(`Insight Windows upgrade qualification requires ${name}`)
  }
  return value
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isLegacyFixture(value: unknown): value is LegacyFixture {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false
  const fixture = value as { origin?: unknown; documents?: unknown }
  return typeof fixture.origin === 'string'
    && fixture.documents !== null
    && !Array.isArray(fixture.documents)
    && typeof fixture.documents === 'object'
    && Object.values(fixture.documents).every(document => typeof document === 'string')
}

if (import.meta.main) await main()
