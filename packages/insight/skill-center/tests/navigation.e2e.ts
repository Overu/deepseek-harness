/** Keyless real-Loader coverage of the skill market, shared overlays, and theme inheritance. */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { CATALOG_FIXTURE } from './fixtures/catalog.ts'
import { compareOrRefreshGolden, launchWebScaffold, webSnapshotMode } from '../../../../apps/web/tests/scaffold.ts'

it('browses the OSS catalog through the real shell in both themes and narrow panels', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('../../../../apps/web/tests/pin-browse-picker.overlay.yml', import.meta.url)),
    profile: { packages: [{ dir: fileURLToPath(new URL('..', import.meta.url)), enabled: true }] },
  })
  try {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
      await page.route('https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/skills.json?*',
        route => route.fulfill({ json: CATALOG_FIXTURE, headers: { 'Access-Control-Allow-Origin': '*' } }))
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      const plugins = page.getByRole('button', { name: '插件', exact: true })
      const skills = page.getByRole('button', { name: '技能中心', exact: true })
      await skills.waitFor()
      expect((await skills.boundingBox())!.y).toBeGreaterThan((await plugins.boundingBox())!.y)
      await skills.click()
      const region = page.getByRole('region', { name: '技能中心', exact: true })
      await region.getByRole('heading', { name: /找到适合你的/ }).waitFor()
      await expect.poll(() => region.getByRole('article').count()).toBe(6)
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

      await region.getByRole('article').first().getByRole('button', { name: '下载 ZIP' }).click()
      await page.getByRole('alert').filter({ hasText: /演示/ }).waitFor()
      await plugins.click()
      await page.getByRole('heading', { name: '插件', exact: true }).waitFor()
      expect(await page.getByRole('alert').filter({ hasText: /演示/ }).isVisible()).toBe(true)
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
      expect(englishLayout).toEqual(Array.from({ length: 6 }, () => ({ fits: true, buttons: 3 })))
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
