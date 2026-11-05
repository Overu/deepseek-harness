// @vitest-environment jsdom
/** Skill market interactions through its registered page and shell feedback host. */
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { RemoteMock, ok, openStream } from '@deepseek-ai/dsh-remote-mock'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { PlatformSkillOperationId } from '../src/types.ts'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import * as plugin from '../src/client/index.ts'
import { apply as resourcesApply, inject as resourcesInject } from '@deepseek-ai/dsh-client-resources/src/client/index.ts'
import { CATALOG_FIXTURE } from './fixtures/catalog.ts'
import { SkillInstallProgressModal } from '../src/client/SkillInstallProgressModal.tsx'
import { zh } from '../src/client/locales.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function installed(skills: readonly { id?: string; key?: string; skillName: string; version: string }[] = []) {
  return { skills: skills.map(skill => ({ ...skill, key: skill.key ?? skill.skillName })) as never }
}

function platformRemote(snapshot = installed()) {
  return RemoteMock.create()
    .unary('insightPlatformSkills/listInstalled', ok(snapshot))
    .unary('insightPlatformSkills/removeSkill', ok(snapshot))
    .unary('insightPlatformSkills/cancel', ok({ kind: 'cancelled', operationId: 'operation' } as never))
    .stream('insightPlatformSkills/installSkill', openStream())
}

function inventoryRemote() {
  return { list: vi.fn(async () => ok({ complete: true, entries: [] })) }
}

async function mountMarket(
  fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json(CATALOG_FIXTURE)), settle = true,
  platform = platformRemote(),
  inventory = inventoryRemote(),
  expectedCardCount = 6,
) {
  vi.stubGlobal('fetch', fetchImplementation)
  const runtime = await SlotTestRuntime.create()
  vi.spyOn(runtime.remote, '$mount').mockImplementation(async () => {
    runtime.remote.provideNamespaces({
      insightPlatformSkills: platform.remote.insightPlatformSkills,
      insightSkills: inventory,
    })
    return async () => {}
  })
  onTestFinished(() => runtime.dispose())
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.mount({ inject: [...resourcesInject], apply: resourcesApply })
  const feature = await runtime.mount(plugin)
  await runtime.root.declare({
    main: { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
    'shell.overlay': { kind: 'list', scope: 'root' },
    'conversation.input.left': { kind: 'list', scope: 'session' },
  }, ({ renderSlot }) => <>
    {renderSlot('sidebar.panellist', { size: 20, active: true })}
    {renderSlot('main', {}, { entryKey: 'insight-skill-center' })}
    {renderSlot('shell.overlay', {})}
  </>)
  const view = runtime.renderRoot()
  if (settle) await waitFor(() => { expect(view.queryAllByRole('article')).toHaveLength(expectedCardCount) })
  return { runtime, feature, view, locale, fetchImplementation, platform, inventory }
}

it('mounts the market below Plugins and removes the page, overlays, and navigation on unload', async () => {
  const { runtime, feature, view } = await mountMarket()
  expect(view.getByRole('heading', { name: /找到适合你的/ })).toBeTruthy()
  expect(view.getAllByRole('article')).toHaveLength(6)
  expect(view.queryByText('三步完成技能安装')).toBeNull()
  expect(view.queryByRole('button', { name: /切换到.*模式/ })).toBeNull()
  expect(runtime.slots.entries('sidebar.panellist')[0]?.options).toMatchObject({ id: 'insight-skill-center', order: 1 })
  expect(runtime.slots.entries('conversation.input.left')).toHaveLength(1)
  fireEvent.click(within(view.getAllByRole('article')[0]!).getByRole('button', { name: '查看详情' }))
  expect(view.getByRole('dialog')).toBeTruthy()
  await act(() => feature.dispose())
  for (const name of ['main', 'sidebar.panellist', 'shell.overlay', 'conversation.input.left'] as const) {
    expect(runtime.slots.entries(name)).toHaveLength(0)
  }
  expect(view.queryByRole('dialog')).toBeNull()
  expect(view.queryByRole('heading', { name: /找到适合你的/ })).toBeNull()
})

it('filters the fetched catalog while typing, submits immediately, and restores all cards when cleared', async () => {
  const { view } = await mountMarket()
  const input = view.getByRole('searchbox')
  const firstCard = view.getAllByRole('article')[0]!
  const name = within(firstCard).getByRole('heading').textContent
  fireEvent.change(input, { target: { value: name } })
  await waitFor(() =>{  expect(view.getAllByRole('article')).toHaveLength(1) })
  fireEvent.change(input, { target: { value: 'NO-SUCH-DEMO-SKILL' } })
  fireEvent.submit(view.getByRole('search'))
  expect(view.queryAllByRole('article')).toHaveLength(0)
  expect(view.getByText(/没有找到/)).toBeTruthy()
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.submit(view.getByRole('search'))
  expect(view.getAllByRole('article')).toHaveLength(6)
})

it('opens complete details and restores the invoking control after Escape', async () => {
  const { view } = await mountMarket()
  const first = view.getAllByRole('article')[0]!
  const name = within(first).getByRole('heading').textContent
  const trigger = within(first).getByRole('button', { name: '查看详情' })
  trigger.focus()
  fireEvent.click(trigger)
  const dialog = view.getByRole('dialog', { name })
  expect(within(dialog).getByText('技能 ID')).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: '安装' })).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(view.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('shows install controls without exposing the former download or prompt-copy actions', async () => {
  const { view } = await mountMarket()
  expect(within(view.getAllByRole('article')[0]!).getByRole('button', { name: '安装' })).toBeTruthy()
  expect(view.queryByRole('button', { name: /复制安装指令|下载 ZIP/ })).toBeNull()
  expect(view.getAllByRole('article')).toHaveLength(6)
})

it('keeps the install operation modal blocking while cancellation settles', () => {
  const cancel = vi.fn()
  const operationId = brandString<PlatformSkillOperationId>('operation')
  const view = render(<SkillInstallProgressModal updating={false} cancelling cancellable
    progress={{ kind: 'progress', operationId, phase: 'download', receivedBytes: 2, totalBytes: 4 }}
    t={key => zh[key]} onCancel={cancel} />)
  expect(view.getByRole('dialog', { name: '正在安装' })).toBeTruthy()
  expect(view.getByText('正在取消，等待操作结束')).toBeTruthy()
  expect(view.getByRole('button', { name: '取消' }).getAttribute('disabled')).not.toBeNull()
  expect(view.getByRole('progressbar').getAttribute('value')).toBe('2')
  expect(cancel).not.toHaveBeenCalled()
})

it('waits for Host admission before cancelling, then closes only after a cancelled terminal frame', async () => {
  const platform = platformRemote()
  const { view } = await mountMarket(undefined, true, platform)
  const card = view.getAllByRole('article')[0]!
  fireEvent.click(within(card).getByRole('button', { name: '安装' }))
  await platform.streams.opened('insightPlatformSkills/installSkill', 1)
  const cancel = view.getByRole('button', { name: '取消' })
  expect(cancel.getAttribute('disabled')).not.toBeNull()
  const request = platform.remote.insightPlatformSkills.installSkill.mock.calls[0]?.[0] as { operationId: string } | undefined
  if (request === undefined) throw new Error('platform install request missing')
  platform.streams.push('insightPlatformSkills/installSkill', { kind: 'progress', operationId: request.operationId, phase: 'validate' })
  await waitFor(() => { expect(view.getByRole('button', { name: '取消' }).getAttribute('disabled')).toBeNull() })
  fireEvent.click(view.getByRole('button', { name: '取消' }))
  expect(view.getByText('正在取消，等待操作结束')).toBeTruthy()
  platform.streams.push('insightPlatformSkills/installSkill', { kind: 'cancelled', operationId: request.operationId })
  platform.streams.end('insightPlatformSkills/installSkill')
  await waitFor(() => { expect(view.queryByRole('dialog', { name: '正在安装' })).toBeNull() })
})

it('treats a late cancel that reaches a committed terminal frame as an installed skill', async () => {
  let snapshot = installed()
  const platform = RemoteMock.create()
    .unary('insightPlatformSkills/listInstalled', () => ok(snapshot))
    .unary('insightPlatformSkills/removeSkill', ok(snapshot))
    .unary('insightPlatformSkills/cancel', () => ok({ kind: 'complete', operationId: 'operation', skill: { key: 'influencer-integration', id: '1', skillName: 'influencer-integration', version: '1.2.0' } } as never))
    .stream('insightPlatformSkills/installSkill', openStream())
  const { view } = await mountMarket(undefined, true, platform)
  fireEvent.click(within(view.getAllByRole('article')[0]!).getByRole('button', { name: '安装' }))
  await platform.streams.opened('insightPlatformSkills/installSkill', 1)
  const request = platform.remote.insightPlatformSkills.installSkill.mock.calls[0]?.[0] as { operationId: string } | undefined
  if (request === undefined) throw new Error('platform install request missing')
  platform.streams.push('insightPlatformSkills/installSkill', { kind: 'progress', operationId: request.operationId, phase: 'commit' })
  await waitFor(() => { expect(view.getByRole('button', { name: '取消' }).getAttribute('disabled')).toBeNull() })
  fireEvent.click(view.getByRole('button', { name: '取消' }))
  snapshot = installed([{ id: '1', skillName: 'influencer-integration', version: '1.2.0' }])
  platform.streams.push('insightPlatformSkills/installSkill', { kind: 'complete', operationId: request.operationId, skill: { key: 'influencer-integration', id: '1', skillName: 'influencer-integration', version: '1.2.0' } })
  platform.streams.end('insightPlatformSkills/installSkill')
  await waitFor(() => { expect(within(view.getAllByRole('article')[0]!).getByRole('button', { name: '已安装' }).getAttribute('disabled')).not.toBeNull() })
})

it('keeps completed installation feedback when a late cancel request rejects', async () => {
  let snapshot = installed()
  const cancellation = Promise.withResolvers<never>()
  const platform = RemoteMock.create()
    .unary('insightPlatformSkills/listInstalled', () => ok(snapshot))
    .unary('insightPlatformSkills/removeSkill', ok(snapshot))
    .unary('insightPlatformSkills/cancel', () => cancellation.promise)
    .stream('insightPlatformSkills/installSkill', openStream())
  const { view } = await mountMarket(undefined, true, platform)
  fireEvent.click(within(view.getAllByRole('article')[0]!).getByRole('button', { name: '安装' }))
  await platform.streams.opened('insightPlatformSkills/installSkill', 1)
  const request = platform.remote.insightPlatformSkills.installSkill.mock.calls[0]?.[0] as { operationId: string } | undefined
  if (request === undefined) throw new Error('platform install request missing')
  platform.streams.push('insightPlatformSkills/installSkill', { kind: 'progress', operationId: request.operationId, phase: 'commit' })
  await waitFor(() => { expect(view.getByRole('button', { name: '取消' }).getAttribute('disabled')).toBeNull() })
  fireEvent.click(view.getByRole('button', { name: '取消' }))
  await waitFor(() => { expect(platform.remote.insightPlatformSkills.cancel.mock.calls).toHaveLength(1) })
  snapshot = installed([{ id: '1', skillName: 'influencer-integration', version: '1.2.0' }])
  platform.streams.push('insightPlatformSkills/installSkill', { kind: 'complete', operationId: request.operationId, skill: { key: 'influencer-integration', id: '1', skillName: 'influencer-integration', version: '1.2.0' } })
  platform.streams.end('insightPlatformSkills/installSkill')
  await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('技能已安装') })
  await act(async () => { cancellation.reject(new Error('operation already settled')) })
  await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('技能已安装') })
})

it('matches an ID-less installed technical name and removes its local key', async () => {
  let snapshot = installed([{ key: 'legacy-local-key', skillName: 'influencer-integration', version: '0.0.1' }])
  const platform = RemoteMock.create()
    .unary('insightPlatformSkills/listInstalled', () => ok(snapshot))
    .unary('insightPlatformSkills/removeSkill', () => { snapshot = installed(); return ok(snapshot) })
    .unary('insightPlatformSkills/cancel', ok({ kind: 'cancelled', operationId: 'operation' } as never))
    .stream('insightPlatformSkills/installSkill', openStream())
  const { view } = await mountMarket(undefined, true, platform)
  const card = view.getAllByRole('article')[0]!
  expect(within(card).getByRole('button', { name: '更新' })).toBeTruthy()
  fireEvent.click(within(card).getByRole('button', { name: '查看详情' }))
  const dialog = view.getByRole('dialog')
  expect(within(dialog).getByRole('button', { name: '更新' })).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: '移除' }))
  expect(platform.remote.insightPlatformSkills.removeSkill).toHaveBeenCalledWith({ key: 'legacy-local-key', id: '1', skillName: 'influencer-integration' }, undefined)
  await waitFor(() => { expect(within(view.getAllByRole('article')[0]!).getByRole('button', { name: '安装' })).toBeTruthy() })
})

it('recognizes an installed skill when its OSS ID survives a technical-name rename', async () => {
  const catalogue = { skills: [{ ...CATALOG_FIXTURE.skills[0], skill_id: 'renamed-integration' }] }
  const platform = platformRemote(installed([{ id: '1', skillName: 'influencer-integration', version: '1.2.0' }]))
  const { view } = await mountMarket(vi.fn<typeof fetch>().mockResolvedValue(Response.json(catalogue)), true, platform, undefined, 1)
  expect(within(view.getByRole('article')).getByRole('button', { name: '已安装' }).getAttribute('disabled')).not.toBeNull()
})

it('disables an ambiguous technical-name match with different OSS IDs', async () => {
  const catalogue = { skills: [
    CATALOG_FIXTURE.skills[0],
    { ...CATALOG_FIXTURE.skills[0], id: 99, name: '不同版本' },
  ] }
  const platform = platformRemote(installed([{ id: '1', skillName: 'influencer-integration', version: '1.2.0' }]))
  const { view } = await mountMarket(vi.fn<typeof fetch>().mockResolvedValue(Response.json(catalogue)), true, platform, undefined, 2)
  expect(within(view.getAllByRole('article')[0]!).getByRole('button', { name: '已安装' }).getAttribute('disabled')).not.toBeNull()
  const conflict = within(view.getAllByRole('article')[1]!).getByRole('button', { name: '技能标识冲突' })
  expect(conflict.getAttribute('disabled')).not.toBeNull()
  expect(platform.remote.insightPlatformSkills.installSkill).not.toHaveBeenCalled()
  expect(platform.remote.insightPlatformSkills.removeSkill).not.toHaveBeenCalled()
})

it('does not match one ID-less installation to two catalogue IDs with the same technical name', async () => {
  const catalogue = { skills: [
    CATALOG_FIXTURE.skills[0],
    { ...CATALOG_FIXTURE.skills[0], id: 99, name: '不同版本' },
  ] }
  const platform = platformRemote(installed([{ key: 'name-only', skillName: 'influencer-integration', version: '1.2.0' }]))
  const { view } = await mountMarket(vi.fn<typeof fetch>().mockResolvedValue(Response.json(catalogue)), true, platform, undefined, 3)
  for (const card of view.getAllByRole('article').slice(0, 2)) {
    const action = within(card).getByRole('button', { name: '技能标识冲突' })
    expect(action.getAttribute('disabled')).not.toBeNull()
  }
  const installedCard = view.getAllByRole('article')[2]!
  expect(within(installedCard).getByRole('button', { name: '已安装' }).getAttribute('disabled')).not.toBeNull()
  fireEvent.click(within(installedCard).getByRole('button', { name: '查看详情' }))
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: '移除' }))
  expect(platform.remote.insightPlatformSkills.removeSkill).toHaveBeenCalledWith({ key: 'name-only', skillName: 'influencer-integration' }, undefined)
  expect(platform.remote.insightPlatformSkills.installSkill).not.toHaveBeenCalled()
})

it('keeps an installed skill missing from the catalogue removable', async () => {
  let snapshot = installed([{ skillName: 'retired-platform-skill', version: '1.0.0' }])
  const platform = RemoteMock.create()
    .unary('insightPlatformSkills/listInstalled', () => ok(snapshot))
    .unary('insightPlatformSkills/removeSkill', () => { snapshot = installed(); return ok(snapshot) })
    .unary('insightPlatformSkills/cancel', ok({ kind: 'cancelled', operationId: 'operation' } as never))
    .stream('insightPlatformSkills/installSkill', openStream())
  const { view } = await mountMarket(undefined, true, platform, undefined, 7)
  const card = view.getByRole('heading', { name: 'retired-platform-skill' }).closest('article')
  if (card === null) throw new Error('retired platform skill card missing')
  expect(within(card).getByText('该已安装技能已不在技能目录中，你仍可将其移除')).toBeTruthy()
  fireEvent.click(within(card).getByRole('button', { name: '查看详情' }))
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: '移除' }))
  await waitFor(() => { expect(view.queryByRole('heading', { name: 'retired-platform-skill' })).toBeNull() })
})

it('keeps installed skills removable while the catalogue is unavailable', async () => {
  let snapshot = installed([{ skillName: 'retired-platform-skill', version: '1.0.0' }])
  const platform = RemoteMock.create()
    .unary('insightPlatformSkills/listInstalled', () => ok(snapshot))
    .unary('insightPlatformSkills/removeSkill', () => { snapshot = installed(); return ok(snapshot) })
    .unary('insightPlatformSkills/cancel', ok({ kind: 'cancelled', operationId: 'operation' } as never))
    .stream('insightPlatformSkills/installSkill', openStream())
  const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }))
  const { view } = await mountMarket(fetchImplementation, false, platform)
  await view.findByRole('button', { name: '重试' })
  const card = view.getByRole('heading', { name: 'retired-platform-skill' }).closest('article')
  if (card === null) throw new Error('retired platform skill card missing')
  fireEvent.click(within(card).getByRole('button', { name: '查看详情' }))
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: '移除' }))
  await waitFor(() => { expect(view.queryByRole('heading', { name: 'retired-platform-skill' })).toBeNull() })
})

it('localizes page controls while preserving catalog text from OSS', async () => {
  const { view, locale } = await mountMarket()
  const input = view.getByRole('searchbox')
  fireEvent.change(input, { target: { value: 'workflow' } })
  fireEvent.submit(view.getByRole('search'))
  expect(view.getAllByRole('article')).toHaveLength(1)
  act(() => { locale.setLocale('en') })
  expect(view.getByRole('heading', { name: /Find the right/ })).toBeTruthy()
  expect(view.getByRole('button', { name: 'View details' })).toBeTruthy()
  expect(view.getByRole('button', { name: 'Install' })).toBeTruthy()
  expect(view.getByRole('searchbox')).toBe(input)
  expect(view.getByRole('heading', { name: '创意工作流搭建与评估' })).toBeTruthy()
  fireEvent.change(input, { target: { value: '达人整合' } })
  fireEvent.submit(view.getByRole('search'))
  expect(view.getAllByRole('article')).toHaveLength(1)
})

it('shows a loading state, reports request failure, and retries only after the user requests it', async () => {
  const pending = Promise.withResolvers<Response>()
  const fetchImplementation = vi.fn<typeof fetch>().mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(Response.json(CATALOG_FIXTURE))
  const { view } = await mountMarket(fetchImplementation, false)
  expect(view.queryAllByRole('article')).toHaveLength(0)
  expect(view.getByRole('status')).toBeTruthy()
  await act(async () => { pending.resolve(new Response('', { status: 503 })) })
  await view.findByRole('button', { name: '重试' })
  expect(fetchImplementation).toHaveBeenCalledOnce()
  fireEvent.click(view.getByRole('button', { name: '重试' }))
  await waitFor(() => { expect(view.getAllByRole('article')).toHaveLength(6) })
  expect(fetchImplementation).toHaveBeenCalledTimes(2)
})

it('distinguishes an empty published catalog from unmatched search results', async () => {
  const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ skills: [] }))
  const { view } = await mountMarket(fetchImplementation, false)
  await view.findByText('暂时还没有已上架技能')
  expect(view.queryByText(/没有找到/)).toBeNull()
})

it('aborts the catalog request and removes its provider when the plugin unloads', async () => {
  const pending = Promise.withResolvers<Response>()
  const fetchImplementation = vi.fn<typeof fetch>().mockReturnValue(pending.promise)
  const { runtime, feature, view } = await mountMarket(fetchImplementation, false)
  await waitFor(() => { expect(fetchImplementation).toHaveBeenCalledOnce() })
  const signal = fetchImplementation.mock.calls[0]?.[1]?.signal
  expect(signal?.aborted).toBe(false)
  await act(() => feature.dispose())
  expect(signal?.aborted).toBe(true)
  await act(async () => { pending.resolve(Response.json(CATALOG_FIXTURE)) })
  expect(view.queryAllByRole('article')).toHaveLength(0)
  expect(runtime.slots.entries('main')).toHaveLength(0)
})
