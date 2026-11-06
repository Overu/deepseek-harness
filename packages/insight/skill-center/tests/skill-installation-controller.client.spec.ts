/** Shared platform-skill installation ownership and configured queue behavior. */
import { expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { InsightSkillId, PlatformSkillInstallRequest, PlatformSkillOperationId } from '../src/types.ts'
import { createSkillInstallationController } from '../src/client/skill-installation-controller.ts'
import type { SkillCatalogItem } from '../src/client/skill-catalog-resource.ts'

const skillId = brandString<InsightSkillId>('preset-skill')
const skill: SkillCatalogItem = {
  id: skillId, name: 'Preset', summary: '', version: '1.0.0',
  descriptionMarkdown: '', downloadUrl: 'https://example.com/preset.zip',
}

function remote(frames: readonly unknown[] = []) {
  return {
    install: vi.fn(async function* () { yield* frames }),
    cancel: vi.fn(async () => ({ ok: true, value: { kind: 'cancelled', operationId: brandString<PlatformSkillOperationId>('cancelled') } })),
  }
}

it('owns one manual installation across callers and refreshes after its terminal frame', async () => {
  const remoteApi = remote([{ kind: 'complete', operationId: 'ignored', skill: { id: skillId, version: skill.version } }])
  const report = vi.fn()
  const controller = createSkillInstallationController(remoteApi as never, report)

  const first = controller.install(skill, false)
  expect(first).toBeDefined()
  expect(controller.install(skill, false)).toBeUndefined()
  await expect(first).resolves.toEqual({ kind: 'complete', skill })
  expect(controller.hooks.active.getSnapshot()).toBeNull()
  expect(controller.hooks.revision.getSnapshot()).toBe(1)
  expect(report).toHaveBeenCalledWith('installSuccess')
})

it('sends the technical name when updating', async () => {
  const remoteApi = remote([{ kind: 'cancelled', operationId: 'ignored' }])
  const controller = createSkillInstallationController(remoteApi as never, vi.fn())
  await controller.install(skill, true)

  expect(remoteApi.install).toHaveBeenCalledWith(
    expect.objectContaining({ id: skillId }),
    expect.any(AbortSignal),
  )
})

it('rechecks eligibility after each configured installation and ignores another page completing it', async () => {
  const remoteApi = remote([{ kind: 'complete', operationId: 'ignored', skill: { id: skillId, version: skill.version } }])
  const report = vi.fn()
  const controller = createSkillInstallationController(remoteApi as never, report)
  const pending = vi.fn()
    .mockResolvedValueOnce({ ok: true, value: [{ id: skillId }] })
    .mockResolvedValueOnce({ ok: true, value: [] })
  await controller.installPresets({
    pending,
    settled: vi.fn(async () => ({ ok: true as const, value: { skills: [] } })),
  }, [skill])

  expect(remoteApi.install).toHaveBeenCalledOnce()
  expect(pending).toHaveBeenCalledTimes(2)
  expect(report).toHaveBeenCalledWith('presetSuccess')
})

it('reports a configured skill absent from the catalogue and does not start an arbitrary install', async () => {
  const remoteApi = remote()
  const report = vi.fn()
  const controller = createSkillInstallationController(remoteApi as never, report)
  await controller.installPresets({
    pending: vi.fn(async () => ({ ok: true as const, value: [{ id: brandString<InsightSkillId>('missing-skill') }] })),
    settled: vi.fn(async () => ({ ok: true as const, value: { skills: [] } })),
  }, [skill])

  expect(remoteApi.install).not.toHaveBeenCalled()
  expect(report).toHaveBeenCalledWith('presetFailure')
})

it('skips a missing catalogue preset and installs the remaining valid preset', async () => {
  const missing = { id: brandString<InsightSkillId>('missing-skill') }
  const remoteApi = remote([{ kind: 'complete', operationId: 'ignored', skill: { id: skillId, version: skill.version } }])
  const report = vi.fn()
  const controller = createSkillInstallationController(remoteApi as never, report)
  try {
    const pending = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: [missing, skill] })
      .mockResolvedValueOnce({ ok: true, value: [missing, skill] })
      .mockResolvedValue({ ok: true, value: [missing] })
    await controller.installPresets({ pending, settled: vi.fn() }, [skill])
    expect(remoteApi.install).toHaveBeenCalledOnce()
    expect(remoteApi.install).toHaveBeenCalledWith(expect.objectContaining({ id: skillId }), expect.any(AbortSignal))
    expect(report.mock.calls).toEqual([['presetFailure']])
    expect(controller.hooks.presets.getSnapshot()).toBeNull()
  } finally {
    await controller.dispose()
  }
})

it('does not report a failed configured stream after another page committed the same skill', async () => {
  const remoteApi = {
    install: vi.fn(async function* () { throw new Error('other page owns the stream') }),
    cancel: vi.fn(),
  }
  const report = vi.fn()
  const controller = createSkillInstallationController(remoteApi as never, report)
  const pending = vi.fn()
    .mockResolvedValueOnce({ ok: true as const, value: [{ id: skillId }] })
    .mockResolvedValueOnce({ ok: true as const, value: [] })
  await controller.installPresets({
    pending,
    settled: vi.fn(async () => ({ ok: true as const, value: { skills: [{ id: skillId, version: skill.version }] } })),
  }, [skill])

  expect(report).not.toHaveBeenCalledWith('presetFailure')
  expect(pending).toHaveBeenCalledTimes(2)
})

it('does not start a configured install after disposal races a late eligibility response', async () => {
  const remoteApi = remote()
  const report = vi.fn()
  const controller = createSkillInstallationController(remoteApi as never, report)
  const pending = Promise.withResolvers<{ ok: true; value: readonly { readonly id: InsightSkillId }[] }>()
  const reconciliation = controller.installPresets({
    pending: vi.fn(() => pending.promise),
    settled: vi.fn(async () => ({ ok: true as const, value: { skills: [] } })),
  }, [skill])

  const disposal = controller.dispose()
  pending.resolve({ ok: true, value: [{ id: skillId }] })
  await disposal
  await reconciliation

  expect(remoteApi.install).not.toHaveBeenCalled()
})

it('waits for another page to settle the same preset before reporting a failure', async () => {
  const remoteApi = {
    install: vi.fn(async function* () { throw new Error('another page is installing') }),
    cancel: vi.fn(),
  }
  const report = vi.fn()
  const controller = createSkillInstallationController(remoteApi as never, report)
  const settled = Promise.withResolvers<{
    ok: true
    value: { skills: readonly { id: InsightSkillId; version: string }[] }
  }>()
  const pending = vi.fn()
    .mockResolvedValueOnce({ ok: true as const, value: [{ id: skillId }] })
    .mockResolvedValueOnce({ ok: true as const, value: [] })
  const waitForInstallation = vi.fn(() => settled.promise)
  const reconciliation = controller.installPresets({ pending, settled: waitForInstallation }, [skill])

  await vi.waitFor(() => {
    expect(waitForInstallation).toHaveBeenCalledWith({ id: skillId }, expect.any(AbortSignal))
  })
  expect(report).not.toHaveBeenCalledWith('presetFailure')
  settled.resolve({ ok: true, value: { skills: [{ id: skillId, version: skill.version }] } })
  await reconciliation

  expect(report).not.toHaveBeenCalledWith('presetFailure')
  expect(pending).toHaveBeenCalledTimes(2)
})

it('does not surface a late configured failure after the client controller is disposed', async () => {
  const report = vi.fn()
  const controller = createSkillInstallationController(remote() as never, report)
  await controller.dispose()

  controller.reportFailure()

  expect(report).not.toHaveBeenCalled()
})

it('reports one summary for sixteen preset installations', async () => {
  const catalogue = Array.from({ length: 16 }, (_, index) => ({
    ...skill, id: brandString<InsightSkillId>(`preset-skill-${index + 1}`),
  }))
  let completed = 0
  const api = remote([{ kind: 'complete', operationId: 'ignored' }])
  const report = vi.fn()
  const controller = createSkillInstallationController(api as never, report)
  const pending = vi.fn(async () => ({ ok: true as const, value: catalogue.slice(completed++) }))
  await controller.installPresets({ pending, settled: vi.fn() }, catalogue)
  expect(api.install).toHaveBeenCalledTimes(16)
  expect(report.mock.calls).toEqual([['presetSuccess']])
  expect(controller.hooks.presets.getSnapshot()).toBeNull()
})

it('does not retry a failed preset when the queue is requested again', async () => {
  const api = { install: vi.fn(async function* () { throw new Error('download failed') }), cancel: vi.fn() }
  const report = vi.fn()
  const controller = createSkillInstallationController(api as never, report)
  const pending = vi.fn(async () => ({ ok: true as const, value: [skill] }))
  const reader = { pending, settled: vi.fn(async () => ({ ok: true as const, value: { skills: [] } })) }
  await controller.installPresets(reader, [skill])
  await controller.installPresets(reader, [skill])
  expect(api.install).toHaveBeenCalledOnce()
  expect(report.mock.calls).toEqual([['presetFailure']])
})

it.each([{ failedIds: ['14'] }, { failedIds: ['14', '15', '16'] }])(
  'continues after failed presets $failedIds without retrying them or reporting per-item outcomes', async ({ failedIds }) => {
    const catalogue = ['14', '15', '16'].map(id => ({ ...skill, id: brandString<InsightSkillId>(`preset-${id}`) }))
    const committed = new Set<string>()
    const attempted: string[] = []
    const api = {
      install: vi.fn(async function* (request: PlatformSkillInstallRequest) {
        attempted.push(request.id)
        if (failedIds.includes(request.id.replace('preset-', ''))) throw new Error('invalid package')
        committed.add(request.id)
        yield { kind: 'complete', operationId: request.operationId }
      }),
      cancel: vi.fn(),
    }
    const report = vi.fn()
    const controller = createSkillInstallationController(api as never, report)
    const progress: Array<{ readonly completed: number; readonly total: number }> = []
    const unsubscribe = controller.hooks.presets.subscribe(() => {
      const value = controller.hooks.presets.getSnapshot()
      if (value !== null) progress.push(value)
    })
    try {
      const reader = {
        pending: vi.fn(async () => ({ ok: true as const, value: catalogue.filter(entry => !committed.has(entry.id)) })),
        settled: vi.fn(async () => ({ ok: true as const, value: { skills: [] } })),
      }
      await controller.installPresets(reader, catalogue)
      await controller.installPresets(reader, catalogue)
      expect(attempted).toEqual(['preset-14', 'preset-15', 'preset-16'])
      expect([...committed]).toEqual(catalogue.filter(entry => !failedIds.includes(entry.id.replace('preset-', ''))).map(entry => entry.id))
      expect(progress.at(-1)).toMatchObject({ completed: 3, total: 3 })
      expect(new Set(progress.map(value => value.total))).toEqual(new Set([3]))
      expect(report.mock.calls).toEqual([['presetFailure']])
      expect(controller.hooks.presets.getSnapshot()).toBeNull()
    } finally {
      unsubscribe()
      await controller.dispose()
    }
  },
)

it('does not display a progress view or notification when no preset is pending', async () => {
  const report = vi.fn()
  const controller = createSkillInstallationController(remote() as never, report)
  await controller.installPresets({ pending: vi.fn(async () => ({ ok: true as const, value: [] })), settled: vi.fn() }, [skill])
  expect(controller.hooks.presets.getSnapshot()).toBeNull()
  expect(report).not.toHaveBeenCalled()
})

it('stops a cancelled preset queue with one final notification', async () => {
  const released = Promise.withResolvers<undefined>()
  const operationId = brandString<PlatformSkillOperationId>('preset-cancel')
  const api = {
    install: vi.fn(async function* () {
      yield { kind: 'progress', operationId, phase: 'validate' }
      await released.promise
      yield { kind: 'cancelled', operationId }
    }),
    cancel: vi.fn(async () => {
      released.resolve(undefined)
      return { ok: true, value: { kind: 'cancelled', operationId } }
    }),
  }
  const report = vi.fn()
  const controller = createSkillInstallationController(api as never, report)
  try {
    const catalogue = [skill, { ...skill, id: brandString<InsightSkillId>('second-preset') }]
    const pending = vi.fn(async () => ({ ok: true as const, value: catalogue }))
    const queue = controller.installPresets({ pending, settled: vi.fn() }, catalogue)
    await vi.waitFor(() => { expect(controller.hooks.active.getSnapshot()?.admitted).toBe(true) })
    controller.cancel()
    await queue
    expect(api.install).toHaveBeenCalledOnce()
    expect(report.mock.calls).toEqual([['presetCancelled']])
    expect(controller.hooks.presets.getSnapshot()).toBeNull()
  } finally {
    released.resolve(undefined)
    await controller.dispose()
  }
})

it('waits for a manual operation before reconciling the preset queue again', async () => {
  const release = Promise.withResolvers<undefined>()
  const next = { ...skill, id: brandString<InsightSkillId>('second-preset') }
  let calls = 0
  const api = {
    install: vi.fn(async function* () {
      if (++calls === 1) await release.promise
      yield { kind: 'complete', operationId: 'ignored' }
    }),
    cancel: vi.fn(),
  }
  const report = vi.fn()
  const controller = createSkillInstallationController(api as never, report)
  try {
    const manual = controller.install(skill, false)
    const pending = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: [next] })
      .mockResolvedValueOnce({ ok: true, value: [next] })
      .mockResolvedValueOnce({ ok: true, value: [] })
    const queue = controller.installPresets({ pending, settled: vi.fn() }, [next])
    await vi.waitFor(() => { expect(pending).toHaveBeenCalledOnce() })
    expect(api.install).toHaveBeenCalledOnce()
    release.resolve(undefined)
    await manual
    await queue
    expect(api.install).toHaveBeenCalledTimes(2)
    expect(report.mock.calls).toEqual([['installSuccess'], ['presetSuccess']])
  } finally {
    release.resolve(undefined)
    await controller.dispose()
  }
})

it.each(['pending', 'settled'] as const)('cancels the preset queue while waiting for %s', async (phase) => {
  const wait = vi.fn(async (_identity: unknown, signal?: AbortSignal): Promise<never> => await new Promise((_resolve, reject) => {
    if (signal === undefined) { reject(new Error('Missing observer signal')); return }
    if (signal.aborted) { reject(new Error('Observer aborted')); return }
    signal.addEventListener('abort', () => { reject(new Error('Observer aborted')) }, { once: true })
  }))
  const api = phase === 'pending'
    ? remote([{ kind: 'complete', operationId: 'ignored' }])
    : { install: vi.fn(async function* () { throw new Error('another operation is active') }), cancel: vi.fn() }
  const pending = vi.fn().mockResolvedValueOnce({ ok: true, value: [skill] })
  if (phase === 'pending') pending.mockImplementationOnce(wait)
  const report = vi.fn()
  const controller = createSkillInstallationController(api as never, report)
  try {
    const queue = controller.installPresets({ pending, settled: wait }, [skill])
    await vi.waitFor(() => { expect(wait).toHaveBeenCalledOnce() })
    controller.cancel()
    await queue
    expect(report.mock.calls).toEqual([['presetCancelled']])
    expect(controller.hooks.presets.getSnapshot()).toBeNull()
  } finally {
    await controller.dispose()
  }
})
