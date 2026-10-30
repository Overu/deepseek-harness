/** Product update policy keeps automatic, optional, and candidate actions distinct. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createInsightUpdateController, type InsightNativeUpdateState } from '../src/desktop/update/controller.ts'
import { InsightUpdateStateStore } from '../src/desktop/update/state.ts'
import type { ResolvedInsightUpdate } from '../src/desktop/update/source.ts'

const temporary: string[] = []
const payload = {
  platform: 'darwin' as const,
  arch: 'arm64' as const,
  kind: 'zip' as const,
  name: 'update.zip',
  size: 1,
  sha512: 'a'.repeat(86) + '==',
}

async function store(): Promise<InsightUpdateStateStore> {
  const directory = await mkdtemp(join(tmpdir(), 'insight-update-controller-'))
  temporary.push(directory)
  return new InsightUpdateStateStore(directory)
}

function release(
  track: 'stable' | 'candidate',
  mode: 'optional' | 'required' = 'optional',
  minimumSupportedVersion = '1.0.9',
): ResolvedInsightUpdate {
  return {
    version: track === 'stable' ? '1.0.10' : '1.0.10-rc.1', sourceCommit: 'a'.repeat(40), track,
    policy: { mode, minimumSupportedVersion }, releaseBaseUrl: new URL('https://updates.example.test/'),
    metadataAsset: { ...payload, kind: 'updater-metadata', name: 'latest-mac.yml' }, payloadAsset: payload, installerAsset: { ...payload, kind: 'dmg', name: 'update.dmg' },
    metadata: { version: track === 'stable' ? '1.0.10' : '1.0.10-rc.1', files: [{ url: 'update.zip', sha512: payload.sha512, size: 1 }], path: 'update.zip', sha512: payload.sha512 },
    identityFingerprint: 'b'.repeat(64),
  }
}

afterEach(async () => { await Promise.all(temporary.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

describe('Insight update controller', () => {
  it('checks only stable automatically and suppresses a skipped optional version', async () => {
    const state: InsightNativeUpdateState = { phase: 'idle' }
    const calls: Array<{ track: string; manual: boolean }> = []
    const durable = await store()
    await durable.skip('1.0.10')
    const coordinator = {
      get state() { return state },
      async check(track: 'stable' | 'candidate', manual: boolean) {
        calls.push({ track, manual })
        return { phase: 'available' as const, version: '1.0.10' }
      },
      async download(version: string) { return { phase: 'ready' as const, version } },
      async install(version: string) { return { phase: 'installing' as const, version } },
      dismissAvailable: () => ({ phase: 'idle' as const }),
    }
    const controller = createInsightUpdateController({
      currentVersion: '1.0.9', store: durable, coordinator,
      resolved: track => release(track), confirmCandidate: async () => true,
      openFullInstaller: async () => {}, publish: () => {}, report: () => {},
    })
    await controller.automaticCheck()
    expect(calls).toEqual([{ track: 'stable', manual: false }])
    expect(controller.snapshot.phase).toBe('idle')
  })

  it('requires native consent for candidates and never starts candidate checks automatically', async () => {
    const durable = await store()
    const calls: string[] = []
    let confirmed = false
    const coordinator = {
      state: { phase: 'idle' as const },
      async check(track: 'stable' | 'candidate') {
        calls.push(track)
        return { phase: 'idle' as const }
      },
      async download(version: string) { return { phase: 'ready' as const, version } },
      async install(version: string) { return { phase: 'installing' as const, version } },
      dismissAvailable: () => ({ phase: 'idle' as const }),
    }
    const controller = createInsightUpdateController({
      currentVersion: '1.0.9', store: durable, coordinator,
      resolved: track => release(track), confirmCandidate: async () => confirmed,
      openFullInstaller: async () => {}, publish: () => {}, report: () => {},
    })
    await controller.automaticCheck()
    await controller.checkCandidate()
    confirmed = true
    await controller.checkCandidate()
    expect(calls).toEqual(['stable', 'candidate'])
    await expect(durable.readPreferences()).resolves.toEqual({ schema: 1, candidateOptIn: true })
  })

  it('requires an update only below the signed minimum supported version', async () => {
    const durable = await store()
    let minimum = '1.0.9'
    const calls: string[] = []
    const coordinator = {
      state: { phase: 'idle' as const },
      async check(track: 'stable' | 'candidate') {
        calls.push(track)
        return { phase: 'available' as const, version: '1.0.10' }
      },
      async download(version: string) { return { phase: 'ready' as const, version } },
      async install(version: string) { return { phase: 'installing' as const, version } },
      dismissAvailable: () => ({ phase: 'idle' as const }),
    }
    const controller = createInsightUpdateController({
      currentVersion: '1.0.9', store: durable, coordinator,
      resolved: track => release(track, 'required', minimum), confirmCandidate: async () => true,
      openFullInstaller: async () => {}, publish: () => {}, report: () => {},
    })
    await controller.checkStable()
    expect(controller.snapshot.required).toBe(false)
    await controller.skip('1.0.10')
    minimum = '1.0.10'
    await controller.checkStable()
    expect(controller.snapshot.required).toBe(true)
    await controller.checkCandidate()
    expect(calls).toEqual(['stable', 'stable'])
  })

  it('suppresses a skipped required-policy release when the current version satisfies its minimum', async () => {
    const durable = await store()
    await durable.skip('1.0.10')
    const coordinator = {
      state: { phase: 'idle' as const },
      async check() { return { phase: 'available' as const, version: '1.0.10' } },
      async download(version: string) { return { phase: 'ready' as const, version } },
      async install(version: string) { return { phase: 'installing' as const, version } },
      dismissAvailable: () => ({ phase: 'idle' as const }),
    }
    const controller = createInsightUpdateController({
      currentVersion: '1.0.10', store: durable, coordinator,
      resolved: track => release(track, 'required', '1.0.10'), confirmCandidate: async () => true,
      openFullInstaller: async () => {}, publish: () => {}, report: () => {},
    })
    await controller.automaticCheck()
    expect(controller.snapshot).toMatchObject({ phase: 'idle', required: false })
  })

  it('does not expose a native availability callback while automatic skip lookup is pending', async () => {
    let resolveSkipped!: (value: string | undefined) => void
    const skipped = new Promise<string | undefined>((resolve) => { resolveSkipped = resolve })
    let downloads = 0
    let dismissals = 0
    const nativeCallbacks: { updateState: (state: InsightNativeUpdateState) => void } = { updateState: () => {} }
    const coordinator = {
      state: { phase: 'idle' as const },
      async check() {
        nativeCallbacks.updateState({ phase: 'available', version: '1.0.10' })
        return { phase: 'available' as const, version: '1.0.10' }
      },
      async download(version: string) { downloads += 1; return { phase: 'ready' as const, version } },
      async install(version: string) { return { phase: 'installing' as const, version } },
      dismissAvailable: () => { dismissals += 1; return { phase: 'idle' as const } },
    }
    const controller = createInsightUpdateController({
      currentVersion: '1.0.9', coordinator,
      store: { enableCandidate: async () => {}, skippedVersion: async () => skipped, skip: async () => {} },
      resolved: track => release(track), confirmCandidate: async () => true,
      openFullInstaller: async () => {}, publish: () => {}, report: () => {},
    })
    nativeCallbacks.updateState = (state) => { controller.updateState(state) }
    const checking = controller.automaticCheck()
    await Promise.resolve()
    await controller.download()
    expect(controller.snapshot.phase).toBe('checking')
    expect(downloads).toBe(0)
    resolveSkipped('1.0.10')
    await checking
    expect({ dismissals, phase: controller.snapshot.phase }).toEqual({ dismissals: 1, phase: 'idle' })
  })

  it('queues an explicit candidate check behind an in-flight optional stable check', async () => {
    let finishStable!: (state: InsightNativeUpdateState) => void
    const calls: string[] = []
    const coordinator = {
      state: { phase: 'idle' as const },
      check(track: 'stable' | 'candidate') {
        calls.push(track)
        if (track === 'stable') return new Promise<InsightNativeUpdateState>((resolve) => { finishStable = resolve })
        return Promise.resolve({ phase: 'available' as const, version: '1.0.10-rc.1' })
      },
      async download(version: string) { return { phase: 'ready' as const, version } },
      async install(version: string) { return { phase: 'installing' as const, version } },
      dismissAvailable: () => ({ phase: 'idle' as const }),
    }
    const controller = createInsightUpdateController({
      currentVersion: '1.0.9',
      store: { enableCandidate: async () => {}, skippedVersion: async () => undefined, skip: async () => {} },
      coordinator, resolved: track => release(track), confirmCandidate: async () => true,
      openFullInstaller: async () => {}, publish: () => {}, report: () => {},
    })
    const stable = controller.checkStable()
    const candidate = controller.checkCandidate()
    await Promise.resolve()
    finishStable({ phase: 'available', version: '1.0.10' })
    await Promise.all([stable, candidate])
    expect(calls).toEqual(['stable', 'candidate'])
    expect(controller.snapshot).toMatchObject({ track: 'candidate', version: '1.0.10-rc.1' })
  })

  it('binds skip, download, and full installer to the displayed verified version', async () => {
    const durable = await store()
    const errors: unknown[] = []
    const opened: ResolvedInsightUpdate[] = []
    const coordinator = {
      state: { phase: 'idle' as const },
      async check() { return { phase: 'available' as const, version: '1.0.10' } },
      async download(version: string) { return { phase: 'ready' as const, version } },
      async install(version: string) { return { phase: 'installing' as const, version } },
      dismissAvailable: () => ({ phase: 'idle' as const }),
    }
    const controller = createInsightUpdateController({
      currentVersion: '1.0.9', store: durable, coordinator,
      resolved: track => release(track), confirmCandidate: async () => true,
      openFullInstaller: async (value) => { opened.push(value) }, publish: () => {},
      report: (error) => { errors.push(error) },
    })
    await controller.checkStable()
    await controller.skip('1.0.11')
    expect(errors).toHaveLength(1)
    await controller.checkStable()
    await controller.fullInstaller()
    expect(opened).toHaveLength(1)
    await controller.download()
    expect(controller.snapshot.phase).toBe('ready')
    await controller.install()
    expect(controller.snapshot.phase).toBe('installing')
  })

  it('lets skip reserve the target before its durable write so download cannot race it', async () => {
    let completeSkip!: () => void
    const skipped = new Promise<void>((resolve) => { completeSkip = resolve })
    let downloads = 0
    let dismissals = 0
    const coordinator = {
      state: { phase: 'idle' as const },
      async check() { return { phase: 'available' as const, version: '1.0.10' } },
      async download(version: string) { downloads += 1; return { phase: 'ready' as const, version } },
      async install(version: string) { return { phase: 'installing' as const, version } },
      dismissAvailable: () => { dismissals += 1; return { phase: 'idle' as const } },
    }
    const controller = createInsightUpdateController({ currentVersion: '1.0.9', coordinator,
      store: {
        enableCandidate: async () => {}, skippedVersion: async () => undefined,
        skip: async () => skipped,
      },
      resolved: track => release(track), confirmCandidate: async () => true,
      openFullInstaller: async () => {}, publish: () => {}, report: () => {},
    })
    await controller.checkStable()
    const skip = controller.skip('1.0.10')
    const download = controller.download()
    completeSkip()
    await Promise.all([skip, download])
    expect({ downloads, dismissals, phase: controller.snapshot.phase }).toEqual({ downloads: 0, dismissals: 1, phase: 'idle' })
  })

  it('never opens a full installer for a Windows payload', async () => {
    const durable = await store()
    const windows = {
      ...release('stable'),
      payloadAsset: {
        ...payload, platform: 'win32' as const, arch: 'x64' as const, kind: 'nsis' as const, name: 'setup.exe',
      },
      installerAsset: {
        ...payload, platform: 'win32' as const, arch: 'x64' as const, kind: 'nsis' as const, name: 'setup.exe',
      },
    }
    let opened = 0
    const coordinator = {
      state: { phase: 'idle' as const },
      async check() { return { phase: 'available' as const, version: '1.0.10' } },
      async download(version: string) { return { phase: 'ready' as const, version } },
      async install(version: string) { return { phase: 'installing' as const, version } },
      dismissAvailable: () => ({ phase: 'idle' as const }),
    }
    const controller = createInsightUpdateController({
      currentVersion: '1.0.9', store: durable, coordinator,
      resolved: () => windows, confirmCandidate: async () => true,
      openFullInstaller: async () => { opened += 1 }, publish: () => {}, report: () => {},
    })
    await controller.checkStable()
    await controller.fullInstaller()
    expect(opened).toBe(0)
  })

  it('retains the version-matched verified release when the native adapter reports an unsupported OS', async () => {
    const durable = await store()
    const coordinator = {
      state: { phase: 'idle' as const },
      async check() { return { phase: 'unsupported' as const, version: '1.0.10', message: '需要更新 macOS' } },
      async download(version: string) { return { phase: 'ready' as const, version } },
      async install(version: string) { return { phase: 'installing' as const, version } },
      dismissAvailable: () => ({ phase: 'idle' as const }),
    }
    const controller = createInsightUpdateController({
      currentVersion: '1.0.9', store: durable, coordinator,
      resolved: track => release(track), confirmCandidate: async () => true,
      openFullInstaller: async () => {}, publish: () => {}, report: () => {},
    })
    await controller.checkStable()
    expect(controller.snapshot).toMatchObject({ phase: 'unsupported', version: '1.0.10', canDownloadFullInstaller: false })
  })

  it('does not publish after disposal', async () => {
    const durable = await store()
    let resolveCheck!: (value: InsightNativeUpdateState) => void
    let published = 0
    const coordinator = {
      state: { phase: 'idle' as const },
      check: () => new Promise<InsightNativeUpdateState>((resolve) => { resolveCheck = resolve }),
      async download(version: string) { return { phase: 'ready' as const, version } },
      async install(version: string) { return { phase: 'installing' as const, version } },
      dismissAvailable: () => ({ phase: 'idle' as const }),
    }
    const controller = createInsightUpdateController({
      currentVersion: '1.0.9', store: durable, coordinator,
      resolved: track => release(track), confirmCandidate: async () => true,
      openFullInstaller: async () => {}, publish: () => { published += 1 }, report: () => {},
    })
    const checking = controller.checkStable()
    controller.dispose()
    resolveCheck({ phase: 'idle' })
    await checking
    expect(published).toBe(1)
    await expect(controller.download()).rejects.toThrow('disposed')
  })

  it('keeps a verified target retryable when native download or installation reports an error', async () => {
    const durable = await store()
    let download = true
    let install = true
    const rawErrors: unknown[] = []
    const coordinator = {
      state: { phase: 'idle' as const },
      async check() { return { phase: 'available' as const, version: '1.0.10' } },
      async download(version: string) {
        if (download) {
          download = false
          return { phase: 'error' as const, version, message: 'credential=/private/details', failedOperation: 'download' as const }
        }
        return { phase: 'ready' as const, version }
      },
      async install(version: string) {
        if (install) {
          install = false
          return { phase: 'error' as const, version, message: 'native detailed failure', failedOperation: 'install' as const }
        }
        return { phase: 'installing' as const, version }
      },
      dismissAvailable: () => ({ phase: 'idle' as const }),
    }
    const controller = createInsightUpdateController({
      currentVersion: '1.0.9', store: durable, coordinator,
      resolved: track => release(track), confirmCandidate: async () => true,
      openFullInstaller: async () => {}, publish: () => {}, report: (error) => { rawErrors.push(error) },
    })
    await controller.checkStable()
    await controller.download()
    expect(controller.snapshot).toMatchObject({ phase: 'available', version: '1.0.10', message: '下载未完成，请重试。' })
    await controller.download()
    await controller.install()
    expect(controller.snapshot).toMatchObject({ phase: 'ready', version: '1.0.10', message: '安装未完成，请重试。' })
    await controller.install()
    expect(controller.snapshot.phase).toBe('installing')
    expect(rawErrors).toHaveLength(0)
  })

  it('restores the prepared version after a late native installation error so the user can retry', async () => {
    const durable = await store()
    let installations = 0
    const reported: unknown[] = []
    const coordinator = {
      state: { phase: 'idle' as const },
      async check() { return { phase: 'available' as const, version: '1.0.10' } },
      async download(version: string) { return { phase: 'ready' as const, version } },
      async install(version: string) { installations += 1; return { phase: 'installing' as const, version } },
      dismissAvailable: () => ({ phase: 'idle' as const }),
    }
    const controller = createInsightUpdateController({
      currentVersion: '1.0.9', store: durable, coordinator,
      resolved: track => release(track), confirmCandidate: async () => true,
      openFullInstaller: async () => {}, publish: () => {}, report: (error) => { reported.push(error) },
    })
    await controller.checkStable()
    await controller.download()
    await controller.install()
    controller.updateState({
      phase: 'error', version: '1.0.10', failedOperation: 'install', message: 'native detailed failure',
    })
    expect(controller.snapshot).toMatchObject({ phase: 'ready', version: '1.0.10', message: '安装未完成，请重试。' })
    await controller.install()
    expect(installations).toBe(2)
    expect(reported).toHaveLength(1)
  })

  it('redacts native coordinator errors before publishing them to the update window', async () => {
    const durable = await store()
    const published: Array<{ message?: string }> = []
    const reported: unknown[] = []
    const coordinator = {
      state: { phase: 'idle' as const },
      async check() { return { phase: 'error' as const, message: 'Authorization: Bearer secret-value' } },
      async download(version: string) { return { phase: 'ready' as const, version } },
      async install(version: string) { return { phase: 'installing' as const, version } },
      dismissAvailable: () => ({ phase: 'idle' as const }),
    }
    const controller = createInsightUpdateController({
      currentVersion: '1.0.9', store: durable, coordinator,
      resolved: track => release(track), confirmCandidate: async () => true,
      openFullInstaller: async () => {}, publish: (state) => { published.push(state) },
      report: (error) => { reported.push(error) },
    })
    await controller.checkStable()
    expect(controller.snapshot).toMatchObject({ phase: 'error', message: '更新暂时未完成，请重试。' })
    expect(published.some(state => state.message?.includes('secret-value') === true)).toBe(false)
    expect(reported).toHaveLength(1)
  })
})
