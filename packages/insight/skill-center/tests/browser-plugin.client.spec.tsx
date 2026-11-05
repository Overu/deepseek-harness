// @vitest-environment jsdom
/** Skill market interactions through its registered page and shell feedback host. */
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import * as plugin from '../src/client/index.ts'
import { apply as resourcesApply, inject as resourcesInject } from '@deepseek-ai/dsh-client-resources/src/client/index.ts'
import { CATALOG_FIXTURE } from './fixtures/catalog.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function mountMarket(fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json(CATALOG_FIXTURE)), settle = true) {
  vi.stubGlobal('fetch', fetchImplementation)
  const runtime = await SlotTestRuntime.create()
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
  }, ({ renderSlot }) => <>
    {renderSlot('sidebar.panellist', { size: 20, active: true })}
    {renderSlot('main', {}, { entryKey: 'insight-skill-center' })}
    {renderSlot('shell.overlay', {})}
  </>)
  const view = runtime.renderRoot()
  if (settle) await waitFor(() => { expect(view.queryAllByRole('article')).toHaveLength(6) })
  return { runtime, feature, view, locale, fetchImplementation }
}

function installClipboard(writeText: (text: string) => Promise<void>) {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  onTestFinished(() => {
    if (original === undefined) Reflect.deleteProperty(navigator, 'clipboard')
    else Object.defineProperty(navigator, 'clipboard', original)
  })
}

it('mounts the market below Plugins and removes the page, overlays, and navigation on unload', async () => {
  const { runtime, feature, view } = await mountMarket()
  expect(view.getByRole('heading', { name: /找到适合你的/ })).toBeTruthy()
  expect(view.getAllByRole('article')).toHaveLength(6)
  expect(view.queryByText('三步完成技能安装')).toBeNull()
  expect(view.queryByRole('button', { name: /切换到.*模式/ })).toBeNull()
  expect(runtime.slots.entries('sidebar.panellist')[0]?.options).toMatchObject({ id: 'insight-skill-center', order: 1 })
  fireEvent.click(within(view.getAllByRole('article')[0]!).getByRole('button', { name: '查看详情' }))
  expect(view.getByRole('dialog')).toBeTruthy()
  await act(() => feature.dispose())
  for (const name of ['main', 'sidebar.panellist', 'shell.overlay'] as const) {
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
  expect(within(dialog).getByRole('button', { name: '复制安装指令' })).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(view.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('copies a demonstration request and reports clipboard failures without removing the catalog', async () => {
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
  installClipboard(writeText)
  const { view } = await mountMarket()
  fireEvent.click(within(view.getAllByRole('article')[0]!).getByRole('button', { name: '复制安装指令' }))
  await waitFor(() =>{  expect(writeText).toHaveBeenCalledOnce() })
  expect(writeText.mock.calls[0]![0]).toMatch(/演示/)
  expect(writeText.mock.calls[0]![0]).not.toMatch(/https?:\/\//)
  await waitFor(() =>{  expect(view.getByRole('alert')).toBeTruthy() })
  writeText.mockRejectedValueOnce(new Error('permission denied'))
  fireEvent.click(within(view.getAllByRole('article')[0]!).getByRole('button', { name: '复制安装指令' }))
  await waitFor(() =>{  expect(view.getByRole('alert').textContent).toMatch(/复制失败/) })
  expect(view.getAllByRole('article')).toHaveLength(6)
})

it('reports the mock download without creating a download link', async () => {
  const { view } = await mountMarket()
  fireEvent.click(within(view.getAllByRole('article')[0]!).getByRole('button', { name: '下载 ZIP' }))
  await waitFor(() =>{  expect(view.getByRole('alert').textContent).toMatch(/演示/) })
  expect(view.container.querySelector('a[download], a[href$=".zip"]')).toBeNull()
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
