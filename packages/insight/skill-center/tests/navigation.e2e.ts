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

const influencerIntegration = normalizeSkillId('influencer-integration')

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
          id: influencerIntegration, version: '1.2.0',
        })],
      })
      await page.getByRole('button', { name: 'Skill center', exact: true }).click()
      await page.getByText('Installed', { exact: true }).waitFor()
      await page.getByRole('button', { name: /View details$/u }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click()
      await page.getByRole('button', { name: 'Install', exact: true }).waitFor()
      await page.reload({ waitUntil: 'load' })
      await page.getByRole('button', { name: 'Skill center', exact: true }).click()
      await page.getByRole('button', { name: 'Install', exact: true }).waitFor()
      expect(await scaffold.ctx.insightPlatformSkills.listInstalled()).toEqual({ skills: [] })
      expect(await scaffold.ctx.insightPlatformSkills.listPendingPresets([{
        id: influencerIntegration,
      }])).toEqual([])
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})

it('continues preset installation after a package name mismatch and reports one final failure', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [
      fileURLToPath(new URL('fixtures/download-service.overlay.yml', import.meta.url)),
      fileURLToPath(new URL('fixtures/partial-preset-skills.overlay.yml', import.meta.url)),
    ],
    profile: { packages: [{ dir: fileURLToPath(new URL('..', import.meta.url)), enabled: true }] },
  })
  try {
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const skills = [14, 15, 16].map(id => ({
        ...CATALOG_FIXTURE.skills[0]!, id, skill_id: `preset-${id}`, name: `Preset ${id}`,
        download_url: `https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/preset-${id}-fixture.zip`,
      }))
      await page.route('https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/skills.json?*',
        route => route.fulfill({ json: { skills }, headers: { 'Access-Control-Allow-Origin': '*' } }))
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await expect.poll(async () => (await scaffold.ctx.insightPlatformSkills.listInstalled()).skills.map(skill => skill.id).sort())
        .toEqual(['preset-15', 'preset-16'])
      await page.getByRole('alert').getByText('Preset skill installation did not finish. Try again in skill center', { exact: true }).waitFor()
      expect(await page.getByRole('dialog', { name: 'Installing preset skills' }).count()).toBe(0)
      expect(await scaffold.ctx.insightPlatformSkills.listPendingPresets(skills.map(skill => ({
        id: normalizeSkillId(skill.skill_id),
      })))).toEqual([{ id: 'preset-14' }])
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})

it('uses the technical name despite OSS numeric ID changes, absence, or invalid values', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [
      fileURLToPath(new URL('fixtures/download-service.overlay.yml', import.meta.url)),
      fileURLToPath(new URL('fixtures/manual-skills.overlay.yml', import.meta.url)),
    ],
    profile: { packages: [{ dir: fileURLToPath(new URL('..', import.meta.url)), enabled: true }] },
  })
  try {
    const store = join(scaffold.harnessHome, 'platform-skills')
    const skillName = 'influencer-integration'
    const payload = `payloads/${skillName}/first-release`
    const installedPath = join(store, 'installed', `${skillName}.json`)
    const historyPath = join(store, 'auto-install-history', `${skillName}.json`)
    const initialRecord = `${JSON.stringify({ id: skillName, version: '1.0.0', payload })}\n`
    await mkdir(join(store, payload), { recursive: true })
    await writeFile(join(store, payload, 'SKILL.md'), '---\nname: influencer-integration\ndescription: Existing account installation\n---\n\nRetained installed content.\n')
    await writeFile(installedPath, initialRecord)
    await writeFile(historyPath, `${JSON.stringify({ id: skillName })}\n`)
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      let catalogueId: unknown = 999
      let technicalName = skillName
      await page.route('https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/skills.json?*',
        route => route.fulfill({ json: { skills: technicalName === skillName ? [{
          ...CATALOG_FIXTURE.skills[0], id: catalogueId, skill_id: skillName,
          download_url: 'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/identity-fixture.zip',
        }] : [
          {
            ...CATALOG_FIXTURE.skills[0], id: catalogueId, skill_id: skillName,
            download_url: 'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/identity-fixture.zip',
          },
          {
            ...CATALOG_FIXTURE.skills[0], id: catalogueId, skill_id: technicalName, name: 'Renamed skill', sort: 11,
            download_url: 'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/identity-fixture.zip',
          },
        ] }, headers: { 'Access-Control-Allow-Origin': '*' } }))
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: 'Skill center', exact: true }).click()
      await page.getByRole('button', { name: 'Update', exact: true }).waitFor()
      expect(await readFile(installedPath, 'utf8')).toBe(initialRecord)
      expect(JSON.parse(await readFile(historyPath, 'utf8'))).toEqual({ id: skillName })
      await stat(join(store, payload, 'SKILL.md'))
      catalogueId = undefined
      await page.reload({ waitUntil: 'load' })
      await page.getByRole('button', { name: 'Skill center', exact: true }).click()
      await page.getByRole('button', { name: 'Update', exact: true }).waitFor()
      catalogueId = 'not-a-technical-name'
      await page.reload({ waitUntil: 'load' })
      await page.getByRole('button', { name: 'Skill center', exact: true }).click()
      await page.getByRole('button', { name: 'Update', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Update', exact: true }).click()
      await page.getByText('Installed', { exact: true }).waitFor()
      const upgraded: unknown = JSON.parse(await readFile(installedPath, 'utf8'))
      expect(upgraded).toMatchObject({
        id: skillName, version: '1.2.0',
      })
      technicalName = 'influencer-integration-renamed'
      catalogueId = 1000
      await page.reload({ waitUntil: 'load' })
      await page.getByRole('button', { name: 'Skill center', exact: true }).click()
      await page.getByRole('article').filter({ hasText: 'Renamed skill' })
        .getByRole('button', { name: 'Install', exact: true }).waitFor()
      expect(await scaffold.ctx.insightPlatformSkills.listInstalled()).toEqual({
        skills: [{ id: influencerIntegration, version: '1.2.0' }],
      })
      const installedCard = page.getByRole('article').filter({
        has: page.getByText('Installed', { exact: true }),
      })
      const originalCard = page.getByRole('article').filter({ hasText: CATALOG_FIXTURE.skills[0]!.name })
      await installedCard.getByRole('button', { name: /View details$/u }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click()
      await originalCard.getByRole('button', { name: 'Install', exact: true }).waitFor()
      await expect(stat(installedPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(JSON.parse(await readFile(historyPath, 'utf8'))).toEqual({ id: skillName })
      await page.reload({ waitUntil: 'load' })
      await page.getByRole('button', { name: 'Skill center', exact: true }).click()
      const renamedCard = page.getByRole('article').filter({ hasText: 'Renamed skill' })
      await originalCard.getByRole('button', { name: 'Install', exact: true }).waitFor()
      await renamedCard.getByRole('button', { name: 'Install', exact: true }).waitFor()
      await expect.poll(() => page.getByRole('button', { name: 'Install', exact: true }).count()).toBe(2)
      expect(await scaffold.ctx.insightPlatformSkills.listInstalled()).toEqual({ skills: [] })
      expect(await scaffold.ctx.insightPlatformSkills.listPendingPresets([{
        id: influencerIntegration,
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
      const draft = '/history-catalog-sentinel /browser-installed-expert review this draft'
      await writeComposerDraft(page, input, draft)
      await input.locator('[data-composer-text-ref]').filter({ hasText: '/history-catalog-sentinel' }).waitFor()
      const reference = input.locator('[data-composer-text-ref]').filter({ hasText: '/browser-installed-expert' })
      await expect.poll(() => reference.count()).toBe(0)

      const market = await newEnglishPage(browser)
      let version = '1.0.0'
      await market.route('https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/skills.json?*',
        route => route.fulfill({ json: { skills: [{
          ...CATALOG_FIXTURE.skills[0], version,
          skill_id: 'browser-installed-expert',
          download_url: 'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/install-fixture.zip',
        }] }, headers: { 'Access-Control-Allow-Origin': '*' } }))
      const openMarket = async (): Promise<void> => {
        await market.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
        await market.getByRole('button', { name: 'Skill center', exact: true }).click()
      }
      await openMarket()
      await market.getByRole('button', { name: 'Install', exact: true }).click()
      await market.getByText('Installed', { exact: true }).waitFor()
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

      const customSkill = join(scaffold.harnessHome, 'skills', 'browser-installed-expert')
      await mkdir(customSkill, { recursive: true })
      await writeFile(join(customSkill, 'SKILL.md'),
        '---\nname: browser-installed-expert\ndescription: Same-name user skill\n---\n\nUser-maintained content.\n')
      await page.locator('[data-insight-skill-picker]').getByRole('button').first().click()
      await picker.getByText('已被更高优先级版本覆盖', { exact: true }).waitFor()
      const platformRow = picker.getByRole('option', { name: /browser-installed-expert/u })
      await expect.poll(() => installedOption.isEnabled()).toBe(true)
      await expect.poll(() => platformRow.getAttribute('aria-selected')).toBe('true')
      await installedOption.click()
      await expect.poll(() => platformRow.getAttribute('aria-selected')).toBe('false')
      await reference.waitFor({ state: 'detached' })
      await page.getByRole('tab', { name: '用户自定义', exact: true }).click()
      const customOption = picker.getByRole('button', { name: 'browser-installed-expert', exact: true })
      await customOption.click()
      const customRow = picker.getByRole('option', { name: /browser-installed-expert/u })
      await expect.poll(() => customRow.getAttribute('aria-selected')).toBe('true')
      await reference.waitFor()
      expect((await input.textContent())?.match(/\/browser-installed-expert\b/gu)).toHaveLength(1)
      await page.keyboard.press('Escape')
      await page.locator('[data-insight-skill-picker]').getByRole('button').first().click()
      await expect.poll(() => platformRow.getAttribute('aria-selected')).toBe('true')
      await installedOption.click()
      await expect.poll(() => platformRow.getAttribute('aria-selected')).toBe('false')
      await page.getByRole('combobox', { name: '搜索技能' }).press('Enter')
      await expect.poll(() => platformRow.getAttribute('aria-selected')).toBe('true')
      expect((await input.textContent())?.match(/\/browser-installed-expert\b/gu)).toHaveLength(1)
      await page.getByRole('tab', { name: '用户自定义', exact: true }).click()
      await customRow.waitFor()
      await market.getByRole('tab', { name: 'Custom skills', exact: true }).click()
      await market.getByRole('button', { name: 'browser-installed-expert, View details', exact: true }).click()
      const customDetails = market.getByRole('dialog', { name: 'browser-installed-expert', exact: true })
      await customDetails.getByRole('button', { name: 'Delete skill', exact: true }).click()
      const confirmation = market.getByRole('dialog', { name: 'Delete skill', exact: true })
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(stat(join(customSkill, 'SKILL.md'))).resolves.toBeDefined()
      await customDetails.getByRole('button', { name: 'Delete skill', exact: true }).click()
      await confirmation.getByRole('button', { name: 'Delete skill', exact: true }).click()
      await market.getByText('No custom skills are available yet', { exact: true }).waitFor()
      await expect(stat(customSkill)).rejects.toMatchObject({ code: 'ENOENT' })
      await customRow.waitFor({ state: 'detached' })
      await page.getByRole('tab', { name: '平台预置', exact: true }).click()
      await installedOption.waitFor()
      await page.keyboard.press('Escape')
      await writeComposerDraft(page, input, draft)

      version = '1.1.0'
      await openMarket()
      await market.getByRole('button', { name: 'Update', exact: true }).click()
      await market.getByText('Installed', { exact: true }).waitFor()
      await page.locator('[data-insight-skill-picker]').getByRole('button').first().click()
      await installedOption.waitFor()
      await expect.poll(() => installedOption.isEnabled()).toBe(true)
      await page.keyboard.press('Escape')
      await reference.waitFor()
      await reference.click()
      await expect.poll(() => preview.textContent()).toContain('Archive release 2.')
      expect(await input.textContent()).toBe(draft)

      await page.locator('[data-insight-skill-picker]').getByRole('button').first().click()
      await installedOption.waitFor()
      await market.getByRole('button', { name: /View details$/u }).click()
      await market.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click()
      await market.getByRole('button', { name: 'Install', exact: true }).waitFor()
      await reference.waitFor({ state: 'detached' })
      await installedOption.waitFor({ state: 'detached' })
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
          skill_id: 'browser-installed-expert',
          download_url: 'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/install-fixture.zip',
        }] }, headers: { 'Access-Control-Allow-Origin': '*' } }))
      const openMarket = async (): Promise<void> => {
        await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
        await page.getByRole('button', { name: '技能中心', exact: true }).click()
      }
      await openMarket()
      await page.getByRole('button', { name: '安装', exact: true }).click()
      await page.getByText('已安装', { exact: true }).waitFor()
      await expect.poll(() => page.getByRole('article').getByRole('button', { name: '安装', exact: true }).count()).toBe(0)
      version = '1.1.0'
      await openMarket()
      await page.getByRole('button', { name: '更新', exact: true }).click()
      await page.getByText('已安装', { exact: true }).waitFor()
      await page.getByRole('button', { name: /查看详情$/u }).click()
      const dialog = page.getByRole('dialog')
      expect(await dialog.getByRole('button').count()).toBe(2)
      await dialog.getByRole('button', { name: '移除', exact: true }).click()
      await page.getByRole('button', { name: '安装', exact: true }).waitFor()
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})

it('browses official and local skills through the real shell in both themes and narrow panels', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [
      fileURLToPath(new URL('../../../../apps/web/tests/pin-browse-picker.overlay.yml', import.meta.url)),
      fileURLToPath(new URL('fixtures/manual-skills.overlay.yml', import.meta.url)),
    ],
    profile: { packages: [{ dir: fileURLToPath(new URL('..', import.meta.url)), enabled: true }] },
  })
  try {
    const accountSkill = join(scaffold.harnessHome, 'skills', 'influencer-integration')
    const sharedSkill = join(scaffold.workspaceCwd, '.agents-home', 'skills', 'shared-brief')
    await mkdir(accountSkill, { recursive: true })
    await mkdir(sharedSkill, { recursive: true })
    await writeFile(join(accountSkill, 'SKILL.md'), '---\nname: influencer-integration\ndescription: 整理我的达人整合方案。\n---\n')
    await writeFile(join(accountSkill, 'ui.json'), JSON.stringify({ displayName: '我的达人整合', shortDescription: '个人营销模板' }))
    await writeFile(join(sharedSkill, 'SKILL.md'), '---\nname: shared-brief\ndescription: 整理团队共享的营销简报。\n---\n')
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
      const officialTab = region.getByRole('tab', { name: '官方技能', exact: true })
      const customTab = region.getByRole('tab', { name: '自定义技能', exact: true })
      expect(await officialTab.getAttribute('aria-selected')).toBe('true')
      await search.fill('influencer-integration')
      await search.press('Enter')
      await expect.poll(() => region.getByRole('article').count()).toBe(1)
      await officialTab.press('ArrowRight')
      expect(await customTab.getAttribute('aria-selected')).toBe('true')
      expect(await search.inputValue()).toBe('influencer-integration')
      const customPanel = region.getByRole('tabpanel', { name: '自定义技能', exact: true })
      await customPanel.getByRole('heading', { name: '我的达人整合', exact: true }).waitFor()
      expect(await customPanel.getByRole('article').count()).toBe(1)
      const glyph = await customPanel.getByText('我', { exact: true }).boundingBox()
      if (glyph === null) throw new Error('Custom skill initial is not visible')
      await page.mouse.click(glyph.x + glyph.width / 2, glyph.y + glyph.height / 2)
      const customDialog = page.getByRole('dialog', { name: '我的达人整合', exact: true })
      await customDialog.getByText('整理我的达人整合方案。', { exact: true }).waitFor()
      expect(await customDialog.getByRole('button', { name: /安装|更新|移除/u }).count()).toBe(0)
      await compareOrRefreshGolden(fileURLToPath(new URL('expected/custom-detail.expected.md', import.meta.url)),
        await customDialog.ariaSnapshot(), webSnapshotMode())
      await page.keyboard.press('Escape')
      await search.fill('')
      await search.press('Enter')
      await customPanel.getByText('共享', { exact: true }).waitFor()
      expect(await customPanel.getByRole('article').count()).toBe(2)
      await compareOrRefreshGolden(fileURLToPath(new URL('expected/custom.expected.md', import.meta.url)),
        await region.ariaSnapshot(), webSnapshotMode())
      await officialTab.click()

      await search.fill('NO-SUCH-DEMO-SKILL')
      await region.getByRole('button', { name: '搜索', exact: true }).click()
      await region.getByText(/没有找到/).waitFor()
      expect(await region.getByRole('article').count()).toBe(0)
      await search.fill('')
      await search.press('Enter')
      await region.getByRole('article').first().waitFor()

      const detailTrigger = region.getByRole('article').first().getByRole('button', { name: /查看详情$/u })
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
        const tabList = region.getByRole('tablist', { name: '技能来源', exact: true })
        expect(await tabList.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
        expect(await tabList.locator(':scope > [aria-hidden="true"]').isVisible()).toBe(false)
        expect(await officialTab.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px')
        expect(await region.getByText('达', { exact: true }).evaluate(element => getComputedStyle(element).backgroundImage)).toContain('radial-gradient(')
        for (const [width, columns] of [[1440, 2], [1000, 2], [390, 1]] as const) {
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
          expect(bounds!.width).toBeLessThanOrEqual(600)
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
