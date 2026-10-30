// @vitest-environment jsdom
/** Update-page actions stay constrained to the safe preload API. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { UpdatePage } from '../src/client/update/UpdatePage.tsx'
import type { InsightUpdateApi, InsightUpdateSnapshot } from '../src/shared/update-api.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })

function api(state: InsightUpdateSnapshot) {
  const methods = {
    status: vi.fn(async () => state), subscribe: vi.fn(() => () => {}),
    checkStable: vi.fn(async () => {}), checkCandidate: vi.fn(async () => {}),
    download: vi.fn(async () => {}), install: vi.fn(async () => {}), fullInstaller: vi.fn(async () => {}),
    skip: vi.fn(async () => {}), close: vi.fn(async () => {}),
  }
  return methods satisfies InsightUpdateApi
}

const idle: InsightUpdateSnapshot = {
  currentVersion: '1.0.9', phase: 'idle', track: 'stable', required: false, canDownloadFullInstaller: false,
}

describe('UpdatePage', () => {
  it('checks a candidate only on the fifth logo click and suppresses a pending duplicate', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const bridge = api(idle)
    bridge.checkCandidate.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    render(<UpdatePage api={bridge} logoUrl="brand.svg" />)
    const logo = screen.getByRole('button', { name: '因赛AI 标志' })
    for (let index = 0; index < 4; ++index) fireEvent.click(logo)
    expect(bridge.checkCandidate).not.toHaveBeenCalled()
    fireEvent.click(logo)
    expect(bridge.checkCandidate).toHaveBeenCalledOnce()
    fireEvent.click(logo)
    expect(bridge.checkCandidate).toHaveBeenCalledOnce()
    release()
    await vi.runAllTimersAsync()
  })

  it('resets the candidate gesture after three seconds', () => {
    vi.useFakeTimers()
    const bridge = api(idle)
    render(<UpdatePage api={bridge} logoUrl="brand.svg" />)
    const logo = screen.getByRole('button', { name: '因赛AI 标志' })
    for (let index = 0; index < 4; ++index) fireEvent.click(logo)
    vi.advanceTimersByTime(3_001)
    fireEvent.click(logo)
    expect(bridge.checkCandidate).not.toHaveBeenCalled()
  })

  it('renders skip, installer, and ready installation without exposing an update path', async () => {
    const bridge = api({ ...idle, phase: 'available', version: '1.0.10-rc.1', track: 'candidate', canDownloadFullInstaller: true })
    const view = render(<UpdatePage api={bridge} logoUrl="brand.svg" />)
    expect(await screen.findByText('内测版本')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '跳过这个版本' }))
    fireEvent.click(screen.getByRole('button', { name: '下载完整安装包' }))
    expect(bridge.skip).toHaveBeenCalledWith('1.0.10-rc.1')
    expect(bridge.fullInstaller).toHaveBeenCalledOnce()
    view.rerender(<UpdatePage api={api({ ...idle, phase: 'ready', version: '1.0.10', required: false })} logoUrl="brand.svg" />)
    await vi.waitFor(() => { expect(screen.getByRole('button', { name: '立即安装' })).toBeTruthy() })
  })

  it('releases its preload listener when unmounted', () => {
    const unsubscribe = vi.fn()
    const bridge = { ...api(idle), subscribe: vi.fn(() => unsubscribe) }
    const view = render(<UpdatePage api={bridge} logoUrl="brand.svg" />)
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('keeps an action error inside the update window', async () => {
    const bridge = api(idle)
    bridge.checkStable.mockRejectedValueOnce(new Error('offline'))
    render(<UpdatePage api={bridge} logoUrl="brand.svg" />)
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
    expect(await screen.findByText('操作未完成，请重试')).toBeTruthy()
  })
})
