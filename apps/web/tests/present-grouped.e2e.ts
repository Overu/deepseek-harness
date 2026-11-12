/** Recorded deliveries from two source images remain separate in the completed turn. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/present-grouped', import.meta.url))
const MODE = webSnapshotMode()

describe('web e2e: grouped deliveries', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await Promise.all(['first.psd', 'first-1.png', 'first-2.png', 'second.psd', 'second-1.png', 'second-2.png']
      .map(name => writeFile(join(scaffold.workspaceCwd, name), name)))
    await seedSession(scaffold, await readFile(join(SNAPSHOT_DIR, 'session.v4.jsonl'), 'utf8'), 'present-grouped')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[role="treeitem"]').first().click()
    await page.locator('[role="treeitem"]').nth(1).click()
    await page.getByText('GROUPED_DONE', { exact: true }).waitFor()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows one heading and independent expansion for each image', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-present-grouped'))
    const groups = page.locator('[data-turn-tail] [data-grouped]')
    await groups.nth(1).waitFor()
    expect(await groups.count()).toBe(2)
    expect(await groups.nth(0).getByRole('heading').innerText()).toBe('图片 1（草帽人物.png）的处理结果')
    expect(await groups.nth(1).getByRole('heading').innerText()).toBe('图片 2（笔记本.png）的处理结果')
    expect(await groups.nth(0).locator('[data-presented-file]').count()).toBe(2)
    expect(await groups.nth(1).locator('[data-presented-file]').count()).toBe(2)
    const cards = await captureStableAria(page, '[data-turn-tail] div:has(> [data-grouped])', scaffold.workspaceCwd, {
      replacements: [[scaffold.workspaceCwd.replaceAll('\\', '\\\\'), '{{cwd}}']],
    })
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'ui.expected.md'), cards, MODE)
    await groups.nth(0).getByRole('button', { name: 'Show all 3 delivered files' }).click()
    expect(await groups.nth(0).locator('[data-presented-file]').count()).toBe(3)
    expect(await groups.nth(1).locator('[data-presented-file]').count()).toBe(2)
    await groups.nth(1).getByRole('button', { name: 'Show all 3 delivered files' }).click()
    expect(await groups.nth(1).locator('[data-presented-file]').count()).toBe(3)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.v4.jsonl', 'ui.expected.md'])
  })
})
