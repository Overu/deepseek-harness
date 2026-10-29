/** Insight account menu's bridge into the shell-owned Settings panel. */
import { useEffect, useRef } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'

/** Injected event counter that carries explicit account-menu Settings requests. */
export interface InsightSettingsLauncherInjected {
  hooks: { requests: ObservableSnapshot<number> }
}

/** Slot props for forwarding account-menu requests to the shared settings shell. */
export type InsightSettingsLauncherProps = PropsRuntime<'settings.launcher'>
  & InjectFace<InsightSettingsLauncherInjected>

/** Open settings from account-menu requests without rendering a separate sidebar entry. */
export function InsightSettingsLauncher({ openSettings, useRequests }: InsightSettingsLauncherProps) {
  const requests = useRequests(value => value)
  const seen = useRef(requests)
  useEffect(() => {
    if (requests === seen.current) return
    seen.current = requests
    openSettings()
  }, [openSettings, requests])
  return null
}
