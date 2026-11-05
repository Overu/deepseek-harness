/** Installation, model discovery, and the categorized picker share committed account state. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Config } from '../src/config.ts'
import { InsightPlatformSkills } from '../src/host/platform-skills.ts'
import type { InsightSkillId, PlatformSkillOperationId } from '../src/shared/skill-installation.ts'
import { zipSync, strToU8 } from 'fflate'
import { expect, it, onTestFinished, vi } from 'vitest'
import { InsightSkillInventory } from '../src/host/skill-inventory.ts'

it('makes installed and updated skills callable in platform presets, then removes both views', async () => {
  const home = await mkdtemp(join(tmpdir(), 'insight-platform-inventory-'))
  const ctx = new Context()
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true })
  })
  vi.stubEnv('DSH_HOME', home)
  vi.stubEnv('DSH_AGENTS_HOME', join(home, 'agents'))
  let body = 'First release'
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url) => {
    const response = new Response(new Uint8Array(zipSync({
      'catalog-expert/SKILL.md': strToU8(`---\nname: expert-tool\ndescription: Installed expert\n---\n\n${body}\n`),
      'catalog-expert/ui.json': strToU8(JSON.stringify({ displayName: '安装测试专家', shortDescription: '已提交的技能' })),
    })))
    Object.defineProperty(response, 'url', { value: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url })
    return response
  }))
  await ctx.plugin(SkillRegistry)
  const platform = new InsightPlatformSkills(ctx, Config({}))
  const sessionId = brandString<SessionId>('installed-platform-session')
  ctx.provide('agents', { get: () => undefined } as never)
  ctx.provide('sessionQuery', {
    observeSession: async () => ({
      header: { cwd: home }, projections: { values: {} }, [Symbol.dispose]: () => {},
    }),
  } as never)
  ctx.provide('workingDirectory', { defaultDirectory: home } as never)
  const inventory = new InsightSkillInventory(ctx)
  const signal = new AbortController().signal
  const id = brandString<InsightSkillId>('catalog-expert')
  expect((await ctx.skills.snapshot()).skills).toEqual([])

  for (const version of ['1.0.0', '1.1.0']) {
    body = version === '1.0.0' ? 'First release' : 'Updated release'
    const frames = []
    for await (const frame of platform.install({
      id, skillName: 'expert-tool', version, operationId: brandString<PlatformSkillOperationId>(`install-${version}`),
      downloadUrl: 'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/catalog-expert.zip',
    }, signal)) frames.push(frame)
    expect(frames.at(-1)).toMatchObject({ kind: 'complete', skill: { id, version } })
    expect(await platform.listInstalled()).toMatchObject({ skills: [{ id, skillName: 'expert-tool', version }] })
    expect((await ctx.skills.get('expert-tool'))?.content).toContain(body)
    expect((await inventory.list({ sessionId }, signal)).entries).toContainEqual(expect.objectContaining({
      name: 'expert-tool', origin: 'platform', availability: 'callable', displayName: '安装测试专家',
    }))
  }

  const installed = (await platform.listInstalled()).skills[0]!
  await platform.remove({ key: installed.key, id, skillName: 'expert-tool' }, signal)
  expect(await platform.listInstalled()).toEqual({ skills: [] })
  expect((await ctx.skills.snapshot()).skills).toEqual([])
  expect((await inventory.list({ sessionId }, signal)).entries).toEqual([])
})
