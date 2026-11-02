// @vitest-environment jsdom
/** Account footer keeps product actions in the sidebar without exposing credentials. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { InsightAccountFooter } from '../src/client/AccountFooter.tsx'

afterEach(cleanup)

const snapshot = {
  summary: { displayName: '测试账号', maskedPhone: '188****0000' }, info: undefined, failed: false,
}

// The footer renders no global client state, but its slot contract inherits the
// standard props that the renderer supplies to every root-scoped component.
const standardProps = {} as GlobalStandardProps

describe('InsightAccountFooter', () => {
  it('uses the display-name initial or Insight fallback when no avatar is available', () => {
    const view = render(<InsightAccountFooter {...standardProps} wide signOut={vi.fn(async () => {})} openSettings={() => {}}
      useAccount={selector => selector(snapshot)} />)
    expect(view.container.querySelector('[data-insight-account-avatar]')?.textContent).toBe('测')
    view.rerender(<InsightAccountFooter {...standardProps} wide signOut={vi.fn(async () => {})} openSettings={() => {}}
      useAccount={selector => selector({ ...snapshot, summary: { ...snapshot.summary, displayName: '  ' } })} />)
    expect(view.container.querySelector('[data-insight-account-avatar]')?.textContent).toBe('因')
  })

  it('preserves a supplied avatar image', () => {
    const view = render(<InsightAccountFooter {...standardProps} wide signOut={vi.fn(async () => {})} openSettings={() => {}}
      useAccount={selector => selector({ ...snapshot, summary: { ...snapshot.summary, avatarUrl: 'https://example.test/avatar.png' } })} />)
    expect(view.container.querySelector('[data-insight-account-avatar] img')?.getAttribute('src')).toBe('https://example.test/avatar.png')
  })

  it('opens product settings from the account menu', () => {
    const openSettings = vi.fn()
    render(<InsightAccountFooter {...standardProps} wide signOut={vi.fn(async () => {})} openSettings={openSettings}
      useAccount={selector => selector(snapshot)} />)
    fireEvent.click(screen.getByRole('button', { name: '测试账号' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '设置' }))
    expect(openSettings).toHaveBeenCalledOnce()
  })

  it('keeps sign-out behind the Main-owned callback', async () => {
    const signOut = vi.fn(async () => {})
    render(<InsightAccountFooter {...standardProps} wide signOut={signOut} openSettings={() => {}}
      useAccount={selector => selector(snapshot)} />)
    fireEvent.click(screen.getByRole('button', { name: '测试账号' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '退出' }))
    await vi.waitFor(() => { expect(signOut).toHaveBeenCalledOnce() })
  })
})
