/** Keyless real-Loader coverage of the skill market, shared overlays, and theme inheritance. */
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { normalizeSkillId } from '../src/shared/skill-identity.ts'
import { CATALOG_FIXTURE } from './fixtures/catalog.ts'
import { compareOrRefreshGolden, launchWebScaffold, webSnapshotMode } from '../../../../apps/web/tests/scaffold.ts'
import { newEnglishPage, writeComposerDraft } from '../../../../apps/web/tests/support.ts'

function fixtureId() {
  const id = normalizeSkillId(CATALOG_FIXTURE.skills[0]?.id)
  if (id === undefined) throw new Error('The fixture requires a catalogue ID')
  return id
}

it('installs configured presets before opening the market and respects removal after reload', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [
      fileURLToPath(new URL('fixtures/download-service.overlay.yml', import.meta.url)),
      fileURLToPath(new URL('fixtures/preset-skills.overlay.yml', import.meta.url)),
    ],
    profile: { packages: [{ dir: fileURLToPath(new URL('..', import.meta.url)), enabled: true }] },
  })
  try {
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.route('https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/skills.json?*',
        route => route.fulfill({ json: { skills: [{
          ...CATALOG_FIXTURE.skills[0],
          download_url: 'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/identity-fixture.zip',
        }] }, headers: { 'Access-Control-Allow-Origin': '*' } }))
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await expect.poll(() => scaffold.ctx.insightPlatformSkills.listInstalled()).toEqual({
        skills: [expect.objectContaining({
          id: fixtureId(), skillName: 'influencer-integration', version: '1.2.0',
        })],
      })
      await page.getByRole('button', { name: 'Skill center', exact: true }).click()
      await page.getByRole('button', { name: 'Installed', exact: true }).waitFor()
      await page.getByRole('button', { name: 'View details', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click()
      await page.getByRole('button', { name: 'Install', exact: true }).waitFor()
      await page.reload({ waitUntil: 'load' })
      await page.getByRole('button', { name: 'Skill center', exact: true }).click()
      await page.getByRole('button', { name: 'Install', exact: true }).waitFor()
      expect(await scaffold.ctx.insightPlatformSkills.listInstalled()).toEqual({ skills: [] })
      expect(await scaffold.ctx.insightPlatformSkills.listPendingPresets([{
        id: fixtureId(), skillName: 'influencer-integration',
      }])).toEqual([])
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})

it('matches a name-only installation after the catalogue gains an ID and retains its key through update and removal', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [
      fileURLToPath(new URL('fixtures/download-service.overlay.yml', import.meta.url)),
      fileURLToPath(new URL('fixtures/preset-skills.overlay.yml', import.meta.url)),
    ],
    profile: { packages: [{ dir: fileURLToPath(new URL('..', import.meta.url)), enabled: true }] },
  })
  try {
    const store = join(scaffold.harnessHome, 'platform-skills')
    const key = 'name-only-installation'
    const skillName = 'influencer-integration'
    const payload = `payloads/${key}/first-release`
    const installedPath = join(store, 'installed', `${key}.json`)
    const historyPath = join(store, 'auto-install-history', `${key}.json`)
    const initialRecord = `${JSON.stringify({ key, skillName, version: '1.0.0', payload })}\n`
    await mkdir(join(store, payload), { recursive: true })
    await writeFile(join(store, payload, 'SKILL.md'), '---\nname: influencer-integration\ndescription: Name-only account installation\n---\n\nRetained installed content.\n')
    await writeFile(installedPath, initialRecord)
    await writeFile(historyPath, JSON.stringify({ key, skillName }))
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.route('https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/skills.json?*',
        route => route.fulfill({ json: { skills: [{
          ...CATALOG_FIXTURE.skills[0],
          download_url: 'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/identity-fixture.zip',
        }] }, headers: { 'Access-Control-Allow-Origin': '*' } }))
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: 'Skill center', exact: true }).click()
      await page.getByRole('button', { name: 'Update', exact: true }).waitFor()
      expect(await readFile(installedPath, 'utf8')).toBe(initialRecord)
      await page.getByRole('button', { name: 'Update', exact: true }).click()
      await page.getByRole('button', { name: 'Installed', exact: true }).waitFor()
      const upgraded: unknown = JSON.parse(await readFile(installedPath, 'utf8'))
      expect(upgraded).toMatchObject({
        key, id: fixtureId(), skillName, version: '1.2.0',
      })
      await page.getByRole('button', { name: 'View details', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click()
      await page.getByRole('button', { name: 'Install', exact: true }).waitFor()
      await expect(stat(installedPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(JSON.parse(await readFile(historyPath, 'utf8'))).toMatchObject({
        key, id: fixtureId(), skillName,
      })
      await page.reload({ waitUntil: 'load' })
      await page.getByRole('button', { name: 'Skill center', exact: true }).click()
      await page.getByRole('button', { name: 'Install', exact: true }).waitFor()
      expect(await scaffold.ctx.insightPlatformSkills.listInstalled()).toEqual({ skills: [] })
      expect(await scaffold.ctx.insightPlatformSkills.listPendingPresets([{
        id: fixtureId(), skillName,
      }])).toEqual([])
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})

it('refreshes skill references in an open historical conversation after installation, update and removal', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [
      fileURLToPath(new URL('fixtures/download-service.overlay.yml', import.meta.url)),
      fileURLToPath(new URL('fixtures/manual-skills.overlay.yml', import.meta.url)),
    ],
    profile: { packages: [{ dir: fileURLToPath(new URL('..', import.meta.url)), enabled: true }] },
  })
  try {
    const sentinel = join(scaffold.workspaceCwd, '.agents', 'skills', 'history-catalog-sentinel')
    await mkdir(sentinel, { recursive: true })
    await writeFile(join(sentinel, 'SKILL.md'), '---\nname: history-catalog-sentinel\ndescription: Historical catalog readiness\n---\n\nWorkspace skill.\n')
    const time = Date.now() - 60_000
    const handle = await scaffold.ctx.sessionPersistence.create({
      version: SESSION_FORMAT_VERSION, id: SessionId('platform-skill-history'), createdAt: time,
      cwd: scaffold.workspaceCwd, isSeeded: false, delegationDepth: 0,
    })
    try {
      await handle.append([
        { type: 'turn/start', seq: SessionSeq(0), time, data: { turn: 1 } },
        { type: 'step/start', seq: SessionSeq(1), time, data: { turn: 1, step: 1 } },
        { type: 'system/message', seq: SessionSeq(2), time, data: { turn: 1, step: 1, message: createSystemMessage('') }, surfaceOp: 'append' },
        { type: 'user/message', seq: SessionSeq(3), time, data: createUserMessage({ content: [{ type: 'text', text: 'Historical skill conversation.' }], source: { kind: 'user' } }), surfaceOp: 'append' },
        { type: 'session/title', seq: SessionSeq(4), time, data: { title: 'Historical skill conversation', messageSeqs: [SessionSeq(3)], source: { kind: 'fallback' } } },
        { type: 'step/end', seq: SessionSeq(5), time, data: { turn: 1, step: 1 } },
        { type: 'turn/end', seq: SessionSeq(6), time, data: { turn: 1, reason: { kind: 'completed' } } },
      ])
    } finally {
      await handle.close()
    }
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.getByRole('treeitem', { name: /^Ungrouped/ }).click()
      await page.locator('[role="treeitem"]').last().click()
      await page.getByText('Historical skill conversation.', { exact: true }).waitFor()
      const input = page.locator('[data-composer-input]').first()
      const draft = '/history-catalog-sentinel /browser-installed-expert /browser-updated-expert review this draft'
      await writeComposerDraft(page, input, draft)
      await input.locator('[data-composer-text-ref]').filter({ hasText: '/history-catalog-sentinel' }).waitFor()
      const reference = input.locator('[data-composer-text-ref]').filter({ hasText: '/browser-installed-expert' })
      const updatedReference = input.locator('[data-composer-text-ref]').filter({ hasText: '/browser-updated-expert' })
      await expect.poll(() => reference.count()).toBe(0)

      const market = await newEnglishPage(browser)
      let version = '1.0.0'
      await market.route('https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/skills.json?*',
        route => route.fulfill({ json: { skills: [{
          ...CATALOG_FIXTURE.skills[0], version,
          skill_id: version === '1.0.0' ? 'browser-installed-expert' : 'browser-updated-expert',
          download_url: 'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/install-fixture.zip',
        }] }, headers: { 'Access-Control-Allow-Origin': '*' } }))
      const openMarket = async (): Promise<void> => {
        await market.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
        await market.getByRole('button', { name: 'Skill center', exact: true }).click()
      }
      await openMarket()
      await market.getByRole('button', { name: 'Install', exact: true }).click()
      await market.getByRole('button', { name: 'Installed', exact: true }).waitFor()
      await page.locator('[data-insight-skill-picker]').getByRole('button').first().click()
      const picker = page.getByRole('listbox', { name: '可选技能', exact: true })
      const installedOption = picker.getByRole('button', { name: /browser-installed-expert/u })
      await installedOption.waitFor()
      await expect.poll(() => installedOption.isEnabled()).toBe(true)
      await page.keyboard.press('Escape')
      await reference.waitFor()
      await reference.click()
      const preview = page.locator('[data-document-markdown]')
      await expect.poll(() => preview.textContent()).toContain('Archive release 1.')
      expect(await input.textContent()).toBe(draft)

      version = '1.1.0'
      await openMarket()
      await market.getByRole('button', { name: 'Update', exact: true }).click()
      await market.getByRole('button', { name: 'Installed', exact: true }).waitFor()
      await page.locator('[data-insight-skill-picker]').getByRole('button').first().click()
      const updatedOption = picker.getByRole('button', { name: /browser-updated-expert/u })
      await updatedOption.waitFor()
      await installedOption.waitFor({ state: 'detached' })
      await expect.poll(() => updatedOption.isEnabled()).toBe(true)
      await page.keyboard.press('Escape')
      await reference.waitFor({ state: 'detached' })
      await updatedReference.waitFor()
      await updatedReference.click()
      await expect.poll(() => preview.textContent()).toContain('Archive release 2.')
      expect(await input.textContent()).toBe(draft)

      await page.locator('[data-insight-skill-picker]').getByRole('button').first().click()
      await updatedOption.waitFor()
      await market.getByRole('button', { name: 'View details', exact: true }).click()
      await market.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click()
      await market.getByRole('button', { name: 'Install', exact: true }).waitFor()
      await updatedReference.waitFor({ state: 'detached' })
      await updatedOption.waitFor({ state: 'detached' })
      const emptyPicker = page.getByRole('dialog', { name: '选择技能' })
      await emptyPicker.getByText('没有匹配的技能', { exact: true }).waitFor()
      const openSkillCenter = emptyPicker.getByRole('button', { name: 'Go to skill center', exact: true })
      await openSkillCenter.waitFor()
      await compareOrRefreshGolden(fileURLToPath(new URL('expected/picker-empty.expected.md', import.meta.url)),
        await emptyPicker.ariaSnapshot(), webSnapshotMode())
      for (const theme of ['light', 'dark']) {
        await page.evaluate(value => document.body.toggleAttribute('data-ds-dark-theme', value === 'dark'), theme)
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1000 })
          await expect.poll(() => openSkillCenter.evaluate((element) => {
            const scroll = element.parentElement?.parentElement
            if (scroll === null || scroll === undefined || getComputedStyle(scroll).overflowY !== 'auto') return false
            const action = element.getBoundingClientRect()
            const area = scroll.getBoundingClientRect()
            return action.x >= area.x && action.right <= area.right && action.y >= area.y && action.bottom <= area.bottom
              && area.x >= 0 && area.right <= innerWidth
          })).toBe(true)
        }
      }
      expect(await input.textContent()).toBe(draft)
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.route('https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/skills.json?*',
        route => route.fulfill({ json: CATALOG_FIXTURE, headers: { 'Access-Control-Allow-Origin': '*' } }))
      await openSkillCenter.click()
      await emptyPicker.waitFor({ state: 'detached' })
      await page.getByRole('region', { name: 'Skill center', exact: true }).waitFor()
      await page.reload({ waitUntil: 'load' })
      await page.locator('[role="treeitem"]').last().click()
      await page.getByText('Historical skill conversation.', { exact: true }).waitFor()
      expect(await input.locator('[data-composer-text-ref]').filter({ hasText: '/browser-installed-expert' }).count()).toBe(0)
      expect(await input.locator('[data-composer-text-ref]').filter({ hasText: '/browser-updated-expert' }).count()).toBe(0)
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})

it('installs, updates and removes a skill through the real Remote API', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [
      fileURLToPath(new URL('../../../../apps/web/tests/pin-browse-picker.overlay.yml', import.meta.url)),
      fileURLToPath(new URL('fixtures/download-service.overlay.yml', import.meta.url)),
      fileURLToPath(new URL('fixtures/manual-skills.overlay.yml', import.meta.url)),
    ],
    profile: { packages: [{ dir: fileURLToPath(new URL('..', import.meta.url)), enabled: true }] },
  })
  try {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ locale: 'zh-CN' })
      let version = '1.0.0'
      await page.route('https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/skills.json?*',
        route => route.fulfill({ json: { skills: [{
          ...CATALOG_FIXTURE.skills[0], version,
          skill_id: version === '1.0.0' ? 'browser-installed-expert' : 'browser-updated-expert',
          download_url: 'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/install-fixture.zip',
        }] }, headers: { 'Access-Control-Allow-Origin': '*' } }))
      const openMarket = async (): Promise<void> => {
        await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
        await page.getByRole('button', { name: '技能中心', exact: true }).click()
      }
      await openMarket()
      await page.getByRole('button', { name: '安装', exact: true }).click()
      await page.getByRole('button', { name: '已安装', exact: true }).waitFor()
      await expect.poll(() => page.getByRole('button', { name: '已安装', exact: true }).isDisabled()).toBe(true)
      version = '1.1.0'
      await openMarket()
      await page.getByRole('button', { name: '更新', exact: true }).click()
      await page.getByRole('button', { name: '已安装', exact: true }).waitFor()
      await page.getByRole('button', { name: '查看详情', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: '移除', exact: true }).click()
      await page.getByRole('button', { name: '安装', exact: true }).waitFor()
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})

it('browses the OSS catalog through the real shell in both themes and narrow panels', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [
      fileURLToPath(new URL('../../../../apps/web/tests/pin-browse-picker.overlay.yml', import.meta.url)),
      fileURLToPath(new URL('fixtures/manual-skills.overlay.yml', import.meta.url)),
    ],
    profile: { packages: [{ dir: fileURLToPath(new URL('..', import.meta.url)), enabled: true }] },
  })
  try {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
      const browserErrors: string[] = []
      page.on('pageerror', error => browserErrors.push(String(error)))
      page.on('console', (message) => { browserErrors.push(message.text()) })
      await page.route('https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/skills.json?*',
        route => route.fulfill({ json: CATALOG_FIXTURE, headers: { 'Access-Control-Allow-Origin': '*' } }))
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      const plugins = page.getByRole('button', { name: '插件', exact: true })
      const skills = page.getByRole('button', { name: '技能中心', exact: true })
      try {
        await skills.waitFor()
      } catch (error) {
        throw new Error(`Skill center did not mount: ${browserErrors.join('\n')}\n${await page.locator('body').innerText()}`, { cause: error })
      }
      expect((await skills.boundingBox())!.y).toBeGreaterThan((await plugins.boundingBox())!.y)
      await skills.click()
      const region = page.getByRole('region', { name: '技能中心', exact: true })
      await region.getByRole('heading', { name: /找到适合你的/ }).waitFor()
      await expect.poll(() => region.getByRole('article').count()).toBe(6)
      await expect.poll(() => region.getByRole('article').first().getByRole('button', { name: '安装' }).isEnabled()).toBe(true)
      await compareOrRefreshGolden(fileURLToPath(new URL('expected/catalog.expected.md', import.meta.url)),
        await region.ariaSnapshot(), webSnapshotMode())

      const search = region.getByRole('searchbox')
      await search.fill('NO-SUCH-DEMO-SKILL')
      await region.getByRole('button', { name: '搜索', exact: true }).click()
      await region.getByText(/没有找到/).waitFor()
      expect(await region.getByRole('article').count()).toBe(0)
      await search.fill('')
      await search.press('Enter')
      await region.getByRole('article').first().waitFor()

      const detailTrigger = region.getByRole('article').first().getByRole('button', { name: '查看详情' })
      await detailTrigger.click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      await compareOrRefreshGolden(fileURLToPath(new URL('expected/detail.expected.md', import.meta.url)),
        await dialog.ariaSnapshot(), webSnapshotMode())
      const dialogFills: string[] = []
      for (const theme of ['light', 'dark']) {
        await page.evaluate(value => document.body.toggleAttribute('data-ds-dark-theme', value === 'dark'), theme)
        dialogFills.push(await dialog.evaluate(element => getComputedStyle(element).backgroundColor))
        expect(await dialog.isVisible()).toBe(true)
      }
      expect(dialogFills[0]).not.toBe(dialogFills[1])
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      expect(await detailTrigger.evaluate(element => document.activeElement === element)).toBe(true)

      expect(await region.getByRole('article').first().getByRole('button', { name: '安装' }).isVisible()).toBe(true)
      await plugins.click()
      await page.getByRole('heading', { name: '插件', exact: true }).waitFor()
      await skills.click()
      await page.getByRole('button', { name: '收起侧边栏', exact: true }).click()

      for (const theme of ['light', 'dark']) {
        await page.evaluate(value => document.body.toggleAttribute('data-ds-dark-theme', value === 'dark'), theme)
        for (const [width, columns] of [[1440, 3], [1000, 2], [390, 1]] as const) {
          await page.setViewportSize({ width, height: 1000 })
          await expect.poll(() => region.getByRole('article').evaluateAll((elements) => {
            const top = elements[0]!.getBoundingClientRect().top
            return elements.filter(element => Math.abs(element.getBoundingClientRect().top - top) < 1).length
          }), { message: `${theme}, viewport ${width}: column count` }).toBe(columns)
          await expect.poll(() => region.evaluate(element => element.scrollWidth <= element.clientWidth),
            { message: `${theme}, viewport ${width}: no horizontal overflow` }).toBe(true)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await detailTrigger.click()
          await dialog.waitFor()
          const bounds = await dialog.boundingBox()
          expect(bounds!.x).toBeGreaterThanOrEqual(0)
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
          await dialog.getByRole('button', { name: '关闭', exact: true }).click()
        }
      }
      const englishPage = await browser.newPage({ viewport: { width: 1000, height: 1000 }, locale: 'en' })
      await englishPage.route('https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/skills.json?*',
        route => route.fulfill({ json: CATALOG_FIXTURE, headers: { 'Access-Control-Allow-Origin': '*' } }))
      await englishPage.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await englishPage.getByRole('button', { name: 'Skill center', exact: true }).click()
      const englishRegion = englishPage.getByRole('region', { name: 'Skill center', exact: true })
      await englishRegion.getByRole('article').first().waitFor()
      const englishLayout = await englishRegion.getByRole('article').evaluateAll(elements => elements.map((element) => {
        const card = element.getBoundingClientRect()
        const buttons = [...element.querySelectorAll('button')]
        return {
          fits: element.scrollWidth <= element.clientWidth && buttons.every((button) => {
            const rect = button.getBoundingClientRect()
            return rect.left >= card.left && rect.right <= card.right && button.scrollHeight <= button.clientHeight
          }),
          buttons: buttons.length,
        }
      }))
      expect(englishLayout).toEqual(Array.from({ length: 6 }, () => ({ fits: true, buttons: 2 })))
      await englishPage.close()
      await page.evaluate(() => {
        document.documentElement.dataset.platform = 'darwin'
        document.documentElement.style.setProperty('--dsh-frame-top-clearance', '32px')
      })
      await region.evaluate((element) => { element.scrollTop = 0 })
      expect((await region.getByRole('heading', { name: /找到适合你的/ }).boundingBox())!.y).toBeGreaterThanOrEqual(32)
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})
