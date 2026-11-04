/** Keyless cold replay preserves Canvas references, native assistant content, and footer navigation. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, launchWebScaffold,
  readPersistedEvents, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { expandTurnProcesses, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/canvas-history', import.meta.url))
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/canvas-history/session.v4.jsonl', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('../../../snapshots/web/canvas-history/ui.expected.md', import.meta.url))
const PROFILE_FIXTURE = fileURLToPath(new URL('./fixtures/canvas-history', import.meta.url))
const CANVAS_BUNDLE = fileURLToPath(new URL('../../../packages/insight/canvas', import.meta.url))
const SESSION_ID = 'canvas-history-web-e2e'
const MODE = webSnapshotMode()
const VALID_TAG = '<node-refs version="1">\n{"version":1,"nodes":[{"canvasId":"2873","nodeId":"node-1","title":"历史节点","type":"text","data":{"value":"历史节点正文"},"products":[{"kind":"text","value":"历史节点正文"}]}]}\n</node-refs>'
const INVALID_TAG = '<node-refs version="1">\nnot json\n</node-refs>'

describe.skipIf(MODE === 'record')('web e2e: Canvas history', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const renderErrors: string[] = []
  let priorEnvironment: string | undefined
  let seededEvents: Awaited<ReturnType<typeof readPersistedEvents>>

  function restoreEnvironment(): void {
    if (priorEnvironment === undefined) delete process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT
    else process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT = priorEnvironment
  }

  beforeAll(async () => {
    // Canvas validates this Desktop-owned setting when its real Host bundle starts.
    priorEnvironment = process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT
    process.env.DSH_INSIGHT_SERVICE_ENVIRONMENT = 'test'
    scaffold = await launchWebScaffold({
      profile: { hmr: false, packages: [{ dir: PROFILE_FIXTURE, enabled: true }, { dir: CANVAS_BUNDLE, enabled: true }] },
    })
    await scaffold.ctx.settings.update('ui-chat', { transcriptView: 'detailed' })
    await seedSession(scaffold, await readFile(FIXTURE, 'utf8'), SESSION_ID)
    seededEvents = await readPersistedEvents(scaffold, SessionId(SESSION_ID))
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    page.on('console', (message) => {
      if (message.type() === 'error' && /usePresentation|Slot|React/i.test(message.text())) renderErrors.push(message.text())
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  }, 120_000)

  afterAll(async () => {
    try { await browser?.close() } finally {
      try { await scaffold?.close() } finally { restoreEnvironment() }
    }
  })

  it('preserves references and native replies, opens the footer Canvas link, and does not rewrite the recording', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-canvas-history'))
    await page.locator('[role="treeitem"]').first().click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 15_000 })
    await sessionRow.click()
    const reference = page.getByRole('button', { name: '历史节点', exact: true })
    await reference.waitFor({ state: 'visible', timeout: 15_000 })
    await expect.poll(() => page.locator('[data-canvas-reference-message]').count(), { timeout: 10_000 }).toBe(1)
    expect(await page.getByText(VALID_TAG, { exact: true }).count()).toBe(0)
    const invalidBubble = page.locator('[data-message-bubble]').filter({ hasText: 'not json' })
    await invalidBubble.waitFor({ state: 'visible', timeout: 15_000 })
    expect(await invalidBubble.innerText()).toContain(INVALID_TAG)
    await page.getByText('画布已经创建，可以继续编辑内容。', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
    await expandTurnProcesses(page)
    await page.getByText('当前画布 ID：103334。', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
    await page.getByText('可以继续在画布上操作。', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
    expect(await page.locator('[data-canvas-id-answer]').count()).toBe(0)
    const thinking = page.locator('[data-variant="think"]')
    await thinking.waitFor({ state: 'visible', timeout: 15_000 })
    await thinking.getByRole('button').first().click()
    await page.getByText('需要给出可点击的画布地址。', { exact: true }).waitFor({ state: 'visible' })
    const links = page.locator('[data-canvas-created-links]')
    await expect.poll(() => links.getByRole('link', { name: '103334', exact: true }).count()).toBe(1)
    expect(await links.getByRole('link').count()).toBe(1)
    await page.route(/\/desktop-canvas\/view\?/, route => route.fulfill({ contentType: 'text/html', body: '' }))
    await links.getByRole('link', { name: '103334', exact: true }).click()
    const frame = page.locator('iframe[title="画布 103334"]')
    await frame.waitFor({ state: 'attached', timeout: 15_000 })
    expect(await frame.getAttribute('src')).toMatch(/\/desktop-canvas\/view\?id=103334&viewId=/)
    const renderedEvents = await readPersistedEvents(scaffold, SessionId(SESSION_ID))
    // Opening a seeded session appends `session/end-seed`; original events and user content stay unchanged.
    expect(renderedEvents.slice(0, seededEvents.length)).toEqual(seededEvents)
    expect(renderedEvents.slice(seededEvents.length).map(event => ({ type: event.type, data: event.data })))
      .toEqual([{ type: 'session/end-seed', data: {} }])
    await compareOrRefreshGolden(UI_EXPECTED,
      await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd), MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(renderErrors).toEqual([])
  })

  it('keeps the recorded-session inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.v4.jsonl', 'ui.expected.md'])
  })
})
