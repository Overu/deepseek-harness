import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { verifyMacOSDiskImage, verifyMacOSNotarizedApplication } from '../scripts/verify-macos-signature.mjs'

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawnSync: vi.fn(),
}))
afterEach(() => { vi.resetAllMocks() })

const signingIdentity = 'Example Company (TEAMID1234)'
const teamId = 'TEAMID1234'
const environment = {
  DSH_DESKTOP_APP_ID: 'com.example.desktop', DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
  DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN: 'https://policy.example.com',
  DOWNLOAD_PROD_ORIGIN: 'https://updates.example.com',
  DSH_DESKTOP_MACOS_SIGNING_IDENTITY: signingIdentity, DSH_DESKTOP_MACOS_TEAM_ID: teamId,
  DSH_DESKTOP_MACOS_SKIP_NOTARIZATION: '1',
}

function toolResult(details = `Authority=Developer ID Application: ${signingIdentity}\nTeamIdentifier=${teamId}`) {
  vi.mocked(spawnSync).mockReturnValue({
    pid: 1, output: [null, '', details], stdout: '', stderr: details, status: 0, signal: null,
  })
}

const cloudKitInterruption = 'Error Domain=NSURLErrorDomain Code=-1005 The network connection was lost for api.apple-cloudkit.com'

interface CommandResultOptions {
  readonly status?: number | null
  readonly signal?: NodeJS.Signals | null
  readonly stderr?: string
  readonly error?: Error
}

function commandResult({ status = 0, signal = null, stderr = '', error }: CommandResultOptions = {}): SpawnSyncReturns<string> {
  return { pid: 1, output: [null, '', stderr], stdout: '', stderr, status, signal, ...(error === undefined ? {} : { error }) }
}

function queueStaplerResults(...results: readonly SpawnSyncReturns<string>[]): void {
  let index = 0
  vi.mocked(spawnSync).mockImplementation((command: string): SpawnSyncReturns<string> => {
    if (command === '/usr/bin/xcrun') return results[index++] ?? commandResult()
    return commandResult({ stderr: `Authority=Developer ID Application: ${signingIdentity}\nTeamIdentifier=${teamId}` })
  })
}

function withRetryWait(test: (delays: readonly number[]) => void): void {
  const delays: number[] = []
  const spy = vi.spyOn(Atomics, 'wait').mockImplementation((_array, _index, _value, timeout) => {
    if (timeout === undefined) throw new Error('Expected a finite retry delay')
    delays.push(timeout)
    return 'timed-out'
  })
  try {
    test(delays)
  } finally {
    spy.mockRestore()
  }
}

function commands(command: string) {
  return vi.mocked(spawnSync).mock.calls.filter(call => call[0] === command)
}

it('verifies an unnotarized DMG signature and identity without invoking Apple notarization tools', () => {
  toolResult()
  const config = createElectronBuilderConfig(environment, 'darwin', 'arm64')
  expect(config.artifactBuildCompleted({ file: '/fixture/debug.dmg' })).toBeUndefined()
  expect(vi.mocked(spawnSync).mock.calls.map(call => call.slice(0, 2))).toEqual([
    ['/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', '/fixture/debug.dmg']],
    ['/usr/bin/codesign', ['--display', '--verbose=4', '/fixture/debug.dmg']],
  ])
})

it('rejects an unnotarized DMG signed by another team', () => {
  toolResult('Authority=Developer ID Application: Other (OTHERID123)\nTeamIdentifier=OTHERID123')
  const config = createElectronBuilderConfig(environment, 'darwin', 'arm64')
  expect(() => config.artifactBuildCompleted({ file: '/fixture/debug.dmg' })).toThrow(/release identity/u)
})

it('rejects a corrupt unnotarized DMG before inspecting its identity', () => {
  toolResult()
  vi.mocked(spawnSync).mockReturnValueOnce({ pid: 1, output: [null, '', 'invalid signature'],
    stdout: '', stderr: 'invalid signature', status: 1, signal: null })
  const config = createElectronBuilderConfig(environment, 'darwin', 'arm64')
  expect(() => config.artifactBuildCompleted({ file: '/fixture/debug.dmg' })).toThrow(/invalid signature/u)
  expect(spawnSync).toHaveBeenCalledOnce()
})

it('still requires a stapled ticket and Gatekeeper acceptance for release DMGs', () => {
  toolResult()
  verifyMacOSDiskImage('/fixture/release.dmg', { signingIdentity, teamId })
  expect(vi.mocked(spawnSync).mock.calls.map(call => call[0])).toEqual([
    '/usr/bin/codesign', '/usr/bin/codesign', '/usr/bin/xcrun', '/usr/sbin/spctl',
  ])
})

it.each([
  [1, []],
  [2, [2000]],
  [3, [2000, 5000]],
])('accepts a retried CloudKit DMG validation on attempt %i', (attempt, expectedDelays) => {
  withRetryWait((delays) => {
    queueStaplerResults(
      ...Array.from({ length: attempt - 1 }, () => commandResult({ status: 68, stderr: cloudKitInterruption })),
      commandResult(),
    )
    verifyMacOSDiskImage('/fixture/release.dmg', { signingIdentity, teamId })
    expect(commands('/usr/bin/xcrun')).toHaveLength(attempt)
    expect(commands('/usr/sbin/spctl')).toHaveLength(1)
    expect(delays).toEqual(expectedDelays)
  })
})

it('preserves the final CloudKit validation error after all attempts without Gatekeeper assessment', () => {
  withRetryWait((delays) => {
    queueStaplerResults(...Array.from({ length: 3 }, () => commandResult({ status: 68, stderr: cloudKitInterruption })))
    expect(() => { verifyMacOSDiskImage('/fixture/release.dmg', { signingIdentity, teamId }) })
      .toThrow(`desktop macOS signing: stapler validate exited with 68: ${cloudKitInterruption}`)
    expect(commands('/usr/bin/xcrun')).toHaveLength(3)
    expect(commands('/usr/sbin/spctl')).toHaveLength(0)
    expect(delays).toEqual([2000, 5000])
  })
})

it.each([
  ['other stapler status', commandResult({ status: 67, stderr: cloudKitInterruption })],
  ['missing NSURLErrorDomain', commandResult({ status: 68, stderr: 'Code=-1005 api.apple-cloudkit.com' })],
  ['other error code', commandResult({ status: 68, stderr: 'NSURLErrorDomain Code=-1004 api.apple-cloudkit.com' })],
  ['a longer error code prefix', commandResult({ status: 68, stderr: 'NSURLErrorDomain Code=-10050 api.apple-cloudkit.com' })],
  ['an error code suffix', commandResult({ status: 68, stderr: 'NSURLErrorDomain Code=-1005abc api.apple-cloudkit.com' })],
  ['CloudKit host missing', commandResult({ status: 68, stderr: 'NSURLErrorDomain Code=-1005' })],
  ['NSURLErrorDomain -1001', commandResult({ status: 68, stderr: 'NSURLErrorDomain Code=-1001 api.apple-cloudkit.com' })],
  ['NSURLErrorDomain -1009', commandResult({ status: 68, stderr: 'NSURLErrorDomain Code=-1009 api.apple-cloudkit.com' })],
])('does not retry a DMG validation with %s', (_label, result) => {
  withRetryWait((delays) => {
    queueStaplerResults(result)
    expect(() => { verifyMacOSDiskImage('/fixture/release.dmg', { signingIdentity, teamId }) })
      .toThrow('desktop macOS signing: stapler validate exited')
    expect(commands('/usr/bin/xcrun')).toHaveLength(1)
    expect(commands('/usr/sbin/spctl')).toHaveLength(0)
    expect(delays).toEqual([])
  })
})

it('does not retry a DMG validation when xcrun cannot start or is signalled', () => {
  withRetryWait((delays) => {
    queueStaplerResults(commandResult({ error: new Error('xcrun missing') }))
    expect(() => { verifyMacOSDiskImage('/fixture/release.dmg', { signingIdentity, teamId }) })
      .toThrow('desktop macOS signing: could not execute stapler validate: xcrun missing')
    expect(commands('/usr/bin/xcrun')).toHaveLength(1)
    expect(commands('/usr/sbin/spctl')).toHaveLength(0)
    expect(delays).toEqual([])

    vi.mocked(spawnSync).mockReset()
    queueStaplerResults(commandResult({ status: null, signal: 'SIGTERM' }))
    expect(() => { verifyMacOSDiskImage('/fixture/release.dmg', { signingIdentity, teamId }) })
      .toThrow('desktop macOS signing: stapler validate was terminated by SIGTERM')
    expect(commands('/usr/bin/xcrun')).toHaveLength(1)
    expect(commands('/usr/sbin/spctl')).toHaveLength(0)
    expect(delays).toEqual([])
  })
})

it('does not retry a notarized application stapler validation', () => {
  withRetryWait((delays) => {
    queueStaplerResults(commandResult({ status: 68, stderr: cloudKitInterruption }))
    expect(() => { verifyMacOSNotarizedApplication('/fixture/release.app', { signingIdentity, teamId }) })
      .toThrow(`desktop macOS signing: stapler validate exited with 68: ${cloudKitInterruption}`)
    expect(commands('/usr/bin/xcrun')).toHaveLength(1)
    expect(commands('/usr/sbin/spctl')).toHaveLength(0)
    expect(delays).toEqual([])
  })
})
