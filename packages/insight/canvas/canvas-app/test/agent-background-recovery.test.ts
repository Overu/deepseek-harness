// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createCanvasOwnershipLock } from '../src/canvas-ownership-lock'
import { createWorkflowTabOwnership } from '../legacy/src/hooks/workflowTabOwnership'
import { createTestLockManager } from './lock-manager-fixture'

const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).forEach(stop => stop()); vi.unstubAllGlobals() })
it('conditional acquisition resolves while held; two owners cannot acquire even without broadcast replies', async () => {
  const locks = createTestLockManager()
  const a = createCanvasOwnershipLock('1', vi.fn(), locks), b = createCanvasOwnershipLock('1', vi.fn(), locks)
  cleanups.push(a.dispose, b.dispose)
  expect(await a.acquire()).toBe(true)
  expect(await b.acquire()).toBe(false)
  expect(await b.acquire()).toBe(false)
  await a.release(); expect(await b.acquire()).toBe(true)
})
it('different canvases do not collide and disposal releases its own lock', async () => {
  const locks = createTestLockManager(), changed = vi.fn()
  const a = createCanvasOwnershipLock('1', changed, locks), b = createCanvasOwnershipLock('2', vi.fn(), locks)
  cleanups.push(a.dispose, b.dispose)
  expect(await Promise.all([a.acquire(), b.acquire()])).toEqual([true, true])
  a.dispose(); expect(a.isHeld()).toBe(false); expect(await a.acquire()).toBe(false)
  await a.release()
  const replacement = createCanvasOwnershipLock('1', vi.fn(), locks); cleanups.push(replacement.dispose)
  expect(await replacement.acquire()).toBe(true)
})
it('disposal before the LockManager callback never publishes active', async () => {
  let finish!: () => void
  const locks = { request: (_name: string, _options: unknown, callback: (lock: unknown) => unknown) => new Promise((resolve) => { finish = () => resolve(callback({ name: 'pending', mode: 'exclusive' })) }) } as LockManager
  const changed = vi.fn(), owner = createCanvasOwnershipLock('pending', changed, locks)
  const ready = owner.acquire(); owner.dispose(); finish()
  expect(await ready).toBe(false); expect(changed).not.toHaveBeenCalled(); expect(owner.isHeld()).toBe(false)
})
it('explicit handoff preserves drafts, and only a cooperative holder can release', async () => {
  const channels: FakeChannel[] = []
  class FakeChannel {
    listeners = new Set<(event: MessageEvent) => void>()
    constructor(readonly name: string) { channels.push(this) }
    addEventListener(_name: string, fn: (event: MessageEvent) => void) { this.listeners.add(fn) }
    removeEventListener(_name: string, fn: (event: MessageEvent) => void) { this.listeners.delete(fn) }
    postMessage(data: unknown) { channels.filter(other =>
      other !== this && other.name === this.name).forEach(other =>
      queueMicrotask(() => other.listeners.forEach(fn => fn({ data } as MessageEvent)))) }
    close() { this.listeners.clear() }
  }
  vi.stubGlobal('BroadcastChannel', FakeChannel)
  let draft = true
  const a = createWorkflowTabOwnership('draft-safe', vi.fn(), true, () => !draft)
  const b = createWorkflowTabOwnership('draft-safe', vi.fn(), true)
  cleanups.push(a.dispose, b.dispose); await Promise.all([a.ready, b.ready])
  const noise = new FakeChannel('workflow:active-tab:draft-safe')
  noise.postMessage({ type: 'released', ownershipProtocol: 'web-locks-v1' })
  await Promise.resolve(); noise.close()
  expect(await b.claim()).toBe('inactive'); expect(a.getStatus()).toBe('active')
  draft = false; expect(await b.claim()).toBe('active'); expect(a.getStatus()).toBe('inactive')
  // A late legacy claim cannot steal the lock or leave the new editor writable.
  const legacy = new FakeChannel('workflow:active-tab:draft-safe'); legacy.postMessage({ type: 'claim' })
  await vi.waitFor(() => expect(b.getStatus()).toBe('inactive'))
  expect(b.getReason()).toContain('旧版'); legacy.close()
})
it('background recheck recovers only after release, while unavailable locks stay inactive', async () => {
  vi.stubGlobal('BroadcastChannel', undefined)
  const a = createWorkflowTabOwnership('recovery', vi.fn()), b = createWorkflowTabOwnership('recovery', vi.fn(), true)
  cleanups.push(a.dispose, b.dispose); await Promise.all([a.ready, b.ready])
  expect(b.getStatus()).toBe('inactive'); expect(await b.recheck()).toBe('inactive')
  a.dispose(); await vi.waitFor(async () => expect(await b.recheck()).toBe('active'))
  vi.stubGlobal('navigator', {})
  const unsupported = createWorkflowTabOwnership('unsupported', vi.fn(), true); cleanups.push(unsupported.dispose)
  await unsupported.ready; expect(unsupported.getStatus()).toBe('inactive'); expect(unsupported.getReason()).toContain('不支持')
})
