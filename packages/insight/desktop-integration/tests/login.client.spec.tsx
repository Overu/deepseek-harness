// @vitest-environment jsdom
/** Isolated login-page behavior with a renderer-safe API mock. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LoginPage } from '../src/client/login.ts'
import { LoginDotGrid } from '../src/client/LoginDotGrid.tsx'
import type { InsightLoginApi, InsightLoginState } from '../src/shared/desktop-api.ts'

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: () => null })

afterEach(cleanup)
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

type LoginApiMock = Omit<InsightLoginApi, 'loginSms' | 'signOut'> & {
  loginSms: ReturnType<typeof vi.fn<InsightLoginApi['loginSms']>>
  signOut: ReturnType<typeof vi.fn<InsightLoginApi['signOut']>>
}

function api(state: InsightLoginState): LoginApiMock {
  return {
    current: vi.fn(async () => state),
    subscribe: vi.fn(() => () => {}),
    sendSmsCode: vi.fn(async () => ({ ok: true } as const)),
    captcha: vi.fn(async () => ({ ok: true, captcha: { uuid: 'captcha', image: 'data:image/png;base64,AA==' } } as const)),
    loginSms: vi.fn(async () => ({ ok: true } as const)),
    loginPassword: vi.fn(async () => ({ ok: true } as const)),
    resetLocal: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    openAgreement: vi.fn(async () => {}),
  }
}

describe('LoginPage', () => {
  it('requires agreement before exposing an SMS login request', async () => {
    const bridge = api({ session: { kind: 'unauthenticated' }, workspace: { kind: 'idle' } })
    render(<LoginPage api={bridge} logoUrl="logo.svg" />)
    await screen.findByRole('heading', { name: '欢迎登录' })
    expect(screen.getByText('以专业为引擎')).toBeTruthy()
    expect(screen.getByText('让团队与 AI 共成长')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('请输入手机号'), { target: { value: '18800000000' } })
    fireEvent.change(screen.getByPlaceholderText('请输入验证码'), { target: { value: '123456' } })
    expect(screen.getByRole('button', { name: '登录' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('checkbox', { name: '我已阅读' }))
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    await vi.waitFor(() => { expect(bridge.loginSms).toHaveBeenCalledWith({ phone: '18800000000', code: '123456' }, true) })
  })

  it('blocks workspace entry while a preserved historical workspace needs migration', async () => {
    const bridge = api({ session: { kind: 'authenticated', account: { displayName: '测试账号', maskedPhone: '188****0000' } }, workspace: { kind: 'migration-required' } })
    render(<LoginPage api={bridge} logoUrl="logo.svg" />)
    expect(await screen.findByRole('heading', { name: '历史工作区等待迁移' })).toBeTruthy()
    expect(screen.getByText('已保留你的历史对话、工作区、插件和配置。迁移尚未完成，因此不会创建空工作区或覆盖已有数据。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /空工作区|忽略/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '退出并重新登录' }))
    await vi.waitFor(() => { expect(bridge.signOut).toHaveBeenCalledOnce() })
  })

  it('blocks a failed account Home and only allows secure sign-out', async () => {
    const bridge = api({
      session: { kind: 'authenticated', account: { displayName: '测试账号', maskedPhone: '188****0000' } },
      workspace: { kind: 'failed', message: '无法安全准备账号数据，请退出后重新登录' },
    })
    render(<LoginPage api={bridge} logoUrl="logo.svg" />)
    expect(await screen.findByRole('heading', { name: '无法准备工作区' })).toBeTruthy()
    expect(screen.getByText('无法安全准备账号数据，请退出后重新登录')).toBeTruthy()
    expect(screen.getByText('请检查本机账号数据的访问权限后退出并重新登录。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /空工作区|重试/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '退出并重新登录' }))
    await vi.waitFor(() => { expect(bridge.signOut).toHaveBeenCalledOnce() })
  })

  it('releases dot-grid observers, listeners, and pending animation frames', () => {
    const disconnect = vi.fn()
    class TestResizeObserver {
      observe = vi.fn()
      disconnect = disconnect
      unobserve = vi.fn()
    }
    const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    const removeWindowListener = vi.spyOn(window, 'removeEventListener')
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener')
    const cancelAnimationFrame = vi.fn()
    vi.stubGlobal('matchMedia', vi.fn(() => media as unknown as MediaQueryList))
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 31))
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => ({ beginPath: vi.fn(), clearRect: vi.fn(), arc: vi.fn(), fill: vi.fn(), setTransform: vi.fn() }),
    })
    const { unmount } = render(<LoginDotGrid />)
    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(removeWindowListener).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(removeWindowListener).toHaveBeenCalledWith('pointerout', expect.any(Function))
    expect(removeDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    expect(cancelAnimationFrame).toHaveBeenCalledWith(31)
  })
})
