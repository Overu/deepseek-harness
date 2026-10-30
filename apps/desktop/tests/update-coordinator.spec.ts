import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppUpdater, UpdateInfo } from 'electron-updater'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import { parseDesktopRelease } from '../src/release.ts'
import type { DesktopUpdateState } from '../src/ipc.ts'
import type { DesktopUpdateFeed } from '../src/update-coordinator.ts'
import { DesktopUpdatePreparationError } from '../src/update-error.ts'
import { zh } from '../src/locale.ts'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('electron-updater', () => ({
  default: { autoUpdater: { autoDownload: true, autoInstallOnAppQuit: true } },
}))

const { DesktopUpdateCoordinator } = await import('../src/update-coordinator.ts')

describe('desktop release metadata', () => {
  it('accepts one exact release identity for Electron and dsh', () => {
    expect(parseDesktopRelease({
      schemaVersion: 1,
      version: '1.2.3',
      hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      nodeVersion: '24.17.0',
      pnpmVersion: '11.7.0',
    })).toEqual({
      schemaVersion: 1,
      version: '1.2.3',
      hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      nodeVersion: '24.17.0',
      pnpmVersion: '11.7.0',
    })
  })

  it('rejects invalid versions and unsupported host protocols', () => {
    const base = {
      schemaVersion: 1,
      version: '1.2.3',
      hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      nodeVersion: '24.17.0',
      pnpmVersion: '11.7.0',
    }
    expect(() => parseDesktopRelease({ ...base, version: 'latest' })).toThrow(/invalid desktop release metadata/u)
    expect(() => parseDesktopRelease({ ...base, hostProtocolVersion: 999 })).toThrow(/invalid desktop release metadata/u)
  })
})

const coordinators: InstanceType<typeof DesktopUpdateCoordinator>[] = []
afterEach(() => { for (const item of coordinators.splice(0)) item.dispose() })

function fixture(channel: 'nightly' | 'latest' = 'nightly', version = '1.1.0-alpha.1') {
  const events = new EventEmitter()
  const setFeedURL = vi.fn()
  const checkForUpdates = vi.fn(async () => ({
    isUpdateAvailable: true,
    updateInfo: { version: '1.1.0-rc.2' },
  }))
  const downloadUpdate = vi.fn(async () => {
    events.emit('download-progress', { percent: 58 })
    events.emit('download-progress', { percent: 100 })
    events.emit('update-downloaded', { version: '1.1.0-rc.2' })
    return ['verified-package']
  })
  const quitAndInstall = vi.fn()
  const beforeRestart = vi.fn(async () => true)
  const downloadResult = vi.fn()
  const states: DesktopUpdateState[] = []
  const updater = Object.assign(events, { checkForUpdates, downloadUpdate, quitAndInstall }) as unknown as AppUpdater
  updater.setFeedURL = setFeedURL
  const coordinator = new DesktopUpdateCoordinator(
    (state) => { states.push(state); return state },
    beforeRestart, updater, () => true, () => version, downloadResult, channel,
  )
  coordinators.push(coordinator)
  return { coordinator, updater, events, states, setFeedURL, checkForUpdates, downloadUpdate, quitAndInstall,
    beforeRestart, downloadResult }
}

class TestUpdateProvider {
  readonly options: object
  constructor(options: object) { this.options = options }
}

function feed(id: string, allowPrerelease: boolean): DesktopUpdateFeed {
  return { id, allowPrerelease, options: { provider: 'custom', updateProvider: TestUpdateProvider } }
}

function updateInfo(version: string, name = 'insight.zip', sha512 = 'signed-sha512', size = 42): UpdateInfo {
  return { version, files: [{ url: name, sha512, size }], path: name, sha512, releaseDate: '2026-10-30T00:00:00.000Z' }
}

describe('desktop update coordinator', () => {
  it.each(['stop-failed', 'fullscreen-timeout'] as const)('keeps safe %s diagnostics separate and clears them on an explicit retry', async (kind) => {
    const f = fixture()
    await f.coordinator.check()
    await f.coordinator.download('1.1.0-rc.2')
    f.beforeRestart.mockRejectedValueOnce(new DesktopUpdatePreparationError(kind, zh.updateStopFailed, 'exit 0; shutdown acknowledged false'))
    expect(await f.coordinator.install('1.1.0-rc.2')).toEqual({ phase: 'error', version: '1.1.0-rc.2',
      failedOperation: 'install', preparationFailure: kind, message: zh.updateStopFailed,
      technicalDetails: 'exit 0; shutdown acknowledged false' })
    expect(f.quitAndInstall).not.toHaveBeenCalled()
    f.beforeRestart.mockResolvedValueOnce(false)
    expect(await f.coordinator.install('1.1.0-rc.2')).toEqual({ phase: 'ready', version: '1.1.0-rc.2' })
    expect(f.quitAndInstall).not.toHaveBeenCalled()
  })

  it('retains an asynchronous installer failure after quitAndInstall returns', async () => {
    const f = fixture()
    await f.coordinator.check()
    await f.coordinator.download('1.1.0-rc.2')
    await f.coordinator.install('1.1.0-rc.2')
    f.events.emit('error', new Error('installer could not start'))
    expect(f.coordinator.state).toMatchObject({ phase: 'error', failedOperation: 'install', message: 'installer could not start' })
  })

  it('waits for platform preparation after its downloaded event and rejects stale download approval', async () => {
    const f = fixture()
    const prepared = Promise.withResolvers<string[]>()
    f.downloadUpdate.mockImplementationOnce(async () => {
      f.events.emit('update-downloaded', { version: '1.1.0-rc.2' })
      return prepared.promise
    })
    await f.coordinator.check()
    await expect(f.coordinator.download('1.1.0-rc.1')).rejects.toThrow(/stale/u)
    const downloading = f.coordinator.download('1.1.0-rc.2')
    await Promise.resolve()
    await Promise.resolve()
    try {
      expect(f.coordinator.state.phase).not.toBe('ready')
      await expect(f.coordinator.install('1.1.0-rc.2')).rejects.toThrow(/not ready/u)
    } finally { prepared.resolve(['verified']); await downloading }
    expect(f.coordinator.state.phase).toBe('ready')
  })

  it('consumes late updater errors until an in-flight check settles after disposal', async () => {
    const f = fixture()
    const checked = Promise.withResolvers<{ isUpdateAvailable: boolean; updateInfo: { version: string } }>()
    f.checkForUpdates.mockImplementation(() => checked.promise)
    const pending = f.coordinator.check()
    await Promise.resolve()
    f.coordinator.dispose()
    expect(() => f.events.emit('error', new Error('late network failure'))).not.toThrow()
    checked.reject(new Error('offline'))
    await pending
    await Promise.resolve()
    expect(f.events.listenerCount('error')).toBe(0)
  })

  it('checks, downloads on demand, then requires separate installation approval', async () => {
    const f = fixture()
    await f.coordinator.check()
    expect(f.downloadUpdate).not.toHaveBeenCalled()
    await expect(f.coordinator.install('1.1.0-rc.2')).rejects.toThrow(/not ready/u)
    await f.coordinator.download('1.1.0-rc.2')
    expect(f.quitAndInstall).not.toHaveBeenCalled()
    expect(f.beforeRestart).not.toHaveBeenCalled()
    expect(f.coordinator.state).toEqual({ phase: 'ready', version: '1.1.0-rc.2' })
    await f.coordinator.install('1.1.0-rc.2')
    expect(f.beforeRestart).toHaveBeenCalledOnce()
    expect(f.quitAndInstall).toHaveBeenCalledWith(true, true)
    expect(f.states.map(state => state.phase)).toEqual([
      'available', 'downloading', 'downloading', 'verifying', 'ready', 'installing',
    ])
    expect(f.updater).toMatchObject({
      autoDownload: false, autoInstallOnAppQuit: false, channel: 'nightly',
      allowPrerelease: true, allowDowngrade: false,
    })
  })

  it('joins checks and downloads without retargeting a prepared release', async () => {
    const f = fixture()
    const checked = Promise.withResolvers<{ isUpdateAvailable: boolean; updateInfo: { version: string } }>()
    f.checkForUpdates.mockImplementation(() => checked.promise)
    const checking = f.coordinator.check()
    const manual = f.coordinator.check(true)
    const firstDownload = f.coordinator.download('1.1.0-rc.2')
    const secondDownload = f.coordinator.download('1.1.0-rc.2')
    checked.resolve({ isUpdateAvailable: true, updateInfo: { version: '1.1.0-rc.2' } })
    await Promise.all([checking, manual, firstDownload, secondDownload])
    expect(f.checkForUpdates).toHaveBeenCalledOnce()
    expect(f.downloadUpdate).toHaveBeenCalledOnce()
    await f.coordinator.check(true)
    expect(f.checkForUpdates).toHaveBeenCalledOnce()
    await expect(f.coordinator.install('1.2.0')).rejects.toThrow(/not ready/u)
  })

  it('serializes a manual check for a different custom feed after the active check', async () => {
    const f = fixture('latest', '1.0.9')
    const stable = feed('insight-stable', false)
    const candidate = feed('insight-candidate', true)
    const stableResult = Promise.withResolvers<{ isUpdateAvailable: boolean; updateInfo: UpdateInfo }>()
    f.checkForUpdates
      .mockImplementationOnce(() => stableResult.promise)
      .mockResolvedValueOnce({ isUpdateAvailable: true, updateInfo: updateInfo('1.0.10-rc.1') })

    const automatic = f.coordinator.check(false, stable)
    await Promise.resolve()
    const manual = f.coordinator.check(true, candidate)
    expect(f.setFeedURL).toHaveBeenCalledTimes(1)
    stableResult.resolve({ isUpdateAvailable: true, updateInfo: updateInfo('1.0.10') })

    await expect(automatic).resolves.toEqual({ phase: 'available', version: '1.0.10' })
    await expect(manual).resolves.toEqual({ phase: 'available', version: '1.0.10-rc.1' })
    expect(f.setFeedURL.mock.calls.map(([options]) => options)).toEqual([stable.options, candidate.options])
    expect(f.updater).toMatchObject({ allowPrerelease: true, allowDowngrade: false })
  })

  it('does not let an automatic stable check replace an in-flight or selected candidate feed', async () => {
    const f = fixture('latest', '1.0.9')
    const stable = feed('insight-stable', false)
    const candidate = feed('insight-candidate', true)
    const candidateResult = Promise.withResolvers<{ isUpdateAvailable: boolean; updateInfo: UpdateInfo }>()
    f.checkForUpdates.mockImplementationOnce(() => candidateResult.promise)

    const manual = f.coordinator.check(true, candidate)
    await Promise.resolve()
    const automatic = f.coordinator.check(false, stable)
    candidateResult.resolve({ isUpdateAvailable: true, updateInfo: updateInfo('1.0.10-rc.1') })

    await expect(Promise.all([manual, automatic])).resolves.toEqual([
      { phase: 'available', version: '1.0.10-rc.1' },
      { phase: 'available', version: '1.0.10-rc.1' },
    ])
    await expect(f.coordinator.check(false, stable)).resolves.toEqual({ phase: 'available', version: '1.0.10-rc.1' })
    expect(f.setFeedURL).toHaveBeenCalledExactlyOnceWith(candidate.options)
    expect(f.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('does not authorize a same-version asset from a queued replacement feed', async () => {
    const f = fixture('latest', '1.0.9')
    const first = feed('insight-first', true)
    const replacement = feed('insight-replacement', true)
    const firstResult = Promise.withResolvers<{ isUpdateAvailable: boolean; updateInfo: UpdateInfo }>()
    const replacementResult = Promise.withResolvers<{ isUpdateAvailable: boolean; updateInfo: UpdateInfo }>()
    f.checkForUpdates
      .mockImplementationOnce(() => firstResult.promise)
      .mockImplementationOnce(() => replacementResult.promise)

    const automatic = f.coordinator.check(false, first)
    await Promise.resolve()
    const manual = f.coordinator.check(true, replacement)
    firstResult.resolve({ isUpdateAvailable: true, updateInfo: updateInfo('1.0.10-rc.1', 'first.zip', 'first-sha512') })
    await automatic
    const staleDownload = f.coordinator.download('1.0.10-rc.1')
    replacementResult.resolve({
      isUpdateAvailable: true,
      updateInfo: updateInfo('1.0.10-rc.1', 'replacement.zip', 'replacement-sha512'),
    })
    await manual

    await expect(staleDownload).rejects.toThrow(/stale/u)
    expect(f.downloadUpdate).not.toHaveBeenCalled()
  })

  it('binds custom-feed download readiness to the checked asset identity', async () => {
    const f = fixture('latest', '1.0.9')
    const candidate = feed('insight-candidate', true)
    const checked = updateInfo('1.0.10-rc.1')
    f.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: true, updateInfo: checked })
    f.downloadUpdate.mockImplementationOnce(async () => {
      f.events.emit('update-downloaded', updateInfo('1.0.10-rc.1', 'insight.zip', 'replaced-sha512'))
      return ['replaced-package']
    })
    await f.coordinator.check(true, candidate)

    await expect(f.coordinator.download('1.0.10-rc.1')).resolves.toMatchObject({ phase: 'error', failedOperation: 'download' })
    f.downloadUpdate.mockImplementationOnce(async () => {
      f.events.emit('update-downloaded', checked)
      return ['verified-package']
    })
    await expect(f.coordinator.download('1.0.10-rc.1')).resolves.toEqual({ phase: 'ready', version: '1.0.10-rc.1' })
  })

  it('dismisses only the matching idle available target and permits a later feed', async () => {
    const f = fixture('latest', '1.0.9')
    const candidate = feed('insight-candidate', true)
    const stable = feed('insight-stable', false)
    const pending = Promise.withResolvers<{ isUpdateAvailable: boolean; updateInfo: UpdateInfo }>()
    f.checkForUpdates.mockImplementationOnce(() => pending.promise)
    const checking = f.coordinator.check(true, candidate)
    await Promise.resolve()
    expect(() => f.coordinator.dismissAvailable('1.0.10-rc.1')).toThrow(/while checking/u)
    pending.resolve({ isUpdateAvailable: true, updateInfo: updateInfo('1.0.10-rc.1') })
    await checking

    expect(() => f.coordinator.dismissAvailable('1.0.10-rc.2')).toThrow(/does not match/u)
    expect(f.coordinator.dismissAvailable('1.0.10-rc.1')).toEqual({ phase: 'idle' })
    f.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: false, updateInfo: updateInfo('1.0.9') })
    await expect(f.coordinator.check(false, stable)).resolves.toEqual({ phase: 'idle' })
    expect(f.setFeedURL.mock.calls.map(([options]) => options)).toEqual([candidate.options, stable.options])
  })

  it('refuses dismissal while downloading, ready, or installing', async () => {
    const f = fixture()
    await f.coordinator.check()
    const downloaded = Promise.withResolvers<undefined>()
    f.downloadUpdate.mockImplementationOnce(async () => {
      await downloaded.promise
      f.events.emit('update-downloaded', { version: '1.1.0-rc.2' })
      return ['verified-package']
    })
    const downloading = f.coordinator.download('1.1.0-rc.2')
    await Promise.resolve()
    expect(() => f.coordinator.dismissAvailable('1.1.0-rc.2')).toThrow(/download or prepared/u)
    downloaded.resolve(undefined)
    await downloading
    expect(() => f.coordinator.dismissAvailable('1.1.0-rc.2')).toThrow(/download or prepared/u)

    const restart = Promise.withResolvers<boolean>()
    f.beforeRestart.mockImplementationOnce(() => restart.promise)
    const installing = f.coordinator.install('1.1.0-rc.2')
    await Promise.resolve()
    expect(() => f.coordinator.dismissAvailable('1.1.0-rc.2')).toThrow(/download or prepared/u)
    restart.resolve(false)
    await installing
  })

  it('retains the official feed behavior when no custom feed is supplied', async () => {
    const f = fixture()
    await f.coordinator.check()
    await f.coordinator.check()
    expect(f.setFeedURL).not.toHaveBeenCalled()
    expect(f.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('keeps automatic failures silent and exposes a manual caller joining the same check', async () => {
    const f = fixture()
    f.checkForUpdates.mockRejectedValue(new Error('offline'))
    expect(await f.coordinator.check()).toMatchObject({ phase: 'error', failedOperation: 'check' })
    expect(f.states).toEqual([])
    await Promise.all([f.coordinator.check(), f.coordinator.check(true)])
    expect(f.states).toEqual([expect.objectContaining({ phase: 'error', failedOperation: 'check' })])
    expect(f.downloadUpdate).not.toHaveBeenCalled()
  })

  it.each(['1.0.0', '1.1.0-alpha.1', 'invalid'])('does not download or install inapplicable version %s', async (version) => {
    const f = fixture()
    f.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version } })
    await f.coordinator.check()
    await expect(f.coordinator.download('1.1.0-rc.2')).rejects.toThrow(/no checked update/u)
    expect(f.downloadUpdate).not.toHaveBeenCalled()
  })

  it('retains retry state after download failure and never equates 100 percent with readiness', async () => {
    const f = fixture()
    f.downloadUpdate.mockImplementationOnce(async () => {
      f.events.emit('download-progress', { percent: 100 })
      throw new Error('signature rejected')
    })
    await f.coordinator.check()
    expect(await f.coordinator.download('1.1.0-rc.2')).toMatchObject({ phase: 'error', failedOperation: 'download' })
    await expect(f.coordinator.install('1.1.0-rc.2')).rejects.toThrow(/not ready/u)
    await f.coordinator.download('1.1.0-rc.2')
    expect(f.coordinator.state.phase).toBe('ready')
    expect(f.quitAndInstall).not.toHaveBeenCalled()
  })

  it('refuses handoff after failed task preparation while retaining the prepared package', async () => {
    const f = fixture()
    f.beforeRestart.mockRejectedValueOnce(new Error('tasks could not stop'))
    await f.coordinator.check()
    await f.coordinator.download('1.1.0-rc.2')
    expect(await f.coordinator.install('1.1.0-rc.2')).toMatchObject({ phase: 'error', failedOperation: 'install' })
    expect(f.quitAndInstall).not.toHaveBeenCalled()
    await f.coordinator.install('1.1.0-rc.2')
    expect(f.downloadUpdate).toHaveBeenCalledOnce()
    expect(f.quitAndInstall).toHaveBeenCalledOnce()
  })

  it('does not publish late check completion after disposal', async () => {
    const f = fixture('latest', '1.0.9')
    const candidate = feed('insight-candidate', true)
    const checked = Promise.withResolvers<{ isUpdateAvailable: boolean; updateInfo: UpdateInfo }>()
    f.checkForUpdates.mockImplementation(() => checked.promise)
    const pending = f.coordinator.check(false, candidate)
    await Promise.resolve()
    f.coordinator.dispose()
    checked.resolve({ isUpdateAvailable: true, updateInfo: updateInfo('1.0.10-rc.1') })
    await pending
    expect(f.states).toEqual([])
    expect(f.setFeedURL).toHaveBeenCalledExactlyOnceWith(candidate.options)
    expect(f.events.listenerCount('download-progress')).toBe(0)
  })
})


it('reports one download result when callers share an operation and none for cached readiness', async () => {
  const f = fixture()
  await f.coordinator.check()
  await Promise.all([f.coordinator.download('1.1.0-rc.2'), f.coordinator.download('1.1.0-rc.2')])
  await f.coordinator.download('1.1.0-rc.2')
  expect(f.downloadResult).toHaveBeenCalledExactlyOnceWith(true)
})


it.each([new DesktopUpdatePreparationError('stop-failed', 'private diagnostic'), new Error('private URL')])('reports safe download failure classification: %s', async (error) => {
  const f = fixture()
  await f.coordinator.check()
  f.downloadUpdate.mockRejectedValueOnce(error)
  await f.coordinator.download('1.1.0-rc.2')
  expect(f.downloadResult).toHaveBeenCalledExactlyOnceWith(false, error instanceof DesktopUpdatePreparationError ? 'stop-failed' : 'download_failed')
  expect(JSON.stringify(f.downloadResult.mock.calls)).not.toContain('private')
})


it('keeps a stable-version nightly installation on nightly and rejects prereleases on latest', async () => {
  const nightly = fixture('nightly', '1.0.0')
  expect(nightly.updater.channel).toBe('nightly')
  expect(nightly.updater.allowPrerelease).toBe(true)
  expect((await nightly.coordinator.check()).phase).toBe('available')
  expect(nightly.updater.channel).toBe('nightly')
  const latest = fixture('latest', '1.0.0')
  expect(latest.updater.channel).toBe('latest')
  expect(latest.updater.allowPrerelease).toBe(false)
  expect(latest.updater.allowDowngrade).toBe(false)
  expect((await latest.coordinator.check()).phase).toBe('error')
  expect(latest.downloadUpdate).not.toHaveBeenCalled()
})
