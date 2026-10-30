import { registerCanvasMessageLinks } from './CanvasMessageLinks.tsx'
import { createCanvasOpener } from './canvas-open.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CanvasCreatedLinks } from './CanvasCreatedLinks.tsx'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import { CanvasResultsStore, canvasResultsDefinition } from './canvas-results.ts'
import { CanvasResults, CANVAS_RESULTS_NS, resultsZh, resultsEn } from './CanvasResults.tsx'
import { canvasAddress, canvasIdFromAddress, parseCanvasId } from '../shared/protocol.ts'
import { CanvasTab } from './CanvasTab.tsx'
import { installCanvasRuntime } from './canvas-service.ts'
import { createCanvasClientBridge } from './canvas-bridge.ts'
import { CanvasAgentError } from '../shared/canvas-agent-protocol.ts'
import { CanvasNodeReferences } from './canvas-node-references.ts'
import { CANVAS_REFERENCES_NS, referencesEn, referencesZh } from './CanvasReferenceDock.tsx'
import { registerCanvasComposerAttachments } from './CanvasComposerAttachments.tsx'
import { registerCanvasReferenceMessageViews } from './CanvasReferenceMessage.tsx'
import { toReferenceItems } from '../shared/canvas-node-references.ts'

const PACKAGE_ID = '@insight-ai/desktop-canvas-plugin'

export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'uiConversation', 'locale']

export function apply(ctx: Context): void {
  registerCanvasMessageLinks(ctx)
  registerCanvasReferenceMessageViews(ctx)
  const references = new CanvasNodeReferences()
  ctx.effect(() => () =>{  references.reset() }, 'desktop-canvas: reference drafts')
  ctx.on('connection/reset', () =>{  references.reset() })
  ctx.effect(() => ctx.locale.register(CANVAS_REFERENCES_NS, { zh: referencesZh, en: referencesEn }), 'desktop-canvas: reference copy')
  registerCanvasComposerAttachments(ctx, references)
  const results = new CanvasResultsStore({ origin: window.location.origin })
  ctx.effect(() => () =>{  results.dispose() }, 'desktop-canvas: result sources')
  ctx.on('connection/reset', () =>{  results.reset() })
  ctx.uiConversation.events.register(canvasResultsDefinition)
  ctx.effect(() => ctx.locale.register(CANVAS_RESULTS_NS, { zh: resultsZh, en: resultsEn }), 'desktop-canvas: result copy')
  ctx.effect(() => ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail', id: PACKAGE_ID + '-results', locale: CANVAS_RESULTS_NS,
    inject: sessionId => ({ canvasResultsSessionId: String(sessionId), results, openCanvasResult: (id: string, nodeId?: string) => {
      const canvasId = parseCanvasId(id)
      if (canvasId) ctx.sidebarRight.openResource(canvasAddress(canvasId), { params: { nodeId } })
    } }),
  }, CanvasResults)), 'desktop-canvas: result entry')
  ctx.effect(() => ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail', id: PACKAGE_ID + '-created', locale: CANVAS_RESULTS_NS,
    inject: sessionId => ({
      getCanvasChat: () => ctx.uiConversation.binding(sessionId).target('chat'),
      openCreatedCanvas: (id: string) => { const canvasId = parseCanvasId(id)
        if (canvasId) ctx.sidebarRight.openResource(canvasAddress(canvasId)) },
    }),
  }, CanvasCreatedLinks)), 'desktop-canvas: created canvas entry')
  ctx.effect(() => installCanvasRuntime(), 'desktop-canvas: service runtime')
  const opener = createCanvasOpener({ currentSession: () => { const id = ctx.sidebarRight.mounted.getSnapshot()
    return id === undefined ? undefined : String(id) },
  open: (id, nodeId, navigationId) => {
    const canvasId = parseCanvasId(id)
    if (!canvasId) throw new CanvasAgentError('INVALID_ARGUMENT', '画布地址无效')
    ctx.sidebarRight.openResource(canvasAddress(canvasId), { params: {
      nodeId, selectNode: false, navigationId } }) } })
  ctx.effect(() => () =>{  opener.dispose() }, 'desktop-canvas: opener')
  const bridge = createCanvasClientBridge({ openCanvas: (session, canvas, node) => opener.open(session, canvas, node),
    origin: window.location.origin, getRuntime: async () => {
      const handle = window.__INSIGHT_CANVAS_RUNTIME_V1__
      if (!handle) throw new CanvasAgentError('CLIENT_UNAVAILABLE', '画布服务尚未安装')
      return handle.ready
    } })
  ctx.effect(() => () =>{  bridge.dispose() }, 'desktop-canvas: client bridge')
  const syncedSessions = new Set<string>()
  ctx.effect(() => bridge.onReferencesConsumed((sessionId) => {
    references.clear(sessionId)
  }), 'desktop-canvas: references consumption')
  ctx.effect(() => references.subscribe(() => {
    const currentSessions = new Set(references.getSessionIds())
    for (const sessionId of currentSessions) {
      syncedSessions.add(sessionId)
      bridge.syncReferences(sessionId, toReferenceItems(references.getSnapshot(sessionId).references))
    }
    for (const sessionId of syncedSessions) {
      if (!currentSessions.has(sessionId)) {
        syncedSessions.delete(sessionId)
        bridge.syncReferences(sessionId, [])
      }
    }
  }), 'desktop-canvas: references bridge sync')
  ctx.effect(() => {
    let sessionId: SessionId | undefined, release: (() => void) | undefined
    const sync = () => {
      const next = ctx.sidebarRight.mounted.getSnapshot()
      if (next === sessionId) return
      release?.(); release = undefined; sessionId = next
      if (next !== undefined) {
        try { release = bridge.retainSession(String(next)) }
        catch (error) { console.error('Canvas session binding failed:', error) }
      }
    }
    const unsubscribe = ctx.sidebarRight.mounted.subscribe(sync)
    sync()
    return () => { unsubscribe(); release?.() }
  }, 'desktop-canvas: session bridge')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PACKAGE_ID,
    kind: 'desktop-canvas',
    patterns: ['dsh-resource://canvas/*'],
    canOpen: address => canvasIdFromAddress(address) !== undefined,
    title: address => `画布 ${canvasIdFromAddress(address) ?? ''}`,
  }), 'desktop-canvas: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: PACKAGE_ID,
    inject: sessionId => ({ references, referenceSessionId: String(sessionId), onCanvasNavigation: (id: string,
      status) => { opener.settled(id, status) } }),
  }, CanvasTab)), 'desktop-canvas: tab body')
}
