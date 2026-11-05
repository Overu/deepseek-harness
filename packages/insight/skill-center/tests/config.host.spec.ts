/** Validated request deadlines reach browser pages through the Host injection. */
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type { IndexInjection, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { Config } from '../src/config.ts'
import * as host from '../src/index.ts'

const pagePeer = { principal: { kind: 'owner' } } as Parameters<WebServer['renderIndex']>[1]

it('defaults the request budget and rejects invalid timer values', () => {
  expect(host.Config).toBe(Config)
  expect(Config({})).toEqual({
    presetSkillIds: [],
    legacySkillDirs: [],
    catalogRequestTimeoutMs: 15_000,
    packageRequestTimeoutMs: 120_000,
    packageMaxDownloadBytes: 64 * 1024 * 1024,
    packageMaxEntries: 10_000,
    packageMaxExtractedBytes: 256 * 1024 * 1024,
    packageAllowedOrigins: ['https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com'],
  })
  for (const value of [0, -1, 1.5, Infinity, NaN, 2_147_483_648]) {
    expect(() => Config({ catalogRequestTimeoutMs: value })).toThrow()
    expect(() => Config({ packageRequestTimeoutMs: value })).toThrow()
  }
})

it('accepts opaque catalogue IDs and technical names while rejecting empty selectors', () => {
  expect(Config({ presetSkillIds: ['1', 'REMOTE/ID', 'influencer-integration'], legacySkillDirs: ['/old/skills'] }))
    .toMatchObject({ presetSkillIds: ['1', 'REMOTE/ID', 'influencer-integration'], legacySkillDirs: ['/old/skills'] })
  for (const id of ['', ' ', '\n']) {
    expect(() => Config({ presetSkillIds: [id] })).toThrow()
  }
  for (const directory of ['', ' ', 'relative/skills']) {
    expect(() => Config({ legacySkillDirs: [directory] })).toThrow()
  }
})

it('rejects an empty Desktop legacy directory instead of scanning the startup directory', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); vi.unstubAllEnvs() })
  vi.stubEnv('DSH_INSIGHT_LEGACY_SKILL_DIR', '')
  await expect(host.apply(ctx, Config({}))).rejects.toThrow('absolute host paths')
})

it('projects configured request limits and withdraws its listener on unload', async () => {
  const ctx = new Context()
  const home = await mkdtemp(join(tmpdir(), 'insight-skill-center-config-'))
  vi.stubEnv('DSH_HOME', home)
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true })
  })
  await ctx.plugin(SkillRegistry)
  const config = Config({ catalogRequestTimeoutMs: 750 })
  const feature = ctx.plugin(host, config)
  await feature.await()
  const rows: IndexInjection[] = []
  ctx.emit('webserver/index-inject', rows, pagePeer)
  expect(rows).toEqual([{ kind: 'global', name: '__INSIGHT_SKILL_CENTER_CONFIG__', value: config }])
  await feature.dispose()
  const after: IndexInjection[] = []
  ctx.emit('webserver/index-inject', after, pagePeer)
  expect(after).toEqual([])
})
