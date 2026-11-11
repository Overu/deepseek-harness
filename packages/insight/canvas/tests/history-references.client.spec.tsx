// @vitest-environment jsdom
/** Historical Canvas references rendered through the real Chat registrations. */
import { useState, type ReactNode } from 'react'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { contextMenuHook, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { PropsRenderFactories, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeViewProps, UserContentInput } from '@deepseek-ai/dsh-client-ui-chat/client'
import { en, NS, zh } from '@deepseek-ai/dsh-client-ui-chat/src/client/locale.ts'
import { CHAT_NODE_INJECT } from '@deepseek-ai/dsh-client-ui-chat/src/client/apply.ts'
import { UserTextRegistry } from '@deepseek-ai/dsh-client-ui-conversation/src/client/conversation/user-text-registry.ts'
import { UserText, PlainUserText } from '@deepseek-ai/dsh-client-ui-conversation/src/client/user-text/UserText.tsx'
import { registerChatNodeRenderers } from '@deepseek-ai/dsh-client-ui-chat/src/client/chat/register-node-renderers.ts'
import { apply as applyAttachment, inject as injectAttachment } from '@deepseek-ai/dsh-client-ui-attachment/client'
import { en as conversationEn, zh as conversationZh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { UserContent } from '@deepseek-ai/dsh-client-ui-chat/src/client/chat/UserContent.tsx'
import { derivePresentationPolicy } from '@deepseek-ai/dsh-client-ui-chat/src/client/presentation-policy.ts'
import { registerCanvasReferenceMessageViews } from '../src/client/CanvasReferenceMessage.tsx'
import { serializeNodeRefs } from '../src/shared/canvas-node-references.ts'

afterEach(cleanup)

type Seats = PropsRenderSlots<'conversation.chat.node'> & PropsRenderFactories
type Node = ChatNodeViewProps<'user' | 'steering'>['node']
const source = { kind: 'user', principal: { kind: 'share-viewer', shareId: 'share', actor: { subjectId: 'viewer' } } }
const tag = serializeNodeRefs([{ canvasId: '2873', nodeId: 'node1', title: '参考节点', type: 'text', data: { value: '预览内容' }, products: [{ kind: 'text', value: '预览内容' }] }])

function message(content: Node['data']['content'], kind: 'user' | 'steering' = 'user'): Node {
  return {
    id: '7', key: 'fixture:7', kind, target: 'chat', anchorSeq: 7, location: { kind: 'session' }, visibility: 'visible',
    data: { kind, seq: 7, time: 7_000, source, content, ...(kind === 'steering' ? { messageId: 'steering-7' } : {}) },
  } as Node
}

async function bench(canvasFirst = false) {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  locale.register('common', { en: commonEn, zh: commonZh })
  locale.register(NS, { en, zh })
  locale.register('conversation', { en: conversationEn, zh: conversationZh })
  locale.setLocale('zh')
  runtime.slots.installLocale(locale)
  runtime.ctx.provide('fileDrag', {
    actions: { prepare: async () => ({ start: () => true, release: () => {} }), reportFailure: () => {} }, read: () => undefined,
  } satisfies import('@deepseek-ai/cordis').Context['fileDrag'])
  runtime.ctx.provide('contextMenus', { open: vi.fn() } as never)
  runtime.slots.provideRoot({ props: {
    useContextMenu: contextMenuHook((target, point) => { runtime.ctx.contextMenus.open(target, point) }),
  } })
  const openResource = vi.fn()
  runtime.ctx.provide('sidebarRight', { openResource } as never)
  const earlyCanvas = canvasFirst ? await runtime.mount({ inject: ['slots'], apply: registerCanvasReferenceMessageViews }) : undefined
  const captured: { seats?: Seats; update?: (content: ReactNode) => void } = {}
  await runtime.root.declare({ 'conversation.chat.node': { kind: 'keyed', scope: 'session', inject: CHAT_NODE_INJECT } }, function TestRoot(props) {
    const [content, update] = useState<ReactNode>(null)
    captured.seats = props
    captured.update = update
    return content
  })
  await runtime.mount({ inject: ['slots'], apply: (ctx) => {
    registerChatNodeRenderers(ctx, createSnapshotStore('detailed'), derivePresentationPolicy(
      createSnapshotStore('detailed'), createSnapshotStore('completion'), createSnapshotStore('all'),
    ))
    ctx.slots.registerFactory({ name: 'conversation.chat.user.content', scope: 'session', locale: NS,
      children: { 'conversation.chat.user.images': { kind: 'single', scope: 'session' } },
    }, UserContent)
    const userText = new UserTextRegistry(ctx)
    ctx.slots.registerFactory({ name: 'conversation.user.text', scope: 'session',
      children: { 'conversation.user.text.node': { kind: 'keyed', scope: 'session', inline: true } },
      inject: () => ({
        hooks: { userTextRevision: { getSnapshot: () => userText.getSnapshot(), subscribe: listener => userText.subscribe(listener) } },
        createUserTextEvaluator: () => userText.createEvaluator(),
        reportTransformFailure: (error: unknown): never => { throw error },
      }),
    }, UserText)
    ctx.slots.register({ name: 'conversation.user.text.node', key: 'text' }, PlainUserText)
    ctx.slots.inject('conversation.chat.user.before', () => ctx.slots.register({
      name: 'conversation.chat.user.before', select: ({ source: value }) => value === source ? true : null,
    }, function Source() { return <span data-test-origin>来自会话分享</span> }))
  } })
  await runtime.mount({ inject: injectAttachment, apply: applyAttachment })
  const canvas = earlyCanvas ?? await runtime.mount({ inject: ['slots'], apply: registerCanvasReferenceMessageViews })
  await runtime.sessions.add({ id: 'canvas-history' })
  const session = runtime.sessions.retainFor(runtime.ctx, SessionId('canvas-history'))
  const view = runtime.renderRoot()
  const { seats, update } = captured
  if (seats === undefined || update === undefined) throw new Error('History fixture did not mount')
  const { SessionProvider } = seats
  const loadImage = vi.fn<UserContentInput['loadImage']>(async () => 'blob:history-image')
  const show = (node: Node): void => { act(() => { update(<SessionProvider session={session}>
    {node.kind === 'user'
      ? seats.renderSlot('conversation.chat.node', { node, loadImage, openFile: vi.fn(), inspectCall: undefined, forkAt: vi.fn() }, { entryKey: 'user', hookContext: { turnData: undefined, disclosureReset: createSnapshotStore(0), useGroupAction: () => ({ current: null }) } })
      : seats.renderSlot('conversation.chat.node', { node, loadImage, openFile: vi.fn(), inspectCall: undefined, forkAt: vi.fn() }, { entryKey: 'steering', hookContext: { turnData: undefined, disclosureReset: createSnapshotStore(0), useGroupAction: () => ({ current: null }) } })}
  </SessionProvider>) }) }
  return { view, show, canvas, runtime, openResource, loadImage }
}

it.each([false, true])('restores previews, navigation and copy without rewriting history (Canvas first: %s)', async (canvasFirst) => {
  const b = await bench(canvasFirst)
  const node = message([{ type: 'text', text: '历史正文' }, { type: 'text', text: tag }])
  const original = JSON.stringify(node)
  const writeText = vi.fn(async () => {})
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  onTestFinished(() => {
    if (originalClipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard')
    else Object.defineProperty(navigator, 'clipboard', originalClipboard)
  })
  b.show(node)
  expect(b.view.container.querySelector('[data-canvas-reference-message]')).not.toBeNull()
  expect(b.view.container.textContent).not.toContain('<node-refs')
  expect(b.view.getByText('来自会话分享')).toBeTruthy()
  expect(b.view.getAllByRole('button', { name: '复制' })).toHaveLength(1)
  fireEvent.click(b.view.getByRole('button', { name: '复制' }))
  await waitFor(() => { expect(writeText).toHaveBeenCalledWith('历史正文') })
  const reference = b.view.getByRole('button', { name: '参考节点' })
  fireEvent.pointerEnter(reference)
  await waitFor(() => { expect(b.view.getByText('预览内容')).toBeTruthy() })
  fireEvent.click(reference)
  expect(b.openResource).toHaveBeenCalledWith(expect.any(String), { params: { nodeId: 'node1' } })
  expect(JSON.stringify(node)).toBe(original)
  expect({ body: b.view.getByText('历史正文').textContent, reference: reference.getAttribute('aria-label'), source: b.view.getByText('来自会话分享').textContent }).toMatchInlineSnapshot(`
    {
      "body": "历史正文",
      "reference": "参考节点",
      "source": "来自会话分享",
    }
  `)
})

it('keeps steering references and file attachments without adding user-source decoration', async () => {
  const b = await bench()
  b.show(message([{ type: 'text', text: '追问正文' }, { type: 'file', attachment: {
    attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`), name: 'history.txt', bytes: 10,
  } }, { type: 'text', text: tag }], 'steering'))
  expect(b.view.getByRole('button', { name: '参考节点' })).toBeTruthy()
  expect(b.view.getAllByText('history.txt')).toHaveLength(1)
  expect(b.view.queryByText('来自会话分享')).toBeNull()
  expect(b.view.getAllByRole('button', { name: '复制' })).toHaveLength(1)
  expect(b.view.container.textContent).not.toContain('<node-refs')
})

it('loads historical images once through the authorized loader beside references', async () => {
  const b = await bench()
  const image = { attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`), mediaType: 'image/png' as const, bytes: 68, width: 32, height: 32, name: 'history.png' }
  b.show(message([{ type: 'image', attachment: image }, { type: 'text', text: tag }]))
  await waitFor(() => { expect(b.loadImage).toHaveBeenCalledExactlyOnceWith(image) })
  expect(b.view.container.querySelectorAll('img[src="blob:history-image"]')).toHaveLength(1)
  expect(b.view.getAllByRole('button', { name: '参考节点' })).toHaveLength(1)
})

it('leaves plain messages and unknown or damaged reference tags visible', async () => {
  const b = await bench()
  for (const text of ['普通正文', '<node-refs version="2">unknown</node-refs>', '<node-refs version="1">broken</node-refs>']) {
    b.show(message([{ type: 'text', text }]))
    expect(b.view.getByText(text)).toBeTruthy()
    expect(b.view.container.querySelector('[data-canvas-reference-message]')).toBeNull()
    expect(b.view.getByText('来自会话分享')).toBeTruthy()
  }
})

it('restores the native row when Canvas is disposed and remounts cleanly', async () => {
  const b = await bench()
  const node = message([{ type: 'text', text: tag }])
  b.show(node)
  expect(b.view.getByRole('button', { name: '参考节点' })).toBeTruthy()
  await act(async () => { await b.canvas.dispose() })
  expect(b.view.container.querySelector('[data-canvas-reference-message]')).toBeNull()
  expect(b.view.container.textContent).toContain('<node-refs')
  const canvas = await b.runtime.mount({ inject: ['slots'], apply: registerCanvasReferenceMessageViews })
  b.show(node)
  expect(b.view.getAllByRole('button', { name: '参考节点' })).toHaveLength(1)
  await act(async () => { await canvas.dispose() })
})
