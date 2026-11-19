// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CanvasViewBinding } from '../src/canvas-service-binding'

const fixture = vi.hoisted(() => ({ binding: undefined as Pick<CanvasViewBinding, 'points' | 'onRelease'> | undefined }))
vi.mock('../src/canvas-service-binding', () => ({ getCanvasViewBinding: () => fixture.binding }))
vi.mock('../legacy/src/api/workflow', () => ({ shareCanvas: vi.fn() }))
vi.mock('../legacy/src/store/flowStore', () => ({ useFlowStore: { getState: vi.fn() } }))
import DesktopCanvasHeader from '../src/desktop-canvas-header'
import { AuthProvider, AUTH_EXPIRED_EVENT } from '../src/auth-context'
import { createPointStoreApi, usePointStore } from '../legacy/src/store/pointStore'

let root: Root, container: HTMLDivElement
const balance = (rechargeBalance: number | string, giftBalance: number | string) => Response.json({ code: 'SUCCESS', data: { rechargeBalance, giftBalance } })
const render = async () => {
  await act(async () => root.render(createElement(AuthProvider, { children: createElement(DesktopCanvasHeader, { id: '2873', name: '测试画布', thumbnailUrl: '', ready: true }) })))
}
const pointsButton = () => container.querySelector<HTMLButtonElement>('button[aria-busy]')!

beforeEach(() => {
  fixture.binding = undefined
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(balance('1200.5', 34)))
  usePointStore.getState().actions.resetUserPoint()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  fixture.binding = undefined
  usePointStore.getState().actions.resetUserPoint()
  vi.unstubAllGlobals()
})

it('the desktop header loads the account total through the protected gateway and follows task balance updates', async () => {
  await render()
  expect(fetch).toHaveBeenCalledWith('/desktop-canvas/api/legacy/account-service/api/account/balance', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }))
  expect(container.textContent).toContain('测试画布')
  expect(pointsButton().textContent).toMatchInlineSnapshot('"1,234.5"')
  expect(pointsButton().querySelector('img')).not.toBeNull()
  vi.mocked(fetch).mockResolvedValueOnce(balance(1100, 20))
  await act(async () => { await usePointStore.getState().actions.refreshUserPoint({ reason: 'task-success' }) })
  expect(pointsButton().textContent).toBe('1,120')
})

it('a bound desktop view follows its runtime balance instead of the standalone store', async () => {
  const standalone = usePointStore.getState()
  const points = createPointStoreApi(() => '2873', () => ({ silentError: true }))
  const cleanups = new Set<() => void>()
  fixture.binding = { points, onRelease: (cleanup) => { cleanups.add(cleanup); return () => { cleanups.delete(cleanup) } } }
  await render()
  expect(pointsButton().textContent).toBe('1,234.5')
  expect(points.getState().lastRefreshReason).toBe('display')
  vi.mocked(fetch).mockResolvedValueOnce(balance(900, 10))
  await act(async () => { await points.getState().actions.refreshUserPoint({ reason: 'task-failure-refund' }) })
  expect(pointsButton().textContent).toBe('910')
  expect(standalone.lastSuccessAt).toBeNull()
})

it('shows a pending balance instead of zero and displays a genuine zero after loading', async () => {
  let finish!: (value: Response) => void
  vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await render()
  expect(pointsButton().textContent).toMatchInlineSnapshot('"···"')
  expect(pointsButton().disabled).toBe(true)
  await act(async () => { finish(balance(0, 0)) })
  expect(pointsButton().textContent).toBe('0')
  expect(pointsButton().disabled).toBe(false)
})

it('failed queries stay unknown, retry on click, and preserve a successful balance on later failure', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ code: 'BALANCE_UNAVAILABLE', msg: '暂时不可用' }))
  await render()
  expect(pointsButton().textContent).toMatchInlineSnapshot('"—"')
  expect(pointsButton().getAttribute('aria-label')).toBe('刷新失败，重试')
  await act(async () => pointsButton().click())
  expect(pointsButton().textContent).toBe('1,234.5')
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network unavailable'))
  await act(async () => pointsButton().click())
  expect(pointsButton().textContent).toBe('1,234.5')
  expect(pointsButton().getAttribute('aria-label')).toBe('刷新失败，重试')
})

it('removes the balance when the desktop account expires', async () => {
  await render()
  await act(async () => window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT)))
  expect(pointsButton()).toBeNull()
})
