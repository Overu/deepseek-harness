// @vitest-environment jsdom
/** Account-menu requests reach Settings without a second sidebar entry. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { InsightSettingsLauncher } from '../src/client/SettingsLauncher.tsx'

afterEach(cleanup)

it('forwards each account-menu request once without rendering a settings button', () => {
  const openSettings = vi.fn()
  const runtimeProps = {} as PropsRuntime<'settings.launcher'>
  let requests = 0
  const view = () => <InsightSettingsLauncher {...runtimeProps} openSettings={openSettings}
    useRequests={selector => selector(requests)} />
  const rendered = render(view())
  expect(rendered.container.firstChild).toBeNull()
  expect(openSettings).not.toHaveBeenCalled()

  requests = 1
  rendered.rerender(view())
  expect(openSettings).toHaveBeenCalledOnce()
  rendered.rerender(view())
  expect(openSettings).toHaveBeenCalledOnce()

  requests = 2
  rendered.rerender(view())
  expect(openSettings).toHaveBeenCalledTimes(2)
  expect(rendered.container.firstChild).toBeNull()
})
