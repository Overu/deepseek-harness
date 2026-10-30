/** Tests for immutable installer selection in the Insight Windows upgrade qualification. */

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createInsightDesktopBuildManifest, writeInsightDesktopBuildManifest } from './artifacts.ts'
import {
  downloadQualifiedInstaller,
  isInsightWindowsUninstallIdentity,
  resolveLegacyWindowsInstaller,
  serializeNsisCustomInstallArguments,
  selectCollectedWindowsInstaller,
  windowsQualificationArguments,
} from './qualify-windows-upgrade.ts'
import { resolveInsightUpdate } from '../../packages/insight/desktop-integration/src/desktop.ts'
import { inspectInstalledPayload } from './inspect-windows-payload.ts'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const desktopRequire = createRequire(new URL('../../apps/desktop/package.json', import.meta.url))
const builderRequire = createRequire(desktopRequire.resolve('app-builder-lib/package.json'))
const asar = builderRequire('@electron/asar') as { createPackage(source: string, destination: string): Promise<void> }
const execute = promisify(execFile)

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'insight-windows-upgrade-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const filename = 'insight-1.0.10-rc.1-win-x64.exe'
  await writeFile(join(directory, filename), 'rc installer')
  const manifest = await createInsightDesktopBuildManifest({
    artifactDirectory: directory,
    manifestFilename: 'insight-build-win32-x64.json',
    version: '1.0.10-rc.1',
    runtimeVersion: '0.2.2-alpha.2',
    sourceCommit: COMMIT,
    target: 'win32-x64',
    qualification: 'distribution',
    assetFilenames: [filename],
  })
  await writeInsightDesktopBuildManifest(directory, 'insight-build-win32-x64.json', manifest)
  return directory
}

async function resolveFrozenWindowsFixture(documents: Readonly<Record<string, string>>) {
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url
    const encoded = documents[url]
    const response = new Response(encoded === undefined ? undefined : Buffer.from(encoded, 'base64'), { status: encoded === undefined ? 404 : 200 })
    Object.defineProperty(response, 'url', { value: url })
    return response
  }
  return resolveInsightUpdate({
    track: 'stable', target: 'win32-x64', distributionOrigin: 'https://updates.insight-aigc.com',
    publicKeyPem: await readFile(new URL('../../packages/insight/desktop-integration/resources/update/update-signing-public.pem', import.meta.url), 'utf8'),
    fetch,
  })
}

async function installedPayloadFixture(kind: 'empty' | 'raw' | 'asar', version = '1.0.9'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'insight-windows-installed-payload-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'resources'), { recursive: true })
  if (kind === 'raw') {
    await mkdir(join(root, 'resources', 'app'), { recursive: true })
    await writeFile(join(root, 'resources', 'app', 'package.json'), JSON.stringify({ version }))
  }
  if (kind === 'asar') {
    const source = await mkdtemp(join(tmpdir(), 'insight-windows-asar-source-'))
    onTestFinished(() => rm(source, { recursive: true, force: true }))
    await writeFile(join(source, 'package.json'), JSON.stringify({ version }))
    await asar.createPackage(source, join(root, 'resources', 'app.asar'))
  }
  return root
}

describe('Insight Windows upgrade qualification inputs', () => {
  it.skipIf(process.platform !== 'win32')('reads real registry records through PowerShell without dynamic property collisions', async () => {
    const script = fileURLToPath(new URL('./qualify-windows-registry.smoke.ps1', import.meta.url))
    const result = await execute('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', script], {
      windowsHide: true,
      timeout: 30_000,
    })

    expect(result.stdout).toContain('INSIGHT_WINDOWS_REGISTRY_SMOKE records=2 optional=verified collision=verified')
  })

  it('resolves the frozen signed 1.0.9 Windows installer identity', async () => {
    const legacy = await resolveLegacyWindowsInstaller()

    expect(legacy.origin).toBe('https://updates.insight-aigc.com')
    expect(legacy.artifact).toMatchObject({
      platform: 'win32', arch: 'x64', kind: 'nsis', name: 'insight-1.0.9-windows-x64-setup.exe',
    })
    expect(legacy.artifact.size).toBeGreaterThan(0)
    expect(legacy.artifact.sha512).toMatch(/^[A-Za-z0-9+/]{86}==$/u)
  })

  it('rejects a missing or changed frozen Windows updater metadata document', async () => {
    const raw = JSON.parse(await readFile(new URL('../../packages/insight/desktop-integration/tests/fixtures/update-v2-1.0.9.json', import.meta.url), 'utf8')) as {
      documents: Record<string, string>
    }
    const key = 'https://updates.insight-aigc.com/desktop/releases/v1.0.9/targets/win32-x64/latest.yml'
    const missing = Object.fromEntries(Object.entries(raw.documents).filter(([url]) => url !== key))
    await expect(resolveFrozenWindowsFixture(missing)).rejects.toThrow('Updater metadata response')

    const changed = { ...raw.documents, [key]: Buffer.from('changed\n').toString('base64') }
    await expect(resolveFrozenWindowsFixture(changed))
      .rejects.toThrow('Updater metadata bytes')
  })

  it('downloads the legacy installer once only when exact bytes match the signed identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'insight-windows-download-'))
    onTestFinished(() => rm(directory, { recursive: true, force: true }))
    const bytes = Buffer.from('legacy installer')
    const artifact = {
      platform: 'win32' as const, arch: 'x64' as const, kind: 'nsis' as const, name: 'legacy.exe',
      size: bytes.byteLength, sha512: createHash('sha512').update(bytes).digest('base64'),
    }
    const url = new URL('https://updates.example.test/legacy.exe')
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      const response = new Response(bytes)
      Object.defineProperty(response, 'url', { value: url.href })
      return response
    })

    await expect(downloadQualifiedInstaller({ url, artifact, directory, fetch }))
      .resolves.toMatchObject({ size: bytes.byteLength, sha512: artifact.sha512 })
    expect(fetch).toHaveBeenCalledOnce()

    const changedFetch: typeof globalThis.fetch = async () => {
      const response = new Response(Buffer.from('changed'))
      Object.defineProperty(response, 'url', { value: url.href })
      return response
    }
    const changedDirectory = await mkdtemp(join(tmpdir(), 'insight-windows-download-changed-'))
    onTestFinished(() => rm(changedDirectory, { recursive: true, force: true }))
    await expect(downloadQualifiedInstaller({ url, artifact, directory: changedDirectory, fetch: changedFetch }))
      .rejects.toThrow('bytes do not match')
  })

  it('passes the outer qualification cancellation into the installer fetch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'insight-windows-download-aborted-'))
    onTestFinished(() => rm(directory, { recursive: true, force: true }))
    const signal = AbortSignal.abort(new Error('qualification deadline'))
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      init?.signal?.throwIfAborted()
      return new Response()
    })

    await expect(downloadQualifiedInstaller({
      url: new URL('https://updates.example.test/legacy.exe'),
      artifact: { platform: 'win32', arch: 'x64', kind: 'nsis', name: 'legacy.exe', size: 1, sha512: 'x' },
      directory,
      fetch,
      signal,
    })).rejects.toThrow('qualification deadline')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('uses the collected manifest entry rather than finding an arbitrary executable', async () => {
    const directory = await fixture()

    await expect(selectCollectedWindowsInstaller({ directory, version: '1.0.10-rc.1', sourceCommit: COMMIT }))
      .resolves.toMatchObject({ path: join(directory, 'insight-1.0.10-rc.1-win-x64.exe'), version: '1.0.10-rc.1' })
  })

  it('passes both verified installer identities and the absolute deadline to PowerShell', () => {
    const deadline = new Date('2026-10-31T00:00:00.000Z')
    const args = windowsQualificationArguments({
      legacy: { path: 'C:\\fixture\\legacy.exe', version: '1.0.9', size: 41, sha512: 'legacy-sha512' },
      release: { path: 'C:\\fixture\\release.exe', version: '1.0.10-rc.1', size: 43, sha512: 'release-sha512' },
      temporaryDirectory: 'C:\\fixture',
      customInstallRoot: 'C:\\fixture custom install',
      deadline,
    })

    expect(args).toEqual(expect.arrayContaining([
      '-LegacyInstallerSize', '41', '-LegacyInstallerSha512', 'legacy-sha512',
      '-ReleaseInstallerSize', '43', '-ReleaseInstallerSha512', 'release-sha512',
      '-CustomInstallRoot', 'C:\\fixture custom install',
      '-CustomLegacyArguments', '/S /currentuser /D=C:\\fixture custom install',
      '-ProductInstallKey', '3f22a924-0492-54e4-a8a2-dc8902eed971',
      '-ProductUninstallKey', '3f22a924-0492-54e4-a8a2-dc8902eed971',
      '-ProductExecutableName', '因赛AI.exe',
      '-LegacyDisplayName', '因赛AI 1.0.9',
      '-ReleaseDisplayName', '因赛AI 1.0.10-rc.1',
      '-QualificationDeadlineUtc', deadline.toISOString(),
    ]))
    expect(args.at(-1)).toBe(deadline.toISOString())
  })

  it('keeps production and the Windows smoke on the shared two-key NSIS resolver', async () => {
    const [qualification, registry, smoke] = await Promise.all([
      readFile(new URL('./qualify-windows-upgrade.ps1', import.meta.url), 'utf8'),
      readFile(new URL('./qualify-windows-registry.ps1', import.meta.url), 'utf8'),
      readFile(new URL('./qualify-windows-registry.smoke.ps1', import.meta.url), 'utf8'),
    ])

    expect(qualification).toContain('Resolve-QualificationInstallState')
    expect(qualification).toContain('$installPointerKey = "HKCU:\\Software\\$ProductInstallKey"')
    expect(qualification).not.toContain('$_.InstallLocation -ne')
    expect(registry).toContain('function Resolve-QualificationInstallState')
    expect(registry).toContain('function Assert-QualificationInstallAbsent')
    expect(smoke).toContain('Resolve-QualificationInstallState')
    expect(smoke).toContain('Assert-QualificationInstallAbsent')
  })

  it('serializes the custom NSIS /D tail without quoting its path with spaces', () => {
    expect(serializeNsisCustomInstallArguments('C:\\fixture root\\Insight legacy custom'))
      .toBe('/S /currentuser /D=C:\\fixture root\\Insight legacy custom')
    expect(serializeNsisCustomInstallArguments('C:\\fixture root\\Insight legacy custom')).not.toContain('"')
  })

  it.each([
    'relative\\Insight custom',
    'C:\\fixture\\bad"quote',
    'C:\\fixture\\bad\rroot',
    'C:\\fixture\\bad\nroot',
    'C:\\fixture\\bad\0root',
  ])('rejects unsafe NSIS custom root %j', (root) => {
    expect(() => serializeNsisCustomInstallArguments(root)).toThrow('absolute unquoted single-line Windows path')
  })

  it('matches the deployed default uninstall name without treating its ICO display icon as an executable', () => {
    expect(isInsightWindowsUninstallIdentity({
      key: 'legacy-generated-key',
      displayName: '因赛AI 1.0.9',
      displayIcon: 'C:\\Users\\runner\\AppData\\Local\\Programs\\因赛AI\\uninstallerIcon.ico',
    }, '1.0.9', '1.0.10-rc.1')).toBe(true)
    expect(isInsightWindowsUninstallIdentity({
      key: '3F22A924-0492-54E4-A8A2-DC8902EED971',
      displayName: 'unrelated localized text',
      displayIcon: 'C:\\unrelated.ico',
    }, '1.0.9', '1.0.10-rc.1')).toBe(true)
    expect(isInsightWindowsUninstallIdentity({
      key: 'current-key',
      displayName: '因赛AI',
    }, '1.0.9', '1.0.10-rc.1')).toBe(true)
    expect(isInsightWindowsUninstallIdentity({
      key: 'current-versioned-key',
      displayName: '因赛AI 1.0.10-rc.1',
    }, '1.0.9', '1.0.10-rc.1')).toBe(true)
    expect(isInsightWindowsUninstallIdentity({
      key: 'unrelated-key',
      displayName: 'Insight 1.0.9',
      displayIcon: 'C:\\Insight.exe',
    }, '1.0.9', '1.0.10-rc.1')).toBe(false)
    expect(isInsightWindowsUninstallIdentity({
      key: 'unrelated-key',
      displayName: '因赛AI 1.0.8',
    }, '1.0.9', '1.0.10-rc.1')).toBe(false)
  })

  it('accepts only the deployed raw legacy payload and the ASAR release payload', async () => {
    const legacy = await installedPayloadFixture('raw', '1.0.9')
    const release = await installedPayloadFixture('asar', '1.0.10-rc.1')

    await expect(inspectInstalledPayload({ installRoot: legacy, kind: 'raw', expectedVersion: '1.0.9' }))
      .resolves.toBe('1.0.9')
    await expect(inspectInstalledPayload({ installRoot: release, kind: 'asar', expectedVersion: '1.0.10-rc.1' }))
      .resolves.toBe('1.0.10-rc.1')
  })

  it('rejects missing, conflicting, and wrong-version installed payloads', async () => {
    const missing = await installedPayloadFixture('empty')
    await expect(inspectInstalledPayload({ installRoot: missing, kind: 'raw', expectedVersion: '1.0.9' }))
      .rejects.toThrow('missing or has the wrong format')
    const wrongFormat = await installedPayloadFixture('raw', '1.0.9')
    await expect(inspectInstalledPayload({ installRoot: wrongFormat, kind: 'asar', expectedVersion: '1.0.9' }))
      .rejects.toThrow('missing or has the wrong format')

    const conflict = await installedPayloadFixture('asar', '1.0.9')
    await mkdir(join(conflict, 'resources', 'app'), { recursive: true })
    await writeFile(join(conflict, 'resources', 'app', 'package.json'), JSON.stringify({ version: '1.0.9' }))
    await expect(inspectInstalledPayload({ installRoot: conflict, kind: 'raw', expectedVersion: '1.0.9' }))
      .rejects.toThrow('conflicting raw and ASAR')

    const wrongRaw = await installedPayloadFixture('raw', '1.0.8')
    await expect(inspectInstalledPayload({ installRoot: wrongRaw, kind: 'raw', expectedVersion: '1.0.9' }))
      .rejects.toThrow('version does not match')
    const wrongAsar = await installedPayloadFixture('asar', '1.0.10-rc.0')
    await expect(inspectInstalledPayload({ installRoot: wrongAsar, kind: 'asar', expectedVersion: '1.0.10-rc.1' }))
      .rejects.toThrow('version does not match')
  })
})
