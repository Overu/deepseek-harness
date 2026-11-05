/** Shared platform-skill installation ownership and configured queue behavior. */
import { expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { InsightSkillId, PlatformSkillKey, PlatformSkillOperationId } from '../src/types.ts'
import { createSkillInstallationController, reconcilePresetSkills } from '../src/client/skill-installation-controller.ts'
import type { SkillCatalogItem } from '../src/client/skill-catalog-resource.ts'

const skillId = brandString<InsightSkillId>('1')
const skill: SkillCatalogItem = {
  id: skillId, skillName: 'preset-skill', name: 'Preset', summary: '', version: '1.0.0',
  descriptionMarkdown: '', downloadUrl: 'https://example.com/preset.zip',
}

function remote(frames: readonly unknown[] = []) {
  return {
    install: vi.fn(async function* () { yield* frames }),
    cancel: vi.fn(async () => ({ ok: true, value: { kind: 'cancelled', operationId: brandString<PlatformSkillOperationId>('cancelled') } })),
  }
}

it('owns one manual installation across callers and refreshes after its terminal frame', async () => {
  const remoteApi = remote([{ kind: 'complete', operationId: 'ignored', skill: { key: brandString<PlatformSkillKey>('preset-skill'), id: skillId, skillName: skill.skillName, version: skill.version } }])
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

it('sends the matched installation key when updating', async () => {
  const remoteApi = remote([{ kind: 'cancelled', operationId: 'ignored' }])
  const controller = createSkillInstallationController(remoteApi as never, vi.fn())
  const key = brandString<PlatformSkillKey>('installed-skill')

  await controller.install(skill, true, key)

  expect(remoteApi.install).toHaveBeenCalledWith(
    expect.objectContaining({ id: skillId, skillName: skill.skillName, key }),
    expect.any(AbortSignal),
  )
})

it('rechecks eligibility after each configured installation and ignores another page completing it', async () => {
  const remoteApi = remote([{ kind: 'complete', operationId: 'ignored', skill: { id: skillId, version: skill.version } }])
  const report = vi.fn()
  const controller = createSkillInstallationController(remoteApi as never, report)
  const pending = vi.fn()
    .mockResolvedValueOnce({ ok: true, value: [{ id: skillId, skillName: skill.skillName }] })
    .mockResolvedValueOnce({ ok: true, value: [] })
  await reconcilePresetSkills(controller, {
    pending,
    settled: vi.fn(async () => ({ ok: true as const, value: { skills: [] } })),
  }, [skill])

  expect(remoteApi.install).toHaveBeenCalledOnce()
  expect(pending).toHaveBeenCalledTimes(2)
  expect(report).toHaveBeenCalledWith('installSuccess')
})

it('reports a configured skill absent from the catalogue and does not start an arbitrary install', async () => {
  const remoteApi = remote()
  const report = vi.fn()
  const controller = createSkillInstallationController(remoteApi as never, report)
  await reconcilePresetSkills(controller, {
    pending: vi.fn(async () => ({ ok: true as const, value: [{ id: brandString<InsightSkillId>('missing-skill'), skillName: 'missing-skill' }] })),
    settled: vi.fn(async () => ({ ok: true as const, value: { skills: [] } })),
  }, [skill])

  expect(remoteApi.install).not.toHaveBeenCalled()
  expect(report).toHaveBeenCalledWith('installFailure')
})

it('does not report a failed configured stream after another page committed the same skill', async () => {
  const remoteApi = {
    install: vi.fn(async function* () { throw new Error('other page owns the stream') }),
    cancel: vi.fn(),
  }
  const report = vi.fn()
  const controller = createSkillInstallationController(remoteApi as never, report)
  const pending = vi.fn()
    .mockResolvedValueOnce({ ok: true as const, value: [{ id: skillId, skillName: skill.skillName }] })
    .mockResolvedValueOnce({ ok: true as const, value: [] })
  await reconcilePresetSkills(controller, {
    pending,
    settled: vi.fn(async () => ({ ok: true as const, value: { skills: [{ key: brandString<PlatformSkillKey>('preset-skill'), id: skillId, skillName: skill.skillName, version: skill.version }] } })),
  }, [skill])

  expect(report).not.toHaveBeenCalledWith('installFailure')
  expect(pending).toHaveBeenCalledTimes(2)
})

it('does not start a configured install after disposal races a late eligibility response', async () => {
  const remoteApi = remote()
  const report = vi.fn()
  const controller = createSkillInstallationController(remoteApi as never, report)
  const pending = Promise.withResolvers<{ ok: true; value: readonly { readonly id: InsightSkillId; readonly skillName: string }[] }>()
  const reconciliation = reconcilePresetSkills(controller, {
    pending: vi.fn(() => pending.promise),
    settled: vi.fn(async () => ({ ok: true as const, value: { skills: [] } })),
  }, [skill])

  await controller.dispose()
  pending.resolve({ ok: true, value: [{ id: skillId, skillName: skill.skillName }] })
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
    value: { skills: readonly { key: PlatformSkillKey; id?: InsightSkillId; skillName: string; version: string }[] }
  }>()
  const pending = vi.fn()
    .mockResolvedValueOnce({ ok: true as const, value: [{ id: skillId, skillName: skill.skillName }] })
    .mockResolvedValueOnce({ ok: true as const, value: [] })
  const waitForInstallation = vi.fn(() => settled.promise)
  const reconciliation = reconcilePresetSkills(controller, { pending, settled: waitForInstallation }, [skill])

  await vi.waitFor(() => { expect(waitForInstallation).toHaveBeenCalledWith({ id: skillId, skillName: skill.skillName }) })
  expect(report).not.toHaveBeenCalledWith('installFailure')
  settled.resolve({ ok: true, value: { skills: [{ key: brandString<PlatformSkillKey>('preset-skill'), id: skillId, skillName: skill.skillName, version: skill.version }] } })
  await reconciliation

  expect(report).not.toHaveBeenCalledWith('installFailure')
  expect(pending).toHaveBeenCalledTimes(2)
})

it('does not surface a late configured failure after the client controller is disposed', async () => {
  const report = vi.fn()
  const controller = createSkillInstallationController(remote() as never, report)
  await controller.dispose()

  controller.reportFailure()

  expect(report).not.toHaveBeenCalled()
})
