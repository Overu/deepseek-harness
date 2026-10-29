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
