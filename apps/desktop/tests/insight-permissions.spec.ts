import { afterEach, expect, it, vi } from 'vitest'
import type { Session, WebContents, WebFrameMain } from 'electron'
import { insightPermissionAllowed, installInsightPermissions } from '../src/insight-permissions.ts'

const access = vi.hoisted(() => ({ getMediaAccessStatus: vi.fn(() => 'granted'), askForMediaAccess: vi.fn(async () => true) }))
vi.mock('electron', () => ({ systemPreferences: access }))
const canvas = 'dsh-app://app/desktop-canvas/view?id=1&viewId=123e4567-e89b-42d3-a456-426614174000'
afterEach(() => { vi.unstubAllGlobals() })

it('allows only owner application and identified canvas copy/fullscreen paths', () => {
  expect(insightPermissionAllowed('clipboard-sanitized-write', 'dsh-app://app/', { isMainFrame: true })).toBe(true)
  expect(insightPermissionAllowed('fullscreen', canvas, { isMainFrame: false, embeddingOrigin: 'dsh-app://app', securityOrigin: 'dsh-app://app' }, true)).toBe(true)
  expect(insightPermissionAllowed('fullscreen', canvas, { isMainFrame: false })).toBe(false)
  for (const [permission, url, details] of [
    ['fullscreen', 'https://bad/', { isMainFrame: true }],
    ['fullscreen', 'dsh-app://app/desktop-canvas/view?id=0&viewId=x', { isMainFrame: false }],
    ['fullscreen', canvas, { isMainFrame: false, embeddingOrigin: 'https://bad/', securityOrigin: 'dsh-app://app' }],
    ['clipboard-read', 'dsh-app://app/', { isMainFrame: true }],
    ['camera', 'dsh-app://app/', { isMainFrame: true }],
    ['pointerLock', 'dsh-app://app/', { isMainFrame: true }],
    ['fullscreen', 'dsh-app://app:7443/', { isMainFrame: true }],
    ['fullscreen', 'dsh-app://user@app/', { isMainFrame: true }],
    ['fullscreen', canvas, { isMainFrame: false, embeddingOrigin: '' }],
    ['fullscreen', canvas, { isMainFrame: false, securityOrigin: 'dsh-app://app:7443' }],
  ] as const) expect(insightPermissionAllowed(permission, url, details)).toBe(false)
})

it('uses official audio only for the current owner and rejects stale asynchronous callbacks', async () => {
  vi.stubGlobal('process', { ...process, platform: 'darwin' })
  const checks = vi.fn<Session['setPermissionCheckHandler']>(), requests = vi.fn<Session['setPermissionRequestHandler']>()
  let topUrl = 'dsh-app://app/'
  const primary = { isDestroyed: () => false, getURL: () => topUrl } as WebContents
  let current: WebContents | undefined = primary
  installInsightPermissions({ setPermissionCheckHandler: checks, setPermissionRequestHandler: requests }, () => current)
  const check = checks.mock.calls[0]![0]!, request = requests.mock.calls[0]![0]!, done = vi.fn()
  expect(check(primary, 'media', 'dsh-app://app', { isMainFrame: true, mediaType: 'audio', requestingUrl: 'dsh-app://app/' })).toBe(true)
  expect(check(primary, 'media', 'dsh-app://app', { isMainFrame: true, mediaType: 'video', requestingUrl: 'dsh-app://app/' })).toBe(false)
  for (const [origin, details] of [
    ['', { isMainFrame: true, mediaType: 'audio', requestingUrl: 'dsh-app://app/' }],
    ['dsh-app://app:7443', { isMainFrame: true, mediaType: 'audio', requestingUrl: 'dsh-app://app/' }],
    ['dsh-app://app', { isMainFrame: true, mediaType: 'audio', requestingUrl: 'https://bad/' }],
    ['dsh-app://app', { isMainFrame: true, mediaType: 'audio' }],
    ['dsh-app://app', { isMainFrame: true, mediaType: 'audio', requestingUrl: 'dsh-app://app/', securityOrigin: '' }],
  ] as const) expect(check(primary, 'media', origin, details)).toBe(false)
  expect(check({} as WebContents, 'clipboard-sanitized-write', 'dsh-app://app/', { isMainFrame: true })).toBe(false)
  topUrl = 'https://stale.example/'
  expect(check(primary, 'media', 'dsh-app://app', { isMainFrame: true, mediaType: 'audio', requestingUrl: 'dsh-app://app/' })).toBe(false)
  topUrl = 'dsh-app://app/'
  const pending = Promise.withResolvers<boolean>()
  access.askForMediaAccess.mockReturnValueOnce(pending.promise)
  request(primary, 'media', done, { isMainFrame: true, requestingUrl: 'dsh-app://app/', mediaTypes: ['audio'] })
  current = undefined
  pending.resolve(true)
  await pending.promise
  await vi.waitFor(() => { expect(done).toHaveBeenCalledWith(false) })
})

it('requires a unique live direct Canvas child in both installed permission callbacks', () => {
  const checks = vi.fn<Session['setPermissionCheckHandler']>(), requests = vi.fn<Session['setPermissionRequestHandler']>()
  const frames: WebFrameMain[] = []
  const main = { detached: false, isDestroyed: () => false, url: 'dsh-app://app/', origin: 'dsh-app://app',
    frameTreeNodeId: 1, framesInSubtree: frames } as WebFrameMain
  let detached = false, parent: WebFrameMain = main
  let origin = 'dsh-app://app', destroyed = false
  const child = { get detached() { return detached }, isDestroyed: () => destroyed, get origin() { return origin },
    url: canvas, get parent() { return parent } } as WebFrameMain
  frames.push(main, child)
  const primary = { isDestroyed: () => false, getURL: () => main.url, mainFrame: main } as WebContents
  let current: WebContents | undefined = primary
  installInsightPermissions({ setPermissionCheckHandler: checks, setPermissionRequestHandler: requests }, () => current)
  const check = checks.mock.calls[0]![0]!, request = requests.mock.calls[0]![0]!
  const details = { isMainFrame: false, requestingUrl: canvas }
  const ask = () => {
    const done = vi.fn<(allowed: boolean) => void>()
    request(primary, 'fullscreen', done, details)
    expect(done).toHaveBeenCalledTimes(1)
    return done.mock.calls[0]![0]
  }
  expect(check(primary, 'fullscreen', 'dsh-app://app', details)).toBe(true)
  expect(ask()).toBe(true)
  parent = { frameTreeNodeId: 1 } as WebFrameMain
  expect(ask()).toBe(true)
  expect(check(primary, 'fullscreen', 'dsh-app://app', { ...details, embeddingOrigin: 'https://external.example' })).toBe(false)
  parent = { frameTreeNodeId: 2, url: 'https://external.example' } as WebFrameMain
  expect(check(primary, 'fullscreen', 'dsh-app://app', details)).toBe(false)
  expect(ask()).toBe(false)
  parent = main
  detached = true
  expect(ask()).toBe(false)
  detached = false
  destroyed = true
  expect(ask()).toBe(false)
  destroyed = false
  origin = 'null'
  expect(ask()).toBe(false)
  origin = 'dsh-app://app'
  frames.push(child)
  expect(ask()).toBe(false)
  frames.pop()
  current = undefined
  expect(ask()).toBe(false)
})

it('rejects malformed request media before asking the operating system', () => {
  access.askForMediaAccess.mockClear()
  const checks = vi.fn<Session['setPermissionCheckHandler']>(), requests = vi.fn<Session['setPermissionRequestHandler']>()
  const primary = { isDestroyed: () => false, getURL: () => 'dsh-app://app/' } as WebContents
  installInsightPermissions({ setPermissionCheckHandler: checks, setPermissionRequestHandler: requests }, () => primary)
  const request = requests.mock.calls[0]![0]!, done = vi.fn()
  for (const details of [
    { isMainFrame: false, requestingUrl: 'dsh-app://app/', mediaTypes: ['audio'] },
    { isMainFrame: true, requestingUrl: 'https://bad/', mediaTypes: ['audio'] },
    { isMainFrame: true, requestingUrl: 'dsh-app://app/', mediaTypes: ['audio'], embeddingOrigin: '' },
  ]) request(primary, 'media', done, details)
  expect(done).toHaveBeenCalledTimes(3)
  expect(done).toHaveBeenLastCalledWith(false)
  expect(access.askForMediaAccess).not.toHaveBeenCalled()
})
