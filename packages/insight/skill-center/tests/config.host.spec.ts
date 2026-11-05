/** Validated request deadlines reach browser pages through the Host injection. */
import { Context } from '@deepseek-ai/cordis'
import type { IndexInjection, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { expect, it, onTestFinished } from 'vitest'
import { Config } from '../src/config.ts'
import * as host from '../src/index.ts'

const pagePeer = { principal: { kind: 'owner' } } as Parameters<WebServer['renderIndex']>[1]

it('defaults the request budget and rejects invalid timer values', () => {
  expect(host.Config).toBe(Config)
  expect(Config({})).toEqual({ catalogRequestTimeoutMs: 15_000 })
  for (const value of [0, -1, 1.5, Infinity, NaN, 2_147_483_648]) {
    expect(() => Config({ catalogRequestTimeoutMs: value })).toThrow()
  }
})

it('projects configured request limits and withdraws its listener on unload', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
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
