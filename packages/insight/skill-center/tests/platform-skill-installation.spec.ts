/** Installation discovery exposes only committed technical-name platform skills. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { strToU8, zipSync } from 'fflate'
import { expect, it, onTestFinished, vi } from 'vitest'
import { Config } from '../src/config.ts'
import { InsightPlatformSkills } from '../src/host/platform-skills.ts'
import type { InsightSkillId, PlatformSkillOperationId } from '../src/shared/skill-installation.ts'

it('makes a committed platform skill callable and removes it from discovery', async () => {
  const home = await mkdtemp(join(tmpdir(), 'insight-platform-inventory-'))
  const ctx = new Context()
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true })
  })
  vi.stubEnv('DSH_HOME', home)
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url) => {
    const response = new Response(new Uint8Array(zipSync({
      'release/SKILL.md': strToU8('---\nname: expert-tool\ndescription: Installed expert\n---\n\nInstalled release\n'),
    })))
    Object.defineProperty(response, 'url', { value: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url })
    return response
  }))
  await ctx.plugin(SkillRegistry)
  const platform = new InsightPlatformSkills(ctx, Config({}))
  const id = brandString<InsightSkillId>('expert-tool')
  const signal = new AbortController().signal
  for await (const _ of platform.install({
    id, version: '1.0.0', operationId: brandString<PlatformSkillOperationId>('install'),
    downloadUrl: 'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/expert-tool.zip',
  }, signal)) {}
  expect((await ctx.skills.get('expert-tool'))?.content).toContain('Installed release')
  await platform.remove({ id }, signal)
  expect(await ctx.skills.get('expert-tool')).toBeUndefined()
})
