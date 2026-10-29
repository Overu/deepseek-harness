/** Main-only account bridge projection never exposes credentials to workspace UI. */
import { describe, expect, it, vi } from 'vitest'
import { InsightAccountSource } from '../src/client/account-source.ts'
import type { AccountSummary } from '../src/shared/auth-contracts.ts'
import type { InsightAccountApi } from '../src/shared/desktop-api.ts'

function api(): InsightAccountApi & { publish: (value: AccountSummary | null) => void } {
  let listener: ((value: AccountSummary | null) => void) | undefined
  return {
    current: vi.fn(async () => ({ displayName: '测试账号', maskedPhone: '188****0000' })),
    subscribe: vi.fn<InsightAccountApi['subscribe']>((next) => { listener = next; return () => { listener = undefined } }),
    signOut: vi.fn(async () => {}),
    info: vi.fn<InsightAccountApi['info']>(async () => ({ productName: '因赛AI', productVersion: '1.0.0', runtimeVersion: '0.2.0', platform: 'darwin', environment: 'test' })),
    publish: value => listener?.(value),
  }
}

describe('InsightAccountSource', () => {
  it('projects only the safe account summary and stops receiving events after disposal', async () => {
    const bridge = api()
    const source = new InsightAccountSource(bridge)
    await vi.waitFor(() => { expect(source.store.getSnapshot().summary).toEqual({ displayName: '测试账号', maskedPhone: '188****0000' }) })
    expect(source.store.getSnapshot()).not.toHaveProperty('token')
    bridge.publish({ displayName: '另一个账号', maskedPhone: '186****0000' })
    expect(source.store.getSnapshot().summary).toEqual({ displayName: '另一个账号', maskedPhone: '186****0000' })
    source.dispose()
    bridge.publish(null)
    expect(source.store.getSnapshot().summary).toEqual({ displayName: '另一个账号', maskedPhone: '186****0000' })
  })

  it('publishes an in-process Settings request without widening the renderer bridge', () => {
    const source = new InsightAccountSource(undefined)
    expect(source.settingsRequests.getSnapshot()).toBe(0)
    source.openSettings()
    expect(source.settingsRequests.getSnapshot()).toBe(1)
    source.dispose()
    source.openSettings()
    expect(source.settingsRequests.getSnapshot()).toBe(1)
  })
})
