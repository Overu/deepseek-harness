/** Insight's bundle overlay over the shipped Desktop profile rows. */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Integration from '../src/index.ts'

const suppressed = [
  'ui-brand-official',
  'ui-settings-account',
  'account-controller',
  'product-analytics',
  'desktop-product-telemetry',
  'deepseek-account',
  'llm-deepseek-account',
  'llm-deepseek',
  'llm-pi-ai',
  'ui-settings-models',
] as const

const basePatch = fileURLToPath(new URL('../../../bundle/base/cordis.patch.yml', import.meta.url))
const webPatch = fileURLToPath(new URL('../../../bundle/web-app/cordis.patch.yml', import.meta.url))
const insightPatch = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
const insightEntry = pathToFileURL(fileURLToPath(new URL('../lib/index.js', import.meta.url))).href
const productRequiredBundles = [
  '@insight-ai/desktop-integration',
  '@insight-ai/desktop-canvas-plugin',
  'dsh-memory-evolve',
  'dsh-prompt-enhance',
]

let context: Context | undefined
beforeEach(() => {
  vi.stubEnv('DSH_INSIGHT_SERVICE_ENVIRONMENT', 'test')
  vi.stubEnv('DSH_PRODUCT_REQUIRED_BUNDLES', JSON.stringify(productRequiredBundles))
})
afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.unstubAllEnvs()
})

function composedInsightEntries() {
  return composeEntries([
    loadOverlayPatches('insight-composition', basePatch),
    loadOverlayPatches('insight-composition', webPatch),
    loadOverlayPatches('insight-composition', insightPatch),
  ])
}

describe('Insight Desktop profile composition', () => {
  it.each(['skillProxyMaxActiveRequests', 'skillProxyMaxBufferedRequestBytes', 'skillProxyRequestTimeoutMs'])(
    'rejects fractional %s before mounting business services', (field) => {
      const config = {
        requestTimeoutMs: 10_000, serviceEnvironment: 'test' as const, skillProxyMaxActiveRequests: 8,
        skillProxyMaxBufferedRequestBytes: 16_777_216, skillProxyRequestTimeoutMs: 1_250_000,
      }
      expect(Integration.Config(config)).toEqual(config)
      expect(() => Integration.Config({ ...config, [field]: 1.5 })).toThrow()
    },
  )

  it('exports exactly the Cordis entrypoint required by its bundle row', () => {
    expect(Object.keys(Integration).sort()).toEqual(['Config', 'apply', 'inject', 'name'])
    expect(Integration.inject).toEqual(['llm', 'web', 'shellEnv'])
  })

  it('keeps the upstream profile untouched until the Insight bundle layer applies', () => {
    const upstream = composeEntries([
      loadOverlayPatches('upstream-composition', basePatch),
      loadOverlayPatches('upstream-composition', webPatch),
    ])
    for (const id of suppressed) expect(upstream.find(entry => entry.id === id)?.disabled).not.toBe(true)
  })

  it('loads Insight while leaving every upstream account, brand, and telemetry row disabled', async () => {
    const entries = composedInsightEntries()
    const integration = entries.find(entry => entry.id === 'insight-desktop-integration')
    expect(integration).toMatchObject({
      name: insightEntry,
      config: {
        requestTimeoutMs: 10_000,
        skillProxyMaxActiveRequests: 8,
        skillProxyMaxBufferedRequestBytes: 16_777_216,
        skillProxyRequestTimeoutMs: 1_250_000,
      },
    })
    expect(integration?.disabled).not.toBe(true)
    expect(entries.find(entry => entry.id === 'agent-default-model')?.config).toEqual({
      provider: 'yinsai-gateway', model: 'deepseek-flash',
    })
    expect(entries.find(entry => entry.id === 'web')?.config).toMatchObject({
      searchProvider: 'insight-enterprise-search', fetchProvider: 'http',
    })
    expect(entries.find(entry => entry.id === 'plugin-manager')?.config ?? {}).not.toHaveProperty('requiredBundles')
    for (const id of suppressed) expect(entries.find(entry => entry.id === id)?.disabled).toBe(true)

    context = new Context()
    context.baseUrl = 'file:///'
    await context.plugin(Loader).await()
    expect('default' in Integration).toBe(false)
    expect(context.loader.unwrapExports(Integration)).toBe(Integration)
    // Desktop Main owns the real IPC channel and is not present in a Vitest
    // worker. The real export normalization above guards the shipping entry;
    // this stand-in isolates composition from the process transport.
    context.loader.builtins.insight = {
      name: Integration.name,
      inject: [],
      Config: Integration.Config,
      apply(ctx: Context) { ctx.provide('insightIntegrationLoaded', true) },
    }
    await context.loader.root.update(entries
      .filter(entry => entry.id === 'insight-desktop-integration' || suppressed.includes(entry.id as typeof suppressed[number]))
      .map(entry => entry.id === 'insight-desktop-integration' ? { ...entry, name: 'cordis:insight' } : entry))
    await context.loader.await()

    expect(context.get('insightIntegrationLoaded')).toBe(true)
    expect(context.get('deepseekAccount')).toBeUndefined()
    expect(context.get('productAnalytics')).toBeUndefined()
    for (const id of suppressed) {
      const entry = context.loader.resolve(id)
      expect(entry.disabled).toBe(true)
      expect(entry.fiber).toBeUndefined()
    }
  })
})
