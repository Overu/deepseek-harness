/** Insight's least-privilege renderer permission policy. */
import type { Session, WebContents } from 'electron'
import { installMicrophonePermissions } from './microphone-permissions.ts'

const CANVAS_PATH = '/desktop-canvas/view'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const MAX_CANVAS_ID = 9_223_372_036_854_775_807n

interface PermissionDetails {
  isMainFrame?: boolean
  mediaType?: string
  mediaTypes?: string[]
  requestingUrl?: string
  embeddingOrigin?: string
  securityOrigin?: string
}

function appDocument(url: string | undefined): boolean {
  try {
    const parsed = new URL(url ?? '')
    return canonicalAppOrigin(parsed) && (parsed.pathname === '/' || parsed.pathname === '/index.html')
  } catch { return false }
}

function canvasDocument(url: string | undefined): boolean {
  try {
    const parsed = new URL(url ?? '')
    return canonicalAppOrigin(parsed) && parsed.pathname === CANVAS_PATH
      && canvasId(parsed.searchParams.get('id')) && UUID.test(parsed.searchParams.get('viewId') ?? '')
  } catch { return false }
}

function canvasId(value: string | null): boolean {
  return value !== null && /^[1-9][0-9]*$/u.test(value) && BigInt(value) <= MAX_CANVAS_ID
}

function canonicalAppOrigin(parsed: URL): boolean {
  return parsed.protocol === 'dsh-app:' && parsed.hostname === 'app' && parsed.port === ''
    && parsed.username === '' && parsed.password === ''
}

function checkOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin)
    return canonicalAppOrigin(parsed) && (parsed.pathname === '' || parsed.pathname === '/')
  } catch { return false }
}

function optionalAppOrigin(origin: string | undefined): boolean {
  return origin === undefined || checkOrigin(origin)
}

/**
 * Decide non-media access after the owning window and native frame tree are checked.
 * @param permission - Electron permission name.
 * @param url - Browser-reported requesting document URL.
 * @param details - Available browser origin and frame fields.
 * @param ownedCanvasFrame - Whether a unique direct Canvas child belongs to the current main frame.
 * @returns whether the requested clipboard write or fullscreen operation is permitted.
 */
export function insightPermissionAllowed(permission: string, url: string, details: PermissionDetails, ownedCanvasFrame = false): boolean {
  if (!optionalAppOrigin(details.embeddingOrigin) || !optionalAppOrigin(details.securityOrigin)) return false
  const main = details.isMainFrame === true && appDocument(url)
  const canvas = ownedCanvasFrame && details.isMainFrame === false && canvasDocument(url)
  if (permission === 'clipboard-sanitized-write' || permission === 'fullscreen') return main || canvas
  return false
}

function ownsCanvasFrame(contents: WebContents, url: string): boolean {
  if (!canvasDocument(url)) return false
  try {
    const main = contents.mainFrame
    if (main.detached || main.isDestroyed() || !appDocument(main.url) || !checkOrigin(main.origin)) return false
    const matches = main.framesInSubtree.filter(frame => !frame.detached && !frame.isDestroyed() && frame.url === url)
    const frame = matches.length === 1 ? matches[0] : undefined
    return frame !== undefined && checkOrigin(frame.origin) && frame.parent?.frameTreeNodeId === main.frameTreeNodeId
  } catch (_error) { return false /* A detached native frame cannot establish its requesting document. */ }
}

/** Install Insight handlers while preserving the official primary-frame audio flow. */
export function installInsightPermissions(
  session: Pick<Session, 'setPermissionCheckHandler' | 'setPermissionRequestHandler'>,
  primary: () => WebContents | undefined,
): void {
  type CheckHandler = Parameters<Session['setPermissionCheckHandler']>[0]
  type RequestHandler = Parameters<Session['setPermissionRequestHandler']>[0]
  let officialCheck: CheckHandler | undefined
  let officialRequest: RequestHandler | undefined
  installMicrophonePermissions({
    setPermissionCheckHandler: (handler) => { officialCheck = handler },
    setPermissionRequestHandler: (handler) => { officialRequest = handler },
  }, primary)
  const owned = (contents: WebContents | null | undefined): contents is WebContents => contents !== undefined && contents !== null
    && contents === primary() && !contents.isDestroyed() && appDocument(contents.getURL())
  session.setPermissionCheckHandler((contents, permission, origin, details) => {
    if (!owned(contents)) return false
    if (!checkOrigin(origin)) return false
    if (!optionalAppOrigin(details.embeddingOrigin) || !optionalAppOrigin(details.securityOrigin)) return false
    if (permission === 'media') {
      if (!details.isMainFrame || !appDocument(details.requestingUrl)) return false
      return officialCheck?.(contents, permission, origin, details) ?? false
    }
    const url = details.requestingUrl ?? origin
    return insightPermissionAllowed(permission, url, details, ownsCanvasFrame(contents, url))
  })
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!owned(contents)) { callback(false); return }
    const url = details.requestingUrl
    const fields: PermissionDetails = details
    if (permission !== 'media') {
      callback(insightPermissionAllowed(permission, url, details, ownsCanvasFrame(contents, url)))
      return
    }
    if (!details.isMainFrame || !appDocument(url)
      || !optionalAppOrigin(fields.embeddingOrigin) || !optionalAppOrigin(fields.securityOrigin)) { callback(false); return }
    if (officialRequest == null) { callback(false); return }
    officialRequest(contents, permission, (allowed) => { callback(allowed && owned(contents)) }, details)
  })
}
